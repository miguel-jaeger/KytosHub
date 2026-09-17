import { useState, useCallback, useEffect, useRef } from 'react';
import { useParking } from '../hooks/useParking';
import { ParkingMap } from './ParkingMap';
import type { ParkingLayout, ParkingSpot, PlateStatus, GuardGateSession, VehicleType } from '../types';

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
  const { listSpots, getLayout, plateStatus, registerEntry, registerExit, ocrPlate, ocrConfigured } = useParking();
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [layout, setLayout] = useState<ParkingLayout | null>(null);
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('AUTO');
  const [driverName, setDriverName] = useState('');
  const [status, setStatus] = useState<PlateStatus | null>(null);
  const [spotOverride, setSpotOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrReady, setOcrReady] = useState(false);
  const [busy, setBusy] = useState<'enter' | 'exit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMap = useCallback(async () => {
    if (!schemaName) return;
    try {
      const [sp, ly] = await Promise.all([listSpots(schemaName), getLayout(schemaName)]);
      setSpots(sp);
      setLayout(ly);
    } catch {}
  }, [schemaName, listSpots, getLayout]);

  useEffect(() => { void loadMap(); }, [loadMap]);

  // Hide the scan button until the OCR module (Google Vision key) is configured
  useEffect(() => {
    let cancelled = false;
    ocrConfigured().then(ok => { if (!cancelled) setOcrReady(ok); }).catch(() => { if (!cancelled) setOcrReady(false); });
    return () => { cancelled = true; };
  }, [ocrConfigured]);

  const normalizePlate = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

  const consult = useCallback(async (raw?: string) => {
    if (!schemaName) return;
    const plateValue = normalizePlate(raw ?? plate);
    if (!plateValue) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setStatus(null);
    setSpotOverride('');
    try {
      const res = await plateStatus(schemaName, plateValue);
      setStatus(res);
      if (res.vehicle?.vehicle_type) setVehicleType(res.vehicle.vehicle_type);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al consultar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, plate, plateStatus]);

  const handleScan = async (file: File | null) => {
    if (!file) return;
    setOcrLoading(true);
    setError(null);
    setMessage(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        try {
          const res = await ocrPlate(dataUrl);
          if (res.plate) {
            setPlate(res.plate.toUpperCase());
            await consult(res.plate.toUpperCase());
            setMessage(`Placa reconocida: ${res.plate.toUpperCase()}`);
          } else {
            setError(`No se pudo reconocer una matrícula clara. Texto detectado: ${res.full_text.trim() || 'ninguno'} — ingrésala manualmente.`);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error al reconocer la placa');
        } finally {
          setOcrLoading(false);
        }
      };
      reader.onerror = () => { setOcrLoading(false); setError('No se pudo leer la imagen'); };
      reader.readAsDataURL(file);
    } catch (err) {
      setOcrLoading(false);
      setError(err instanceof Error ? err.message : 'Error al leer la imagen');
    }
  };

  const handleEnter = async () => {
    if (!schemaName || !status) return;
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
      setMessage(`Ingreso registrado (${VEHICLE_TYPE_LABELS[vehicleType]}) en bahía ${res.spot.spot_number}${res.entry_gate ? ` por ${res.entry_gate.name}` : ''} (${res.authorization})`);
      await loadMap();
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
      setMessage(`Salida registrada${res.exit_gate ? ` por ${res.exit_gate.name}` : ''} · Bahía ${status.inside_spot?.spot_number || ''}`);
      await loadMap();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar salida');
    } finally {
      setBusy(null);
    }
  };

  if (!schemaName) return <div className="parking-panel"><div className="empty-state"><p>Seleccione un condominio para operar el estacionamiento.</p></div></div>;

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

      <div className="parking-search">
        <div className="search-bar parking-plate-search">
          <span className="material-symbols-outlined search-icon">directions_car</span>
          <input
            type="text"
            placeholder="Ingresar placa manualmente (ej: ABC-123)"
            value={plate}
            onChange={e => setPlate(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void consult(); }}
          />
          <button className="btn-primary" onClick={() => void consult()} disabled={loading || ocrLoading}>
            {loading ? 'Consultando...' : 'Consultar'}
          </button>
          {ocrReady && (
            <button
              className="btn-edit"
              onClick={() => fileInputRef.current?.click()}
              disabled={ocrLoading}
              title="Escanear matrícula con cámara/imagen"
            >
              <span className="material-symbols-outlined">{ocrLoading ? 'hourglass_top' : 'document_scanner'}</span>
              {ocrLoading ? 'Leyendo...' : 'Escanear'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => void handleScan(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      <div className="parking-map-wrap">
        <ParkingMap spots={spots} layout={layout} showLegend />
      </div>

      {status && (
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
            {status.inside && (
              <>
                <div className="parking-status-cell"><label>Bahía</label><span>{status.inside_spot?.spot_number || '-'} ({status.inside_spot?.type || '-'})</span></div>
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

          {status.inside ? (
            <button className="btn-danger" onClick={handleExit} disabled={busy !== null}>
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
                <label>Nombre del conductor (opcional)</label>
                <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Ej: Juan Pérez" />
              </div>
              {[...status.visitor_spots, ...status.rented_spots].length > 0 && (
                <div className="checkout-field">
                  <label>Bahía (opcional)</label>
                  <select value={spotOverride} onChange={e => setSpotOverride(e.target.value)}>
                    <option value="">Automática</option>
                    {status.visitor_spots.map(s => <option key={s.id} value={s.id}>Bahía {s.spot_number} (Visita)</option>)}
                    {status.rented_spots.map(s => <option key={s.id} value={s.id}>Bahía {s.spot_number} (Alquilada)</option>)}
                  </select>
                </div>
              )}
              <button className="btn-primary" onClick={handleEnter} disabled={busy !== null}>
                {busy === 'enter' ? 'Registrando ingreso...' : 'Registrar ingreso'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}