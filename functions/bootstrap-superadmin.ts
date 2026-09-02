import { createAdminClient } from 'npm:@insforge/sdk';

interface BootstrapRequest {
  email: string;
  password?: string;
  name?: string;
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
      JSON.stringify({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Solo se permite POST' } }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    const body: BootstrapRequest = await req.json();

    if (!body.email) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'email es obligatorio' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user already exists in public.users_global
    const { data: existingGlobal } = await client.database
      .from('users_global')
      .select('id')
      .eq('email', body.email)
      .single();

    if (existingGlobal) {
      // Already a super admin
      const { data, error } = await client.database
        .from('users_global')
        .update({ is_superadmin: true })
        .eq('email', body.email)
        .select()
        .single();

      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, data: { user_id: data?.id, is_superadmin: true, reused: true }, error: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sign up the user to create the auth.users record
    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: body.email,
      password: body.password || 'KytosHub!2026',
      name: body.name || body.email.split('@')[0],
      redirectTo: 'https://kytos-hub.vercel.app'
    });

    if (signUpError) throw signUpError;

    const userId = signUpData?.user?.id;
    if (!userId) {
      // User creation requires email verification; check if auth record exists independently
      const { data: authUser } = await client.auth.getProfile(body.email);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VERIFICATION_REQUIRED', message: 'El usuario se creó pero requiere verificación de email' } }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert into users_global as super admin
    const { data: inserted, error: insertError } = await client.database
      .from('users_global')
      .insert([{
        id: userId,
        email: body.email,
        password_hash: 'oauth',
        is_superadmin: true
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ success: true, data: { user_id: inserted?.id, is_superadmin: true, reused: false }, error: null }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in bootstrap-superadmin:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno al crear super admin' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}