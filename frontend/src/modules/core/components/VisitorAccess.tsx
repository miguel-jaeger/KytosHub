import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { invokeFunction } from '../../../lib/insforge';
import { useVisitorAccess } from '../hooks/useVisitorAccess';
import { useUserRole } from '../../../hooks/useUserRole';
import type { Department, Floor, Tower, VisitorPackage, VisitorVisit, VehicleType } from '../types';

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ACTIVO: 'Activo',
  EXPIRADO: 'Expirado',
  CANCELADO: 'Cancelado'
};

const VEHICLE_LABELS: Record<VehicleType, string> = { AUTO: 'Auto', MOTO: 'Moto' };

function fmtDT(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${d.toLocaleDateString('es-PE')} ${hh}:${mm} ${ap}`;
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function VisitStatusBadge({ v }: { v: VisitorVisit }) {
  const now = Date.now();
  const status = v.status === 'PENDIENTE' && v.scheduled_end && new Date(v.scheduled_end).getTime() < now
    ? 'EXPIRADO'
    : v.status;
  const cls = status === 'ACTIVO'
    ? (v.inside ? 'status-occupied' : 'status-vacant')
    : status === 'PENDIENTE' ? 'status-warn' : status === 'CANCELADO' ? 'status-vacant' : 'status-late';
  return <span className={`status-badge ${cls}`}>{STATUS_LABELS[status] || status}</span>;
}

export function VisitorAccess({ schemaName }: { schemaName?: string }) {
  const role = useUserRole();
  const isOperator = role === 'admin' || role === 'super' || role === 'security';
  const { listVisits, createVisit, updateVisitStatus, listPackages, createPackage, updatePackage } = useVisitorAccess();

  const [visits, setVisits] = useState<VisitorVisit[]>([]);
  const [packages, setPackages] = useState<VisitorPackage[]>([]);
  const [tab, setTab] = useState<'visits' | 'packages'>('visits');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showVisitForm, setShowVisitForm] = useState(false);
  const [visitForm, setVisitForm] = useState({
    full_name: '',
    document_type: 'DNI',
    document_number: '',
    vehicle_plate: '',
    vehicle_type: 'AUTO' as VehicleType,
    scheduled_start: toLocal(new Date().toISOString()),
    scheduled_end: toLocal(new Date(Date.now() + 2 * 3600 * 1000).toISOString())
  });
  const [savingVisit, setSavingVisit] = useState(false);

  const [visitorTowerId, setVisitorTowerId] = useState('');
  const [visitorFloorId, setVisitorFloorId] = useState('');
  const [visitorDeptId, setVisitorDeptId] = useState('');
  const [towers, setTowers] = useState<Tower[]>([]);
  const [visitorFloors, setVisitorFloors] = useState<Floor[]>([]);
  const [visitorDepts, setVisitorDepts] = useState<Department[]>([]);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  const [showPackageForm, setShowPackageForm] = useState(false);
  const [packageForm, setPackageForm] = useState({ description: '', carrier: '' });
  const [savingPackage, setSavingPackage] = useState(false);

  const [qrVisit, setQrVisit] = useState<VisitorVisit | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const qrBusyRef = useRef(false);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [vs, pk] = await Promise.all([listVisits(schemaName), listPackages(schemaName)]);
      setVisits(vs);
      setPackages(pk);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el módulo de visitantes');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listVisits, listPackages]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!schemaName) return;
    invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } })
      .then(({ data }) => setTowers((data?.data || []).sort((a, b) => a.code.localeCompare(b.code))))
      .catch(() => {});
  }, [schemaName]);

  const loadVisitorFloors = async (tid: string) => {
    if (!schemaName) return;
    setLoadingStep('pisos');
    setVisitorFloors([]);
    setVisitorFloorId('');
    setVisitorDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', { method: 'POST', body: { action: 'list', schema_name: schemaName, tower_id: tid } });
      setVisitorFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } finally {
      setLoadingStep(null);
    }
  };

  const loadVisitorDepts = async (fid: string) => {
    if (!schemaName || !visitorTowerId) return;
    setLoadingStep('departamentos');
    setVisitorDepts([]);
    setVisitorDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', { method: 'POST', body: { action: 'list', schema_name: schemaName, tower_id: visitorTowerId, floor_id: fid } });
      setVisitorDepts((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } finally {
      setLoadingStep(null);
    }
  };

  const openQr = async (v: VisitorVisit) => {
    setQrVisit(v);
    setQrUrl('');
    setError(null);
    if (qrBusyRef.current) return;
    qrBusyRef.current = true;
    try {
      const url = await QRCode.toDataURL(`KYTOS:VISIT:${v.access_code}`, { width: 220, margin: 1 });
      setQrUrl(url);
    } catch {
      setQrUrl('');
    } finally {
      qrBusyRef.current = false;
    }
  };

  const handleCreateVisit = async () => {
    if (!schemaName) return;
    if (!visitForm.full_name.trim() || !visitForm.document_number.trim()) {
      alert('Indica el nombre y documento del visitante'); return;
    }
    if (new Date(visitForm.scheduled_end).getTime() <= new Date(visitForm.scheduled_start).getTime()) {
      alert('La hora de fin debe ser posterior al inicio'); return;
    }
    if (isOperator && !visitorDeptId) {
      alert('Selecciona el torre, piso y departamento al que visita'); return;
    }
    setSavingVisit(true);
    setError(null);
    try {
      await createVisit(schemaName, {
        department_id: isOperator ? visitorDeptId : undefined,
        full_name: visitForm.full_name.trim(),
        document_type: visitForm.document_type,
        document_number: visitForm.document_number.trim(),
        vehicle_plate: visitForm.vehicle_plate.trim() || undefined,
        vehicle_type: visitForm.vehicle_type,
        scheduled_start: new Date(visitForm.scheduled_start).toISOString(),
        scheduled_end: new Date(visitForm.scheduled_end).toISOString()
      });
      setMessage('Visita registrada');
      setShowVisitForm(false);
      setVisitForm({
        full_name: '', document_type: 'DNI', document_number: '',
        vehicle_plate: '', vehicle_type: 'AUTO',
        scheduled_start: toLocal(new Date().toISOString()),
        scheduled_end: toLocal(new Date(Date.now() + 2 * 3600 * 1000).toISOString())
      });
      setVisitorTowerId(''); setVisitorFloorId(''); setVisitorDeptId('');
      setVisitorFloors([]); setVisitorDepts([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingVisit(false);
    }
  };

  const handleVisitOp = async (v: VisitorVisit, op: 'confirm-entry' | 'confirm-exit' | 'cancel') => {
    if (!schemaName) return;
    const label = op === 'confirm-entry' ? 'confirmar el ingreso' : op === 'confirm-exit' ? 'confirmar la salida' : 'cancelar';
    if (!confirm(`¿${label.charAt(0).toUpperCase() + label.slice(1)} de ${v.full_name}?`)) return;
    setError(null);
    try {
      await updateVisitStatus(schemaName, v.id, op);
      setMessage(`Visita ${op === 'confirm-entry' ? 'ingresada' : op === 'confirm-exit' ? 'salida registrada' : 'cancelada'}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleCreatePackage = async () => {
    if (!schemaName) return;
    if (!packageForm.description.trim()) { alert('Indica la descripción del paquete'); return; }
    if (isOperator && !visitorDeptId) { alert('Selecciona el torre, piso y departamento'); return; }
    setSavingPackage(true);
    setError(null);
    try {
      await createPackage(schemaName, {
        department_id: isOperator ? visitorDeptId : undefined,
        description: packageForm.description.trim(),
        carrier: packageForm.carrier.trim() || undefined
      });
      setMessage('Paquete recibido en garita');
      setShowPackageForm(false);
      setPackageForm({ description: '', carrier: '' });
      setVisitorTowerId(''); setVisitorFloorId(''); setVisitorDeptId('');
      setVisitorFloors([]); setVisitorDepts([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingPackage(false);
    }
  };

  const handlePackageOp = async (p: VisitorPackage, op: 'notify' | 'deliver') => {
    if (!schemaName) return;
    const label = op === 'deliver' ? 'entregar' : 'marcar como notificado';
    if (!confirm(`¿${label.charAt(0).toUpperCase() + label.slice(1)} este paquete?`)) return;
    setError(null);
    try {
      await updatePackage(schemaName, p.id, op);
      setMessage(op === 'deliver' ? 'Paquete entregado' : 'Paquete notificado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  if (loading) return <div className="loading-message">Cargando visitantes...</div>;

  const q = search.trim().toLowerCase();
  const filteredVisits = visits.filter(v => {
    if (statusFilter && v.status !== statusFilter) return false;
    if (q && !(`${v.full_name} ${v.document_number} ${v.vehicle_plate || ''} ${v.access_code}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const openPackages = packages.filter(p => !p.delivered_at);
  const deliveredPackages = packages.filter(p => p.delivered_at);

  return (
    <div className="visitor-access">
      <div className="setup-tabs">
        <span className={tab === 'visits' ? 'active' : ''} onClick={() => setTab('visits')}>Visitas</span>
        <span className={tab === 'packages' ? 'active' : ''} onClick={() => setTab('packages')}>Paquetería y delivery</span>
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {tab === 'visits' && (
        <>
          <div className="panel-header">
            <div>
              <h3>Visitas anticipadas</h3>
              <small>Registra visitas por adelantado; en garita se confirma el ingreso/salida con el código o pase QR.</small>
            </div>
            <button onClick={() => setShowVisitForm(true)}>
              <span className="material-symbols-outlined">person_add</span> Registrar visita
            </button>
          </div>

          <div className="filter-bar">
            <div className="form-group">
              <label>Buscar</label>
              <input type="text" value={search} onChange={e => { setSearch(e.target.value); }} placeholder="Nombre, placa, documento o código..." />
            </div>
            <div className="form-group">
              <label>Estado</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="ACTIVO">Activo</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="EXPIRADO">Expirado</option>
              </select>
            </div>
            <div className="filter-actions">
              <button className="btn-cancel" onClick={() => { setSearch(''); setStatusFilter(''); }}>Limpiar</button>
            </div>
          </div>

          {filteredVisits.length === 0 ? (
            <div className="empty-state"><p>No hay visitas registradas.</p></div>
          ) : (
            <>
              <table className="residents-table residents-desktop">
                <thead>
                  <tr>
                    <th>Visitante</th>
                    <th>Documento</th>
                    <th>Vehículo</th>
                    <th>Departamento</th>
                    <th>Horario</th>
                    <th>Ingreso</th>
                    <th>Salida</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVisits.map(v => {
                    const canCancel = v.status === 'PENDIENTE' || v.status === 'ACTIVO';
                    return (
                      <tr key={v.id}>
                        <td><strong>{v.full_name}</strong><div className="text-muted">Código {v.access_code}</div></td>
                        <td>{v.document_type} {v.document_number}</td>
                        <td>{v.vehicle_plate || '-'} · {VEHICLE_LABELS[v.vehicle_type]}</td>
                        <td>{v.departments ? `${v.departments.department_number} (${v.departments.towers?.code || ''})` : 'General'}</td>
                        <td>{fmtDT(v.scheduled_start)}{v.scheduled_end ? ` → ${fmtDT(v.scheduled_end)}` : ''}</td>
                        <td>{fmtDT(v.entry_time)}</td>
                        <td>{fmtDT(v.exit_time)}</td>
                        <td><VisitStatusBadge v={v} /></td>
                        <td>
                          <div className="resident-row-actions">
                            <button className="btn-edit" onClick={() => void openQr(v)} title="Ver pase QR"><span className="material-symbols-outlined">qr_code_2</span></button>
                            {isOperator && v.status === 'PENDIENTE' && (
                              <button className="btn-primary" onClick={() => void handleVisitOp(v, 'confirm-entry')} title="Confirmar ingreso"><span className="material-symbols-outlined">login</span></button>
                            )}
                            {isOperator && v.status === 'ACTIVO' && v.inside && (
                              <button className="btn-danger" onClick={() => void handleVisitOp(v, 'confirm-exit')} title="Confirmar salida"><span className="material-symbols-outlined">logout</span></button>
                            )}
                            {canCancel && (
                              <button className="btn-cancel" onClick={() => void handleVisitOp(v, 'cancel')} title="Cancelar"><span className="material-symbols-outlined">cancel</span></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="residents-mobile-grid">
                {filteredVisits.map(v => (
                  <div key={v.id} className="resident-grid-card">
                    <div className="resident-grid-main">
                      <span className="resident-grid-name">{v.full_name} · <VisitStatusBadge v={v} /></span>
                      <span className="resident-grid-meta">Código {v.access_code} · {v.departments ? `Dpto ${v.departments.department_number}` : 'General'}</span>
                    </div>
                    <div className="resident-grid-fields">
                      <div className="resident-grid-line"><span className="resident-grid-label">Documento</span><span>{v.document_type} {v.document_number}</span></div>
                      <div className="resident-grid-line"><span className="resident-grid-label">Vehículo</span><span>{v.vehicle_plate || '-'} · {VEHICLE_LABELS[v.vehicle_type]}</span></div>
                      <div className="resident-grid-line"><span className="resident-grid-label">Horario</span><span>{fmtDT(v.scheduled_start)} → {fmtDT(v.scheduled_end)}</span></div>
                    </div>
                    <div className="resident-row-actions">
                      <button className="btn-edit" onClick={() => void openQr(v)}><span className="material-symbols-outlined">qr_code_2</span> Ver pase</button>
                      {isOperator && v.status === 'PENDIENTE' && <button className="btn-primary" onClick={() => void handleVisitOp(v, 'confirm-entry')}>Ingreso</button>}
                      {isOperator && v.status === 'ACTIVO' && v.inside && <button className="btn-danger" onClick={() => void handleVisitOp(v, 'confirm-exit')}>Salida</button>}
                      {(v.status === 'PENDIENTE' || v.status === 'ACTIVO') && <button className="btn-cancel" onClick={() => void handleVisitOp(v, 'cancel')}>Cancelar</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'packages' && (
        <>
          <div className="panel-header">
            <div>
              <h3>Paquetería y delivery</h3>
              <small>Registra la recepción en garita y la entrega al residente.</small>
            </div>
            <button onClick={() => setShowPackageForm(true)}>
              <span className="material-symbols-outlined">inventory_2</span> Recibir paquete
            </button>
          </div>

          <h4>En garita ({openPackages.length})</h4>
          {openPackages.length === 0 ? (
            <p className="text-muted">No hay paquetes sin entregar.</p>
          ) : (
            <table className="residents-table residents-desktop">
              <thead>
                <tr><th>Departamento</th><th>Descripción</th><th>Mensajería</th><th>Recibido</th><th>Notificado</th><th></th></tr>
              </thead>
              <tbody>
                {openPackages.map(p => (
                  <tr key={p.id}>
                    <td>{p.departments ? `${p.departments.department_number} (${p.departments.towers?.code || ''})` : 'General'}</td>
                    <td>{p.description}</td>
                    <td>{p.carrier || '-'}</td>
                    <td>{fmtDT(p.received_at)}</td>
                    <td>{p.notified ? 'Sí' : 'No'}</td>
                    <td>
                      <div className="resident-row-actions">
                        {!p.notified && <button className="btn-edit" onClick={() => void handlePackageOp(p, 'notify')}>Notificar</button>}
                        <button className="btn-primary" onClick={() => void handlePackageOp(p, 'deliver')}>Entregar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {deliveredPackages.length > 0 && (
            <>
              <h4>Entregados ({deliveredPackages.length})</h4>
              <table className="residents-table residents-desktop">
                <thead><tr><th>Departamento</th><th>Descripción</th><th>Recibido</th><th>Entregado</th></tr></thead>
                <tbody>
                  {deliveredPackages.map(p => (
                    <tr key={p.id}>
                      <td>{p.departments ? `${p.departments.department_number} (${p.departments.towers?.code || ''})` : 'General'}</td>
                      <td>{p.description}</td>
                      <td>{fmtDT(p.received_at)}</td>
                      <td>{fmtDT(p.delivered_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {showVisitForm && (
        <div className="modal-overlay" onClick={() => setShowVisitForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Registrar visita</h3>
                <p className="text-on-surface-variant">Los datos se usan para el pase QR y la validación en garita.</p>
              </div>
              <button className="modal-close" onClick={() => setShowVisitForm(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label>Nombre completo</label><input type="text" value={visitForm.full_name} onChange={e => setVisitForm({ ...visitForm, full_name: e.target.value })} placeholder="Juan Pérez" autoFocus /></div>
                <div className="form-group"><label>Tipo de documento</label>
                  <select value={visitForm.document_type} onChange={e => setVisitForm({ ...visitForm, document_type: e.target.value })}>
                    <option value="DNI">DNI</option><option value="CE">CE</option><option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
              </div>
              <div className="form-group"><label>Número de documento</label><input type="text" value={visitForm.document_number} onChange={e => setVisitForm({ ...visitForm, document_number: e.target.value })} placeholder="12345678" /></div>
              <div className="form-row">
                <div className="form-group"><label>Placa (opcional)</label><input type="text" value={visitForm.vehicle_plate} onChange={e => setVisitForm({ ...visitForm, vehicle_plate: e.target.value })} placeholder="ABC-123" /></div>
                <div className="form-group"><label>Tipo de vehículo</label>
                  <select value={visitForm.vehicle_type} onChange={e => setVisitForm({ ...visitForm, vehicle_type: e.target.value as VehicleType })}>
                    <option value="AUTO">Auto</option><option value="MOTO">Moto</option>
                  </select>
                </div>
              </div>
              {isOperator && (
                <div className="loan-department-picker">
                  <div className="checkout-field">
                    <label>1. Torre</label>
                    <div className="checkout-chip-grid checkout-chip-grid-towers">
                      {towers.map(t => (
                        <button key={t.id} type="button" className={`checkout-chip checkout-chip-wide ${visitorTowerId === t.id ? 'active' : ''}`} onClick={() => { setVisitorTowerId(t.id); setVisitorFloorId(''); setVisitorDeptId(''); setVisitorDepts([]); void loadVisitorFloors(t.id); }}>
                          <span className="checkout-chip-code">{t.code}</span>
                          {t.name !== t.code && <span className="checkout-chip-name">{t.name}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  {visitorTowerId !== '' && (
                    <div className="checkout-field">
                      <label>2. Piso</label>
                      {loadingStep === 'pisos' ? <span className="text-muted">Cargando pisos...</span> : (
                        <div className="checkout-chip-grid">
                          {visitorFloors.map(f => (
                            <button key={f.id} type="button" className={`checkout-chip ${visitorFloorId === f.id ? 'active' : ''}`} onClick={() => { setVisitorFloorId(f.id); setVisitorDeptId(''); void loadVisitorDepts(f.id); }}>{f.floor_number}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {visitorTowerId !== '' && visitorFloorId !== '' && (
                    <div className="checkout-field">
                      <label>3. Departamento</label>
                      {loadingStep === 'departamentos' ? <span className="text-muted">Cargando departamentos...</span> : (
                        <div className="checkout-chip-grid">
                          {visitorDepts.map(d => (
                            <button key={d.id} type="button" className={`checkout-chip checkout-chip-wide ${visitorDeptId === d.id ? 'active' : ''}`} onClick={() => setVisitorDeptId(d.id)}>{d.department_number}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="form-row">
                <div className="form-group"><label>Inicio de visita</label><input type="datetime-local" value={visitForm.scheduled_start} onChange={e => setVisitForm({ ...visitForm, scheduled_start: e.target.value })} /></div>
                <div className="form-group"><label>Fin de visita</label><input type="datetime-local" value={visitForm.scheduled_end} onChange={e => setVisitForm({ ...visitForm, scheduled_end: e.target.value })} /></div>
              </div>
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowVisitForm(false)}>Cancelar</button>
                <button onClick={handleCreateVisit} disabled={savingVisit}>{savingVisit ? 'Guardando...' : 'Registrar visita'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPackageForm && (
        <div className="modal-overlay" onClick={() => setShowPackageForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Recibir paquete</h3>
                <p className="text-on-surface-variant">Registra el paquete/delivery recibido en garita.</p>
              </div>
              <button className="modal-close" onClick={() => setShowPackageForm(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label>Descripción</label><input type="text" value={packageForm.description} onChange={e => setPackageForm({ ...packageForm, description: e.target.value })} placeholder="Ej: Caja mediana de Amazon" autoFocus /></div>
              <div className="form-group"><label>Mensajería (opcional)</label><input type="text" value={packageForm.carrier} onChange={e => setPackageForm({ ...packageForm, carrier: e.target.value })} placeholder="Ej: Glovo, Olva" /></div>
              {isOperator && (
                <div className="loan-department-picker">
                  <div className="checkout-field">
                    <label>Torre</label>
                    <div className="checkout-chip-grid checkout-chip-grid-towers">
                      {towers.map(t => (
                        <button key={t.id} type="button" className={`checkout-chip checkout-chip-wide ${visitorTowerId === t.id ? 'active' : ''}`} onClick={() => { setVisitorTowerId(t.id); setVisitorFloorId(''); setVisitorDeptId(''); setVisitorDepts([]); void loadVisitorFloors(t.id); }}>
                          <span className="checkout-chip-code">{t.code}</span>
                          {t.name !== t.code && <span className="checkout-chip-name">{t.name}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  {visitorTowerId !== '' && (
                    <div className="checkout-field">
                      <label>Piso</label>
                      <div className="checkout-chip-grid">
                        {visitorFloors.map(f => (
                          <button key={f.id} type="button" className={`checkout-chip ${visitorFloorId === f.id ? 'active' : ''}`} onClick={() => { setVisitorFloorId(f.id); setVisitorDeptId(''); void loadVisitorDepts(f.id); }}>{f.floor_number}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {visitorTowerId !== '' && visitorFloorId !== '' && (
                    <div className="checkout-field">
                      <label>Departamento</label>
                      <div className="checkout-chip-grid">
                        {visitorDepts.map(d => (
                          <button key={d.id} type="button" className={`checkout-chip checkout-chip-wide ${visitorDeptId === d.id ? 'active' : ''}`} onClick={() => setVisitorDeptId(d.id)}>{d.department_number}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowPackageForm(false)}>Cancelar</button>
                <button onClick={handleCreatePackage} disabled={savingPackage}>{savingPackage ? 'Guardando...' : 'Recibir paquete'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {qrVisit && (
        <div className="modal-overlay" onClick={() => setQrVisit(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div>
                <h3>Pase QR · {qrVisit.full_name}</h3>
                <p className="text-on-surface-variant">Código {qrVisit.access_code}</p>
              </div>
              <button className="modal-close" onClick={() => setQrVisit(null)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              {qrUrl ? (
                <img src={qrUrl} alt={`QR ${qrVisit.access_code}`} style={{ maxWidth: 220, background: '#fff', borderRadius: 8, padding: 8 }} />
              ) : (
                <p className="text-muted">Generando código QR...</p>
              )}
              <p className="resident-grid-line" style={{ justifyContent: 'center' }}>
                <span className="resident-grid-label" style={{ minWidth: 'auto' }}>{qrVisit.document_type} </span>
                <span>{qrVisit.document_number}</span>
              </p>
              <p className="text-muted">Depto {qrVisit.departments?.department_number || 'General'} · {VEHICLE_LABELS[qrVisit.vehicle_type]}{qrVisit.vehicle_plate ? ` · ${qrVisit.vehicle_plate}` : ''}</p>
              <p className="text-muted">{fmtDT(qrVisit.scheduled_start)} → {fmtDT(qrVisit.scheduled_end)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}