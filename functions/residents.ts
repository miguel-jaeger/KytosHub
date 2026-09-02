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
        let q = db.from('residents').select('*');
        if (body.department_id) q = q.eq('department_id', body.department_id);
        const { data, error } = await q.order('created_at', { ascending: false });
        if (error) throw error;
        const residents = data || [];
        if (residents.length === 0) return ok(corsHeaders, []);
        const deptIds = [...new Set(residents.map((r: { department_id: string }) => r.department_id))];
        const { data: depts } = await db.from('departments').select('id, department_number, tower_id').in('id', deptIds);
        const towerIds = [...new Set((depts || []).map((d: { tower_id: string }) => d.tower_id))];
        const { data: towers } = towerIds.length ? await db.from('towers').select('id, name, code').in('id', towerIds) : { data: [] } as { data: { id: string; name: string; code: string }[] };
        const deptMap = new Map((depts || []).map((d: { id: string; department_number: string; tower_id: string }) => [d.id, d]));
        const towerMap = new Map((towers || []).map((t: { id: string; name: string; code: string }) => [t.id, t]));
        const enriched = residents.map((r: Record<string, unknown>) => {
          const dept = deptMap.get(r.department_id as string) as { department_number: string; tower_id: string } | undefined;
          const tower = dept ? towerMap.get(dept.tower_id) as { name: string; code: string } | undefined : undefined;
          return { ...r, departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined };
        });
        return ok(corsHeaders, enriched);
      }

      case 'create': {
        if (!body.department_id || !body.full_name || !body.document_type || !body.document_number || !body.relationship_type) {
          return bad(corsHeaders, 'department_id, full_name, document_type, document_number, relationship_type son requeridos');
        }
        const { data, error } = await db.from('residents').insert([{
          department_id: body.department_id,
          full_name: String(body.full_name).trim(),
          document_type: body.document_type,
          document_number: String(body.document_number).trim(),
          relationship_type: body.relationship_type,
          is_primary_contact: body.is_primary_contact || false,
          email: body.email || null,
          phone: body.phone || null
        }]).select().single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data, error: null }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const update = { ...body } as Record<string, unknown>;
        delete update.id; delete update.schema_name; delete update.action;
        const { data, error } = await db.from('residents').update(update).eq('id', body.id).select().single();
        if (error) throw error;
        return ok(corsHeaders, data);
      }

      case 'delete': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { error } = await db.from('residents').delete().eq('id', body.id);
        if (error) throw error;
        return ok(corsHeaders, null);
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in residents:', error);
    return new Response(JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

function ok(cors: Record<string, string>, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
}