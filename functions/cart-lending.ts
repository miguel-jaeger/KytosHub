import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const DEFAULT_CONFIG = {
  max_loan_minutes: 60,
  fine_enabled: true,
  fine_type: 'FIXED_OR_PER_INTERVAL',
  grace_period_minutes: 10,
  fine_amount: 5,
  fine_interval_minutes: 30
};

const CART_TYPES = ['CARGA', 'COMPRA'];

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = (body.action as string) || 'list-carts';
    const schemaName = body.schema_name as string;

    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const config = await getModuleConfig(client, schemaName);
    if (!config) {
      return json({ success: false, data: null, error: { code: 'MODULE_DISABLED', message: 'Módulo inactivo para este condominio' } }, 403);
    }

    const db = client.database.schema(schemaName);
    const isAdmin = await isAdminForSchema(req, client, schemaName);
    const isOperator = isAdmin || await isSecurityForSchema(req, client, schemaName);

    switch (action) {
      case 'list-carts': {
        const { data, error } = await db.from('carts').select('*').order('code_identifier');
        if (error) throw error;
        const carts = await enrichCarts(db, data || []);
        return json({ success: true, data: carts, error: null }, 200);
      }

      case 'create-cart': {
        if (!isAdmin) return forbidden();
        const code = String(body.code_identifier || '').trim();
        if (!code) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Código del carrito es requerido' } }, 400);
        const cartType = normalizeCartType(body.cart_type);
        const gate = await resolveGate(db, body.gate_id);

        const { data: existing } = await db.from('carts').select('id').eq('code_identifier', code).single();
        if (existing) return json({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe un carrito con ese código' } }, 409);

        if (gate && !(await gateHasCapacity(db, gate, null, cartType))) {
          return json({ success: false, data: null, error: { code: 'CAPACITY', message: `La ${gate.name} ya alcanzó su límite de ${cartType === 'CARGA' ? gate.carts_carga : gate.carts_compra} carritos de ${cartType === 'CARGA' ? 'carga' : 'compras'}` } }, 409);
        }

        const { data, error } = await db.from('carts').insert([{
          code_identifier: code,
          qr_code_hash: body.qr_code_hash || null,
          status: body.status || 'DISPONIBLE',
          gate_id: gate?.id || null,
          cart_type: cartType,
          notes: body.notes || null
        }]).select().single();
        if (error) throw error;
        const enriched = (await enrichCarts(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 201);
      }

      case 'update-cart': {
        if (!isAdmin) return forbidden();
        if (!body.id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const updates: Record<string, unknown> = {};
        if (body.code_identifier !== undefined) updates.code_identifier = String(body.code_identifier).trim();
        if (body.status !== undefined) updates.status = body.status;
        if (body.notes !== undefined) updates.notes = body.notes;
        let newType = updates.cart_type as string | undefined;
        if (body.cart_type !== undefined) {
          newType = normalizeCartType(body.cart_type);
          updates.cart_type = newType;
        }
        if (body.gate_id !== undefined) {
          const gate = await resolveGate(db, body.gate_id);
          updates.gate_id = gate?.id || null;
          if (gate && !(await gateHasCapacity(db, gate, String(body.id), newType || (body.cart_type as string) || 'CARGA'))) {
            return json({ success: false, data: null, error: { code: 'CAPACITY', message: `La ${gate.name} ya alcanzó su límite de carritos de ${(newType || 'CARGA') === 'CARGA' ? 'carga' : 'compras'}` } }, 409);
          }
        }
        const { data, error } = await db.from('carts').update(updates).eq('id', body.id).select().single();
        if (error) throw error;
        const enriched = (await enrichCarts(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'delete-cart': {
        if (!isAdmin) return forbidden();
        if (!body.id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { error } = await db.from('carts').delete().eq('id', body.id);
        if (error) throw error;
        return json({ success: true, data: null, error: null }, 200);
      }

      case 'list-loans': {
        const q = db.from('cart_loans').select('*');
        if (body.active_only === true) q.eq('status', 'ACTIVO');
        const { data: loans, error } = await q.order('checkout_time', { ascending: false });
        if (error) throw error;

        const cartIds = [...new Set((loans || []).map((l: { cart_id: string }) => l.cart_id))];
        const deptIds = [...new Set((loans || []).map((l: { department_id: string }) => l.department_id))];
        const carts = cartIds.length
          ? ((await db.from('carts').select('id, code_identifier, status, gate_id, cart_type').in('id', cartIds)).data || [])
          : [];
        const deptRows = deptIds.length
          ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
          : [];
        const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
        const towers = towerIds.length
          ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
          : [];
        const gateIds = [...new Set((carts as Array<{ gate_id: string | null }>).map(c => c.gate_id).filter(Boolean))];
        const gateRows = gateIds.length
          ? ((await db.from('condo_gates').select('id, name').in('id', gateIds)).data || [])
          : [];
        const cartMap = new Map((carts as Array<{ id: string; code_identifier: string; status: string; gate_id: string | null; cart_type: string }>).map(c => [c.id, c]));
        const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
        const towerMap = new Map((towers as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
        const gateMap = new Map((gateRows as Array<{ id: string; name: string }>).map(g => [g.id, g.name]));

        const now = Date.now();
        const enriched = (loans || []).map((l: Record<string, unknown>) => {
          const cart = cartMap.get(l.cart_id as string);
          const dept = deptMap.get(l.department_id as string);
          const tower = dept ? towerMap.get(dept.tower_id) : undefined;
          const gateName = cart?.gate_id ? gateMap.get(cart.gate_id as string) : null;
          const base = {
            ...l,
            cart_code: cart?.code_identifier || null,
            cart_gate: gateName ? { id: cart.gate_id, name: gateName } : null,
            cart_type: cart?.cart_type || 'CARGA',
            department_number: dept?.department_number || null,
            tower_code: tower?.code || null
          };
          if (l.status === 'ACTIVO') {
            const checkoutMs = new Date(String(l.checkout_time)).getTime();
            const elapsedMinutes = Math.max(0, Math.floor((now - checkoutMs) / 60000));
            const overtimeMinutes = Math.max(0, elapsedMinutes - config.max_loan_minutes);
            const estimatedFine = computeFine(config, overtimeMinutes);
            return { ...base, elapsed_minutes: elapsedMinutes, overtime_minutes: overtimeMinutes, estimated_fine: estimatedFine };
          }
          return base;
        });
        return json({ success: true, data: { loans: enriched, config }, error: null }, 200);
      }

      case 'checkout': {
        if (!isOperator) return forbidden();
        const cartId = body.cart_id as string;
        const departmentId = body.department_id as string;
        if (!cartId || !departmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'cart_id y department_id son requeridos' } }, 400);
        }
        const { data: cart } = await db.from('carts').select('id, status').eq('id', cartId).single();
        if (!cart) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Carrito no encontrado' } }, 404);
        if (cart.status !== 'DISPONIBLE') return json({ success: false, data: null, error: { code: 'NOT_AVAILABLE', message: 'El carrito no está disponible' } }, 409);

        const now = new Date();
        const due = new Date(now.getTime() + config.max_loan_minutes * 60000);

        const { data: loan, error: loanError } = await db.from('cart_loans').insert([{
          cart_id: cartId,
          department_id: departmentId,
          requested_by_user_id: body.requested_by_user_id || null,
          guard_checkout_user_id: await currentUserId(req, client) || null,
          checkout_time: now.toISOString(),
          due_time: due.toISOString(),
          status: 'ACTIVO',
          penalty_amount: 0,
          penalty_status: 'NINGUNA'
        }]).select().single();
        if (loanError) throw loanError;

        await db.from('carts').update({ status: 'PRESTADO' }).eq('id', cartId);
        return json({ success: true, data: { ...loan, due_time: due.toISOString(), maximum_minutes: config.max_loan_minutes }, error: null }, 201);
      }

      case 'checkin': {
        if (!isOperator) return forbidden();
        const loanId = body.loan_id as string;
        if (!loanId) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'loan_id es requerido' } }, 400);

        const { data: loan } = await db.from('cart_loans').select('*').eq('id', loanId).single();
        if (!loan) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Préstamo no encontrado' } }, 404);
        if (loan.status !== 'ACTIVO') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'El préstamo ya fue finalizado' } }, 409);
        }

        const checkinTime = new Date();
        const dueTime = new Date(String(loan.due_time));
        const overtimeMinutes = Math.max(0, Math.floor((checkinTime.getTime() - dueTime.getTime()) / 60000));
        const fine = computeFine(config, overtimeMinutes);
        const status = fine > 0 ? 'ATRASADO' : 'DEVUELTO';
        const penaltyStatus = fine > 0 ? 'PENDIENTE' : 'NINGUNA';

        const { data, error } = await db.from('cart_loans').update({
          checkin_time: checkinTime.toISOString(),
          status,
          penalty_amount: fine,
          penalty_status: penaltyStatus,
          guard_checkin_user_id: await currentUserId(req, client) || null
        }).eq('id', loanId).select().single();
        if (error) throw error;

        await db.from('carts').update({ status: 'DISPONIBLE' }).eq('id', loan.cart_id);

        return json({ success: true, data: { ...data, overtime_minutes: overtimeMinutes }, error: null }, 200);
      }

      case 'fines-summary': {
        if (!isAdmin) return forbidden();
        const { data: fines, error } = await db.from('cart_loans')
          .select('department_id, penalty_amount, penalty_status, status')
          .gt('penalty_amount', 0)
          .in('penalty_status', ['PENDIENTE', 'COBRADA']);
        if (error) throw error;

        const rows = (fines || []) as Array<{ department_id: string; penalty_amount: number; penalty_status: string }>;
        const deptIds = [...new Set(rows.map(r => r.department_id))];
        const deptRows = deptIds.length
          ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
          : [];
        const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
        const towers = towerIds.length
          ? ((await db.from('towers').select('id, code').in('id', towerIds)).data || [])
          : [];
        const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
        const towerMap = new Map((towers as Array<{ id: string; code: string }>).map(t => [t.id, t]));

        const byDept = new Map<string, { total_fine: number; count: number; pending: number; cobrada: number }>();
        for (const r of rows) {
          const acc = byDept.get(r.department_id) || { total_fine: 0, count: 0, pending: 0, cobrada: 0 };
          acc.total_fine += Number(r.penalty_amount) || 0;
          acc.count += 1;
          if (r.penalty_status === 'PENDIENTE') acc.pending += Number(r.penalty_amount) || 0;
          else acc.cobrada += Number(r.penalty_amount) || 0;
          byDept.set(r.department_id, acc);
        }

        const summary = [...byDept.entries()].map(([deptId, acc]) => {
          const dept = deptMap.get(deptId);
          const tower = dept ? towerMap.get(dept.tower_id) : undefined;
          return { department_id: deptId, department_number: dept?.department_number || null, tower_code: tower?.code || null, ...acc };
        }).sort((a, b) => b.total_fine - a.total_fine);

        return json({ success: true, data: summary, error: null }, 200);
      }

      default:
        return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
    }
  } catch (error) {
    console.error('Error in cart-lending:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function enrichCarts(db: { from(t: string): any }, carts: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const gateIds = [...new Set(carts.map(c => c.gate_id as string | null).filter(Boolean))];
  const gateRows = gateIds.length
    ? ((await db.from('condo_gates').select('id, name, code, carts_carga, carts_compra').in('id', gateIds)).data || [])
    : [];
  const gateMap = new Map((gateRows as Array<{ id: string; name: string; code: string | null; carts_carga: number; carts_compra: number }>).map(g => [g.id, g]));
  return carts.map(c => {
    const g = (c.gate_id as string | null) ? gateMap.get(c.gate_id as string) : null;
    return {
      ...c,
      cart_type: (c.cart_type as string) || 'CARGA',
      gate: g ? { id: g.id, name: g.name, code: g.code, carts_carga: g.carts_carga, carts_compra: g.carts_compra } : null
    };
  });
}

function computeFine(config: { fine_enabled: boolean; fine_type: string; grace_period_minutes: number; fine_amount: number; fine_interval_minutes: number }, overtimeMinutes: number): number {
  let fine = 0;
  if (config.fine_enabled && overtimeMinutes > config.grace_period_minutes) {
    const excess = overtimeMinutes - config.grace_period_minutes;
    if (config.fine_type === 'FIXED' || (config.fine_type === 'FIXED_OR_PER_INTERVAL' && excess <= config.fine_interval_minutes)) {
      fine = config.fine_amount;
    } else {
      fine = Math.ceil(excess / config.fine_interval_minutes) * config.fine_amount;
    }
  }
  return fine;
}

function normalizeCartType(v: unknown): string {
  const t = String(v || 'CARGA').trim().toUpperCase();
  return CART_TYPES.includes(t) ? t : 'CARGA';
}

async function resolveGate(db: { from(t: string): any }, gateId: unknown): Promise<{ id: string; name: string; carts_carga: number; carts_compra: number } | null> {
  if (!gateId || gateId === null || gateId === '') return null;
  const { data } = await db.from('condo_gates').select('*').eq('id', String(gateId)).eq('is_active', true).single();
  if (!data) return null;
  return data as { id: string; name: string; carts_carga: number; carts_compra: number };
}

async function gateHasCapacity(db: { from(t: string): any }, gate: { id: string; carts_carga: number; carts_compra: number }, excludeId: string | null, cartType: string): Promise<boolean> {
  const capacity = cartType === 'CARGA' ? gate.carts_carga : gate.carts_compra;
  let q = db.from('carts').select('*', { count: 'exact', head: true }).eq('gate_id', gate.id).eq('cart_type', cartType);
  if (excludeId) q = q.neq('id', excludeId);
  const { count } = await q;
  return (count || 0) < capacity;
}

async function getModuleConfig(client: ReturnType<typeof createAdminClient>, schemaName: string) {
  let config = { ...DEFAULT_CONFIG };
  try {
    const { data: row } = await client.database.schema(schemaName).from('condo_settings').select('is_enabled, config_json').eq('module_key', 'cart_lending').single();
    if (row) {
      if (!row.is_enabled) return null;
      config = { ...DEFAULT_CONFIG, ...((row.config_json && typeof row.config_json === 'object') ? (row.config_json as Record<string, unknown>) : {}) };
    } else {
      return null;
    }
  } catch {
    return null;
  }
  return config as { max_loan_minutes: number; fine_enabled: boolean; fine_type: string; grace_period_minutes: number; fine_amount: number; fine_interval_minutes: number };
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

async function currentUserId(req: Request, client: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return null;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    return data?.user?.id || null;
  } catch { return null; }
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

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').eq('role', 'SECURITY_AGENT').single();
    return Boolean(tu);
  } catch { return false; }
}

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
