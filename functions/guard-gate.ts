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
    const action = (body.action as string) || 'get-session';
    const schemaName = body.schema_name as string;

    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const db = client.database.schema(schemaName);
    const uid = await currentUserId(req, client);
    if (!uid) {
      return json({ success: false, data: null, error: { code: 'UNAUTH', message: 'No autenticado' } }, 401);
    }

    const isOperator = await isOperatorForSchema(req, client, schemaName);

    switch (action) {
      case 'get-session': {
        const { data: session } = await db.from('guard_gate_sessions')
          .select('id, gate_id, started_at')
          .eq('user_id', uid)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        let gate = null;
        if (session?.gate_id) {
          const { data: g } = await db.from('condo_gates').select('id, name, code, is_entry_exit, is_active').eq('id', session.gate_id).single();
          if (g && g.is_active) {
            gate = { id: g.id, name: g.name, code: g.code, is_entry_exit: g.is_entry_exit };
          }
        }
        if (!gate) {
          return json({ success: true, data: null, error: null }, 200);
        }
        return json({ success: true, data: { id: session.id, gate, started_at: session.started_at }, error: null }, 200);
      }

      case 'check-in':
      case 'change-gate': {
        if (!isOperator) return forbidden();
        const gateId = body.gate_id as string;
        if (!gateId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'gate_id es requerido' } }, 400);
        }
        const { data: gate } = await db.from('condo_gates').select('id, name').eq('id', gateId).eq('is_active', true).single();
        if (!gate) {
          return json({ success: false, data: null, error: { code: 'GATE_NOT_FOUND', message: 'La puerta indicada no existe o está inactiva' } }, 404);
        }

        // Close any open session for this user to reflect the gate change
        await db.from('guard_gate_sessions').update({ ended_at: new Date().toISOString() })
          .eq('user_id', uid)
          .is('ended_at', null);

        const { data: session, error } = await db.from('guard_gate_sessions')
          .insert([{ user_id: uid, gate_id: gateId, started_at: new Date().toISOString() }])
          .select('id, gate_id, started_at')
          .single();
        if (error) throw error;

        return json({
          success: true,
          data: { id: session.id, gate: { id: gate.id, name: gate.name }, started_at: session.started_at },
          error: null
        }, action === 'check-in' ? 201 : 200);
      }

      case 'check-out': {
        if (!isOperator) return forbidden();
        await db.from('guard_gate_sessions').update({ ended_at: new Date().toISOString() })
          .eq('user_id', uid)
          .is('ended_at', null);
        return json({ success: true, data: null, error: null }, 200);
      }

      default:
        return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
    }
  } catch (error) {
    console.error('Error in guard-gate:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
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

async function isOperatorForSchema(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
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

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SUPER_ADMIN', 'ADMIN', 'SECURITY_AGENT', 'SUPERVISOR']).single();
    return Boolean(tu);
  } catch { return false; }
}

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}