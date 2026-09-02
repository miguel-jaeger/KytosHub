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
    const deptId = url.searchParams.get('id');
    const towerId = url.searchParams.get('tower_id');
    const schemaName = url.searchParams.get('schema_name') || url.searchParams.get('tenant_schema');

    if (!schemaName) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el esquema del condominio (schema_name)' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = client.database.schema(schemaName);

    switch (req.method) {
      case 'GET': {
        if (deptId) {
          const { data: dept, error } = await db
            .from('departments')
            .select('*, towers(name, code), floors(floor_number)')
            .eq('id', deptId)
            .single();

          if (error || !dept) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Departamento no encontrado' } }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, data: dept, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = db
          .from('departments')
          .select('*, towers(name, code), floors(floor_number)');

        if (towerId) {
          query = query.eq('tower_id', towerId);
        }

        const { data: departments, error } = await query.order('department_number');

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: departments, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'POST': {
        const body = await req.json();
        if (!body.floor_id || !body.tower_id || !body.department_number) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: floor_id, tower_id, department_number' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: existing } = await client.database
          .from('departments')
          .select('id')
          .eq('tower_id', body.tower_id)
          .eq('department_number', body.department_number)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe un departamento con ese número en la torre' } }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: dept, error } = await client.database
          .from('departments')
          .insert([{
            floor_id: body.floor_id,
            tower_id: body.tower_id,
            department_number: body.department_number,
            status: body.status || 'HABITADO'
          }])
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: dept, error: null }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT': {
        if (!deptId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del departamento' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const body = await req.json();
        const { data: dept, error } = await client.database
          .from('departments')
          .update(body)
          .eq('id', deptId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: dept, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE': {
        if (!deptId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del departamento' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await client.database
          .from('departments')
          .delete()
          .eq('id', deptId);

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
    console.error('Error in departments handler:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
