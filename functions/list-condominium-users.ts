import { createAdminClient } from 'npm:@insforge/sdk';

interface AddUserRequest {
  tenant_id: string;
  email: string;
  name: string;
  role: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
}

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
    const tenantId = url.searchParams.get('tenant_id');
    const role = url.searchParams.get('role');

    switch (req.method) {
      case 'GET': {
        if (!tenantId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere tenant_id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let query = client.database
          .from('tenant_users')
          .select('id, user_id, role, status, created_at')
          .eq('tenant_id', tenantId);

        if (role) {
          query = query.eq('role', role);
        }

        const { data: users, error } = await query.order('created_at');

        if (error) throw error;

        // Resolve emails from auth.users
        const enrichedUsers = [];
        for (const u of users || []) {
          let email = '';
          try {
            const { data: authUser } = await client.database
              .from('auth.users' as never)
              .select('email')
              .eq('id', u.user_id)
              .single();
            email = authUser?.email || '';
          } catch {}
          enrichedUsers.push({ ...u, email });
        }

        return new Response(
          JSON.stringify({ success: true, data: enrichedUsers, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'POST': {
        const body: AddUserRequest = await req.json();

        if (!body.tenant_id || !body.email || !body.name || !body.role) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: tenant_id, email, name, role' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: signUpData, error: signUpError } = await client.auth.signUp({
          email: body.email,
          password: `${body.email.split('@')[0]}Kytos`,
          name: body.name,
          redirectTo: 'https://kytos-hub.vercel.app'
        });

        let userId: string | null = null;
        if (!signUpError && signUpData?.user?.id) {
          userId = signUpData.user.id;

          await client.database.from('users_global').insert([{
            id: userId,
            email: body.email,
            password_hash: 'oauth',
            is_superadmin: false
          }]);
        }

        if (userId) {
          const { data: tu, error: tuError } = await client.database
            .from('tenant_users')
            .insert([{
              tenant_id: body.tenant_id,
              user_id: userId,
              role: body.role,
              status: 'ACTIVE'
            }])
            .select()
            .single();

          if (tuError) throw tuError;

          return new Response(
            JSON.stringify({ success: true, data: { tenant_user_id: tu.id, user_id: userId, email: body.email, role: body.role }, error: null }),
            { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'USER_CREATION_FAILED', message: 'No se pudo crear el usuario. Es posible que requiera verificación de email.' } }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT': {
        const body = await req.json();
        const userId = url.searchParams.get('user_id');

        if (!userId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere user_id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: tu, error } = await client.database
          .from('tenant_users')
          .update(body)
          .eq('id', userId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: tu, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE': {
        const userId = url.searchParams.get('user_id');

        if (!userId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere user_id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await client.database
          .from('tenant_users')
          .delete()
          .eq('id', userId);

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
    console.error('Error in list-condominium-users:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}