// Bottom bar (56 px, icons with labels). Owner: Home, Sell, Customers, Products, More. Salesperson: first four.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';

const icons = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  sell: 'M4 5h16l-1.5 9H6.5zM6.5 14L5 3H2M9 19a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm10 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z',
  customers: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0',
  products: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

function Item({ to, label, icon }) {
  return (
    <NavLink to={to} end={to === '/'}
      className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${isActive ? 'font-semibold text-brand' : 'text-slate'}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={icon === 'more' ? 3.5 : 1.8}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icons[icon]} />
      </svg>
      {label}
    </NavLink>
  );
}

export default function BottomNav() {
  const { role } = useAuth();
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-14 max-w-[480px] border-t border-cloud bg-white print:hidden">
      <Item to="/" label={t('home')} icon="home" />
      <Item to="/sell" label={t('sell')} icon="sell" />
      <Item to="/customers" label={t('customers')} icon="customers" />
      <Item to="/products" label={t('products')} icon="products" />
      {role === 'owner' && <Item to="/more" label={t('more')} icon="more" />}
    </nav>
  );
}
