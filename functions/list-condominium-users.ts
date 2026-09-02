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

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const url = new URL(req.url);
    const tenantId = (body.tenant_id as string) || url.searchParams.get('tenant_id');
    const role = (body.role as string) || url.searchParams.get('role');
    const action = (body.action as string) || (req.method === 'GET' ? 'list' : '');

    if (action === 'list-by-user') {
      const userId = body.user_id as string;
      if (!userId) return new Response(JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'user_id requerido' } }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const { data, error } = await client.database.from('tenant_users').select('tenant_id, role, status').eq('user_id', userId).eq('status', 'ACTIVE');
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data: data || [], error: null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'list' || req.method === 'GET') {
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

        if (role && role !== 'RESIDENT') {
          query = query.eq('role', role);
        }

        const { data: users, error } = await query.order('created_at');

        if (error) throw error;

        const enrichedUsers = [];
        for (const u of users || []) {
          let email = '';
          let name = '';
          try {
            const { data: ug } = await client.database.from('users_global').select('email, name').eq('id', u.user_id).single();
            email = (ug as { email?: string })?.email || '';
            name = (ug as { name?: string })?.name || '';
          } catch {}
          enrichedUsers.push({ ...u, email, name });
        }

        // Include residents from the tenant schema so the users view is populated
        if (!role || role === 'RESIDENT') {
          let residents: Array<Record<string, unknown>> = [];
          try {
            const { data: tenantRow } = await client.database.from('tenants').select('schema_name').eq('id', tenantId).single();
            const schemaName = (tenantRow as { schema_name?: string } | null)?.schema_name;
            if (schemaName) {
              const db = client.database.schema(schemaName);
              const rq = db.from('residents').select('id, full_name, email, user_id, relationship_type, created_at').not('email', 'is', null);
              const { data: resData, error: resError } = await rq.order('created_at');
              if (!resError) residents = (resData || []) as Array<Record<string, unknown>>;
            }
          } catch {}

          for (const r of residents) {
            const rEmail = String((r as { email?: string })?.email || '').toLowerCase();
            if (!rEmail) continue;
            const exists = enrichedUsers.some((u: { email?: string }) => String(u.email || '').toLowerCase() === rEmail);
            if (!exists) {
              enrichedUsers.push({
                id: r.id,
                user_id: (r as { user_id?: string })?.user_id || null,
                role: 'RESIDENT',
                status: 'ACTIVE',
                created_at: r.created_at,
                email: (r as { email?: string })?.email || '',
                name: (r as { full_name?: string })?.full_name || ''
              });
            }
          }
        }

        return new Response(
          JSON.stringify({ success: true, data: enrichedUsers, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

    switch (action || req.method) {

      case 'POST': {
        const reqBody = body as unknown as AddUserRequest;
        if (!reqBody.tenant_id || !reqBody.email || !reqBody.name || !reqBody.role) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: tenant_id, email, name, role' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const email = String(reqBody.email).trim().toLowerCase();
        const defaultPassword = `${email.split('@')[0]}Kytos`;

        let userId: string | null = null;

        const { data: signUpData, error: signUpError } = await client.auth.signUp({
          email,
          password: defaultPassword,
          name: reqBody.name,
          redirectTo: 'https://kytos-hub.vercel.app',
          autoConfirm: true
        });

        userId = signUpData?.user?.id || null;

        if (!userId) {
          userId = await resolveUserIdByEmail(email);
        }

        if (signUpError && !userId) {
          throw signUpError;
        }

        if (userId) {
          const { error: ugError } = await client.database
            .from('users_global')
            .insert([{ id: userId, email, password_hash: defaultPassword, is_superadmin: false }]);

          if (ugError) {
            console.error('users_global insert error:', ugError);
          }
        }

        if (userId) {
          const { data: tu, error: tuError } = await client.database
            .from('tenant_users')
            .insert([{
              tenant_id: reqBody.tenant_id,
              user_id: userId,
              role: reqBody.role,
              status: 'ACTIVE'
            }]);

          if (tuError) throw tuError;

          return new Response(
            JSON.stringify({ success: true, data: { tenant_user_id: tu?.id ?? null, user_id: userId, email, role: reqBody.role }, error: null }),
            { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'USER_CREATION_FAILED', message: 'No se pudo crear el usuario. Es posible que requiera verificación de email.' } }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT': {
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