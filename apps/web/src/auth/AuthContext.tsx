import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser, LoginInput, LoginResponse } from '@dalmia/types';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../api/client';
import { unlinkPush } from '../lib/push';

interface AuthState {
  user: AuthUser | null;
  /** true until the initial silent refresh has finished. */
  loading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((data) => {
      if (cancelled) return;
      setUser(data?.user ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setSessionLostHandler(null);
  }, [queryClient]);

  const login = useCallback(async (input: LoginInput) => {
    const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: input });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await unlinkPush(); // while still signed in: the server only lets the owner unlink
      await api<void>('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
