// Owner-only: record damaged, expired, lost, free-sample or count-correction stock changes, with a required note.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { localName } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';
import { track } from '../lib/analytics.js';

const REASONS = ['adjust_damage', 'adjust_expired', 'adjust_lost', 'adjust_sample', 'adjust_count'];

export default function AdjustStock() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState(params.get('product') || '');
  const [direction, setDirection] = useState(-1);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('adjust_damage');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('products').select('id, sku, name, name_bn').eq('is_active', true).order('name').then(({ data }) => setProducts(data || []));
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!productId || !(Number(qty) > 0) || !note.trim()) { setError(t('fill_required')); return; }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('adjust_stock', {
      p_product_id: productId, p_qty_change: direction * Number(qty), p_reason: reason, p_note: note.trim(),
    });
    setBusy(false);
    if (err) { setError(errorText(t, err)); return; }
    track('stock_adjusted', { reason });
    toast(t('adjustment_saved'));
    navigate(`/products/${productId}`);
  }

  const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';
  const dirBtn = (v, label) => (
    <button type="button" onClick={() => setDirection(v)} aria-pressed={direction === v}
      className={`min-h-[48px] flex-1 rounded-xl border-2 font-semibold ${direction === v ? 'border-brand bg-brand text-white' : 'border-brand bg-white text-brand'}`}>
      {label}
    </button>
  );
  return (
    <Card>
      <form onSubmit={save} className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">{t('adjust_stock')}</h1>
        <label className="block text-sm font-semibold">{t('choose_product')} *
          <select className={input} value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{localName(p, lang)} ({p.sku})</option>)}
          </select>
        </label>
        <div className="flex gap-3">{dirBtn(-1, t('remove_stock'))}{dirBtn(1, t('add_stock'))}</div>
        <label className="block text-sm font-semibold">{t('quantity')} *
          <input className={input} type="number" min="0.01" step="0.01" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <label className="block text-sm font-semibold">{t('reason')} *
          <select className={input} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{t(`reason_${r.replace('adjust_', '')}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">{t('note')} *
          <textarea className={`${input} py-2`} rows="2" value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
        <Button type="submit" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
      </form>
    </Card>
  );
}
