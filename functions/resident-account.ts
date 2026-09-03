import { createAdminClient } from 'npm:@insforge/sdk';

const DEFAULT_PASSWORD = '12345678';

export default async function(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const action = body.action as string;

    switch (action) {
      case 'create': {
        // Creates an auth account for a proprietor resident
        const { email, full_name, document_number, relationship_type } = body as {
          email?: string;
          full_name?: string;
          document_number?: string;
          relationship_type?: string;
        };

        if (!email || !full_name) {
          return bad(corsHeaders, 'email y full_name son requeridos');
        }

        let userId: string | null = null;

        const { data: signUpData, error: signUpError } = await client.auth.signUp({
          email,
          password: DEFAULT_PASSWORD,
          name: full_name,
          redirectTo: 'https://kytos-hub.vercel.app',
          autoConfirm: true
        });

        userId = signUpData?.user?.id || null;

        if (!userId) {
          userId = await resolveUserIdByEmail(email);
        }

        if (signUpError && !userId) {
          // User may already exist in auth.users; resolve by email
          const resolved = await resolveUserIdByEmail(email);
          if (resolved) {
            userId = resolved;
          } else {
            console.error('signUp error:', signUpError);
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'SIGNUP_FAILED', message: signUpError.message } }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        if (userId) {
          // Insert into users_global
          const { error: ugInsertError } = await client.database.from('users_global').insert([{
            id: userId,
            email,
            name: full_name,
            password_hash: DEFAULT_PASSWORD,
            is_superadmin: false
          }]);

          if (ugInsertError && !String(ugInsertError).includes('duplicate')) {
            console.error('users_global insert error:', ugInsertError);
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              email,
              user_id: userId,
              default_password: DEFAULT_PASSWORD,
              relationship_type
            },
            error: null
          }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'change-password': {
        // Change the authenticated user's password
        const authHeader = req.headers.get('Authorization');
        const userToken = authHeader ? authHeader.replace('Bearer ', '') : null;
        if (!userToken) return bad(corsHeaders, 'Usuario no autenticado');

        const userClient = createClient({
          baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
          anonKey: Deno.env.get('ANON_KEY')
        });

        const { data: current } = await userClient.auth.getCurrentUser();
        if (!current?.user) return bad(corsHeaders, 'Usuario no encontrado');

        const { current_password, new_password } = body as { current_password?: string; new_password?: string };
        if (!current_password || !new_password) {
          return bad(corsHeaders, 'current_password y new_password son requeridos');
        }
        if (new_password.length < 6) {
          return bad(corsHeaders, 'La nueva contraseña debe tener al menos 6 caracteres');
        }

        // Verify current password
        const { error: verifyError } = await userClient.auth.signInWithPassword({
          email: current.user.email,
          password: current_password
        });
        if (verifyError) {
          return bad(corsHeaders, 'La contraseña actual es incorrecta');
        }

        // Update password via admin
        const { error: updateError } = await client.database
          .from('auth.users')
          .update({ password: new_password })
          .eq('id', current.user.id);

        if (updateError) {
          console.error('update password error:', updateError);
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'PASSWORD_FAILED', message: String(updateError) } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, data: null, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in resident-account:', error);
    return new Response(
      JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }),
    { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}

async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  const apiKey = Deno.env.get('INSFORGE_API_KEY');
  if (!baseUrl || !apiKey) return null;

  try {
    const res = await fetch(`${baseUrl}/api/auth/users?search=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { id: string; email: string }[] };
    const match = (json.data || []).find(u => String(u.email).toLowerCase() === email);
    return match?.id || null;
  } catch {
    return null;
  }
}