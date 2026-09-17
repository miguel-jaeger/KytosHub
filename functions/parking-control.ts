import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const SPOT_TYPES = ['PROPIO', 'VISITA', 'DISCAPACITADOS'];
const LOAN_STATUSES = ['PENDIENTE', 'ACTIVO', 'FINALIZADO', 'CANCELADO'];

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const client = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      apiKey: Deno.env.get('INSFORGE_API_KEY')
    });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = (body.action as string) || 'list-spots';
    const schemaName = body.schema_name as string;

    if (!schemaName) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'schema_name es requerido' } }, 400);
    }

    const enabled = await isModuleEnabled(client, schemaName);
    if (!enabled) {
      return json({ success: false, data: null, error: { code: 'MODULE_DISABLED', message: 'Módulo inactivo para este condominio' } }, 403);
    }

    const db = client.database.schema(schemaName);
    const isAdmin = await isAdminForSchema(req, client, schemaName);
    const isOperator = isAdmin || await isSecurityForSchema(req, client, schemaName);
    const uid = await currentUserId(req, client);
    const myDepartmentId = uid ? await departmentOfUser(db, uid) : null;

    switch (action) {
      // ---------- SPOTS ----------
      case 'list-spots': {
        let q = db.from('parking_spots').select('*');
        if (body.department_id) q = q.eq('department_id', body.department_id);
        if (body.type) q = q.eq('type', body.type);
        if (!isOperator) {
          if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
          q = q.eq('department_id', myDepartmentId);
        }
        const { data, error } = await q.order('spot_row', { ascending: true }).order('spot_index', { ascending: true }).order('spot_number');
        if (error) throw error;
        const spots = await enrichSpots(db, data || []);
        return json({ success: true, data: spots, error: null }, 200);
      }

      case 'get-layout': {
        const layout = await getLayoutConfig(db);
        const { count } = await db.from('parking_spots').select('*', { count: 'exact', head: true });
        return json({ success: true, data: { ...(layout || {}), total_spots: (count || 0) }, error: null }, 200);
      }

      case 'provision-layout': {
        if (!isAdmin) return forbidden();
        const rows = Number(body.rows);
        const spotsPerRow = Number(body.spots_per_row);
        if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(spotsPerRow) || spotsPerRow < 1) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'rows y spots_per_row deben ser enteros mayores a 0' } }, 400);
        }

        const { data: tenantRow } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
        if (!tenantRow) {
          return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Condominio no encontrado' } }, 404);
        }
        const { data: rpcResult, error: rpcError } = await client.database.rpc('provision_parking_layout', {
          p_tenant_id: tenantRow.id,
          p_rows: rows,
          p_spots_per_row: spotsPerRow
        });
        if (rpcError) {
          console.error('provision_parking_layout error:', rpcError);
          return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'No se pudo generar el layout' } }, 500);
        }

        const layout = await getLayoutConfig(db);
        const spots = await (async () => {
          const { data } = await db.from('parking_spots').select('*').order('spot_row', { ascending: true }).order('spot_index', { ascending: true });
          return data || [];
        })();
        const enriched = await enrichSpots(db, spots);

        return json({
          success: true,
          data: { layout: layout || { rows, spots_per_row: spotsPerRow }, result: rpcResult, spots: enriched },
          error: null
        }, 201);
      }

      case 'create-spot': {
        if (!isAdmin) return forbidden();
        const spotNumber = String(body.spot_number || '').trim();
        const type = normalizeSpotType(body.type);
        if (!spotNumber) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'spot_number es requerido' } }, 400);
        }
        const { data: existing } = await db.from('parking_spots').select('id').eq('spot_number', spotNumber).single();
        if (existing) {
          return json({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe una bahía con ese número' } }, 409);
        }
        if (type === 'PROPIO' && !body.department_id) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Las bahías propias deben tener un departamento asignado' } }, 400);
        }
        const { data, error } = await db.from('parking_spots').insert([{
          spot_number: spotNumber,
          type,
          department_id: body.department_id || null,
          status: body.status === 'OCUPADO' ? 'OCUPADO' : 'DISPONIBLE'
        }]).select().single();
        if (error) throw error;
        const enriched = (await enrichSpots(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 201);
      }

      case 'update-spot': {
        if (!isAdmin) return forbidden();
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const updates: Record<string, unknown> = {};
        if (body.spot_number !== undefined) {
          const spotNumber = String(body.spot_number).trim();
          if (!spotNumber) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'spot_number es requerido' } }, 400);
          updates.spot_number = spotNumber;
        }
        if (body.type !== undefined) updates.type = normalizeSpotType(body.type);
        if (body.department_id !== undefined) updates.department_id = body.department_id || null;
        if (body.status !== undefined) updates.status = body.status === 'OCUPADO' ? 'OCUPADO' : 'DISPONIBLE';
        const { data, error } = await db.from('parking_spots').update(updates).eq('id', id).select().single();
        if (error) throw error;
        const enriched = (await enrichSpots(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'delete-spot': {
        if (!isAdmin) return forbidden();
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { error } = await db.from('parking_spots').delete().eq('id', id);
        if (error) throw error;
        return json({ success: true, data: null, error: null }, 200);
      }

      // ---------- VEHICLES ----------
      case 'list-vehicles': {
        let q = db.from('vehicles').select('*');
        if (isOperator) {
          if (body.department_id) q = q.eq('department_id', body.department_id);
        } else {
          if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
          q = q.eq('department_id', myDepartmentId);
        }
        const { data, error } = await q.order('license_plate');
        if (error) throw error;
        const enriched = await enrichVehicles(db, data || []);
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'create-vehicle': {
        const licensePlate = String(body.license_plate || '').trim().toUpperCase();
        if (!licensePlate) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);
        }
        let departmentId = body.department_id as string;
        if (!isOperator) {
          if (!myDepartmentId) return forbidden();
          departmentId = myDepartmentId;
        }
        if (!departmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'department_id es requerido' } }, 400);
        }
        const { data: existing } = await db.from('vehicles').select('id').eq('department_id', departmentId).eq('license_plate', licensePlate).single();
        if (existing) {
          return json({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ese vehículo ya está registrado para el departamento' } }, 409);
        }
        const { data, error } = await db.from('vehicles').insert([{
          department_id: departmentId,
          license_plate: licensePlate,
          brand: body.brand ? String(body.brand) : null,
          model: body.model ? String(body.model) : null,
          color: body.color ? String(body.color) : null,
          is_active: body.is_active !== false
        }]).select().single();
        if (error) throw error;
        const enriched = (await enrichVehicles(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 201);
      }

      case 'update-vehicle': {
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { data: current } = await db.from('vehicles').select('department_id').eq('id', id).single();
        if (!current) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Vehículo no encontrado' } }, 404);
        if (!isOperator && current.department_id !== myDepartmentId) return forbidden();

        const updates: Record<string, unknown> = {};
        if (body.license_plate !== undefined) updates.license_plate = String(body.license_plate).trim().toUpperCase();
        if (body.brand !== undefined) updates.brand = body.brand ? String(body.brand) : null;
        if (body.model !== undefined) updates.model = body.model ? String(body.model) : null;
        if (body.color !== undefined) updates.color = body.color ? String(body.color) : null;
        if (body.is_active !== undefined) updates.is_active = body.is_active === true;
        const { data, error } = await db.from('vehicles').update(updates).eq('id', id).select().single();
        if (error) throw error;
        const enriched = (await enrichVehicles(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'delete-vehicle': {
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { data: current } = await db.from('vehicles').select('department_id').eq('id', id).single();
        if (!current) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Vehículo no encontrado' } }, 404);
        if (!isOperator && current.department_id !== myDepartmentId) return forbidden();
        const { error } = await db.from('vehicles').delete().eq('id', id);
        if (error) throw error;
        return json({ success: true, data: null, error: null }, 200);
      }

      // ---------- LOANS (owner lends parking spot) ----------
      case 'list-loans': {
        let q = db.from('parking_loans').select('*');
        if (isOperator) {
          if (body.spot_id) q = q.eq('spot_id', body.spot_id);
          if (body.lender_department_id) q = q.eq('lender_department_id', body.lender_department_id);
        } else {
          if (!myDepartmentId) return json({ success: true, data: [], error: null }, 200);
          q = q.or(`lender_department_id.eq.${myDepartmentId},borrower_department_id.eq.${myDepartmentId}`);
        }
        const { data, error } = await q.order('created_at', { ascending: false });
        if (error) throw error;
        const enriched = await enrichLoans(db, data || []);
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'create-loan': {
        const spotId = body.spot_id as string;
        const startTime = body.start_time as string;
        const endTime = body.end_time as string;
        if (!spotId) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'spot_id es requerido' } }, 400);
        if (!startTime || !endTime) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'start_time y end_time son requeridos' } }, 400);
        }
        if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'end_time debe ser posterior a start_time' } }, 400);
        }

        const { data: spot } = await db.from('parking_spots').select('id, department_id, type, status').eq('id', spotId).single();
        if (!spot) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Bahía no encontrada' } }, 404);
        if (spot.type === 'VISITA' || spot.type === 'DISCAPACITADOS') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'Las bahías de visita o discapacitados no se prestan entre propietarios' } }, 409);
        }
        if (spot.status === 'OCUPADO') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'La bahía está ocupada y no puede prestarse ahora' } }, 409);
        }

        const lenderDepartmentId = (body.lender_department_id as string) || (myDepartmentId as string) || null;
        if (!lenderDepartmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere un departamento que presta la bahía' } }, 400);
        }
        if (!isAdmin && lenderDepartmentId !== myDepartmentId) return forbidden();
        if (spot.department_id !== lenderDepartmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'La bahía no pertenece al departamento que la presta' } }, 400);
        }

        const borrowerDepartmentId = (body.borrower_department_id as string) || null;
        const borrowerVehiclePlate = body.borrower_vehicle_plate ? String(body.borrower_vehicle_plate).trim().toUpperCase() : (body.borrower_vehicle_plate as string) || null;
        if (!borrowerDepartmentId && !borrowerVehiclePlate) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Indica el departamento o la placa del vehículo que usará la bahía' } }, 400);
        }

        const { data, error } = await db.from('parking_loans').insert([{
          spot_id: spotId,
          lender_department_id: lenderDepartmentId,
          borrower_department_id: borrowerDepartmentId,
          borrower_vehicle_plate: borrowerVehiclePlate,
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
          status: body.status === 'ACTIVO' ? 'ACTIVO' : 'PENDIENTE'
        }]).select().single();
        if (error) throw error;
        const enriched = (await enrichLoans(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 201);
      }

      case 'update-loan-status': {
        const id = body.id as string;
        const status = String(body.status || '').trim().toUpperCase();
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        if (!LOAN_STATUSES.includes(status)) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Estado no válido' } }, 400);
        }
        const { data: loan } = await db.from('parking_loans').select('id, lender_department_id, status').eq('id', id).single();
        if (!loan) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Préstamo no encontrado' } }, 404);
        if (loan.status === 'FINALIZADO' || loan.status === 'CANCELADO') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'El préstamo ya fue cerrado' } }, 409);
        }
        if (!isAdmin && loan.lender_department_id !== myDepartmentId) return forbidden();
        const { data, error } = await db.from('parking_loans').update({ status }).eq('id', id).select().single();
        if (error) throw error;
        const enriched = (await enrichLoans(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      // ---------- GARITA: ENTRY / EXIT ----------
      case 'plate-status': {
        if (!isOperator) return forbidden();
        const plate = String(body.license_plate || '').trim().toUpperCase();
        if (!plate) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);
        const result = await resolvePlateStatus(db, plate);
        return json({ success: true, data: result, error: null }, 200);
      }

      case 'register-entry': {
        if (!isOperator) return forbidden();
        const plate = String(body.license_plate || '').trim().toUpperCase();
        if (!plate) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);

        // State machine: if the vehicle is already inside it can only exit.
        const { data: openLog } = await db.from('parking_access_logs')
          .select('id, spot_id, entry_time')
          .eq('license_plate', plate)
          .is('exit_time', null)
          .order('entry_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (openLog) {
          return json({ success: false, data: null, error: { code: 'ALREADY_INSIDE', message: 'El vehículo ya se encuentra dentro del estacionamiento. Solo se puede registrar su salida.' } }, 409);
        }

        const resolution = await resolvePlateEntry(db, plate, body.spot_id as string | null);
        if (!resolution.spot) {
          return json({ success: false, data: null, error: { code: 'NO_AUTHORIZED_SPOT', message: resolution.message } }, 409);
        }

        const gate = await resolveGateForOperator(req, client, db, body.gate_id);
        const now = new Date().toISOString();
        const { data: log, error } = await db.from('parking_access_logs').insert([{
          spot_id: resolution.spot.id,
          license_plate: plate,
          driver_name: body.driver_name ? String(body.driver_name) : null,
          entry_time: now,
          entry_gate_id: gate?.id || null,
          authorized_by_user_id: body.authorized_by_user_id ? String(body.authorized_by_user_id) : null,
          guard_user_id: uid || null
        }]).select().single();
        if (error) throw error;

        await db.from('parking_spots').update({ status: 'OCUPADO' }).eq('id', resolution.spot.id);

        return json({
          success: true,
          data: {
            log,
            spot: { id: resolution.spot.id, spot_number: resolution.spot.spot_number, type: resolution.spot.type },
            authorization: resolution.reason,
            entry_gate: gate ? { id: gate.id, name: gate.name } : null
          },
          error: null
        }, 201);
      }

      case 'register-exit': {
        if (!isOperator) return forbidden();
        const plate = String(body.license_plate || '').trim().toUpperCase();
        if (!plate) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);

        // State machine: an open log means it is inside; otherwise it can only enter.
        const { data: log } = await db.from('parking_access_logs')
          .select('id, spot_id')
          .eq('license_plate', plate)
          .is('exit_time', null)
          .order('entry_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!log) {
          return json({ success: false, data: null, error: { code: 'NOT_INSIDE', message: 'El vehículo no está dentro del estacionamiento. Solo se puede registrar su ingreso.' } }, 409);
        }

        const gate = await resolveGateForOperator(req, client, db, body.gate_id);
        const { data: updated, error } = await db.from('parking_access_logs').update({
          exit_time: new Date().toISOString(),
          exit_gate_id: gate?.id || null
        }).eq('id', log.id).select().single();
        if (error) throw error;

        await db.from('parking_spots').update({ status: 'DISPONIBLE' }).eq('id', log.spot_id);

        return json({
          success: true,
          data: {
            log: updated,
            exit_gate: gate ? { id: gate.id, name: gate.name } : null
          },
          error: null
        }, 200);
      }

      case 'list-logs': {
        if (!isOperator) return forbidden();
        let q = db.from('parking_access_logs').select('*');
        if (body.inside_only === true) q = q.is('exit_time', null);
        const { data, error } = await q.order('entry_time', { ascending: false }).limit(Number(body.limit) || 100);
        if (error) throw error;
        const enriched = await enrichLogs(db, data || [], client, schemaName);
        return json({ success: true, data: enriched, error: null }, 200);
      }

      default:
        return json({ success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Acción desconocida' } }, 405);
    }
  } catch (error) {
    console.error('Error in parking-control:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

// ---------------------------------------------------------------------------
// Business resolution helpers
// ---------------------------------------------------------------------------

async function resolvePlateStatus(db: { from(t: string): any }, plate: string) {
  const vehicleRow = await db.from('vehicles').select('*').eq('license_plate', plate).eq('is_active', true).maybeSingle();
  const vehicle = vehicleRow.data || null;

  const open = await db.from('parking_access_logs')
    .select('id, spot_id, license_plate, driver_name, entry_time, entry_gate_id')
    .eq('license_plate', plate)
    .is('exit_time', null)
    .order('entry_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  let insideSpot: Record<string, unknown> | null = null;
  let entryGate: Record<string, unknown> | null = null;
  if (open.data?.spot_id) {
    const sp = await db.from('parking_spots').select('id, spot_number, type, department_id').eq('id', open.data.spot_id).single();
    insideSpot = sp.data || null;
  }
  if (open.data?.entry_gate_id) {
    const g = await db.from('condo_gates').select('id, name, code').eq('id', open.data.entry_gate_id).single();
    entryGate = g.data || null;
  }

  const availableVisitorSpots = await db.from('parking_spots').select('*').eq('type', 'VISITA').eq('status', 'DISPONIBLE');
  const availableDisabledSpots = await db.from('parking_spots').select('*').eq('type', 'DISCAPACITADOS').eq('status', 'DISPONIBLE');

  return {
    license_plate: plate,
    vehicle: vehicle,
    inside: Boolean(open.data),
    current_log: open.data || null,
    inside_spot: insideSpot,
    entry_gate: entryGate,
    visitor_spots: (availableVisitorSpots.data || []).map((s: Record<string, unknown>) => ({ id: s.id, spot_number: s.spot_number })),
    disabled_spots: (availableDisabledSpots.data || []).map((s: Record<string, unknown>) => ({ id: s.id, spot_number: s.spot_number }))
  };
}

interface EntryResolution {
  spot: { id: string; spot_number: string; type: string } | null;
  reason: string;
  message: string;
}

async function resolvePlateEntry(db: { from(t: string): any }, plate: string, overrideSpotId: string | null): Promise<EntryResolution> {
  const now = new Date().toISOString();

  // 1) Registered vehicle -> owner's PROPIO spot
  const { data: vehicle } = await db.from('vehicles').select('id, department_id').eq('license_plate', plate).eq('is_active', true).maybeSingle();
  if (vehicle) {
    const { data: ownSpot } = await db.from('parking_spots')
      .select('id, spot_number, type')
      .eq('department_id', vehicle.department_id)
      .eq('type', 'PROPIO')
      .eq('status', 'DISPONIBLE')
      .limit(1)
      .maybeSingle();
    if (ownSpot) {
      return { spot: { id: ownSpot.id, spot_number: ownSpot.spot_number, type: ownSpot.type }, reason: 'PROPIO', message: 'Bahía propia del vehículo' };
    }
  }

  // 2) Active loan within time window for the borrower plate or department
  const { data: loans } = await db.from('parking_loans')
    .select('*')
    .eq('status', 'ACTIVO')
    .lte('start_time', now)
    .gte('end_time', now);
  let loanSpotId: string | null = null;
  for (const loan of (loans || []) as Array<{ id: string; spot_id: string; borrower_vehicle_plate: string | null; borrower_department_id: string | null }>) {
    if (loan.borrower_vehicle_plate && loan.borrower_vehicle_plate.toUpperCase() === plate) { loanSpotId = loan.spot_id; break; }
    if (vehicle && loan.borrower_department_id && loan.borrower_department_id === vehicle.department_id) { loanSpotId = loan.spot_id; break; }
  }
  if (loanSpotId) {
    const { data: loanSpot } = await db.from('parking_spots')
      .select('id, spot_number, type')
      .eq('id', loanSpotId)
      .eq('status', 'DISPONIBLE')
      .maybeSingle();
    if (loanSpot) {
      return { spot: { id: loanSpot.id, spot_number: loanSpot.spot_number, type: loanSpot.type }, reason: 'PRESTAMO', message: 'Préstamo activo vigente' };
    }
  }

  // 3) Explicit spot chosen by the guard (e.g. DISC PACITADOS / VISITA assignment)
  if (overrideSpotId) {
    const { data: explicit } = await db.from('parking_spots')
      .select('id, spot_number, type')
      .eq('id', overrideSpotId)
      .eq('status', 'DISPONIBLE')
      .maybeSingle();
    if (explicit) {
      return { spot: { id: explicit.id, spot_number: explicit.spot_number, type: explicit.type }, reason: 'ASIGNADA', message: 'Bahía asignada por el guardia' };
    }
  }

  // 4) Visitor availability
  const { data: visitorSpot } = await db.from('parking_spots')
    .select('id, spot_number, type')
    .eq('type', 'VISITA')
    .eq('status', 'DISPONIBLE')
    .limit(1)
    .maybeSingle();
  if (visitorSpot) {
    return { spot: { id: visitorSpot.id, spot_number: visitorSpot.spot_number, type: visitorSpot.type }, reason: 'VISITA', message: 'Bahía de visita disponible' };
  }

  // 5) Disabled spots as last resort (plates without registered owner)
  const { data: disabledSpot } = await db.from('parking_spots')
    .select('id, spot_number, type')
    .eq('type', 'DISCAPACITADOS')
    .eq('status', 'DISPONIBLE')
    .limit(1)
    .maybeSingle();
  if (disabledSpot) {
    return { spot: { id: disabledSpot.id, spot_number: disabledSpot.spot_number, type: disabledSpot.type }, reason: 'DISCAPACITADOS', message: 'Bahía para discapacitados disponible' };
  }

  return {
    spot: null,
    reason: 'NINGUNO',
    message: 'No se encontró una bahía autorizada: el vehículo no tiene bahía propia, préstamo vigente ni hay bahías de visita libres.'
  };
}

// ---------------------------------------------------------------------------
// Gate resolution for the operator (uses the persisted guard gate session)
// ---------------------------------------------------------------------------

async function resolveGateForOperator(
  req: Request,
  client: ReturnType<typeof createAdminClient>,
  db: { from(t: string): any },
  explicitGateId: unknown
): Promise<{ id: string; name: string } | null> {
  // 1) Explicit gate wins (e.g. admin/override)
  if (explicitGateId) {
    const { data: g } = await db.from('condo_gates').select('id, name').eq('id', String(explicitGateId)).eq('is_active', true).maybeSingle();
    if (g) return { id: g.id, name: g.name };
  }

  // 2) Guard's active session gate (persisted when they authenticated/entered garita)
  const uid = await currentUserId(req, client);
  if (uid) {
    const { data: session } = await db.from('guard_gate_sessions')
      .select('gate_id')
      .eq('user_id', uid)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (session?.gate_id) {
      const { data: g } = await db.from('condo_gates').select('id, name').eq('id', session.gate_id).eq('is_active', true).maybeSingle();
      if (g) return { id: g.id, name: g.name };
    }
  }

  // 3) Fallback: single active gate in the condominium
  const { data: gates } = await db.from('condo_gates').select('id, name').eq('is_active', true).eq('is_entry_exit', true);
  if (gates?.length === 1) return { id: gates[0].id, name: gates[0].name };

  return null;
}

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

async function enrichSpots(db: { from(t: string): any }, spots: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(spots.map(s => s.department_id as string | null).filter(Boolean))];
  const deptRows = deptIds.length
    ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
    : [];
  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const towerRows = towerIds.length
    ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
    : [];
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));

  const spotIds = spots.map(s => s.id as string).filter(Boolean);
  const insideSpotIds = new Set<string>();
  if (spotIds.length) {
    const openLogs = await db.from('parking_access_logs').select('spot_id').is('exit_time', null).in('spot_id', spotIds);
    for (const l of (openLogs.data || []) as Array<{ spot_id: string }>) insideSpotIds.add(l.spot_id);
  }

  return spots.map(s => {
    const dept = s.department_id ? deptMap.get(s.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    return {
      ...s,
      departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined,
      inside: Boolean(s.id && insideSpotIds.has(s.id as string))
    };
  });
}

async function enrichVehicles(db: { from(t: string): any }, vehicles: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(vehicles.map(v => v.department_id as string).filter(Boolean))];
  const deptRows = deptIds.length
    ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
    : [];
  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const towerRows = towerIds.length
    ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
    : [];
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
  return vehicles.map(v => {
    const dept = deptMap.get(v.department_id as string);
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    return { ...v, departments: dept ? { department_number: dept.department_number, towers: tower ? { name: tower.name, code: tower.code } : undefined } : undefined };
  });
}

