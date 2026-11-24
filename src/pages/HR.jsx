// HR & staff (/hr, Owner): employees grouped by factory with their salary, and an Add employee form.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';
import { incrementInfo } from '../components/IncrementCard.jsx';
import { num } from '../lib/format.js';

export const inputCls = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';

function AddEmployee({ onDone }) {
  const { t } = useI18n();
  const [f, setF] = useState({ full_name: '', designation: '', factory: 'Gazipur Factory 1', phone: '', monthly_salary: '', working_days: '26' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!f.full_name.trim() || !(Number(f.monthly_salary) > 0)) { setError(t('fill_required')); return; }
    const { error: err } = await supabase.from('employees').insert({
      full_name: f.full_name.trim(), designation: f.designation.trim() || null, factory: f.factory.trim() || null,
      phone: f.phone.trim() || null, monthly_salary: Number(f.monthly_salary), working_days: Number(f.working_days || 26),
      joined_on: new Date().toISOString().slice(0, 10),
    });
    if (err) setError(errorText(t, err)); else onDone(true);
  }
  return (
    <Card>
      <form onSubmit={save} className="space-y-3">
        <h2 className="text-lg font-bold text-brand-dark">{t('add_employee')}</h2>
        <label className="block text-sm font-semibold">{t('full_name')} *<input className={inputCls} value={f.full_name} onChange={set('full_name')} required /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">{t('designation')}<input className={inputCls} value={f.designation} onChange={set('designation')} /></label>
          <label className="text-sm font-semibold">{t('factory')}<input className={inputCls} value={f.factory} onChange={set('factory')} /></label>
          <label className="text-sm font-semibold">{t('monthly_salary')} ৳ *<input className={inputCls} type="number" min="1" inputMode="decimal" value={f.monthly_salary} onChange={set('monthly_salary')} required /></label>
          <label className="text-sm font-semibold">{t('phone')}<input className={inputCls} type="tel" value={f.phone} onChange={set('phone')} /></label>
        </div>
        {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
        <Button type="submit">{t('save')}</Button>
        <Button type="button" variant="secondary" onClick={() => onDone(false)}>{t('cancel')}</Button>
      </form>
    </Card>
  );
}

export default function HR() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = async () => {
    const [e, r, l] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('factory').order('full_name'),
      supabase.from('salary_revisions').select('employee_id, effective_month'),
      supabase.from('leave_balances').select('employee_id, days_left'),
    ]);
    setRows((e.data || []).map((x) => ({
      ...x,
      inc: incrementInfo(x, (r.data || []).filter((y) => y.employee_id === x.id)),
      leaveLeft: (l.data || []).filter((y) => y.employee_id === x.id).reduce((s, y) => s + Number(y.days_left), 0),
    })));
  };
  useEffect(() => { load(); }, []);

  if (adding) return <AddEmployee onDone={(saved) => { setAdding(false); if (saved) { toast(t('employee_saved')); load(); } }} />;
  const byFactory = (rows || []).reduce((g, e) => ({ ...g, [e.factory || '—']: [...(g[e.factory || '—'] || []), e] }), {});
  const total = (rows || []).reduce((s, e) => s + Number(e.monthly_salary), 0);
  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between">
        <span><span className="block text-sm text-slate">{t('employees')}</span><b className="text-2xl text-brand-dark">{rows ? rows.length : '…'}</b></span>
        <span className="text-right"><span className="block text-sm text-slate">{t('monthly_salary')}</span><b className="text-2xl text-brand-dark">{money(total, lang)}</b></span>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/payroll" className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-semibold text-white">{t('payroll')}</Link>
        <Button variant="secondary" onClick={() => setAdding(true)}>+ {t('add_employee')}</Button>
      </div>
      {rows === null && <p className="text-slate">{t('loading')}</p>}
      {Object.entries(byFactory).map(([factory, list]) => (
        <Card key={factory} className="p-0">
          <h2 className="px-4 pt-3 text-sm font-semibold text-slate">{factory}</h2>
          <ul className="divide-y divide-cloud">
            {list.map((e) => (
              <li key={e.id}>
                <Link to={`/hr/${e.id}`} className="flex min-h-[56px] items-center justify-between px-4">
                  <span>
                    <span className="block font-semibold">{e.full_name}</span>
                    <span className="text-xs text-slate">{e.designation} · {t(e.employee_type === 'worker' ? 'worker' : 'staff')} · {t('leave_left_short')} {num(e.leaveLeft, lang)}</span>
                    {e.inc.due && <span className="mt-0.5 block w-fit rounded-full bg-accent px-2 text-xs font-semibold text-ink">✓ {t('increment_due')}</span>}
                  </span>
                  <span className="font-semibold">{money(e.monthly_salary, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
