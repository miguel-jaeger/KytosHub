import { useState } from 'react';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { CondominiumRegistration } from './CondominiumRegistration';
import { TowerWizard } from './TowerWizard';

export function SetupWizard() {
  const { condominium } = useCondominium();
  const [registered, setRegistered] = useState(false);

  const showTowerStep = Boolean(condominium) || registered;

  return (
    <div className="setup-wizard">
      <div className="wizard-steps">
        <span className={!showTowerStep ? 'active' : 'done'}>1. Datos del condominio</span>
        <span className={showTowerStep ? 'active' : ''}>2. Configurar estructura</span>
      </div>

      {!showTowerStep ? (
        <CondominiumRegistration onRegistered={() => setRegistered(true)} />
      ) : (
        <TowerWizard />
      )}
    </div>
  );
}