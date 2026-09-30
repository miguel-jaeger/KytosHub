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
      const tenantRows = data || [];

      // Residents may be linked only through each tenant schema's residents.user_id
      if (tenantRows.length === 0) {
        try {
          const { data: tenants } = await client.database.from('tenants').select('id, schema_name');
          for (const t of (tenants || []) as Array<{ id: string; schema_name?: string }>) {
            if (!t.schema_name) continue;
            try {
              const { data: r } = await client.database.schema(t.schema_name).from('residents').select('user_id').eq('user_id', userId).limit(1);
              if (r && (r as Array<{ user_id: string }>).length > 0) {
                tenantRows.push({ tenant_id: t.id, role: 'RESIDENT', status: 'ACTIVE' });
              }
            } catch {}
          }
        } catch {}
      }

      return new Response(JSON.stringify({ success: true, data: tenantRows, error: null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'list-all') {
        const { data: tenants, error: tenantsError } = await client.database.from('tenants').select('id, name, schema_name');
        if (tenantsError) throw tenantsError;

        const allUsers: Array<Record<string, unknown>> = [];
        const rawUsers: Array<{ tu: Record<string, unknown>; tenantId: string; tenantName: string }> = [];

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
            rawUsers.push({ tu: u, tenantId: tenantIdForQuery, tenantName: (t as { name: string }).name });
          }

          if (!role || role === 'RESIDENT') {
            try {
              if (schemaNameForQuery) {
                const db = client.database.schema(schemaNameForQuery);
                const rq = db.from('residents').select('id, full_name, email, user_id, relationship_type, created_at').not('email', 'is', null);
                const { data: resData, error: resError } = await rq.order('created_at');
                if (!resError) {
                  for (const r of (resData || []) as Array<Record<string, unknown>>) {
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
            } catch {}
          }
        }

        // Batch load every global profile in a few queries instead of one per user.
        const userIds = rawUsers.map(({ tu }) => String((tu as { user_id?: string }).user_id || '')).filter(Boolean);
        const ugMap = await batchLoadUsersGlobal(client, userIds);

        const existingEmails = new Set(
          allUsers.map((u: { email?: string }) => String(u.email || '').toLowerCase()).filter(Boolean)
        );

        for (const { tu, tenantId, tenantName } of rawUsers) {
          const uid = String((tu as { user_id?: string }).user_id || '');
          const ug = uid ? (ugMap.get(uid) as Record<string, unknown> | undefined) : undefined;
          const uEntry: Record<string, unknown> = {
            ...tu,
            tenant_id: tenantId,
            tenant_name: tenantName,
            email: (ug?.email as string) || '',
            name: (ug?.name as string) || '',
            document_type: (ug?.document_type as string) || null,
            document_number: (ug?.document_number as string) || null,
            phone: (ug?.phone as string) || null,
            source: 'tenant_user'
          };
          const em = String(uEntry.email || '').toLowerCase();
          if (!em || !existingEmails.has(em)) {
            if (em) existingEmails.add(em);
            allUsers.push(uEntry);
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

        // Batch load the global profile for every user in ONE query instead of
        // one per user (the previous N+1 loop plus an auth.getProfile per user was
        // what made the list so slow).
        const userIds = (users || []).map((u: { user_id: string }) => u.user_id).filter(Boolean);
        const ugMap = await batchLoadUsersGlobal(client, userIds);

        const enrichedUsers = (users || []).map((u) => {
          const ug = ugMap.get(u.user_id) as Record<string, unknown> | undefined;
          return {
            ...u,
            email: (ug?.email as string) || '',
            name: (ug?.name as string) || '',
            document_type: (ug?.document_type as string) || null,
            document_number: (ug?.document_number as string) || null,
            phone: (ug?.phone as string) || null,
            source: 'tenant_user'
          };
        });

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

          const existingEmails = new Set(
            enrichedUsers.map((u: { email?: string }) => String(u.email || '').toLowerCase()).filter(Boolean)
          );
          for (const r of residents) {
            const rEmail = String((r as { email?: string })?.email || '').toLowerCase();
            if (!rEmail || existingEmails.has(rEmail)) continue;
            existingEmails.add(rEmail);
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

        return new Response(
          JSON.stringify({ success: true, data: enrichedUsers, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

    switch (action || req.method) {

      case 'import': {
        const importTenantId = body.tenant_id as string;
        const rows = (Array.isArray(body.users) ? body.users : []) as Array<Record<string, unknown>>;

        if (!importTenantId) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere un condominio (tenant_id)' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const results = {
          created: 0,
          skipped: 0,
          existing: 0,
          failed: 0,
          errors: [] as Array<{ email: string; reason: string }>
        };
        const defaultPassword = '12345678';

        // Normalize rows once so validation and lookups are cheap.
        const normalizedRows: Array<{
          email: string;
          name: string;
          documentType: string | null;
          documentNumber: string;
          phone: string;
        }> = [];
        const seenEmails = new Set<string>();
        for (const row of rows) {
          const email = String(row.email ?? '').trim().toLowerCase();
          const name = String(row.name ?? '').trim();
          const documentNumber = String(row.document_number ?? '').trim();
          const normalizedRow = {
            email,
            name,
            documentType: normalizeDocumentType(String(row.document_type ?? '')),
            documentNumber,
            phone: String(row.phone ?? '').trim()
          };
          if (!email && !name) continue;
          if (seenEmails.has(email)) {
            results.failed++;
            results.errors.push({ email: email || '(sin correo)', reason: 'Correo duplicado en el archivo' });
            continue;
          }
          if (email) seenEmails.add(email);
          normalizedRows.push(normalizedRow);
        }

        if (normalizedRows.length > 0) {
          // 1) Bulk pre-load: map of emails already registered globally and the set
          //    of users already linked to this tenant. This avoids one auth lookup
          //    (and one signUp) per row, which previously made large imports time out.
          const existingGlobalByEmail = new Map<string, string>();
          const existingGlobalByDoc = new Map<string, { userId: string; email: string }>();
          const userEmails = Array.from(seenEmails);
          try {
            for (let i = 0; i < userEmails.length; i += 100) {
              const chunk = userEmails.slice(i, i + 100);
              if (chunk.length === 0) continue;
              const { data } = await client.database.from('users_global').select('id, email, document_type, document_number').in('email', chunk);
              for (const u of (data || []) as Array<{ id: string; email: string; document_type?: string | null; document_number?: string | null }>) {
                const em = String(u.email).toLowerCase();
                existingGlobalByEmail.set(em, String(u.id));
                if (u.document_type && u.document_number) {
                  existingGlobalByDoc.set(documentKey(String(u.document_type), String(u.document_number)), { userId: String(u.id), email: em });
                }
              }
            }
          } catch (e) { console.error('bulk users_global lookup error:', e); }

          // Document numbers are unique (DNI / CE / Pasaporte), so also look them up
          // globally even when the email differs from the row being imported.
          const docNumbers = Array.from(new Set(normalizedRows.filter(r => r.documentNumber).map(r => r.documentNumber)));
          try {
            for (let i = 0; i < docNumbers.length; i += 100) {
              const chunk = docNumbers.slice(i, i + 100);
              if (chunk.length === 0) continue;
              const { data } = await client.database.from('users_global').select('id, email, document_type, document_number').in('document_number', chunk);
              for (const u of (data || []) as Array<{ id: string; email: string; document_type?: string | null; document_number?: string | null }>) {
                if (u.document_type && u.document_number) {
                  existingGlobalByDoc.set(documentKey(String(u.document_type), String(u.document_number)), { userId: String(u.id), email: String(u.email).toLowerCase() });
                }
              }
            }
          } catch (e) { console.error('bulk document lookup error:', e); }

          const linkedUserIdSet = new Set<string>();
          try {
            const { data } = await client.database.from('tenant_users').select('user_id').eq('tenant_id', importTenantId);
            for (const u of (data || []) as Array<{ user_id: string }>) linkedUserIdSet.add(String(u.user_id));
          } catch (e) { console.error('bulk tenant_users lookup error:', e); }

          const processRow = async (row: { email: string; name: string; documentType: string | null; documentNumber: string; phone: string }) => {
            const { email, name, documentType, documentNumber, phone } = row;
            if (!email || !name) {
              results.failed++;
              results.errors.push({ email: email || '(sin correo)', reason: 'Faltan campos obligatorios (nombre y correo)' });
              return;
            }
            if (documentNumber && !documentType) {
              results.failed++;
              results.errors.push({ email, reason: 'Tipo de documento no válido (use DNI, CE o PASAPORTE)' });
              return;
            }
            const effectiveDocType = documentType || 'DNI';

            // Uniqueness checks: the document (DNI / CE / Pasaporte) is unique, so if
            // someone already holds it (or the email already exists), the user already
            // exists and we just notify it at the end instead of creating a duplicate.
            const existingDoc = documentNumber
              ? existingGlobalByDoc.get(documentKey(effectiveDocType, documentNumber))
              : undefined;
            const existingEmailId = existingGlobalByEmail.get(email);

            if (existingDoc && existingDoc.email !== email) {
              results.existing++;
              results.errors.push({
                email,
                reason: `Ya existe un usuario con documento ${documentNumber} (${effectiveDocType})${existingDoc.email ? ` asociado a ${existingDoc.email}` : ''}`
              });
              return;
            }
            if (existingDoc || existingEmailId) {
              results.existing++;
              results.errors.push({ email, reason: existingDoc ? 'Ya existe un usuario con ese documento' : 'Ya existe un usuario con ese correo' });
              return;
            }

            try {
              let userId = existingGlobalByEmail.get(email) || null;

              if (!userId) {
                const { data: signUpData, error: signUpError } = await client.auth.signUp({
                  email,
                  password: defaultPassword,
                  name,
                  redirectTo: 'https://kytos-hub.vercel.app',
                  autoConfirm: true
                });
                userId = signUpData?.user?.id || null;
                if (!userId) {
                  userId = await resolveUserIdByEmail(email);
                }
                if (!userId) {
                  throw new Error(signUpError ? signUpError.message : 'No se pudo crear la cuenta');
                }
              }

              if (linkedUserIdSet.has(userId)) {
                results.existing++;
                results.errors.push({ email, reason: 'Ya existe un usuario con ese correo en este condominio' });
                return;
              }

              const ugPayload: Record<string, unknown> = {
                id: userId,
                email,
                name,
                password_hash: defaultPassword,
                is_superadmin: false
              };
              if (documentNumber) {
                ugPayload.document_type = effectiveDocType;
                ugPayload.document_number = documentNumber;
              }
              if (phone) ugPayload.phone = phone;

              const { error: ugError } = await client.database.from('users_global').insert([ugPayload]);
              if (ugError) {
                const ugUpdate: Record<string, unknown> = { name };
                if (documentNumber) {
                  ugUpdate.document_type = effectiveDocType;
                  ugUpdate.document_number = documentNumber;
                }
                if (phone) ugUpdate.phone = phone;
                try {
                  await client.database.from('users_global').update(ugUpdate).eq('id', userId);
                } catch (e) { console.error('users_global update error:', e); }
              }

              await client.database.from('tenant_users').insert([{
                tenant_id: importTenantId,
                user_id: userId,
                role: 'RESIDENT',
                status: 'ACTIVE'
              }]);
              linkedUserIdSet.add(userId);
              existingGlobalByEmail.set(email, userId);
              if (documentNumber) existingGlobalByDoc.set(documentKey(effectiveDocType, documentNumber), { userId, email });
              results.created++;
            } catch (err) {
              results.failed++;
              results.errors.push({ email, reason: err instanceof Error ? err.message : 'Error interno' });
            }
          };

          // 2) Process rows with limited concurrency so large files finish
          //    before the function timeout.
          const CONCURRENCY = 6;
          let cursor = 0;
          const workers: Promise<void>[] = [];
          const worker = async () => {
            while (cursor < normalizedRows.length) {
              const i = cursor++;
              await processRow(normalizedRows[i]);
            }
          };
          for (let w = 0; w < Math.min(CONCURRENCY, normalizedRows.length); w++) workers.push(worker());
          await Promise.all(workers);
        }

        return new Response(
          JSON.stringify({ success: true, data: results, error: null }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

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

        // An email identifies a single global identity; do not silently re-use it
        // to create what the admin thinks is a new user in another condominium
        // (that made later email edits affect both).
        const existingUser = await resolveUserIdByEmail(email);
        if (existingUser) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'EMAIL_EXISTS', message: 'Ya existe un usuario con ese correo. No se puede crear otro usuario con el mismo correo; víncule la cuenta existente en el condominio.' } }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

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
          const { data: existingTu } = await client.database
            .from('tenant_users')
            .select('id')
            .eq('user_id', userId)
            .eq('tenant_id', reqBody.tenant_id)
            .single();

          if (existingTu) {
            return new Response(
              JSON.stringify({ success: false, data: null, error: { code: 'USER_EXISTS_IN_TENANT', message: 'El usuario ya pertenece a este condominio' } }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

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
            const linkedUserId = (data as { user_id: string }).user_id;
            if (body.email) {
              const dupe = await findUserGlobalByEmail(client, String(body.email));
              if (dupe && dupe.id !== linkedUserId) {
                return new Response(
                  JSON.stringify({ success: false, data: null, error: { code: 'EMAIL_EXISTS', message: 'Ya existe otro usuario con ese correo' } }),
                  { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            }
            try {
              const ugUpdate: Record<string, unknown> = {};
              if (body.name) ugUpdate.name = body.name;
              if (body.email) ugUpdate.email = body.email;
              if (body.document_type) ugUpdate.document_type = body.document_type;
              if (body.document_number) ugUpdate.document_number = body.document_number;
              if (body.phone) ugUpdate.phone = body.phone;
              await client.database.from('users_global').update(ugUpdate).eq('id', linkedUserId);
              if (body.email) await syncAuthEmail(client, linkedUserId, String(body.email));
            } catch (e) { console.error('users_global resident sync error:', e); }
          }

          // Move resident to another condominium if requested
          const newTenantId = body.new_tenant_id as string | undefined;
          if (newTenantId && newTenantId !== (body.tenant_id as string)) {
            try {
              const { data: tenants } = await client.database.from('tenants').select('id, schema_name').eq('id', newTenantId).single();
              const newSchemaName = (tenants as { schema_name?: string } | null)?.schema_name;
              if (newSchemaName && newSchemaName !== schemaName) {
                const { data: existing } = await client.database.schema(newSchemaName).from('residents').select('id').eq('document_number', String((data as { document_number?: string })?.document_number || '')).single();
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

        let tu: { id?: string; user_id?: string } | null = null;

        if (Object.keys(updates).length > 0) {
          const { data, error } = await client.database
            .from('tenant_users')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
          if (error) throw error;
          tu = data;
        } else {
          const { data } = await client.database
            .from('tenant_users')
            .select('id, user_id')
            .eq('id', id)
            .single();
          tu = data || null;
        }

        if (tu?.user_id) {
          if (body.email) {
            const dupe = await findUserGlobalByEmail(client, String(body.email));
            if (dupe && dupe.id !== tu.user_id) {
              return new Response(
                JSON.stringify({ success: false, data: null, error: { code: 'EMAIL_EXISTS', message: 'Ya existe otro usuario con ese correo' } }),
                { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
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
              if (body.email) await syncAuthEmail(client, tu.user_id, String(body.email));
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

      case 'bulk-delete': {
        const items = (Array.isArray(body.items) ? body.items : []) as Array<{ id?: string; user_id?: string; source?: string; schema_name?: string; tenant_id?: string }>;
        if (items.length === 0) {
          return new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'No se recibieron usuarios para eliminar' } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let deleted = 0;
        const failed: Array<{ id: string; reason: string }> = [];

        // Delete each item with an equality filter (the same path the single delete
        // uses; IN() filters are not reliable for deletes on this backend). A user
        // may show both as a tenant_user and as a resident, so both records are
        // removed to make the user actually disappear from the list.
        for (const it of items) {
          const id = String(it.id || '').trim();
          if (!id) continue;
          const userId = String(it.user_id || '').trim();
          const isResident = it.source === 'resident';
          try {
            let schema = String(it.schema_name || '').trim();
            if (!schema && it.tenant_id) {
              const { data: tenantRow } = await client.database.from('tenants').select('schema_name').eq('id', String(it.tenant_id)).single();
              schema = String((tenantRow as { schema_name?: string } | null)?.schema_name || '');
            }
            if (!schema) {
              failed.push({ id, reason: 'No se pudo resolver el condominio del usuario' });
              continue;
            }

            if (isResident) {
              await client.database.schema(schema).from('residents').delete().eq('id', id);
              deleted++;
              if (userId) {
                try {
                  await client.database.from('tenant_users').delete().eq('user_id', userId).eq('tenant_id', String(it.tenant_id || ''));
                  deleted++;
                } catch {}
              }
            } else {
              await client.database.from('tenant_users').delete().eq('id', id);
              deleted++;
              if (userId) {
                try {
                  await client.database.schema(schema).from('residents').delete().eq('user_id', userId);
                } catch {}
              }
            }
          } catch (e) {
            failed.push({ id, reason: e instanceof Error ? e.message : 'Error interno' });
          }
        }

        return new Response(
          JSON.stringify({ success: true, data: { deleted, failed }, error: null }),
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

function normalizeDocumentType(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (v === 'dni') return 'DNI';
  if (['ce', 'carnetdeextranjeria', 'carnetdeextranjera', 'extranjeria', 'extranjera', 'carnetextranjeria', 'carnetextranjera'].includes(v)) return 'CE';
  if (['pasaporte', 'passport', 'passeport', 'pasaport'].includes(v)) return 'PASAPORTE';
  return null;
}

// Normalizes a stored document type (DNI / CE / PASAPORTE) to a canonical value.
function canonicalDocumentType(value: string): string {
  const v = value.trim().toUpperCase();
  if (v === 'DNI') return 'DNI';
  if (v === 'CE' || v.includes('EXTRANJER') || v === 'CARNET') return 'CE';
  return 'PASAPORTE';
}

// Unique identity key for a person: document type + document number are unique.
function documentKey(documentType: string, documentNumber: string): string {
  return `${canonicalDocumentType(documentType)}:${documentNumber.trim().toLowerCase()}`;
}

async function findUserGlobalByEmail(client: ReturnType<typeof createAdminClient>, email: string) {
  const normalized = String(email).trim().toLowerCase();
  try {
    const { data } = await client.database.from('users_global').select('id').eq('email', normalized).single();
    return data || null;
  } catch { return null; }
}

// Loads the global profiles for many user ids with a single table scan instead of
// per-user round trips (or an IN() filter that the backend may expand per value),
// which previously made user listing/search scale linearly with the user count.
async function batchLoadUsersGlobal(
  client: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const wanted = new Set(userIds.map((v: string) => String(v || '')).filter(Boolean));
  const map = new Map<string, Record<string, unknown>>();
  if (wanted.size === 0) return map;
  try {
    const { data, error } = await client.database.from('users_global').select('id, email, name, document_type, document_number, phone').limit(10000);
    if (error || !Array.isArray(data)) return map;
    for (const u of (data as Array<{ id?: string } & Record<string, unknown>>)) {
      if (u.id && wanted.has(String(u.id))) map.set(String(u.id), u);
    }
  } catch (e) { console.error('users_global scan error:', e); }
  return map;
}

async function syncAuthEmail(client: ReturnType<typeof createAdminClient>, userId: string, email: string) {
  try {
    await client.database.rpc('sync_auth_email', { p_user_id: userId, p_email: String(email).trim().toLowerCase() });
  } catch (e) { console.error('sync_auth_email error:', e); }
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