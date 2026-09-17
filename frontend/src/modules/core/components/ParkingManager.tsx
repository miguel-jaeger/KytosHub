import { useState } from 'react';
import { ParkingLayoutConfig } from './ParkingLayoutConfig';
import { ParkingVehiclesTab } from './ParkingVehiclesTab';
import { ParkingLoansTab } from './ParkingLoansTab';
import { ParkingStatsTab } from './ParkingStatsTab';

export function ParkingManager({ schemaName }: { schemaName?: string }) {
  const [tab, setTab] = useState<'layout' | 'vehicles' | 'loans' | 'stats'>('layout');

  return (
    <div className="parking-manager">
      <div className="setup-tabs">
        <button className={tab === 'layout' ? 'active' : ''} onClick={() => setTab('layout')}>Mapa y Configuración</button>
        <button className={tab === 'vehicles' ? 'active' : ''} onClick={() => setTab('vehicles')}>Vehículos</button>
        <button className={tab === 'loans' ? 'active' : ''} onClick={() => setTab('loans')}>Préstamos</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Estadística</button>
      </div>

      {tab === 'layout' && <ParkingLayoutConfig schemaName={schemaName} />}
      {tab === 'vehicles' && <ParkingVehiclesTab schemaName={schemaName} />}
      {tab === 'loans' && <ParkingLoansTab schemaName={schemaName} />}
      {tab === 'stats' && <ParkingStatsTab schemaName={schemaName} />}
    </div>
  );
}