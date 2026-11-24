// Increment expected: ticks "Increment due" when 12+ months have passed since the last raise (or joining) and shows
// the expected new salary (+5%), with one tap to apply it through give_raise (kept in salary history).
import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money } from '../lib/format.js';
import Button from './Button.jsx';
import Card from './Card.jsx';

// When the next increment is expected and whether it is due today.
export function incrementInfo(emp, raises = []) {
  const last = raises.map((r) => r.effective_month).sort().pop() || emp.joined_on;
  if (!last) return { due: false, next: null, expected: Math.round(emp.monthly_salary * 1.05) };
  const next = new Date(last);
  next.setFullYear(next.getFullYear() + 1);
  return { due: next <= new Date(), next: next.toISOString().slice(0, 10), expected: Math.round((emp.monthly_salary * 1.05) / 10) * 10 };
}

export default function IncrementCard({ emp, raises, onApplied }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const info = incrementInfo(emp, raises);
  async function apply() {
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('give_raise', { p_employee_id: emp.id, p_new_salary: info.expected, p_reason: 'Annual increment (5%)' });
    setBusy(false);
    if (err) setError(errorText(t, err)); else onApplied();
  }
  return (
    <Card className={`space-y-2 ${info.due ? 'border-2 border-accent' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${info.due ? 'bg-accent text-ink' : 'border border-cloud text-slate'}`}>{info.due ? '✓' : ''}</span>
        <h2 className="font-semibold text-brand-dark">{info.due ? t('increment_due') : t('next_increment', { date: info.next || '—' })}</h2>
      </div>
      <p className="text-sm">{t('increment_expected', { old: money(emp.monthly_salary, lang), new: money(info.expected, lang) })}</p>
      {error && <p role="alert" className="text-sm font-semibold text-accent-text">⚠ {error}</p>}
      {info.due && <Button onClick={apply} disabled={busy}>{busy ? t('saving') : t('apply_increment')}</Button>}
    </Card>
  );
}
