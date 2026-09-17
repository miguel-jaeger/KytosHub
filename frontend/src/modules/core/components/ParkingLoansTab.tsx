import { useState, useEffect, useCallback } from 'react';
import { useParking } from '../hooks/useParking';
import type { ParkingLoan } from '../types';

const LOAN_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ACTIVO: 'Activo',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado'
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return `${d.toLocaleDateString('es-PE')}, ${hh}:${mm} ${ap}`;
}

export function ParkingLoansTab({ schemaName }: { schemaName?: string }) {
  const { listLoans, updateLoanStatus } = useParking();
  const [loans, setLoans] = useState<ParkingLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const ln = await listLoans(schemaName);
      setLoans(ln);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listLoans]);

  useEffect(() => { void load(); }, [load]);

  const handleLoanStatus = async (loan: ParkingLoan, status: 'ACTIVO' | 'CANCELADO' | 'FINALIZADO') => {
    if (!schemaName) return;
    const label = LOAN_STATUS_LABELS[status];
    if (!confirm(`¿Marcar el préstamo de la bahía ${loan.spot_number} como "${label}"?`)) return;
    try {
      await updateLoanStatus(schemaName, loan.id, status);
      setMessage(`Préstamo marcado como ${label}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  if (loading) return <div className="loading-message">Cargando préstamos...</div>;

  return (
    <div>
      <div className="header">
        <div>
          <h3>Préstamos de plazas entre propietarios</h3>
          <small>Propietarios ceden temporalmente su plaza a otro departamento con una ventana de tiempo.</small>
        </div>
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {loans.length === 0 ? (
        <div className="empty-state"><p>Aún no hay préstamos de plazas.</p></div>
      ) : (
        <table className="residents-table residents-desktop">
          <thead>
            <tr>
              <th>Plaza</th>
              <th>Presta</th>
              <th>Recibe</th>
              <th>Vehículo</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loans.map(l => {
              const isClosed = l.status === 'FINALIZADO' || l.status === 'CANCELADO';
              return (
                <tr key={l.id}>
                  <td>{l.spot_number || '-'} ({l.spot_type || ''})</td>
                  <td>{l.lender_department ? `${l.lender_department.department_number} (T${l.lender_department.tower_code || '-'})` : '-'}</td>
                  <td>{l.borrower_department ? `${l.borrower_department.department_number} (T${l.borrower_department.tower_code || '-'})` : (l.borrower_vehicle_plate ? 'Visitante' : '-')}</td>
                  <td>{l.borrower_vehicle_plate || '-'}</td>
                  <td>{fmtDateTime(l.start_time)}</td>
                  <td>{fmtDateTime(l.end_time)}</td>
                  <td><span className={`status-badge ${l.status === 'ACTIVO' ? 'status-occupied' : 'status-vacant'}`}>{LOAN_STATUS_LABELS[l.status] || l.status}</span></td>
                  <td>
                    {!isClosed && (
                      <div className="resident-row-actions">
                        {l.status === 'PENDIENTE' && (
                          <button className="btn-edit" onClick={() => handleLoanStatus(l, 'ACTIVO')} title="Activar"><span className="material-symbols-outlined">check_circle</span></button>
                        )}
                        {l.status === 'ACTIVO' && (
                          <button className="btn-edit" onClick={() => handleLoanStatus(l, 'FINALIZADO')} title="Finalizar"><span className="material-symbols-outlined">stop_circle</span></button>
                        )}
                        <button className="btn-danger" onClick={() => handleLoanStatus(l, 'CANCELADO')} title="Cancelar"><span className="material-symbols-outlined">cancel</span></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}