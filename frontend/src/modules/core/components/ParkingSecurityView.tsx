import { useState } from 'react';
import { GuardGateBar } from './GuardGateBar';
import { ParkingGaritaPanel } from './ParkingGaritaPanel';
import { ParkingLogsTab } from './ParkingLogsTab';
import type { GuardGateSession } from '../types';

interface Props {
  schemaName?: string;
}

// Security agents operate the garage (map + plate entry/exit) and can inspect
// the access logs. No configuration, layout, vehicles or loans management is
// exposed to them.
export function ParkingSecurityView({ schemaName }: Props) {
  const [guardSession, setGuardSession] = useState<GuardGateSession | null>(null);
  const [tab, setTab] = useState<'garita' | 'logs'>('garita');

  return (
    <div className="parking-security-view">
      <GuardGateBar schemaName={schemaName} onSessionChange={setGuardSession} />

      <div className="garita-tabs">
        <button className={tab === 'garita' ? 'active' : ''} onClick={() => setTab('garita')}>
          <span className="material-symbols-outlined">local_parking</span> Entradas / Salidas
        </button>
        <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
          <span className="material-symbols-outlined">history</span> Registros
        </button>
      </div>

      {tab === 'garita' ? <ParkingGaritaPanel schemaName={schemaName} guardGate={guardSession} /> : <ParkingLogsTab schemaName={schemaName} />}
    </div>
  );
}