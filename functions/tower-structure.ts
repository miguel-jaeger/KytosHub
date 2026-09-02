import { createAdminClient } from 'npm:@insforge/sdk';

interface TowerNode {
  id: string;
  name: string;
  code: string;
  floors_count: number;
  departments_per_floor: number;
  created_at: string;
  floors: FloorNode[];
}

interface FloorNode {
  id: string;
  floor_number: number;
  departments: DepartmentNode[];
}

interface DepartmentNode {
  id: string;
  department_number: string;
  status: 'HABITADO' | 'DESOCUPADO' | 'MANTENIMIENTO';
}

interface TowerStructureResponse {
  success: boolean;
  data: TowerNode[] | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export default async function(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Solo se permite GET' } }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    const url = new URL(req.url);
    const schemaName = url.searchParams.get('schema_name') || url.searchParams.get('tenant_schema');

    if (!schemaName) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el esquema del condominio (schema_name)' } }),
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

    const structure: TowerNode[] = (towers || []).map((tower) => {
      const towerFloors = (floors || [])
        .filter((floor) => floor.tower_id === tower.id)
        .map((floor) => ({
          id: floor.id,
          floor_number: floor.floor_number,
          departments: (departments || [])
            .filter((dept) => dept.floor_id === floor.id && dept.tower_id === tower.id)
            .map((dept) => ({
              id: dept.id,
              department_number: dept.department_number,
              status: dept.status
            }))
        }));

      return {
        id: tower.id,
        name: tower.name,
        code: tower.code,
        floors_count: tower.floors_count,
        departments_per_floor: tower.departments_per_floor,
        created_at: tower.created_at,
        floors: towerFloors
      };
    });

    const response: TowerStructureResponse = {
      success: true,
      data: structure,
      error: null
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in tower-structure:', error);
    return new Response(
      JSON.stringify({
        success: false,
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Error interno al obtener la estructura' }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}