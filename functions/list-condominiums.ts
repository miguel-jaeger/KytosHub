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

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('id');
    const search = url.searchParams.get('search');

    switch (req.method) {
      case 'GET': {
        if (tenantId) {
          const { data: tenant, error } = await client.database
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .single();

          if (error || !tenant) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Condominio no encontrado' } }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, data: tenant, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = client.database
          .from('tenants')
          .select('*')
          .order('name');

        if (search) {
          query = query.ilike('name', `%${search}%`);
        }

        const { data: tenants, error } = await query;

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: tenants || [], error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT': {
        const body = await req.json();
        const id = body.id;

        if (!id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del condominio' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { id: _id, ...updates } = body;

        const { data: tenant, error } = await client.database
          .from('tenants')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: tenant, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE': {
        const body = await req.json();
        const id = body.id;

        if (!id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del condominio' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        await client.database.from('tenant_users').delete().eq('tenant_id', id);

        const { error } = await client.database
          .from('tenants')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: null, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' } }),
          { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in list-condominiums:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}