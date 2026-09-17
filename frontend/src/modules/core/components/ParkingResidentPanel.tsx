import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import type { Department, Floor, ParkingLoan, ParkingSpot, RentalDurationUnit, Vehicle, VehicleType } from '../types';

interface TowerOption {
  id: string;
  code: string;
  name: string;
}

const LOAN_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ACTIVO: 'Activo',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado'
};

function fmtDT(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${d.toLocaleDateString('es-PE')}, ${hh}:${mm} ${ap}`;
}

const toLocalInput = (iso: string): string => {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ParkingResidentPanel({ schemaName }: { schemaName?: string }) {
  const { listSpots, listVehicles, listLoans, createVehicle, createLoan, updateLoanStatus, deleteVehicle } = useParking();
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<ParkingLoan[]>([]);
  const [towers, setTowers] = useState<TowerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState({ license_plate: '', vehicle_type: 'AUTO' as VehicleType, brand: '', model: '', color: '' });
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [loanForm, setLoanForm] = useState({
    spot_id: '',
    occupant_name: '',
    occupant_document_type: 'DNI',
    occupant_document_number: '',
    borrower_vehicle_plate: '',
    borrower_vehicle_type: 'AUTO' as VehicleType,
    borrower_department_id: '',
    duration_unit: '',
    start_time: toLocalInput(''),
    end_time: toLocalInput(new Date(Date.now() + 24 * 3600 * 1000).toISOString())
  });
  const [loanTowerId, setLoanTowerId] = useState('');
  const [loanFloorId, setLoanFloorId] = useState('');
  const [loanTowerDeptId, setLoanTowerDeptId] = useState('');
  const [loanFloors, setLoanFloors] = useState<Floor[]>([]);
  const [loanDepts, setLoanDepts] = useState<Department[]>([]);
  const [loadingLoanStep, setLoadingLoanStep] = useState<string | null>(null);
  const [useDepartment, setUseDepartment] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [sp, ve, ln] = await Promise.all([
        listSpots(schemaName),
        listVehicles(schemaName),
        listLoans(schemaName)
      ]);
      setSpots(sp);
      setVehicles(ve);
      setLoans(ln);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listSpots, listVehicles, listLoans]);

  useEffect(() => { void load(); }, [load]);

  const loadTowers = useCallback(async () => {
    if (!schemaName) return;
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Array<{ id: string; code: string; name?: string }> | null }>('towers', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      setTowers((data?.data || []).map((t: { id: string; code: string; name?: string }) => ({ id: t.id, code: t.code, name: t.name || t.code })));
    } catch {}
  }, [schemaName]);

  useEffect(() => { void loadTowers(); }, [loadTowers]);

  const loadLoanFloors = async (towerId: string) => {
    if (!schemaName) return;
    setLoadingLoanStep('pisos');
    setLoanFloors([]);
    setLoanFloorId('');
    setLoanTowerDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: towerId }
      });
      setLoanFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } finally {
      setLoadingLoanStep(null);
    }
  };

  const loadLoanDepts = async (floorId: string) => {
    if (!schemaName) return;
    setLoadingLoanStep('departamentos');
    setLoanDepts([]);
    setLoanTowerDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: loanTowerId, floor_id: floorId }
      });
      setLoanDepts((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } finally {
      setLoadingLoanStep(null);
    }
  };

  const handleVehicleSave = async () => {
    if (!schemaName || !vehicleForm.license_plate.trim()) { alert('Indica la placa'); return; }
    setSaving(true);
    try {
      await createVehicle(schemaName, {
        license_plate: vehicleForm.license_plate.trim().toUpperCase(),
        vehicle_type: vehicleForm.vehicle_type,
        brand: vehicleForm.brand.trim() || null,
        model: vehicleForm.model.trim() || null,
        color: vehicleForm.color.trim() || null
      });
      setVehicleForm({ license_plate: '', vehicle_type: 'AUTO', brand: '', model: '', color: '' });
      setShowVehicleForm(false);
      setMessage('Vehículo registrado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleLoanSave = async () => {
    if (!schemaName) return;
    if (!loanForm.spot_id) { alert('Selecciona la bahía a prestar'); return; }
    if (!loanForm.occupant_name.trim() || !loanForm.occupant_document_number.trim()) {
      alert('Registra los datos de la persona a la que se prestará (nombre y documento)'); return;
    }
    if (!loanForm.borrower_vehicle_plate.trim()) {
      alert('Indica la placa del vehículo que usará la bahía'); return;
    }
    const effectiveDept = useDepartment ? loanTowerDeptId : loanForm.borrower_department_id;
    setSaving(true);
    try {
      await createLoan(schemaName, {
        spot_id: loanForm.spot_id,
        occupant_name: loanForm.occupant_name.trim(),
        occupant_document_type: loanForm.occupant_document_type,
        occupant_document_number: loanForm.occupant_document_number.trim(),
        borrower_vehicle_plate: loanForm.borrower_vehicle_plate.trim().toUpperCase(),
        borrower_vehicle_type: loanForm.borrower_vehicle_type,
        borrower_department_id: effectiveDept || undefined,
        duration_unit: (loanForm.duration_unit || undefined) as RentalDurationUnit | undefined,
        start_time: new Date(loanForm.start_time).toISOString(),
        end_time: new Date(loanForm.end_time).toISOString()
      });
      setShowLoanForm(false);
      setMessage('Préstamo de bahía solicitado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelLoan = async (loan: ParkingLoan) => {
    if (!schemaName) return;
    if (!confirm(`¿Cancelar el préstamo de la bahía ${loan.spot_number || ''}?`)) return;
    try {
      await updateLoanStatus(schemaName, loan.id, 'CANCELADO');
      setMessage('Préstamo cancelado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  if (loading) return <div className="loading-message">Cargando tu estacionamiento...</div>;
  if (!schemaName) return <div className="empty-state"><p>Selecciona tu condominio para gestionar tu estacionamiento.</p></div>;

  const mySpots = spots.filter(s => s.type === 'PROPIO');
  const lendableSpots = mySpots.filter(s => s.status === 'DISPONIBLE' && !s.inside);

  return (
    <div className="parking-resident">
      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="setup-tabs">
        <span className="active">Mi Estacionamiento</span>
      </div>

      <div className="cart-kpi-row">
        <div className="cart-kpi"><strong>{mySpots.length}</strong> bahía(s) propia(s)</div>
        <div className="cart-kpi cart-kpi-dispo"><strong>{vehicles.length}</strong> vehículo(s)</div>
        <div className="cart-kpi cart-kpi-prestado"><strong>{loans.filter(l => l.status === 'ACTIVO').length}</strong> préstamo(s) activo(s)</div>
      </div>

      {mySpots.length > 0 && (
        <div className="parking-spots-grid">
          {mySpots.map(s => (
            <div key={s.id} className={`parking-spot-card ${s.status === 'OCUPADO' ? 'parking-spot-occupied' : 'parking-spot-free'}`}>
              <span className="parking-spot-number">{s.spot_number}</span>
              <span className={`status-badge ${s.inside ? 'status-occupied' : 'status-vacant'}`}>{s.inside ? 'Ocupada ahora' : 'Disponible'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cart-form">
        <h4>Mis vehículos</h4>
        {vehicles.length === 0 ? (
          <p className="text-muted">Aún no tienes vehículos registrados.</p>
        ) : (
          <table className="residents-table residents-desktop">
            <thead>
              <tr><th>Placa</th><th>Vehículo</th><th>Color</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.id}>
                  <td><strong>{v.license_plate}</strong></td>
                  <td>{(v.vehicle_type === 'MOTO' ? 'Moto' : 'Auto')} · {[v.brand, v.model].filter(Boolean).join(' ') || '-'}</td>
                  <td>{v.color || '-'}</td>
                  <td><span className={`status-badge ${v.is_active ? 'status-occupied' : 'status-vacant'}`}>{v.is_active ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <button className="btn-cancel" onClick={async () => {
                      if (!confirm(`¿Eliminar ${v.license_plate}?`)) return;
                      try { await deleteVehicle(schemaName, v.id); setMessage('Vehículo eliminado'); await load(); }
                      catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
                    }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showVehicleForm ? (
          <div>
            <div className="form-row">
              <div className="form-group"><label>Placa</label><input type="text" value={vehicleForm.license_plate} onChange={e => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} placeholder="ABC-123" /></div>
              <div className="form-group"><label>Tipo de vehículo</label>
                <select value={vehicleForm.vehicle_type} onChange={e => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value as VehicleType })}>
                  <option value="AUTO">Auto</option>
                  <option value="MOTO">Moto</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Marca</label><input type="text" value={vehicleForm.brand} onChange={e => setVehicleForm({ ...vehicleForm, brand: e.target.value })} placeholder="Toyota" /></div>
              <div className="form-group"><label>Modelo</label><input type="text" value={vehicleForm.model} onChange={e => setVehicleForm({ ...vehicleForm, model: e.target.value })} placeholder="Corolla" /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Color</label><input type="text" value={vehicleForm.color} onChange={e => setVehicleForm({ ...vehicleForm, color: e.target.value })} placeholder="Rojo" /></div>
            </div>
            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setShowVehicleForm(false)}>Cancelar</button>
              <button onClick={handleVehicleSave} disabled={saving}>{saving ? 'Guardando...' : 'Registrar vehículo'}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowVehicleForm(true)}><span className="material-symbols-outlined">directions_car</span> Registrar vehículo</button>
        )}
      </div>

      <div className="cart-form">
        <div className="modules-header">
          <h4>Prestar mi bahía</h4>
          {!showLoanForm && lendableSpots.length > 0 && (
            <button onClick={() => setShowLoanForm(true)}><span className="material-symbols-outlined">real_estate_agent</span> Prestar bahía</button>
          )}
        </div>

        {lendableSpots.length === 0 && !showLoanForm && (
          <p className="text-muted">
            {mySpots.length === 0
              ? 'No tienes plazas asignadas aún. Si crees que esto es un error, contacta a la administración.'
              : 'No tienes plazas disponibles para prestar en este momento (todas están ocupadas o el préstamo está en curso).'}
          </p>
        )}

        {showLoanForm && (
          <div>
            <div className="form-group">
              <label>Bahía a prestar</label>
              <select value={loanForm.spot_id} onChange={e => setLoanForm({ ...loanForm, spot_id: e.target.value })}>
                <option value="">— Seleccionar —</option>
                {lendableSpots.map(s => <option key={s.id} value={s.id}>Bahía {s.spot_number}</option>)}
              </select>
            </div>

            <h4>Datos de la persona que recibirá la bahía</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Nombre completo</label>
                <input type="text" value={loanForm.occupant_name} onChange={e => setLoanForm({ ...loanForm, occupant_name: e.target.value })} placeholder="Nombre y apellido" />
              </div>
              <div className="form-group">
                <label>Tipo de documento</label>
                <select value={loanForm.occupant_document_type} onChange={e => setLoanForm({ ...loanForm, occupant_document_type: e.target.value })}>
                  <option value="DNI">DNI</option>
                  <option value="CE">CE</option>
                  <option value="PASAPORTE">Pasaporte</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Número de documento</label>
              <input type="text" value={loanForm.occupant_document_number} onChange={e => setLoanForm({ ...loanForm, occupant_document_number: e.target.value })} placeholder="12345678" />
            </div>

            <h4>Datos del vehículo</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Placa</label>
                <input type="text" value={loanForm.borrower_vehicle_plate} onChange={e => setLoanForm({ ...loanForm, borrower_vehicle_plate: e.target.value })} placeholder="ABC-123" />
              </div>
              <div className="form-group">
                <label>Tipo de vehículo</label>
                <select value={loanForm.borrower_vehicle_type} onChange={e => setLoanForm({ ...loanForm, borrower_vehicle_type: e.target.value as VehicleType })}>
                  <option value="AUTO">Auto</option>
                  <option value="MOTO">Moto</option>
                </select>
              </div>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={useDepartment} onChange={e => { setUseDepartment(e.target.checked); if (!e.target.checked) { setLoanForm(f => ({ ...f, borrower_department_id: '' })); } }} />
              <span>Vincular a un departamento del condominio (opcional)</span>
            </label>

            {useDepartment && (
              <div className="loan-department-picker">
                <div className="checkout-field">
                  <label>1. Torre</label>
                  <select value={loanTowerId} onChange={e => { setLoanTowerId(e.target.value); setLoanFloorId(''); setLoanTowerDeptId(''); void loadLoanFloors(e.target.value); }}>
                    <option value="">— Seleccionar torre —</option>
                    {towers.map(t => <option key={t.id} value={t.id}>Torre {t.code} - {t.name}</option>)}
                  </select>
                </div>
                {loanTowerId !== '' && (
                  <div className="checkout-field">
                    <label>2. Piso</label>
                    {loadingLoanStep === 'pisos' ? (
                      <span className="text-muted">Cargando pisos...</span>
                    ) : loanFloors.length === 0 ? (
                      <span className="text-muted">Esa torre no tiene pisos.</span>
                    ) : (
                      <div className="checkout-chip-grid">
                        {loanFloors.map(f => (
                          <button key={f.id} type="button" className={`checkout-chip ${loanFloorId === f.id ? 'active' : ''}`} onClick={() => { setLoanFloorId(f.id); setLoanTowerDeptId(''); void loadLoanDepts(f.id); }}>
                            {f.floor_number}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {loanTowerId !== '' && loanFloorId !== '' && (
                  <div className="checkout-field">
                    <label>3. Departamento</label>
                    {loadingLoanStep === 'departamentos' ? (
                      <span className="text-muted">Cargando departamentos...</span>
                    ) : loanDepts.length === 0 ? (
                      <span className="text-muted">Ese piso no tiene departamentos.</span>
                    ) : (
                      <div className="checkout-chip-grid">
                        {loanDepts.map(d => (
                          <button key={d.id} type="button" className={`checkout-chip ${loanTowerDeptId === d.id ? 'active' : ''}`} onClick={() => setLoanTowerDeptId(d.id)}>
                            {d.department_number}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <h4>Duración del préstamo</h4>
            <div className="form-group">
              <label>Registrar duración como</label>
              <select value={loanForm.duration_unit} onChange={e => setLoanForm({ ...loanForm, duration_unit: e.target.value })}>
                <option value="">Solo fechas (sin unidad)</option>
                <option value="HORAS">Horas</option>
                <option value="DIAS">Días</option>
                <option value="MESES">Meses</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Inicio</label>
                <input type="datetime-local" value={loanForm.start_time} onChange={e => setLoanForm({ ...loanForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Fin</label>
                <input type="datetime-local" value={loanForm.end_time} onChange={e => setLoanForm({ ...loanForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setShowLoanForm(false)}>Cancelar</button>
              <button onClick={handleLoanSave} disabled={saving}>{saving ? 'Guardando...' : 'Solicitar préstamo'}</button>
            </div>
          </div>
        )}

        {loans.length === 0 ? (
          <p className="text-muted">Aún no tienes préstamos de bahías.</p>
        ) : (
          <table className="residents-table residents-desktop">
            <thead>
              <tr><th>Bahía</th><th>Ocupante</th><th>Vehículo</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {loans.map(l => (
                <tr key={l.id}>
                  <td>{l.spot_number || '-'}</td>
                  <td>{l.occupant_name || (l.borrower_department ? `Dpto ${l.borrower_department.department_number} (T${l.borrower_department.tower_code || '-'})` : (l.borrower_vehicle_plate ? 'Visitante' : '-'))}</td>
                  <td>{(l.borrower_vehicle_type === 'MOTO' ? 'Moto' : l.borrower_vehicle_type === 'AUTO' ? 'Auto' : '')}{l.borrower_vehicle_plate ? ` · ${l.borrower_vehicle_plate}` : '-'}</td>
                  <td>{fmtDT(l.start_time)}</td>
                  <td>{fmtDT(l.end_time)}</td>
                  <td>{l.duration_unit ? l.duration_unit.toLowerCase() : '-'}</td>
                  <td><span className={`status-badge ${l.status === 'ACTIVO' ? 'status-occupied' : 'status-vacant'}`}>{LOAN_STATUS_LABELS[l.status] || l.status}</span></td>
                  <td>
                    {(l.status === 'PENDIENTE' || l.status === 'ACTIVO') && (
                      <button className="btn-cancel" onClick={() => handleCancelLoan(l)}>Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}