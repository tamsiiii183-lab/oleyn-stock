// One employee (/hr/:id, Owner): details, Give raise (with reason, kept in salary history) and salary advances.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, dateTime } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { inputCls } from './HR.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function Employee() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [raise, setRaise] = useState({ amount: '', reason: '' });
  const [adv, setAdv] = useState({ amount: '', note: '' });
  const [error, setError] = useState('');

  async function load() {
    const [e, r, a] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).maybeSingle(),
      supabase.from('salary_revisions').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('salary_advances').select('*').eq('employee_id', id).order('given_on', { ascending: false }),
    ]);
    setD({ emp: e.data, raises: r.data || [], advances: a.data || [] });
  }
  useEffect(() => { load(); }, [id]);

  async function giveRaise(e) {
    e.preventDefault(); setError('');
    const { error: err } = await supabase.rpc('give_raise', { p_employee_id: id, p_new_salary: Number(raise.amount), p_reason: raise.reason });
    if (err) { setError(errorText(t, err)); return; }
    toast(t('raise_saved')); setRaise({ amount: '', reason: '' }); load();
  }
  async function giveAdvance(e) {
    e.preventDefault(); setError('');
    if (!(Number(adv.amount) > 0)) { setError(t('err_INVALID_AMOUNT')); return; }
    const { error: err } = await supabase.from('salary_advances').insert({
      employee_id: id, amount: Number(adv.amount), note: adv.note.trim() || null, given_on: new Date().toISOString().slice(0, 10),
    });
    if (err) { setError(errorText(t, err)); return; }
    toast(t('advance_saved')); setAdv({ amount: '', note: '' }); load();
  }

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  if (!d.emp) return <Card><p className="text-slate">{t('not_found')}</p></Card>;
  const e = d.emp;
  return (
    <div className="space-y-3">
      <Card>
        <h1 className="text-xl font-bold text-brand-dark">{e.full_name}</h1>
        <p className="text-sm text-slate">{[e.designation, e.factory, e.phone].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 text-sm text-slate">{t('monthly_salary')}</div>
        <div className="text-2xl font-bold text-brand-dark">{money(e.monthly_salary, lang)}</div>
      </Card>
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      <Card>
        <form onSubmit={giveRaise} className="space-y-2">
          <h2 className="font-semibold text-brand-dark">{t('give_raise')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold">{t('new_salary')} ৳<input className={inputCls} type="number" min="1" inputMode="decimal" value={raise.amount} onChange={(x) => setRaise({ ...raise, amount: x.target.value })} required /></label>
            <label className="text-sm font-semibold">{t('reason')}<input className={inputCls} value={raise.reason} onChange={(x) => setRaise({ ...raise, reason: x.target.value })} required /></label>
          </div>
          <Button type="submit">{t('give_raise')}</Button>
        </form>
        <h3 className="mt-4 text-sm font-semibold text-slate">{t('salary_history')}</h3>
        <ul className="divide-y divide-cloud text-sm">
          {d.raises.map((r) => (
            <li key={r.id} className="py-2">
              <b>{money(r.old_salary, lang)} → {money(r.new_salary, lang)}</b> · {r.effective_month.slice(0, 7)}
              <div className="text-slate">{r.reason} · {dateTime(r.created_at, lang)}</div>
            </li>
          ))}
          {d.raises.length === 0 && <li className="py-2 text-slate">{t('no_results')}</li>}
        </ul>
      </Card>
      <Card>
        <form onSubmit={giveAdvance} className="space-y-2">
          <h2 className="font-semibold text-brand-dark">{t('give_advance')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold">{t('amount')} ৳<input className={inputCls} type="number" min="1" inputMode="decimal" value={adv.amount} onChange={(x) => setAdv({ ...adv, amount: x.target.value })} required /></label>
            <label className="text-sm font-semibold">{t('note')}<input className={inputCls} value={adv.note} onChange={(x) => setAdv({ ...adv, note: x.target.value })} /></label>
          </div>
          <Button type="submit" variant="secondary">{t('give_advance')}</Button>
        </form>
        <h3 className="mt-4 text-sm font-semibold text-slate">{t('advances')}</h3>
        <ul className="divide-y divide-cloud text-sm">
          {d.advances.map((a) => <li key={a.id} className="flex justify-between py-2"><span>{a.given_on}{a.note ? ` · ${a.note}` : ''}</span><b>{money(a.amount, lang)}</b></li>)}
          {d.advances.length === 0 && <li className="py-2 text-slate">{t('no_results')}</li>}
        </ul>
      </Card>
    </div>
  );
}
