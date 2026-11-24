// Purchase form used for both "Enter by hand" and the AI review screen. Lines flagged by the AI get a Signal Orange
// outline and a "Check this" chip. Saving calls create_purchase with safe save (same client_ref on retry).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, localName } from '../lib/format.js';
import { loadDraft, saveDraft, clearDraft, isNetworkError, round2 } from '../lib/drafts.js';
import { useToast } from './Toast.jsx';
import Banner from './Banner.jsx';
import Button from './Button.jsx';
import Card from './Card.jsx';

const cell = 'min-h-[44px] w-full rounded-lg border bg-white px-2';

export default function PurchaseForm({ draftKey, initial, photo, source = 'manual', extractionId = null, warnings = [], onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [d, setD] = useState(() => loadDraft(draftKey, initial));
  const [original] = useState(initial.lines);
  const [checked, setChecked] = useState(source !== 'ai');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [netFail, setNetFail] = useState(false);

  useEffect(() => { supabase.from('products').select('id, sku, name, name_bn, unit').eq('is_active', true).order('name').then((r) => setProducts(r.data || [])); }, []);
  useEffect(() => { saveDraft(draftKey, d); }, [d, draftKey]);
  const setLine = (i, patch) => setD({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const total = round2(d.lines.reduce((s, l) => s + round2(Number(l.qty || 0) * Number(l.unit_cost || 0)), 0));
  const allHaveProducts = d.lines.length > 0 && d.lines.every((l) => l.product_id && Number(l.qty) > 0 && l.unit_cost !== '' && l.unit_cost != null);
  // Fields the Owner changed compared with what the AI suggested (sent as p_fields_edited for the accuracy metric).
  const fieldsEdited = d.lines.reduce((n, l, i) => {
    const o = original[i] || {};
    return n + ['product_id', 'qty', 'unit_cost'].filter((k) => String(l[k] ?? '') !== String(o[k] ?? '')).length;
  }, 0) + Math.max(0, original.length - d.lines.length) * 3;

  async function save() {
    setBusy(true); setError(''); setNetFail(false);
    const { data, error: err } = await supabase.rpc('create_purchase', {
      p_client_ref: d.client_ref, p_supplier_name: d.supplier_name || null, p_source: source,
      p_lines: d.lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })),
      p_ai_extraction_id: extractionId, p_fields_edited: source === 'ai' ? fieldsEdited : null,
    });
    setBusy(false);
    if (err) { if (isNetworkError(err)) setNetFail(true); else setError(errorText(t, err)); return; }
    clearDraft(draftKey);
    toast(`${data.purchase_no} · ${t('purchase_saved')}`);
    onSaved?.(data, { lines: d.lines.length, fieldsEdited });
    navigate(d.lines.length === 1 ? `/products/${d.lines[0].product_id}` : '/products');
  }

  return (
    <div className="space-y-3">
      {netFail && <Banner onRetry={save} busy={busy} />}
      {photo && <img src={photo} alt={t('memo_photo')} className="max-h-80 w-full rounded-xl border border-cloud bg-white object-contain" />}
      {warnings.length > 0 && (
        <div className="rounded-xl bg-accent-tint p-3 text-sm text-accent-ink">
          <b>⚠ {t('warnings')}</b>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <Card className="space-y-3">
        <label className="block text-sm font-semibold">{t('supplier')}
          <input className={`${cell} mt-1 border-cloud`} value={d.supplier_name || ''} onChange={(e) => setD({ ...d, supplier_name: e.target.value })} />
        </label>
        {d.lines.map((l, i) => {
          const flag = source === 'ai' && (l.confidence < 0.8 || !l.product_id || l.warn);
          const b = flag ? 'border-accent border-2' : 'border-cloud';
          return (
            <div key={i} className={`space-y-2 rounded-xl p-3 ${flag ? 'bg-accent-tint' : 'bg-brand-tint'}`}>
              <div className="flex items-center justify-between gap-2">
                {l.item_name ? <span className="text-xs text-slate">{t('read_as')}: “{l.item_name}”{l.unit ? ` (${l.unit})` : ''}</span> : <span />}
                {flag && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">{t('check_this')}</span>}
              </div>
              <select className={`${cell} ${b}`} value={l.product_id || ''} onChange={(e) => setLine(i, { product_id: e.target.value })} aria-label={t('choose_product')}>
                <option value="">{t('choose_product')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{localName(p, lang)} ({p.sku})</option>)}
              </select>
              <div className="grid grid-cols-3 items-center gap-2">
                <input className={`${cell} ${b}`} type="number" min="0" inputMode="decimal" placeholder={t('quantity')} aria-label={t('quantity')}
                  value={l.qty ?? ''} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <input className={`${cell} ${b}`} type="number" min="0" inputMode="decimal" placeholder={t('unit_cost')} aria-label={t('unit_cost')}
                  value={l.unit_cost ?? ''} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                <span className="text-right font-semibold">{money(round2(Number(l.qty || 0) * Number(l.unit_cost || 0)), lang)}</span>
              </div>
              <button type="button" className="text-sm text-slate underline" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })}>{t('remove')}</button>
            </div>
          );
        })}
        <Button variant="secondary" type="button" onClick={() => setD({ ...d, lines: [...d.lines, { product_id: '', qty: '', unit_cost: '' }] })}>{t('add_line')}</Button>
        <div className="flex justify-between text-xl font-bold text-brand-dark"><span>{t('purchase_total')}</span><span>{money(total, lang)}</span></div>
        {!allHaveProducts && d.lines.length > 0 && <p className="text-sm font-semibold text-accent-text">⚠ {t('need_products')}</p>}
        {source === 'ai' && (
          <label className="flex min-h-[48px] items-center gap-3 font-semibold">
            <input type="checkbox" className="h-6 w-6" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {t('i_checked')}
          </label>
        )}
      </Card>
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      <Button onClick={save} disabled={busy || !allHaveProducts || !checked}>{busy ? t('saving') : t('save')}</Button>
    </div>
  );
}
