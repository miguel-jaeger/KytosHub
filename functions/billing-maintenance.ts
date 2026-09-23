import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const DEFAULT_CONFIG = {
  default_fee: 150,
  due_days: 5,
  autolink_cart_fines: true
};

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = (body.action as string) || 'list-periods';
    const schemaName = body.schema_name as string;
    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const db = client.database.schema(schemaName);
    const isAdmin = await isAdminForSchema(req, client, schemaName);
    const uid = await currentUserId(req, client);
    const myDepartmentId = uid ? await departmentOfUser(req, client, db, uid) : null;

    // Module guard: billing_maintenance must be enabled for this condominium
    const moduleOn = await isModuleEnabled(db, 'billing_maintenance');
    if (!moduleOn) return forbidden('Módulo inactivo para este condominio');

    if (action === 'get-config') {
      const cfg = await loadConfig(db);
      return json({ success: true, data: cfg, error: null }, 200);
    }

    if (action === 'update-config') {
      if (!isAdmin) return forbidden('No tienes permisos para editar la configuración');
      const cur = await loadConfig(db);
      const next: Record<string, unknown> = { ...cur };
      if (typeof body.default_fee === 'number') next.default_fee = body.default_fee;
      if (typeof body.due_days === 'number') next.due_days = Math.max(0, Math.round(body.due_days));
      if (typeof body.autolink_cart_fines === 'boolean') next.autolink_cart_fines = body.autolink_cart_fines;
      await db.from('condo_settings').update({ config_json: next, updated_at: new Date().toISOString() }).eq('module_key', 'billing_maintenance');
      return json({ success: true, data: next, error: null }, 200);
    }

    if (action === 'list-periods') {
      return json({ success: true, data: await listPeriodsWithStats(db), error: null }, 200);
    }

    if (action === 'create-period') {
      if (!isAdmin) return forbidden('No tienes permisos para crear períodos');
      const label = String(body.label || '').trim();
      const startDate = body.start_date as string;
      const endDate = body.end_date as string;
      if (!label || !startDate || !endDate) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'label, start_date y end_date son requeridos' } }, 400);
      }
      const start = new Date(String(startDate));
      const end = new Date(String(endDate));
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Rango de fechas inválido' } }, 400);
      }
      const cfg = await loadConfig(db);
      const due = body.due_date ? new Date(String(body.due_date)) : new Date(end.getTime() + (Number(cfg.due_days) || 0) * 86400000);
      const cycleKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
      const { data: existing } = await db.from('billing_cycles').select('id').eq('cycle_key', cycleKey).maybeSingle();
      if (existing) {
        return json({ success: false, data: null, error: { code: 'DUPLICATE', message: `Ya existe un período para ${label} (${cycleKey})` } }, 409);
      }
      const { data, error } = await db.from('billing_cycles').insert([{
        cycle_key: cycleKey,
        label,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        due_date: due.toISOString().slice(0, 10),
        is_closed: false
      }]).select().single();
      if (error) throw error;
      await generateInvoicesForCycle(db, data.id, cfg, body.amount as number | undefined);
      return json({ success: true, data: data, error: null }, 201);
    }

    if (action === 'generate-invoices') {
      if (!isAdmin) return forbidden('No tienes permisos para generar recibos');
      const id = body.period_id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'period_id es requerido' } }, 400);
      const cfg = await loadConfig(db);
      if (body.regenerate === true) {
        // Delete existing invoices (cascades to fines and payments) so the
        // period can be rebuilt from scratch after an error.
        await db.from('invoices').delete().eq('cycle_id', id);
      }
      const created = await generateInvoicesForCycle(db, id, cfg);
      return json({ success: true, data: { period_id: id, created }, error: null }, 200);
    }

    if (action === 'delete-period') {
      if (!isAdmin) return forbidden('No tienes permisos para eliminar períodos');
      const id = body.period_id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'period_id es requerido' } }, 400);
      // Deleting the cycle cascades to its invoices, fines and payments
      const { data, error } = await db.from('billing_cycles').delete().eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'list-department-fees') {
      if (!isAdmin) return forbidden('No tienes permisos para ver la configuración');
      const { data: depts } = await db.from('departments').select('id, department_number, tower_id');
      const deptIds = (depts || []).map((d: { id: string }) => d.id);
      const towerIds = [...new Set((depts || []).map((d: { tower_id: string }) => d.tower_id))];
      const { data: towers } = towerIds.length ? await db.from('towers').select('id, name, code').in('id', towerIds) : { data: [] } as { data: Array<{ id: string; name: string; code: string }> };
      const towerMap = new Map((towers || []).map(t => [t.id, t]));
      const { data: fees } = deptIds.length ? await db.from('department_fees').select('*').in('department_id', deptIds) : { data: [] } as { data: Array<Record<string, unknown>> };
      const feeMap = new Map((fees || []).map(f => [f.department_id, f]));
      const cfg = await loadConfig(db);
      const rows = (depts || []).map((d: { id: string; department_number: string; tower_id: string }) => {
        const fee = feeMap.get(d.id) as Record<string, unknown> | undefined;
        return {
          department_id: d.id,
          department_number: d.department_number,
          tower: towerMap.get(d.tower_id) ? { id: d.tower_id, name: towerMap.get(d.tower_id)!.name, code: towerMap.get(d.tower_id)!.code } : null,
          amount: fee ? Number(fee.amount) : Number(cfg.default_fee),
          is_exempt: fee ? Boolean(fee.is_exempt) : false,
          notes: fee ? (fee.notes || null) : null
        };
      });
      return json({ success: true, data: rows, error: null }, 200);
    }

    if (action === 'set-department-fee') {
      if (!isAdmin) return forbidden('No tienes permisos para configurar cuotas');
      const departmentId = body.department_id as string;
      if (!departmentId) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'department_id es requerido' } }, 400);
      const amount = Number(body.amount) || 0;
      const isExempt = body.is_exempt !== false;
      const notes = body.notes ? String(body.notes).trim() || null : null;
      const { data: existing } = await db.from('department_fees').select('id').eq('department_id', departmentId).maybeSingle();
      let data: unknown;
      if (existing) {
        const { data: d, error } = await db.from('department_fees').update({ amount, is_exempt: isExempt, notes }).eq('id', (existing as { id: string }).id).select().single();
        if (error) throw error;
        data = d;
      } else {
        const { data: d, error } = await db.from('department_fees').insert([{ department_id: departmentId, amount, is_exempt: isExempt, notes }]).select().single();
        if (error) throw error;
        data = d;
      }
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'list-invoices') {
      if (!isAdmin) return forbidden('No tienes permisos para ver recibos');
      const invoices = await listInvoices(db, body);
      return json({ success: true, data: invoices, error: null }, 200);
    }

    if (action === 'save-receipt') {
      if (!isAdmin) return forbidden('No tienes permisos para guardar recibos');
      const id = body.invoice_id as string;
      const receiptData = body.receipt_data as Record<string, unknown> | null;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'invoice_id es requerido' } }, 400);
      const { data, error } = await db.from('invoices').update({ receipt_data: receiptData || null }).eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'save-variable-data') {
      if (!isAdmin) return forbidden('No tienes permisos para registrar datos variables');
      const id = body.invoice_id as string;
      const variableData = body.variable_data as Record<string, unknown> | null;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'invoice_id es requerido' } }, 400);
      const { data, error } = await db.from('invoices').update({ variable_data: variableData || null }).eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'register-payment') {
      if (!isAdmin) return forbidden('No tienes permisos para registrar pagos');
      const id = body.invoice_id as string;
      const amount = Number(body.amount);
      if (!id || !amount || amount <= 0) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'invoice_id y un monto válido son requeridos' } }, 400);
      }
      const { data: inv } = await db.from('invoices').select('id, department_id, amount, paid_amount, status').eq('id', id).single();
      if (!inv) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Recibo no encontrado' } }, 404);
      const paid = Number((inv as { paid_amount: number }).paid_amount) + amount;
      const total = Number((inv as { amount: number }).amount);
      let status = 'PENDIENTE';
      if (paid >= total && total > 0) {
        status = 'PAGADA';
      } else if (paid > 0) {
        status = 'PARCIAL';
      }
      const { data, error } = await db.from('invoices').update({
        paid_amount: paid,
        status,
        paid_at: status === 'PAGADA' ? new Date().toISOString() : null,
        notes: body.notes ? String(body.notes).trim() || null : null
      }).eq('id', id).select().single();
      if (error) throw error;
      const { error: payErr } = await db.from('billing_payments').insert([{
        invoice_id: id,
        department_id: (inv as { department_id: string }).department_id,
        amount,
        payment_date: body.payment_date ? String(body.payment_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        notes: body.notes ? String(body.notes).trim() || null : null,
        registered_by_user_id: uid
      }]);
      if (payErr) throw payErr;
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'list-payments') {
      // Admin: full history (optionally filtered by department). Resident: own department only.
      if (!isAdmin && !myDepartmentId) return forbidden('No tienes permisos para ver pagos');
      const departmentId = isAdmin ? (body.department_id as string | undefined) : myDepartmentId;
      const payments = await listPayments(db, departmentId);
      return json({ success: true, data: payments, error: null }, 200);
    }

    if (action === 'add-fine') {
      if (!isAdmin) return forbidden('No tienes permisos para registrar multas');
      const departmentId = body.department_id as string;
      const concept = String(body.concept || '').trim();
      const amount = Number(body.amount);
      if (!departmentId || !concept || !amount || amount <= 0) {
        return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'department_id, concept y un monto válido son requeridos' } }, 400);
      }
      const invoiceId = body.invoice_id ? await resolveInvoiceForDepartment(db, departmentId, body.period_id as string | undefined) : null;
      const { data, error } = await db.from('billing_fines').insert([{
        invoice_id: invoiceId,
        department_id: departmentId,
        source: 'OPERATIVE',
        cart_loan_id: null,
        concept,
        amount,
        status: 'PENDIENTE'
      }]).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 201);
    }

    if (action === 'list-fines') {
      if (!isAdmin) return forbidden('No tienes permisos para ver multas');
      const fines = await listFines(db, body);
      return json({ success: true, data: fines, error: null }, 200);
    }

    if (action === 'pay-fine') {
      if (!isAdmin) return forbidden('No tienes permisos para pagar multas');
      const id = body.fine_id as string;
      if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'fine_id es requerido' } }, 400);
      const { data, error } = await db.from('billing_fines').update({ status: 'PAGADA' }).eq('id', id).select().single();
      if (error) throw error;
      return json({ success: true, data, error: null }, 200);
    }

    if (action === 'sync-cart-fines') {
      if (!isAdmin) return forbidden('No tienes permisos para sincronizar multas');
      const cfg = await loadConfig(db);
      const created = cfg.autolink_cart_fines ? await syncCartFines(db) : 0;
      return json({ success: true, data: { created }, error: null }, 200);
    }

    if (action === 'my-invoices') {
      // Resident: their own invoices + fines for their department
      if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
      const invoices = await listInvoices(db, { department_id: myDepartmentId, period_id: body.period_id as string | undefined });
      const fines = await listFines(db, { department_id: myDepartmentId });
      return json({ success: true, data: { department_id: myDepartmentId, invoices, fines }, error: null }, 200);
    }

    if (action === 'morosos') {
      // Scope: admin or general board => all towers. Tower board member => own tower only.
      const scope = uid ? await boardScopeForUser(req, client, db, uid) : { kind: 'NONE' as const, tower_id: null };
      const allTowers = isAdmin || scope.kind === 'GENERAL';
      const towerId = !allTowers && scope.kind === 'TOWER' ? scope.tower_id : (body.tower_id as string | undefined) || null;
      if (!isAdmin && scope.kind === 'NONE') return forbidden('No tienes permisos para consultar morosos');
      const data = await listMorosos(db, towerId);
      return json({ success: true, data, error: null }, 200);
    }

    return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
  } catch (error) {
    console.error('Error in billing-maintenance:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

async function loadConfig(db: { from(t: string): any }): Promise<Record<string, unknown>> {
  try {
    const { data } = await db.from('condo_settings').select('config_json').eq('module_key', 'billing_maintenance').single();
    const cfg = data?.config_json && typeof data.config_json === 'object' ? data.config_json as Record<string, unknown> : {};
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function generateInvoicesForCycle(
  db: { from(t: string): any },
  periodId: string,
  cfg: Record<string, unknown>,
  defaultAmountOverride?: number
): Promise<number> {
  const { data: depts } = await db.from('departments').select('id');
  const deptIds = (depts || []).map((d: { id: string }) => d.id);
  if (!deptIds.length) return 0;

  const { data: existingInvoices } = await db.from('invoices').select('department_id').eq('cycle_id', periodId);
  const done = new Set((existingInvoices || []).map((i: { department_id: string }) => i.department_id));

  const defaultAmount = defaultAmountOverride ?? (Number(cfg.default_fee) || 0);
  const { data: fees } = await db.from('department_fees').select('department_id, amount, is_exempt').in('department_id', deptIds);
  const feeMap = new Map((fees || []).map((f: Record<string, unknown>) => [f.department_id, f]));

  const { data: cycle } = await db.from('billing_cycles').select('due_date').eq('id', periodId).single();
  const dueDate = (cycle as { due_date?: string } | null)?.due_date || new Date().toISOString().slice(0, 10);

  const rows: Array<Record<string, unknown>> = [];
  for (const deptId of deptIds) {
    if (done.has(deptId)) continue;
    const fee = feeMap.get(deptId) as Record<string, unknown> | undefined;
    if (fee && fee.is_exempt) continue;
    rows.push({
      cycle_id: periodId,
      department_id: deptId,
      amount: fee ? Number(fee.amount) : defaultAmount,
      paid_amount: 0,
      status: 'PENDIENTE',
      due_date: dueDate
    });
  }
  if (rows.length) {
    await db.from('invoices').insert(rows);
  }
  return rows.length;
}

async function resolveInvoiceForDepartment(db: { from(t: string): any }, departmentId: string, periodId?: string): Promise<string | null> {
  let q = db.from('invoices').select('id').eq('department_id', departmentId).order('created_at', { ascending: false });
  if (periodId) q = q.eq('cycle_id', periodId);
  const { data } = await q.limit(1).maybeSingle();
  return data?.id || null;
}

async function listPeriodsWithStats(db: { from(t: string): any }): Promise<Array<Record<string, unknown>>> {
  const { data: cycles } = await db.from('billing_cycles').select('*').order('created_at', { ascending: false });
  const list = (cycles || []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const ids = list.map(c => c.id as string);
  const { data: invs } = await db.from('invoices').select('cycle_id, status, amount, paid_amount').in('cycle_id', ids);
  const byCycle = new Map<string, Array<Record<string, unknown>>>();
  for (const i of (invs || []) as Array<Record<string, unknown>>) {
    const arr = byCycle.get(i.cycle_id as string) || [];
    arr.push(i);
    byCycle.set(i.cycle_id as string, arr);
  }
  const today = new Date().toISOString().slice(0, 10);
  return list.map(c => {
    const rows = byCycle.get(c.id as string) || [];
    const total = rows.length;
    const collected = rows.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    const paidCount = rows.filter(r => r.status === 'PAGADA').length;
    const pending = total - paidCount;
    const morosos = rows.filter(r => String(c.due_date) < today && (r.status === 'PENDIENTE' || r.status === 'PARCIAL')).length;
    return { ...c, stats: { total_invoices: total, paid_invoices: paidCount, pending_invoices: pending, collected, morosos } };
  });
}

async function listInvoices(db: { from(t: string): any }, body: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  let q = db.from('invoices').select('*');
  if (body.period_id) q = q.eq('cycle_id', body.period_id);
  if (body.department_id) q = q.eq('department_id', body.department_id);
  if (body.status) q = q.eq('status', body.status);
  const { data: invoices } = await q.order('created_at', { ascending: false }).limit(400);
  const list = (invoices || []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

const deptIds = [...new Set(list.map(i => i.department_id as string))];
  const cycleIds = [...new Set(list.map(i => i.cycle_id as string))];

  // Load the full department/tower catalogs instead of using .in() with large
  // id lists (which can silently return empty for hundreds of ids).
  const { data: allDepts } = await db.from('departments').select('id, department_number, tower_id').limit(1000);
  const deptMap = new Map((allDepts || []).map((d: { id: string; department_number: string; tower_id: string }) => [d.id, d]));
  const towerIds = [...new Set((allDepts || []).map((d: { tower_id: string }) => d.tower_id))];
  const { data: allTowers } = await db.from('towers').select('id, name, code').limit(200);
  const towerMap = new Map((allTowers || []).map((t: { id: string; name: string; code: string }) => [t.id, t]));

  const { data: cycles } = await db.from('billing_cycles').select('id, cycle_key, label, start_date, end_date, due_date').in('id', cycleIds);
  const cycleMap = new Map((cycles || []).map((c: Record<string, unknown>) => [c.id, c]));
  const { data: fines } = await db.from('billing_fines').select('invoice_id, amount, status, source, concept').in('invoice_id', list.map(i => i.id as string));
  const finesByInvoice = new Map<string, Array<Record<string, unknown>>>();
  for (const f of (fines || []) as Array<Record<string, unknown>>) {
    const arr = finesByInvoice.get(f.invoice_id as string) || [];
    arr.push(f);
    finesByInvoice.set(f.invoice_id as string, arr);
  }

  // Resolve the department's primary resident to expose the titular directly
  const { data: residents } = deptIds.length
    ? await db.from('residents').select('department_id, full_name, is_primary_contact').in('department_id', deptIds)
    : { data: [] } as { data: Array<{ department_id: string; full_name: string; is_primary_contact: boolean }> };
  const titularMap = new Map<string, string>();
  for (const r of (residents || [])) {
    const current = titularMap.get(r.department_id);
    if (!current || r.is_primary_contact) titularMap.set(r.department_id, r.full_name);
  }

  return list.map(i => {
    const dept = i.department_id ? deptMap.get(i.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    const fineRows = finesByInvoice.get(i.id as string) || [];
    const fineTotal = fineRows.filter(f => f.status !== 'ANULADA').reduce((s, f) => s + Number(f.amount), 0);
    const departmentNumber = dept?.department_number || '';
    const towerCode = tower?.code || '';
    return {
      ...i,
      department_number: departmentNumber,
      tower_code: towerCode,
      edificio: towerCode,
      departamento: departmentNumber.replace(/\D/g, ''),
      titular: i.department_id ? (titularMap.get(i.department_id as string) || '') : '',
      departments: dept ? { department_number: departmentNumber, towers: tower ? { name: tower.name, code: tower.code } : null } : null,
      cycles: cycleMap.get(i.cycle_id as string) || null,
fine_total: fineTotal,
      total: Number(i.amount) + fineTotal,
      fines: fineRows
    };
  });
}

async function boardScopeForUser(
  req: Request,
  client: ReturnType<typeof createAdminClient>,
  db: { from(t: string): any },
  userId: string
): Promise<{ kind: 'GENERAL' | 'TOWER' | 'NONE'; tower_id: string | null }> {
  // A user's board scope is derived from their resident record (member of a tower board)
  const { data: resident } = await db.from('residents').select('id, department_id').eq('user_id', userId).limit(1).maybeSingle();
  if (!resident?.id) return { kind: 'NONE', tower_id: null };

  const { data: towerMember } = await db.from('tower_board_members').select('id, board_id').eq('resident_id', resident.id).limit(1).maybeSingle();
  if (!towerMember?.id) return { kind: 'NONE', tower_id: null };

  // General board membership: elected from a tower board member
  const { data: generalMember } = await db.from('general_board_members').select('id').eq('board_member_id', towerMember.id).limit(1).maybeSingle();
  if (generalMember?.id) return { kind: 'GENERAL', tower_id: null };

  const { data: towerBoard } = await db.from('tower_boards').select('tower_id').eq('id', towerMember.board_id).single();
  if (towerBoard?.tower_id) return { kind: 'TOWER', tower_id: towerBoard.tower_id };
  return { kind: 'NONE', tower_id: null };
}

async function listMorosos(db: { from(t: string): any }, towerId?: string | null): Promise<Record<string, unknown>> {
  const { data: depts } = await db.from('departments').select('id, department_number, tower_id');
  const deptRows = (depts || []) as Array<{ id: string; department_number: string; tower_id: string }>;
  const filtered = towerId ? deptRows.filter(d => d.tower_id === towerId) : deptRows;
  if (filtered.length === 0) return { towers: [], departments: [], total_pending: 0, total_departments_morosos: 0 };

  const deptIds = filtered.map(d => d.id);
  const { data: invoices } = await db.from('invoices')
    .select('id, department_id, cycle_id, amount, paid_amount, status, due_date')
    .in('department_id', deptIds)
    .in('status', ['PENDIENTE', 'PARCIAL']);
  const invRows = (invoices || []) as Array<Record<string, unknown>>;

  const { data: fines } = await db.from('billing_fines')
    .select('id, department_id, invoice_id, amount, status')
    .in('department_id', deptIds)
    .eq('status', 'PENDIENTE');
  const fineRows = (fines || []) as Array<Record<string, unknown>>;

  const invoiceIds = [...new Set(invRows.map(i => i.cycle_id as string))];
  const { data: cycles } = await db.from('billing_cycles').select('id, label, end_date').in('id', invoiceIds);
  const cycleMap = new Map((cycles || []).map((c: Record<string, unknown>) => [c.id, c]));

  const towerIds = [...new Set(filtered.map(d => d.tower_id))];
  const { data: towers } = await db.from('towers').select('id, name, code').in('id', towerIds);
  const towerMap = new Map((towers || []).map((t: { id: string; name: string; code: string }) => [t.id, t]));

  const today = new Date().toISOString().slice(0, 10);
  const rows = filtered.map(d => {
    const deptInvoices = invRows.filter(i => i.department_id === d.id);
    const deptFines = fineRows.filter(f => f.department_id === d.id);
    const pendingAmount = deptInvoices.reduce((s, i) => s + Math.max(0, Number(i.amount) - Number(i.paid_amount)), 0)
      + deptFines.reduce((s, f) => s + Number(f.amount), 0);
    const pendingCount = deptInvoices.length + deptFines.length;
    // Moroso si tiene alguna cuota vencida (due_date < hoy) sin pagar
    const overdue = deptInvoices.some(i => String(i.due_date || '') < today);
    const overdueAmount = deptInvoices
      .filter(i => String(i.due_date || '') < today)
      .reduce((s, i) => s + Math.max(0, Number(i.amount) - Number(i.paid_amount)), 0)
      + deptFines.reduce((s, f) => s + Number(f.amount), 0);
    const tower = towerMap.get(d.tower_id) || null;
    return {
      department_id: d.id,
      department_number: d.department_number,
      tower_id: d.tower_id,
      tower: tower ? { id: tower.id, name: tower.name, code: tower.code } : null,
      pending_count: pendingCount,
      pending_amount: pendingAmount,
      overdue: overdue,
      overdue_amount: overdueAmount,
      invoices: deptInvoices.map(i => ({
        id: i.id,
        amount: Number(i.amount),
        paid_amount: Number(i.paid_amount),
        remaining: Number(i.amount) - Number(i.paid_amount),
        due_date: i.due_date,
        cycles: i.cycle_id ? cycleMap.get(i.cycle_id as string) || null : null
      })),
      fines: deptFines.map(f => ({
        id: f.id,
        amount: Number(f.amount),
        concept: f.concept
      }))
    };
  }).filter(r => r.pending_count > 0);

  const morosos = rows.filter(r => r.overdue || Number(r.overdue_amount) > 0);
  const towerSummary = towerIds.map(id => {
    const t = towerMap.get(id);
    const depts = rows.filter(r => r.tower_id === id);
    const pending = depts.reduce((s, r) => s + Number(r.pending_amount), 0);
    const morososCount = depts.filter(r => r.overdue).length;
    return { tower_id: id, name: t?.name || '', code: t?.code || '', pending_amount: pending, departments_morosos: morososCount };
  });

  return {
    towers: towerSummary,
    departments: rows,
    total_pending: rows.reduce((s, r) => s + Number(r.pending_amount), 0),
    total_departments_morosos: morosos.length
  };
}

async function listFines(db: { from(t: string): any }, body: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  let q = db.from('billing_fines').select('*');
  if (body.department_id) q = q.eq('department_id', body.department_id);
  const { data: fines } = await q.order('created_at', { ascending: false }).limit(300);
  const list = (fines || []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const deptIds = [...new Set(list.map(f => f.department_id as string))];
  const { data: depts } = await db.from('departments').select('id, department_number, tower_id').in('id', deptIds);
  const deptMap = new Map((depts || []).map((d: { id: string; department_number: string; tower_id: string }) => [d.id, d]));
  const towerIds = [...new Set((depts || []).map((d: { tower_id: string }) => d.tower_id))];
  const { data: towers } = towerIds.length ? await db.from('towers').select('id, name, code').in('id', towerIds) : { data: [] } as { data: Array<{ id: string; name: string; code: string }> };
  const towerMap = new Map((towers || []).map(t => [t.id, t]));
  return list.map(f => {
    const dept = f.department_id ? deptMap.get(f.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    return {
      ...f,
      departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : null } : null
    };
  });
}

async function listPayments(db: { from(t: string): any }, departmentId?: string): Promise<Array<Record<string, unknown>>> {
  let q = db.from('billing_payments').select('*');
  if (departmentId) q = q.eq('department_id', departmentId);
  const { data: payments } = await q.order('payment_date', { ascending: false }).limit(300);
  const list = (payments || []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const deptIds = [...new Set(list.map(p => p.department_id as string))];
  const invoiceIds = [...new Set(list.map(p => p.invoice_id as string))];
  const { data: depts } = await db.from('departments').select('id, department_number, tower_id').in('id', deptIds);
  const deptMap = new Map((depts || []).map((d: { id: string; department_number: string; tower_id: string }) => [d.id, d]));
  const towerIds = [...new Set((depts || []).map((d: { tower_id: string }) => d.tower_id))];
  const { data: towers } = towerIds.length ? await db.from('towers').select('id, name, code').in('id', towerIds) : { data: [] } as { data: Array<{ id: string; name: string; code: string }> };
  const towerMap = new Map((towers || []).map(t => [t.id, t]));
  const { data: invoices } = await db.from('invoices').select('id, cycle_id, amount, status, due_date').in('id', invoiceIds);
  const invoiceMap = new Map((invoices || []).map((i: Record<string, unknown>) => [i.id, i]));

  return list.map(p => {
    const dept = p.department_id ? deptMap.get(p.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    const invoice = p.invoice_id ? invoiceMap.get(p.invoice_id as string) : undefined;
    return {
      ...p,
      departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : null } : null,
      invoices: invoice || null
    };
  });
}

async function syncCartFines(db: { from(t: string): any }): Promise<number> {
  // Pull cart loans with a penalty that has not been linked to billing yet
  const { data: loans } = await db.from('cart_loans')
    .select('id, department_id, cart_id, checkout_time, penalty_amount, penalty_status')
    .gt('penalty_amount', 0)
    .neq('penalty_status', 'NINGUNA');
  let created = 0;
  for (const loan of (loans || []) as Array<Record<string, unknown>>) {
    const linked = await db.from('billing_fines').select('id').eq('cart_loan_id', loan.id).maybeSingle();
    if (linked?.id) continue;
    const amount = Number(loan.penalty_amount) || 0;
    if (amount <= 0) continue;
    // Attach to the department's open invoice for the same period if possible
    const invoiceId = await resolveInvoiceForDepartment(db, String(loan.department_id));
    const penaltyStatus = String(loan.penalty_status || '');
    const { error } = await db.from('billing_fines').insert([{
      invoice_id: invoiceId,
      department_id: loan.department_id,
      source: 'CART_LOAN',
      cart_loan_id: loan.id,
      concept: penaltyStatus === 'COBRADA'
        ? 'Multa por demora de carrito'
        : 'Multa pendiente por demora de carrito',
      amount,
      status: penaltyStatus === 'COBRADA' ? 'PAGADA' : 'PENDIENTE'
    }]);
    if (!error) created++;
  }
  return created;
}

async function departmentOfUser(
  req: Request,
  client: ReturnType<typeof createAdminClient>,
  db: { from(t: string): any },
  userId: string
): Promise<string | null> {
  const { data: byUser } = await db.from('residents').select('department_id').eq('user_id', userId).limit(1).maybeSingle();
  if (byUser?.department_id) return String(byUser.department_id);
  let email = '';
  let documentNumber: string | null = null;
  try {
    const { data: ug } = await client.database.from('users_global').select('email, document_number').eq('id', userId).single();
    email = String((ug as { email?: string } | null)?.email || '').toLowerCase();
    documentNumber = (ug as { document_number?: string | null } | null)?.document_number || null;
  } catch {}
  if (email) {
    const { data: byEmail } = await db.from('residents').select('department_id').eq('email', email).limit(1).maybeSingle();
    if (byEmail?.department_id) return String(byEmail.department_id);
  }
  if (documentNumber) {
    const { data: byDoc } = await db.from('residents').select('department_id').eq('document_number', documentNumber).limit(1).maybeSingle();
    if (byDoc?.department_id) return String(byDoc.department_id);
  }
  return null;
}

async function isModuleEnabled(db: { from(t: string): any }, key: string): Promise<boolean> {
  try {
    const { data } = await db.from('condo_settings').select('is_enabled').eq('module_key', key).single();
    return Boolean(data && (data as { is_enabled: boolean }).is_enabled);
  } catch {
    return false;
  }
}

async function isAdminForSchema(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const uid = data?.user?.id;
    if (!uid) return false;
    const { data: ug } = await client.database.from('users_global').select('is_superadmin').eq('id', uid).single();
    if (ug && (ug as { is_superadmin: boolean }).is_superadmin) return true;
    const { data: t } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
    const tenantId = t?.id;
    if (!tenantId) return false;
    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SUPER_ADMIN', 'ADMIN']).single();
    return Boolean(tu);
  } catch { return false; }
}

async function currentUserId(req: Request, client: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return null;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    return data?.user?.id || null;
  } catch { return null; }
}

function forbidden(message: string): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}