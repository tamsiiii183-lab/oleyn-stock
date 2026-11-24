// "More" menu for both roles. Owner: purchases, stock, business modules, API info, Supervision. Salesperson: receive
// stock and stock by location. The last two entries for everyone: Shrobon (assistant placeholder, not tappable yet)
// and Feedback.
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';

export default function More() {
  const { signOut, role } = useAuth();
  const { t } = useI18n();
  const ownerLinks = [
    ['/purchase/new', t('new_purchase')],
    ['/adjust', t('adjust_stock')],
    ['/hr', t('hr')],
    ['/payroll', t('payroll')],
    ['/accounts', t('accounts')],
    ['/production', t('production')],
    ['/godowns', t('godowns')],
    ['/api-info', t('api_info')],
    ['/supervision', `👁 ${t('supervision')}`],
  ];
  const salesLinks = [
    ['/purchase/new', `📷 ${t('receive_stock_short')}`],
    ['/godowns', t('stock_by_location')],
  ];
  const links = [...(role === 'owner' ? ownerLinks : salesLinks), [null, `🎧 ${t('shrobon')}`], ['/feedback', `💬 ${t('feedback')}`]];
  return (
    <div className="space-y-4">
      <Card className="p-0">
        <ul className="divide-y divide-cloud">
          {links.map(([to, label]) => (
            <li key={label}>
              {to ? (
                <Link to={to} className="flex min-h-[52px] items-center justify-between px-4">
                  <span>{label}</span>
                  <span aria-hidden="true" className="text-slate">›</span>
                </Link>
              ) : (
                <div aria-disabled="true" className="flex min-h-[52px] cursor-default items-center justify-between px-4 text-slate">
                  <span>{label}</span>
                  <span className="rounded-full bg-cloud px-2 py-0.5 text-xs font-semibold text-ink">{t('coming_soon')}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Button variant="secondary" onClick={signOut}>{t('logout')}</Button>
    </div>
  );
}
