// API key info (/api-info, Owner): how an outside system reads stock, with the demo key and a live "Try it" link.
import { useI18n } from '../lib/i18n.js';
import Card from '../components/Card.jsx';

const DEMO_KEY = 'oleyn-demo-api-key-2026';

export default function ApiInfo() {
  const { t } = useI18n();
  const url = `${window.location.origin}/api/v1/stock?sku=PRAN-MANGO-250`;
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-bold text-brand-dark">{t('api_title')}</h1>
      <p>{t('api_desc')}</p>
      <pre className="overflow-x-auto rounded-xl bg-ink p-3 text-xs text-white">{`GET ${url}\nx-api-key: ${DEMO_KEY}`}</pre>
      <p className="text-sm">{t('api_key_note')} <code className="rounded bg-brand-tint px-1">{DEMO_KEY}</code></p>
      <pre className="overflow-x-auto rounded-xl bg-brand-tint p-3 text-xs">{`curl -H "x-api-key: ${DEMO_KEY}" "${url}"`}</pre>
    </Card>
  );
}
