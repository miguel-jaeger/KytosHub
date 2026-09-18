import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
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

// The SDK keeps the session (access token + user) in memory. There is a public
// documented getter (`getValidAccessToken`) that returns a non-expired token,
// refreshing it when near expiry. We fall back to reading the in-memory session
// defensively so the token can be persisted to localStorage and survive reloads.
async function readSdkToken(): Promise<string | null> {
  try {
    const token = await insforge.getHttpClient().getValidAccessToken();
    if (token) return token;
  } catch {}
  try {
    const auth = insforge.auth as unknown as {
      tokenManager?: { getSession?: () => { accessToken?: string } | null };
    };
    return auth?.tokenManager?.getSession?.()?.accessToken ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);

  const applyUser = useCallback((u: AuthUser | null) => {
    userRef.current = u;
    setUser(u);
  }, []);

  const persistSession = useCallback(async (activeUser?: AuthUser) => {
    try {
      const u = activeUser ?? userRef.current;
      if (!u?.id) return;
      const sessionToken = await readSdkToken();
      if (!sessionToken) return;
      // Keep the original refresh token across access-token rotations.
      const stored = loadAuth();
      saveAuth(sessionToken, u, stored?.refreshToken);
    } catch {}
  }, []);

  // Keep localStorage in sync whenever the SDK rotates the session token
  // (sign-in, refresh, OAuth callback).
  useEffect(() => {
    return insforge.auth.onAuthStateChange(() => {
      void persistSession();
    });
  }, [persistSession]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      const isOAuthCallback = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('insforge_code');

      // Google/other OAuth callback landing: let the SDK process the code,
      // then capture its token in localStorage.
      if (isOAuthCallback) {
        const { data, error } = await insforge.auth.getCurrentUser();
        if (!cancelled && !error && data?.user) {
          const u = mapUser(data.user);
          applyUser(u);
          persistSession(u);
        }
        return;
      }

      // Restore the persisted token from localStorage and validate auth + role.
      const cached = loadAuth();
      if (cached?.token) {
        insforge.setAccessToken(cached.token);
        if (cached.refreshToken) {
          insforge.getHttpClient().setRefreshToken(cached.refreshToken || null);
        }
        const res = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
          method: 'POST',
          body: { action: 'list-by-user', user_id: cached.user.id }
        });
        if (!cancelled && !res.error && res.data?.success) {
          const restoredUser = { id: cached.user.id, email: cached.user.email, name: cached.user.name, avatar_url: cached.user.avatar_url };
          applyUser(restoredUser);
          // Sync the stored token in case the SDK rotated it during validation.
          persistSession(restoredUser);
          return;
        }
        if (!cancelled) {
          // The persisted access token may have expired: let the SDK refresh
          // the session (refresh/CSRF cookies) before giving up.
          const { data: current, error: currentError } = await insforge.auth.getCurrentUser();
          if (!currentError && current?.user) {
            const u = mapUser(current.user);
            applyUser(u);
            persistSession(u);
            return;
          }
          clearAuth();
          try { await insforge.auth.signOut(); } catch {}
        }
        return;
      }

      // No persisted token: rely on the SDK session (e.g. OAuth cookie refresh)
      // and persist it so the next reload does not depend on cookies.
      const { data, error } = await insforge.auth.getCurrentUser();
      if (!cancelled && !error && data?.user) {
        const u = mapUser(data.user);
        applyUser(u);
        persistSession(u);
      }
    }

    void hydrateAuth().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applyUser, persistSession]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    if (data?.user) {
      const u = mapUser(data.user as unknown as Record<string, unknown>);
      applyUser(u);
      const sessionData = data as { accessToken?: string; refreshToken?: string };
      const stored = loadAuth();
      if (sessionData.accessToken) saveAuth(sessionData.accessToken, u, sessionData.refreshToken || stored?.refreshToken);
    }
    return { error: null };
  }, [applyUser]);

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
        applyUser(u);
        const sessionData = data as { refreshToken?: string };
        const stored = loadAuth();
        saveAuth(data.accessToken, u, sessionData.refreshToken || stored?.refreshToken);
      }
      return { error: null, requireVerification: false };
    }

    return { error: null, requireVerification: Boolean(data?.requireEmailVerification) };
  }, [applyUser, persistSession]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await insforge.auth.signInWithOAuth('google', {
      redirectTo: window.location.origin
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await insforge.auth.signOut();
    clearAuth();
    applyUser(null);
  }, [applyUser]);

  const updateAvatar = useCallback((url: string) => {
    setUser(prev => prev ? { ...prev, avatar_url: url } : prev);
    userRef.current = userRef.current ? { ...userRef.current, avatar_url: url } : userRef.current;
    if (userRef.current) {
      const stored = loadAuth();
      if (stored) saveAuth(stored.token, userRef.current, stored.refreshToken);
    }
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