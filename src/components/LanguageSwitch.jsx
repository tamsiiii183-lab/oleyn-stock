// EN / বাংলা toggle. Saves the choice on the device and, when logged in, on the user's profile.
import { useI18n } from '../lib/i18n.js';
import { useAuth } from '../lib/auth.jsx';

export default function LanguageSwitch({ dark = false }) {
  const { lang, setLang } = useI18n();
  const auth = useAuth();
  const userId = auth?.user?.id;
  const pill = (code, label) => {
    const active = lang === code;
    const on = dark ? 'bg-white text-brand' : 'bg-brand text-white';
    const off = dark ? 'text-white' : 'text-brand';
    return (
      <button type="button" onClick={() => setLang(code, userId)} aria-pressed={active}
        className={`min-h-[36px] rounded-full px-3 text-sm font-semibold ${active ? on : off}`}>
        {label}
      </button>
    );
  };
  return (
    <div className={`flex rounded-full border ${dark ? 'border-white/60' : 'border-brand'}`}>
      {pill('en', 'EN')}
      {pill('bn', 'বাংলা')}
    </div>
  );
}
