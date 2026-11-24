// Feedback entry (/feedback, both roles): send a problem, idea or question with an optional rating. The Owner sees
// everyone's feedback and marks it seen or done; staff see their own and its status.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { dateTime } from '../lib/format.js';
import { track } from '../lib/analytics.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const KINDS = ['bug', 'idea', 'question', 'other'];

export default function Feedback() {
  const { role } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const isOwner = role === 'owner';
  const [f, setF] = useState({ kind: 'idea', message: '', rating: 0 });
  const [list, setList] = useState([]);
  const [names, setNames] = useState({});
  const [error, setError] = useState('');
  const load = async () => {
    const [r, n] = await Promise.all([supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(50), supabase.rpc('staff_names')]);
    setList(r.data || []);
    setNames(Object.fromEntries((n.data || []).map((x) => [x.id, x.full_name])));
  };
  useEffect(() => { load(); }, []);

  async function send(e) {
    e.preventDefault(); setError('');
    if (f.message.trim().length < 3) { setError(t('fill_required')); return; }
    const { error: err } = await supabase.from('feedback').insert({ kind: f.kind, message: f.message.trim(), rating: f.rating || null, page: 'feedback' });
    if (err) { setError(errorText(t, err)); return; }
    track('feedback_sent', { kind: f.kind, rating: f.rating || null });
    toast(t('fb_sent')); setF({ kind: f.kind, message: '', rating: 0 }); load();
  }
  async function setStatus(id, status) {
    await supabase.from('feedback').update({ status }).eq('id', id);
    load();
  }

  return (
    <div className="space-y-3">
      <Card>
        <form onSubmit={send} className="space-y-3">
          <h1 className="text-xl font-bold text-brand-dark">💬 {t('feedback')}</h1>
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setF({ ...f, kind: k })} aria-pressed={f.kind === k}
                className={`min-h-[44px] rounded-xl border-2 border-brand text-sm font-semibold ${f.kind === k ? 'bg-brand text-white' : 'bg-white text-brand'}`}>{t(`fb_kind_${k}`)}</button>
            ))}
          </div>
          <label className="block text-sm font-semibold">{t('fb_message')}
            <textarea rows="4" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="mt-1 w-full rounded-xl border border-cloud p-3" />
          </label>
          <div className="text-sm font-semibold">{t('fb_rating')}
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setF({ ...f, rating: n })} aria-label={`${n}`}
                  className={`h-11 w-11 rounded-lg text-2xl ${n <= f.rating ? 'text-accent' : 'text-cloud'}`}>★</button>
              ))}
            </div>
          </div>
          {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
          <Button type="submit">{t('fb_send')}</Button>
        </form>
      </Card>
      <Card className="p-0">
        <h2 className="px-4 pt-4 font-semibold text-brand-dark">{t(isOwner ? 'fb_all' : 'fb_mine')}</h2>
        <ul className="divide-y divide-cloud">
          {list.map((x) => (
            <li key={x.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{t(`fb_kind_${x.kind}`)}{x.rating ? ` · ${'★'.repeat(x.rating)}` : ''}</b>
                <span className={`rounded-full px-2 text-xs font-semibold ${x.status === 'new' ? 'bg-accent text-ink' : x.status === 'done' ? 'bg-brand text-white' : 'bg-cloud'}`}>{t(`fb_status_${x.status}`)}</span>
              </div>
              <p className="whitespace-pre-line">{x.message}</p>
              <div className="text-xs text-slate">{names[x.created_by] || '—'} · {dateTime(x.created_at, lang)}</div>
              {isOwner && x.status !== 'done' && (
                <div className="flex gap-2 pt-1">
                  {x.status === 'new' && <button type="button" onClick={() => setStatus(x.id, 'seen')} className="rounded-lg border border-brand px-3 py-1 text-xs font-semibold text-brand">{t('mark_seen')}</button>}
                  <button type="button" onClick={() => setStatus(x.id, 'done')} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white">{t('mark_done')}</button>
                </div>
              )}
            </li>
          ))}
          {list.length === 0 && <li className="p-4 text-slate">{t('no_results')}</li>}
        </ul>
      </Card>
    </div>
  );
}
