'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSession, verifySessionFromCookie, refreshDbTokenIfNeeded, type SessionUserProfile } from '@/lib/auth';
import { getStoredLang, setStoredLang, translate, type Lang, type DictKey } from '@/lib/i18n';
import { applyThemeColor } from '@/lib/theme';

interface AuthContextValue {
  user: SessionUserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Sets the in-memory profile immediately after login — sessionStorage
   * alone doesn't update this context's React state, which used to leave
   * `user` null right after a successful login and send the very next
   * navigation straight back to /login (the app layout treats null user as
   * "not logged in"). Call this instead of writing sessionStorage directly. */
  setUserProfile: (profile: SessionUserProfile | null) => void;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, refresh: async () => {}, setUserProfile: () => {} });

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const cached = getSession();
    if (cached) {
      setUser(cached);
      setLoading(false);
      return;
    }
    const fromCookie = await verifySessionFromCookie();
    setUser(fromCookie);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => refreshDbTokenIfNeeded(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return <AuthContext.Provider value={{ user, loading, refresh, setUserProfile: setUser }}>{children}</AuthContext.Provider>;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'id',
  setLang: () => {},
  t: (key) => key,
});

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('id');

  useEffect(() => {
    setLangState(getStoredLang());
  }, []);

  const setLang = useCallback((l: Lang) => {
    setStoredLang(l);
    setLangState(l);
  }, []);

  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

const THEME_CACHE_KEY = 'iwm_theme_primary';

/**
 * Applies the admin-chosen brand color on every page — login included, since
 * it has no session. Reads a cached color from sessionStorage first (paints
 * immediately, no flash of the default blue), then refreshes from the public
 * branding endpoint. Silent on failure: a theme fetch problem must never
 * block anyone from using the app (same principle as branding elsewhere).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem(THEME_CACHE_KEY);
      if (cached) applyThemeColor(cached);
    } catch { /* ignore */ }

    fetch('/api/public/branding')
      .then(r => r.json())
      .then((data: { primary_color?: string }) => {
        if (data?.primary_color) {
          applyThemeColor(data.primary_color);
          try { window.sessionStorage.setItem(THEME_CACHE_KEY, data.primary_color); } catch { /* quota full — ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  return <>{children}</>;
}
