// Supervision (/supervision, Owner): a timeline of who did what and when, recorded by the database. Filter by person,
// area and period; edits are highlighted and show each changed field (old → new).
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useI18n } from '../lib/i18n.js';
import { money, num, dateTime } from '../lib/format.js';
import { areaOf, changes, describe } from '../lib/activity.js';
import Card from '../components/Card.jsx';

const sel = 'min-h-[44px] w-full rounded-xl border border-cloud bg-white px-2 text-sm';
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function Supervision() {
  const { t, lang } = useI18n();
  const [f, setF] = useState({ actor: '', area: '', days: '7' });
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setD(null);
    const since = new Date(Date.now() - (Number(f.days) - (f.days === '1' ? 0 : 0)) * 86400e3);
    if (f.days === '1') { since.setTime(Date.now() + 6 * 3600e3); since.setUTCHours(0, 0, 0, 0); since.setTime(since.getTime() - 6 * 3600e3); }
    let q = supabase.from('audit_log').select('*').gte('at', since.toISOString()).order('at', { ascending: false }).limit(300);
    if (f.actor) q = q.eq('actor', f.actor);
    Promise.all([
      q,
      supabase.from('profiles').select('id, full_name, role'),
      supabase.from('products').select('id, name'),
      supabase.from('customers').select('id, name'),
      supabase.from('employees').select('id, full_name'),
    ]).then(([log, people, prods, custs, emps]) => {
      const map = (r, k) => Object.fromEntries((r.data || []).map((x) => [x.id, x[k]]));
      const rows = (log.data || [])
        .filter((r) => !(r.table_name === 'customer_ledger' && r.new_data?.entry_type !== 'payment'))
        .filter((r) => !f.area || areaOf(r) === f.area);
      setD({ rows, people: people.data || [], names: { product: map(prods, 'name'), customer: map(custs, 'name'), employee: map(emps, 'full_name') } });
    });
  }, [f]);

  const m = (v) => money(v, lang);
  const person = (id) => d?.people.find((p) => p.id === id);
  const counts = (d?.rows || []).reduce((acc, r) => ({ ...acc, [r.actor || 'system']: (acc[r.actor || 'system'] || 0) + 1 }), {});
  let lastDay = '';
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <h1 className="text-xl font-bold text-brand-dark">{t('supervision')}</h1>
        <div className="grid grid-cols-3 gap-2">
          <select className={sel} value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} aria-label={t('who')}>
            <option value="">{t('all_people')}</option>
            {(d?.people || []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select className={sel} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} aria-label={t('all_areas')}>
            <option value="">{t('all_areas')}</option>
            {['sales', 'money', 'stock', 'customers', 'hr'].map((a) => <option key={a} value={a}>{t(`area_${a}`)}</option>)}
          </select>
          <select className={sel} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} aria-label={t('month')}>
            <option value="1">{t('period_today')}</option><option value="7">{t('period_7')}</option><option value="30">{t('period_30')}</option>
          </select>
        </div>
        <p className="text-xs text-slate">🔒 {t('sup_note')}</p>
        {d && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts).map(([id, n]) => (
              <span key={id} className="rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">
                {person(id)?.full_name || t('system')}: {t('actions_count', { n: num(n, lang) })}
              </span>
            ))}
          </div>
        )}
      </Card>
      {!d && <p className="text-slate">{t('loading')}</p>}
      {d && d.rows.length === 0 && <Card><p className="text-slate">{t('no_results')}</p></Card>}
      <ul className="space-y-2">
        {(d?.rows || []).map((r) => {
          const day = dateTime(r.at, lang).split(',')[0];
          const header = day !== lastDay ? (lastDay = day) : null;
          const diff = changes(r);
          const who = person(r.actor);
          return (
            <li key={r.id}>
              {header && <h2 className="mt-3 text-sm font-semibold text-slate">{header}</h2>}
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)}
                className={`w-full rounded-xl border p-3 text-left ${r.action === 'update' ? 'border-accent bg-accent-tint' : 'border-cloud bg-white'}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{describe(r, d.names, m)}</span>
                  {r.action === 'update' && <span className="shrink-0 rounded-full bg-accent px-2 text-xs font-bold text-ink">{t('edited')}</span>}
                </div>
                <div className="mt-1 text-xs text-slate">
                  {dateTime(r.at, lang)} · {who ? `${who.full_name} (${t(who.role === 'owner' ? 'role_owner' : 'role_salesperson')})` : t('system')}
                </div>
                {open === r.id && diff.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-xs">
                    <div className="font-semibold">{t('show_changes')}</div>
                    {diff.map((c) => <div key={c.key}><b>{c.key}</b>: {show(c.from)} → {show(c.to)}</div>)}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
