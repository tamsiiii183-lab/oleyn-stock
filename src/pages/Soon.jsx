// "Coming soon" page for the next ERP modules, with a Notify me button (analytics event added later).
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../lib/i18n.js';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';

const details = { accounting: 'soon_accounting', manufacturing: 'soon_manufacturing', multi_godown: 'soon_godown' };

export default function Soon() {
  const { module } = useParams();
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  if (!details[module]) return null;
  return (
    <Card className="space-y-3">
      <h1 className="text-xl font-bold text-brand-dark">{t(module)}</h1>
      <span className="inline-block rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-ink">{t('coming_soon')}</span>
      <p>{t(details[module])}</p>
      {sent ? <p className="font-semibold text-brand">{t('thanks_notify')}</p>
        : <Button onClick={() => setSent(true)}>{t('notify_me')}</Button>}
    </Card>
  );
}
