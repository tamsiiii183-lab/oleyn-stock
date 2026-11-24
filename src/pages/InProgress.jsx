// Temporary page for screens built in later segments.
import { useI18n } from '../lib/i18n.js';
import Card from '../components/Card.jsx';

export default function InProgress({ title }) {
  const { t } = useI18n();
  return (
    <Card className="space-y-2">
      <h1 className="text-xl font-bold text-brand-dark">{title}</h1>
      <p className="text-slate">{t('in_progress')}</p>
    </Card>
  );
}
