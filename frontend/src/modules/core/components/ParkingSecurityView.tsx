import { useState } from 'react';
import { GuardGateBar } from './GuardGateBar';
import { ParkingGaritaPanel } from './ParkingGaritaPanel';
import type { GuardGateSession } from '../types';

interface Props {
  schemaName?: string;
}

// Security agents only operate: map view + plate entry/exit. No configuration,
// layout, vehicles or loans management is exposed to them.
export function ParkingSecurityView({ schemaName }: Props) {
  const [guardSession, setGuardSession] = useState<GuardGateSession | null>(null);

  return (
    <div className="parking-security-view">
      <GuardGateBar schemaName={schemaName} onSessionChange={setGuardSession} />
      <ParkingGaritaPanel schemaName={schemaName} guardGate={guardSession} />
    </div>
  );
}