async function enrichLoans(db: { from(t: string): any }, loans: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const spotIds = [...new Set(loans.map(l => l.spot_id as string))];
  const deptIds = [...new Set((loans as Array<{ lender_department_id?: string; borrower_department_id?: string }>).flatMap(l => [l.lender_department_id, l.borrower_department_id]).filter(Boolean))];
  const spots = spotIds.length
    ? ((await db.from('parking_spots').select('id, spot_number, type').in('id', spotIds)).data || [])
    : [];
  const spotMap = new Map((spots as Array<{ id: string; spot_number: string; type: string }>).map(s => [s.id, s]));
  const deptRows = deptIds.length
    ? ((await db.from('departments').select('id, department_number, tower_id').in('id', deptIds)).data || [])
    : [];
  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const towerRows = towerIds.length
    ? ((await db.from('towers').select('id, name, code').in('id', towerIds)).data || [])
    : [];
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));

  const vehicles = await db.from('vehicles').select('license_plate, department_id');
  const vehicleMap = new Map((vehicles.data || []).map((v: { license_plate: string; department_id: string }) => [v.license_plate.toUpperCase(), v]));

  return loans.map(l => {
    const spot = spotMap.get(l.spot_id as string);
    const lender = l.lender_department_id ? deptMap.get(l.lender_department_id as string) : undefined;
    const lenderTower = lender ? towerMap.get(lender.tower_id) : undefined;
    const borrower = l.borrower_department_id ? deptMap.get(l.borrower_department_id as string) : undefined;
    const borrowerTower = borrower ? towerMap.get(borrower.tower_id) : undefined;
    const vehicle = l.borrower_vehicle_plate ? vehicleMap.get(String(l.borrower_vehicle_plate).toUpperCase()) : undefined;
    return {
      ...l,
      spot_number: spot?.spot_number || null,
      spot_type: spot?.type || null,
      lender_department: lender ? { department_number: lender.department_number, tower_code: lenderTower?.code || null } : null,
      borrower_department: borrower ? { department_number: borrower.department_number, tower_code: borrowerTower?.code || null } : null,
      borrower_vehicle_department_id: vehicle?.department_id || null
    };
  });
}

