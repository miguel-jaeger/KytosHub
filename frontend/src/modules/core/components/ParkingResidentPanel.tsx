import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import type { Department, Floor, ParkingLoan, ParkingSpot, RentalDurationUnit, Vehicle, VehicleType } from '../types';

interface TowerOption {
  id: string;
  code: string;
  name: string;
}

const emptyVehicleForm = { license_plate: '', vehicle_type: 'AUTO' as VehicleType, brand: '', model: '', color: '' };

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
  const { listSpots, listVehicles, listLoans, createVehicle, updateVehicle, createLoan, updateLoanStatus, deleteVehicle } = useParking();
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<ParkingLoan[]>([]);
  const [towers, setTowers] = useState<TowerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
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
      const payload = {
        license_plate: vehicleForm.license_plate.trim().toUpperCase(),
        vehicle_type: vehicleForm.vehicle_type,
        brand: vehicleForm.brand.trim() || null,
        model: vehicleForm.model.trim() || null,
        color: vehicleForm.color.trim() || null
      };
      if (editingVehicle) {
        await updateVehicle(schemaName, editingVehicle.id, payload);
        setMessage('Vehículo actualizado');
      } else {
        await createVehicle(schemaName, payload);
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

  const openVehicleForm = (v: Vehicle | null) => {
    setEditingVehicle(v);
    setVehicleForm(v
      ? { license_plate: v.license_plate, vehicle_type: v.vehicle_type || 'AUTO', brand: v.brand || '', model: v.model || '', color: v.color || '' }
      : emptyVehicleForm);
    setShowVehicleForm(true);
  };

  const closeVehicleForm = () => {
    setShowVehicleForm(false);
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm);
  };

  const handleLoanSave = async () => {
    if (!schemaName) return;
    if (!loanForm.spot_id) { alert('Selecciona la estacionamiento a prestar'); return; }
    if (!loanForm.occupant_name.trim() || !loanForm.occupant_document_number.trim()) {
      alert('Registra los datos de la persona a la que se prestará (nombre y documento)'); return;
    }
    if (!loanForm.borrower_vehicle_plate.trim()) {
      alert('Indica la placa del vehículo que usará la estacionamiento'); return;
    }
    const startMs = new Date(loanForm.start_time).getTime();
    const endMs = new Date(loanForm.end_time).getTime();
    if (!loanForm.start_time || !loanForm.end_time || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      alert('Indica la fecha y hora de inicio y de fin del préstamo'); return;
    }
    if (startMs < Date.now() - 60000) {
      alert('La fecha de inicio no puede ser anterior a la fecha actual'); return;
    }
    if (endMs <= startMs) {
      alert('La fecha y hora de fin debe ser posterior a la de inicio'); return;
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
      setMessage('Préstamo de estacionamiento solicitado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelLoan = async (loan: ParkingLoan) => {
    if (!schemaName) return;
    if (!confirm(`¿Cancelar el préstamo de la estacionamiento ${loan.spot_number || ''}?`)) return;
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
  const nowLocal = toLocalInput(new Date().toISOString());

  return (
    <div className="parking-resident">
      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="setup-tabs">
        <span className="active">Mi Estacionamiento</span>
      </div>

      <div className="cart-kpi-row">
        <div className="cart-kpi"><strong>{mySpots.length}</strong> estacionamiento(s) propia(s)</div>
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
        <div className="panel-header">
          <div>
            <h4>Mis vehículos</h4>
            <small>Puedes editar o eliminar los vehículos de tu departamento.</small>
          </div>
          <button onClick={() => openVehicleForm(null)}><span className="material-symbols-outlined">directions_car</span> Registrar vehículo</button>
        </div>
        {vehicles.length === 0 ? (
          <p className="text-muted">Aún no tienes vehículos registrados.</p>
        ) : (
          <>
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
                      <div className="resident-row-actions">
                        <button className="btn-edit" onClick={() => openVehicleForm(v)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                        <button className="btn-danger" onClick={async () => {
                          if (!confirm(`¿Eliminar ${v.license_plate}?`)) return;
                          try { await deleteVehicle(schemaName, v.id); setMessage('Vehículo eliminado'); await load(); }
                          catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
                        }} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="residents-mobile-grid">
              {vehicles.map(v => (
                <div key={v.id} className="resident-grid-card">
                  <div className="resident-grid-main">
                    <span className="resident-grid-name">{v.license_plate}</span>
                    <span className="resident-grid-meta">{(v.vehicle_type === 'MOTO' ? 'Moto' : 'Auto')} · {[v.brand, v.model].filter(Boolean).join(' ') || '-'}</span>
                  </div>
                  <div className="resident-grid-fields">
                    <div className="resident-grid-line"><span className="resident-grid-label">Color</span><span>{v.color || '-'}</span></div>
                    <div className="resident-grid-line"><span className="resident-grid-label">Estado</span><span className={v.is_active ? '' : 'text-muted'}>{v.is_active ? 'Activo' : 'Inactivo'}</span></div>
                  </div>
                  <div className="resident-row-actions">
                    <button className="btn-edit" onClick={() => openVehicleForm(v)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                    <button className="btn-danger" onClick={async () => {
                      if (!confirm(`¿Eliminar ${v.license_plate}?`)) return;
                      try { await deleteVehicle(schemaName, v.id); setMessage('Vehículo eliminado'); await load(); }
                      catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
                    }} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showVehicleForm && (
        <div className="modal-overlay" onClick={closeVehicleForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{editingVehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h3>
                <p className="text-on-surface-variant">{editingVehicle ? `Placa: ${editingVehicle.license_plate}` : 'Registra un vehículo para tu departamento.'}</p>
              </div>
              <button className="modal-close" onClick={closeVehicleForm} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Placa</label><input type="text" value={vehicleForm.license_plate} onChange={e => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} placeholder="ABC-123" autoFocus /></div>
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
                <button className="btn-cancel" onClick={closeVehicleForm}>Cancelar</button>
                <button onClick={handleVehicleSave} disabled={saving}>{saving ? 'Guardando...' : editingVehicle ? 'Guardar' : 'Registrar vehículo'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="cart-form">
        <div className="modules-header">
          <h4>Prestar mi estacionamiento</h4>
          {!showLoanForm && lendableSpots.length > 0 && (
            <button onClick={() => setShowLoanForm(true)}><span className="material-symbols-outlined">real_estate_agent</span> Prestar estacionamiento</button>
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
          <div className="modal-overlay" onClick={() => setShowLoanForm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3>Solicitar préstamo de estacionamiento</h3>
                  <p className="text-on-surface-variant">Cede temporalmente tu estacionamiento indicando quién la usará y la ventana de tiempo autorizada.</p>
                </div>
                <button className="modal-close" onClick={() => setShowLoanForm(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
              </div>
              <div className="modal-body">
                <div className="checkout-field">
                  <label>Estacionamiento a prestar</label>
                  {lendableSpots.length === 0 ? (
                    <span className="text-muted">No hay estacionamientos disponibles para prestar.</span>
                  ) : (
                    <div className="checkout-chip-grid checkout-chip-grid-towers">
                      {lendableSpots.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          className={`checkout-chip checkout-chip-wide ${loanForm.spot_id === s.id ? 'active' : ''}`}
                          onClick={() => setLoanForm({ ...loanForm, spot_id: s.id })}
                        >
                          Estacionamiento {s.spot_number}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

            <h4>Datos de la persona que recibirá la estacionamiento</h4>
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
                  {towers.length === 0 ? (
                    <span className="text-muted">No hay torres registradas.</span>
                  ) : (
                    <div className="checkout-chip-grid checkout-chip-grid-towers">
                      {towers.map(t => (
                        <button key={t.id} type="button" className={`checkout-chip checkout-chip-wide ${loanTowerId === t.id ? 'active' : ''}`} onClick={() => { setLoanTowerId(t.id); setLoanFloorId(''); setLoanTowerDeptId(''); void loadLoanFloors(t.id); }}>
                          <span className="checkout-chip-code">Torre {t.code}</span>
                          {t.name !== t.code && <span className="checkout-chip-name">{t.name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
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
            <div className="form-row">
              <div className="form-group">
                <label>Inicio</label>
                <input type="datetime-local" value={loanForm.start_time} min={nowLocal} onChange={e => setLoanForm({ ...loanForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Fin</label>
                <input type="datetime-local" value={loanForm.end_time} min={nowLocal} onChange={e => setLoanForm({ ...loanForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setShowLoanForm(false)}>Cancelar</button>
              <button onClick={handleLoanSave} disabled={saving}>{saving ? 'Guardando...' : 'Solicitar préstamo'}</button>
            </div>
              </div>
            </div>
          </div>
        )}

        {loans.length === 0 ? (
          <p className="text-muted">Aún no tienes préstamos de estacionamientos.</p>
        ) : (
          <>
          <table className="residents-table residents-desktop">
            <thead>
              <tr><th>Estacionamiento</th><th>Ocupante</th><th>Vehículo</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Estado</th><th></th></tr>
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

          <div className="residents-mobile-grid">
            {loans.map(l => (
              <div key={l.id} className="resident-grid-card">
                <div className="resident-grid-main">
                  <span className="resident-grid-name">Estacionamiento {l.spot_number || '-'}</span>
                  <span className="resident-grid-meta">{l.occupant_name || (l.borrower_vehicle_plate ? 'Visitante' : 'Dpto')}</span>
                </div>
                <div className="resident-grid-fields">
                  <div className="resident-grid-line"><span className="resident-grid-label">Vehículo</span><span>{(l.borrower_vehicle_type === 'MOTO' ? 'Moto' : l.borrower_vehicle_type === 'AUTO' ? 'Auto' : '')}{l.borrower_vehicle_plate ? ` · ${l.borrower_vehicle_plate}` : '-'}</span></div>
                  <div className="resident-grid-line"><span className="resident-grid-label">Inicio</span><span>{fmtDT(l.start_time)}</span></div>
                  <div className="resident-grid-line"><span className="resident-grid-label">Fin</span><span>{fmtDT(l.end_time)}</span></div>
                  <div className="resident-grid-line"><span className="resident-grid-label">Estado</span><span>{LOAN_STATUS_LABELS[l.status] || l.status}</span></div>
                </div>
                {(l.status === 'PENDIENTE' || l.status === 'ACTIVO') && (
                  <div className="resident-row-actions">
                    <button className="btn-cancel" onClick={() => handleCancelLoan(l)}>Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}