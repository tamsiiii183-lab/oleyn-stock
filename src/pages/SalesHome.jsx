// Salesperson home: two big buttons (New sale, Record payment) and the list of my sales today.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { money, dateTime, startOfDhakaDay, localName } from '../lib/format.js';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';

export default function SalesHome() {
  const { user, signOut } = useAuth();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    supabase.from('sales_invoices')
      .select('id, invoice_no, total, due_amount, created_at, customers(name, name_bn)')
      .eq('created_by', user.id).eq('status', 'posted').gte('created_at', startOfDhakaDay())
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []));
  }, [user.id]);

  const big = 'flex min-h-[96px] items-center justify-center rounded-xl text-xl font-bold';
  const sum = (rows || []).reduce((s, r) => s + Number(r.total), 0);
  return (
    <div className="space-y-4">
      <Link to="/sell" className={`${big} bg-brand text-white`}>{t('new_sale')}</Link>
      <Link to="/pay" className={`${big} border-2 border-brand bg-white text-brand`}>{t('record_payment')}</Link>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-brand-dark">{t('my_sales_today')}</h2>
          <span className="text-2xl font-bold text-brand-dark">{money(sum, lang)}</span>
        </div>
        {rows === null && <p className="text-slate">{t('loading')}</p>}
        {rows?.length === 0 && <p className="text-slate">{t('no_sales_today')}</p>}
        <ul className="divide-y divide-cloud">
          {(rows || []).map((r) => (
            <li key={r.id}>
              <Link to={`/invoices/${r.id}`} className="flex min-h-[48px] items-center justify-between gap-2">
                <span>
                  <span className="block">{r.customers ? localName(r.customers, lang) : t('walk_in')}</span>
                  <span className="text-xs text-slate">{r.invoice_no} · {dateTime(r.created_at, lang)}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold">{money(r.total, lang)}</span>
                  {Number(r.due_amount) > 0 && <span className="text-xs text-accent-text">{t('due')} {money(r.due_amount, lang)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Button variant="secondary" onClick={signOut}>{t('logout')}</Button>
    </div>
  );
}
