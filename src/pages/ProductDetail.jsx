// One product: details, current stock, and its full Stock history (who, when, why, how much, running balance).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { money, num, dateTime, localName } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';
import ProductForm from '../components/ProductForm.jsx';

const signed = (n, lang) => (n > 0 ? '+' : '−') + num(Math.abs(n), lang);

export default function ProductDetail() {
  const { id } = useParams();
  const { role } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const isOwner = role === 'owner';
  const [d, setD] = useState(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    const [p, m, names, c] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).single(),
      supabase.from('stock_movements').select('id, qty_change, reason, source_type, source_id, note, oversell_override, created_by, created_at')
        .eq('product_id', id).order('created_at').order('id'),
      supabase.rpc('staff_names'),
      isOwner ? supabase.from('product_costs').select('cost_price').eq('product_id', id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const who = Object.fromEntries((names.data || []).map((n) => [n.id, n.full_name]));
    let running = 0;
    const history = (m.data || []).map((r) => ({ ...r, who: who[r.created_by] || '—', balance: (running += Number(r.qty_change)) }));
    setD({ product: p.data, cost: c.data ? Number(c.data.cost_price) : null, history: history.reverse(), stock: running });
  }
  useEffect(() => { load(); }, [id, isOwner]);

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  if (!d.product) return <p className="text-slate">{t('no_results')}</p>;
  if (editing) {
    return <ProductForm product={{ ...d.product, barcode: d.product.barcode || '', name_bn: d.product.name_bn || '', cost: d.cost ?? '' }}
      onCancel={() => setEditing(false)} onSaved={() => { toast(t('product_saved')); setEditing(false); load(); }} />;
  }
  const p = d.product;
  const low = d.stock <= p.low_stock_at;
  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-bold text-brand-dark">{localName(p, lang)}</h1>
        <p className="text-sm text-slate">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</p>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-sm text-slate">{t('stock')}</div>
            <div className={`text-2xl font-bold ${d.stock < 0 ? 'text-accent-text' : 'text-brand-dark'}`}>
              {d.stock < 0 ? '−' : ''}{num(Math.abs(d.stock), lang)} {p.unit}
            </div>
            {low && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-ink">{t(d.stock < 0 ? 'negative_stock' : 'low_stock')}</span>}
          </div>
          <div className="text-right text-sm">
            <div>{t('price')} <b>{money(p.sale_price, lang)}</b></div>
            {isOwner && d.cost != null && <div>{t('cost_price')} <b>{money(d.cost, lang)}</b></div>}
          </div>
        </div>
      </Card>
      {isOwner && (
        <div className="grid grid-cols-2 gap-3">
          <Link to={`/adjust?product=${p.id}`} className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-semibold text-white">{t('adjust_stock')}</Link>
          <Button variant="secondary" onClick={() => setEditing(true)}>{t('edit_product')}</Button>
        </div>
      )}
      <Card className="p-0">
        <h2 className="px-4 pt-4 font-semibold text-brand-dark">{t('stock_history')}</h2>
        {d.history.length === 0 && <p className="p-4 text-slate">{t('history_empty')}</p>}
        <ul className="divide-y divide-cloud">
          {d.history.map((r) => (
            <li key={r.id} className={`px-4 py-3 ${r.oversell_override ? 'bg-accent-tint' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{t(`reason_${r.reason.replace('adjust_', '')}`)}</div>
                  <div className="text-xs text-slate">{dateTime(r.created_at, lang)} · {r.who}</div>
                  {r.oversell_override && <div className="text-xs font-semibold text-accent-ink">⚠ {t('oversell_flag')}</div>}
                  {r.note && <div className="text-sm">{r.note}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className={`font-bold ${r.qty_change < 0 ? 'text-accent-text' : 'text-brand'}`}>{signed(Number(r.qty_change), lang)}</div>
                  <div className="text-xs text-slate">{t('balance')} {num(r.balance, lang)}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
