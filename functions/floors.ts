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

    const refreshTenantCounts = async () => {
      try {
        const { data: tenant } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
        if (tenant?.id) {
          await client.database.rpc('refresh_tenant_counts', { p_tenant_id: tenant.id });
        }
      } catch {}
    };

    switch (action) {
      case 'list': {
        let q = db.from('floors').select('*');
        if (body.tower_id) q = q.eq('tower_id', body.tower_id);
        const { data, error } = await q.order('floor_number');
        if (error) throw error;
        return ok(corsHeaders, data || []);
      }

      case 'create': {
        if (!body.tower_id || !body.floor_number) return bad(corsHeaders, 'tower_id y floor_number son requeridos');
        const { data: existing } = await db.from('floors').select('id').eq('tower_id', body.tower_id).eq('floor_number', body.floor_number).single().catch(() => ({ data: null }));
        if (existing) return err(corsHeaders, 'DUPLICATE', 'Ya existe ese piso');
        const { data, error } = await db.from('floors').insert([{ tower_id: body.tower_id, floor_number: body.floor_number }]).select().single();
        if (error) throw error;
        await refreshTenantCounts();
        return new Response(JSON.stringify({ success: true, data, error: null }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'delete': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { error } = await db.from('floors').delete().eq('id', body.id);
        if (error) throw error;
        await refreshTenantCounts();
        return ok(corsHeaders, null);
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in floors:', error);
    return new Response(JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

function ok(cors: Record<string, string>, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function err(cors: Record<string, string>, code: string, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message: msg } }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } });
}