// Leave for one employee: times and days taken this year per type, days left, and an Add leave form.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { num } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import Button from './Button.jsx';
import Card from './Card.jsx';

const field = 'mt-1 min-h-[44px] w-full rounded-xl border border-cloud bg-white px-2';

export default function LeavePanel({ employeeId }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ leave_type: 'casual', from_date: '', to_date: '', note: '' });
  const [error, setError] = useState('');
  const load = () => supabase.from('leave_balances').select('*').eq('employee_id', employeeId).then((r) => setRows(r.data || []));
  useEffect(() => { load(); }, [employeeId]);

  async function add(e) {
    e.preventDefault(); setError('');
    if (!f.from_date || !f.to_date || f.to_date < f.from_date) { setError(t('fill_required')); return; }
    const { error: err } = await supabase.from('leaves').insert({ employee_id: employeeId, ...f, note: f.note.trim() || null });
    if (err) { setError(errorText(t, err)); return; }
    toast(t('leave_saved')); setF({ ...f, from_date: '', to_date: '', note: '' }); load();
  }
  const order = ['casual', 'sick', 'annual'];
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-brand-dark">{t('leave')} · {new Date().getFullYear()}</h2>
      <div className="grid grid-cols-3 gap-2">
        {order.map((k) => {
          const r = rows.find((x) => x.leave_type === k) || { times_taken: 0, days_taken: 0, days_left: 0 };
          return (
            <div key={k} className="rounded-xl bg-brand-tint p-2 text-center">
              <div className="text-xs font-semibold text-slate">{t(`leave_${k}`)}</div>
              <div className={`text-xl font-bold ${r.days_left <= 0 ? 'text-accent-text' : 'text-brand-dark'}`}>{num(r.days_left, lang)}</div>
              <div className="text-[11px] text-slate">{t('leave_taken', { times: num(r.times_taken, lang), days: num(r.days_taken, lang) })}</div>
            </div>
          );
        })}
      </div>
      <form onSubmit={add} className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-sm font-semibold">
          <label>{t('leave')}<select className={field} value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })}>
            {order.map((k) => <option key={k} value={k}>{t(`leave_${k}`)}</option>)}</select></label>
          <label>{t('from')}<input className={field} type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} /></label>
          <label>{t('to')}<input className={field} type="date" value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></label>
        </div>
        <input className={field} placeholder={t('note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        {error && <p role="alert" className="text-sm font-semibold text-accent-text">⚠ {error}</p>}
        <Button type="submit" variant="secondary">{t('add_leave')}</Button>
      </form>
    </Card>
  );
}
