import { useState, useEffect, useRef, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { Department, Floor, ParkingSpot, Tower, Vehicle, VehicleType } from '../types';

const emptyVehicleForm = { license_plate: '', vehicle_type: 'AUTO' as VehicleType, driver_name: '', brand: '', model: '', color: '' };
const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = { AUTO: 'Auto', MOTO: 'Moto' };

export function ParkingVehiclesTab({ schemaName }: { schemaName?: string }) {
  const { listVehicles, createVehicle, updateVehicle, deleteVehicle, listSpots } = useParking();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [spotId, setSpotId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [spotSearch, setSpotSearch] = useState('');
  const [spotDropdownOpen, setSpotDropdownOpen] = useState(false);
  const spotPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (spotPickerRef.current && !spotPickerRef.current.contains(e.target as Node)) {
        setSpotDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [towers, setTowers] = useState<Tower[]>([]);

  const [vehPage, setVehPage] = useState(1);
  const [vehPerPage, setVehPerPage] = useState<number | 'all'>(10);

  const [plateFilter, setPlateFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [filterTowerId, setFilterTowerId] = useState('');
  const [filterFloorId, setFilterFloorId] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterFloors, setFilterFloors] = useState<Floor[]>([]);
  const [filterDepartments, setFilterDepartments] = useState<Department[]>([]);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [ve, sp] = await Promise.all([listVehicles(schemaName), listSpots(schemaName)]);
      setVehicles(ve);
      setSpots(sp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listVehicles, listSpots]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVehPage(1); }, [vehicles.length]);
  useEffect(() => { setVehPage(1); }, [plateFilter, driverFilter, filterTowerId, filterFloorId, filterDeptId]);

  const loadTowers = useCallback(async () => {
    if (!schemaName) return;
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      setTowers((data?.data || []).sort((a, b) => a.code.localeCompare(b.code)));
    } catch {}
  }, [schemaName]);

  useEffect(() => { void loadTowers(); }, [loadTowers]);

  const selectSpot = (id: string) => {
    setSpotId(id);
    const sp = spots.find(s => s.id === id);
    setDeptId(sp?.department_id || '');
    setSpotSearch(sp ? `Cochera ${sp.spot_number}` : '');
    setSpotDropdownOpen(false);
    // Conductor por defecto: el propietario del departamento dueño de la cochera.
    const owner = sp?.departments?.owner_name;
    if (owner && !vehicleForm.driver_name.trim()) {
      setVehicleForm(prev => prev.driver_name.trim() ? prev : { ...prev, driver_name: owner });
    }
  };

  const assignedSpots = spots.filter(s => s.department_id);
  const spotQuery = spotSearch.trim().toLowerCase();
  const filteredSpots = spotQuery
    ? assignedSpots.filter(s => s.spot_number.toLowerCase().includes(spotQuery) || String(s.spot_row ?? '').includes(spotQuery))
    : assignedSpots;

  const loadFilterFloors = async (tid: string) => {
    if (!schemaName) return;
    setFilterFloors([]);
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterDepartments([]);
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: tid }
      });
      setFilterFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } catch {}
  };

  const loadFilterDepartments = async (fid: string) => {
    if (!schemaName || !filterTowerId) return;
    setFilterDepartments([]);
    setFilterDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: filterTowerId, floor_id: fid }
      });
      setFilterDepartments((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } catch {}
  };

  const selectFilterTower = (id: string) => {
    setFilterTowerId(id);
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterDepartments([]);
    void loadFilterFloors(id);
  };

  const selectFilterFloor = (id: string) => {
    setFilterFloorId(id);
    setFilterDeptId('');
    void loadFilterDepartments(id);
  };

  const clearFilters = () => {
    setPlateFilter('');
    setDriverFilter('');
    setFilterTowerId('');
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterFloors([]);
    setFilterDepartments([]);
    setVehPage(1);
  };

  const handleVehicleSave = async () => {
    if (!schemaName || !vehicleForm.license_plate.trim()) { alert('Indica la placa'); return; }
    if (!editingVehicle && !deptId) { alert('Selecciona la cochera del vehículo'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        license_plate: vehicleForm.license_plate.trim().toUpperCase(),
        vehicle_type: vehicleForm.vehicle_type,
        driver_name: vehicleForm.driver_name.trim() || null,
        brand: vehicleForm.brand.trim() || null,
        model: vehicleForm.model.trim() || null,
        color: vehicleForm.color.trim() || null
      };
      if (editingVehicle) {
        await updateVehicle(schemaName, editingVehicle.id, payload);
        setMessage('Vehículo actualizado');
      } else {
        await createVehicle(schemaName, { ...payload, department_id: deptId });
        setMessage('Vehículo registrado a la cochera seleccionada');
      }
      setVehicleForm(emptyVehicleForm);
      setEditingVehicle(null);
      setShowVehicleForm(false);
      setSpotId('');
      setDeptId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const startVehicleEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setVehicleForm({ license_plate: v.license_plate, vehicle_type: v.vehicle_type || 'AUTO', driver_name: v.driver_name || '', brand: v.brand || '', model: v.model || '', color: v.color || '' });
    setShowVehicleForm(true);
  };

  const closeForm = () => {
    setShowVehicleForm(false);
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm);
    setSpotId('');
    setDeptId('');
  };

  const handleVehicleDelete = async (v: Vehicle) => {
    if (!schemaName) return;
    if (!confirm(`¿Eliminar el vehículo ${v.license_plate}?`)) return;
    try {
      await deleteVehicle(schemaName, v.id);
      setMessage('Vehículo eliminado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  if (loading) return <div className="loading-message">Cargando vehículos...</div>;

  const qPlate = plateFilter.trim().toLowerCase();
  const qDriver = driverFilter.trim().toLowerCase();
  const filterFloorNumber = filterFloors.find(f => f.id === filterFloorId)?.floor_number;
  const filteredVehicles = vehicles.filter(v => {
    if (qPlate && !v.license_plate.toLowerCase().includes(qPlate)) return false;
    if (qDriver && !(v.driver_name || '').toLowerCase().includes(qDriver)) return false;
    if (filterTowerId && v.departments?.towers?.id !== filterTowerId) return false;
    if (filterFloorId && v.departments?.floor_number != null && v.departments.floor_number !== filterFloorNumber) return false;
    if (filterDeptId && v.department_id !== filterDeptId) return false;
    return true;
  });

  const vehPageItems = vehPerPage === 'all' ? filteredVehicles : paginate(filteredVehicles, vehPage, vehPerPage).slice;

  return (
    <div>
      <div className="panel-header">
        <div>
          <h3>Vehículos registrados</h3>
          <small>Registra los vehículos de cada departamento para validar su ingreso/salida en garita.</small>
        </div>
        {!showVehicleForm && (
          <button onClick={() => { setShowVehicleForm(true); setEditingVehicle(null); setVehicleForm(emptyVehicleForm); }}>
            <span className="material-symbols-outlined">directions_car</span> Adicionar vehículo
          </button>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {showVehicleForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{editingVehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h3>
                <p className="text-on-surface-variant">{editingVehicle ? 'Solo editas los datos del vehículo.' : 'Selecciona la cochera a la que pertenece el vehículo (el departamento se carga de la cochera).'}</p>
              </div>
              <button className="modal-close" onClick={closeForm} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">

          {editingVehicle ? (
            <p className="cart-checkout-hint">Vehículo de : {editingVehicle.departments ? `${editingVehicle.departments.department_number} (T ${editingVehicle.departments.towers?.code || '-'})` : '-'} — solo editas los datos del vehículo.</p>
          ) : (
            <>
              <p className="cart-checkout-hint">Busca y selecciona la cochera del vehículo. El departamento se toma de la cochera y el nombre del conductor se rellena por defecto con el propietario de la cochera (puedes cambiarlo).</p>

              <div className="form-group">
                <label>Cochera del vehículo</label>
                <div className="search-bar condo-picker" ref={spotPickerRef}>
                  <input
                    type="text"
                    value={spotSearch}
                    placeholder="Buscar cochera (ej. 01, 3)..."
                    autoFocus
                    onFocus={() => setSpotDropdownOpen(true)}
                    onChange={e => { setSpotSearch(e.target.value); setSpotDropdownOpen(true); }}
                  />
                  {spotDropdownOpen && (
                    <div className="condo-picker-dropdown">
                      {filteredSpots.length === 0 ? (
                        <div className="condo-picker-empty">Sin resultados</div>
                      ) : (
                        filteredSpots.map(s => (
                          <button key={s.id} type="button" className={`condo-picker-item ${spotId === s.id ? 'selected' : ''}`} onClick={() => selectSpot(s.id)}>
                            <span className="material-symbols-outlined">local_parking</span>
                            <span>Cochera {s.spot_number}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {assignedSpots.length === 0 && (
                  <small className="text-muted">No hay cocheras asignadas a departamentos. Primero asigna la cochera a un departamento en la configuración del estacionamiento.</small>
                )}
              </div>

              {spotId && (() => {
                const sp = spots.find(s => s.id === spotId);
                return sp?.department_id ? (
                  <span className="checkout-hint-inline">Cochera {sp.spot_number} seleccionada.</span>
                ) : (
                  <span className="checkout-hint-inline">Cochera sin departamento asignado.</span>
                );
              })()}
            </>
          )}

          <div className="form-group">
              <label>Tipo de vehículo</label>
              <select value={vehicleForm.vehicle_type} onChange={e => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value as VehicleType })}>
                {Object.entries(VEHICLE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Placa</label>
              <input type="text" value={vehicleForm.license_plate} onChange={e => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} placeholder="ABC-123" />
            </div>
          <div className="form-row">
            <div className="form-group">
              <label>Conductor (dueño o responsable)</label>
              <input type="text" value={vehicleForm.driver_name} onChange={e => setVehicleForm({ ...vehicleForm, driver_name: e.target.value })} placeholder="Nombre de quien conduce normalmente" />
              <small className="text-muted">Se mostrará automáticamente en el registro de ingreso en garita.</small>
            </div>
            <div className="form-group"></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Marca</label>
              <input type="text" value={vehicleForm.brand} onChange={e => setVehicleForm({ ...vehicleForm, brand: e.target.value })} placeholder="Toyota" />
            </div>
            <div className="form-group">
              <label>Modelo</label>
              <input type="text" value={vehicleForm.model} onChange={e => setVehicleForm({ ...vehicleForm, model: e.target.value })} placeholder="Corolla" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Color</label>
              <input type="text" value={vehicleForm.color} onChange={e => setVehicleForm({ ...vehicleForm, color: e.target.value })} placeholder="Rojo" />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-cancel" onClick={closeForm}>Cancelar</button>
            <button onClick={handleVehicleSave} disabled={saving}>{saving ? 'Guardando...' : editingVehicle ? 'Guardar' : 'Registrar'}</button>
          </div>
            </div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div className="form-group">
          <label>Placa</label>
          <input type="text" value={plateFilter} onChange={e => setPlateFilter(e.target.value)} placeholder="ABC-123 o 123" />
        </div>
        <div className="form-group">
          <label>Conductor</label>
          <input type="text" value={driverFilter} onChange={e => setDriverFilter(e.target.value)} placeholder="Nombre" />
        </div>
        <div className="form-group">
          <label>Torre</label>
          <select value={filterTowerId} onChange={e => selectFilterTower(e.target.value)}>
            <option value="">Todas</option>
            {towers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Piso</label>
          <select value={filterFloorId} onChange={e => selectFilterFloor(e.target.value)} disabled={!filterTowerId}>
            <option value="">Todos</option>
            {filterFloors.map(f => <option key={f.id} value={f.id}>Piso {f.floor_number}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Departamento</label>
          <select value={filterDeptId} onChange={e => setFilterDeptId(e.target.value)} disabled={!filterFloorId}>
            <option value="">Todos</option>
            {filterDepartments.map(d => <option key={d.id} value={d.id}>{d.department_number}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn-cancel" onClick={clearFilters}>Limpiar</button>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="empty-state"><p>No hay vehículos registrados.</p></div>
      ) : filteredVehicles.length === 0 ? (
        <div className="empty-state"><p>No hay vehículos que coincidan con los filtros.</p></div>
      ) : (
        <table className="residents-table residents-desktop">
          <thead>
            <tr>
              <th>Placa</th>
              <th>Vehículo</th>
              <th>Conductor</th>
              <th>Color</th>
              <th>Departamento</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {vehPageItems.map(v => (
              <tr key={v.id}>
                <td><strong>{v.license_plate}</strong></td>
                <td>{(VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type)}{[v.brand, v.model].filter(Boolean).join(' ') ? ` · ${[v.brand, v.model].filter(Boolean).join(' ')}` : ''}</td>
                <td>{v.driver_name || <span className="text-muted">Sin conductor</span>}</td>
                <td>{v.color || '-'}</td>
                <td>{v.departments ? `${v.departments.department_number} (T${v.departments.towers?.code || '-'} · P${v.departments.floor_number ?? '-'})` : '-'}</td>
                <td><span className={`status-badge ${v.is_active ? 'status-occupied' : 'status-vacant'}`}>{v.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div className="resident-row-actions">
                    <button className="btn-edit" onClick={() => startVehicleEdit(v)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                    <button className="btn-edit" onClick={() => handleVehicleDelete(v)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PaginationBar total={filteredVehicles.length} page={vehPage} perPage={vehPerPage} onPageChange={setVehPage} onPerPageChange={(n) => { setVehPerPage(n); setVehPage(1); }} itemLabel="vehículo" />
    </div>
  );
}