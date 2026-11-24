// Shows a page only to the allowed role. The server refuses the data anyway; this just explains it nicely.
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import Card from './Card.jsx';

export default function RoleGuard({ role, children }) {
  const auth = useAuth();
  const { t } = useI18n();
  if (auth.role !== role) {
    return (
      <Card className="mt-6 text-center">
        <p className="text-lg font-semibold text-accent-text">⚠ {t('not_allowed_page')}</p>
      </Card>
    );
  }
  return children;
}
