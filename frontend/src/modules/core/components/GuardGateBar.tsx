import { useState, useEffect, useCallback } from 'react';
import { useGuardGate } from '../hooks/useGuardGate';
import { useCondoGates } from '../hooks/useCondoGates';
import type { Gate, GuardGateSession } from '../types';

interface Props {
  schemaName?: string;
  onSessionChange?: (session: GuardGateSession | null) => void;
}

export function GuardGateBar({ schemaName, onSessionChange }: Props) {
  const { getSession, checkIn, changeGate } = useGuardGate();
  const { list: listGates } = useCondoGates();

  const [session, setSession] = useState<GuardGateSession | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [s, g] = await Promise.all([getSession(schemaName), listGates(schemaName)]);
      const activeGates = g.filter(x => x.is_active);
      setSession(s);
      setGates(activeGates);
      onSessionChange?.(s);
      if (s) return;
      if (activeGates.length === 1) {
        const auto = await checkIn(schemaName, activeGates[0].id);
        setSession(auto);
        onSessionChange?.(auto);
      } else if (activeGates.length > 1) {
        // El agente debe indicar una vez en cuál puerta está autenticado.
        setPicking(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la puerta');
    } finally {
      setLoading(false);
    }
  }, [schemaName, getSession, listGates, checkIn, onSessionChange]);

  useEffect(() => { void load(); }, [load]);

  const handlePick = async (gateId: string) => {
    if (!schemaName) return;
    setSaving(true);
    setError(null);
    try {
      const next = session
        ? await changeGate(schemaName, gateId)
        : await checkIn(schemaName, gateId);
      setSession(next);
      onSessionChange?.(next);
      setPicking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la puerta');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeClick = () => {
    if (!session) { setPicking(true); return; }
    if (confirm(`¿Cambiar la puerta de trabajo de "${session.gate.name}"?`)) {
      setPicking(true);
    }
  };

  if (loading) return <div className="guard-gate-bar guard-gate-loading">Cargando puerta...</div>;
  if (!schemaName) return null;

  return (
    <div className="guard-gate-bar">
      <span className="material-symbols-outlined">shield_moon</span>
      {session ? (
        <span>
          Trabajando en <strong>{session.gate.name}</strong>{session.gate.code ? ` (${session.gate.code})` : ''}
        </span>
      ) : (
        <span>No tienes una puerta asignada.</span>
      )}

      {!session && gates.length === 0 && <span className="text-muted"> Sin puertas activas.</span>}

      {session && (
        <button className="guard-gate-change" onClick={handleChangeClick} title="Cambiar de puerta">
          <span className="material-symbols-outlined">swap_horiz</span> Cambiar puerta
        </button>
      )}
      {!session && gates.length > 1 && (
        <button className="guard-gate-change" onClick={() => setPicking(true)}>
          <span className="material-symbols-outlined">pin_drop</span> Seleccionar puerta
        </button>
      )}

      {error && <span className="text-muted" style={{ color: 'var(--error, #b3261e)' }}>{error}</span>}

      {picking && (
        <div className="form-modal guard-gate-modal">
          <h3>Seleccionar puerta de trabajo</h3>
          <p>Indica en cuál puerta te encuentras hoy. Se usará por defecto para préstamos y registros de entrada/salida.</p>
          <div className="guard-gate-options">
            {gates.map(g => (
              <button
                key={g.id}
                className={`checkout-chip checkout-chip-wide ${session?.gate.id === g.id ? 'active' : ''}`}
                disabled={saving}
                onClick={() => void handlePick(g.id)}
              >
                <span className="checkout-chip-code">{g.name}</span>
                {g.is_entry_exit && <small>Ingreso/Salida de vehículos</small>}
              </button>
            ))}
          </div>
          {session && (
            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setPicking(false)} disabled={saving}>Cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}