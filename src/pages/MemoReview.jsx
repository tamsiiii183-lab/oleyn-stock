// AI review screen (/purchase/review/:extractionId, Owner): memo photo above the AI's lines. Nothing is saved until the
// Owner fixes any orange "Check this" fields, ticks "I checked this memo" and taps Save.
import { useParams, Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n.js';
import PurchaseForm from '../components/PurchaseForm.jsx';
import Card from '../components/Card.jsx';

export default function MemoReview() {
  const { extractionId } = useParams();
  const { t } = useI18n();
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(`oleyn_ai_${extractionId}`)); } catch { /* missing */ }
  if (!saved) {
    return <Card><p className="text-slate">{t('not_found')}</p><Link className="text-brand-light underline" to="/purchase/new">{t('new_purchase')}</Link></Card>;
  }
  const { result, photo } = saved;
  const warnings = result.warnings || [];
  const initial = {
    supplier_name: result.supplier_name || '',
    lines: result.lines.map((l, i) => ({
      product_id: l.product_id || '', qty: l.qty ?? '', unit_cost: l.unit_cost ?? '', item_name: l.item_name, unit: l.unit,
      confidence: Number(l.confidence || 0), warn: warnings.some((w) => w.startsWith(`Line ${i + 1}:`)),
    })),
  };
  return (
    <PurchaseForm draftKey={`review_${extractionId}`} initial={initial} photo={photo} source="ai"
      extractionId={extractionId} warnings={warnings}
      onSaved={() => sessionStorage.removeItem(`oleyn_ai_${extractionId}`)} />
  );
}
