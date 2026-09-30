import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const DEFAULT_STATS = {
  id: 1,
  access_total: 0,
  access_inside: 0,
  access_entry_today: 0,
  access_exit_total: 0,
  access_exit_today: 0,
  vehicles_total: 0,
  spots_total: 0,
  spots_occupied: 0,
  parking_loans_total: 0,
  parking_loans_active: 0,
  carts_total: 0,
  carts_disponible: 0,
  carts_prestado: 0,
  carts_mantenimiento: 0,
  cart_loans_total: 0,
  cart_loans_active: 0
};

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = (body.action as string) || 'get';
    const schemaName = body.schema_name as string;

    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const isAdmin = await isAdminForSchema(req, client, schemaName);
    const isSecurity = await isSecurityForSchema(req, client, schemaName);

    if (action === 'get') {
      if (!isAdmin && !isSecurity) return forbidden();
      const db = client.database.schema(schemaName);
      const { data, error } = await db.from('condo_stats').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      const stats = data ? { ...DEFAULT_STATS, ...data } : DEFAULT_STATS;
      // Informa si el llamador es super admin global para mostrar las opciones de
      // limpieza/borrado en el frontend de forma confiable.
      const isSuper = await isGlobalSuperAdmin(req, client);
      return json({ success: true, data: { ...stats, is_superadmin: isSuper }, error: null }, 200);
    }

    if (action === 'reset') {
      // Only the global super admin can clear the statistics.
      if (!(await isGlobalSuperAdmin(req, client))) return forbidden();
      const db = client.database.schema(schemaName);
      const area = String(body.area || 'all');

      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (area === 'parking' || area === 'all') {
        // Actividad del estacionamiento (accesos, ocupación, préstamos). No toca
        // spots_total ni vehicles_total, que son datos de registro/config.
        for (const k of ['access_total', 'access_inside', 'access_entry_today', 'access_exit_total', 'access_exit_today', 'spots_occupied', 'parking_loans_total', 'parking_loans_active']) {
          update[k] = 0;
        }
      }
      if (area === 'carts' || area === 'all') {
        for (const k of ['carts_total', 'carts_disponible', 'carts_prestado', 'carts_mantenimiento', 'cart_loans_total', 'cart_loans_active']) {
          update[k] = 0;
        }
      }

      const { error } = await db.from('condo_stats').update(update).eq('id', 1);
      if (error) throw error;
      const { data } = await db.from('condo_stats').select('*').eq('id', 1).maybeSingle();
      return json({ success: true, data: data ? { ...DEFAULT_STATS, ...data } : DEFAULT_STATS, error: null }, 200);
    }

    if (action === 'clear-history') {
      // Only the global super admin can delete operational history.
      if (!(await isGlobalSuperAdmin(req, client))) return forbidden();
      const db = client.database.schema(schemaName);
      const area = String(body.area || 'all');
      const NEUTRAL_ID = '00000000-0000-0000-0000-000000000000';

      if (area === 'parking' || area === 'all') {
        // Historial del estacionamiento: accesos y préstamos, y limpieza del
        // estado de ocupación de las plazas (derivado de los accesos abiertos).
        try { await db.from('parking_access_logs').delete().neq('id', NEUTRAL_ID); } catch (e) { console.error('clear parking logs:', e); }
        try { await db.from('parking_loans').delete().neq('id', NEUTRAL_ID); } catch (e) { console.error('clear parking loans:', e); }
        try { await db.from('parking_spots').update({ status: 'DISPONIBLE' }); } catch (e) { console.error('reset spots status:', e); }
      }
      if (area === 'carts' || area === 'all') {
        // Historial de carritos: préstamos y devolución del estado de los carritos.
        try { await db.from('cart_loans').delete().neq('id', NEUTRAL_ID); } catch (e) { console.error('clear cart loans:', e); }
        try { await db.from('carts').update({ status: 'DISPONIBLE' }).in('status', ['PRESTADO', 'ATRASADO']); } catch (e) { console.error('reset carts status:', e); }
      }

      // Recalcula los contadores consolidados (quedan en cero los de actividad).
      try { await db.rpc('refresh_condo_stats'); } catch (e) { console.error('refresh condo stats after clear:', e); }
      const { data } = await db.from('condo_stats').select('*').eq('id', 1).maybeSingle();
      return json({ success: true, data: data ? { ...DEFAULT_STATS, ...data } : DEFAULT_STATS, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in condo-stats:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function isAdminForSchema(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const uid = data?.user?.id;
    if (!uid) return false;

    const { data: ug } = await client.database.from('users_global').select('is_superadmin').eq('id', uid).single();
    if (ug && (ug as { is_superadmin: boolean }).is_superadmin) return true;

    const { data: t } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
    const tenantId = t?.id;
    if (!tenantId) return false;

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SUPER_ADMIN', 'ADMIN']).single();
    return Boolean(tu);
  } catch { return false; }
}

async function isGlobalSuperAdmin(req: Request, client: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const uid = data?.user?.id;
    if (!uid) return false;
    const { data: ug } = await client.database.from('users_global').select('is_superadmin').eq('id', uid).single();
    return Boolean(ug && (ug as { is_superadmin: boolean }).is_superadmin);
  } catch { return false; }
}

async function isSecurityForSchema(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const uid = data?.user?.id;
    if (!uid) return false;

    const { data: t } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
    const tenantId = t?.id;
    if (!tenantId) return false;

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SECURITY_AGENT', 'SUPERVISOR']).single();
    return Boolean(tu);
  } catch { return false; }
}

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}