async function enrichLogs(
  db: { from(t: string): any },
  logs: Array<Record<string, unknown>>,
  client: ReturnType<typeof createAdminClient>,
  schemaName: string
): Promise<Array<Record<string, unknown>>> {
  const spotIds = [...new Set(logs.map(l => l.spot_id as string | null).filter(Boolean))];
  const gateIds = [...new Set((logs as Array<{ entry_gate_id?: string; exit_gate_id?: string }>).flatMap(l => [l.entry_gate_id, l.exit_gate_id]).filter(Boolean))];
  const spots = spotIds.length
    ? ((await db.from('parking_spots').select('id, spot_number, type').in('id', spotIds)).data || [])
    : [];
  const spotMap = new Map((spots as Array<{ id: string; spot_number: string; type: string }>).map(s => [s.id, s]));
  const gates = gateIds.length
    ? ((await db.from('condo_gates').select('id, name, code').in('id', gateIds)).data || [])
    : [];
  const gateMap = new Map((gates as Array<{ id: string; name: string; code: string }>).map(g => [g.id, g]));

  const guardIds = [...new Set(logs.map(l => l.guard_user_id as string | null).filter(Boolean))];
  const guardMap = new Map<string, string>();
  if (guardIds.length) {
    try {
      const { data: tuRows } = await client.database.from('tenant_users').select('user_id').in('user_id', guardIds).eq('status', 'ACTIVE');
      for (const tu of (tuRows || []) as Array<{ user_id: string }>) {
        if (guardMap.has(tu.user_id)) continue;
        const { data: ug } = await client.database.from('users_global').select('name, email').eq('id', tu.user_id).single();
        guardMap.set(tu.user_id, (ug as { name?: string; email?: string } | null)?.name || (ug as { email?: string } | null)?.email || 'Agente');
      }
    } catch {}
  }

  return logs.map(l => {
    const spot = l.spot_id ? spotMap.get(l.spot_id as string) : undefined;
    const entryGate = l.entry_gate_id ? gateMap.get(l.entry_gate_id as string) : undefined;
    const exitGate = l.exit_gate_id ? gateMap.get(l.exit_gate_id as string) : undefined;
    return {
      ...l,
      spot_number: spot?.spot_number || null,
      spot_type: spot?.type || null,
      entry_gate: entryGate ? { id: entryGate.id, name: entryGate.name } : null,
      exit_gate: exitGate ? { id: exitGate.id, name: exitGate.name } : null,
      guard_name: l.guard_user_id ? guardMap.get(l.guard_user_id as string) || null : null
    };
  });
}

