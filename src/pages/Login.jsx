// Login page: email + password, two "Demo as…" buttons that fill in the demo logins, and the language switch.
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';
import LanguageSwitch from '../components/LanguageSwitch.jsx';

// Public demo logins from spec 15.1 (also listed in the README for evaluators).
const DEMO = {
  owner: { email: 'owner@oleyn-demo.com', password: 'OleynOwner#2026' },
  sales: { email: 'sales@oleyn-demo.com', password: 'OleynSales#2026' },
};

export default function Login() {
  const { session, profile, signIn } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (session && profile) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await signIn(email.trim(), password);
    if (err) setError(t('login_failed'));
    setBusy(false);
  }

  function fill(which) {
    setEmail(DEMO[which].email);
    setPassword(DEMO[which].password);
    setError('');
  }

  const input = 'mt-1 min-h-[48px] w-full rounded-xl border border-cloud bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-light';
  return (
    <main className="mx-auto min-h-screen max-w-[480px] px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">{t('app_name')}</h1>
        <LanguageSwitch />
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-semibold">
            {t('email')}
            <input className={input} type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block text-sm font-semibold">
            {t('password')}
            <input className={input} type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="text-sm font-semibold text-accent-text" role="alert">⚠ {error}</p>}
          <Button type="submit" disabled={busy}>{busy ? t('loading') : t('login')}</Button>
        </form>
      </Card>
      {session && !profile && <p className="mt-4 text-sm text-accent-text">⚠ {t('no_profile')}</p>}
      <div className="mt-4 space-y-3">
        <Button variant="secondary" type="button" onClick={() => fill('owner')}>{t('demo_owner')}</Button>
        <Button variant="secondary" type="button" onClick={() => fill('sales')}>{t('demo_sales')}</Button>
      </div>
    </main>
  );
}
