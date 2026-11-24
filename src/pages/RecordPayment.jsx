// Record payment (/pay): customer, amount (shows current due), Cash / bKash / Bank, transaction ID. Uses safe save.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, localName } from '../lib/format.js';
import { loadDraft, saveDraft, clearDraft, isNetworkError, round2 } from '../lib/drafts.js';
import { loadCustomers } from './Customers.jsx';
import { useToast } from '../components/Toast.jsx';
import Banner from '../components/Banner.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const EMPTY = { customer_id: '', amount: '', method: 'cash', trx_ref: '', note: '' };
const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';

export default function RecordPayment() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState(() => {
    const d = loadDraft('payment', EMPTY);
    return params.get('customer') && params.get('customer') !== d.customer_id ? { ...d, customer_id: params.get('customer'), amount: '' } : d;
  });
  const [customers, setCustomers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [netFail, setNetFail] = useState(false);

  useEffect(() => { loadCustomers().then(setCustomers); }, []);
  useEffect(() => { saveDraft('payment', draft); }, [draft]);
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const customer = customers.find((c) => c.id === draft.customer_id);
  const amount = round2(draft.amount || 0);
  const needsTrx = draft.method !== 'cash';
  const blocked = !customer || !(amount > 0) || amount > (customer?.due || 0) || (needsTrx && !draft.trx_ref.trim());

  async function save() {
    setBusy(true); setError(''); setNetFail(false);
    const { data, error: err } = await supabase.rpc('record_payment', {
      p_client_ref: draft.client_ref, p_customer_id: draft.customer_id, p_amount: amount, p_method: draft.method,
      p_trx_ref: needsTrx ? draft.trx_ref.trim() : null, p_note: draft.note.trim() || null,
    });
    setBusy(false);
    if (err) { if (isNetworkError(err)) setNetFail(true); else setError(errorText(t, err)); return; }
    clearDraft('payment');
    setDraft(loadDraft('payment', EMPTY));
    toast(`${t('payment_saved')} ${t('due')} ${money(data.new_due, lang)}`);
    navigate(`/customers/${customer.id}`);
  }

  const methodBtn = (m) => (
    <button key={m} type="button" onClick={() => update({ method: m })} aria-pressed={draft.method === m}
      className={`min-h-[48px] flex-1 rounded-xl border-2 border-brand font-semibold ${draft.method === m ? 'bg-brand text-white' : 'bg-white text-brand'}`}>
      {t(m)}
    </button>
  );
  return (
    <div className="space-y-3">
      {netFail && <Banner onRetry={save} busy={busy} />}
      <Card className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">{t('record_payment')}</h1>
        <label className="block text-sm font-semibold">{t('choose_customer')} *
          <select className={input} value={draft.customer_id} onChange={(e) => update({ customer_id: e.target.value, amount: '' })}>
            <option value="">{t('choose')}</option>
            {customers.filter((c) => c.due > 0 || c.id === draft.customer_id).map((c) => (
              <option key={c.id} value={c.id}>{localName(c, lang)} · {t('due')} {money(c.due, lang)}</option>
            ))}
          </select>
        </label>
        {customer && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate">{t('current_due')}</span>
            <span className="text-2xl font-bold text-brand-dark">{money(customer.due, lang)}</span>
          </div>
        )}
        <label className="block text-sm font-semibold">{t('amount')} ৳ *
          <div className="flex gap-2">
            <input className={input} type="number" min="0" inputMode="decimal" value={draft.amount} onChange={(e) => update({ amount: e.target.value })} />
            {customer && <button type="button" onClick={() => update({ amount: String(customer.due) })}
              className="mt-1 shrink-0 rounded-xl border-2 border-brand px-3 text-sm font-semibold text-brand">{t('pay_full_due')}</button>}
          </div>
        </label>
        {customer && amount > customer.due && <p className="text-sm font-semibold text-accent-text">⚠ {t('err_PAYMENT_EXCEEDS_DUE', { due: customer.due })}</p>}
        <div className="flex gap-2">{['cash', 'bkash', 'bank'].map(methodBtn)}</div>
        {needsTrx && (
          <label className="block text-sm font-semibold">{t('trx_id')} *
            <input className={input} value={draft.trx_ref} onChange={(e) => update({ trx_ref: e.target.value })} />
            <span className="text-xs font-normal text-slate">{t('trx_needed')}</span>
          </label>
        )}
        <label className="block text-sm font-semibold">{t('note')}<input className={input} value={draft.note} onChange={(e) => update({ note: e.target.value })} /></label>
        {customer && amount > 0 && amount <= customer.due && (
          <div className="flex justify-between text-sm"><span>{t('due_after')}</span><b>{money(round2(customer.due - amount), lang)}</b></div>
        )}
      </Card>
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      <Button onClick={save} disabled={busy || blocked}>{busy ? t('saving') : t('record_payment')}</Button>
    </div>
  );
}
