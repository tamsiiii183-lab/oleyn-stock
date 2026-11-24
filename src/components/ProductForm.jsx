// Owner-only form to add or edit a product, including its cost price (saved in the Owner-only product_costs table).
import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import Button from './Button.jsx';

const blank = { sku: '', barcode: '', name: '', name_bn: '', unit: 'pcs', sale_price: '', low_stock_at: '10', cost: '' };

export default function ProductForm({ product, onSaved, onCancel }) {
  const { t } = useI18n();
  const [f, setF] = useState(product ? { ...blank, ...product, cost: product.cost ?? '' } : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    if (!f.sku.trim() || !f.name.trim() || f.sale_price === '' || Number(f.sale_price) < 0) { setError(t('fill_required')); return; }
    setBusy(true);
    setError('');
    const row = {
      sku: f.sku.trim().toUpperCase(), barcode: f.barcode.trim() || null, name: f.name.trim(), name_bn: f.name_bn.trim() || null,
      unit: f.unit.trim() || 'pcs', sale_price: Number(f.sale_price), low_stock_at: Number(f.low_stock_at || 0),
    };
    const res = product
      ? await supabase.from('products').update(row).eq('id', product.id).select('id').single()
      : await supabase.from('products').insert(row).select('id').single();
    if (!res.error && f.cost !== '') {
      const c = await supabase.from('product_costs')
        .upsert({ product_id: res.data.id, cost_price: Number(f.cost), updated_at: new Date().toISOString() });
      if (c.error) res.error = c.error;
    }
    setBusy(false);
    if (res.error) { setError(errorText(t, res.error)); return; }
    onSaved(res.data.id, !product);
  }

  const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';
  const field = (k, label, props = {}) => (
    <label className="block text-sm font-semibold">
      {label}
      <input className={input} value={f[k]} onChange={set(k)} {...props} />
    </label>
  );
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-cloud bg-white p-4">
      <h2 className="text-lg font-bold text-brand-dark">{product ? t('edit_product') : t('add_product')}</h2>
      {field('sku', `${t('sku')} *`, { required: true })}
      {field('barcode', t('barcode'), { inputMode: 'numeric' })}
      {field('name', `${t('name')} *`, { required: true })}
      {field('name_bn', t('name_bn'), { lang: 'bn' })}
      <div className="grid grid-cols-2 gap-3">
        {field('sale_price', `${t('sale_price')} ৳ *`, { type: 'number', min: 0, step: '0.01', inputMode: 'decimal', required: true })}
        {field('cost', `${t('cost_price')} ৳`, { type: 'number', min: 0, step: '0.01', inputMode: 'decimal' })}
        {field('unit', t('unit'))}
        {field('low_stock_at', t('low_stock_at'), { type: 'number', min: 0, inputMode: 'numeric' })}
      </div>
      {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
      <Button type="submit" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
      <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
    </form>
  );
}
