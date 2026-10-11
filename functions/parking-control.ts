import { createAdminClient, createClient } from 'npm:@insforge/sdk';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const SPOT_TYPES = ['PROPIO', 'VISITA', 'ALQUILADO'];
const VEHICLE_TYPES = ['AUTO', 'MOTO'];
const LOAN_STATUSES = ['PENDIENTE', 'ACTIVO', 'FINALIZADO', 'CANCELADO'];
const DEFAULT_MULTIPLE_CAPACITY = { max_autos: 1, max_motos: 3 };

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
    const apiKey = Deno.env.get('INSFORGE_API_KEY');
    if (!baseUrl || !apiKey) throw new Error('InsForge admin credentials are not configured');
    const client = createAdminClient({
      baseUrl,
      apiKey
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

    // Resolve the caller once. Every permission helper used to run its own auth
    // round-trip plus profile/tenant lookups, so a single request paid the same
    // queries four times before doing any real work. Identity, roles and (only
    // when the action needs it) the caller's department are resolved once here.
    const identity = await authenticatedIdentity(req);
    const profile = identity ? await globalProfileForAuthUser(client, identity) : null;
    const roles = await resolveTenantRoles(client, schemaName, identity, profile);
    const isAdmin = roles.isAdmin;
    const isSecurity = roles.isSecurity;
    const isOperator = isAdmin || isSecurity;
    const uid = identity?.id || null;

    // Reading actions for residents/security need the caller's department; admin
    // actions never do, so we avoid the extra residents lookups for them.
    const DEPARTMENT_ACTIONS = new Set(['list-spots', 'list-vehicles', 'create-vehicle', 'update-vehicle', 'set-vehicle-active', 'delete-vehicle', 'list-loans', 'create-loan', 'update-loan-status']);
    const myDepartmentId = (!isAdmin && uid && DEPARTMENT_ACTIONS.has(action))
      ? await departmentOfUser(db, uid, identity, profile)
      : null;

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
        // Total reflect the configured layout (sum of spots per row), not the raw
        // parking_spots row count (which includes leftovers from older layouts).
        const spotsTotal = layout
          ? (Array.isArray(layout.spots_per_row)
              ? layout.spots_per_row.reduce((a, b) => a + b, 0)
              : layout.spots_per_row * layout.rows)
          : 0;
        return json({
          success: true,
          data: layout ? { ...layout, total_spots: spotsTotal } : null,
          error: null
        }, 200);
      }

      case 'get-multiple-capacity': {
        return json({ success: true, data: await getMultipleVehicleLimits(db), error: null }, 200);
      }

      case 'update-multiple-capacity': {
        if (!isAdmin) return forbidden();
        const maxAutos = Number(body.max_autos);
        const maxMotos = Number(body.max_motos);
        if (!Number.isInteger(maxAutos) || maxAutos < 0 || maxAutos > 20 || !Number.isInteger(maxMotos) || maxMotos < 0 || maxMotos > 20) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Los cupos deben ser enteros entre 0 y 20' } }, 400);
        }
        if (maxAutos > 0 && maxMotos < 1) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Una cochera múltiple con autos debe permitir al menos una moto' } }, 400);
        }
        const { data: settings, error: settingsError } = await db.from('condo_settings').select('config_json').eq('module_key', 'parking_control').single();
        if (settingsError) throw settingsError;
        const config = settings?.config_json && typeof settings.config_json === 'object'
          ? settings.config_json as Record<string, unknown>
          : {};
        const limits = { max_autos: maxAutos, max_motos: maxMotos };
        const { error } = await db.from('condo_settings').update({
          config_json: { ...config, multiple_vehicle_limits: limits },
          updated_at: new Date().toISOString()
        }).eq('module_key', 'parking_control');
        if (error) throw error;
        return json({ success: true, data: limits, error: null }, 200);
      }

      case 'reset-layout': {
        if (!isAdmin) return forbidden();
        // Deletes the persisted layout configuration (rows, spots per row, row
        // names, orientation) without touching the parking spots themselves.
        let nextConfig: Record<string, unknown> = {};
        try {
          const { data } = await db.from('condo_settings').select('config_json').eq('module_key', 'parking_control').single();
          const cfg = data?.config_json && typeof data.config_json === 'object' ? (data.config_json as Record<string, unknown>) : {};
          nextConfig = { ...cfg };
          delete nextConfig.layout;
        } catch { /* no prev config */ }
        const now = new Date().toISOString();
        const { error } = await db.from('condo_settings').update({ config_json: nextConfig, updated_at: now }).eq('module_key', 'parking_control');
        if (error) throw error;

        // Clear the positional hints so the map falls back until a layout is regenerated.
        try {
          await db.from('parking_spots').update({ spot_row: null, spot_index: null });
        } catch { /* best effort */ }

        return json({ success: true, data: { reset: true }, error: null }, 200);
      }

      case 'provision-layout': {
        if (!isAdmin) return forbidden();
        const rows = Number(body.rows);
        if (!Number.isInteger(rows) || rows < 1) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'rows debe ser un entero mayor o igual a 1' } }, 400);
        }

        // spots_per_row may be a single number (uniform) or an array (per row)
        let counts: number[] = [];
        if (Array.isArray(body.spots_per_row)) {
          counts = (body.spots_per_row as unknown[]).map(v => Math.max(1, Math.round(Number(v) || 1)));
          if (counts.length > rows) counts = counts.slice(0, rows);
          while (counts.length < rows) counts.push(counts[counts.length - 1] || 1);
        } else {
          const per = Math.max(1, Math.round(Number(body.spots_per_row) || 1));
          counts = Array.from({ length: rows }, () => per);
        }
        if (counts.reduce((total, count) => total + count, 0) > 999) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El layout no puede superar las 999 plazas (numeración de 001 a 999)' } }, 400);
        }

        // row_names: optional per-row editable labels (fallback to "Fila N" in the RPC)
        let rowNames: string[] | null = null;
        if (Array.isArray(body.row_names)) {
          rowNames = (body.row_names as unknown[]).map(v => String(v ?? '').trim().slice(0, 60));
          while (rowNames.length < rows) rowNames.push('');
          rowNames = rowNames.slice(0, rows);
        }

        const orientation = normalizeOrientation(body.orientation);

        const { data: tenantRow } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
        if (!tenantRow) {
          return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Condominio no encontrado' } }, 404);
        }
        const { data: rpcResult, error: rpcError } = await client.database.rpc('provision_parking_layout', {
          p_tenant_id: tenantRow.id,
          p_rows: rows,
          p_spots_per_row: counts,
          p_row_names: rowNames,
          p_orientation: orientation
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
          data: {
            layout: layout || {
              rows,
              spots_per_row: counts,
              row_names: rowNames || counts.map((_, i) => `Fila ${i + 1}`),
              orientation
            },
            result: rpcResult,
            spots: enriched
          },
          error: null
        }, 201);
      }

      case 'create-spot': {
        if (!isAdmin) return forbidden();
        const spotNumber = String(body.spot_number || '').trim();
        const type = normalizeSpotType(body.type);
        if (!/^(?!000)\d{3}$/.test(spotNumber)) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El número de cochera debe tener tres cifras, entre 001 y 999' } }, 400);
        }
        const { data: existing } = await db.from('parking_spots').select('id').eq('spot_number', spotNumber).single();
        if (existing) {
          return json({ success: false, data: null, error: { code: 'DUPLICATE', message: 'Ya existe un estacionamiento con ese número' } }, 409);
        }
        if (type === 'PROPIO' && !body.department_id) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Los estacionamientos propios deben tener un departamento asignado' } }, 400);
        }
        const { data, error } = await db.from('parking_spots').insert([{
          spot_number: spotNumber,
          type,
          department_id: body.department_id || null,
          status: body.status === 'OCUPADO' ? 'OCUPADO' : 'DISPONIBLE',
          spot_row: Number.isInteger(Number(body.spot_row)) ? Number(body.spot_row) : null,
          spot_index: Number.isInteger(Number(body.spot_index)) ? Number(body.spot_index) : null,
          cochera_type: normalizeCocheraType(body.cochera_type)
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
          if (!/^(?!000)\d{3}$/.test(spotNumber)) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El número de cochera debe tener tres cifras, entre 001 y 999' } }, 400);
          updates.spot_number = spotNumber;
        }
        if (body.type !== undefined) updates.type = normalizeSpotType(body.type);
        if (body.department_id !== undefined) updates.department_id = body.department_id || null;
        if (body.cochera_type !== undefined) updates.cochera_type = normalizeCocheraType(body.cochera_type);
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
        if (isAdmin) {
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
        const normalizedPlate = normalizeLicensePlate(licensePlate);
        if (!normalizedPlate) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);
        }
        let departmentId = body.department_id as string;
        const requestedSpotId = body.spot_id ? String(body.spot_id).trim() : null;
        if (!isAdmin) {
          if (!isSecurity && myDepartmentId) {
            // resident registers for their own department only
            departmentId = myDepartmentId;
          } else {
            return forbidden();
          }
        }
        // The cochera determines the department when it was supplied.
        if (requestedSpotId) {
          const { data: spotRow } = await db.from('parking_spots').select('id, department_id').eq('id', requestedSpotId).maybeSingle();
          if (!spotRow) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'La cochera seleccionada no existe' } }, 400);
          if (spotRow.department_id) departmentId = String(spotRow.department_id);
        }
        if (!departmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'department_id es requerido' } }, 400);
        }
        const { data: registeredVehicles, error: registeredVehiclesError } = await db.from('vehicles').select('id, license_plate').limit(10000);
        if (registeredVehiclesError) throw registeredVehiclesError;
        if ((registeredVehicles || []).some((vehicle: { license_plate?: string }) => normalizeLicensePlate(vehicle.license_plate) === normalizedPlate)) {
          return json({ success: false, data: null, error: { code: 'DUPLICATE', message: `La placa ${licensePlate} ya está registrada en otra cochera de este condominio` } }, 409);
        }
        const vehicleType = normalizeVehicleType(body.vehicle_type);
        // Only the cochera's available active slots start as active; extra
        // registered vehicles are stored inactive.
        let isActive = body.is_active !== false;
        if (isActive && requestedSpotId) {
          const conflict = await activeCapacityConflict(db, requestedSpotId, vehicleType);
          if (conflict) isActive = false;
        }
        const { data, error } = await db.from('vehicles').insert([{
          department_id: departmentId,
          spot_id: requestedSpotId,
          license_plate: licensePlate,
          vehicle_type: vehicleType,
          driver_name: body.driver_name ? String(body.driver_name).trim() : null,
          brand: body.brand ? String(body.brand) : null,
          model: body.model ? String(body.model) : null,
          color: body.color ? String(body.color) : null,
          is_active: isActive,
          created_by_user_id: uid
        }]).select().single();
        if (error) throw error;
        const enriched = (await enrichVehicles(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 201);
      }

      case 'import-vehicles': {
        if (!isAdmin) return forbidden();
        const items = (Array.isArray(body.items) ? body.items : []) as Array<Record<string, unknown>>;
        if (items.length === 0) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'No hay vehículos para importar' } }, 400);
        }

        const [vehicleResult, spotResult, towerResult, floorResult, departmentResult] = await Promise.all([
          db.from('vehicles').select('id, license_plate, department_id, spot_id').limit(10000),
          db.from('parking_spots').select('*').limit(10000),
          db.from('towers').select('id, code'),
          db.from('floors').select('id, tower_id, floor_number'),
          db.from('departments').select('id, tower_id, floor_id, department_number')
        ]);
        if (vehicleResult.error) throw vehicleResult.error;
        if (spotResult.error) throw spotResult.error;
        if (towerResult.error) throw towerResult.error;
        if (floorResult.error) throw floorResult.error;
        if (departmentResult.error) throw departmentResult.error;

        // Existing plates are matched so a re-import can refresh the vehicle in
        // place, but a plate already linked to a different cochera is rejected.
        const registeredByPlate = new Map<string, { id: string; department_id: string; spot_id: string }>();
        for (const vehicle of (vehicleResult.data || []) as Array<{ id: string; license_plate?: string; department_id?: string; spot_id?: string }>) {
          const key = normalizeLicensePlate(vehicle.license_plate);
          if (key) registeredByPlate.set(key, { id: String(vehicle.id), department_id: String(vehicle.department_id || ''), spot_id: String(vehicle.spot_id || '') });
        }
        const parkingSpots = await enrichSpots(db, (spotResult.data || []) as Array<Record<string, unknown>>);
        const spotNumberById = new Map<string, string>();
        for (const spot of parkingSpots) {
          if (spot.id) spotNumberById.set(String(spot.id), String(spot.spot_number || ''));
        }
        const spotsByNumber = new Map<string, Array<Record<string, unknown>>>();
        for (const spot of parkingSpots) {
          const number = normalizeParkingSpotNumber(spot.spot_number);
          if (!number) continue;
          const rows = spotsByNumber.get(number) || [];
          rows.push(spot);
          spotsByNumber.set(number, rows);
        }
        const towers = (towerResult.data || []) as Array<{ id: string; code: string }>;
        const floors = (floorResult.data || []) as Array<{ id: string; tower_id: string; floor_number: number }>;
        const departments = (departmentResult.data || []) as Array<{ id: string; tower_id: string; floor_id: string; department_number: string }>;

        const importedPlates = new Set<string>();
        const spotPlans = new Map<string, { spot: Record<string, unknown>; departmentId: string; spotType: string; cocheraType: string }>();
        const limits = await getMultipleVehicleLimits(db);
        const activeBySpot = await activeCountsBySpot(db);
        const validRows: Array<{ line: number; licensePlate: string; plateKey: string; driverName: string; spotId: string; departmentId: string; vehicleType: string; isActive: boolean }> = [];
        const updateRows: Array<{ vehicleId: string; line: number; licensePlate: string; driverName: string; spotId: string; departmentId: string; vehicleType: string }> = [];
        const errors: Array<{ line: number; license_plate: string; reason: string }> = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const line = Number(item.line) || i + 2;
          const licensePlate = String(item.license_plate || '').trim().toUpperCase();
          const driverName = String(item.driver_name || '').trim();
          const plateKey = normalizeLicensePlate(licensePlate);
          const spotNumber = normalizeParkingSpotNumber(item.spot_number);
          const towerCode = String(item.tower_code || '').trim();
          const departmentNumber = String(item.department_number || '').trim().replace(/\s/g, '');
          const spotType = parseImportedSpotType(item.spot_type);
          const cocheraType = parseImportedCocheraType(item.cochera_type);
          const fail = (reason: string) => errors.push({ line, license_plate: licensePlate, reason });
          // The plate is optional: a row without a plate still assigns the
          // cochera to its department, it just creates no vehicle.
          if (!spotNumber || !towerCode || !departmentNumber) {
            fail(!spotNumber ? 'La cochera debe ser un número entre 001 y 999.' : 'Falta la torre o el departamento.');
            continue;
          }
          if (!spotType || !cocheraType) {
            fail(!spotType ? `El tipo de plaza ${String(item.spot_type || '')} no es válido.` : `El tipo de cochera ${String(item.cochera_type || '')} no es válido.`);
            continue;
          }
          if (!/^\d{3,}$/.test(departmentNumber)) {
            fail(`El departamento ${departmentNumber} debe ser un número de al menos 3 cifras.`);
            continue;
          }
          if (plateKey && importedPlates.has(plateKey)) {
            fail(`La placa ${licensePlate} está repetida en el archivo.`);
            continue;
          }
          const matchingTowers = towers.filter(tower => tower.code.trim().toLowerCase() === towerCode.toLowerCase());
          if (matchingTowers.length !== 1) {
            fail(matchingTowers.length === 0 ? `No existe la torre ${towerCode}.` : `Hay más de una torre con el nombre corto ${towerCode}.`);
            continue;
          }
          const floorNumber = Number(departmentNumber.slice(0, -2));
          const floor = floors.find(candidate => candidate.tower_id === matchingTowers[0].id && candidate.floor_number === floorNumber);
          if (!floor) {
            fail(`No existe el piso ${floorNumber} en la torre ${towerCode}.`);
            continue;
          }
          const exactDepartments = departments.filter(department => department.floor_id === floor.id && department.department_number.trim() === departmentNumber);
          const numericDepartments = departments.filter(department => department.floor_id === floor.id && /^\d+$/.test(department.department_number) && Number(department.department_number) === Number(departmentNumber));
          const matchingDepartments = exactDepartments.length > 0 ? exactDepartments : numericDepartments;
          if (matchingDepartments.length !== 1) {
            fail(matchingDepartments.length === 0 ? `No existe el departamento ${departmentNumber} en la torre ${towerCode}.` : `El departamento ${departmentNumber} es ambiguo en la torre ${towerCode}.`);
            continue;
          }

          const matches = spotsByNumber.get(spotNumber) || [];
          if (matches.length !== 1) {
            fail(matches.length === 0 ? `No existe la cochera ${spotNumber}.` : `Hay más de una cochera ${spotNumber}.`);
            continue;
          }
          const spot = matches[0];
          const departmentId = matchingDepartments[0].id;
          if (spot.inside && (
            spot.department_id !== departmentId ||
            spot.type !== spotType ||
            (spot.cochera_type || 'MULTIPLE') !== cocheraType
          )) {
            fail(`La cochera ${spotNumber} está ocupada y no se puede reasignar ni cambiar de tipo.`);
            continue;
          }
          const currentPlan = spotPlans.get(String(spot.id));
          if (currentPlan && (currentPlan.departmentId !== departmentId || currentPlan.spotType !== spotType || currentPlan.cocheraType !== cocheraType)) {
            fail(`La cochera ${spotNumber} tiene asignaciones o tipos distintos en el archivo.`);
            continue;
          }

          // A plate already linked to a different cochera cannot be reassigned by
          // import; the existing assignment must be cleared first.
          const existing = plateKey ? registeredByPlate.get(plateKey) : undefined;
          if (existing?.spot_id && existing.spot_id !== String(spot.id)) {
            const currentSpot = spotNumberById.get(existing.spot_id) || existing.spot_id;
            fail(`La placa ${licensePlate} ya está asignada a la cochera ${currentSpot}. Quita esa asignación antes de reasignarla.`);
            continue;
          }

          spotPlans.set(String(spot.id), { spot, departmentId, spotType, cocheraType });
          if (plateKey) {
            importedPlates.add(plateKey);
            if (existing) {
              updateRows.push({ vehicleId: existing.id, line, licensePlate, driverName, spotId: String(spot.id), departmentId, vehicleType: normalizeVehicleType(item.vehicle_type) });
            } else {
              const type = normalizeVehicleType(item.vehicle_type);
              const spotKey = String(spot.id);
              const cur = activeBySpot.get(spotKey) || { autos: 0, motos: 0 };
              const allowActive = capacityAllows(cocheraType, limits, cur, type);
              if (allowActive) {
                if (type === 'AUTO') cur.autos++; else cur.motos++;
                activeBySpot.set(spotKey, cur);
              }
              validRows.push({ line, licensePlate, plateKey, driverName, spotId: spotKey, departmentId, vehicleType: type, isActive: allowActive });
            }
          }
        }

        const ownerDepartmentIds = [...new Set([...validRows, ...updateRows].filter(row => !row.driverName).map(row => row.departmentId))];
        const ownerResults = await Promise.all(ownerDepartmentIds.map(async departmentId => [departmentId, await resolveDepartmentOwner(db, departmentId)] as const));
        const ownerByDepartment = new Map(ownerResults);
        // The department owner is the default driver, but a missing owner does
        // not block the import: the vehicle is created without a driver.
        const withDriver = (rows: Array<{ line: number; licensePlate: string; driverName: string; departmentId: string }>) => rows.map(row => {
          if (!row.driverName) row.driverName = ownerByDepartment.get(row.departmentId) || '';
          return row;
        });
        const rowsWithDriver = withDriver(validRows);
        const updatesWithDriver = withDriver(updateRows);

        // Every validated cochera is assigned to its department, even when the
        // row carries no plate (and therefore creates no vehicle).
        const configuredSpotIds = new Set(spotPlans.keys());
        const updateGroups = new Map<string, { departmentId: string; spotType: string; cocheraType: string; ids: string[] }>();
        for (const [spotId, plan] of spotPlans) {
          if (!configuredSpotIds.has(spotId)) continue;
          if (plan.spot.department_id === plan.departmentId && plan.spot.type === plan.spotType && plan.spot.cochera_type === plan.cocheraType) continue;
          const key = `${plan.departmentId}:${plan.spotType}:${plan.cocheraType}`;
          const group = updateGroups.get(key) || { departmentId: plan.departmentId, spotType: plan.spotType, cocheraType: plan.cocheraType, ids: [] };
          group.ids.push(spotId);
          updateGroups.set(key, group);
        }
        const assignmentGroups = Array.from(updateGroups.values());
        for (let i = 0; i < assignmentGroups.length; i += 8) {
          const results = await Promise.all(assignmentGroups.slice(i, i + 8).map(group => db.from('parking_spots').update({
            department_id: group.departmentId,
            type: group.spotType,
            cochera_type: group.cocheraType
          }).in('id', group.ids)));
          const failed = results.find(result => result.error);
          if (failed?.error) throw failed.error;
        }

        const toInsert = rowsWithDriver.map(row => ({
          department_id: row.departmentId,
          spot_id: row.spotId,
          license_plate: row.licensePlate,
          vehicle_type: row.vehicleType,
          driver_name: row.driverName || null,
          brand: null,
          model: null,
          color: null,
          is_active: row.isActive,
          created_by_user_id: uid
        }));
        let created: Array<Record<string, unknown>> = [];
        if (rowsWithDriver.length > 0) {
          const { data, error: insertError } = await db.from('vehicles').insert(toInsert).select();
          if (insertError) throw insertError;
          created = await enrichVehicles(db, (data || []) as Array<Record<string, unknown>>);
        }
        let updated = 0;
        for (const row of updatesWithDriver) {
          const { error: updateError } = await db.from('vehicles').update({
            department_id: row.departmentId,
            spot_id: row.spotId,
            vehicle_type: row.vehicleType,
            driver_name: row.driverName || null
          }).eq('id', row.vehicleId);
          if (updateError) throw updateError;
          updated++;
        }
        return json({ success: true, data: { created: created.length, updated, spots_configured: configuredSpotIds.size, errors }, error: null }, 200);
      }

      case 'update-vehicle': {
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { data: current } = await db.from('vehicles').select('department_id, created_by_user_id, spot_id, vehicle_type, is_active').eq('id', id).single();
        if (!current) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Vehículo no encontrado' } }, 404);
        if (!isAdmin) {
          if (isSecurity || current.department_id !== myDepartmentId) return forbidden();
        }

        const updates: Record<string, unknown> = {};
        if (body.license_plate !== undefined) {
          const licensePlate = String(body.license_plate).trim().toUpperCase();
          const normalizedPlate = normalizeLicensePlate(licensePlate);
          if (!normalizedPlate) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'La placa no es válida' } }, 400);
          const { data: registeredVehicles, error: registeredVehiclesError } = await db.from('vehicles').select('id, license_plate').limit(10000);
          if (registeredVehiclesError) throw registeredVehiclesError;
          if ((registeredVehicles || []).some((vehicle: { id: string; license_plate?: string }) => vehicle.id !== id && normalizeLicensePlate(vehicle.license_plate) === normalizedPlate)) {
            return json({ success: false, data: null, error: { code: 'DUPLICATE', message: `La placa ${licensePlate} ya está registrada en otra cochera de este condominio` } }, 409);
          }
          updates.license_plate = licensePlate;
        }
        if (body.vehicle_type !== undefined) updates.vehicle_type = normalizeVehicleType(body.vehicle_type);
        if (body.driver_name !== undefined) updates.driver_name = body.driver_name ? String(body.driver_name).trim() : null;
        if (body.brand !== undefined) updates.brand = body.brand ? String(body.brand) : null;
        if (body.model !== undefined) updates.model = body.model ? String(body.model) : null;
        if (body.color !== undefined) updates.color = body.color ? String(body.color) : null;
        if (body.is_active !== undefined) updates.is_active = body.is_active === true;
        if (body.spot_id !== undefined) {
          const spotId = body.spot_id ? String(body.spot_id).trim() : null;
          if (spotId) {
            const { data: spotRow } = await db.from('parking_spots').select('id, department_id').eq('id', spotId).maybeSingle();
            if (!spotRow) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'La cochera seleccionada no existe' } }, 400);
            if (spotRow.department_id) updates.department_id = spotRow.department_id;
          }
          updates.spot_id = spotId;
        }

        // Activating a vehicle must respect the cochera's active capacity.
        const finalActive = updates.is_active !== undefined ? updates.is_active === true : Boolean(current.is_active);
        const effectiveSpotId = (updates.spot_id !== undefined ? updates.spot_id : current.spot_id) as string | null;
        const effectiveType = (updates.vehicle_type !== undefined ? updates.vehicle_type : current.vehicle_type) as string;
        if (finalActive && effectiveSpotId) {
          const conflict = await activeCapacityConflict(db, String(effectiveSpotId), String(effectiveType), id);
          if (conflict) return json({ success: false, data: null, error: { code: 'CAPACITY', message: conflict } }, 409);
        }

        const { data, error } = await db.from('vehicles').update(updates).eq('id', id).select().single();
        if (error) throw error;
        const enriched = (await enrichVehicles(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'set-vehicle-active': {
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { data: current } = await db.from('vehicles').select('department_id, spot_id, vehicle_type').eq('id', id).single();
        if (!current) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Vehículo no encontrado' } }, 404);
        if (!isAdmin) {
          if (isSecurity || current.department_id !== myDepartmentId) return forbidden();
        }
        const wantActive = body.is_active === true;
        if (wantActive && current.spot_id) {
          const conflict = await activeCapacityConflict(db, String(current.spot_id), String(current.vehicle_type), id);
          if (conflict) return json({ success: false, data: null, error: { code: 'CAPACITY', message: conflict } }, 409);
        }
        const { data, error } = await db.from('vehicles').update({ is_active: wantActive }).eq('id', id).select().single();
        if (error) throw error;
        const enriched = (await enrichVehicles(db, [data]))[0];
        return json({ success: true, data: enriched, error: null }, 200);
      }

      case 'delete-vehicle': {
        const id = body.id as string;
        if (!id) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'id es requerido' } }, 400);
        const { data: current } = await db.from('vehicles').select('department_id, created_by_user_id, license_plate').eq('id', id).single();
        if (!current) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Vehículo no encontrado' } }, 404);
        if (!isAdmin) {
          if (isSecurity || current.department_id !== myDepartmentId) return forbidden();
        }

        // Release any parking spot still occupied by this vehicle: close its open
        // access log (system exit) and free the affected spot(s).
        if (current.license_plate) {
          await closeOpenVehicleLogs(db, [String(current.license_plate)]);
        }

        const { error } = await db.from('vehicles').delete().eq('id', id);
        if (error) throw error;
        return json({ success: true, data: null, error: null }, 200);
      }

      case 'delete-vehicles': {
        if (!isAdmin) return forbidden();
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(id => String(id).trim()).filter(Boolean))];
        if (ids.length === 0) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Selecciona al menos un vehículo' } }, 400);
        }
        let deleted = 0;
        for (let offset = 0; offset < ids.length; offset += 40) {
          const batchIds = ids.slice(offset, offset + 40);
          const { data: selected, error: listError } = await db.from('vehicles').select('id, license_plate').in('id', batchIds);
          if (listError) throw listError;
          if (!selected?.length) continue;

          const plates = [...new Set(selected.map((vehicle: { license_plate?: string }) => String(vehicle.license_plate || '').trim()).filter(Boolean))];
          await closeOpenVehicleLogs(db, plates);
          const { error } = await db.from('vehicles').delete().in('id', selected.map((vehicle: { id: string }) => vehicle.id));
          if (error) throw error;
          deleted += selected.length;
        }
        return json({ success: true, data: { deleted }, error: null }, 200);
      }

      // ---------- LOANS (owner lends parking spot) ----------
      case 'list-loans': {
        let q = db.from('parking_loans').select('*');
        if (isAdmin) {
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
        const startMs = new Date(startTime).getTime();
        const endMs = new Date(endTime).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'end_time debe ser posterior a start_time' } }, 400);
        }

        const { data: spot } = await db.from('parking_spots').select('id, department_id, type, status').eq('id', spotId).single();
        if (!spot) return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Estacionamiento no encontrado' } }, 404);
        if (spot.type === 'VISITA') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'Los estacionamientos de visita no se prestan entre propietarios ni se alquilan' } }, 409);
        }
        if (spot.status === 'OCUPADO') {
          return json({ success: false, data: null, error: { code: 'BAD_STATE', message: 'El estacionamiento está ocupado y no puede prestarse ahora' } }, 409);
        }

        const occupantName = body.occupant_name ? String(body.occupant_name).trim() : null;
        const durationUnit = body.duration_unit ? String(body.duration_unit).trim().toUpperCase() : null;

        if (spot.type === 'ALQUILADO') {
          // Renting an "alquilado" spot: admins register who will occupy it and for how long
          if (!isAdmin) return forbidden();
          if (!occupantName) {
            return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Registra el nombre de la persona que ocupará el estacionamiento' } }, 400);
          }
          if (!durationUnit || !['HORAS', 'DIAS', 'MESES'].includes(durationUnit)) {
            return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'duration_unit debe ser HORAS, DIAS o MESES' } }, 400);
          }
          const borrowerVehiclePlate = body.borrower_vehicle_plate ? String(body.borrower_vehicle_plate).trim().toUpperCase() : null;
          if (!borrowerVehiclePlate) {
            return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Registra la placa autorizada para el rango del alquiler' } }, 400);
          }
          const borrowerVehicleType = body.borrower_vehicle_type
            ? normalizeVehicleType(body.borrower_vehicle_type)
            : 'AUTO';
          const { data, error } = await db.from('parking_loans').insert([{
            spot_id: spotId,
            lender_department_id: body.lender_department_id || null,
            borrower_department_id: null,
            borrower_vehicle_plate: borrowerVehiclePlate,
            borrower_vehicle_type: borrowerVehicleType,
            occupant_name: occupantName,
            occupant_document_type: body.occupant_document_type ? String(body.occupant_document_type).trim().toUpperCase() : null,
            occupant_document_number: body.occupant_document_number ? String(body.occupant_document_number).trim() : null,
            duration_unit: durationUnit,
            start_time: new Date(startTime).toISOString(),
            end_time: new Date(endTime).toISOString(),
            status: body.status === 'ACTIVO' ? 'ACTIVO' : 'PENDIENTE'
          }]).select().single();
          if (error) throw error;
          const enriched = (await enrichLoans(db, [data]))[0];
          return json({ success: true, data: enriched, error: null }, 201);
        }

        // PROPIO spot: owner lends to another resident or visitor within a time window
        const lenderDepartmentId = (body.lender_department_id as string) || (myDepartmentId as string) || null;
        if (!lenderDepartmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere un departamento que presta el estacionamiento' } }, 400);
        }
        if (!isAdmin && lenderDepartmentId !== myDepartmentId) return forbidden();
        if (spot.department_id !== lenderDepartmentId) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'El estacionamiento no pertenece al departamento que lo presta' } }, 400);
        }

        const borrowerDepartmentId = (body.borrower_department_id as string) || null;
        const borrowerVehiclePlate = body.borrower_vehicle_plate ? String(body.borrower_vehicle_plate).trim().toUpperCase() : (body.borrower_vehicle_plate as string) || null;
        const borrowerVehicleType = body.borrower_vehicle_type
          ? normalizeVehicleType(body.borrower_vehicle_type)
          : (borrowerVehiclePlate ? 'AUTO' : null);
        if (!borrowerDepartmentId && !borrowerVehiclePlate) {
          return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Indica la placa del vehículo (o vinculalo a un departamento del condominio)' } }, 400);
        }

        const { data, error } = await db.from('parking_loans').insert([{
          spot_id: spotId,
          lender_department_id: lenderDepartmentId,
          borrower_department_id: borrowerDepartmentId,
          borrower_vehicle_plate: borrowerVehiclePlate,
          borrower_vehicle_type: borrowerVehicleType,
          occupant_name: occupantName,
          occupant_document_type: body.occupant_document_type ? String(body.occupant_document_type).trim().toUpperCase() : null,
          occupant_document_number: body.occupant_document_number ? String(body.occupant_document_number).trim() : null,
          duration_unit: durationUnit || null,
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
      case 'update-vehicle-driver': {
        if (!isOperator) return forbidden();
        const plateValue = String(body.license_plate || '').trim().toUpperCase();
        if (!plateValue) return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'license_plate es requerido' } }, 400);
        const driverName = body.driver_name ? String(body.driver_name).trim() : null;
        const { data: vehicle } = await db.from('vehicles').select('id, driver_name, department_id').eq('license_plate', plateValue).eq('is_active', true).maybeSingle();
        if (!vehicle) {
          return json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'El vehículo no está registrado en el padrón' } }, 404);
        }
        const { data: updated, error } = await db.from('vehicles').update({ driver_name: driverName }).eq('id', vehicle.id).select().single();
        if (error) throw error;
        const driverResolved = await resolveOwnerDriverName(db, updated as { driver_name?: string | null; department_id?: string | null });
        const enriched = await enrichVehicles(db, [updated]);
        return json({ success: true, data: { ...(enriched[0] || updated), driver_name: driverResolved }, error: null }, 200);
      }

      case 'search-plates': {
        if (!isOperator) return forbidden();
        const search = String(body.search || '').trim().toUpperCase();
        if (!search) return json({ success: true, data: [], error: null }, 200);

        // Partial plate search: lists matching vehicles (never exact-match only)
        const { data, error } = await db.from('vehicles')
          .select('*')
          .ilike('license_plate', `%${search}%`)
          .order('license_plate');
        if (error) throw error;
        const vehicles = await enrichVehicles(db, data || []);

        const enriched = [];
        for (const v of vehicles) {
          const plateValue = String(v.license_plate);
          const open = await db.from('parking_access_logs')
            .select('id, spot_id, entry_time, entry_gate_id')
            .eq('license_plate', plateValue)
            .is('exit_time', null)
            .order('entry_time', { ascending: false })
            .limit(1)
            .maybeSingle();
          let inside = false;
          let insideSpot: Record<string, unknown> | null = null;
          if (open.data?.spot_id) {
            inside = true;
            const sp = await db.from('parking_spots').select('id, spot_number, type').eq('id', open.data.spot_id).single();
            insideSpot = sp.data || null;
          }
          const ownerDriver = await resolveOwnerDriverName(db, v as { driver_name?: string | null; department_id?: string | null });
          enriched.push({ ...v, driver_name: ownerDriver || v.driver_name || null, inside, inside_spot: insideSpot });
        }
        return json({ success: true, data: enriched, error: null }, 200);
      }

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

        // Resolve vehicle type + registered driver: registered vehicle wins
        const { data: vehicleRow } = await db.from('vehicles').select('id, vehicle_type, driver_name, department_id').eq('license_plate', plate).eq('is_active', true).maybeSingle();
        const vehicleType = vehicleRow?.vehicle_type
          ? normalizeVehicleType(vehicleRow.vehicle_type)
          : normalizeVehicleType(body.vehicle_type);
        const isRegisteredOwner = Boolean(vehicleRow);

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

        const capacity = await getMultipleVehicleLimits(db);
        const resolution = await resolvePlateEntry(db, plate, body.spot_id as string | null, vehicleType, capacity);
        if (!resolution.spot) {
          return json({ success: false, data: null, error: { code: 'NO_AUTHORIZED_SPOT', message: resolution.message } }, 409);
        }

        // Driver name: for the owner/registered vehicle we resolve the department
        // owner (or the vehicle's registered driver); visitors and rented spots
        // require manual input from the guard.
        const isOwnerEntry = isRegisteredOwner && (resolution.reason === 'PROPIO' || resolution.reason === 'PRESTAMO');
        const driverName = isOwnerEntry
          ? await resolveOwnerDriverName(db, vehicleRow)
          : (body.driver_name ? String(body.driver_name).trim() : null);

        const gate = await resolveGateForOperator(uid, db, body.gate_id);
        const now = new Date().toISOString();
        const { data: log, error } = await db.from('parking_access_logs').insert([{
          spot_id: resolution.spot.id,
          license_plate: plate,
          vehicle_type: vehicleType,
          driver_name: driverName,
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
            vehicle_type: vehicleType,
            driver_name: driverName,
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
          .select('id, spot_id, vehicle_type')
          .eq('license_plate', plate)
          .is('exit_time', null)
          .order('entry_time', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!log) {
          return json({ success: false, data: null, error: { code: 'NOT_INSIDE', message: 'El vehículo no está dentro del estacionamiento. Solo se puede registrar su ingreso.' } }, 409);
        }

        const [spotResult, occupantsResult] = await Promise.all([
          db.from('parking_spots').select('cochera_type').eq('id', log.spot_id).maybeSingle(),
          db.from('parking_access_logs').select('id, vehicle_type').eq('spot_id', log.spot_id).is('exit_time', null)
        ]);
        if (occupantsResult.error) throw occupantsResult.error;
        const remainingOccupants = ((occupantsResult.data || []) as Array<{ id: string; vehicle_type: string }>).filter(item => item.id !== log.id);
        const isMultiple = String(spotResult.data?.cochera_type || '').toUpperCase() === 'MULTIPLE';
        const autosRemaining = remainingOccupants.filter(item => normalizeVehicleType(item.vehicle_type) === 'AUTO').length;
        const motosRemaining = remainingOccupants.filter(item => normalizeVehicleType(item.vehicle_type) === 'MOTO').length;
        if (isMultiple && autosRemaining > 0 && motosRemaining === 0) {
          return json({ success: false, data: null, error: { code: 'CAPACITY_RULE', message: 'Registra primero la salida del auto; una cochera múltiple no puede dejar un auto sin al menos una moto' } }, 409);
        }

        const gate = await resolveGateForOperator(uid, db, body.gate_id);
        const { data: updated, error } = await db.from('parking_access_logs').update({
          exit_time: new Date().toISOString(),
          exit_gate_id: gate?.id || null
        }).eq('id', log.id).select().single();
        if (error) throw error;

        await db.from('parking_spots')
          .update({ status: remainingOccupants.length > 0 ? 'OCUPADO' : 'DISPONIBLE' })
          .eq('id', log.spot_id);

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

        const plateFilter = body.license_plate ? String(body.license_plate).trim().toUpperCase() : null;
        if (plateFilter) q = q.ilike('license_plate', `%${plateFilter}%`);

        const driverFilter = body.driver_name ? String(body.driver_name).trim() : null;
        if (driverFilter) q = q.ilike('driver_name', `%${driverFilter}%`);

        const fromDate = body.from_date ? String(body.from_date).replace(/T.*$/, '') + 'T00:00:00' : null;
        if (fromDate) q = q.gte('entry_time', fromDate);

        const toDateRaw = body.to_date ? String(body.to_date).replace(/T.*$/, '') : null;
        if (toDateRaw) q = q.lte('entry_time', toDateRaw + 'T23:59:59.999');

        const { data, error } = await q.order('entry_time', { ascending: false }).limit(Number(body.limit) || 500);
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

  // Registered owner vehicles resolve the driver name automatically
  const ownerDriver = vehicle
    ? await resolveOwnerDriverName(db, { driver_name: vehicle.driver_name, department_id: vehicle.department_id })
    : null;

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
  const now = new Date().toISOString();
  const { data: activeLoans } = await db.from('parking_loans')
    .select('spot_id, borrower_vehicle_plate, borrower_department_id')
    .eq('status', 'ACTIVO')
    .lte('start_time', now)
    .gte('end_time', now);
  const authorizedRentedSpotIds = [...new Set(((activeLoans || []) as Array<{ spot_id: string; borrower_vehicle_plate?: string | null; borrower_department_id?: string | null }>)
    .filter(loan => loan.borrower_vehicle_plate?.toUpperCase() === plate || (vehicle?.department_id && loan.borrower_department_id === vehicle.department_id))
    .map(loan => loan.spot_id))];
  const availableRentedSpots = authorizedRentedSpotIds.length
    ? await db.from('parking_spots').select('*').in('id', authorizedRentedSpotIds).eq('type', 'ALQUILADO')
    : { data: [] };

  return {
    license_plate: plate,
    vehicle: vehicle,
    driver_name: ownerDriver || (open.data?.driver_name as string | null) || null,
    inside: Boolean(open.data),
    current_log: open.data || null,
    inside_spot: insideSpot,
    entry_gate: entryGate,
    visitor_spots: (availableVisitorSpots.data || []).map((s: Record<string, unknown>) => ({ id: s.id, spot_number: s.spot_number })),
    rented_spots: (availableRentedSpots.data || []).map((s: Record<string, unknown>) => ({ id: s.id, spot_number: s.spot_number }))
  };
}

interface EntryResolution {
  spot: { id: string; spot_number: string; type: string } | null;
  reason: string;
  message: string;
}

async function resolvePlateEntry(
  db: { from(t: string): any },
  plate: string,
  overrideSpotId: string | null,
  vehicleType: string,
  capacity: MultipleVehicleLimits
): Promise<EntryResolution> {
  const now = new Date().toISOString();
  const needsHost = async (spotId: string, type = vehicleType): Promise<{ ok: boolean; message: string }> => spotCanHostType(db, spotId, type, capacity);

  // 1) Registered vehicle -> owner's PROPIO spot (must respect the vehicle rule)
  const { data: vehicle } = await db.from('vehicles').select('id, department_id').eq('license_plate', plate).eq('is_active', true).maybeSingle();
  if (vehicle) {
    const { data: ownSpots } = await db.from('parking_spots')
      .select('id, spot_number, type')
      .eq('department_id', vehicle.department_id)
      .eq('type', 'PROPIO')
      .limit(10);
    for (const s of (ownSpots || []) as Array<{ id: string; spot_number: string; type: string }>) {
      if ((await needsHost(s.id)).ok) {
        return { spot: { id: s.id, spot_number: s.spot_number, type: s.type }, reason: 'PROPIO', message: 'Estacionamiento propio del vehículo' };
      }
    }
  }

  // 2) Active loan within time window for the borrower plate or department
  const { data: loans } = await db.from('parking_loans')
    .select('id, spot_id, borrower_vehicle_plate, borrower_department_id, borrower_vehicle_type')
    .eq('status', 'ACTIVO')
    .lte('start_time', now)
    .gte('end_time', now);
  const matchingLoan = ((loans || []) as Array<{ id: string; spot_id: string; borrower_vehicle_plate: string | null; borrower_department_id: string | null; borrower_vehicle_type: string | null }>).find(loan =>
    (loan.borrower_vehicle_plate && loan.borrower_vehicle_plate.toUpperCase() === plate) ||
    (vehicle && loan.borrower_department_id === vehicle.department_id)
  );
  if (matchingLoan) {
    const authorizedType = matchingLoan.borrower_vehicle_type ? normalizeVehicleType(matchingLoan.borrower_vehicle_type) : vehicleType;
    if (authorizedType !== vehicleType) {
      return { spot: null, reason: 'PRESTAMO', message: 'El tipo de vehículo no coincide con el autorizado por el préstamo.' };
    }
    const { data: loanSpot } = await db.from('parking_spots').select('id, spot_number, type').eq('id', matchingLoan.spot_id).maybeSingle();
    if (!loanSpot) {
      return { spot: null, reason: 'PRESTAMO', message: 'La plaza asignada al préstamo ya no existe.' };
    }
    const loanCapacity = await needsHost(matchingLoan.spot_id, authorizedType);
    if (!loanCapacity.ok) {
      return { spot: null, reason: 'PRESTAMO', message: loanCapacity.message };
    }
    return { spot: { id: loanSpot.id, spot_number: loanSpot.spot_number, type: loanSpot.type }, reason: loanSpot.type === 'ALQUILADO' ? 'ALQUILER' : 'PRESTAMO', message: 'Préstamo o alquiler vigente dentro de su rango de fechas' };
  }

  // 3) Explicit spot chosen by the guard (e.g. VISITA / ALQUILADO assignment)
  if (overrideSpotId) {
    const { data: explicit } = await db.from('parking_spots').select('id, spot_number, type').eq('id', overrideSpotId).maybeSingle();
    if (explicit?.type === 'ALQUILADO') {
      return { spot: null, reason: 'ALQUILER', message: 'La plaza alquilada solo admite la placa asociada a un alquiler activo y vigente.' };
    }
    if (explicit?.type === 'PROPIO') {
      // A PROPIO spot belongs to a department: the guard cannot park an
      // unrelated car there. Only the department's own vehicle or an active,
      // in-range loan (handled above) may use it.
      const { data: spotRow } = await db.from('parking_spots').select('department_id').eq('id', overrideSpotId).maybeSingle();
      const isOwn = Boolean(vehicle && spotRow?.department_id && vehicle.department_id === spotRow.department_id);
      if (!isOwn) {
        return { spot: null, reason: 'ASIGNADA', message: 'Ese estacionamiento pertenece a un departamento; solo lo puede usar el vehículo del departamento o un préstamo vigente dentro de su rango de fechas.' };
      }
    }
    if (explicit) {
      const allowed = await needsHost(overrideSpotId);
      if (allowed.ok) return { spot: { id: explicit.id, spot_number: explicit.spot_number, type: explicit.type }, reason: 'ASIGNADA', message: 'Estacionamiento asignado por el guardia' };
      return { spot: null, reason: 'ASIGNADA', message: allowed.message };
    }
  }

  // 4) Visitor availability
  const { data: availableVisitorSpots } = await db.from('parking_spots')
    .select('id, spot_number, type')
    .eq('type', 'VISITA');
  for (const vs of (availableVisitorSpots || []) as Array<{ id: string; spot_number: string; type: string }>) {
    if ((await needsHost(vs.id)).ok) {
      return { spot: { id: vs.id, spot_number: vs.spot_number, type: vs.type }, reason: 'VISITA', message: 'Estacionamiento de visita disponible' };
    }
  }

  return {
    spot: null,
    reason: 'NINGUNO',
    message: 'No se encontró un estacionamiento autorizado: el vehículo no tiene plaza propia, préstamo o alquiler vigente, ni hay plazas de visita libres que cumplan los cupos configurados.'
  };
}

type MultipleVehicleLimits = { max_autos: number; max_motos: number };

async function spotCanHostType(
  db: { from(t: string): any },
  spotId: string,
  vehicleType: string,
  limits: MultipleVehicleLimits
): Promise<{ ok: boolean; message: string }> {
  const { data: spotRow } = await db.from('parking_spots').select('cochera_type').eq('id', spotId).single();
  const isMultiple = String((spotRow as { cochera_type?: string } | null)?.cochera_type || '').trim().toUpperCase() === 'MULTIPLE';
  const { data: occupants, error } = await db.from('parking_access_logs')
    .select('vehicle_type')
    .eq('spot_id', spotId)
    .is('exit_time', null);
  if (error) throw error;
  const current = (occupants || []) as Array<{ vehicle_type: string }>;
  const carsInside = current.filter(item => normalizeVehicleType(item.vehicle_type) === 'AUTO').length;
  const motosInside = current.filter(item => normalizeVehicleType(item.vehicle_type) === 'MOTO').length;

  if (!isMultiple) {
    // Individual cochera: only one vehicle at a time.
    if (current.length >= 1) {
      return { ok: false, message: 'La cochera es individual y ya tiene un vehículo estacionado. Solo admite un vehículo a la vez.' };
    }
    return { ok: true, message: '' };
  }

  const nextAutos = carsInside + (normalizeVehicleType(vehicleType) === 'AUTO' ? 1 : 0);
  const nextMotos = motosInside + (normalizeVehicleType(vehicleType) === 'MOTO' ? 1 : 0);
  if (nextAutos > limits.max_autos) {
    return { ok: false, message: `La cochera múltiple admite como máximo ${limits.max_autos} auto(s).` };
  }
  if (nextMotos > limits.max_motos) {
    return { ok: false, message: `La cochera múltiple admite como máximo ${limits.max_motos} moto(s).` };
  }
  if (nextAutos > 0 && nextMotos < 1) {
    return { ok: false, message: 'En una cochera múltiple, todo auto debe compartir la plaza con al menos una moto. Registra primero el ingreso de la moto.' };
  }
  return { ok: true, message: '' };
}

// Resolves the default driver/owner name for a parking spot: the primary owner
// of the department assigned to the spot (PROPIO), the loan occupant (PRESTAMO),
// or null for visitors/rented.
async function resolveSpotOwnerDriverName(db: { from(t: string): any }, spot: { id: string } | null): Promise<string | null> {
  if (!spot) return null;
  const { data: spotRow } = await db.from('parking_spots').select('department_id, type').eq('id', spot.id).single();
  if (!spotRow?.department_id) return null;
  return resolveDepartmentOwner(db, String(spotRow.department_id));
}

// Resolves the owner name of a department: prefers PROPIETARIO residents, then
// the primary contact, then any resident.
async function resolveDepartmentOwner(db: { from(t: string): any }, departmentId: string): Promise<string | null> {
  const { data: owner } = await db.from('residents')
    .select('full_name')
    .eq('department_id', departmentId)
    .eq('relationship_type', 'PROPIETARIO')
    .limit(1)
    .maybeSingle();
  if (owner?.full_name) return String(owner.full_name).trim();

  const { data: primary } = await db.from('residents')
    .select('full_name')
    .eq('department_id', departmentId)
    .eq('is_primary_contact', true)
    .limit(1)
    .maybeSingle();
  if (primary?.full_name) return String(primary.full_name).trim();

  const { data: anyResident } = await db.from('residents')
    .select('full_name')
    .eq('department_id', departmentId)
    .limit(1)
    .maybeSingle();
  return anyResident?.full_name ? String(anyResident.full_name).trim() : null;
}

// Resolves the driver name for an owner's registered vehicle: prefers the
// vehicle's driver_name, then the department owner.
async function resolveOwnerDriverName(
  db: { from(t: string): any },
  vehicle: { driver_name?: string | null; department_id?: string | null } | null
): Promise<string | null> {
  if (!vehicle) return null;
  if (vehicle.driver_name && String(vehicle.driver_name).trim()) return String(vehicle.driver_name).trim();
  if (!vehicle.department_id) return null;
  return resolveDepartmentOwner(db, String(vehicle.department_id));
}

// ---------------------------------------------------------------------------
// Gate resolution for the operator (uses the persisted guard gate session)
// ---------------------------------------------------------------------------

async function resolveGateForOperator(
  uid: string | null,
  db: { from(t: string): any },
  explicitGateId: unknown
): Promise<{ id: string; name: string } | null> {
  // 1) Explicit gate wins (e.g. admin/override)
  if (explicitGateId) {
    const { data: g } = await db.from('condo_gates').select('id, name').eq('id', String(explicitGateId)).eq('is_active', true).maybeSingle();
    if (g) return { id: g.id, name: g.name };
  }

  // 2) Guard's active session gate (persisted when they authenticated/entered garita)
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

  // 3) Fallback: use the first active entry/exit gate so the access is always
  // attributed to a gate even when the guard has no active session.
  const { data: gates } = await db.from('condo_gates').select('id, name').eq('is_active', true).eq('is_entry_exit', true).order('sort_order');
  if (gates?.length) return { id: gates[0].id, name: gates[0].name };

  return null;
}

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

async function closeOpenVehicleLogs(db: { from(t: string): any }, plates: string[]): Promise<void> {
  if (plates.length === 0) return;
  const openLogs: Array<{ id: string; spot_id: string | null }> = [];
  for (let i = 0; i < plates.length; i += 40) {
    const { data, error } = await db.from('parking_access_logs')
      .select('id, spot_id')
      .in('license_plate', plates.slice(i, i + 40))
      .is('exit_time', null);
    if (error) throw error;
    if (data) openLogs.push(...(data as Array<{ id: string; spot_id: string | null }>));
  }
  if (!openLogs.length) return;

  const logIds = openLogs.map(log => log.id);
  const affectedSpotIds = [...new Set(openLogs.map(log => log.spot_id).filter(Boolean))] as string[];
  for (let i = 0; i < logIds.length; i += 40) {
    const { error: closeError } = await db.from('parking_access_logs').update({ exit_time: new Date().toISOString() }).in('id', logIds.slice(i, i + 40));
    if (closeError) throw closeError;
  }

  for (const spotId of affectedSpotIds) {
    const { count, error } = await db.from('parking_access_logs')
      .select('*', { count: 'exact', head: true })
      .eq('spot_id', spotId)
      .is('exit_time', null);
    if (error) throw error;
    const { error: updateError } = await db.from('parking_spots').update({ status: (count || 0) > 0 ? 'OCUPADO' : 'DISPONIBLE' }).eq('id', spotId);
    if (updateError) throw updateError;
  }
}

async function enrichSpots(db: { from(t: string): any }, spots: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(spots.map(s => s.department_id as string | null).filter(Boolean))];
  const spotIds = spots.map(s => s.id as string).filter(Boolean);

  // None of these depend on each other, so they run together instead of one
  // after another (the map/config load used to wait on ~20 sequential queries).
  const [deptRows, resRows, openSpotList, vehRows] = await Promise.all([
    fetchRowsIn(db, 'departments', 'id, department_number, tower_id, floor_id', 'id', deptIds),
    deptIds.length
      ? fetchRowsIn(db, 'residents', 'department_id, full_name, is_primary_contact, relationship_type', 'department_id', deptIds).catch(() => [])
      : Promise.resolve([] as Array<Record<string, any>>),
    fetchOpenSpotIds(db, spotIds).catch(() => [] as string[]),
    (async () => {
      try {
        const { data } = await db.from('vehicles').select('spot_id, license_plate').eq('is_active', true).not('spot_id', 'is', null);
        return (data || []) as Array<{ spot_id?: string | null; license_plate?: string }>;
      } catch { return [] as Array<{ spot_id?: string | null; license_plate?: string }>; }
    })()
  ]);

  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const floorIds = [...new Set((deptRows as Array<{ floor_id: string }>).map(d => d.floor_id).filter(Boolean))];
  const [towerRows, floorRows] = await Promise.all([
    fetchRowsIn(db, 'towers', 'id, name, code', 'id', towerIds),
    fetchRowsIn(db, 'floors', 'id, floor_number', 'id', floorIds)
  ]);

  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string; floor_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
  const floorMap = new Map((floorRows as Array<{ id: string; floor_number: number }>).map(f => [f.id, f]));

  // Owner of each assigned department (primary / owner resident) so the vehicles
  // form can prefill the driver name from the parking spot without asking again.
  const ownerMap = new Map<string, string>();
  const bestOwner = new Map<string, { name: string; score: number }>();
  for (const r of resRows as Array<{ department_id: string; full_name: string; is_primary_contact: boolean; relationship_type: string }>) {
    const deptId = r.department_id;
    let score = 2;
    if (r.relationship_type === 'PROPIETARIO') score--;
    if (r.is_primary_contact) score--;
    const cur = bestOwner.get(deptId);
    if (!cur || score < cur.score) bestOwner.set(deptId, { name: r.full_name, score });
  }
  for (const [deptId, v] of bestOwner) ownerMap.set(deptId, v.name);

  const insideSpotIds = new Set<string>(openSpotList);

  // Cochera con vehículo registrado (aunque no esté físicamente dentro) y las
  // matrículas de esos vehículos activos, para mostrarlas en el mapa.
  const vehiclePlatesBySpot = new Map<string, string[]>();
  for (const v of vehRows) {
    if (!v.spot_id) continue;
    const key = String(v.spot_id);
    const arr = vehiclePlatesBySpot.get(key) || [];
    if (v.license_plate) arr.push(String(v.license_plate));
    vehiclePlatesBySpot.set(key, arr);
  }

  return spots.map(s => {
    const dept = s.department_id ? deptMap.get(s.department_id as string) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    const floor = dept ? floorMap.get(dept.floor_id) : undefined;
    const inside = Boolean(s.id && insideSpotIds.has(s.id as string));
    const vehiclePlates = s.id ? (vehiclePlatesBySpot.get(String(s.id)) || []) : [];
    const hasVehicle = vehiclePlates.length > 0;
    return {
      ...s,
      // Status is derived from the actual occupancy (open access logs) so a
      // stale OCUPADO row never leaves the spot visually occupied.
      status: inside ? 'OCUPADO' : 'DISPONIBLE',
      inside,
      has_vehicle: hasVehicle,
      vehicle_plates: vehiclePlates,
      departments: dept ? {
        department_number: dept.department_number,
        owner_name: dept ? ownerMap.get(dept.id) : undefined,
        tower_id: dept.tower_id,
        floor_id: dept.floor_id,
        floor_number: floor ? floor.floor_number : undefined,
        towers: tower ? { id: tower.id, name: tower.name, code: tower.code } : undefined
      } : undefined
    };
  });
}

// Returns the ids of spots with an open (no exit) access log. The id batches
// run in parallel so a full parking lot resolves in a single round trip.
async function fetchOpenSpotIds(db: { from(t: string): any }, spotIds: string[]): Promise<string[]> {
  if (spotIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < spotIds.length; i += 40) chunks.push(spotIds.slice(i, i + 40));
  const results = await Promise.all(chunks.map(chunk =>
    db.from('parking_access_logs').select('spot_id').is('exit_time', null).in('spot_id', chunk)
  ));
  const out: string[] = [];
  for (const { data, error } of results) {
    if (error) throw error;
    for (const l of (data || []) as Array<{ spot_id?: string }>) if (l.spot_id) out.push(l.spot_id);
  }
  return out;
}

// PostgREST rejects very long URLs, so a single `.in()` with hundreds of ids
// silently fails. Fetch ids in small batches (in parallel) and merge the rows.
async function fetchRowsIn(
  db: { from(t: string): any },
  table: string,
  columns: string,
  column: string,
  ids: Array<string | null | undefined>,
  chunkSize = 40
): Promise<Array<Record<string, any>>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) chunks.push(unique.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(chunk => db.from(table).select(columns).in(column, chunk)));
  const out: Array<Record<string, any>> = [];
  for (const { data, error } of results) {
    if (error) throw error;
    if (data) out.push(...(data as Array<Record<string, any>>));
  }
  return out;
}

