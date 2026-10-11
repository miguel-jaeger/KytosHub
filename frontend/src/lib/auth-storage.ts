const KEY = 'kytos_auth';
export const ACTIVE_CONDOMINIUM_KEY = 'kytoshub_active_condominium';

export interface StoredAuthUser {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

interface StoredAuth {
  token: string;
  user: StoredAuthUser;
}

// Reads the "exp" claim from a JWT without trusting the payload: if the token
// can not be decoded it is treated as unusable so a corrupt value never keeps
// an unauthenticated session alive.
function readJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const match = decoded.match(/"exp"\s*:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// With a small leeway so a token that is about to expire is never restored.
export function isTokenExpired(token: string, leewaySeconds = 30): boolean {
  const exp = readJwtExpiry(token);
  if (exp === null) return true;
  return exp * 1000 <= Date.now() + leewaySeconds * 1000;
}

export function saveAuth(token: string, user: StoredAuthUser): void {
  try {
    if (typeof token !== 'string' || !token || !user?.id) return;
    // Never persist a token that can not be used: it would only be read back as
    // a broken session after a reload.
    if (isTokenExpired(token, 0)) { localStorage.removeItem(KEY); return; }
    localStorage.setItem(KEY, JSON.stringify({ token, user } as StoredAuth));
  } catch {}
}

export function loadAuth(): StoredAuth | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token || !parsed.user?.id) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt/partial JSON: drop it so the next load starts clean instead of
    // trapping the user in a broken state they would have to fix by hand.
    try { localStorage.removeItem(KEY); } catch {}
    return null;
  }
}

export function clearAuth(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

// Removes any leftover condominium selection so it can not leak between
// accounts (e.g. a resident inheriting a previously selected condominium).
export function clearStoredCondominium(): void {
  try { localStorage.removeItem(ACTIVE_CONDOMINIUM_KEY); } catch {}
}
