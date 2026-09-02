import { useState } from 'react';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { CondominiumRegistration } from './CondominiumRegistration';
import { TowerWizard } from './TowerWizard';

export function SetupWizard() {
  const { condominium } = useCondominium();
  const [registered, setRegistered] = useState(false);
  const [towerDone, setTowerDone] = useState(false);

  const showTowerStep = Boolean(condominium) || registered;

  return (
    <div className="setup-wizard">
      <div className="wizard-steps">
        <span className={!showTowerStep ? 'active' : 'done'}>1. Datos del condominio</span>
        <span className={showTowerStep ? (towerDone ? 'done' : 'active') : ''}>2. Configurar estructura</span>
      </div>

      {!showTowerStep ? (
        <CondominiumRegistration onRegistered={() => setRegistered(true)} />
      ) : towerDone ? (
        <div className="setup-complete">
          <span className="material-symbols-outlined fill text-on-primary text-[48px]">check_circle</span>
          <h2>Estructura configurada</h2>
          <p>El condominio ya tiene su estructura de torres configurada.</p>
          <div className="wizard-actions">
            <a href="/structure" className="action-card">Ver estructura</a>
            <a href="/residents" className="action-card">Gestionar residentes</a>
          </div>
        </div>
      ) : (
        <TowerWizard onComplete={() => setTowerDone(true)} />
      )}
    </div>
  );
}