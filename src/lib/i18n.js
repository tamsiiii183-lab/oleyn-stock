// Language support: t('key') returns English or Bangla text. Choice is kept in localStorage and profiles.language.
import { createContext, createElement, useContext, useEffect, useState } from 'react';
import en from '../i18n/en.json';
import bn from '../i18n/bn.json';
import { supabase } from './supabase.js';
import { setLanguageProp, track } from './analytics.js';

const dictionaries = { en, bn };
const I18nContext = createContext(null);

function readSaved() {
  try { return localStorage.getItem('oleyn_lang') === 'bn' ? 'bn' : 'en'; } catch { return 'en'; }
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readSaved);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.classList.toggle('lang-bn', lang === 'bn');
  }, [lang]);

  // Change language; if someone is logged in, also save it on their profile.
  async function setLang(next, userId) {
    setLangState(next);
    setLanguageProp(next);
    track('language_switched', { to: next });
    try { localStorage.setItem('oleyn_lang', next); } catch { /* private mode: ignore */ }
    if (userId && supabase) await supabase.from('profiles').update({ language: next }).eq('id', userId);
  }

  function t(key, vars = {}) {
    const text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  }

  return createElement(I18nContext.Provider, { value: { lang, setLang, setLangLocal: setLangState, t } }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}
