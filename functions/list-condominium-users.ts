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

    if (action === 'list-all') {
        const { data: tenants, error: tenantsError } = await client.database.from('tenants').select('id, name, schema_name');
        if (tenantsError) throw tenantsError;

        const allUsers: Array<Record<string, unknown>> = [];
        for (const t of tenants || []) {
          const tenantIdForQuery = (t as { id: string }).id;
          const schemaNameForQuery = (t as { schema_name?: string })?.schema_name;

          let query = client.database
            .from('tenant_users')
            .select('id, user_id, role, status, created_at')
            .eq('tenant_id', tenantIdForQuery);

          if (role && role !== 'RESIDENT') {
            query = query.eq('role', role);
          }

          const { data: users, error } = await query.order('created_at');
          if (error) throw error;

          for (const u of users || []) {
            let email = '';
            let name = '';
            try {
            const { data: ug } = await client.database.from('users_global').select('email, name, document_type, document_number, phone').eq('id', u.user_id).single();
              email = (ug as { email?: string })?.email || '';
              name = (ug as { name?: string })?.name || '';
            } catch {}
            allUsers.push({ ...u, tenant_id: tenantIdForQuery, tenant_name: (t as { name: string }).name, email, name, document_type: (ug as Record<string, unknown>)?.document_type || null, document_number: (ug as Record<string, unknown>)?.document_number || null, phone: (ug as Record<string, unknown>)?.phone || null, source: 'tenant_user' });
          }

          if (!role || role === 'RESIDENT') {
            try {
              if (schemaNameForQuery) {
                const db = client.database.schema(schemaNameForQuery);
                const rq = db.from('residents').select('id, full_name, email, user_id, relationship_type, created_at').not('email', 'is', null);
                const { data: resData, error: resError } = await rq.order('created_at');
                if (!resError) {
                  for (const r of (resData || []) as Array<Record<string, unknown>>) {
                    const rEmail = String((r as { email?: string })?.email || '').toLowerCase();
                    if (!rEmail) continue;
                    const exists = allUsers.some((u: { email?: string }) => String(u.email || '').toLowerCase() === rEmail);
                    if (!exists) {
                      allUsers.push({
                        id: r.id,
                        user_id: (r as { user_id?: string })?.user_id || null,
                        tenant_id: tenantIdForQuery,
                        tenant_name: (t as { name: string }).name,
                        role: 'RESIDENT',
                        status: 'ACTIVE',
                        created_at: r.created_at,
                        email: (r as { email?: string })?.email || '',
                        name: (r as { full_name?: string })?.full_name || '',
                        source: 'resident'
                      });
                    }
                  }
                }
              }
            } catch {}
          }
        }

        return new Response(
          JSON.stringify({ success: true, data: allUsers, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
            const { data: ug } = await client.database.from('users_global').select('email, name, document_type, document_number, phone').eq('id', u.user_id).single();
            email = (ug as { email?: string })?.email || '';
            name = (ug as { name?: string })?.name || '';
          } catch {}
          try {
            const { data: prof } = await client.auth.getProfile(u.user_id);
            if (!name) name = (prof as { name?: string } | null)?.name || '';
          } catch {}
          enrichedUsers.push({ ...u, email, name, document_type: (ug as Record<string, unknown>)?.document_type || null, document_number: (ug as Record<string, unknown>)?.document_number || null, phone: (ug as Record<string, unknown>)?.phone || null, source: 'tenant_user' });
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
                name: (r as { full_name?: string })?.full_name || '',
                source: 'resident'
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

      case 'POST':
      case 'create': {
        const reqBody = body as unknown as AddUserRequest;
        const email = String(reqBody.email).trim().toLowerCase();
        const defaultPassword = '12345678';
        const isGlobalSuperAdmin = reqBody.role === 'SUPER_ADMIN' && !reqBody.tenant_id;

        if (!reqBody.email || !reqBody.name || !reqBody.role) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Campos requeridos: email, name, role' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!isGlobalSuperAdmin && !reqBody.tenant_id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere un condominio (tenant_id) para este rol' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

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
          const ugPayload: Record<string, unknown> = { id: userId, email, name: reqBody.name, password_hash: defaultPassword, is_superadmin: isGlobalSuperAdmin };
          if (reqBody.document_type) ugPayload.document_type = reqBody.document_type;
          if (reqBody.document_number) ugPayload.document_number = reqBody.document_number;
          if (reqBody.phone) ugPayload.phone = reqBody.phone;
          const { error: ugError } = await client.database
            .from('users_global')
            .insert([ugPayload]);

          if (ugError) {
            // User already exists: update their profile instead of failing silently
            console.error('users_global insert error:', ugError);
            try {
              const ugUpdate: Record<string, unknown> = { name: reqBody.name, is_superadmin: isGlobalSuperAdmin };
              if (reqBody.document_type) ugUpdate.document_type = reqBody.document_type;
              if (reqBody.document_number) ugUpdate.document_number = reqBody.document_number;
              if (reqBody.phone) ugUpdate.phone = reqBody.phone;
              await client.database.from('users_global').update(ugUpdate).eq('id', userId);
            } catch (e2) { console.error('users_global update fallback error:', e2); }
          }
        }

        if (userId && reqBody.tenant_id) {
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

        if (userId && isGlobalSuperAdmin) {
          return new Response(
            JSON.stringify({ success: true, data: { tenant_user_id: null, user_id: userId, email, role: reqBody.role, global: true }, error: null }),
            { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'USER_CREATION_FAILED', message: 'No se pudo crear el usuario. Es posible que requiera verificación de email.' } }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'PUT':
      case 'update': {
        const id = body.id as string;
        const source = (body.source as string) || 'tenant_user';

        if (!id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (source === 'resident') {
          const schemaName = body.schema_name as string;
          if (!schemaName) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere schema_name' } }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const updates: Record<string, unknown> = {};
          if (body.name) updates.full_name = body.name;
          if (body.email) updates.email = body.email;
          if (body.phone) updates.phone = body.phone;
          if (body.document_type) updates.document_type = body.document_type;
          if (body.document_number) updates.document_number = body.document_number;

          const { data, error } = await client.database.schema(schemaName)
            .from('residents')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

          if (error) throw error;

          // Keep users_global in sync when this resident is linked to an account
          if ((data as { user_id?: string } | null)?.user_id) {
            try {
              const ugUpdate: Record<string, unknown> = {};
              if (body.name) ugUpdate.name = body.name;
              if (body.email) ugUpdate.email = body.email;
              if (body.document_type) ugUpdate.document_type = body.document_type;
              if (body.document_number) ugUpdate.document_number = body.document_number;
              if (body.phone) ugUpdate.phone = body.phone;
              await client.database.from('users_global').update(ugUpdate).eq('id', (data as { user_id: string }).user_id);
            } catch (e) { console.error('users_global resident sync error:', e); }
          }

          // Move resident to another condominium if requested
          const newTenantId = body.new_tenant_id as string | undefined;
          if (newTenantId && newTenantId !== (body.tenant_id as string)) {
            try {
              const { data: tenants } = await client.database.from('tenants').select('id, schema_name').eq('id', newTenantId).single();
              const newSchemaName = (tenants as { schema_name?: string } | null)?.schema_name;
              if (newSchemaName && newSchemaName !== schemaName) {
                const { data: existing } = await client.database.schema(newSchemaName).from('residents').select('id').eq('document_number', String((data as { document_number?: string })?.document_number || '')).single().catch(() => ({ data: null }));
                if (!existing) {
                  const resident = data as Record<string, unknown>;
                  const movePayload: Record<string, unknown> = {};
                  for (const col of ['department_id', 'full_name', 'document_type', 'document_number', 'relationship_type', 'is_primary_contact', 'email', 'phone', 'user_id']) {
                    if (resident[col] !== undefined) movePayload[col] = resident[col];
                  }
                  await client.database.schema(newSchemaName).from('residents').insert([movePayload]);
                  await client.database.schema(schemaName).from('residents').delete().eq('id', id);
                }
              }
            } catch (e) { console.error('resident move error:', e); }
          }

          return new Response(
            JSON.stringify({ success: true, data, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updates: Record<string, unknown> = {};
        if (body.role) updates.role = body.role;
        if (body.status) updates.status = body.status;
        if (body.tenant_id) updates.tenant_id = body.tenant_id;

        const { data: tu, error } = await client.database
          .from('tenant_users')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;

        if (tu?.user_id) {
          const hasProfileUpdate = body.email || body.name || body.document_type || body.document_number || body.phone;
          if (hasProfileUpdate) {
            try {
              const ugUpdate: Record<string, unknown> = {};
              if (body.email) ugUpdate.email = body.email;
              if (body.name) ugUpdate.name = body.name;
              if (body.document_type) ugUpdate.document_type = body.document_type;
              if (body.document_number) ugUpdate.document_number = body.document_number;
              if (body.phone) ugUpdate.phone = body.phone;
              await client.database.from('users_global').update(ugUpdate).eq('id', tu.user_id);
            } catch (e) { console.error('users_global update error:', e); }
          }
        }

        return new Response(
          JSON.stringify({ success: true, data: tu, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'DELETE':
      case 'delete': {
        const id = body.id as string;
        const source = (body.source as string) || 'tenant_user';

        if (!id) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (source === 'resident') {
          const schemaName = body.schema_name as string;
          if (!schemaName) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere schema_name' } }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const { error } = await client.database.schema(schemaName)
            .from('residents')
            .delete()
            .eq('id', id);
          if (error) throw error;
          return new Response(
            JSON.stringify({ success: true, data: null, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await client.database
          .from('tenant_users')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, data: null, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reset-password': {
        const userId = body.user_id as string;

        if (!userId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere user_id' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          const { data, error } = await client.database.rpc('admin_reset_password', {
            p_user_id: userId,
            p_password: '12345678'
          });

          if (error) throw error;

          return new Response(
            JSON.stringify({ success: true, data: { user_id: userId, default_password: '12345678', reset: data === true }, error: null }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (rpcErr) {
          console.error('reset-password error:', rpcErr);
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'RESET_FAILED', message: 'No se pudo restablecer la contraseña' } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
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