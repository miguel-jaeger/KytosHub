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

    if (!schemaName) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        const { data, error } = await db.from('towers').select('*').order('name');
        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: data || [], error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create': {
        if (!body.name || !body.code || !body.floors_count || !body.departments_per_floor) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'name, code, floors_count, departments_per_floor son requeridos' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: existing } = await db.from('towers').select('id').eq('code', body.code).single().catch(() => ({ data: null }));
        if (existing) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe una torre con ese código' } }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data, error } = await db.from('towers').insert([{
          name: body.name,
          code: body.code,
          floors_count: body.floors_count,
          departments_per_floor: body.departments_per_floor
        }]).select().single();
        if (error) throw error;
        await refreshTenantCounts();
        return new Response(
          JSON.stringify({ success: true, data, error: null }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { data, error } = await db.from('towers').update({ name: body.name, code: body.code }).eq('id', body.id).select().single();
        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { error } = await db.from('towers').delete().eq('id', body.id);
        if (error) throw error;
        await refreshTenantCounts();
        return new Response(
          JSON.stringify({ success: true, data: null, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in towers:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }),
    { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}