// Routes and the logged-in layout (header + page + bottom bar). Owner-only routes are wrapped in RoleGuard.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { useI18n } from './lib/i18n.js';
import { configured } from './lib/supabase.js';
import Header from './components/Header.jsx';
import BottomNav from './components/BottomNav.jsx';
import RoleGuard from './components/RoleGuard.jsx';
import Login from './pages/Login.jsx';
import OwnerHome from './pages/OwnerHome.jsx';
import SalesHome from './pages/SalesHome.jsx';
import More from './pages/More.jsx';
import Soon from './pages/Soon.jsx';
import InProgress from './pages/InProgress.jsx';

function Layout() {
  const { session, profile, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <p className="mt-10 text-center text-slate">{t('loading')}</p>;
  if (!session || !profile) return <Navigate to="/login" replace />;
  return (
    <div className="mx-auto min-h-screen max-w-[480px] bg-brand-tint pb-20">
      <Header />
      <main className="px-4 py-4"><Outlet /></main>
      <BottomNav />
    </div>
  );
}

function Home() {
  const { role } = useAuth();
  return role === 'owner' ? <OwnerHome /> : <SalesHome />;
}

const ownerOnly = (el) => <RoleGuard role="owner">{el}</RoleGuard>;

export default function App() {
  const { t } = useI18n();
  if (!configured) {
    return <p className="m-6 text-accent-text">Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in Vercel settings.</p>;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/sell" element={<InProgress title={t('new_sale')} />} />
        <Route path="/customers" element={<InProgress title={t('customers')} />} />
        <Route path="/customers/:id" element={<InProgress title={t('customers')} />} />
        <Route path="/pay" element={<InProgress title={t('record_payment')} />} />
        <Route path="/products" element={<InProgress title={t('products')} />} />
        <Route path="/products/:id" element={<InProgress title={t('stock_history')} />} />
        <Route path="/invoices/:id" element={<InProgress title={t('sell')} />} />
        <Route path="/purchase/new" element={ownerOnly(<InProgress title={t('new_purchase')} />)} />
        <Route path="/purchase/review/:extractionId" element={ownerOnly(<InProgress title={t('scan_memo')} />)} />
        <Route path="/adjust" element={ownerOnly(<InProgress title={t('adjust_stock')} />)} />
        <Route path="/payroll" element={ownerOnly(<InProgress title={t('payroll')} />)} />
        <Route path="/api-info" element={ownerOnly(<InProgress title={t('api_info')} />)} />
        <Route path="/more" element={ownerOnly(<More />)} />
        <Route path="/soon/:module" element={<Soon />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
