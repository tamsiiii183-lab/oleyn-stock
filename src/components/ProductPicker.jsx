// Search-or-scan box (spec 13.2). A scanner "types" the code and presses Enter: an exact barcode/SKU match adds 1.
// Otherwise it shows matching products by name, Bangla name or SKU to tap.
import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { money, num, localName } from '../lib/format.js';

export default function ProductPicker({ products, onPick }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const box = useRef(null);
  const term = q.trim().toLowerCase();
  const results = term
    ? products.filter((p) => [p.name, p.name_bn, p.sku, p.barcode].some((v) => (v || '').toLowerCase().includes(term))).slice(0, 8)
    : [];

  function pick(p, viaBarcode) {
    onPick(p, viaBarcode);
    setQ('');
    box.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = products.find((p) => (p.barcode && p.barcode === q.trim()) || p.sku.toLowerCase() === term);
    if (exact) pick(exact, exact.barcode === q.trim());
    else if (results.length === 1) pick(results[0], false);
  }

  return (
    <div className="relative">
      <input ref={box} autoFocus type="search" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
        placeholder={t('search_or_scan')} aria-label={t('search_or_scan')}
        className="min-h-[52px] w-full rounded-xl border-2 border-brand bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-light" />
      {results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 divide-y divide-cloud overflow-auto rounded-xl border border-cloud bg-white shadow">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p, false)} className="flex min-h-[52px] w-full items-center justify-between gap-2 px-3 text-left">
                <span>
                  <span className="block font-semibold">{localName(p, lang)}</span>
                  <span className="text-xs text-slate">{p.sku} · {t('stock_left', { n: num(p.stock?.current_stock || 0, lang) })}</span>
                </span>
                <span className="shrink-0 font-semibold">{money(p.sale_price, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
