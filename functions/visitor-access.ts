import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface VisitRow {
  id: string;
  department_id: string | null;
  full_name: string;
  document_type: string;
  document_number: string;
  vehicle_plate: string | null;
  vehicle_type: string;
  scheduled_start: string;
  scheduled_end: string | null;
  entry_time: string | null;
  exit_time: string | null;
  status: string;
  access_code: string;
  created_by_user_id: string | null;
}

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = (body.action as string) || 'list-visits';
    const schemaName = body.schema_name as string;
    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const db = client.database.schema(schemaName);
    const isAdmin = await isAdminForSchema(req, client, schemaName);
    const isSecurity = await isSecurityForSchema(req, client, schemaName);
    const uid = await currentUserId(req, client);
    const isOperator = isAdmin || isSecurity;
    const myDepartmentId = uid ? await departmentOfUser(req, client, db, uid) : null;

    if (action === 'list-visits') {
      let q = db.from('visits').select('*');
      const status = body.status as string | undefined;
      const deptId = body.department_id as string | undefined;
      const search = body.search ? String(body.search).trim() : '';
      if (!isOperator) {
        if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
        q = q.eq('department_id', myDepartmentId);
      } else if (deptId) {
        q = q.eq('department_id', deptId);
      }
      if (status) q = q.eq('status', status);
      if (search) {
        q = q.or(`full_name.ilike.%${search}%,document_number.ilike.%${search}%,vehicle_plate.ilike.%${search}%,access_code.ilike.%${search}%`);
      }
      const visits = await q.order('created_at', { ascending: false }).limit(500);
      const enriched = await enrichVisits(db, visits.data || []);
      return json({ success: true, data: enriched, error: null }, 200);
    }

    if (action === 'create-visit') {
      const departmentId = (body.department_id as string) || (isOperator ? null : myDepartmentId) || myDepartmentId;
      const fullName = String(body.full_name || '').trim();
      const documentNumber = String(body.document_number || '').trim();
      if (!fullName || !documentNumber) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Nombre y documento del visitante son obligatorios' } }, 400);
      }
      if (!isOperator && (!myDepartmentId || String(departmentId) !== myDepartmentId)) return forbidden();

      // Rule: max simultaneous visits per department
      const max = await maxSimultaneous(db);
      if (max > 0 && departmentId) {
        const { count } = await db.from('visits')
          .select('*', { count: 'exact', head: true })
          .eq('department_id', departmentId)
          .in('status', ['PENDIENTE', 'ACTIVO'])
          .is('exit_time', null);
        if ((count || 0) >= max) {
          return json({ success: false, data: null, error: { code: 'LIMIT_REACHED', message: `Se alcanzó el máximo de ${max} visitas simultáneas para este departamento` } }, 409);
        }
      }

      const access_code = await uniqueCode(db);
      const { data, error } = await db.from('visits').insert([{
        department_id: departmentId || null,
        full_name: fullName,
        document_type: String(body.document_type || 'DNI'),
        document_number: documentNumber,
        vehicle_plate: body.vehicle_plate ? String(body.vehicle_plate).trim().toUpperCase() : null,
        vehicle_type: String(body.vehicle_type || 'AUTO').toUpperCase() === 'MOTO' ? 'MOTO' : 'AUTO',
        scheduled_start: body.scheduled_start ? new Date(String(body.scheduled_start)).toISOString() : new Date().toISOString(),
        scheduled_end: body.scheduled_end ? new Date(String(body.scheduled_end)).toISOString() : new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        status: 'PENDIENTE',
        access_code,
        created_by_user_id: uid
      }]).select().single();
      if (error) throw error;
      const enriched = (await enrichVisits(db, [data]))[0];
      return json({ success: true, data: enriched, error: null }, 201);
    }

    if (action === 'update-visit-status') {
      const id = body.id as string;
      const op = String(body.operation || '').toLowerCase();
      if (!id || !['confirm-entry', 'confirm-exit', 'cancel'].includes(op)) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id y acción (confirm-entry, confirm-exit, cancel) son requeridos' } }, 400);
      }
      const { data: visit } = await db.from('visits').select('department_id, status, entry_time, exit_time').eq('id', id).single();
      if (!visit) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Visita no encontrada' } }, 404);
      if (!isOperator && String(visit.department_id || '') !== String(myDepartmentId || '')) return forbidden();

      const patch: Record<string, unknown> = {};
      const now = new Date().toISOString();
      if (op === 'confirm-entry') {
        if (visit.status !== 'PENDIENTE') return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'La visita no está pendiente de ingreso' } }, 409);
        patch.status = 'ACTIVO';
        patch.entry_time = now;
      } else if (op === 'confirm-exit') {
        if (visit.status !== 'ACTIVO' || !visit.entry_time) return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'La visita no tiene ingreso confirmado' } }, 409);
        patch.exit_time = now;
      } else {
        patch.status = 'CANCELADO';
      }
      const { data, error } = await db.from('visits').update(patch).eq('id', id).select().single();
      if (error) throw error;
      const enriched = (await enrichVisits(db, [data]))[0];
      return json({ success: true, data: enriched, error: null }, 200);
    }

    if (action === 'list-packages') {
      let q = db.from('visitor_packages').select('*');
      if (!isOperator) {
        if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
        q = q.eq('department_id', myDepartmentId);
      } else if (body.department_id) {
        q = q.eq('department_id', body.department_id);
      }
      const packages = await q.order('received_at', { ascending: false }).limit(300);
      const enriched = await enrichPackages(db, packages.data || []);
      return json({ success: true, data: enriched, error: null }, 200);
    }

    if (action === 'create-package') {
      const departmentId = (body.department_id as string) || myDepartmentId;
      const description = String(body.description || '').trim();
      if (!description) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Indica la descripción del paquete' } }, 400);
      }
      if (!isOperator && (!myDepartmentId || String(departmentId) !== myDepartmentId)) return forbidden();
      const { data, error } = await db.from('visitor_packages').insert([{
        department_id: departmentId || null,
        description,
        carrier: body.carrier ? String(body.carrier).trim() : null,
        received_at: new Date().toISOString(),
        notified: false,
        created_by_user_id: uid
      }]).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 201);
    }

    if (action === 'update-package') {
      const id = body.id as string;
      const op = String(body.operation || '').toLowerCase();
      if (!id || !['notify', 'deliver'].includes(op)) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id y acción (notify, deliver) son requeridos' } }, 400);
      }
      const { data: pkg } = await db.from('visitor_packages').select('department_id').eq('id', id).single();
      if (!pkg) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Paquete no encontrado' } }, 404);
      if (!isOperator && String(pkg.department_id || '') !== String(myDepartmentId || '')) return forbidden();
      const patch: Record<string, unknown> = op === 'deliver'
        ? { delivered_at: new Date().toISOString() }
        : { notified: true };
      const { data, error } = await db.from('visitor_packages').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in visitor-access:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function maxSimultaneous(db: { from(t: string): any }): Promise<number> {
  try {
    const { data } = await db.from('condo_settings').select('config_json').eq('module_key', 'visitor_access').single();
    const cfg = data?.config_json && typeof data.config_json === 'object' ? data.config_json as Record<string, unknown> : {};
    const n = Number(cfg.max_simultaneous_per_department);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

async function uniqueCode(db: { from(t: string): any }): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const { data } = await db.from('visits').select('id').eq('access_code', code).maybeSingle();
    if (!data) return code;
  }
  return `V${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

async function enrichVisits(db: { from(t: string): any }, visits: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(visits.map(v => v.department_id as string | null).filter(Boolean))];
  const deptRows = deptIds.length
    ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
    : [];
  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const towerRows = towerIds.length
    ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
    : [];
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
  return visits.map(v => {
    const dept = v.department_id ? deptMap.get(v.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    const inside = String(v.status) === 'ACTIVO' && !(v as VisitRow).exit_time;
    return {
      ...v,
      inside,
      departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined
    };
  });
}

async function enrichPackages(db: { from(t: string): any }, packages: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(packages.map(p => p.department_id as string | null).filter(Boolean))];
  const deptRows = deptIds.length
    ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
    : [];
  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const towerRows = towerIds.length
    ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
    : [];
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
  return packages.map(p => {
    const dept = p.department_id ? deptMap.get(p.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    return {
      ...p,
      departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined
    };
  });
}

async function departmentOfUser(
  req: Request,
  client: ReturnType<typeof createAdminClient>,
  db: { from(t: string): any },
  userId: string
): Promise<string | null> {
  const { data: byUser } = await db.from('residents').select('department_id').eq('user_id', userId).limit(1).maybeSingle();
  if (byUser?.department_id) return String(byUser.department_id);
  let email = '';
  let documentNumber: string | null = null;
  try {
    const { data: ug } = await client.database.from('users_global').select('email, document_number').eq('id', userId).single();
    email = String((ug as { email?: string } | null)?.email || '').toLowerCase();
    documentNumber = (ug as { document_number?: string | null } | null)?.document_number || null;
  } catch {}
  if (email) {
    const { data: byEmail } = await db.from('residents').select('department_id').eq('email', email).limit(1).maybeSingle();
    if (byEmail?.department_id) return String(byEmail.department_id);
  }
  if (documentNumber) {
    const { data: byDoc } = await db.from('residents').select('department_id').eq('document_number', documentNumber).limit(1).maybeSingle();
    if (byDoc?.department_id) return String(byDoc.department_id);
  }
  return null;
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

async function currentUserId(req: Request, client: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return null;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    return data?.user?.id || null;
  } catch { return null; }
}

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}