import { useState, useEffect, useCallback } from 'react';
import { useParking } from '../hooks/useParking';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { ParkingAccessLog } from '../types';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${d.toLocaleDateString('es-PE')}, ${hh}:${mm} ${ap}`;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = { AUTO: 'Auto', MOTO: 'Moto' };

function AccessLogDetailModal({ log, onClose }: { log: ParkingAccessLog; onClose: () => void }) {
  const inside = !log.exit_time;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Detalle del acceso · {log.license_plate}</h3>
            <p>
              <span className={`status-badge ${inside ? 'status-occupied' : 'status-vacant'}`}>
                {inside ? 'Dentro del estacionamiento' : 'Fuera del estacionamiento'}
              </span>
            </p>
          </div>
          <button className="modal-close" onClick={onClose} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="modal-body">
          <div className="resident-grid-fields access-log-detail">
            <div className="resident-grid-line"><span className="resident-grid-label">Placa</span><span><strong>{log.license_plate}</strong></span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Conductor</span><span>{log.driver_name || '-'}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Tipo de vehículo</span><span>{VEHICLE_TYPE_LABELS[log.vehicle_type] || log.vehicle_type || '-'}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Bahía</span><span>{log.spot_number ? `${log.spot_number} (${log.spot_type || ''})` : '-'}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Entrada</span><span>{fmtDateTime(log.entry_time)}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Puerta de entrada</span><span>{log.entry_gate?.name || '-'}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Salida</span><span>{fmtDateTime(log.exit_time)}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Puerta de salida</span><span>{log.exit_gate?.name || '-'}</span></div>
            <div className="resident-grid-line"><span className="resident-grid-label">Guardia</span><span>{log.guard_name || '-'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ParkingLogsTab({ schemaName }: { schemaName?: string }) {
  const { listLogs } = useParking();
  const [logs, setLogs] = useState<ParkingAccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insideOnly, setInsideOnly] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ParkingAccessLog | null>(null);

  const [plateFilter, setPlateFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  const load = useCallback(async (filters?: { license_plate?: string; driver_name?: string; from_date?: string; to_date?: string }) => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const opts = {
        inside_only: insideOnly,
        license_plate: plateFilter.trim() || undefined,
        driver_name: driverFilter.trim() || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        ...filters
      };
      const rows = await listLogs(schemaName, { ...opts, limit: 500 });
      setLogs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar registros de acceso');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listLogs, insideOnly, plateFilter, driverFilter, fromDate, toDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [logs.length]);

  const applyFilters = () => { setPage(1); void load(); };
  const clearFilters = () => {
    setPlateFilter('');
    setDriverFilter('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  if (loading) return <div className="loading-message">Cargando accesos...</div>;

  const pageItems = perPage === 'all' ? logs : paginate(logs, page, perPage).slice;

  return (
    <div>
      <div className="header">
        <div>
          <h3>Registros de entradas y salidas</h3>
          <small>Historial de accesos de vehículos al estacionamiento, con la puerta de ingreso y de salida.</small>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={insideOnly} onChange={e => { setInsideOnly(e.target.checked); setPage(1); }} />
          <span>Solo dentro del estacionamiento</span>
        </label>
      </div>

      <div className="filter-bar">
        <div className="form-group">
          <label>Placa</label>
          <input type="text" value={plateFilter} onChange={e => setPlateFilter(e.target.value)} placeholder="ABC o 123" onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }} />
        </div>
        <div className="form-group">
          <label>Conductor</label>
          <input type="text" value={driverFilter} onChange={e => setDriverFilter(e.target.value)} placeholder="Nombre" onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }} />
        </div>
        <div className="form-group">
          <label>Desde</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Hasta</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <div className="filter-actions">
          <button className="btn-primary" onClick={applyFilters}>Filtrar</button>
          <button className="btn-cancel" onClick={clearFilters}>Limpiar</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {logs.length === 0 ? (
        <div className="empty-state"><p>{insideOnly ? 'No hay vehículos dentro del estacionamiento.' : 'Aún no hay registros de acceso con esos filtros.'}</p></div>
      ) : (
        <>
          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Conductor</th>
                <th>Tipo</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(l => (
                <tr key={l.id}>
                  <td><strong>{l.license_plate}</strong></td>
                  <td>{l.driver_name || '-'}</td>
                  <td>{VEHICLE_TYPE_LABELS[l.vehicle_type] || l.vehicle_type || '-'}</td>
                  <td>{fmtDateTime(l.entry_time)}</td>
                  <td>{fmtDateTime(l.exit_time)}</td>
                  <td>
                    <button className="detail-link" onClick={() => setSelectedLog(l)}>
                      <span className="material-symbols-outlined">visibility</span> Ver detalles
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="residents-mobile-grid">
            {pageItems.map(l => (
              <div key={l.id} className="resident-grid-card">
                <div className="resident-grid-main">
                  <span className="resident-grid-name">
                    {l.license_plate}
                    {l.spot_number ? ` · ${l.spot_number}` : ''}
                    {!l.exit_time ? ' · Dentro' : ''}
                  </span>
                  <span className="resident-grid-meta">{l.driver_name || 'Sin conductor'}</span>
                </div>
                <div className="resident-grid-fields">
                  <div className="resident-grid-line"><span className="resident-grid-label">Tipo</span><span>{VEHICLE_TYPE_LABELS[l.vehicle_type] || l.vehicle_type || '-'}</span></div>
                  <div className="resident-grid-line"><span className="resident-grid-label">Entrada</span><span>{fmtDateTime(l.entry_time)}</span></div>
                  <div className="resident-grid-line"><span className="resident-grid-label">Salida</span><span>{fmtDateTime(l.exit_time)}</span></div>
                </div>
                <div className="resident-row-actions">
                  <button className="detail-link" onClick={() => setSelectedLog(l)}>
                    <span className="material-symbols-outlined">visibility</span> Ver detalles
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <PaginationBar total={logs.length} page={page} perPage={perPage} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} itemLabel="registro" />

      {selectedLog && <AccessLogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}