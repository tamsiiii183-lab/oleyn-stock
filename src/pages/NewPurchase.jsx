// New purchase (/purchase/new, Owner): "Scan memo with AI" or "Enter by hand". If the AI fails or takes over 20 s,
// the same purchase form opens empty with the photo shown, so the Owner can always finish by hand (spec 8.7).
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { shrinkImage } from '../lib/image.js';
import { clearDraft } from '../lib/drafts.js';
import { useToast } from '../components/Toast.jsx';
import PurchaseForm from '../components/PurchaseForm.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';
import { track } from '../lib/analytics.js';

const EMPTY = { supplier_name: '', lines: [{ product_id: '', qty: '', unit_cost: '' }] };

export default function NewPurchase() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const [mode, setMode] = useState('choose');
  const [photo, setPhoto] = useState(null);

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMode('reading');
    let img = null;
    try {
      img = await shrinkImage(file);
      setPhoto(img.dataUrl);
      const { data } = await supabase.auth.getSession();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000); // server gives up at 20 s; this is a safety net
      const r = await fetch('/api/extract-memo', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
        body: JSON.stringify({ image_base64: img.base64, mime_type: img.mime_type }),
      });
      clearTimeout(timer);
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.extraction_id || !Array.isArray(body.lines)) throw new Error(body.reason || `http_${r.status}`);
      track('ai_memo_extracted', {
        latency_ms: body.latency_ms, lines: body.lines.length,
        low_confidence_fields: body.lines.filter((l) => Number(l.confidence) < 0.8 || !l.product_id).length,
      });
      sessionStorage.setItem(`oleyn_ai_${body.extraction_id}`, JSON.stringify({ result: body, photo: img.dataUrl }));
      navigate(`/purchase/review/${body.extraction_id}`);
    } catch (err) {
      // Fallback: same form, empty, with the photo beside it.
      console.warn('AI memo fallback:', err?.name === 'AbortError' ? 'timeout' : err?.message);
      const reason = err?.name === 'AbortError' ? 'timeout' : ['timeout', 'invalid_json', 'rate_limit'].includes(err?.message) ? err.message : 'error';
      track('ai_fallback_used', { reason });
      toast(t('ai_failed'), 'error');
      clearDraft('purchase');
      setMode('manual');
    } finally {
      e.target.value = '';
    }
  }

  if (mode === 'manual') return <PurchaseForm draftKey="purchase" initial={EMPTY} photo={photo} source="manual" />;
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-bold text-brand-dark">{t('new_purchase')}</h1>
      {mode === 'reading' ? (
        <div className="space-y-3 text-center">
          {photo && <img src={photo} alt={t('memo_photo')} className="max-h-64 w-full rounded-xl object-contain" />}
          <p className="animate-pulse font-semibold text-brand">{t('reading_memo')}</p>
        </div>
      ) : (
        <>
          <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <Button onClick={() => fileInput.current?.click()}>📷 {t('scan_memo')}</Button>
          <Button variant="secondary" onClick={() => setMode('manual')}>{t('enter_by_hand')}</Button>
        </>
      )}
    </Card>
  );
}
