import { createAdminClient } from 'npm:@insforge/sdk';

export default async function(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const schemaName = body.schema_name as string;
    const action = (body.action as string) || 'list';

    if (!schemaName) return bad(corsHeaders, 'schema_name es requerido');
    const db = client.database.schema(schemaName);

    switch (action) {
      case 'list': {
        let q = db.from('departments').select('*');
        if (body.id) q = q.eq('id', body.id);
        if (body.tower_id) q = q.eq('tower_id', body.tower_id);
        if (body.floor_id) q = q.eq('floor_id', body.floor_id);
        const { data, error } = await q.order('department_number');
        if (error) throw error;
        return ok(corsHeaders, data || []);
      }

      case 'create': {
        if (!body.floor_id || !body.tower_id || !body.department_number) {
          return bad(corsHeaders, 'floor_id, tower_id, department_number son requeridos');
        }
        const { data: existing } = await db.from('departments').select('id').eq('tower_id', body.tower_id).eq('department_number', body.department_number).single().catch(() => ({ data: null }));
        if (existing) return conflict(corsHeaders, 'Ya existe un departamento con ese número en la torre');
        const { data, error } = await db.from('departments').insert([{
          floor_id: body.floor_id,
          tower_id: body.tower_id,
          department_number: body.department_number,
          status: body.status || 'HABITADO'
        }]).select().single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data, error: null }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const update = {} as Record<string, unknown>;
        if (body.status) update.status = body.status;
        if (body.department_number) update.department_number = body.department_number;
        if (body.floor_id !== undefined) update.floor_id = body.floor_id;
        const { data, error } = await db.from('departments').update(update).eq('id', body.id).select().single();
        if (error) throw error;
        return ok(corsHeaders, data);
      }

      case 'delete': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { error } = await db.from('departments').delete().eq('id', body.id);
        if (error) throw error;
        return ok(corsHeaders, null);
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in departments:', error);
    return new Response(JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

function ok(cors: Record<string, string>, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function conflict(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'DUPLICATE', message: msg } }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } });
}