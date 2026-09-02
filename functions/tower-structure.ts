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

    if (!schemaName) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = client.database.schema(schemaName);

    const { data: towers, error: towersError } = await db
      .from('towers')
      .select('id, name, code, floors_count, departments_per_floor, created_at')
      .order('name');

    if (towersError) throw towersError;

    const { data: floors, error: floorsError } = await db
      .from('floors')
      .select('id, tower_id, floor_number')
      .order('floor_number');

    if (floorsError) throw floorsError;

    const { data: departments, error: deptsError } = await db
      .from('departments')
      .select('id, floor_id, tower_id, department_number, status')
      .order('department_number');

    if (deptsError) throw deptsError;

    let residents: { id: string; department_id: string }[] = [];
    try {
      const res = await db
        .from('residents')
        .select('id, department_id');
      if (!res.error) residents = res.data || [];
    } catch {
      residents = [];
    }

    const residentCountByDept = new Map<string, number>();
    for (const r of residents || []) {
      residentCountByDept.set(r.department_id, (residentCountByDept.get(r.department_id) || 0) + 1);
    }

    const structure = (towers || []).map((tower) => ({
      ...tower,
      floors: (floors || [])
        .filter((floor) => floor.tower_id === tower.id)
        .map((floor) => ({
          id: floor.id,
          floor_number: floor.floor_number,
          departments: (departments || [])
            .filter((dept) => dept.floor_id === floor.id && dept.tower_id === tower.id)
            .map((dept) => ({
              id: dept.id,
              department_number: dept.department_number,
              status: dept.status,
              residents_count: residentCountByDept.get(dept.id) || 0
            }))
        }))
    }));

    return new Response(
      JSON.stringify({ success: true, data: structure, error: null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in tower-structure:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}