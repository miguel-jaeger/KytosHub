const INSFORGE_URL = import.meta.env.VITE_INSFORGE_URL || '';
const FUNCTIONS_URL = `${INSFORGE_URL}/functions/v1`;

interface InvokeOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function invokeFunction<T>(
  slug: string,
  options: InvokeOptions = {}
): Promise<{ data: T | null; error: Error | null }> {
  const { method = 'GET', body, headers = {} } = options;

  try {
    const response = await fetch(`${FUNCTIONS_URL}/${slug}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error('Error de conexión')
    };
  }
}
