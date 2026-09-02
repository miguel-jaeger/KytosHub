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

    switch (action) {
      case 'list': {
        let query = db.from('residents').select('*');
        if (body.department_id) query = query.eq('department_id', body.department_id);
        const { data: residents, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: residents || [], error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create': {
        if (!body.department_id || !body.full_name || !body.document_type || !body.document_number || !body.relationship_type) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'department_id, full_name, document_type, document_number, relationship_type son requeridos' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: resident, error } = await db
          .from('residents')
          .insert([{
            department_id: body.department_id,
            full_name: String(body.full_name).trim(),
            document_type: body.document_type,
            document_number: String(body.document_number).trim(),
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

      case 'delete': {
        if (!body.id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { error } = await db.from('residents').delete().eq('id', body.id);
        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: null, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: `Acción desconocida: ${action}` } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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