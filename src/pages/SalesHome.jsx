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
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    supabase.from('sales_invoices')
      .select('id, invoice_no, total, due_amount, created_at, customers(name, name_bn)')
      .eq('created_by', user.id).eq('status', 'posted').gte('created_at', startOfDhakaDay())
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []));
    supabase.from('purchase_requests').select('id, request_no, status, lines, created_at').eq('created_by', user.id)
      .order('created_at', { ascending: false }).limit(5).then(({ data }) => setRequests(data || []));
  }, [user.id]);

  const big = 'flex min-h-[96px] items-center justify-center rounded-xl text-xl font-bold';
  const sum = (rows || []).reduce((s, r) => s + Number(r.total), 0);
  return (
    <div className="space-y-4">
      <Link to="/sell" className={`${big} bg-brand text-white`}>{t('new_sale')}</Link>
      <Link to="/pay" className={`${big} border-2 border-brand bg-white text-brand`}>{t('record_payment')}</Link>
      <Link to="/purchase/new" className="flex min-h-[56px] items-center justify-center rounded-xl border-2 border-brand bg-white font-semibold text-brand">📷 {t('receive_stock')}</Link>
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
      {requests.length > 0 && (
        <Card>
          <h2 className="mb-1 font-semibold text-brand-dark">{t('my_requests')}</h2>
          <ul className="divide-y divide-cloud text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <span><b>{r.request_no}</b> · {r.lines.length} {t('items')}<span className="block text-xs text-slate">{dateTime(r.created_at, lang)}</span></span>
                <span className={`self-center rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'pending' ? 'bg-accent text-ink' : r.status === 'approved' ? 'bg-brand text-white' : 'bg-cloud text-ink'}`}>{t(`status_${r.status}`)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Button variant="secondary" onClick={signOut}>{t('logout')}</Button>
    </div>
  );
}
