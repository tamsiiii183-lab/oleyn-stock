// Customers list sorted by due, with an orange Overdue badge, search, and an Add customer form (both roles).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, localName } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';

// Customers with their current due and overdue flag, highest due first.
export async function loadCustomers() {
  const [c, b] = await Promise.all([
    supabase.from('customers').select('id, name, name_bn, phone, area, credit_days').order('name'),
    supabase.from('customer_balances').select('customer_id, due, is_overdue, last_payment_at'),
  ]);
  const bal = Object.fromEntries((b.data || []).map((x) => [x.customer_id, x]));
  return (c.data || []).map((x) => ({ ...x, due: Number(bal[x.id]?.due || 0), is_overdue: Boolean(bal[x.id]?.is_overdue) }))
    .sort((a, z) => z.due - a.due);
}

const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';

function AddCustomer({ onDone }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: '', name_bn: '', phone: '', area: '', credit_days: '30' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) { setError(t('fill_required')); return; }
    const { error: err } = await supabase.from('customers').insert({
      name: f.name.trim(), name_bn: f.name_bn.trim() || null, phone: f.phone.trim() || null,
      area: f.area.trim() || null, credit_days: Number(f.credit_days || 30),
    });
    if (err) setError(errorText(t, err)); else onDone(true);
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-cloud bg-white p-4">
      <h2 className="text-lg font-bold text-brand-dark">{t('add_customer')}</h2>
      <label className="block text-sm font-semibold">{t('customer_name')} *<input className={input} value={f.name} onChange={set('name')} required /></label>
      <label className="block text-sm font-semibold">{t('name_bn')}<input className={input} value={f.name_bn} onChange={set('name_bn')} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">{t('phone')}<input className={input} type="tel" value={f.phone} onChange={set('phone')} /></label>
        <label className="text-sm font-semibold">{t('area')}<input className={input} value={f.area} onChange={set('area')} /></label>
      </div>
      <label className="block text-sm font-semibold">{t('credit_days')}<input className={input} type="number" min="0" value={f.credit_days} onChange={set('credit_days')} /></label>
      {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
      <Button type="submit">{t('save')}</Button>
      <Button type="button" variant="secondary" onClick={() => onDone(false)}>{t('cancel')}</Button>
    </form>
  );
}

export default function Customers() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => { loadCustomers().then(setRows); }, []);

  if (adding) {
    return <AddCustomer onDone={(saved) => { setAdding(false); if (saved) { toast(t('customer_saved')); loadCustomers().then(setRows); } }} />;
  }
  const term = q.trim().toLowerCase();
  const list = (rows || []).filter((r) => !term || [r.name, r.name_bn, r.phone, r.area].some((v) => (v || '').toLowerCase().includes(term)));
  return (
    <div className="space-y-3">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
        className="min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light" />
      <Button variant="secondary" onClick={() => setAdding(true)}>+ {t('add_customer')}</Button>
      {rows === null && <p className="text-slate">{t('loading')}</p>}
      {rows && list.length === 0 && <p className="text-slate">{t('no_results')}</p>}
      <ul className="divide-y divide-cloud rounded-xl border border-cloud bg-white">
        {list.map((c) => (
          <li key={c.id}>
            <Link to={`/customers/${c.id}`} className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{localName(c, lang)}</span>
                <span className="text-xs text-slate">{[c.area, c.phone].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block font-bold ${c.due > 0 ? 'text-brand-dark' : 'text-slate'}`}>{money(c.due, lang)}</span>
                {c.is_overdue && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-ink">{t('overdue')}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
