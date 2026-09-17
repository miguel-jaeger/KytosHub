import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { Vehicle } from '../types';

interface DepartmentOption {
  id: string;
  department_number: string;
  tower_code: string;
}

const emptyVehicleForm = { license_plate: '', brand: '', model: '', color: '' };

export function ParkingVehiclesTab({ schemaName }: { schemaName?: string }) {
  const parking = useParking();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const [vehPage, setVehPage] = useState(1);
  const [vehPerPage, setVehPerPage] = useState<number | 'all'>(10);

  const loadDepartments = useCallback(async () => {
    if (!schemaName) return;
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Array<{ id: string; department_number: string; tower_id: string }> | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      const { data: towers } = await invokeFunction<{ success: boolean; data: Array<{ id: string; code: string }> | null }>('towers', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      const towerMap = new Map((towers?.data || []).map((t: { id: string; code: string }) => [t.id, t.code]));
      setDepartments((data?.data || []).map((d: { id: string; department_number: string; tower_id: string }) => ({
        id: d.id,
        department_number: d.department_number,
        tower_code: towerMap.get(d.tower_id) || ''
      })).sort((a, b) => a.tower_code.localeCompare(b.tower_code) || a.department_number.localeCompare(b.department_number)));
    } catch {}
  }, [schemaName]);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const ve = await parking.listVehicles(schemaName, deptFilter ? { department_id: deptFilter } : {});
      setVehicles(ve);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, parking, deptFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDepartments(); }, [loadDepartments]);
  useEffect(() => { setVehPage(1); }, [vehicles.length]);

  const handleVehicleSave = async () => {
    if (!schemaName || !vehicleForm.license_plate.trim()) { alert('Indica la placa'); return; }
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
        await parking.updateVehicle(schemaName, editingVehicle.id, payload);
        setMessage('Vehículo actualizado');
      } else {
        const chosenDept = deptFilter || departments[0]?.id;
        if (!chosenDept) { alert('Selecciona un departamento'); return; }
        await parking.createVehicle(schemaName, { ...payload, department_id: chosenDept });
        setMessage('Vehículo registrado');
      }
      setVehicleForm(emptyVehicleForm);
      setEditingVehicle(null);
      setShowVehicleForm(false);
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

  const handleVehicleDelete = async (v: Vehicle) => {
    if (!schemaName) return;
    if (!confirm(`¿Eliminar el vehículo ${v.license_plate}?`)) return;
    try {
      await parking.deleteVehicle(schemaName, v.id);
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setVehPage(1); }} style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid #c6c6cd' }}>
            <option value="">Todos los departamentos</option>
            {departments.map(d => <option key={d.id} value={d.id}>Dpto {d.department_number} (T{d.tower_code})</option>)}
          </select>
          {!showVehicleForm && (
            <button onClick={() => { setShowVehicleForm(true); setEditingVehicle(null); setVehicleForm(emptyVehicleForm); }}>
              <span className="material-symbols-outlined">directions_car</span> Adicionar vehículo
            </button>
          )}
        </div>
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {showVehicleForm && (
        <div className="cart-form">
          <h4>{editingVehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h4>
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
          {!editingVehicle && (
            <div className="form-group">
              <label>Departamento</label>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.department_number} (Torre {d.tower_code})</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => { setShowVehicleForm(false); setEditingVehicle(null); setVehicleForm(emptyVehicleForm); }}>Cancelar</button>
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