async function enrichVehicles(db: { from(t: string): any }, vehicles: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const deptIds = [...new Set(vehicles.map(v => v.department_id as string).filter(Boolean))];
  const explicitSpotIds = [...new Set(vehicles.map(v => v.spot_id as string | null).filter(Boolean))] as string[];
  const plates = vehicles.map(v => String(v.license_plate || '').toUpperCase()).filter(Boolean);

  // Independent lookups run together instead of sequentially.
  const [deptRows, spotRowsByDept, spotRowsByExplicit, openLogs] = await Promise.all([
    fetchRowsIn(db, 'departments', 'id, department_number, tower_id, floor_id', 'id', deptIds),
    deptIds.length
      ? fetchRowsIn(db, 'parking_spots', 'id, department_id, spot_number', 'department_id', deptIds).catch(() => [])
      : Promise.resolve([] as Array<Record<string, any>>),
    explicitSpotIds.length
      ? fetchRowsIn(db, 'parking_spots', 'id, department_id, spot_number', 'id', explicitSpotIds).catch(() => [])
      : Promise.resolve([] as Array<Record<string, any>>),
    plates.length
      ? fetchRowsIn(db, 'parking_access_logs', 'license_plate, spot_id', 'license_plate', plates).catch(() => [])
      : Promise.resolve([] as Array<Record<string, any>>)
  ]);

  const towerIds = [...new Set((deptRows as Array<{ tower_id: string }>).map(d => d.tower_id))];
  const floorIds = [...new Set((deptRows as Array<{ floor_id: string }>).map(d => d.floor_id).filter(Boolean))];
  const [towerRows, floorRows] = await Promise.all([
    fetchRowsIn(db, 'towers', 'id, name, code', 'id', towerIds),
    fetchRowsIn(db, 'floors', 'id, floor_number', 'id', floorIds)
  ]);
  const deptMap = new Map((deptRows as Array<{ id: string; department_number: string; tower_id: string; floor_id: string }>).map(d => [d.id, d]));
  const towerMap = new Map((towerRows as Array<{ id: string; name: string; code: string }>).map(t => [t.id, t]));
  const floorMap = new Map((floorRows as Array<{ id: string; floor_number: number }>).map(f => [f.id, f]));

  // Parking spots (cocheras) assigned to each department, so the vehicles list
  // can show which plaza the vehicle is assigned to. The vehicle's explicit
  // spot_id wins over the department fallback.
  const spotByDept = new Map<string, string[]>();
  const spotById = new Map<string, { spot_number: string; department_id: string | null }>();
  const spotRowsById = new Map<string, { id: string; department_id: string | null; spot_number: string }>();
  for (const sp of spotRowsByDept as Array<{ id: string; department_id: string | null; spot_number: string }>) spotRowsById.set(sp.id, sp);
  for (const sp of spotRowsByExplicit as Array<{ id: string; department_id: string | null; spot_number: string }>) spotRowsById.set(sp.id, sp);
  for (const sp of spotRowsById.values()) {
    spotById.set(sp.id, { spot_number: sp.spot_number, department_id: sp.department_id });
    if (sp.department_id) {
      const arr = spotByDept.get(sp.department_id) || [];
      arr.push(sp.spot_number);
      spotByDept.set(sp.department_id, arr);
    }
  }

  // Plaza que cada vehículo está ocupando actualmente (acceso abierto sin salida).
  const occupiedByPlate = new Map<string, string>();
  const logSpotIds = [...new Set((openLogs as Array<{ spot_id?: string }>).map(log => log.spot_id).filter(Boolean))] as string[];
  if (logSpotIds.length) {
    try {
      const logSpots = await fetchRowsIn(db, 'parking_spots', 'id, spot_number', 'id', logSpotIds);
      const logSpotMap = new Map((logSpots as Array<{ id: string; spot_number: string }>).map(sp => [sp.id, sp.spot_number]));
      for (const l of openLogs as Array<{ license_plate: string; spot_id?: string }>) {
        const num = l.spot_id ? logSpotMap.get(l.spot_id) : undefined;
        if (num) occupiedByPlate.set(String(l.license_plate).toUpperCase(), num);
      }
    } catch {}
  }

  return vehicles.map(v => {
    const linkedSpot = v.spot_id ? spotById.get(v.spot_id as string) : undefined;
    const effectiveDeptId = linkedSpot?.department_id || (v.department_id as string | null);
    const dept = effectiveDeptId ? deptMap.get(effectiveDeptId) : undefined;
    const tower = dept ? towerMap.get(dept.tower_id) : undefined;
    const floor = dept ? floorMap.get(dept.floor_id) : undefined;
    const plateKey = String(v.license_plate || '').toUpperCase();
    const departmentSpots = dept ? (spotByDept.get(dept.id) || []).slice().sort() : [];
    const assignedSpots = linkedSpot ? [linkedSpot.spot_number] : departmentSpots;
    const towerCode = tower?.code ? (String(tower.code).startsWith('T') ? tower.code : `T${tower.code}`) : '';
    return {
      ...v,
      occupied_spot: plateKey && occupiedByPlate.has(plateKey) ? (occupiedByPlate.get(plateKey) || null) : null,
      assigned_spot: linkedSpot ? linkedSpot.spot_number : null,
      department_label: dept ? `${towerCode ? `${towerCode}-` : ''}${dept.department_number}` : null,
      parking_spots: assignedSpots,
      departments: dept
        ? {
            department_number: dept.department_number,
            floor_number: floor?.floor_number ?? null,
            towers: tower ? { id: tower.id, name: tower.name, code: tower.code } : undefined,
            spots: assignedSpots
          }
        : undefined
    };
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
  const vehicleMap = new Map<string, { license_plate: string; department_id: string }>((vehicles.data || []).map((v: { license_plate: string; department_id: string }) => [v.license_plate.toUpperCase(), v]));

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

async function getLayoutConfig(db: { from(t: string): any }): Promise<{ rows: number; spots_per_row: number[]; row_names: string[]; orientation: 'HORIZONTAL' | 'VERTICAL' } | null> {
  try {
    const { data } = await db.from('condo_settings').select('config_json').eq('module_key', 'parking_control').single();
    const cfg = data?.config_json && typeof data.config_json === 'object' ? (data.config_json as Record<string, unknown>) : {};
    const layout = cfg.layout as Record<string, unknown> | undefined;
    if (layout && Number(layout.rows) > 0) {
      const rows = Number(layout.rows);
      const names: string[] = Array.isArray(layout.row_names)
        ? (layout.row_names as unknown[]).map(v => String(v ?? '').trim().slice(0, 60))
        : [];
      while (names.length < rows) names.push(`Fila ${names.length + 1}`);
      const orientation = normalizeOrientation(layout.orientation);
      if (Array.isArray(layout.spots_per_row)) {
        const counts = (layout.spots_per_row as unknown[]).map(v => Math.max(1, Math.round(Number(v) || 1)));
        while (counts.length < rows) counts.push(counts[counts.length - 1] || 1);
        return { rows, spots_per_row: counts, row_names: names.slice(0, rows), orientation };
      }
      if (Number(layout.spots_per_row) > 0) {
        const per = Math.max(1, Math.round(Number(layout.spots_per_row)));
        return { rows, spots_per_row: Array.from({ length: rows }, () => per), row_names: names.slice(0, rows), orientation };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getMultipleVehicleLimits(db: { from(t: string): any }): Promise<MultipleVehicleLimits> {
  const { data, error } = await db.from('condo_settings').select('config_json').eq('module_key', 'parking_control').single();
  if (error) throw error;
  const config = data?.config_json && typeof data.config_json === 'object' ? data.config_json as Record<string, unknown> : {};
  const stored = config.multiple_vehicle_limits && typeof config.multiple_vehicle_limits === 'object'
    ? config.multiple_vehicle_limits as Record<string, unknown>
    : {};
  const maxAutos = Number(stored.max_autos ?? DEFAULT_MULTIPLE_CAPACITY.max_autos);
  const maxMotos = Number(stored.max_motos ?? DEFAULT_MULTIPLE_CAPACITY.max_motos);
  if (!Number.isInteger(maxAutos) || maxAutos < 0 || maxAutos > 20 || !Number.isInteger(maxMotos) || maxMotos < 0 || maxMotos > 20 || (maxAutos > 0 && maxMotos < 1)) {
    return DEFAULT_MULTIPLE_CAPACITY;
  }
  return { max_autos: maxAutos, max_motos: maxMotos };
}

// Active registered vehicles per cochera: a spot can hold several vehicles but
// only a limited number of them active at the same time.
async function activeCountsBySpot(db: { from(t: string): any }): Promise<Map<string, { autos: number; motos: number }>> {
  const { data, error } = await db.from('vehicles').select('spot_id, vehicle_type').eq('is_active', true).not('spot_id', 'is', null);
  if (error) throw error;
  const map = new Map<string, { autos: number; motos: number }>();
  for (const v of (data || []) as Array<{ spot_id?: string | null; vehicle_type?: string }>) {
    if (!v.spot_id) continue;
    const cur = map.get(String(v.spot_id)) || { autos: 0, motos: 0 };
    if (normalizeVehicleType(v.vehicle_type) === 'AUTO') cur.autos++; else cur.motos++;
    map.set(String(v.spot_id), cur);
  }
  return map;
}

function capacityAllows(
  cocheraType: unknown,
  limits: MultipleVehicleLimits,
  current: { autos: number; motos: number },
  vehicleType: unknown
): boolean {
  if (String(cocheraType || 'MULTIPLE').trim().toUpperCase() === 'INDIVIDUAL') {
    return current.autos + current.motos < 1;
  }
  return normalizeVehicleType(vehicleType) === 'AUTO' ? current.autos < limits.max_autos : current.motos < limits.max_motos;
}

// Returns an explanatory message when activating one more vehicle on a cochera
// would exceed its active capacity; null when there is room.
async function activeCapacityConflict(
  db: { from(t: string): any },
  spotId: string,
  vehicleType: unknown,
  excludeId?: string
): Promise<string | null> {
  const limits = await getMultipleVehicleLimits(db);
  const { data: spotRow } = await db.from('parking_spots').select('cochera_type').eq('id', spotId).maybeSingle();
  const { data: actives, error } = await db.from('vehicles').select('id, vehicle_type').eq('spot_id', spotId).eq('is_active', true);
  if (error) throw error;
  const current = { autos: 0, motos: 0 };
  for (const v of (actives || []) as Array<{ id: string; vehicle_type?: string }>) {
    if (excludeId && v.id === excludeId) continue;
    if (normalizeVehicleType(v.vehicle_type) === 'AUTO') current.autos++; else current.motos++;
  }
  if (capacityAllows(spotRow?.cochera_type, limits, current, vehicleType)) return null;
  const individual = String(spotRow?.cochera_type || 'MULTIPLE').trim().toUpperCase() === 'INDIVIDUAL';
  return individual
    ? 'La cochera es individual y ya tiene un vehículo activo. Desactiva el actual antes de activar otro.'
    : `La cochera ya alcanzó el máximo de vehículos activos (${limits.max_autos} auto(s), ${limits.max_motos} moto(s)). Desactiva uno antes de activar otro.`;
}

function normalizeOrientation(v: unknown): 'HORIZONTAL' | 'VERTICAL' {
  return String(v || '').trim().toUpperCase() === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';
}

async function departmentOfUser(
  db: { from(t: string): any },
  userId: string,
  authUser: { id: string; email?: string } | null,
  profile: { id: string; email?: string; document_number?: string | null; is_superadmin?: boolean } | null
): Promise<string | null> {
  const userIds = [...new Set([userId, profile?.id].filter(Boolean))];
  // Older resident links may use the global profile id instead of auth.uid().
  const { data: byUser } = await db.from('residents').select('department_id').in('user_id', userIds).limit(1).maybeSingle();
  if (byUser?.department_id) return String(byUser.department_id);

  // 2) Match by global user profile (email/document) so owners registered by
  //    document/email without a user link still resolve their department.
  const email = String(profile?.email || authUser?.email || '').toLowerCase();
  const documentNumber = profile?.document_number || null;

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

function normalizeLicensePlate(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseImportedSpotType(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return 'PROPIO';
  const normalized = raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return SPOT_TYPES.includes(normalized) ? normalized : null;
}

function parseImportedCocheraType(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return 'MULTIPLE';
  const normalized = raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'INDIVIDUAL' || normalized === 'I') return 'INDIVIDUAL';
  if (normalized === 'MULTIPLE' || normalized === 'MULTIPLES' || normalized === 'M') return 'MULTIPLE';
  return null;
}

function normalizeParkingSpotNumber(value: unknown): string | null {
  const raw = String(value ?? '').trim().replace(/^cochera\s*/i, '');
  if (!/^\d{1,3}$/.test(raw)) return null;
  const number = Number(raw);
  return number > 0 && number <= 999 ? String(number).padStart(3, '0') : null;
}

const COCHERA_TYPES = ['INDIVIDUAL', 'MULTIPLE'];

function normalizeCocheraType(v: unknown): string {
  const t = String(v || 'MULTIPLE').trim().toUpperCase();
  return COCHERA_TYPES.includes(t) ? t : 'MULTIPLE';
}

function normalizeVehicleType(v: unknown): string {
  const t = String(v || 'AUTO').trim().toUpperCase();
  return VEHICLE_TYPES.includes(t) ? t : 'AUTO';
}

// Resolves the caller's condominium roles with a single tenant + tenant_users
// lookup (previously each role check repeated both queries, plus its own auth
// round-trip and profile read).
async function resolveTenantRoles(
  client: ReturnType<typeof createAdminClient>,
  schemaName: string,
  identity: { id: string; email?: string } | null,
  profile: { id: string; is_superadmin?: boolean } | null
): Promise<{ isAdmin: boolean; isSecurity: boolean }> {
  if (!identity) return { isAdmin: false, isSecurity: false };
  if (profile?.is_superadmin) return { isAdmin: true, isSecurity: false };
  try {
    const { data: t } = await client.database.from('tenants').select('id').eq('schema_name', schemaName).single();
    const tenantId = t?.id;
    if (!tenantId) return { isAdmin: false, isSecurity: false };

    const userIds = [...new Set([identity.id, profile?.id].filter(Boolean))];
    const { data: rows } = await client.database.from('tenant_users')
      .select('role')
      .in('user_id', userIds)
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE');
    const roleList = (rows || []).map((r: { role?: string }) => String(r.role || ''));
    return {
      isAdmin: roleList.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN'),
      isSecurity: roleList.some(r => r === 'SECURITY_AGENT' || r === 'SUPERVISOR')
    };
  } catch {
    return { isAdmin: false, isSecurity: false };
  }
}

async function authenticatedIdentity(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return null;
  try {
    const userClient = createClient({ baseUrl: Deno.env.get('INSFORGE_BASE_URL'), accessToken: auth });
    const { data } = await userClient.auth.getCurrentUser();
    const user = data?.user;
    return user?.id ? { id: user.id, email: user.email || undefined } : null;
  } catch { return null; }
}

async function globalProfileForAuthUser(
  client: ReturnType<typeof createAdminClient>,
  authUser: { id: string; email?: string }
): Promise<{ id: string; email?: string; document_number?: string | null; is_superadmin?: boolean } | null> {
  const { data: byId } = await client.database.from('users_global')
    .select('id, email, document_number, is_superadmin')
    .eq('id', authUser.id)
    .maybeSingle();
  if (byId) return byId as { id: string; email?: string; document_number?: string | null; is_superadmin?: boolean };
  if (!authUser.email) return null;
  const { data: byEmail } = await client.database.from('users_global')
    .select('id, email, document_number, is_superadmin')
    .ilike('email', authUser.email)
    .limit(1)
    .maybeSingle();
  return byEmail as { id: string; email?: string; document_number?: string | null; is_superadmin?: boolean } | null;
}

function forbidden(): Response {
  return json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' } }, 403);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
