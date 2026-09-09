import { createAdminClient, createClient } from 'npm:@insforge/sdk';

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

    const db = client.database.schema(schemaName);
    const isAdmin = await isAdminForSchema(req, client, schemaName);

    if (action === 'list') {
      const { data, error } = await db.from('condo_gates').select('*').order('sort_order');
      if (error) throw error;
      return json({ success: true, data: (data || []).map((g: Record<string, unknown>) => normalizeRow(g)), error: null }, 200);
    }

    if (action === 'create') {
      if (!isAdmin) return forbidden();
      const name = String(body.name || '').trim();
      if (!name) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El nombre de la puerta es obligatorio' } }, 400);

      const existing = await db.from('condo_gates').select('id').eq('name', name).single();
      if (existing) return json({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe una puerta con ese nombre' } }, 409);

      const { data: maxRow } = await db.from('condo_gates').select('sort_order').order('sort_order', { ascending: false }).limit(1).single();
      const nextOrder = (maxRow?.sort_order ?? 0) + 1;

      const { data, error } = await db.from('condo_gates').insert([{
        name,
        code: body.code ? String(body.code).trim() : null,
        is_entry_exit: body.is_entry_exit !== false,
        carts_carga: Math.max(0, Number(body.carts_carga) || 0),
        carts_compra: Math.max(0, Number(body.carts_compra) || 0),
        sort_order: nextOrder,
        is_active: body.is_active !== false
      }]).select().single();
      if (error) throw error;
      return json({ success: true, data: normalizeRow(data), error: null }, 201);
    }

    if (action === 'update') {
      if (!isAdmin) return forbidden();
      const id = body.id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);

      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El nombre de la puerta es obligatorio' } }, 400);
        updates.name = name;
      }
      if (body.code !== undefined) updates.code = body.code ? String(body.code).trim() : null;
      if (body.is_entry_exit !== undefined) updates.is_entry_exit = body.is_entry_exit === true;
      if (body.carts_carga !== undefined) updates.carts_carga = Math.max(0, Number(body.carts_carga) || 0);
      if (body.carts_compra !== undefined) updates.carts_compra = Math.max(0, Number(body.carts_compra) || 0);
      if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order) || 0;
      if (body.is_active !== undefined) updates.is_active = body.is_active === true;

      const { data, error } = await db.from('condo_gates').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data: normalizeRow(data), error: null }, 200);
    }

    if (action === 'delete') {
      if (!isAdmin) return forbidden();
      const id = body.id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
      const { data: used } = await db.from('carts').select('id', { count: 'exact', head: true }).eq('gate_id', id);
      if ((used?.count ?? 0) > 0) {
        return json({ success: false, data: null, error: { code: 'GATE_IN_USE', message: 'No se puede eliminar: hay carritos asignados a esta puerta. Desasígnalos primero.' } }, 409);
      }
      const { error } = await db.from('condo_gates').delete().eq('id', id);
      if (error) throw error;
      return json({ success: true, data: null, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in condo-gates:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

function normalizeRow(g: Record<string, unknown>): Record<string, unknown> {
  return {
    id: g.id,
    name: g.name,
    code: g.code ?? null,
    is_entry_exit: Boolean(g.is_entry_exit),
    carts_carga: Number(g.carts_carga) || 0,
    carts_compra: Number(g.carts_compra) || 0,
    sort_order: Number(g.sort_order) || 0,
    is_active: g.is_active !== false,
    created_at: g.created_at
  };
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

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
