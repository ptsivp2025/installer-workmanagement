'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSession, verifySessionFromCookie, refreshDbTokenIfNeeded, type SessionUserProfile } from '@/lib/auth';

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
