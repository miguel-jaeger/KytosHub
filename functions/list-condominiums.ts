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
            .select('id, name, slug, short_name, schema_name, address, admin_phone, image_url, status, created_at')
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
          .select('id, name, slug, short_name, schema_name, address, admin_phone, image_url, status, created_at');

        if (search) {
          query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%,address.ilike.%${search}%`);
        }

        const { data: tenants, error } = await query.order('name');

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: tenants, error: null }),
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

        const { id: _, ...updates } = body;

        const { data: tenant, error } = await client.database
          .from('tenants')
          .update(updates)
          .eq('id', id)
          .select('id, name, slug, short_name, schema_name, address, admin_phone, image_url, status, created_at')
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

        const { data: tenant } = await client.database
          .from('tenants')
          .select('schema_name')
          .eq('id', id)
          .single();

        if (tenant?.schema_name) {
          await client.database.rpc('drop_tenant_schema', { p_schema_name: tenant.schema_name }).catch(() => {});

          try {
            await fetch(`${Deno.env.get('INSFORGE_BASE_URL')}/rest/v1/rpc/drop_tenant_schema`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': Deno.env.get('INSFORGE_API_KEY') || '',
                'Authorization': `Bearer ${Deno.env.get('INSFORGE_API_KEY') || ''}`
              },
              body: JSON.stringify({ p_schema_name: tenant.schema_name })
            });
          } catch {
          }
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
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}