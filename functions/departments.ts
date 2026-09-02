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
        let query = db.from('departments').select('*');
        if (body.department_id) query = query.eq('id', body.department_id);
        if (body.tower_id) query = query.eq('tower_id', body.tower_id);
        const { data: departments, error } = await query.order('department_number');
        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: departments || [], error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create': {
        if (!body.floor_id || !body.tower_id || !body.department_number) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'floor_id, tower_id, department_number son requeridos' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: dept, error } = await db
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

      case 'delete': {
        if (!body.id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { error } = await db.from('departments').delete().eq('id', body.id);
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
    console.error('Error in departments:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}