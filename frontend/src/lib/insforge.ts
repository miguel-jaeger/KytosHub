import { createClient } from '@insforge/sdk';
import { translateAuthError } from './errors';
import { clearAuth, clearStoredCondominium } from './auth-storage';

const INSFORGE_URL = import.meta.env.VITE_INSFORGE_URL || 'https://5vvsyy6z.us-east.insforge.app';
const ANON_KEY = import.meta.env.VITE_INSFORGE_ANON_KEY || 'anon_5f9299a95b22ec28e9448096df4bf583846acc6706e489d739c8b0a6c8b0bc14';

export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: ANON_KEY
});

interface InvokeOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

const REFRESHABLE_AUTH_CODES = new Set([
  'AUTH_UNAUTHORIZED', 'PGRST301', 'UNAUTH', 'UNAUTHORIZED', 'AUTH_TOKEN_EXPIRED', 'TOKEN_EXPIRED', 'JWT_EXPIRED'
]);

function getErrorCode(value: unknown): string | null {
  if (typeof value === 'string') return value.toUpperCase();
  if (!value || typeof value !== 'object') return null;
  const error = value as { code?: unknown; error?: unknown };
  if (typeof error.code === 'string') return error.code.toUpperCase();
  if (typeof error.error === 'string') return error.error.toUpperCase();
  return null;
}

function isExpiredAuthError(error: unknown, data: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  if (statusCode === 401) return true;
  const payloadError = (data as { error?: unknown } | null)?.error;
  if (REFRESHABLE_AUTH_CODES.has(getErrorCode(error) || '') || REFRESHABLE_AUTH_CODES.has(getErrorCode(payloadError) || '')) return true;
  const message = String((error as { message?: unknown } | null)?.message || (payloadError as { message?: unknown } | null)?.message || '');
  return /(?:access|refresh|jwt|session) token.{0,24}(?:expired|invalid)|token expired/i.test(message);
}

export async function invokeFunction<T>(
  slug: string,
  options: InvokeOptions = {}
): Promise<{ data: T | null; error: Error | null }> {
  const { method = 'GET', body, headers = {} } = options;

  try {
    const invoke = () => insforge.functions.invoke(slug, {
      method,
      body,
      headers
    });
    // Always use the browser's httpOnly refresh cookie, never an old local token.
    insforge.getHttpClient().setRefreshToken(null);
    try {
      await insforge.getHttpClient().getValidAccessToken();
    } catch {
      // Let the request path below return its normal auth error if refresh is unavailable.
    }
    let response = await invoke();

    if (isExpiredAuthError(response.error, response.data)) {
      const { data: refreshed, error: refreshError } = await insforge.auth.refreshSession();
      if (!refreshError && refreshed?.accessToken) {
        insforge.getHttpClient().setRefreshToken(null);
        response = await invoke();
      } else if (refreshError && [401, 403].includes(refreshError.statusCode || 0)) {
        // The refresh cookie itself is no longer valid; clear the stale UI session.
        clearAuth();
        clearStoredCondominium();
        try { insforge.getHttpClient().setAuthToken(null); } catch {}
        try { await insforge.auth.signOut(); } catch {}
      }
    }

    if (response.error) {
      // A token that is rejected even after a refresh attempt is unusable: purge
      // the stored session so the next load shows the login screen instead of a
      // broken, half-authenticated app.
      if (isExpiredAuthError(response.error, response.data)) {
        clearAuth();
        try { insforge.getHttpClient().setAuthToken(null); } catch {}
      }
      throw response.error;
    }

    return { data: response.data as T, error: null };
  } catch (error) {
    console.error(`Function ${slug} failed:`, error);
    const e = error as { error?: unknown; message?: unknown };
    let msg: string | undefined;
    if (e && typeof e.error === 'object' && e.error !== null && 'message' in e.error) {
      msg = String((e.error as { message: unknown }).message || '');
    }
    if (!msg && typeof e?.message === 'string' && e.message) msg = e.message;
    if (!msg && error instanceof Error && error.message) msg = error.message;
    return { data: null, error: new Error(translateAuthError(msg || 'Error de conexión')) };
  }
}
