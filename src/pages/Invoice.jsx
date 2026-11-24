// Invoice view and print (/invoices/:id): lines, totals, paid and due; share on WhatsApp; the Owner can cancel with a reason.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, num, dateTime, localName } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function Invoice() {
  const { id } = useParams();
  const { role } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const [inv, setInv] = useState(undefined);
  const [seller, setSeller] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [r, names] = await Promise.all([
      supabase.from('sales_invoices')
        .select('*, customers(id, name, name_bn), sales_invoice_lines(id, qty, unit_price, line_total, products(name, name_bn, unit))')
        .eq('id', id).maybeSingle(),
      supabase.rpc('staff_names'),
    ]);
    setInv(r.data || null);
    if (r.data) setSeller((names.data || []).find((n) => n.id === r.data.created_by)?.full_name || '');
  }
  useEffect(() => { load(); }, [id]);

  if (inv === undefined) return <p className="text-slate">{t('loading')}</p>;
  if (inv === null) return <Card><p className="text-slate">{t('not_found')}</p></Card>;

  const lines = inv.sales_invoice_lines || [];
  const customerName = inv.customers ? localName(inv.customers, lang) : t('walk_in');
  const shareText = [
    `${t('app_name')} · ${inv.invoice_no}`, `${dateTime(inv.created_at, lang)} · ${customerName}`,
    ...lines.map((l) => `• ${localName(l.products, lang)} × ${num(l.qty, lang)} = ${money(l.line_total, lang)}`),
    `${t('total')}: ${money(inv.total, lang)} | ${t('paid_now')}: ${money(inv.paid_now, lang)} | ${t('due')}: ${money(inv.due_amount, lang)}`
      + (Number(inv.due_amount) > 0 && inv.due_date ? ` (${t('due_date')} ${inv.due_date})` : ''),
    t('thanks'),
  ].join('\n');

  async function cancel() {
    if (!reason.trim()) { setError(t('fill_required')); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('cancel_invoice', { p_invoice_id: inv.id, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(errorText(t, err)); return; }
    toast(t('invoice_cancelled'));
    setReason('');
    load();
  }

  const row = (label, value, strong) => (
    <div className={`flex justify-between ${strong ? 'text-xl font-bold text-brand-dark' : ''}`}><span>{label}</span><span>{value}</span></div>
  );
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">{t('invoice')} {inv.invoice_no}</h1>
            <p className="text-sm text-slate">{dateTime(inv.created_at, lang)} · {t('sold_by')} {seller}</p>
            {inv.customers ? <Link to={`/customers/${inv.customers.id}`} className="font-semibold text-brand-light underline">{customerName}</Link>
              : <p className="font-semibold">{customerName}</p>}
          </div>
          {inv.status === 'cancelled' && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">{t('cancelled')}</span>}
        </div>
        <ul className="divide-y divide-cloud border-y border-cloud">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 py-2">
              <span>{localName(l.products, lang)}<span className="block text-xs text-slate">{num(l.qty, lang)} {l.products?.unit} × {money(l.unit_price, lang)}</span></span>
              <span className="font-semibold">{money(l.line_total, lang)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 text-sm">
          {row(t('subtotal'), money(inv.subtotal, lang))}
          {Number(inv.discount) > 0 && row(t('discount'), `−${money(inv.discount, lang)}`)}
          {Number(inv.vat_amount) > 0 && row(`${t('vat')} (${num(inv.vat_rate, lang)}%)`, money(inv.vat_amount, lang))}
          {row(t('total'), money(inv.total, lang), true)}
          {row(t('paid_now'), money(inv.paid_now, lang))}
          {row(t('due'), money(inv.due_amount, lang), Number(inv.due_amount) > 0)}
          {Number(inv.due_amount) > 0 && inv.due_date && row(t('due_date'), inv.due_date)}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 print:hidden">
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
          className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-semibold text-white">{t('share_whatsapp')}</a>
        <Button variant="secondary" onClick={() => window.print()}>{t('print')}</Button>
      </div>
      {role === 'owner' && inv.status === 'posted' && (
        <Card className="space-y-2 print:hidden">
          <label className="block text-sm font-semibold">{t('cancel_reason')}
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-xl border border-cloud px-3 focus:outline-none focus:ring-2 focus:ring-brand-light" />
          </label>
          {error && <p role="alert" className="font-semibold text-accent-text">⚠ {error}</p>}
          <Button variant="secondary" onClick={cancel} disabled={busy}>{busy ? t('saving') : t('cancel_invoice')}</Button>
        </Card>
      )}
    </div>
  );
}
