import { useState, useCallback } from 'react';
import { useParking } from '../hooks/useParking';
import { PlateScanner } from './PlateScanner';
import { recognizePlate, type ScanBox } from '../../../lib/plateOcr';
import type { PlateStatus, GuardGateSession, Vehicle, VehicleType } from '../types';

interface Props {
  schemaName?: string;
  guardGate: GuardGateSession | null;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${d.toLocaleDateString('es-PE')}, ${hh}:${mm} ${ap}`;
}

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = { AUTO: 'Auto', MOTO: 'Moto' };

export function ParkingGaritaPanel({ schemaName, guardGate }: Props) {
  const { searchPlates, plateStatus, registerEntry, registerExit, updateVehicleDriver } = useParking();
  const [plate, setPlate] = useState('');
  const [results, setResults] = useState<Vehicle[]>([]);
  const [searchDone, setSearchDone] = useState(false);
  const [vehicleType, setVehicleType] = useState<VehicleType>('AUTO');
  const [driverName, setDriverName] = useState('');
  const [status, setStatus] = useState<PlateStatus | null>(null);
  const [spotOverride, setSpotOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState<'enter' | 'exit' | null>(null);
  const [savingDriver, setSavingDriver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizePlate = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

  // Partial search: lists matching plates, user then picks one
  const consult = useCallback(async (raw?: string) => {
    if (!schemaName) return;
    const query = normalizePlate(raw ?? plate);
    if (!query) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setStatus(null);
    setSpotOverride('');
    setDriverName('');
    try {
      const res = await searchPlates(schemaName, query);
      setResults(res);
      setSearchDone(true);
      if (res.length === 1) {
        await selectVehicle(res[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, plate, searchPlates]);

  const selectVehicle = async (v: Vehicle) => {
    if (!schemaName) return;
    setPlate(v.license_plate);
    setVehicleType(v.vehicle_type || 'AUTO');
    setDriverName(v.driver_name || '');
    setLoading(true);
    setError(null);
    setMessage(null);
    // Refetch full plate status for inside/outside + spot info
    const res = await plateStatus(schemaName, v.license_plate).catch(err => {
      setError(err instanceof Error ? err.message : 'Error al consultar placa');
      return null;
    });
    setLoading(false);
    if (res) {
      setStatus(res);
      if (res.driver_name) setDriverName(res.driver_name);
    }
  };

  const runOcr = async (dataUrl: string, box?: ScanBox) => {
    setOcrLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await recognizePlate(dataUrl, box);
      const candidates = res.candidates;
      let used = false;
      // Try each candidate against the registry; pick the first match.
      for (const c of candidates) {
        if (!schemaName) continue;
        const matches = await searchPlates(schemaName, c);
        if (matches.length > 0) {
          setPlate(c);
          setSearchDone(false);
          setStatus(null);
          setDriverName('');
          await consult(c);
          setMessage(`Placa reconocida: ${c}`);
          used = true;
          break;
        }
      }
      if (!used) {
        if (candidates.length > 0) {
          setPlate(candidates[0]);
          setSearchDone(false);
          setStatus(null);
          setDriverName('');
          await consult(candidates[0]);
          setMessage(`Placa leída: ${candidates[0]} — verifica en la lista y confirma el ingreso.`);
        } else {
          setError(`No se pudo reconocer una matrícula clara. Texto detectado: ${res.full_text.trim() || 'ninguno'} — ingrésala manualmente en el campo de búsqueda.`);
        }
      }
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Error al reconocer la placa'} — ingrésala manualmente.`);
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSaveDriver = async () => {
    if (!schemaName || !plate) return;
    setSavingDriver(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateVehicleDriver(schemaName, plate, driverName);
      if (updated) {
        // refresh status so the driver is updated in the log too
        if (status) setStatus(prev => prev ? { ...prev, vehicle: updated, driver_name: driverName } : prev);
        setMessage(`Conductor guardado para la matrícula ${plate}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el conductor');
    } finally {
      setSavingDriver(false);
    }
  };

  const handleEnter = async () => {
    if (!schemaName || !status) return;
    if (!guardGate) {
      setError('Debes seleccionar tu puerta de trabajo antes de registrar el ingreso.');
      return;
    }
    setBusy('enter');
    setError(null);
    setMessage(null);
    try {
      const res = await registerEntry(schemaName, {
        license_plate: status.license_plate,
        vehicle_type: vehicleType,
        driver_name: driverName || undefined,
        spot_id: spotOverride || undefined,
        gate_id: guardGate?.gate.id
      });
      setStatus(prev => prev ? { ...prev, inside: true, current_log: res.log, inside_spot: res.spot } : prev);
      setMessage(res.entry_gate
        ? `Ingreso registrado (${VEHICLE_TYPE_LABELS[vehicleType]}) en el estacionamiento ${res.spot.spot_number} por ${res.entry_gate.name} (${res.authorization})`
        : `Ingreso registrado en el estacionamiento ${res.spot.spot_number} (${res.authorization})`);
      setResults([]);
      setSearchDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar ingreso');
    } finally {
      setBusy(null);
    }
  };

  const handleExit = async () => {
    if (!schemaName || !status) return;
    setBusy('exit');
    setError(null);
    setMessage(null);
    try {
      const res = await registerExit(schemaName, {
        license_plate: status.license_plate,
        gate_id: guardGate?.gate.id
      });
      setStatus(prev => prev ? { ...prev, inside: false, current_log: res.log } : prev);
      setMessage(`Salida registrada${res.exit_gate ? ` por ${res.exit_gate.name}` : ''} · Estacionamiento ${status.inside_spot?.spot_number || ''}`);
      setResults([]);
      setSearchDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setBusy(null);
    }
  };

  if (!schemaName) return <div className="parking-panel"><div className="empty-state"><p>Seleccione un condominio para operar el estacionamiento.</p></div></div>;

  const showResults = searchDone && results.length > 0 && !status;
  const showEmpty = searchDone && results.length === 0 && !status;

  return (
    <div className="parking-panel">
      <div className="modules-header">
        <h4>Control de Estacionamiento</h4>
        {guardGate
          ? <small>Puerta en uso: <strong>{guardGate.gate.name}</strong></small>
          : <small className="text-muted">Sin puerta asignada. La entrada/salida quedará sin puerta registrada.</small>}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="parking-flow">
        <div className="parking-search">
          <div className="search-bar parking-plate-search">
          <span className="material-symbols-outlined search-icon">directions_car</span>
          <input
            type="text"
            placeholder="Buscar por matrícula (parcial) (ej: ABC, 123)"
            value={plate}
            onChange={e => { setPlate(e.target.value); setSearchDone(false); setStatus(null); }}
            onKeyDown={e => { if (e.key === 'Enter') void consult(); }}
          />
          <button className="btn-primary" onClick={() => void consult()} disabled={loading || ocrLoading}>
            <span className="material-symbols-outlined">{loading ? 'hourglass_top' : 'search'}</span>
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
          <button
            className="btn-edit"
            onClick={() => setScanOpen(true)}
            disabled={ocrLoading}
            title="Escanear matrícula con cámara"
          >
            <span className="material-symbols-outlined">{ocrLoading ? 'hourglass_top' : 'document_scanner'}</span>
            {ocrLoading ? 'Leyendo...' : 'Escanear'}
          </button>
        </div>
      </div>

      {showResults && (
        <div className="parking-results">
          <h4>Vehículos encontrados ({results.length})</h4>
          <div className="parking-results-list">
            {results.map(v => (
              <button key={v.id} className="parking-result-card" onClick={() => void selectVehicle(v)}>
                <span className="material-symbols-outlined">directions_car</span>
                <div>
                  <strong>{v.license_plate}</strong>
                  <small>{VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type} · {v.driver_name || <em>Sin conductor</em>} · {(v as Vehicle & { departments?: { department_number: string } }).departments?.department_number || 'General'}</small>
                </div>
                <span className={`status-badge ${(v as Vehicle & { inside?: boolean }).inside ? 'status-occupied' : 'status-vacant'}`}>
                  {(v as Vehicle & { inside?: boolean }).inside ? 'Dentro' : 'Fuera'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="empty-state">
          <p>No hay vehículos registrados con esa matrícula. Verifica la placa o escanéala.</p>
        </div>
      )}

      {status && (
        <>
        <div className={`parking-status ${status.inside ? 'parking-status-in' : 'parking-status-out'}`}>
          <div className="parking-status-head">
            <span className="material-symbols-outlined">{status.inside ? 'local_parking' : 'no_meeting_room'}</span>
            <div>
              <strong>{status.license_plate}</strong>
              <span>{status.inside ? 'Dentro del estacionamiento' : 'Fuera del estacionamiento'}</span>
            </div>
          </div>

          <div className="parking-status-grid">
            <div className="parking-status-cell"><label>Vehículo</label><span>
              {status.vehicle
                ? `${VEHICLE_TYPE_LABELS[status.vehicle.vehicle_type] || status.vehicle.vehicle_type} · ${[status.vehicle.brand, status.vehicle.model].filter(Boolean).join(' ') || 'Registrado'}${status.vehicle.color ? ` · ${status.vehicle.color}` : ''}`
                : `No registrado en el padrón · ${VEHICLE_TYPE_LABELS[vehicleType] || vehicleType}`}
            </span></div>
            <div className="parking-status-cell"><label>Conductor</label><span>{driverName || <span className="text-muted">Sin registrar</span>}</span></div>
            {status.inside && (
              <>
                <div className="parking-status-cell"><label>Estacionamiento</label><span>{status.inside_spot?.spot_number || '-'} ({status.inside_spot?.type || '-'})</span></div>
                <div className="parking-status-cell"><label>Ingresó</label><span>{fmtDateTime(status.current_log?.entry_time || null)}</span></div>
                <div className="parking-status-cell"><label>Por puerta</label><span>{status.entry_gate?.name || '-'}</span></div>
              </>
            )}
            {!status.inside && (
              <div className="parking-status-cell"><label>Visita/Alquilada libres</label><span>
                {[...status.visitor_spots, ...status.rented_spots].map(s => s.spot_number).join(', ') || 'Ninguna'}
              </span></div>
            )}
          </div>
        </div>

        <div className="parking-register">
          <h5>Registro de estacionamiento</h5>
          {status.inside ? (
            <button className="btn-danger" onClick={handleExit} disabled={busy !== null}>
              <span className="material-symbols-outlined">logout</span>
              {busy === 'exit' ? 'Registrando salida...' : 'Registrar salida'}
            </button>
          ) : (
            <>
              <div className="checkout-field">
                <label>Tipo de vehículo</label>
                <div className="checkout-chip-row">
                  {Object.entries(VEHICLE_TYPE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`checkout-chip ${vehicleType === key ? 'active' : ''}`}
                      onClick={() => setVehicleType(key as VehicleType)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="checkout-field">
                <label>Nombre del conductor{status.vehicle ? ' (registrado)' : ' (no registrado — puedes guardarlo)'}</label>
                <input
                  type="text"
                  value={driverName}
                  onChange={e => setDriverName(e.target.value)}
                  placeholder="Ej: Juan Pérez"
                  onKeyDown={e => { if (e.key === 'Enter' && !status.vehicle) void handleSaveDriver(); }}
                />
                {status.vehicle && (
                  <button className="btn-edit" onClick={handleSaveDriver} disabled={savingDriver}>
                    <span className="material-symbols-outlined">save</span> {savingDriver ? 'Guardando...' : 'Guardar conductor'}
                  </button>
                )}
              </div>
              {[...status.visitor_spots, ...status.rented_spots].length > 0 && (
                <div className="checkout-field">
                  <label>Estacionamiento (opcional)</label>
                  <div className="checkout-chip-grid">
                    <button
                      type="button"
                      className={`checkout-chip ${spotOverride === '' ? 'active' : ''}`}
                      onClick={() => setSpotOverride('')}
                    >
                      Automática
                    </button>
                    {status.visitor_spots.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className={`checkout-chip checkout-chip-wide ${spotOverride === s.id ? 'active' : ''}`}
                        onClick={() => setSpotOverride(s.id)}
                      >
                        <span className="checkout-chip-code">{s.spot_number}</span>
                        <span className="checkout-chip-name">Visita</span>
                      </button>
                    ))}
                    {status.rented_spots.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className={`checkout-chip checkout-chip-wide ${spotOverride === s.id ? 'active' : ''}`}
                        onClick={() => setSpotOverride(s.id)}
                      >
                        <span className="checkout-chip-code">{s.spot_number}</span>
                        <span className="checkout-chip-name">Alquilada</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn-primary" onClick={handleEnter} disabled={busy !== null}>
                <span className="material-symbols-outlined">login</span>
                {busy === 'enter' ? 'Registrando ingreso...' : 'Registrar ingreso'}
              </button>
            </>
          )}
        </div>
        </>
        )}
      </div>

      {scanOpen && (
        <PlateScanner
          onClose={() => setScanOpen(false)}
          onCapture={(d, b) => { setScanOpen(false); void runOcr(d, b); }}
        />
      )}
    </div>
  );
}