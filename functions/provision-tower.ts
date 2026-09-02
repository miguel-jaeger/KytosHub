import { createAdminClient } from 'npm:@insforge/sdk';

interface ProvisionTowerRequest {
  schema_name?: string;
  tenant_id?: string;
  tower_name: string;
  tower_code: string;
  floors_count: number;
  departments_per_floor: number;
  naming_pattern?: 'SEQUENTIAL' | 'FLOOR_DEPT';
}

interface ProvisionTowerResponse {
  success: boolean;
  data: {
    tower_id: string;
    tower_name: string;
    tower_code: string;
    floors_created: number;
    departments_created: number;
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

    const body: ProvisionTowerRequest = await req.json();

    if (!body.schema_name) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere el esquema del condominio (schema_name)' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!body.tower_name || !body.tower_code || !body.floors_count || !body.departments_per_floor) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: tower_name, tower_code, floors_count, departments_per_floor' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.floors_count <= 0 || body.departments_per_floor <= 0) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'floors_count y departments_per_floor deben ser mayores a 0' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const db = client.database.schema(body.schema_name);

    const { data: existingTower } = await db
      .from('towers')
      .select('id')
      .eq('code', body.tower_code)
      .single();

    if (existingTower) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'TOWER_EXISTS', message: 'Ya existe una torre con ese código' } }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tower, error: towerError } = await db
      .from('towers')
      .insert([{
        name: body.tower_name,
        code: body.tower_code,
        floors_count: body.floors_count,
        departments_per_floor: body.departments_per_floor
      }])
      .select()
      .single();

    if (towerError) {
      throw towerError;
    }

    const floors = [];
    for (let i = 1; i <= body.floors_count; i++) {
      floors.push({
        tower_id: tower.id,
        floor_number: i
      });
    }

    const { data: createdFloors, error: floorsError } = await db
      .from('floors')
      .insert(floors)
      .select();

    if (floorsError) {
      throw floorsError;
    }

    const departments = [];
    for (const floor of createdFloors) {
      for (let j = 1; j <= body.departments_per_floor; j++) {
        let deptNumber: string;
        if (body.naming_pattern === 'FLOOR_DEPT') {
          deptNumber = `${floor.floor_number.toString().padStart(2, '0')}${j.toString().padStart(2, '0')}`;
        } else {
          deptNumber = `${floor.floor_number}${j.toString().padStart(2, '0')}`;
        }

        departments.push({
          floor_id: floor.id,
          tower_id: tower.id,
          department_number: deptNumber,
          status: 'HABITADO'
        });
      }
    }

    const { error: deptsError } = await db
      .from('departments')
      .insert(departments);

    if (deptsError) {
      throw deptsError;
    }

    // Update cached counts in tenants
    if (body.tenant_id) {
      const { count: floors } = await db.from('floors').select('*', { count: 'exact', head: true });
      const { count: depts } = await db.from('departments').select('*', { count: 'exact', head: true });
      await client.database.from('tenants').update({
        towers_count: (await client.database.from('tenants').select('towers_count').eq('id', body.tenant_id).single()).data?.towers_count + 1,
        floors_count: floors || 0,
        departments_count: depts || 0
      }).eq('id', body.tenant_id);
    }

    const response: ProvisionTowerResponse = {
      success: true,
      data: {
        tower_id: tower.id,
        tower_name: tower.name,
        tower_code: tower.code,
        floors_created: createdFloors.length,
        departments_created: departments.length
      },
      error: null
    };

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in provisionTowerStructure:', error);
    return new Response(
      JSON.stringify({
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error interno del servidor al provisionar la torre'
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}