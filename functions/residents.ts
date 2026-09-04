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
    const action = (body.action as string) || 'list';

    if (!schemaName) return bad(corsHeaders, 'schema_name es requerido');
    const db = client.database.schema(schemaName);

    const refreshTenantCounts = async () => {
      try {
        const { data: tenant } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
        if (tenant?.id) {
          await client.database.rpc('refresh_tenant_counts', { p_tenant_id: tenant.id });
        }
      } catch {}
    };

    // Resolve a user's real document from their resident records across all tenant schemas
    const resolveDocsFromResidents = async (userIds: string[]): Promise<Map<string, { document_type: string; document_number: string; phone: string | null }>> => {
      const map = new Map<string, { document_type: string; document_number: string; phone: string | null }>();
      if (!userIds.length) return map;
      try {
        const { data: tenants } = await client.database.from('tenants').select('schema_name');
        const schemas = [...new Set((tenants || []).map((t: { schema_name?: string }) => t.schema_name).filter(Boolean))];
        for (const s of schemas) {
          try {
            const { data: rows } = await client.database.schema(s)
              .from('residents')
              .select('user_id, document_type, document_number, phone')
              .in('user_id', userIds);
            for (const row of (rows || []) as Array<{ user_id?: string; document_type?: string; document_number?: string; phone?: string | null }>) {
              if (row.user_id && row.document_number && !map.has(row.user_id)) {
                map.set(row.user_id, {
                  document_type: row.document_type || 'DNI',
                  document_number: row.document_number,
                  phone: row.phone || null
                });
              }
            }
          } catch {}
        }
      } catch {}
      return map;
    };

    switch (action) {
      case 'list': {
        let q = db.from('residents').select('*');
        if (body.department_id) q = q.eq('department_id', body.department_id);
        if (body.search) {
          const term = `%${String(body.search).trim()}%`;
          q = q.or(`full_name.ilike.${term},document_number.ilike.${term},email.ilike.${term}`);
        }
        const { data, error } = await q.order('created_at', { ascending: false });
        if (error) throw error;
        const residents = (data || []) as Array<Record<string, unknown>>;
        if (residents.length === 0 && !body.include_users) return ok(corsHeaders, []);
        const deptIds = [...new Set(residents.map((r: { department_id: string }) => r.department_id))];
        const { data: depts } = deptIds.length ? await db.from('departments').select('id, department_number, tower_id').in('id', deptIds) : { data: [] } as { data: { id: string; department_number: string; tower_id: string }[] };
        const towerIds = [...new Set((depts || []).map((d: { tower_id: string }) => d.tower_id))];
        const { data: towers } = towerIds.length ? await db.from('towers').select('id, name, code').in('id', towerIds) : { data: [] } as { data: { id: string; name: string; code: string }[] };
        const deptMap = new Map((depts || []).map((d: { id: string; department_number: string; tower_id: string }) => [d.id, d]));
        const towerMap = new Map((towers || []).map((t: { id: string; name: string; code: string }) => [t.id, t]));
        const enriched = residents.map((r: Record<string, unknown>) => {
          const dept = deptMap.get(r.department_id as string) as { department_number: string; tower_id: string } | undefined;
          const tower = dept ? towerMap.get(dept.tower_id) as { name: string; code: string } | undefined : undefined;
          return { ...r, departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined };
        });

        // Include global condominium users (from tenant_users + users_global) that are not yet residents
        let merged = enriched;
        const found: Array<Record<string, unknown>> = [];
        if (body.include_users) {
          const existingEmails = new Set(
            (residents as Array<{ email?: string | null }>).map(r => String(r.email || '').toLowerCase()).filter(Boolean)
          );

          if (body.all_users) {
            // Super admin: search across ALL global users (users_global), not only this condominium's
            try {
              const { data: allUsers } = await client.database.from('users_global').select('id, email, name, document_type, document_number, phone');
              for (const ug of (allUsers || []) as Array<{ id: string; email?: string; name?: string; document_type?: string; document_number?: string; phone?: string }>) {
                const existing = residents.find((r: Record<string, unknown>) => r.user_id === ug.id);
                if (existing) continue;
                const email = String(ug.email || '').toLowerCase();
                if (email && existingEmails.has(email)) continue;
                if (email) existingEmails.add(email);
                found.push({
                  id: null,
                  user_id: ug.id,
                  global_user: true,
                  role: null,
                  full_name: ug.name || email.split('@')[0] || 'Usuario',
                  email: ug.email || null,
                  phone: ug.phone || null,
                  document_type: ug.document_type || null,
                  document_number: ug.document_number || '',
                  relationship_type: null,
                  is_primary_contact: false,
                  departments: undefined,
                  created_at: null
                });
              }
            } catch {}
          } else if (body.tenant_id) {
            const tenantId = body.tenant_id as string;
            const { data: tuRows } = await client.database.from('tenant_users').select('user_id, role').eq('tenant_id', tenantId).eq('status', 'ACTIVE');
            for (const tu of (tuRows || []) as Array<{ user_id: string; role: string }>) {
              const existing = residents.find((r: Record<string, unknown>) => r.user_id === tu.user_id);
              if (existing) continue;
              let email = '';
              let name = '';
              let docType = '';
              let docNumber = '';
              let phone = '';
              try {
                const { data: ug } = await client.database.from('users_global').select('email, name, document_type, document_number, phone').eq('id', tu.user_id).single();
                email = String((ug as { email?: string } | null)?.email || '');
                name = String((ug as { name?: string } | null)?.name || '');
                docType = String((ug as { document_type?: string } | null)?.document_type || '');
                docNumber = String((ug as { document_number?: string } | null)?.document_number || '');
                phone = String((ug as { phone?: string } | null)?.phone || '');
              } catch {}
              if (email && existingEmails.has(email.toLowerCase())) continue;
              if (email) existingEmails.add(email.toLowerCase());
              found.push({
                id: null,
                user_id: tu.user_id,
                global_user: true,
                role: tu.role,
                full_name: name || email.split('@')[0] || 'Usuario',
                email: email || null,
                phone: phone || null,
                document_type: docType || null,
                document_number: docNumber,
                relationship_type: null,
                is_primary_contact: false,
                departments: undefined,
                created_at: null
              });
            }
          }
        }
        merged = [...enriched, ...found];

        // Fill in the real document for users that only have it in their resident records
        const docMissing = (found as Array<Record<string, unknown>>).filter(f => !String(f.document_number || '')).map(f => String(f.user_id || '')).filter(Boolean);
        if (docMissing.length) {
          const docs = await resolveDocsFromResidents(docMissing);
          for (const f of (found as Array<Record<string, unknown>>)) {
            const d = docs.get(String(f.user_id || ''));
            if (d) {
              if (!f.document_number) f.document_number = d.document_number;
              if (!f.document_type) f.document_type = d.document_type;
              if (!f.phone) f.phone = d.phone;
            }
          }
        }

        return ok(corsHeaders, merged);
      }

      case 'link-user': {
        // Attach an existing global user as a resident of the given department
        const { user_id, department_id, relationship_type, is_primary_contact, document_type, document_number } = body as {
          user_id?: string;
          department_id?: string;
          relationship_type?: string;
          is_primary_contact?: boolean;
          document_type?: string;
          document_number?: string;
        };
        if (!user_id || !department_id) {
          return bad(corsHeaders, 'user_id y department_id son requeridos');
        }
        let email = '';
        let fullName = 'Usuario';
        try {
          const { data: ug } = await client.database.from('users_global').select('email, name').eq('id', user_id).single();
          email = String((ug as { email?: string } | null)?.email || '');
          fullName = (ug as { name?: string } | null)?.name || email.split('@')[0] || 'Usuario';
        } catch {}

        let existingDoc: unknown = null;
        try {
          const { data: ed } = await db.from('residents').select('id').eq('department_id', department_id).eq('user_id', user_id).single();
          existingDoc = ed;
        } catch {}
        if (existingDoc) {
          return ok(corsHeaders, existingDoc);
        }

        // Prefer the user's real document (from users_global or their resident records)
        let finalDocType = document_type || 'DNI';
        let finalDocNumber = document_number || '';
        if (!finalDocNumber) {
          const docs = await resolveDocsFromResidents([user_id]);
          const d = docs.get(user_id);
          if (d) {
            finalDocType = d.document_type;
            finalDocNumber = d.document_number;
          }
        }
        if (!finalDocNumber) {
          finalDocNumber = `USR${user_id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
        }
        const { data, error } = await db.from('residents').insert([{
          department_id,
          full_name: fullName,
          document_type: finalDocType,
          document_number: finalDocNumber,
          relationship_type: relationship_type || 'PROPIETARIO',
          is_primary_contact: is_primary_contact || false,
          email: email || null,
          phone: null,
          user_id
        }]).select().single();
        if (error) throw error;
        await refreshTenantCounts();
        return new Response(JSON.stringify({ success: true, data, error: null }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'create': {
        if (!body.department_id || !body.full_name || !body.document_type || !body.document_number || !body.relationship_type) {
          return bad(corsHeaders, 'department_id, full_name, document_type, document_number, relationship_type son requeridos');
        }

        const { data, error } = await db.from('residents').insert([{
          department_id: body.department_id,
          full_name: String(body.full_name).trim(),
          document_type: body.document_type,
          document_number: String(body.document_number).trim(),
          relationship_type: body.relationship_type,
          is_primary_contact: body.is_primary_contact || false,
          email: body.email || null,
          phone: body.phone || null,
          user_id: body.user_id || null
        }]).select().single();

        if (error) {
          const errString = String((error as { message?: string })?.message || error);
          const dup = errString.match(/23505|duplicate key|unique constraint/i);
          if (dup) {
            await refreshTenantCounts();
            return ok(corsHeaders, null);
          }
          throw error;
        }

        await refreshTenantCounts();
        return new Response(JSON.stringify({ success: true, data, error: null }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const update = { ...body } as Record<string, unknown>;
        delete update.id; delete update.schema_name; delete update.action;
        const { data, error } = await db.from('residents').update(update).eq('id', body.id).select().single();
        if (error) throw error;
        await refreshTenantCounts();
        return ok(corsHeaders, data);
      }

      case 'delete': {
        if (!body.id) return bad(corsHeaders, 'id es requerido');
        const { error } = await db.from('residents').delete().eq('id', body.id);
        if (error) throw error;
        await refreshTenantCounts();
        return ok(corsHeaders, null);
      }

      default:
        return bad(corsHeaders, `Acción desconocida: ${action}`);
    }
  } catch (error) {
    console.error('Error in residents:', error);
    return new Response(JSON.stringify({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: String(error) } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

function ok(cors: Record<string, string>, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function bad(cors: Record<string, string>, msg: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code: 'BAD_REQUEST', message: msg } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
}