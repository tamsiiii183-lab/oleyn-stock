// Top bar: app name, user's name and role badge, language switch and an online/offline dot.
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.js';
import LanguageSwitch from './LanguageSwitch.jsx';

export default function Header() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  return (
    <header className="sticky top-0 z-20 bg-brand px-4 py-2 text-white print:hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{t('app_name')}</span>
            <span title={online ? t('online') : t('offline')} aria-label={online ? t('online') : t('offline')}
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-white' : 'bg-accent'}`} />
            {!online && <span className="text-xs">{t('offline')}</span>}
          </div>
          {profile && (
            <div className="flex items-center gap-2 text-sm">
              <span className="truncate">{profile.full_name}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-brand">
                {t(profile.role === 'owner' ? 'role_owner' : 'role_salesperson')}
              </span>
            </div>
          )}
        </div>
        <LanguageSwitch dark />
      </div>
    </header>
  );
}
