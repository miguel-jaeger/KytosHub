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
    const residentId = url.searchParams.get('id');
    const departmentId = url.searchParams.get('department_id');

    switch (req.method) {
      case 'GET': {
        if (residentId) {
          const { data: resident, error } = await client.database
            .from('residents')
            .select('*, departments(department_number, towers(name, code))')
            .eq('id', residentId)
            .single();

          if (error || !resident) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Residente no encontrado' } }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, data: resident, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = client.database
          .from('residents')
          .select('*, departments(department_number, towers(name, code))');

        if (departmentId) {
          query = query.eq('department_id', departmentId);
        }

        const { data: residents, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: residents, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'POST': {
        const body = await req.json();
        if (!body.department_id || !body.user_id || !body.relationship_type) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: department_id, user_id, relationship_type' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: existing } = await client.database
          .from('residents')
          .select('id')
          .eq('department_id', body.department_id)
          .eq('user_id', body.user_id)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Este residente ya está registrado en este departamento' } }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: resident, error } = await client.database
          .from('residents')
          .insert([{
            department_id: body.department_id,
            user_id: body.user_id,
            is_owner: body.is_owner || false,
            relationship_type: body.relationship_type,
            is_primary_contact: body.is_primary_contact || false
          }])
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: resident, error: null }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT': {
        if (!residentId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del residente' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const body = await req.json();
        const { data: resident, error } = await client.database
          .from('residents')
          .update(body)
          .eq('id', residentId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: resident, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE': {
        if (!residentId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el ID del residente' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await client.database
          .from('residents')
          .delete()
          .eq('id', residentId);

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
    console.error('Error in residents handler:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
