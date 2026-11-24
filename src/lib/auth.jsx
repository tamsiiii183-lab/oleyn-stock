// Login state for the whole app: the Supabase session plus the user's profile (name, role, language).
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { useI18n } from './i18n.js';
import { identifyUser, resetAnalytics, track } from './analytics.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { setLangLocal } = useI18n();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(sess) {
    if (!sess) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('id, full_name, role, language').eq('id', sess.user.id).maybeSingle();
    setProfile(data || null);
    identifyUser(data);
    if (data?.language) {
      setLangLocal(data.language);
      try { localStorage.setItem('oleyn_lang', data.language); } catch { /* ignore */ }
    }
    return data;
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setTimeout(() => loadProfile(sess), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      const p = await loadProfile(data.session);
      track('user_logged_in', { role: p?.role, language: p?.language });
    }
    return { error };
  }

  async function signOut() {
    resetAnalytics();
    await supabase.auth.signOut();
    setProfile(null);
  }

  const value = { session, user: session?.user || null, profile, role: profile?.role || null, loading, signIn, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
