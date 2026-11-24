import { createAdminClient } from 'npm:@insforge/sdk';

// Endpoint público y sin autenticación para cron externos y GitHub Actions.
// Cada invocación:
//   1. Cuenta como actividad de "functions" en InsForge.
//   2. Inserta una fila en public.keepalive_runs (actividad de base de datos).
// El campo `source` se puede pasar con ?source=github|external|manual.

const ALLOWED_SOURCES = new Set(['github', 'external', 'manual', 'unknown']);

export default async function (req: Request): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(req.url);

  const rawSource = (
    url.searchParams.get('source') ||
    req.headers.get('x-keepalive-source') ||
    'external'
  ).toLowerCase();
  const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'unknown';

  const clientIp =
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;

  let status: 'success' | 'failure' = 'success';
  let httpStatus = 200;
  let errorMessage: string | null = null;

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    const { data: inserted, error } = await client.database
      .from('keepalive_runs')
      .insert([
        {
          source,
          status: 'success',
          http_status: 200,
          client_ip: clientIp,
          user_agent: userAgent,
          details: { method: req.method, path: url.pathname }
        }
      ])
      .select('id')
      .single();

    if (error) throw error;

    // La duración total solo se conoce después del insert. Si esta actualización
    // falla no debe romper el keepalive: el ping ya quedó registrado.
    if (inserted?.id) {
      try {
        await client.database
          .from('keepalive_runs')
          .update({ duration_ms: Date.now() - startedAt })
          .eq('id', inserted.id);
      } catch {
        /* la métrica de duración es best-effort */
      }
    }
  } catch (error) {
    status = 'failure';
    httpStatus = 500;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  return new Response(
    JSON.stringify({
      ok: status === 'success',
      service: 'insforge-keepalive',
      source,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      ...(errorMessage ? { error: errorMessage } : {})
    }),
    {
      status: httpStatus,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
