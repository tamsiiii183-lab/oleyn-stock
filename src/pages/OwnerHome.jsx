// Owner home: today's sales and profit, total market due, overdue customers, stock alerts, Coming soon tiles.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { money, num, startOfDhakaDay, localName } from '../lib/format.js';
import Card from '../components/Card.jsx';

function Stat({ label, value, to, warn }) {
  return (
    <Link to={to} className="block rounded-xl border border-cloud bg-white p-3">
      <div className="text-sm text-slate">{label}</div>
      <div className={`text-2xl font-bold ${warn ? 'text-accent-text' : 'text-brand-dark'}`}>{value}</div>
    </Link>
  );
}

export default function OwnerHome() {
  const { t, lang } = useI18n();
  const [d, setD] = useState(null);

  useEffect(() => {
    const since = startOfDhakaDay();
    Promise.all([
      supabase.from('sales_invoices').select('total').eq('status', 'posted').gte('created_at', since),
      supabase.from('product_profit').select('profit').gte('sold_at', since),
      supabase.from('customer_balances').select('due, is_overdue'),
      supabase.from('product_stock').select('product_id, current_stock, is_low, is_negative').or('is_low.eq.true,is_negative.eq.true'),
      supabase.from('products').select('id, name, name_bn, unit'),
      supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]).then(([sales, profit, dues, stock, products, reqs]) => {
      const byId = Object.fromEntries((products.data || []).map((p) => [p.id, p]));
      setD({
        sales: (sales.data || []).reduce((s, r) => s + Number(r.total), 0),
        profit: (profit.data || []).reduce((s, r) => s + Number(r.profit), 0),
        due: (dues.data || []).reduce((s, r) => s + Math.max(Number(r.due), 0), 0),
        overdue: (dues.data || []).filter((r) => r.is_overdue).length,
        pending: reqs.count || 0,
        alerts: (stock.data || []).map((s) => ({ ...s, product: byId[s.product_id] }))
          .sort((a, b) => Number(a.current_stock) - Number(b.current_stock)),
      });
    });
  }, []);

  if (!d) return <p className="mt-6 text-center text-slate">{t('loading')}</p>;
  return (
    <div className="space-y-4">
      {d.pending > 0 && (
        <Link to="/purchase/new" className="block rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">📥 {t('pending_receipts', { n: num(d.pending, lang) })} ›</Link>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('todays_sales')} value={money(d.sales, lang)} to="/" />
        <Stat label={t('todays_profit')} value={money(d.profit, lang)} to="/" />
        <Stat label={t('market_due')} value={money(d.due, lang)} to="/customers" />
        <Stat label={t('overdue_customers')} value={num(d.overdue, lang)} to="/customers" warn={d.overdue > 0} />
      </div>
      <Card>
        <h2 className="mb-2 font-semibold text-brand-dark">{t('stock_alerts')}</h2>
        {d.alerts.length === 0 && <p className="text-slate">{t('all_good')}</p>}
        <ul className="divide-y divide-cloud">
          {d.alerts.map((a) => (
            <li key={a.product_id}>
              <Link to={`/products/${a.product_id}`} className="flex min-h-[48px] items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
                  {localName(a.product, lang)}
                </span>
                <span className={`font-semibold ${a.is_negative ? 'text-accent-text' : 'text-ink'}`}>
                  {num(a.current_stock, lang)} {a.product?.unit} · {t(a.is_negative ? 'negative_stock' : 'low_stock')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <h2 className="font-semibold text-brand-dark">{t('modules')}</h2>
      <div className="grid grid-cols-3 gap-3">
        {[['/products', 'inventory', '📦'], ['/hr', 'hr', '👥'], ['/payroll', 'payroll', '💵'], ['/accounts', 'accounts', '📒'], ['/production', 'production', '🏭'], ['/godowns', 'godowns', '🏬'], ['/supervision', 'supervision', '👁']].map(([to, key, icon]) => (
          <Link key={key} to={to} className="flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-cloud bg-white p-2 text-center text-sm font-semibold">
            <span className="text-2xl" aria-hidden="true">{icon}</span>{t(key)}
          </Link>
        ))}
      </div>
    </div>
  );
}
