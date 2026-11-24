// New sale (/sell): scan or search items, choose a customer, enter Paid now; saves through create_sale with safe save.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import { errorText } from '../lib/errors.js';
import { money, localName, dhakaDatePlus } from '../lib/format.js';
import { loadDraft, saveDraft, clearDraft, isNetworkError, round2 } from '../lib/drafts.js';
import { loadProducts } from './Products.jsx';
import { loadCustomers } from './Customers.jsx';
import { useToast } from '../components/Toast.jsx';
import { track } from '../lib/analytics.js';
import ProductPicker from '../components/ProductPicker.jsx';
import SaleLines from '../components/SaleLines.jsx';
import Banner from '../components/Banner.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const EMPTY = { customer_id: '', lines: [], discount: '', vat_rate: '', paid_now: '', due_date: '', override_reason: '', used_barcode: false };
const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 focus:outline-none focus:ring-2 focus:ring-brand-light';

export default function NewSale() {
  const { role } = useAuth();
  const isOwner = role === 'owner';
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => loadDraft('sale', EMPTY));
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [netFail, setNetFail] = useState(false);

  useEffect(() => { loadProducts(isOwner).then(setProducts); loadCustomers().then(setCustomers); }, [isOwner]);
  useEffect(() => { saveDraft('sale', draft); }, [draft]);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  function addProduct(p, viaBarcode) {
    setDraft((d) => {
      const i = d.lines.findIndex((l) => l.product_id === p.id);
      const lines = i >= 0 ? d.lines.map((l, j) => (j === i ? { ...l, qty: Number(l.qty) + 1 } : l))
        : [...d.lines, { product_id: p.id, qty: 1, unit_price: Number(p.sale_price) }];
      return { ...d, lines, used_barcode: d.used_barcode || viaBarcode };
    });
  }

  // Same maths as create_sale step 6, so the screen and the saved invoice always match.
  const priceOf = (l) => (isOwner ? Number(l.unit_price || 0) : Number(byId[l.product_id]?.sale_price || 0));
  const subtotal = round2(draft.lines.reduce((s, l) => s + round2(Number(l.qty || 0) * priceOf(l)), 0));
  const discount = isOwner ? Number(draft.discount || 0) : 0;
  const vatRate = isOwner ? Number(draft.vat_rate || 0) : 0;
  const vat = round2(((subtotal - discount) * vatRate) / 100);
  const total = round2(subtotal - discount + vat);
  const paid = draft.paid_now === '' ? total : Number(draft.paid_now);
  const due = round2(total - paid);
  const customer = customers.find((c) => c.id === draft.customer_id);
  const dueDate = draft.due_date || (customer ? dhakaDatePlus(customer.credit_days) : '');
  const over = draft.lines.some((l) => Number(l.qty) > Number(byId[l.product_id]?.stock?.current_stock || 0));
  const blocked = draft.lines.length === 0 || (over && !isOwner) || (over && isOwner && !draft.override_reason.trim())
    || paid < 0 || paid > total || (due > 0 && !draft.customer_id);

  async function save() {
    setBusy(true); setError(''); setNetFail(false);
    const { data, error: err } = await supabase.rpc('create_sale', {
      p_client_ref: draft.client_ref, p_customer_id: draft.customer_id || null,
      p_lines: draft.lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), ...(isOwner ? { unit_price: Number(l.unit_price) } : {}) })),
      p_discount: discount, p_vat_rate: vatRate, p_paid_now: paid, p_due_date: due > 0 ? dueDate : null,
      p_override_reason: draft.override_reason.trim() || null,
    });
    setBusy(false);
    if (err) {
      if (isNetworkError(err)) setNetFail(true);
      else setError(errorText(t, err, { productName: localName(products.find((p) => p.sku === String(err.message).split(':')[1]), lang) }));
      return;
    }
    if (!data.duplicate) {
      track('invoice_saved', {
        payment_type: paid >= total ? 'cash' : paid === 0 ? 'credit' : 'partial', lines: draft.lines.length, total_bdt: total,
        is_first_real_invoice: Boolean(data.is_first_real_invoice), oversell_override: Boolean(data.oversell_override), used_barcode: Boolean(draft.used_barcode),
      });
    }
    clearDraft('sale');
    setDraft(loadDraft('sale', EMPTY));
    toast(`${data.invoice_no} ${t('invoice_saved')}`);
    navigate(`/invoices/${data.invoice_id}`);
  }

  return (
    <div className="space-y-3">
      {netFail && <Banner onRetry={save} busy={busy} />}
      <ProductPicker products={products} onPick={addProduct} />
      <Card className="py-1">
        <SaleLines lines={draft.lines} byId={byId} isOwner={isOwner}
          onChange={(i, patch) => update({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })}
          onRemove={(i) => update({ lines: draft.lines.filter((_, j) => j !== i) })} />
      </Card>
      {over && isOwner && (
        <label className="block rounded-xl bg-accent-tint p-3 text-sm font-semibold text-accent-ink">⚠ {t('over_stock_owner')}
          <input className={input} value={draft.override_reason} placeholder={t('override_reason')} onChange={(e) => update({ override_reason: e.target.value })} />
        </label>
      )}
      <Card className="space-y-3">
        <label className="block text-sm font-semibold">{t('choose_customer')}
          <select className={input} value={draft.customer_id} onChange={(e) => update({ customer_id: e.target.value, due_date: '' })}>
            <option value="">{t('walk_in_cash')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{localName(c, lang)} · {t('due')} {money(c.due, lang)}</option>)}
          </select>
        </label>
        {isOwner && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold">{t('discount')} ৳<input className={input} type="number" min="0" inputMode="decimal" value={draft.discount} onChange={(e) => update({ discount: e.target.value })} /></label>
            <label className="text-sm font-semibold">{t('vat')}<input className={input} type="number" min="0" max="100" inputMode="decimal" value={draft.vat_rate} onChange={(e) => update({ vat_rate: e.target.value })} /></label>
          </div>
        )}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>{t('subtotal')}</span><span>{money(subtotal, lang)}</span></div>
          {discount > 0 && <div className="flex justify-between"><span>{t('discount')}</span><span>−{money(discount, lang)}</span></div>}
          {vat > 0 && <div className="flex justify-between"><span>{t('vat')}</span><span>{money(vat, lang)}</span></div>}
          <div className="flex justify-between text-2xl font-bold text-brand-dark"><span>{t('total')}</span><span>{money(total, lang)}</span></div>
        </div>
        <label className="block text-sm font-semibold">{t('paid_now')} ৳
          <input className={input} type="number" min="0" inputMode="decimal" value={draft.paid_now} placeholder={String(total)} onChange={(e) => update({ paid_now: e.target.value })} />
        </label>
        <div className={`flex justify-between text-xl font-bold ${due > 0 ? 'text-accent-text' : 'text-brand-dark'}`}><span>{t('due')}</span><span>{money(due, lang)}</span></div>
        {due > 0 && !draft.customer_id && <p className="text-sm font-semibold text-accent-text">⚠ {t('err_CUSTOMER_REQUIRED_FOR_CREDIT')}</p>}
        {(paid < 0 || paid > total) && <p className="text-sm font-semibold text-accent-text">⚠ {t('err_PAID_EXCEEDS_TOTAL')}</p>}
        {due > 0 && draft.customer_id && (
          <label className="block text-sm font-semibold">{t('due_date')}
            <input className={input} type="date" value={dueDate} onChange={(e) => update({ due_date: e.target.value })} />
          </label>
        )}
      </Card>
      {error && <p role="alert" className="rounded-xl bg-accent-tint p-3 font-semibold text-accent-ink">⚠ {error}</p>}
      <Button onClick={save} disabled={busy || blocked}>{busy ? t('saving') : `${t('save_invoice')} · ${money(total, lang)}`}</Button>
    </div>
  );
}
