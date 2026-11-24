// Product list with search. Both roles see price and stock; only the Owner sees cost and margin and can add products.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { money, num, localName } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import ProductForm from '../components/ProductForm.jsx';

export async function loadProducts(isOwner) {
  const [p, s, c] = await Promise.all([
    supabase.from('products').select('id, sku, barcode, name, name_bn, unit, sale_price, low_stock_at').eq('is_active', true).order('name'),
    supabase.from('product_stock').select('product_id, current_stock, is_low, is_negative'),
    // Only the Owner asks for costs; the server would return nothing to a Salesperson anyway.
    isOwner ? supabase.from('product_costs').select('product_id, cost_price') : Promise.resolve({ data: [] }),
  ]);
  const stock = Object.fromEntries((s.data || []).map((x) => [x.product_id, x]));
  const cost = Object.fromEntries((c.data || []).map((x) => [x.product_id, Number(x.cost_price)]));
  return (p.data || []).map((x) => ({ ...x, stock: stock[x.id], cost: cost[x.id] }));
}

export default function Products() {
  const { role } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const isOwner = role === 'owner';
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { loadProducts(isOwner).then(setRows); }, [isOwner]);

  const term = q.trim().toLowerCase();
  const list = (rows || []).filter((r) => !term || [r.name, r.name_bn, r.sku, r.barcode].some((v) => (v || '').toLowerCase().includes(term)));

  if (adding) {
    return <ProductForm onCancel={() => setAdding(false)}
      onSaved={(id) => { toast(t('product_saved')); navigate(`/products/${id}`); }} />;
  }
  return (
    <div className="space-y-3">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
        className="min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light" />
      <div className="flex gap-2">
        {isOwner && <Button variant="secondary" onClick={() => setAdding(true)}>+ {t('add_product')}</Button>}
        <Link to="/godowns" className="flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-brand bg-white font-semibold text-brand">🏬 {t('stock_by_location')}</Link>
      </div>
      {rows === null && <p className="text-slate">{t('loading')}</p>}
      {rows && list.length === 0 && <p className="text-slate">{t('no_results')}</p>}
      <ul className="divide-y divide-cloud rounded-xl border border-cloud bg-white">
        {list.map((r) => {
          const st = Number(r.stock?.current_stock || 0);
          const margin = r.cost != null && Number(r.sale_price) > 0 ? ((Number(r.sale_price) - r.cost) / Number(r.sale_price)) * 100 : null;
          return (
            <li key={r.id}>
              <Link to={`/products/${r.id}`} className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{localName(r, lang)}</span>
                  <span className="text-xs text-slate">{r.sku} · {t('price')} {money(r.sale_price, lang)}
                    {isOwner && r.cost != null && ` · ${t('cost_price')} ${money(r.cost, lang)} · ${t('margin')} ${num(margin, lang)}%`}
                  </span>
                </span>
                <span className={`shrink-0 text-right font-bold ${st < 0 ? 'text-accent-text' : 'text-brand-dark'}`}>
                  {(r.stock?.is_low || st < 0) && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-label={t('low_stock')} />}
                  {st < 0 ? '−' : ''}{num(Math.abs(st), lang)}
                  <span className="block text-xs font-normal text-slate">{r.unit}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
