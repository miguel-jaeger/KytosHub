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
    const action = (body.action as string) || 'list';
    const search = body.search as string | undefined;

    switch (action) {
      case 'list': {
        let query = client.database
          .from('tenants')
          .select('id, name, slug, short_name, schema_name, address, admin_phone, image_url, status, created_at, towers_count, floors_count, departments_count, residents_count');

        if (body.id) {
          query = query.eq('id', body.id);
        } else if (search) {
          query = query.ilike('name', `%${search}%`);
        }

        const { data, error } = await query.order('name');
        if (error) throw error;

        // If a single id was requested, return single object
        const result = body.id ? (data && data.length ? data[0] : null) : (data || []);
        return ok(corsHeaders, result);
      }

      case 'update': {
        const id = body.id as string;
        if (!id) return bad(corsHeaders, 'id es requerido');

        const updates = { ...body } as Record<string, unknown>;
        delete updates.id; delete updates.action; delete updates.schema_name;

        const { data, error } = await client.database
          .from('tenants')
          .update(updates)
          .eq('id', id)
          .select('id, name, slug, short_name, schema_name, address, admin_phone, image_url, status, created_at, towers_count, floors_count, departments_count, residents_count')
          .single();

        if (error) throw error;
        return ok(corsHeaders, data);
      }

      case 'delete': {
        const id = body.id as string;
        if (!id) return bad(corsHeaders, 'id es requerido');

        await client.database.from('tenant_users').delete().eq('tenant_id', id);
        const { error } = await client.database.from('tenants').delete().eq('id', id);
        if (error) throw error;
        return ok(corsHeaders, null);
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in list-condominiums:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

function ok(cors: Record<string, string>, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
}