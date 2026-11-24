// The items on a new sale: quantity stepper, price (Owner may change it), line total and a stock warning per line.
import { useI18n } from '../lib/i18n.js';
import { money, num, localName } from '../lib/format.js';
import { round2 } from '../lib/drafts.js';

export default function SaleLines({ lines, byId, isOwner, onChange, onRemove }) {
  const { t, lang } = useI18n();
  if (lines.length === 0) return <p className="py-4 text-center text-slate">{t('no_items')}</p>;
  const step = 'flex h-11 w-11 items-center justify-center rounded-xl border-2 border-brand text-xl font-bold text-brand';
  return (
    <ul className="divide-y divide-cloud">
      {lines.map((l, i) => {
        const p = byId[l.product_id];
        if (!p) return null;
        const price = isOwner ? Number(l.unit_price || 0) : Number(p.sale_price);
        const stock = Number(p.stock?.current_stock || 0);
        const over = Number(l.qty) > stock;
        return (
          <li key={l.product_id} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{localName(p, lang)}</span>
              <button type="button" onClick={() => onRemove(i)} className="text-sm text-slate underline">{t('remove')}</button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className={step} aria-label="−" onClick={() => onChange(i, { qty: Math.max(1, Number(l.qty) - 1) })}>−</button>
              <input type="number" inputMode="decimal" min="0.01" step="any" value={l.qty} aria-label={t('quantity')}
                onChange={(e) => onChange(i, { qty: e.target.value })}
                className="h-11 w-16 rounded-xl border border-cloud text-center text-lg font-semibold" />
              <button type="button" className={step} aria-label="+" onClick={() => onChange(i, { qty: Number(l.qty) + 1 })}>+</button>
              <span className="ml-1 text-sm text-slate">×</span>
              {isOwner ? (
                <input type="number" inputMode="decimal" min="0" step="0.01" value={l.unit_price} aria-label={t('price')}
                  onChange={(e) => onChange(i, { unit_price: e.target.value })}
                  className="h-11 w-20 rounded-xl border border-cloud px-2 text-right" />
              ) : <span className="text-sm">{money(price, lang)}</span>}
              <span className="ml-auto font-bold">{money(round2(Number(l.qty || 0) * price), lang)}</span>
            </div>
            <div className={`mt-1 text-xs ${over ? 'font-semibold text-accent-text' : 'text-slate'}`}>
              {over ? `⚠ ${t('only_n_in_stock', { n: num(Math.max(stock, 0), lang) })}` : t('stock_left', { n: num(stock, lang) })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
