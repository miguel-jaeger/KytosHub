import { createClient } from '@insforge/sdk';

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

export async function invokeFunction<T>(
  slug: string,
  options: InvokeOptions = {}
): Promise<{ data: T | null; error: Error | null }> {
  const { method = 'GET', body, headers = {} } = options;

  try {
    const { data, error } = await insforge.functions.invoke(slug, {
      method,
      body,
      headers
    });

    if (error) throw error;

    return { data: data as T, error: null };
  } catch (error) {
    console.error(`Function ${slug} failed:`, error);
    const e = error as { error?: unknown; message?: unknown };
    let msg: string | undefined;
    if (e && typeof e.error === 'object' && e.error !== null && 'message' in e.error) {
      msg = String((e.error as { message: unknown }).message || '');
    }
    if (!msg && typeof e?.message === 'string' && e.message) msg = e.message;
    if (!msg && error instanceof Error && error.message) msg = error.message;
    return { data: null, error: new Error(msg || 'Error de conexión') };
  }
}