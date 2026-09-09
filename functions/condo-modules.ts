import { createAdminClient, createClient } from 'npm:@insforge/sdk';

interface ModuleDef {
  name: string;
  description: string;
  default_enabled: boolean;
  default_config: Record<string, unknown>;
}

// Modules managed per condominium. Sprint 1 core areas (condominiums, users,
// structure, residents) are always available and are NOT presented here:
// this section only lists the NEW modules (managed by the global admin
// through the per-condominium activation toggle).
const MODULES: Record<string, ModuleDef> = {
  cart_lending: {
    name: 'Préstamo de Carritos y Multas',
    description: 'Préstamo de carritos de carga con tiempos, períodos de gracia y multas por demora.',
    default_enabled: false,
    default_config: {
      max_loan_minutes: 60,
      fine_enabled: true,
      fine_type: 'FIXED_OR_PER_INTERVAL',
      grace_period_minutes: 10,
      fine_amount: 5,
      fine_interval_minutes: 30
    }
  }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
    const action = (body.action as string) || 'list';
    const schemaName = body.schema_name as string;

    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const isSuperAdmin = await callerIsSuperAdmin(req, client);
    const isTenantAdmin = isSuperAdmin || await callerIsTenantAdmin(req, client, schemaName);
    const db = client.database.schema(schemaName);

    if (action === 'list') {
      const modules = await listModules(db);
      const withFlags = modules.map(m => ({
        ...m,
        can_toggle: isSuperAdmin,
        can_edit_config: isSuperAdmin || isTenantAdmin
      }));
      return json({ success: true, data: { is_superadmin: isSuperAdmin, modules: withFlags }, error: null }, 200);
    }

    if (action === 'update') {
      const moduleKey = String(body.module_key || '');
      const def = MODULES[moduleKey];
      if (!def) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Módulo no reconocido' } }, 400);
      }

      const wantsToggle = typeof body.is_enabled === 'boolean';
      const wantsConfig = body.config && typeof body.config === 'object';

      // Only the global admin can activate/deactivate a module
      if (wantsToggle && !isSuperAdmin) {
        return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Solo el administrador global puede activar o desactivar módulos' } }, 403);
      }
      // Config edits are allowed for the global admin and the condominium admin
      if (wantsConfig && !isSuperAdmin && !isTenantAdmin) {
        return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para editar la configuración' } }, 403);
      }

      // When only the config is edited (no explicit toggle), keep the current
      // enabled state instead of resetting it to the module default.
      let currentEnabled: boolean | null = null;
      if (!wantsToggle) {
        const { data: cur } = await db.from('condo_settings').select('is_enabled').eq('module_key', moduleKey).single();
        currentEnabled = cur ? Boolean((cur as { is_enabled: boolean }).is_enabled) : null;
      }

      const nextEnabled = wantsToggle
        ? body.is_enabled as boolean
        : (currentEnabled ?? def.default_enabled);
      const nextConfig = wantsConfig
        ? sanitizeConfig(moduleKey, body.config as Record<string, unknown>)
        : def.default_config;

      const now = new Date().toISOString();

      // Existing secrets.json style upsert: update if present, else insert
      await db.from('condo_settings').update({ is_enabled: nextEnabled, config_json: nextConfig, updated_at: now }).eq('module_key', moduleKey);
      const { data: existing } = await db.from('condo_settings').select('id').eq('module_key', moduleKey).single();
      if (!existing) {
        await db.from('condo_settings').insert([{ module_key: moduleKey, is_enabled: nextEnabled, config_json: nextConfig }]);
      }

      const { data: row } = await db.from('condo_settings').select('module_key, is_enabled, config_json, updated_at').eq('module_key', moduleKey).single();
      return json({ success: true, data: row || { module_key: moduleKey, is_enabled: nextEnabled, config_json: nextConfig }, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in condo-modules:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function listModules(db: { from(t: string): any }) {
  const { data: rows } = await db.from('condo_settings').select('module_key, is_enabled, config_json, updated_at');

  const map = new Map<string, { is_enabled: boolean; config_json: Record<string, unknown> }>();
  for (const r of (rows || []) as Array<{ module_key: string; is_enabled: boolean; config_json: unknown }>) {
    const cfg = (r.config_json && typeof r.config_json === 'object') ? (r.config_json as Record<string, unknown>) : {};
    map.set(r.module_key, { is_enabled: r.is_enabled, config_json: cfg });
  }

  return Object.entries(MODULES).map(([key, def]) => {
    const row = map.get(key);
    return {
      module_key: key,
      name: def.name,
      description: def.description,
      is_enabled: row ? row.is_enabled : def.default_enabled,
      config_json: row ? { ...def.default_config, ...row.config_json } : def.default_config
    };
  });
}

function sanitizeConfig(key: string, config: Record<string, unknown>): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...config };
  if (key === 'cart_lending') {
    delete cfg.gates_count;
    delete cfg.carts_per_gate;
    const num = (v: unknown, d: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : d;
    };
    cfg.max_loan_minutes = Math.round(num(cfg.max_loan_minutes, 60));
    cfg.fine_enabled = cfg.fine_enabled !== false;
    cfg.grace_period_minutes = Math.round(num(cfg.grace_period_minutes, 10));
    cfg.fine_amount = num(cfg.fine_amount, 5);
    cfg.fine_interval_minutes = Math.round(num(cfg.fine_interval_minutes, 30));
    if (cfg.fine_type !== 'FIXED' && cfg.fine_type !== 'PER_INTERVAL' && cfg.fine_type !== 'FIXED_OR_PER_INTERVAL') cfg.fine_type = 'FIXED_OR_PER_INTERVAL';
  }
  return cfg;
}

async function callerIsTenantAdmin(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
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

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SUPER_ADMIN', 'ADMIN']).single();
    return Boolean(tu);
  } catch { return false; }
}

async function callerIsSuperAdmin(req: Request, client: ReturnType<typeof createAdminClient>): Promise<boolean> {
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}