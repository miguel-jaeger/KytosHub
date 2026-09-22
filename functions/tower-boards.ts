import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const BOARD_ROLES = ['PRESIDENTE', 'SECRETARIO', 'TESORERO'];

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

    // Module guard: tower_boards must be enabled for this condominium
    const moduleOn = await isModuleEnabled(db, 'tower_boards');
    if (!moduleOn) return forbidden('Módulo inactivo para este condominio');

    if (action === 'list') {
      const boards = await listBoards(db);
      return json({ success: true, data: boards, error: null }, 200);
    }

    if (action === 'create') {
      if (!isAdmin) return forbidden('No tienes permisos para crear juntas directivas');
      const towerId = body.tower_id as string;
      const startDate = body.start_date as string;
      const rawMembers = Array.isArray(body.members) ? body.members as Array<Record<string, unknown>> : [];
      if (!towerId || !startDate || !rawMembers.length) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'tower_id, start_date y members son requeridos' } }, 400);
      }
      const members = rawMembers.map(m => ({ resident_id: String(m.resident_id || ''), role: String(m.role || '') }));
      // Validate roles: exactly PRESIDENTE, SECRETARIO, TESORERO, and the 3 members are different residents
      const roles = members.map(m => m.role);
      const hasAllRoles = BOARD_ROLES.every(r => roles.includes(r));
      if (!hasAllRoles) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'La junta debe incluir un Presidente, un Secretario y un Tesorero' } }, 400);
      }
      const uniqueResidents = new Set(members.map(m => m.resident_id));
      if (uniqueResidents.size !== members.length || members.length !== BOARD_ROLES.length) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Cada cargo debe ser ocupado por un residente diferente' } }, 400);
      }
      // Only residents of the given tower can be selected
      const ok = await residentsBelongToTower(db, members.map(m => m.resident_id), towerId);
      if (!ok) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Solo puedes elegir residentes de la torre seleccionada' } }, 400);
      }

      const termMonths = await termMonthsFor(db, 'tower_boards');
      const start = new Date(String(startDate));
      if (isNaN(start.getTime())) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'start_date no es una fecha válida' } }, 400);
      }
      const end = new Date(start);
      end.setMonth(end.getMonth() + termMonths);

      // Deactivate any previously active board of the tower, then insert the new one
      await db.from('tower_boards').update({ is_active: false }).eq('tower_id', towerId).eq('is_active', true);
      const { data: board, error } = await db.from('tower_boards').insert([{
        tower_id: towerId,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        is_active: true,
        notes: body.notes ? String(body.notes).trim() || null : null
      }]).select().single();
      if (error) throw error;

      const rows = members.map(m => ({ board_id: board.id, resident_id: m.resident_id, role: m.role }));
      const { error: memErr } = await db.from('tower_board_members').insert(rows);
      if (memErr) {
        await db.from('tower_boards').delete().eq('id', board.id);
        throw memErr;
      }

      const rich = await listBoards(db);
      const created = (rich.find(b => b.id === board.id) || null);
      return json({ success: true, data: created, error: null }, 201);
    }

    if (action === 'deactivate') {
      if (!isAdmin) return forbidden('No tienes permisos para desactivar juntas directivas');
      const id = body.id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
      const { data, error } = await db.from('tower_boards').update({ is_active: false }).eq('id', id).select().single();
      if (error) throw error;
      const rich = await listBoards(db);
      return json({ success: true, data: rich.find(b => b.id === id) || data, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in tower-boards:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function listBoards(db: { from(t: string): any }): Promise<Array<Record<string, unknown>>> {
  const { data: boards } = await db.from('tower_boards').select('*').order('created_at', { ascending: false });
  const list = (boards || []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const towerIds = [...new Set(list.map(b => b.tower_id as string))];
  const { data: towers } = towerIds.length
    ? await db.from('towers').select('id, name, code').in('id', towerIds)
    : { data: [] } as { data: Array<{ id: string; name: string; code: string }> };
  const towerMap = new Map((towers || []).map(t => [t.id, t]));

  const boardIds = list.map(b => b.id as string);
  const { data: memberRows } = boardIds.length
    ? await db.from('tower_board_members').select('*').in('board_id', boardIds)
    : { data: [] } as { data: Array<Record<string, unknown>> };
  const members = (memberRows || []) as Array<Record<string, unknown>>;

  const residentIds = [...new Set(members.map(m => m.resident_id as string))];
  const { data: residents } = residentIds.length
    ? await db.from('residents').select('id, full_name, document_type, document_number, department_id').in('id', residentIds)
    : { data: [] } as { data: Array<{ id: string; full_name: string; document_type: string; document_number: string; department_id: string }> };
  const residentMap = new Map((residents || []).map(r => [r.id, r]));

  const deptIds = [...new Set((residents || []).map(r => r.department_id))];
  const { data: depts } = deptIds.length
    ? await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)
    : { data: [] } as { data: Array<{ id: string; department_number: string; tower_id: string }> };
  const deptMap = new Map((depts || []).map(d => [d.id, d]));

  const membersByBoard = new Map<string, Array<Record<string, unknown>>>();
  for (const m of members) {
    const resident = m.resident_id ? residentMap.get(m.resident_id as string) : undefined;
    const dept = resident ? deptMap.get(resident.department_id) : undefined;
    const enriched = {
      ...m,
      residents: resident ? {
        ...resident,
        departments: dept ? { department_number: dept.department_number, towers: dept.tower_id ? towerMap.get(dept.tower_id) || null : null } : null
      } : null
    };
    const arr = membersByBoard.get(m.board_id as string) || [];
    arr.push(enriched);
    membersByBoard.set(m.board_id as string, arr);
  }

  return list.map(b => ({
    ...b,
    towers: b.tower_id ? towerMap.get(b.tower_id as string) || null : null,
    members: membersByBoard.get(b.id as string) || []
  }));
}

async function residentsBelongToTower(db: { from(t: string): any }, residentIds: string[], towerId: string): Promise<boolean> {
  if (!residentIds.length) return false;
  const { data: residents } = await db.from('residents').select('id, department_id').in('id', residentIds);
  const deptIds = [...new Set((residents || []).map((r: { department_id: string }) => r.department_id))];
  if (!deptIds.length) return false;
  const { count } = await db.from('departments')
    .select('*', { count: 'exact', head: true })
    .eq('tower_id', towerId)
    .in('id', deptIds);
  return (count || 0) === deptIds.length && deptIds.length === residentIds.length;
}

async function termMonthsFor(db: { from(t: string): any }, key: string): Promise<number> {
  try {
    const { data } = await db.from('condo_settings').select('config_json').eq('module_key', key).single();
    const cfg = data?.config_json && typeof data.config_json === 'object' ? data.config_json as Record<string, unknown> : {};
    const n = Number(cfg.term_months);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 12;
  } catch {
    return 12;
  }
}

async function isModuleEnabled(db: { from(t: string): any }, key: string): Promise<boolean> {
  try {
    const { data } = await db.from('condo_settings').select('is_enabled').eq('module_key', key).single();
    return Boolean(data && (data as { is_enabled: boolean }).is_enabled);
  } catch {
    return false;
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

function forbidden(message: string): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}