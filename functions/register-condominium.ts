import { createAdminClient } from 'npm:@insforge/sdk';

interface RegisterRequest {
  name: string;
  short_name?: string;
  address?: string;
  admin_phone?: string;
  image_url?: string;
  owner_user_id?: string;
}

interface RegisterResponse {
  success: boolean;
  data: {
    tenant_id: string;
    name: string;
    slug: string;
    short_name: string;
    schema_name: string;
    image_url: string | null;
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export default async function(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Solo se permite POST' } }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    const body: RegisterRequest = await req.json();

    if (!body.name || !body.name.trim()) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El nombre del condominio es obligatorio' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: existing } = await client.database
      .from('tenants')
      .select('id')
      .eq('name', body.name.trim())
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'TENANT_EXISTS', message: 'Ya existe un condominio con ese nombre' } }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tenant, error } = await client.database
      .from('tenants')
      .insert([{
        name: body.name.trim(),
        short_name: body.short_name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null,
        address: body.address?.trim() || null,
        admin_phone: body.admin_phone?.trim() || null,
        image_url: body.image_url || null,
        status: 'ACTIVE'
      }])
      .select('id, name, slug, short_name, schema_name, image_url')
      .single();

    if (error) throw error;

    // Provision the per-tenant schema (condo_{slug}) with core tables
    const { error: provisionError } = await client.database.rpc('provision_tenant_schema_v2', {
      p_tenant_id: tenant.id
    });

    if (provisionError) {
      console.error('Schema provisioning failed:', provisionError);
      // Roll back the tenant if provisioning fails
      await client.database.from('tenants').delete().eq('id', tenant.id);
      throw provisionError;
    }

    // Attach auto-sync trigger for cached counts (residents, towers, floors, departments)
    try {
      await client.database.rpc('ensure_tenant_count_sync', { p_tenant_id: tenant.id });
    } catch {};

    // Promote the registering user to SUPER_ADMIN of the tenant (if provided)
    if (body.owner_user_id) {
      await client.database.from('tenant_users').insert([
        {
          tenant_id: tenant.id,
          user_id: body.owner_user_id,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE'
        }
      ]);
    }

    const response: RegisterResponse = {
      success: true,
      data: {
        tenant_id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        short_name: tenant.short_name || tenant.slug,
        schema_name: tenant.schema_name,
        image_url: tenant.image_url
      },
      error: null
    };

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in register-condominium:', error);
    return new Response(
      JSON.stringify({
        success: false,
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Error interno al registrar el condominio' }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}