// Payroll (/payroll, Owner): pick a month, enter attendance, generate the salary sheet, approve it, view payslips.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, num, monthNow, monthRange } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { inputCls } from './HR.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function Payroll() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(monthNow(-1));
  const [d, setD] = useState(null);
  const [days, setDays] = useState({});
  const [slip, setSlip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const { first } = monthRange(month);
    const [emps, att, run] = await Promise.all([
      supabase.from('employees').select('id, full_name, designation, factory, monthly_salary, working_days').eq('is_active', true).order('full_name'),
      supabase.from('attendance').select('employee_id, days_present').eq('month', first),
      supabase.from('payroll_runs').select('*').eq('month', first).maybeSingle(),
    ]);
    const lines = run.data ? (await supabase.from('payroll_lines').select('*').eq('run_id', run.data.id)).data || [] : [];
    const a = Object.fromEntries((att.data || []).map((x) => [x.employee_id, x.days_present]));
    setDays(Object.fromEntries((emps.data || []).map((e) => [e.id, a[e.id] ?? e.working_days])));
    setD({ emps: emps.data || [], run: run.data, lines });
    setSlip(null);
  }
  useEffect(() => { load(); }, [month]);

  async function act(fn) {
    setBusy(true); setError('');
    const err = await fn();
    setBusy(false);
    if (err) setError(errorText(t, err)); else load();
  }
  const saveAttendance = () => act(async () => {
    const { first } = monthRange(month);
    const rows = Object.entries(days).map(([employee_id, v]) => ({ employee_id, month: first, days_present: Number(v || 0) }));
    const { error: err } = await supabase.from('attendance').upsert(rows, { onConflict: 'employee_id,month' });
    if (!err) toast(t('attendance_saved'));
    return err;
  });
  const generate = () => act(async () => (await supabase.rpc('generate_payroll', { p_month: monthRange(month).first })).error);
  const approve = () => act(async () => (await supabase.rpc('approve_payroll', { p_run_id: d.run.id })).error);

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  const name = Object.fromEntries(d.emps.map((e) => [e.id, e]));
  const sum = (k) => d.lines.reduce((s, l) => s + Number(l[k]), 0);
  const locked = d.run?.status === 'approved';
  return (
    <div className="space-y-3">
      <Card className="flex items-end justify-between gap-3">
        <label className="flex-1 text-sm font-semibold">{t('month')}<input className={inputCls} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        {d.run && <span className={`rounded-full px-3 py-1 text-sm font-semibold ${locked ? 'bg-brand text-white' : 'bg-accent text-ink'}`}>{t(locked ? 'approved' : 'draft')}</span>}
      </Card>
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      <Card className="space-y-2">
        <h2 className="font-semibold text-brand-dark">{t('attendance')}</h2>
        {d.emps.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2">
            <span className="text-sm">{e.full_name}</span>
            <span className="flex items-center gap-2 text-sm text-slate">
              <input type="number" min="0" max="31" inputMode="numeric" disabled={locked} value={days[e.id] ?? ''} aria-label={e.full_name}
                onChange={(x) => setDays({ ...days, [e.id]: x.target.value })} className="h-11 w-16 rounded-lg border border-cloud text-center" />
              {t('working_days', { n: num(e.working_days, lang) })}
            </span>
          </div>
        ))}
        {!locked && <Button variant="secondary" onClick={saveAttendance} disabled={busy}>{t('save_attendance')}</Button>}
        {!locked && <Button onClick={generate} disabled={busy}>{t('generate_sheet')}</Button>}
      </Card>
      <Card className="p-0">
        {d.lines.length === 0 ? <p className="p-4 text-slate">{t('no_sheet')}</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate"><tr><th className="p-2">{t('full_name')}</th><th className="p-2 text-right">{t('gross')}</th><th className="p-2 text-right">−</th><th className="p-2 text-right">{t('net_pay')}</th></tr></thead>
            <tbody className="divide-y divide-cloud">
              {d.lines.map((l) => (
                <tr key={l.id} onClick={() => setSlip(l)} className="cursor-pointer">
                  <td className="p-2 font-semibold text-brand-light underline">{name[l.employee_id]?.full_name}</td>
                  <td className="p-2 text-right">{money(l.gross, lang)}</td>
                  <td className="p-2 text-right text-accent-text">{money(Number(l.absence_deduction) + Number(l.advance_deduction), lang)}</td>
                  <td className="p-2 text-right font-bold">{money(l.net, lang)}</td>
                </tr>
              ))}
              <tr className="font-bold"><td className="p-2">{t('total')}</td><td className="p-2 text-right">{money(sum('gross'), lang)}</td>
                <td className="p-2 text-right">{money(sum('absence_deduction') + sum('advance_deduction'), lang)}</td><td className="p-2 text-right">{money(sum('net'), lang)}</td></tr>
            </tbody>
          </table>
        )}
      </Card>
      {d.run && !locked && d.lines.length > 0 && <Button onClick={approve} disabled={busy}>{t('approve')}</Button>}
      {slip && (
        <Card className="space-y-1">
          <h2 className="text-lg font-bold text-brand-dark">{t('payslip')} · {month}</h2>
          <p className="font-semibold">{name[slip.employee_id]?.full_name} · {name[slip.employee_id]?.designation}</p>
          <p className="text-sm text-slate">{name[slip.employee_id]?.factory}</p>
          {[['gross', slip.gross], ['absence', -slip.absence_deduction], ['advance', -slip.advance_deduction]].map(([k, v]) => (
            <div key={k} className="flex justify-between"><span>{t(k)}</span><span>{money(v, lang)}</span></div>
          ))}
          <div className="flex justify-between text-xl font-bold text-brand-dark"><span>{t('net_pay')}</span><span>{money(slip.net, lang)}</span></div>
          {slip.note && <p className="text-sm text-accent-text">{slip.note}</p>}
          <div className="print:hidden"><Button variant="secondary" onClick={() => window.print()}>{t('print')}</Button></div>
        </Card>
      )}
    </div>
  );
}
