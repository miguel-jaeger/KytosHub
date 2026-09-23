import { useState, useEffect, useCallback } from 'react';
import { useCondoModules } from '../hooks/useCondoModules';
import { BillingConfigForm, normalizeBillingConfig } from './BillingConfigForm';
import type { ModuleInfo } from '../types';

const CART_CONFIG_FIELDS: Array<{ key: string; label: string; type: 'number' | 'checkbox' }> = [
  { key: 'max_loan_minutes', label: 'Máximo de minutos de préstamo', type: 'number' },
  { key: 'grace_period_minutes', label: 'Período de gracia (minutos)', type: 'number' },
  { key: 'fine_amount', label: 'Monto de multa (S/)', type: 'number' },
  { key: 'fine_interval_minutes', label: 'Intervalo de multa (minutos)', type: 'number' },
  { key: 'fine_enabled', label: 'Multas por demora habilitadas', type: 'checkbox' }
];

function parseDraft(draft: string): Record<string, unknown> {
  try { const p = JSON.parse(draft); return p && typeof p === 'object' ? p as Record<string, unknown> : {}; } catch { return {}; }
}

export function ModulesManager({ schemaName, onModulesUpdated }: { schemaName?: string; onModulesUpdated?: () => void }) {
  const { list, update } = useCondoModules();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [openConfig, setOpenConfig] = useState<string | null>(null);

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
      onModulesUpdated?.();
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
      onModulesUpdated?.();
      setOpenConfig(null);
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

  const updateDraftConfig = (m: ModuleInfo, next: Record<string, unknown>) => {
    setConfigDrafts(prev => ({ ...prev, [m.module_key]: JSON.stringify(next, null, 2) }));
  };

  const updateParkingLayoutField = (m: ModuleInfo, value: { rows: number; spots_per_row: number[] }) => {
    const current = configDrafts[m.module_key] || '{}';
    const parsed = parseDraft(current);
    parsed.layout = value;
    setConfigDrafts(prev => ({ ...prev, [m.module_key]: JSON.stringify(parsed, null, 2) }));
  };

  const parkingLayoutOf = (m: ModuleInfo): { rows: number; spots_per_row: number[] } => {
    const cfg = parseDraft(configDrafts[m.module_key] || '{}');
    const layout = cfg.layout && typeof cfg.layout === 'object' ? cfg.layout as Record<string, unknown> : {};
    const rows = Number(layout.rows) || 2;
    if (Array.isArray(layout.spots_per_row)) {
      const counts = (layout.spots_per_row as unknown[]).map(v => Math.max(1, Math.round(Number(v) || 1)));
      while (counts.length < rows) counts.push(counts[counts.length - 1] || 1);
      return { rows, spots_per_row: counts.slice(0, rows) };
    }
    const per = Math.max(1, Number(layout.spots_per_row) || 4);
    return { rows, spots_per_row: Array.from({ length: rows }, () => per) };
  };

  const renderModuleConfig = (m: ModuleInfo) => {
    const canEdit = m.can_edit_config ?? isSuperAdmin;
    const cartConfig = m.module_key === 'cart_lending';
    const parkingConfig = m.module_key === 'parking_control';
    if (cartConfig) {
      return (
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
      );
    }
    if (parkingConfig) {
      return (
        <>
          <div className="cart-config-form">
            <label>
              Filas de estacionamiento
              <input
                type="number"
                min={1}
                max={50}
                disabled={!canEdit}
                value={String(parkingLayoutOf(m).rows)}
                onChange={e => {
                  const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                  const current = parkingLayoutOf(m);
                  const counts = [...current.spots_per_row];
                  while (counts.length < n) counts.push(counts[counts.length - 1] || 1);
                  updateParkingLayoutField(m, { rows: n, spots_per_row: counts.slice(0, n) });
                }}
              />
            </label>
            {Array.from({ length: parkingLayoutOf(m).rows }, (_, i) => (
              <label key={i}>
                Plazas en fila {i + 1}
                <input
                  type="number"
                  min={1}
                  max={50}
                  disabled={!canEdit}
                  value={String(parkingLayoutOf(m).spots_per_row[i] ?? 1)}
                  onChange={e => {
                    const current = parkingLayoutOf(m);
                    const counts = [...current.spots_per_row];
                    counts[i] = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                    updateParkingLayoutField(m, { rows: current.rows, spots_per_row: counts });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="module-example">
            <span className="material-symbols-outlined">info</span>
            <span>
              El layout visual (filas × plazas por fila, distintas por fila) y el mapa de plazas se administran en la pestaña <strong>Estacionamiento</strong>. Guardado aquí solo persiste el layout indicado.
            </span>
          </div>
        </>
      );
    }
    if (m.module_key === 'visitor_access') {
      return (
        <>
          <div className="cart-config-form">
            <label>
              Máximo de visitas simultáneas por departamento
              <input
                type="number"
                min={1}
                max={50}
                disabled={!canEdit}
                value={String((JSON.parse(configDrafts?.[m.module_key] || '{}') || {} as Record<string, unknown>).max_simultaneous_per_department ?? 2)}
                onChange={e => updateDraftField(m, 'max_simultaneous_per_department', Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
          <div className="module-example">
            <span className="material-symbols-outlined">info</span>
            <span>Regla de restricción: cantidad máxima de visitas simultáneas (pendientes o dentro del condominio) por departamento.</span>
          </div>
        </>
      );
    }
    if (m.module_key === 'billing_maintenance') {
      const uploadFolder = schemaName ? `condominios/${schemaName}/recibos` : 'recibos';
      if (!canEdit) {
        return (
          <div className="cart-config-form">
            <BillingConfigForm
              value={normalizeBillingConfig(parseDraft(configDrafts?.[m.module_key] || '{}'))}
              onChange={() => {}}
              disabled
              uploadFolder={uploadFolder}
            />
          </div>
        );
      }
      return (
        <div className="cart-config-form" style={{ display: 'block' }}>
          <BillingConfigForm
            value={normalizeBillingConfig(parseDraft(configDrafts?.[m.module_key] || '{}'))}
            onChange={next => updateDraftConfig(m, next as unknown as Record<string, unknown>)}
            uploadFolder={uploadFolder}
          />
        </div>
      );
    }
    return <p className="text-muted">Este módulo no requiere configuración adicional.</p>;
  };

  if (loading) return <div className="loading-message">Cargando módulos...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!schemaName) return <div className="empty-state"><p>Seleccione un condominio para ver sus módulos.</p></div>;

  // Admins (global or condominium) manage their modules: they see all of them
  // (active + inactive) so they can activate/deactivate. Other roles only see
  // the modules that are enabled for their condominium.
  const canManageModules = modules.some(m => m.can_toggle);
  const visibleModules = canManageModules ? modules : modules.filter(m => m.is_enabled);

  if (visibleModules.length === 0) return <div className="empty-state"><p>Este condominio no tiene módulos activos.</p></div>;

  const activeConfig = modules.find(m => m.module_key === openConfig) ?? null;

  return (
    <div className="modules-manager">
      <div className="modules-header">
        <h3>Módulos del Condominio</h3>
        <small>
          {canManageModules
            ? 'Puedes activar/desactivar los módulos disponibles y editar su configuración del condominio.'
            : 'Estos son los módulos activos de tu condominio.'}
        </small>
      </div>

      <div className="modules-grid">
        {visibleModules.map(m => {
          const canToggle = m.can_toggle ?? isSuperAdmin;
          const canEdit = m.can_edit_config ?? isSuperAdmin;
          return (
            <div key={m.module_key} className={`module-card ${m.is_enabled ? 'module-enabled' : 'module-disabled'}`}>
              <div className="module-card-head">
                <div>
                  <h4>{m.name}</h4>
                  <p>{m.description}</p>
                </div>
                <div className="module-head-actions">
                  <span className={`status-badge ${m.is_enabled ? 'status-occupied' : 'status-vacant'}`}>{m.is_enabled ? 'Activado' : 'Desactivado'}</span>
                  {canEdit && (
                    <button
                      className="icon-btn"
                      onClick={() => setOpenConfig(m.module_key)}
                      title="Configuración"
                      aria-label="Configuración"
                    >
                      <span className="material-symbols-outlined">settings</span>
                    </button>
                  )}
                </div>
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
            </div>
          );
        })}
      </div>

      {activeConfig && (
        <div className="modal-overlay" onClick={() => setOpenConfig(null)}>
          <div className="modal-content module-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Configuración de {activeConfig.name}</h3>
                <p className="text-muted">{activeConfig.description}</p>
              </div>
              <button className="modal-close" onClick={() => setOpenConfig(null)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="module-config">
                {renderModuleConfig(activeConfig)}
              </div>
              {(activeConfig.can_edit_config ?? isSuperAdmin) && (
                <div className="form-actions">
                  <button className="btn-cancel" onClick={() => setOpenConfig(null)}>Cancelar</button>
                  <button className="btn-primary" onClick={() => handleSaveConfig(activeConfig)} disabled={savingKey === activeConfig.module_key}>
                    {savingKey === activeConfig.module_key ? 'Guardando...' : 'Guardar configuración'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}