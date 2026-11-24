// Owner approves a Salesperson's stock request (/purchase/request/:id): AI prices (if any) or the last known cost are
// filled in; the Owner checks them and approves (stock goes up) or rejects with a reason.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { dateTime } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PurchaseForm from '../components/PurchaseForm.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function RequestReview() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: req } = await supabase.from('purchase_requests').select('*').eq('id', id).maybeSingle();
      if (!req) { setD({ missing: true }); return; }
      const [ai, costs, names] = await Promise.all([
        req.ai_extraction_id ? supabase.from('ai_extractions').select('raw_output').eq('id', req.ai_extraction_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('product_costs').select('product_id, cost_price'),
        supabase.rpc('staff_names'),
      ]);
      const aiLines = ai.data?.raw_output?.lines || [];
      const last = Object.fromEntries((costs.data || []).map((c) => [c.product_id, c.cost_price]));
      const lines = req.lines.map((l) => {
        const aiPrice = l.ai_index != null ? aiLines[l.ai_index]?.unit_price : null;
        return { product_id: l.product_id, qty: l.qty, item_name: l.item_name, unit_cost: aiPrice ?? last[l.product_id] ?? '',
          confidence: aiPrice == null ? 0.5 : Number(aiLines[l.ai_index]?.confidence ?? 1) };
      });
      setD({ req, lines, sender: (names.data || []).find((n) => n.id === req.created_by)?.full_name || '—' });
    })();
  }, [id]);

  async function reject() {
    setError('');
    const { error: err } = await supabase.rpc('reject_purchase_request', { p_request_id: id, p_note: reason });
    if (err) { setError(errorText(t, err)); return; }
    toast(t('request_rejected'));
    navigate('/purchase/new');
  }

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  if (d.missing) return <Card><p className="text-slate">{t('not_found')}</p></Card>;
  const { req } = d;
  return (
    <div className="space-y-3">
      <Card>
        <h1 className="text-xl font-bold text-brand-dark">{req.request_no}</h1>
        <p className="text-sm text-slate">{t('sent_by')} {d.sender} · {dateTime(req.created_at, lang)} · {t(`status_${req.status}`)}</p>
      </Card>
      {req.status === 'pending' ? (
        <>
          <PurchaseForm draftKey={`approve_${id}`} initial={{ supplier_name: req.supplier_name || '', lines: d.lines }}
            source={req.ai_extraction_id ? 'ai' : 'manual'} mode="approve" requestId={id} />
          <Card className="space-y-2">
            <label className="block text-sm font-semibold">{t('reject_reason')}
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-xl border border-cloud px-3" />
            </label>
            {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
            <Button variant="secondary" onClick={reject} disabled={!reason.trim()}>{t('reject')}</Button>
          </Card>
        </>
      ) : req.review_note && <Card><p>{req.review_note}</p></Card>}
    </div>
  );
}
