import { useState, useEffect, useCallback } from 'react';
import { useParking } from '../hooks/useParking';
import { ParkingLogsTab } from './ParkingLogsTab';
import type { ParkingAccessLog, ParkingLoan, ParkingSpot, Vehicle } from '../types';

export function ParkingStatsTab({ schemaName }: { schemaName?: string }) {
  const { listLogs, listVehicles, listLoans, listSpots } = useParking();
  const [logs, setLogs] = useState<ParkingAccessLog[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<ParkingLoan[]>([]);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    try {
      const [lg, ve, ln, sp] = await Promise.all([
        listLogs(schemaName, { limit: 500 }),
        listVehicles(schemaName),
        listLoans(schemaName),
        listSpots(schemaName)
      ]);
      setLogs(lg);
      setVehicles(ve);
      setLoans(ln);
      setSpots(sp);
    } catch {
      // keep previous values on error
    } finally {
      setLoading(false);
    }
  }, [schemaName, listLogs, listVehicles, listLoans, listSpots]);

  useEffect(() => { void load(); }, [load]);

  const dentro = logs.filter(l => !l.exit_time).length;
  const salidas = logs.filter(l => l.exit_time).length;
  const today = new Date().toDateString();
  const ingresosHoy = logs.filter(l => new Date(l.entry_time).toDateString() === today).length;
  const ocupadas = spots.filter(s => s.inside || s.status === 'OCUPADO').length;
  const activos = loans.filter(l => l.status === 'ACTIVO').length;

  return (
    <div className="parking-stats">
      <div className="modules-header">
        <h3>Estadísticas del Estacionamiento</h3>
        <small>Solo para administración. Resumen de accesos, padrón de vehículos y préstamos vigentes.</small>
      </div>

      {loading ? (
        <div className="loading-message">Cargando estadísticas...</div>
      ) : (
        <>
          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">history</span><strong>{logs.length}</strong> accesos registrados</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">local_parking</span><strong>{dentro}</strong> dentro del estacionamiento</div>
            <div className="cart-kpi cart-kpi-dispo"><span className="material-symbols-outlined">system_update_alt</span><strong>{ingresosHoy}</strong> ingresos de hoy</div>
            <div className="cart-kpi"><span className="material-symbols-outlined">logout</span><strong>{salidas}</strong> salidas registradas</div>
          </div>
          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">directions_car</span><strong>{vehicles.length}</strong> vehículos registrados</div>
            <div className="cart-kpi"><span className="material-symbols-outlined">view_in_ar</span><strong>{spots.length}</strong> bahías</div>
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">garage</span><strong>{ocupadas}</strong> bahías ocupadas</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">real_estate_agent</span><strong>{activos}</strong> préstamos activos</div>
          </div>
        </>
      )}

      <ParkingLogsTab schemaName={schemaName} />
    </div>
  );
}