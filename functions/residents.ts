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
    const schemaName = url.searchParams.get('schema_name');

    if (!schemaName) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el esquema del condominio (schema_name)' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = client.database.schema(schemaName);

    switch (req.method) {
      case 'GET': {
        let query = db.from('residents').select('*');

        if (residentId) {
          query = query.eq('id', residentId);
        }

        if (departmentId) {
          query = query.eq('department_id', departmentId);
        }

        const { data: residents, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: residents || [], error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'POST': {
        const body = await req.json();

        if (!body.schema_name || !body.department_id || !body.full_name || !body.document_type || !body.document_number || !body.relationship_type) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: schema_name, department_id, full_name, document_type, document_number, relationship_type' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const residentDb = client.database.schema(body.schema_name);

        const { data: resident, error } = await residentDb
          .from('residents')
          .insert([{
            department_id: body.department_id,
            full_name: body.full_name.trim(),
            document_type: body.document_type,
            document_number: body.document_number.trim(),
            relationship_type: body.relationship_type,
            is_primary_contact: body.is_primary_contact || false,
            email: body.email || null,
            phone: body.phone || null
          }])
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: resident, error: null }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE': {
        const body = await req.json();
        if (!body.id || !body.schema_name) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere id y schema_name' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const residentDb = client.database.schema(body.schema_name);
        const { error } = await residentDb.from('residents').delete().eq('id', body.id);
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
    console.error('Error in residents:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}