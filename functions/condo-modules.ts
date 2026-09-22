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
  },
  parking_control: {
    name: 'Estacionamientos y Préstamos',
    description: 'Estacionamientos, vehículos por departamento, préstamos de estacionamiento entre propietarios y registros de entrada/salida en garita por puerta.',
    default_enabled: true,
    default_config: {}
  },
  visitor_access: {
    name: 'Acceso de Visitantes',
    description: 'Visitas anticipadas con pase QR, control de paquetería y delivery en garita, con historial de accesos.',
    default_enabled: false,
    default_config: {
      max_simultaneous_per_department: 2
    }
  },
  tower_boards: {
    name: 'Junta Directiva de Torre',
    description: 'Elección del Presidente, Secretario y Tesorero de cada torre (solo residentes de la torre), con vigencia de un año prorrogable mediante elecciones.',
    default_enabled: false,
    default_config: {
      term_months: 12
    }
  },
  general_board: {
    name: 'Junta Directiva General',
    description: 'Elección de la Junta Directiva General (Presidente, Secretario y Tesorero) a partir de los miembros de las juntas directivas de las torres, con vigencia de un año prorrogable mediante elecciones.',
    default_enabled: false,
    default_config: {
      term_months: 12
    }
  },
  billing_maintenance: {
    name: 'Facturación y Mantenimiento',
    description: 'Emisión de recibos de cuotas de mantenimiento por departamento, cobro de multas operativas (incluidas las de carritos) y control de morosidad.',
    default_enabled: false,
    default_config: {
      default_fee: 150,
      due_days: 5,
      autolink_cart_fines: true
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
      // Condominium admins (and the super admin) manage their modules: they see
      // all of them (active + inactive) so they can activate/deactivate.
      const visible = (isSuperAdmin || isTenantAdmin) ? modules : modules.filter(m => m.is_enabled);
      const withFlags = visible.map(m => ({
        ...m,
        can_toggle: isSuperAdmin || isTenantAdmin,
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

      // Only admins (global or of this condominium) can activate/deactivate modules
      if (wantsToggle && !isSuperAdmin && !isTenantAdmin) {
        return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para activar o desactivar módulos' } }, 403);
      }
      // Config edits are allowed for the global admin and the condominium admin
      if (wantsConfig && !isSuperAdmin && !isTenantAdmin) {
        return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para editar la configuración' } }, 403);
      }

      // Dependency rule: the general board module requires the tower boards
      // module to be enabled for this condominium.
      if (moduleKey === 'general_board' && wantsToggle && body.is_enabled === true) {
        const towerOn = await moduleEnabled(db, 'tower_boards');
        if (!towerOn) {
          return json({ success: false, data: null, error: { code: 'DEPENDENCY_REQUIRED', message: 'Para activar la Junta Directiva General primero debes activar el módulo Junta Directiva de Torre.' } }, 409);
        }
      }
      // Symmetric guard: tower boards cannot be deactivated while the general
      // board module depends on it and is still active.
      if (moduleKey === 'tower_boards' && wantsToggle && body.is_enabled === false) {
        const generalOn = await moduleEnabled(db, 'general_board');
        if (generalOn) {
          return json({ success: false, data: null, error: { code: 'DEPENDENCY_BLOCKED', message: 'No puedes desactivar Junta Directiva de Torre mientras la Junta Directiva General esté activa. Desactiva primero la Junta Directiva General.' } }, 409);
        }
      }

      // Preserve the field that is not being updated: toggling the module must
      // keep the current config (e.g. the parking layout), and editing the
      // config must keep the current enabled state.
      const { data: cur } = await db.from('condo_settings').select('is_enabled, config_json').eq('module_key', moduleKey).single();
      const curEnabled = cur ? Boolean((cur as { is_enabled: boolean }).is_enabled) : null;
      const curConfig = (cur && (cur as { config_json: unknown }).config_json && typeof (cur as { config_json: unknown }).config_json === 'object')
        ? ((cur as { config_json: Record<string, unknown> }).config_json)
        : def.default_config;

      const nextEnabled = wantsToggle
        ? body.is_enabled as boolean
        : (curEnabled ?? def.default_enabled);
      const nextConfig = wantsConfig
        ? sanitizeConfig(moduleKey, body.config as Record<string, unknown>)
        : { ...def.default_config, ...curConfig };

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

async function moduleEnabled(db: { from(t: string): any }, key: string): Promise<boolean> {
  try {
    const { data } = await db.from('condo_settings').select('is_enabled').eq('module_key', key).single();
    return Boolean(data && (data as { is_enabled: boolean }).is_enabled);
  } catch {
    return false;
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
  if (key === 'parking_control' && cfg.layout && typeof cfg.layout === 'object') {
    const layout = cfg.layout as Record<string, unknown>;
    const rows = Math.max(1, Math.min(50, Math.round(Number(layout.rows) || 1)));
    if (Array.isArray(layout.spots_per_row)) {
      const counts: number[] = (layout.spots_per_row as unknown[]).map(v => Math.max(1, Math.min(50, Math.round(Number(v) || 1))));
      while (counts.length < rows) counts.push(counts[counts.length - 1] || 1);
      cfg.layout = { rows, spots_per_row: counts.slice(0, rows) };
    } else {
      const per = Math.max(1, Math.min(50, Math.round(Number(layout.spots_per_row) || 1)));
      cfg.layout = { rows, spots_per_row: per };
    }
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