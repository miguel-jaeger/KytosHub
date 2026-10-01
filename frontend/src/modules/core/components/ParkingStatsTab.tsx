import { useState, useEffect, useCallback } from 'react';
import { useCondoStats } from '../hooks/useCondoStats';
import { ParkingLogsTab } from './ParkingLogsTab';

export function ParkingStatsTab({ schemaName }: { schemaName?: string }) {
  const { getStats, resetStats, clearHistory } = useCondoStats();
  const [stats, setStats] = useState<{
    access_total: number;
    access_inside: number;
    access_entry_today: number;
    access_exit_total: number;
    vehicles_total: number;
    spots_total: number;
    spots_occupied: number;
    parking_loans_active: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState<'parking' | 'carts' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    try {
      const s = await getStats(schemaName);
      setStats({
        access_total: s.access_total,
        access_inside: s.access_inside,
        access_entry_today: s.access_entry_today,
        access_exit_total: s.access_exit_total,
        vehicles_total: s.vehicles_total,
        spots_total: s.spots_total,
        spots_occupied: s.spots_occupied,
        parking_loans_active: s.parking_loans_active
      });
    } catch {
      // keep previous values on error
    } finally {
      setLoading(false);
    }
  }, [schemaName, getStats]);

  useEffect(() => { void load(); }, [load]);

  const handleResetStats = async () => {
    if (!schemaName) return;
    if (!confirm('¿Limpiar las estadísticas del estacionamiento y de los carritos? Se pondrán los contadores en cero (accesos, ocupación, préstamos y carritos). Esta acción no se puede deshacer.')) return;
    setResetting(true);
    setMessage(null);
    try {
      const s = await resetStats(schemaName, 'all');
      setStats({
        access_total: s.access_total,
        access_inside: s.access_inside,
        access_entry_today: s.access_entry_today,
        access_exit_total: s.access_exit_total,
        vehicles_total: s.vehicles_total,
        spots_total: s.spots_total,
        spots_occupied: s.spots_occupied,
        parking_loans_active: s.parking_loans_active
      });
      setMessage('Estadísticas limpiadas.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudieron limpiar las estadísticas');
    } finally {
      setResetting(false);
    }
  };

  const handleClearHistory = async (area: 'parking' | 'carts') => {
    if (!schemaName) return;
    const label = area === 'parking' ? 'el estacionamiento' : 'los carritos';
    if (!confirm(`¿Eliminar completamente el historial de ${label}? Se borrarán los registros de accesos/préstamos y se liberarán las plazas/carritos. Esta acción no se puede deshacer.`)) return;
    setDeletingHistory(area);
    setMessage(null);
    try {
      const s = await clearHistory(schemaName, area);
      setStats({
        access_total: s.access_total,
        access_inside: s.access_inside,
        access_entry_today: s.access_entry_today,
        access_exit_total: s.access_exit_total,
        vehicles_total: s.vehicles_total,
        spots_total: s.spots_total,
        spots_occupied: s.spots_occupied,
        parking_loans_active: s.parking_loans_active
      });
      setMessage(`Historial de ${label} eliminado.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo eliminar el historial');
    } finally {
      setDeletingHistory(null);
    }
  };

  return (
    <div className="parking-stats">
      <div className="modules-header">
        <h3>Estadísticas del Estacionamiento</h3>
        <small>Solo para administración. Resumen de accesos, padrón de vehículos y préstamos vigentes.</small>
        <button className="btn-cancel users-bulk-delete" onClick={handleResetStats} disabled={resetting}>
          {resetting ? <span className="spinner spinner-inline" /> : <span className="material-symbols-outlined">delete_sweep</span>}
          {resetting ? 'Limpiando...' : 'Limpiar estadísticas'}
        </button>
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}

      {loading || !stats ? (
        <div className="loading-message">Cargando estadísticas...</div>
      ) : (
        <>
          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">history</span><strong>{stats.access_total}</strong> accesos registrados</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">local_parking</span><strong>{stats.access_inside}</strong> dentro del estacionamiento</div>
            <div className="cart-kpi cart-kpi-dispo"><span className="material-symbols-outlined">system_update_alt</span><strong>{stats.access_entry_today}</strong> ingresos de hoy</div>
            <div className="cart-kpi"><span className="material-symbols-outlined">logout</span><strong>{stats.access_exit_total}</strong> salidas registradas</div>
          </div>
          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">directions_car</span><strong>{stats.vehicles_total}</strong> vehículos registrados</div>
            <div className="cart-kpi"><span className="material-symbols-outlined">view_in_ar</span><strong>{stats.spots_total}</strong> estacionamientos</div>
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">garage</span><strong>{stats.spots_occupied}</strong> estacionamientos ocupados</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">real_estate_agent</span><strong>{stats.parking_loans_active}</strong> préstamos activos</div>
          </div>
        </>
      )}

      <div className="history-tools">
          <div className="history-tools-title">
            <span className="material-symbols-outlined">delete_forever</span>
            <strong>Registros del estacionamiento (solo disponible para super admin)</strong>
          </div>
          <div className="history-tools-actions">
            <button className="btn-cancel users-bulk-delete" onClick={() => handleClearHistory('parking')} disabled={deletingHistory !== null}>
              {deletingHistory === 'parking' ? <span className="spinner spinner-inline" /> : <span className="material-symbols-outlined">directions_car</span>}
              {deletingHistory === 'parking' ? 'Eliminando...' : 'Eliminar registros del estacionamiento'}
            </button>
          </div>
          <small className="text-muted">Borra todos los registros de accesos y préstamos del estacionamiento y libera las plazas. Solo el super admin puede ejecutarlo. No se puede deshacer.</small>
        </div>

      <ParkingLogsTab schemaName={schemaName} />
    </div>
  );
}