// Peach banner (spec 11.3) for a save that didn't reach the server: the draft is kept and Retry resends the same client_ref.
import { useI18n } from '../lib/i18n.js';

export default function Banner({ onRetry, busy }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-accent-tint p-3 text-accent-ink">
      <span className="font-semibold">⚠ {t('draft_safe')}</span>
      <button type="button" onClick={onRetry} disabled={busy}
        className="min-h-[44px] shrink-0 rounded-xl border-2 border-accent-ink px-3 font-semibold disabled:opacity-50">
        {busy ? t('saving') : t('retry')}
      </button>
    </div>
  );
}
