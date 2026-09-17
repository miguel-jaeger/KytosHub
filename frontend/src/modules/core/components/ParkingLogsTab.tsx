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

export function ParkingLogsTab({ schemaName }: { schemaName?: string }) {
  const { listLogs } = useParking();
  const [logs, setLogs] = useState<ParkingAccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insideOnly, setInsideOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const rows = await listLogs(schemaName, { inside_only: insideOnly, limit: 300 });
      setLogs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar registros de acceso');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listLogs, insideOnly]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [logs.length]);

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

      {error && <div className="error-message">{error}</div>}

      {logs.length === 0 ? (
        <div className="empty-state"><p>{insideOnly ? 'No hay vehículos dentro del estacionamiento.' : 'Aún no hay registros de acceso.'}</p></div>
      ) : (
        <table className="residents-table residents-desktop cart-scroll-table">
          <thead>
            <tr>
              <th>Placa</th>
              <th>Conductor</th>
              <th>Tipo</th>
              <th>Bahía</th>
              <th>Entrada</th>
              <th>Puerta entrada</th>
              <th>Salida</th>
              <th>Puerta salida</th>
              <th>Guardia</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(l => (
              <tr key={l.id}>
                <td><strong>{l.license_plate}</strong></td>
                <td>{l.driver_name || '-'}</td>
                <td>{VEHICLE_TYPE_LABELS[l.vehicle_type] || l.vehicle_type || '-'}</td>
                <td>{l.spot_number ? `${l.spot_number} (${l.spot_type || ''})` : '-'}</td>
                <td>{fmtDateTime(l.entry_time)}</td>
                <td>{l.entry_gate?.name || '-'}</td>
                <td>{fmtDateTime(l.exit_time)}</td>
                <td>{l.exit_gate?.name || '-'}</td>
                <td>{l.guard_name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PaginationBar total={logs.length} page={page} perPage={perPage} onPageChange={setPage} onPerPageChange={(n) => { setPerPage(n); setPage(1); }} itemLabel="registro" />
    </div>
  );
}