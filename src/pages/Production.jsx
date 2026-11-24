// Production lite (/production, Owner): each factory product's recipe (bill of materials), how many can be made from
// current stock, and "Make" which uses up the components and adds finished stock through the stock ledger.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, num, dateTime, localName } from '../lib/format.js';
import { newRef } from '../lib/drafts.js';
import { loadProducts } from './Products.jsx';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function Production() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [qty, setQty] = useState({});
  const [ref, setRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [products, boms, orders] = await Promise.all([
      loadProducts(true),
      supabase.from('boms').select('product_id, component_id, qty_per_unit'),
      supabase.from('production_orders').select('id, order_no, product_id, qty, unit_cost, note, created_at').order('created_at', { ascending: false }).limit(5),
    ]);
    const byId = Object.fromEntries(products.map((p) => [p.id, p]));
    const recipes = {};
    (boms.data || []).forEach((b) => { (recipes[b.product_id] ||= []).push({ ...b, component: byId[b.component_id] }); });
    setD({ byId, recipes, orders: orders.data || [] });
  }
  useEffect(() => { load(); }, []);

  async function make(productId) {
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc('complete_production', { p_client_ref: ref, p_product_id: productId, p_qty: Number(qty[productId] || 0) });
    setBusy(false);
    if (err) { const p = d.byId[productId]; setError(errorText(t, err, { productName: localName(Object.values(d.byId).find((x) => x.sku === String(err.message).split(':')[1]) || p, lang) })); return; }
    toast(`${data.order_no} · ${t('production_saved')}`);
    setRef(newRef());
    setQty({ ...qty, [productId]: '' });
    load();
  }

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      {Object.entries(d.recipes).map(([pid, lines]) => {
        const p = d.byId[pid];
        if (!p) return null;
        const canMake = Math.max(0, Math.min(...lines.map((l) => Math.floor(Number(l.component?.stock?.current_stock || 0) / Number(l.qty_per_unit)))));
        return (
          <Card key={pid} className="space-y-3">
            <div className="flex items-start justify-between">
              <Link to={`/products/${pid}`} className="text-lg font-bold text-brand-dark underline">{localName(p, lang)}</Link>
              <span className="text-right text-sm"><b className="block text-xl text-brand-dark">{num(p.stock?.current_stock || 0, lang)}</b>{t('in_stock')}</span>
            </div>
            <div className="text-sm text-slate">{t('per_unit_cost')}: <b className="text-ink">{money(p.cost || 0, lang)}</b> · {t('price')}: <b className="text-ink">{money(p.sale_price, lang)}</b></div>
            <div>
              <h3 className="text-sm font-semibold">{t('recipe')}</h3>
              <ul className="divide-y divide-cloud text-sm">
                {lines.map((l) => (
                  <li key={l.component_id} className="flex justify-between py-1.5">
                    <span>{num(l.qty_per_unit, lang)} × {localName(l.component, lang)}</span>
                    <span className="text-slate">{num(l.component?.stock?.current_stock || 0, lang)} {t('in_stock')}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="font-semibold text-brand">{t('can_make', { n: num(canMake, lang) })}</p>
            <div className="flex gap-2">
              <input type="number" min="1" inputMode="numeric" placeholder={t('quantity')} aria-label={t('quantity')} value={qty[pid] || ''}
                onChange={(e) => setQty({ ...qty, [pid]: e.target.value })} className="min-h-[48px] w-28 rounded-xl border border-cloud px-3" />
              <Button onClick={() => make(pid)} disabled={busy || !(Number(qty[pid]) > 0)}>{busy ? t('saving') : t('make')}</Button>
            </div>
          </Card>
        );
      })}
      <Card className="p-0">
        <h2 className="px-4 pt-4 font-semibold text-brand-dark">{t('recent_runs')}</h2>
        <ul className="divide-y divide-cloud">
          {d.orders.map((o) => (
            <li key={o.id} className="flex justify-between px-4 py-3 text-sm">
              <span><b>{o.order_no}</b> · {localName(d.byId[o.product_id], lang)}<span className="block text-xs text-slate">{dateTime(o.created_at, lang)}{o.note ? ` · ${o.note}` : ''}</span></span>
              <span className="font-semibold">+{num(o.qty, lang)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
