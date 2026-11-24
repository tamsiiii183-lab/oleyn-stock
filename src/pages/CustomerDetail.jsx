// One customer (/customers/:id): due in large numbers and the ledger like a bank statement with a running balance.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { money, dateTime, localName } from '../lib/format.js';
import Card from '../components/Card.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('customer_balances').select('due, is_overdue').eq('customer_id', id).maybeSingle(),
      supabase.from('customer_ledger').select('id, amount, entry_type, invoice_id, method, trx_ref, note, created_by, created_at')
        .eq('customer_id', id).order('created_at').order('id'),
      supabase.rpc('staff_names'),
    ]).then(([c, b, l, n]) => {
      const who = Object.fromEntries((n.data || []).map((x) => [x.id, x.full_name]));
      let running = 0;
      const ledger = (l.data || []).map((r) => ({ ...r, who: who[r.created_by] || '—', balance: (running += Number(r.amount)) }));
      setD({ customer: c.data, due: Number(b.data?.due || 0), overdue: b.data?.is_overdue, ledger: ledger.reverse() });
    });
  }, [id]);

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  if (!d.customer) return <Card><p className="text-slate">{t('not_found')}</p></Card>;
  const c = d.customer;
  return (
    <div className="space-y-3">
      <Card>
        <h1 className="text-xl font-bold text-brand-dark">{localName(c, lang)}</h1>
        <p className="text-sm text-slate">{[c.area, c.phone, `${t('credit_days')}: ${c.credit_days}`].filter(Boolean).join(' · ')}</p>
        <div className="mt-3 text-sm text-slate">{t('due')}</div>
        <div className="flex items-center gap-2">
          <span className={`text-3xl font-bold ${d.overdue ? 'text-accent-text' : 'text-brand-dark'}`}>{money(d.due, lang)}</span>
          {d.overdue && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-ink">{t('overdue')}</span>}
        </div>
      </Card>
      <Link to={`/pay?customer=${c.id}`} className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-semibold text-white">{t('record_payment')}</Link>
      <Card className="p-0">
        <h2 className="px-4 pt-4 font-semibold text-brand-dark">{t('ledger')}</h2>
        {d.ledger.length === 0 && <p className="p-4 text-slate">{t('no_results')}</p>}
        <ul className="divide-y divide-cloud">
          {d.ledger.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold">{t(`entry_${r.entry_type}`)}{r.method ? ` · ${t(r.method)}` : ''}</div>
                <div className="text-xs text-slate">{dateTime(r.created_at, lang)} · {t('by')} {r.who}</div>
                {r.trx_ref && <div className="text-xs">{t('trx_id')}: {r.trx_ref}</div>}
                {r.invoice_id ? <Link to={`/invoices/${r.invoice_id}`} className="text-sm text-brand-light underline">{r.note || t('invoice')}</Link>
                  : r.note && <div className="text-sm">{r.note}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className={`font-bold ${Number(r.amount) < 0 ? 'text-brand' : 'text-accent-text'}`}>
                  {Number(r.amount) > 0 ? '+' : ''}{money(r.amount, lang)}
                </div>
                <div className="text-xs text-slate">{t('balance')} {money(r.balance, lang)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
