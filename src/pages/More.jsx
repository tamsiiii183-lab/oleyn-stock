// Owner's "More" menu: New purchase, Adjust stock, Payroll, Coming soon modules, API key info, Log out.
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';

export default function More() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  const links = [
    ['/purchase/new', t('new_purchase')],
    ['/adjust', t('adjust_stock')],
    ['/payroll', t('payroll')],
    ['/soon/accounting', `${t('accounting')} · ${t('coming_soon')}`],
    ['/soon/manufacturing', `${t('manufacturing')} · ${t('coming_soon')}`],
    ['/soon/multi_godown', `${t('multi_godown')} · ${t('coming_soon')}`],
    ['/api-info', t('api_info')],
  ];
  return (
    <div className="space-y-4">
      <Card className="p-0">
        <ul className="divide-y divide-cloud">
          {links.map(([to, label]) => (
            <li key={to}>
              <Link to={to} className="flex min-h-[52px] items-center justify-between px-4">
                <span>{label}</span>
                <span aria-hidden="true" className="text-slate">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Button variant="secondary" onClick={signOut}>{t('logout')}</Button>
    </div>
  );
}
