const KEY = 'kytos_auth';

export interface StoredAuthUser {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

interface StoredAuth {
  token: string;
  refreshToken?: string;
  user: StoredAuthUser;
}

export function saveAuth(token: string, user: StoredAuthUser, refreshToken?: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, refreshToken, user } as StoredAuth));
  } catch {}
}

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}