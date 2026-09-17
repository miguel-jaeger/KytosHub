import { useState, useEffect, useCallback } from 'react';
import { useCondoStats } from '../hooks/useCondoStats';
import { ParkingLogsTab } from './ParkingLogsTab';

export function ParkingStatsTab({ schemaName }: { schemaName?: string }) {
  const { getStats } = useCondoStats();
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

  return (
    <div className="parking-stats">
      <div className="modules-header">
        <h3>Estadísticas del Estacionamiento</h3>
        <small>Solo para administración. Resumen de accesos, padrón de vehículos y préstamos vigentes.</small>
      </div>

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
            <div className="cart-kpi"><span className="material-symbols-outlined">view_in_ar</span><strong>{stats.spots_total}</strong> bahías</div>
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">garage</span><strong>{stats.spots_occupied}</strong> bahías ocupadas</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">real_estate_agent</span><strong>{stats.parking_loans_active}</strong> préstamos activos</div>
          </div>
        </>
      )}

      <ParkingLogsTab schemaName={schemaName} />
    </div>
  );
}