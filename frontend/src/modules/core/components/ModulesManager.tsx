import { useState, useEffect, useCallback } from 'react';
import { useCondoModules } from '../hooks/useCondoModules';
import type { ModuleInfo } from '../types';

const CART_CONFIG_FIELDS: Array<{ key: string; label: string; type: 'number' | 'checkbox' }> = [
  { key: 'max_loan_minutes', label: 'Máximo de minutos de préstamo', type: 'number' },
  { key: 'grace_period_minutes', label: 'Período de gracia (minutos)', type: 'number' },
  { key: 'fine_amount', label: 'Monto de multa (S/)', type: 'number' },
  { key: 'fine_interval_minutes', label: 'Intervalo de multa (minutos)', type: 'number' },
  { key: 'fine_enabled', label: 'Multas por demora habilitadas', type: 'checkbox' }
];

export function ModulesManager({ schemaName }: { schemaName?: string }) {
  const { list, update } = useCondoModules();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!schemaName) { setModules([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await list(schemaName);
      setModules(result.modules);
      setIsSuperAdmin(result.is_superadmin);
      const drafts: Record<string, string> = {};
      result.modules.forEach(m => { drafts[m.module_key] = JSON.stringify(m.config_json, null, 2); });
      setConfigDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar módulos');
    } finally {
      setLoading(false);
    }
  }, [schemaName, list]);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (m: ModuleInfo, enabled: boolean) => {
    setSavingKey(m.module_key);
    try {
      await update(schemaName!, m.module_key, { is_enabled: enabled });
      setModules(prev => prev.map(x => x.module_key === m.module_key ? { ...x, is_enabled: enabled } : x));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveConfig = async (m: ModuleInfo) => {
    const raw = configDrafts[m.module_key] || '';
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    } catch {
      alert('La configuración debe ser un JSON válido');
      return;
    }
    setSavingKey(m.module_key);
    try {
      const saved = await update(schemaName!, m.module_key, { config: parsed });
      if (saved) setModules(prev => prev.map(x => x.module_key === m.module_key ? { ...x, config_json: saved.config_json } : x));
      setConfigDrafts(prev => ({ ...prev, [m.module_key]: JSON.stringify(parsed, null, 2) }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingKey(null);
    }
  };

  const updateDraftField = (m: ModuleInfo, key: string, value: unknown) => {
    const current = configDrafts[m.module_key] || '{}';
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(current); } catch { parsed = {}; }
    parsed[key] = value;
    setConfigDrafts(prev => ({ ...prev, [m.module_key]: JSON.stringify(parsed, null, 2) }));
  };

  if (loading) return <div className="loading-message">Cargando módulos...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!schemaName) return <div className="empty-state"><p>Seleccione un condominio para ver sus módulos.</p></div>;

  const visibleModules = isSuperAdmin ? modules : modules.filter(m => m.is_enabled);

  if (visibleModules.length === 0) return <div className="empty-state"><p>Este condominio no tiene módulos activos.</p></div>;

  return (
    <div className="modules-manager">
      <div className="modules-header">
        <h3>Módulos del Condominio</h3>
        {isSuperAdmin
          ? <small>Como administrador global puedes activar/desactivar módulos y editar su configuración.</small>
          : <small>Como administrador del condominio puedes editar la configuración de los módulos activos.</small>}
      </div>

      <div className="modules-grid">
        {visibleModules.map(m => {
          const cartConfig = m.module_key === 'cart_lending';
          const canToggle = m.can_toggle ?? isSuperAdmin;
          const canEdit = m.can_edit_config ?? isSuperAdmin;
          return (
            <div key={m.module_key} className={`module-card ${m.is_enabled ? 'module-enabled' : 'module-disabled'}`}>
              <div className="module-card-head">
                <div>
                  <h4>{m.name}</h4>
                  <p>{m.description}</p>
                </div>
                <span className={`status-badge ${m.is_enabled ? 'status-occupied' : 'status-vacant'}`}>{m.is_enabled ? 'Activado' : 'Desactivado'}</span>
              </div>

              {canToggle && (
                <div className="module-toggle">
                  <label className="switch">
                    <input type="checkbox" checked={m.is_enabled} disabled={savingKey === m.module_key} onChange={e => handleToggle(m, e.target.checked)} />
                    <span className="slider" />
                  </label>
                  <span>{m.is_enabled ? 'Activo' : 'Inactivo'}</span>
                </div>
              )}

              <div className="module-config">
                {cartConfig ? (
                  <>
                    <div className="cart-config-form">
                      {CART_CONFIG_FIELDS.map(f => (
                        <label key={f.key}>
                          {f.label}
                          {f.type === 'checkbox' ? (
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={!!((JSON.parse(configDrafts?.[m.module_key] || '{}') || {} as Record<string, unknown>)[f.key])}
                              onChange={e => updateDraftField(m, f.key, e.target.checked)}
                            />
                          ) : (
                            <input
                              type="number"
                              disabled={!canEdit}
                              value={String((JSON.parse(configDrafts?.[m.module_key] || '{}') || {} as Record<string, unknown>)[f.key] ?? '')}
                              onChange={e => updateDraftField(m, f.key, Number(e.target.value))}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="module-example">
                      <span className="material-symbols-outlined">info</span>
                      <span>
                        Parámetros de préstamo y multas por demora. Las <strong>puertas</strong> y su capacidad por tipo de carrito se configuran en la pestaña <strong>Puertas</strong>.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="module-example">
                      <span className="material-symbols-outlined">info</span>
                      <span>Ejemplo de configuración JSON: <code>{'{ "clave": "valor" }'}</code></span>
                    </div>
                    <textarea
                      className="module-json"
                      rows={5}
                      readOnly={!canEdit}
                      value={configDrafts?.[m.module_key] || '{}'}
                      onChange={e => setConfigDrafts(prev => ({ ...prev, [m.module_key]: e.target.value }))}
                    />
                  </>
                )}
                {canEdit && (
                  <button className="btn-primary" onClick={() => handleSaveConfig(m)} disabled={savingKey === m.module_key}>
                    Guardar configuración
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}