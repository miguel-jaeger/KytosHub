import { createAdminClient, createClient } from 'npm:@insforge/sdk';

// Endpoint de solo lectura para que el super admin vea el estado del cron.
// Valida el JWT del usuario y exige users_global.is_superadmin = true.
// La tabla keepalive_runs y la vista keepalive_status están cerradas para
// anon/authenticated; este endpoint las consulta con la API key de admin.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const accessToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      return json({ success: false, data: null, error: { code: 'UNAUTH', message: 'No autenticado' } }, 401);
    }

    const admin = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    const userClient = createClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      accessToken
    });
    const { data: current, error: authError } = await userClient.auth.getCurrentUser();
    const userId = current?.user?.id;
    if (authError || !userId) {
      return json({ success: false, data: null, error: { code: 'UNAUTH', message: 'La sesión no es válida' } }, 401);
    }

    const { data: globalUser, error: globalUserError } = await admin.database
      .from('users_global')
      .select('is_superadmin')
      .eq('id', userId)
      .maybeSingle();
    if (globalUserError) throw globalUserError;
    if (!(globalUser as { is_superadmin?: boolean } | null)?.is_superadmin) {
      return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Solo el super admin puede ver el estado del cron' } }, 403);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action || 'get');
    if (action !== 'get') {
      return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
    }

    const rawLimit = Number(body.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 50;

    const [statusResult, runsResult] = await Promise.all([
      admin.database
        .from('keepalive_status')
        .select('source, last_run_at, last_status, last_http_status, last_duration_ms, last_client_ip, last_user_agent, last_details, time_since_last_run, is_stale')
        .order('source'),
      admin.database
        .from('keepalive_runs')
        .select('id, source, status, http_status, executed_at, duration_ms, client_ip, user_agent, details')
        .order('executed_at', { ascending: false })
        .limit(limit)
    ]);

    if (statusResult.error) throw statusResult.error;
    if (runsResult.error) throw runsResult.error;

    return json({
      success: true,
      data: {
        status: statusResult.data || [],
        runs: runsResult.data || [],
        generated_at: new Date().toISOString()
      },
      error: null
    }, 200);
  } catch (error) {
    console.error('Error in keepalive-admin:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}
