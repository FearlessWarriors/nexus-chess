/**
 * AuthContext.tsx — Authentication State Management
 *
 * Provides:
 *   - AuthContext with user, token, isLoggedIn state
 *   - login(), register(), logout() functions
 *   - updateBadge() method for editing badge text
 *   - Auto token validation on mount (GET /api/v1/auth/me)
 *   - useAuth() Hook
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserInfo {
  id: number;
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  is_admin: boolean;
  badge_text: string;
  badge_type: string;
  suspended: boolean;
  suspended_reason?: string;
  rank?: number;
  created_at?: string;
  last_seen_at?: string;
}

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (name: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateBadge: (text: string) => void;
}

// ─── API Base URL ────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3001';

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthCtx = createContext<AuthContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: localStorage.getItem('nexus-token'),
    isLoggedIn: false,
    isLoading: true,
  });

  // Auto-validate token on mount
  useEffect(() => {
    const token = state.token;
    if (token === null) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    let cancelled = false;

    fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Token invalid');
        }
        const data = await res.json();
        if (!cancelled) {
          const raw = data.user;
          setState({
            user: {
              id: raw.id,
              name: raw.name,
              elo: raw.elo,
              wins: raw.wins,
              losses: raw.losses,
              draws: raw.draws,
              is_admin: raw.is_admin === true || raw.is_admin === 1,
              badge_text: raw.badge_text ?? '',
              badge_type: raw.badge_type ?? '',
              suspended: raw.suspended === true || raw.suspended === 1,
              suspended_reason: raw.suspended_reason ?? undefined,
              rank: raw.rank,
              created_at: raw.created_at,
              last_seen_at: raw.last_seen_at,
            },
            token,
            isLoggedIn: true,
            isLoading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem('nexus-token');
          setState({
            user: null,
            token: null,
            isLoggedIn: false,
            isLoading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── login ────────────────────────────────────────────────────────────────

  const login = useCallback(
    async (
      name: string,
      password: string,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), password }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error ?? '登录失败' };
        }

        localStorage.setItem('nexus-token', data.token);
        const raw = data.user;
        setState({
          user: {
            id: raw.id,
            name: raw.name,
            elo: raw.elo,
            wins: raw.wins,
            losses: raw.losses,
            draws: raw.draws,
            is_admin: raw.is_admin === true || raw.is_admin === 1,
            badge_text: raw.badge_text ?? '',
            badge_type: raw.badge_type ?? '',
            suspended: raw.suspended === true || raw.suspended === 1,
          },
          token: data.token,
          isLoggedIn: true,
          isLoading: false,
        });

        return { success: true };
      } catch {
        return { success: false, error: '网络错误，请重试' };
      }
    },
    [],
  );

  // ── register ─────────────────────────────────────────────────────────────

  const register = useCallback(
    async (
      name: string,
      password: string,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), password }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error ?? '注册失败' };
        }

        localStorage.setItem('nexus-token', data.token);
        const raw = data.user;
        setState({
          user: {
            id: raw.id,
            name: raw.name,
            elo: raw.elo,
            wins: raw.wins,
            losses: raw.losses,
            draws: raw.draws,
            is_admin: raw.is_admin === true || raw.is_admin === 1,
            badge_text: raw.badge_text ?? '',
            badge_type: raw.badge_type ?? '',
            suspended: raw.suspended === true || raw.suspended === 1,
          },
          token: data.token,
          isLoggedIn: true,
          isLoading: false,
        });

        return { success: true };
      } catch {
        return { success: false, error: '网络错误，请重试' };
      }
    },
    [],
  );

  // ── logout ───────────────────────────────────────────────────────────────

  const logout = useCallback(() => {
    localStorage.removeItem('nexus-token');
    setState({
      user: null,
      token: null,
      isLoggedIn: false,
      isLoading: false,
    });
  }, []);

  // ── updateBadge ──────────────────────────────────────────────────────────

  const updateBadge = useCallback((text: string) => {
    setState((prev) => {
      if (prev.user === null) return prev;
      return {
        ...prev,
        user: { ...prev.user, badge_text: text },
      };
    });
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    updateBadge,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (ctx === null) {
    throw new Error('useAuth() must be used within <AuthProvider>');
  }
  return ctx;
}
