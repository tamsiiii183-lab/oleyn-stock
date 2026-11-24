// Accounts lite (/accounts, Owner): cash in/out, receivables and a simple profit & loss for a month, all calculated
// from data the app already records (sales, payments, purchases, payroll). No separate bookkeeping needed yet.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { money, localName, monthNow, monthRange } from '../lib/format.js';
import { loadCustomers } from './Customers.jsx';
import { inputCls } from './HR.jsx';
import Card from '../components/Card.jsx';

const add = (rows, k, sign = 1) => (rows || []).reduce((s, r) => s + sign * Number(r[k] || 0), 0);

export default function Accounts() {
  const { t, lang } = useI18n();
  const [month, setMonth] = useState(monthNow(0));
  const [d, setD] = useState(null);

  useEffect(() => {
    const { first, start, end, nextFirst } = monthRange(month);
    setD(null);
    Promise.all([
      supabase.from('sales_invoices').select('paid_now').eq('status', 'posted').gte('created_at', start).lt('created_at', end),
      supabase.from('customer_ledger').select('amount').eq('entry_type', 'payment').gte('created_at', start).lt('created_at', end),
      supabase.from('purchases').select('total_cost').gte('created_at', start).lt('created_at', end),
      supabase.from('payroll_runs').select('id, status, payroll_lines(gross, net)').eq('month', first).maybeSingle(),
      supabase.from('salary_advances').select('amount').gte('given_on', first).lt('given_on', nextFirst),
      supabase.from('product_profit').select('revenue, cost').gte('sold_at', start).lt('sold_at', end),
      loadCustomers(),
    ]).then(([sales, pays, purch, run, adv, pl, customers]) => {
      const approved = run.data?.status === 'approved' ? run.data.payroll_lines || [] : [];
      const cashIn = { sales_cash: add(sales.data, 'paid_now'), payments_in: add(pays.data, 'amount', -1) };
      const cashOut = { purchases_out: add(purch.data, 'total_cost'), salaries_out: add(approved, 'net'), advances_out: add(adv.data, 'amount') };
      const revenue = add(pl.data, 'revenue');
      const cogs = add(pl.data, 'cost');
      setD({
        cashIn, cashOut, revenue, cogs, payroll: add(approved, 'gross'),
        owing: customers.filter((c) => c.due > 0), receivable: customers.reduce((s, c) => s + Math.max(c.due, 0), 0),
      });
    });
  }, [month]);

  const row = (label, v, strong) => (
    <div className={`flex justify-between ${strong ? 'border-t border-cloud pt-1 text-lg font-bold text-brand-dark' : ''}`}>
      <span>{label}</span><span className={v < 0 ? 'text-accent-text' : ''}>{money(v, lang)}</span>
    </div>
  );
  const sumObj = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  return (
    <div className="space-y-3">
      <Card><label className="text-sm font-semibold">{t('month')}<input className={inputCls} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></Card>
      {!d ? <p className="text-slate">{t('loading')}</p> : (
        <>
          <Card className="space-y-1">
            <h2 className="font-semibold text-brand-dark">{t('cash_in')}</h2>
            {Object.entries(d.cashIn).map(([k, v]) => row(t(k), v))}
            <h2 className="pt-2 font-semibold text-brand-dark">{t('cash_out')}</h2>
            {Object.entries(d.cashOut).map(([k, v]) => row(t(k), -v))}
            {row(t('net_cash'), sumObj(d.cashIn) - sumObj(d.cashOut), true)}
          </Card>
          <Card className="space-y-1">
            <h2 className="font-semibold text-brand-dark">{t('profit_loss')}</h2>
            {row(t('revenue'), d.revenue)}
            {row(t('cogs'), -d.cogs)}
            {row(t('gross_profit'), d.revenue - d.cogs, true)}
            {row(t('payroll_expense'), -d.payroll)}
            {row(t('net_profit'), d.revenue - d.cogs - d.payroll, true)}
          </Card>
          <Card className="space-y-1">
            {row(t('receivables'), d.receivable, true)}
            {d.owing.slice(0, 5).map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="flex justify-between text-sm"><span className="text-brand-light underline">{localName(c, lang)}</span><span>{money(c.due, lang)}</span></Link>
            ))}
            {row(t('payables'), 0, true)}
            <p className="text-xs text-slate">{t('payables_note')}</p>
          </Card>
        </>
      )}
    </div>
  );
}
