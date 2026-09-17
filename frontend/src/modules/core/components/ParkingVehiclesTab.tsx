import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { Department, Floor, Tower, Vehicle } from '../types';

const emptyVehicleForm = { license_plate: '', brand: '', model: '', color: '' };

export function ParkingVehiclesTab({ schemaName }: { schemaName?: string }) {
  const { listVehicles, createVehicle, updateVehicle, deleteVehicle } = useParking();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [towers, setTowers] = useState<Tower[]>([]);
  const [towerId, setTowerId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  const [vehPage, setVehPage] = useState(1);
  const [vehPerPage, setVehPerPage] = useState<number | 'all'>(10);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const ve = await listVehicles(schemaName);
      setVehicles(ve);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listVehicles]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVehPage(1); }, [vehicles.length]);

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

  const loadFloors = async (tid: string) => {
    if (!schemaName) return;
    setLoadingStep('pisos');
    setFloors([]);
    setFloorId('');
    setDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: tid }
      });
      setFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } finally {
      setLoadingStep(null);
    }
  };

  const loadDepartments = async (fid: string) => {
    if (!schemaName) return;
    setLoadingStep('departamentos');
    setDepartments([]);
    setDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: towerId, floor_id: fid }
      });
      setDepartments((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } finally {
      setLoadingStep(null);
    }
  };

  const selectedTower = towers.find(t => t.id === towerId);
  const selectedFloor = floors.find(f => f.id === floorId);
  const selectedDepartment = departments.find(d => d.id === deptId);

  const selectTower = (id: string) => {
    setTowerId(id);
    setFloorId('');
    setDeptId('');
    void loadFloors(id);
  };

  const selectFloor = (id: string) => {
    setFloorId(id);
    setDeptId('');
    void loadDepartments(id);
  };

  const handleVehicleSave = async () => {
    if (!schemaName || !vehicleForm.license_plate.trim()) { alert('Indica la placa'); return; }
    if (!editingVehicle && !deptId) { alert('Selecciona el torre, piso y departamento del vehículo'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        license_plate: vehicleForm.license_plate.trim().toUpperCase(),
        brand: vehicleForm.brand.trim() || null,
        model: vehicleForm.model.trim() || null,
        color: vehicleForm.color.trim() || null
      };
      if (editingVehicle) {
        await updateVehicle(schemaName, editingVehicle.id, payload);
        setMessage('Vehículo actualizado');
      } else {
        await createVehicle(schemaName, { ...payload, department_id: deptId });
        setMessage('Vehículo registrado');
      }
      setVehicleForm(emptyVehicleForm);
      setEditingVehicle(null);
      setShowVehicleForm(false);
      setTowerId('');
      setFloorId('');
      setDeptId('');
      setFloors([]);
      setDepartments([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const startVehicleEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setVehicleForm({ license_plate: v.license_plate, brand: v.brand || '', model: v.model || '', color: v.color || '' });
    setShowVehicleForm(true);
  };

  const closeForm = () => {
    setShowVehicleForm(false);
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm);
    setTowerId('');
    setFloorId('');
    setDeptId('');
    setFloors([]);
    setDepartments([]);
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

  const vehPageItems = vehPerPage === 'all' ? vehicles : paginate(vehicles, vehPage, vehPerPage).slice;

  return (
    <div>
      <div className="header">
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
        <div className="cart-form">
          <h4>{editingVehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h4>

          {editingVehicle ? (
            <p className="cart-checkout-hint">Vehículo de : {editingVehicle.departments ? `${editingVehicle.departments.department_number} (T ${editingVehicle.departments.towers?.code || '-'})` : '-'} — solo editas los datos del vehículo.</p>
          ) : (
            <>
              <p className="cart-checkout-hint">Selecciona primero el torre, piso y departamento al que pertenece el vehículo.</p>

              <div className="checkout-field">
                <label>1. Torre</label>
                {towers.length === 0 ? (
                  <span className="text-muted">No hay torres registradas.</span>
                ) : (
                  <div className="checkout-chip-row">
                    {towers.map(t => (
                      <button key={t.id} type="button" className={`checkout-chip ${towerId === t.id ? 'active' : ''}`} onClick={() => selectTower(t.id)}>
                        <span className="checkout-chip-code">{t.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {towerId !== '' && (
                <div className="checkout-field">
                  <label>2. Piso</label>
                  {loadingStep === 'pisos' ? (
                    <span className="text-muted">Cargando pisos...</span>
                  ) : floors.length === 0 ? (
                    <span className="text-muted">Esa torre no tiene pisos.</span>
                  ) : (
                    <div className="checkout-chip-grid">
                      {floors.map(f => (
                        <button key={f.id} type="button" className={`checkout-chip ${floorId === f.id ? 'active' : ''}`} onClick={() => selectFloor(f.id)}>
                          {f.floor_number}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {towerId !== '' && floorId !== '' && (
                <div className="checkout-field">
                  <label>3. Departamento</label>
                  {loadingStep === 'departamentos' ? (
                    <span className="text-muted">Cargando departamentos...</span>
                  ) : departments.length === 0 ? (
                    <span className="text-muted">Ese piso no tiene departamentos.</span>
                  ) : (
                    <div className="checkout-chip-grid">
                      {departments.map(d => (
                        <button
                          key={d.id}
                          type="button"
                          className={`checkout-chip checkout-chip-wide ${deptId === d.id ? 'active' : ''}`}
                          onClick={() => setDeptId(d.id)}
                        >
                          {d.department_number}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedTower && selectedFloor && deptId && (
                    <span className="checkout-hint-inline">
                      Torre {selectedTower.code} · Piso {selectedFloor.floor_number} · Dpto {selectedDepartment?.department_number}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Placa</label>
              <input type="text" value={vehicleForm.license_plate} onChange={e => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} placeholder="ABC-123" autoFocus />
            </div>
            <div className="form-group">
              <label>Marca</label>
              <input type="text" value={vehicleForm.brand} onChange={e => setVehicleForm({ ...vehicleForm, brand: e.target.value })} placeholder="Toyota" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Modelo</label>
              <input type="text" value={vehicleForm.model} onChange={e => setVehicleForm({ ...vehicleForm, model: e.target.value })} placeholder="Corolla" />
            </div>
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
      )}

      {vehicles.length === 0 ? (
        <div className="empty-state"><p>No hay vehículos registrados.</p></div>
      ) : (
        <table className="residents-table residents-desktop">
          <thead>
            <tr>
              <th>Placa</th>
              <th>Vehículo</th>
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
                <td>{[v.brand, v.model].filter(Boolean).join(' ') || '-'}</td>
                <td>{v.color || '-'}</td>
                <td>{v.departments ? `${v.departments.department_number} (T${v.departments.towers?.code || '-'})` : '-'}</td>
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
      <PaginationBar total={vehicles.length} page={vehPage} perPage={vehPerPage} onPageChange={setVehPage} onPerPageChange={(n) => { setVehPerPage(n); setVehPage(1); }} itemLabel="vehículo" />
    </div>
  );
}