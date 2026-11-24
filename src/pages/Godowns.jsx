// Godowns & branches (/godowns): stock per location from the one shared ledger, last activity per branch, and
// (Owner only) Transfer stock between locations. Total stock never changes in a transfer; only where it sits.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { num, dateTime, localName } from '../lib/format.js';
import { newRef } from '../lib/drafts.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const field = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3';

export default function Godowns() {
  const { role } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [f, setF] = useState({ product_id: '', from: '', to: '', qty: '', note: '' });
  const [ref, setRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [g, s, p] = await Promise.all([
      supabase.from('godowns').select('*').order('is_main', { ascending: false }).order('name'),
      supabase.from('godown_stock').select('godown_id, product_id, qty, last_movement_at'),
      supabase.from('products').select('id, sku, name, name_bn, unit').eq('is_active', true).order('name'),
    ]);
    setD({ godowns: g.data || [], stock: s.data || [], products: p.data || [] });
    setSel((cur) => cur || g.data?.[0]?.id || null);
  }
  useEffect(() => { load(); }, []);

  const byProduct = useMemo(() => Object.fromEntries((d?.products || []).map((p) => [p.id, p])), [d]);
  async function transfer(e) {
    e.preventDefault(); setError('');
    if (!f.product_id || !f.from || !f.to || !(Number(f.qty) > 0)) { setError(t('fill_required')); return; }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('transfer_stock', {
      p_client_ref: ref, p_product_id: f.product_id, p_from: f.from, p_to: f.to, p_qty: Number(f.qty), p_note: f.note || null,
    });
    setBusy(false);
    if (err) { setError(errorText(t, err, { productName: localName(byProduct[f.product_id], lang) })); return; }
    toast(`${data.transfer_no} · ${t('transfer_saved')}`);
    setRef(newRef()); setF({ ...f, qty: '', note: '' }); load();
  }

  if (!d) return <p className="text-slate">{t('loading')}</p>;
  const rowsFor = (gid) => d.stock.filter((s) => s.godown_id === gid && Number(s.qty) !== 0);
  const selected = rowsFor(sel).sort((a, b) => Number(b.qty) - Number(a.qty));
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-brand-tint p-3 text-sm">🔄 {t('sync_note')}</p>
      <div className="grid grid-cols-1 gap-2">
        {d.godowns.map((g) => {
          const rows = rowsFor(g.id);
          const last = rows.map((r) => r.last_movement_at).sort().pop();
          return (
            <button key={g.id} type="button" onClick={() => setSel(g.id)}
              className={`rounded-xl border-2 bg-white p-3 text-left ${sel === g.id ? 'border-brand' : 'border-cloud'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{lang === 'bn' && g.name_bn ? g.name_bn : g.name}{g.is_main ? ` · ${t('main_godown')}` : ''}</span>
                <span className="text-xs font-semibold text-brand">● {t('sync_live')}</span>
              </div>
              <div className="text-sm text-slate">{g.area} · {t('products_count', { n: num(rows.length, lang) })} · {num(rows.reduce((s, r) => s + Number(r.qty), 0), lang)} {t('units')}</div>
              {last && <div className="text-xs text-slate">{t('last_activity')}: {dateTime(last, lang)}</div>}
            </button>
          );
        })}
      </div>
      <Card className="p-0">
        <ul className="divide-y divide-cloud">
          {selected.map((s) => (
            <li key={s.product_id}>
              <Link to={`/products/${s.product_id}`} className="flex min-h-[48px] items-center justify-between px-4">
                <span>{localName(byProduct[s.product_id], lang)}</span>
                <b className={Number(s.qty) < 0 ? 'text-accent-text' : ''}>{num(s.qty, lang)} {byProduct[s.product_id]?.unit}</b>
              </Link>
            </li>
          ))}
          {selected.length === 0 && <li className="p-4 text-slate">{t('no_results')}</li>}
        </ul>
      </Card>
      {role === 'owner' && (
        <Card>
          <form onSubmit={transfer} className="space-y-2">
            <h2 className="font-semibold text-brand-dark">{t('transfer')}</h2>
            <label className="block text-sm font-semibold">{t('choose_product')}
              <select className={field} value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
                <option value="">—</option>
                {d.products.map((p) => <option key={p.id} value={p.id}>{localName(p, lang)} ({p.sku})</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {['from', 'to'].map((k) => (
                <label key={k} className="text-sm font-semibold">{t(k)}
                  <select className={field} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                    <option value="">—</option>
                    {d.godowns.map((g) => {
                      const have = d.stock.find((s) => s.godown_id === g.id && s.product_id === f.product_id);
                      return <option key={g.id} value={g.id}>{g.name}{f.product_id ? ` (${num(have?.qty || 0, lang)})` : ''}</option>;
                    })}
                  </select>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={field} type="number" min="1" inputMode="decimal" placeholder={t('quantity')} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
              <input className={field} placeholder={t('note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-accent-text">⚠ {error}</p>}
            <Button type="submit" disabled={busy}>{busy ? t('saving') : t('transfer')}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