// ---------------------------------------------------------------------------
// Support helpers
// ---------------------------------------------------------------------------

async function getLayoutConfig(db: { from(t: string): any }): Promise<{ rows: number; spots_per_row: number } | null> {
  try {
    const { data } = await db.from('condo_settings').select('config_json').eq('module_key', 'parking_control').single();
    const cfg = data?.config_json && typeof data.config_json === 'object' ? (data.config_json as Record<string, unknown>) : {};
    const layout = cfg.layout as Record<string, unknown> | undefined;
    if (layout && Number(layout.rows) > 0 && Number(layout.spots_per_row) > 0) {
      return { rows: Number(layout.rows), spots_per_row: Number(layout.spots_per_row) };
    }
    return null;
  } catch {
    return null;
  }
}

async function departmentOfUser(db: { from(t: string): any }, userId: string): Promise<string | null> {
  const { data } = await db.from('residents').select('department_id').eq('user_id', userId).limit(1).maybeSingle();
  return data?.department_id || null;
}

async function isModuleEnabled(client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
  try {
    const { data } = await client.database.schema(schemaName).from('condo_settings').select('is_enabled').eq('module_key', 'parking_control').single();
    if (!data) return false;
    return Boolean((data as { is_enabled: boolean }).is_enabled);
  } catch { return false; }
}

function normalizeSpotType(v: unknown): string {
  const t = String(v || 'PROPIO').trim().toUpperCase();
  return SPOT_TYPES.includes(t) ? t : 'PROPIO';
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

async function isSecurityForSchema(req: Request, client: ReturnType<typeof createAdminClient>, schemaName: string): Promise<boolean> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const uid = data?.user?.id;
    if (!uid) return false;

    const { data: t } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
    const tenantId = t?.id;
    if (!tenantId) return false;

    const { data: tu } = await client.database.from('tenant_users').select('id').eq('user_id', uid).eq('tenant_id', tenantId).eq('status', 'ACTIVE').in('role', ['SECURITY_AGENT']).single();
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

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}