import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { insforge } from '../lib/insforge';

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      const { data, error } = await insforge.auth.getCurrentUser();
      if (cancelled) return;
      if (!error && data?.user) {
        setUser(mapUser(data.user));
      }
      setLoading(false);
    }

    void hydrateAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const mapUser = (raw: Record<string, unknown>): AuthUser => ({
    id: String(raw.id ?? ''),
    email: String(raw.email ?? ''),
    name: (raw.profile as Record<string, unknown> | undefined)?.name as string | undefined,
    avatar_url: (raw.profile as Record<string, unknown> | undefined)?.avatar_url as string | undefined
  });

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    if (data?.user) {
      setUser(mapUser(data.user));
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
        setUser(mapUser(data.user));
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
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithPassword, signUp, signInWithGoogle, signOut }}>
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