import { createAdminClient } from 'npm:@insforge/sdk';

interface AddResidentRequest {
  schema_name: string;
  department_id: string;
  full_name: string;
  document_type: 'DNI' | 'CE' | 'PASAPORTE';
  document_number: string;
  relationship_type: 'PROPIETARIO' | 'FAMILIAR' | 'INQUILINO';
  is_primary_contact?: boolean;
  email?: string;
  phone?: string;
  password?: string;
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

    const body: AddResidentRequest = await req.json();

    if (!body.schema_name || !body.department_id || !body.full_name || !body.document_type || !body.document_number || !body.relationship_type) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: schema_name, department_id, full_name, document_type, document_number, relationship_type' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const residentsTable = `${body.schema_name}.residents`;

    const { data: existing } = await client.database
      .from(residentsTable)
      .select('id')
      .eq('department_id', body.department_id)
      .eq('document_number', body.document_number)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe un residente con ese documento en este departamento' } }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let userId: string | null = null;

    if (body.relationship_type === 'PROPIETARIO' && body.email) {
      const { data: signUpData, error: signUpError } = await client.auth.signUp({
        email: body.email,
        password: body.password || `${body.document_number.substring(0, 4)}Kytos`,
        name: body.full_name,
        redirectTo: 'https://kytos-hub.vercel.app'
      });

      if (!signUpError && signUpData?.user?.id) {
        userId = signUpData.user.id;

        await client.database.from('users_global').insert([{
          id: userId,
          email: body.email,
          password_hash: 'oauth',
          is_superadmin: false
        }]);
      }
    }

    const { data: resident, error } = await client.database
      .from(residentsTable)
      .insert([{
        department_id: body.department_id,
        full_name: body.full_name.trim(),
        document_type: body.document_type,
        document_number: body.document_number.trim(),
        relationship_type: body.relationship_type,
        is_primary_contact: body.is_primary_contact || false,
        email: body.email || null,
        phone: body.phone || null,
        user_id: userId
      }])
      .select()
      .single();

    if (error) throw error;

    const response: {
      success: boolean;
      data: Record<string, unknown> | null;
      error: { code: string; message: string } | null;
    } = {
      success: true,
      data: {
        resident_id: resident.id,
        full_name: resident.full_name,
        document_number: resident.document_number,
        relationship_type: resident.relationship_type,
        user_created: userId !== null,
        email: resident.email
      },
      error: null
    };

    return new Response(
      JSON.stringify(response),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in add-resident:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno al agregar residente' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}