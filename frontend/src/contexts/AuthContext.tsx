import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { insforge, invokeFunction } from '../lib/insforge';
import { saveAuth, loadAuth, clearAuth } from '../lib/auth-storage';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; requireVerification: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateAvatar: (url: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapUser(raw: Record<string, unknown>): AuthUser {
  const profile = raw.profile as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
    email: String(raw.email ?? ''),
    name: profile?.name as string | undefined,
    avatar_url: profile?.avatar_url as string | undefined
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      // Google/other OAuth callback landing: always let the SDK process the
      // authorization code (never reuse a cached token over it).
      const isOAuthCallback = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('insforge_code');
      if (isOAuthCallback) {
        const { data, error } = await insforge.auth.getCurrentUser();
        if (!cancelled && !error && data?.user) {
          setUser(mapUser(data.user));
        }
        return;
      }

      // Restore the persisted token from localStorage and validate auth + role.
      const cached = loadAuth();
      if (cached?.token) {
        insforge.setAccessToken(cached.token);
        const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
          method: 'POST',
          body: { action: 'list-by-user', user_id: cached.user.id }
        });
        if (!cancelled && !error && data?.success) {
          setUser({ id: cached.user.id, email: cached.user.email, name: cached.user.name, avatar_url: cached.user.avatar_url });
          return;
        }
        if (!cancelled) {
          // The persisted access token may have expired: let the SDK refresh
          // the session (refresh/CSRF cookies) before giving up.
          const { data: current, error: currentError } = await insforge.auth.getCurrentUser();
          if (!currentError && current?.user) {
            setUser(mapUser(current.user));
            return;
          }
          clearAuth();
          try { await insforge.auth.signOut(); } catch {}
        }
        return;
      }

      // No persisted token: rely on the SDK session (e.g. OAuth cookie refresh).
      const { data, error } = await insforge.auth.getCurrentUser();
      if (!cancelled && !error && data?.user) {
        setUser(mapUser(data.user));
      }
    }

    void hydrateAuth().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    if (data?.user) {
      const u = mapUser(data.user as unknown as Record<string, unknown>);
      setUser(u);
      const token = (data as { accessToken?: string }).accessToken;
      if (token) saveAuth(token, u);
    }
    return { error: null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { data, error } = await insforge.auth.signUp({
      email,
      password,
      name,
      redirectTo: window.location.origin
    });

    if (error) {
      return { error: error.message, requireVerification: false };
    }

    if (data?.accessToken) {
      if (data.user) {
        const u = mapUser(data.user as unknown as Record<string, unknown>);
        setUser(u);
        saveAuth(data.accessToken, u);
      }
      return { error: null, requireVerification: false };
    }

    return { error: null, requireVerification: Boolean(data?.requireEmailVerification) };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await insforge.auth.signInWithOAuth('google', {
      redirectTo: window.location.origin
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await insforge.auth.signOut();
    clearAuth();
    setUser(null);
  }, []);

  const updateAvatar = useCallback((url: string) => {
    setUser(prev => prev ? { ...prev, avatar_url: url } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithPassword, signUp, signInWithGoogle, signOut, updateAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
