import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import { ParkingMap, SPOT_TYPE_LABELS } from './ParkingMap';
import type { Department, Floor, ParkingLayout, ParkingSpot, ParkingSpotType, Tower } from '../types';

const emptySpotForm = { type: 'PROPIO' as ParkingSpotType, department_id: '' };

export function ParkingLayoutConfig({ schemaName }: { schemaName?: string }) {
  const { listSpots, getLayout, provisionLayout, updateSpot } = useParking();
  const [layout, setLayout] = useState<ParkingLayout | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [rowsInput, setRowsInput] = useState('2');
  const [perRowInputs, setPerRowInputs] = useState<string[]>(['4', '4']);
  const [generating, setGenerating] = useState(false);

  const [editingSpot, setEditingSpot] = useState<ParkingSpot | null>(null);
  const [spotForm, setSpotForm] = useState(emptySpotForm);
  const [savingSpot, setSavingSpot] = useState(false);

  // Stepper torre -> piso -> departamento for the assigned department
  const [towers, setTowers] = useState<Tower[]>([]);
  const [spotTowerId, setSpotTowerId] = useState('');
  const [spotFloorId, setSpotFloorId] = useState('');
  const [spotDeptId, setSpotDeptId] = useState('');
  const [spotFloors, setSpotFloors] = useState<Floor[]>([]);
  const [spotDepartments, setSpotDepartments] = useState<Department[]>([]);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  const loadTowers = useCallback(async () => {
    if (!schemaName) return;
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      setTowers((data?.data || []).sort((a, b) => a.code.localeCompare(b.code)));
    } catch {}
  }, [schemaName]);

  useEffect(() => { void loadTowers(); }, [loadTowers]);

  const loadSpotFloors = async (towerId: string) => {
    if (!schemaName) return;
    setLoadingStep('pisos');
    setSpotFloors([]);
    setSpotFloorId('');
    setSpotDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: towerId }
      });
      setSpotFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } finally {
      setLoadingStep(null);
    }
  };

  const loadSpotDepartments = async (floorId: string) => {
    if (!schemaName) return;
    setLoadingStep('departamentos');
    setSpotDepartments([]);
    setSpotDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: spotTowerId, floor_id: floorId }
      });
      setSpotDepartments((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } finally {
      setLoadingStep(null);
    }
  };

  const startSpotEdit = (s: ParkingSpot) => {
    setEditingSpot(s);
    setSpotForm({ type: s.type, department_id: s.department_id || '' });
    setSpotTowerId('');
    setSpotFloorId('');
    setSpotDeptId(s.department_id || '');
    setSpotFloors([]);
    setSpotDepartments([]);
  };

  const selectSpotTower = (id: string) => {
    setSpotTowerId(id);
    setSpotFloorId('');
    setSpotDeptId('');
    void loadSpotFloors(id);
  };

  const selectSpotFloor = (id: string) => {
    setSpotFloorId(id);
    setSpotDeptId('');
    void loadSpotDepartments(id);
  };

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [sp, ly] = await Promise.all([listSpots(schemaName), getLayout(schemaName)]);
      setSpots(sp);
      setLayout(ly);
      if (ly) {
        setRowsInput(String(ly.rows));
        const counts = Array.isArray(ly.spots_per_row)
          ? ly.spots_per_row.map(v => String(v))
          : Array.from({ length: ly.rows }, () => String(ly.spots_per_row));
        setPerRowInputs(counts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listSpots, getLayout]);

  useEffect(() => { void load(); }, [load]);

  const rows = Math.max(1, Math.min(50, Number(rowsInput) || 1));
  const perRowCounts = perRowInputs.map(v => Math.max(1, Math.min(50, Number(v) || 1)));
  while (perRowCounts.length < rows) perRowCounts.push(1);
  const effectiveCounts = perRowCounts.slice(0, rows);
  const totalExpected = effectiveCounts.reduce((a, b) => a + b, 0);

  const handleRowsChange = (value: string) => {
    setRowsInput(value);
    const n = Math.max(1, Math.min(50, Number(value) || 1));
    setPerRowInputs(prev => {
      const next = [...prev];
      while (next.length < n) next.push('1');
      return next.slice(0, n);
    });
  };

  const handleRowColsChange = (idx: number, value: string) => {
    setPerRowInputs(prev => prev.map((v, i) => i === idx ? value : v));
  };

  const handleProvision = async () => {
    if (!schemaName) return;
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await provisionLayout(schemaName, rows, effectiveCounts);
      setLayout(res.layout);
      setSpots(res.spots);
      setPerRowInputs(Array.isArray(res.result.spots_per_row)
        ? (res.result.spots_per_row as number[]).map(v => String(v))
        : effectiveCounts.map(v => String(v)));
      setMessage(`Layout generado: ${res.result.total ?? totalExpected} plazas en ${res.result.rows ?? rows} fila(s). Creadas: ${res.result.created ?? 0}, actualizadas: ${res.result.updated ?? 0}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar layout');
    } finally {
      setGenerating(false);
    }
  };

  const handleSpotSave = async () => {
    if (!schemaName || !editingSpot) return;
    const chosenDept = spotForm.type === 'VISITA' || spotForm.type === 'ALQUILADO'
      ? (spotDeptId || spotForm.department_id || null)
      : (spotDeptId || spotForm.department_id || null);
    if (spotForm.type === 'PROPIO' && !chosenDept) { alert('Selecciona torre, piso y departamento para la plaza propia'); return; }
    setSavingSpot(true);
    setError(null);
    try {
      const updated = await updateSpot(schemaName, editingSpot.id, {
        type: spotForm.type,
        department_id: chosenDept
      });
      if (updated) {
        setSpots(prev => prev.map(s => s.id === updated.id ? updated : s));
      }
      setEditingSpot(null);
      setMessage(`Plaza ${editingSpot.spot_number} actualizada`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingSpot(false);
    }
  };

  if (loading) return <div className="loading-message">Cargando configuración de estacionamiento...</div>;
  if (!schemaName) return <div className="empty-state"><p>Selecciona un condominio para configurar su estacionamiento.</p></div>;

  return (
    <div className="parking-layout-config">
      <div className="header">
        <div>
          <h3>Configuración del estacionamiento</h3>
          <small>Define cuántas filas tendrá el estacionamiento y cuántas plazas en cada fila (pueden variar). Las plazas se numeran automáticamente (01, 02, 03...).</small>
        </div>
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="cart-form">
        <h4>Diseño del layout</h4>
        <div className="form-row">
          <div className="form-group">
            <label>Filas de estacionamiento</label>
            <input type="number" min={1} max={50} value={rowsInput} onChange={e => handleRowsChange(e.target.value)} />
          </div>
          <div className="form-group" style={{ justifyContent: 'center' }}>
            <label>Total de plazas</label>
            <div className="plaza-total-preview"><strong>{totalExpected}</strong> plazas · numeración 01…{String(totalExpected).padStart(Math.max(2, String(totalExpected).length), '0')}</div>
          </div>
        </div>
        <div className="plaza-per-row-grid">
          {effectiveCounts.map((_, idx) => (
            <div key={idx} className="form-group">
              <label>Plazas en fila {idx + 1}</label>
              <input
                type="number"
                min={1}
                max={50}
                value={perRowInputs[idx] ?? '1'}
                onChange={e => handleRowColsChange(idx, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button onClick={handleProvision} disabled={generating || !schemaName}>
            <span className="material-symbols-outlined">grid_3x3</span> {generating ? 'Generando...' : spots.length === 0 ? 'Generar plazas' : 'Regenerar layout (conserva plazas existentes)'}
          </button>
          <small className="text-muted">Al regenerar se conservan las plazas ya existentes (por número) y se agregan las que falten; no se borra nada.</small>
        </div>
      </div>

      {spots.length > 0 && (
        <div className="cart-form">
          <div className="modules-header">
            <h4>Mapa de plazas</h4>
            <small>Haz clic en una plaza para asignar su tipo o departamento (plazas propias).</small>
          </div>
          <ParkingMap spots={spots} layout={layout} onSpotClick={startSpotEdit} showLegend />
        </div>
      )}
      {spots.length === 0 && (
        <div className="empty-state"><p>Genera el layout para comenzar a configurar el estacionamiento.</p></div>
      )}

      {editingSpot && (
        <div className="modal-overlay" onClick={() => setEditingSpot(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Configurar plaza {editingSpot.spot_number}</h3>
                <p className="text-on-surface-variant">Asigna el tipo y el departamento de la plaza.</p>
              </div>
              <button className="modal-close" onClick={() => setEditingSpot(null)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
          <div className="form-group">
            <label>Tipo de plaza</label>
            <select value={spotForm.type} onChange={e => setSpotForm({ ...spotForm, type: e.target.value as ParkingSpotType })}>
              {Object.entries(SPOT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {(spotForm.type === 'VISITA' || spotForm.type === 'ALQUILADO' ? false : true) && (
            <>
              <div className="checkout-field">
                <label>1. Torre</label>
                {towers.length === 0 ? (
                  <span className="text-muted">No hay torres registradas.</span>
                ) : (
                  <div className="checkout-chip-row">
                    {towers.map(t => (
                      <button key={t.id} type="button" className={`checkout-chip ${spotTowerId === t.id ? 'active' : ''}`} onClick={() => selectSpotTower(t.id)}>
                        <span className="checkout-chip-code">{t.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {spotTowerId !== '' && (
                <div className="checkout-field">
                  <label>2. Piso</label>
                  {loadingStep === 'pisos' ? (
                    <span className="text-muted">Cargando pisos...</span>
                  ) : spotFloors.length === 0 ? (
                    <span className="text-muted">Esa torre no tiene pisos.</span>
                  ) : (
                    <div className="checkout-chip-grid">
                      {spotFloors.map(f => (
                        <button key={f.id} type="button" className={`checkout-chip ${spotFloorId === f.id ? 'active' : ''}`} onClick={() => selectSpotFloor(f.id)}>
                          {f.floor_number}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {spotTowerId !== '' && spotFloorId !== '' && (
                <div className="checkout-field">
                  <label>3. Departamento</label>
                  {loadingStep === 'departamentos' ? (
                    <span className="text-muted">Cargando departamentos...</span>
                  ) : spotDepartments.length === 0 ? (
                    <span className="text-muted">Ese piso no tiene departamentos.</span>
                  ) : (
                    <div className="checkout-chip-grid">
                      {spotDepartments.map(d => (
                        <button
                          key={d.id}
                          type="button"
                          className={`checkout-chip checkout-chip-wide ${spotDeptId === d.id ? 'active' : ''}`}
                          onClick={() => setSpotDeptId(d.id)}
                        >
                          {d.department_number}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setEditingSpot(null)}>Cancelar</button>
            <button onClick={handleSpotSave} disabled={savingSpot}>{savingSpot ? 'Guardando...' : 'Guardar'}</button>
          </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}