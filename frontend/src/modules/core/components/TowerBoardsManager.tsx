import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useTowerBoards } from '../hooks/useTowerBoards';
import type { Resident, Tower } from '../types';

const ROLE_LABELS: Record<string, string> = {
  PRESIDENTE: 'Presidente',
  SECRETARIO: 'Secretario',
  TESORERO: 'Tesorero'
};

const ROLE_ORDER = ['PRESIDENTE', 'SECRETARIO', 'TESORERO'];

export function TowerBoardsManager({ schemaName, enabled }: { schemaName?: string; enabled?: boolean }) {
  const { boards, loading, error, createBoard, deactivateBoard } = useTowerBoards(schemaName, enabled);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    tower_id: string;
    start_date: string;
    notes: string;
    members: Record<string, string>;
  }>({ tower_id: '', start_date: new Date().toISOString().slice(0, 10), notes: '', members: {} });

  useEffect(() => {
    if (!schemaName) return;
    let cancelled = false;
    invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', {
      method: 'POST',
      body: { action: 'list', schema_name: schemaName }
    }).then(({ data }) => {
      if (!cancelled && data?.success) setTowers(data.data || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [schemaName]);

  useEffect(() => {
    if (!schemaName) return;
    let cancelled = false;
    invokeFunction<{ success: boolean; data: Resident[] | null }>('residents', {
      method: 'POST',
      body: { action: 'list', schema_name: schemaName }
    }).then(({ data }) => {
      if (!cancelled && data?.success) setResidents(data.data || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [schemaName]);

  const openForm = () => {
    setForm({ tower_id: towers[0]?.id || '', start_date: new Date().toISOString().slice(0, 10), notes: '', members: {} });
    setFormError(null);
    setShowForm(true);
  };

  const selectedTower = towers.find(t => t.id === form.tower_id);
  const selectedTowerResidents = selectedTower
    ? residents.filter(r => r.departments?.towers?.code === selectedTower.code)
    : [];

  const handleCreate = async () => {
    setFormError(null);
    if (!form.tower_id) { setFormError('Selecciona la torre.'); return; }
    if (!form.start_date) { setFormError('Indica la fecha de inicio del período.'); return; }
    const missing = ROLE_ORDER.filter(r => !form.members[r]);
    if (missing.length) { setFormError('Debes asignar los tres cargos de la junta directiva.'); return; }
    const chosen = Object.values(form.members);
    if (new Set(chosen).size !== chosen.length) { setFormError('Cada cargo debe ser ocupado por un residente diferente.'); return; }
    setSubmitting(true);
    try {
      await createBoard({
        tower_id: form.tower_id,
        start_date: form.start_date,
        notes: form.notes || undefined,
        members: ROLE_ORDER.map(role => ({ resident_id: form.members[role], role }))
      });
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear la junta directiva');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string, label: string) => {
    if (!confirm(`¿Desactivar la junta directiva de "${label}"? Se dejará de considerar como la junta vigente.`)) return;
    try {
      await deactivateBoard(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al desactivar la junta directiva');
    }
  };

  if (!enabled) return null;
  if (loading) return <div className="loading-message">Cargando juntas directivas de torre...</div>;
  if (error) return <div className="error-message">{error}</div>;

  const formatDate = (d: string) => {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('es-PE');
  };

  const boardsByTower = new Map<string, typeof boards>();
  for (const b of boards) {
    const arr = boardsByTower.get(b.tower_id) || [];
    arr.push(b);
    boardsByTower.set(b.tower_id, arr);
  }

  return (
    <div className="boards-manager">
      <div className="header">
        <h3>Junta Directiva de Torre</h3>
        <button onClick={openForm} disabled={towers.length === 0}>
          <span className="material-symbols-outlined">add</span> Nueva junta directiva
        </button>
      </div>
      {towers.length === 0 && (
        <div className="empty-state">
          <p>Registra primero las torres del condominio en la estructura para poder crear juntas directivas.</p>
        </div>
      )}

      {boards.length === 0 ? (
        <div className="empty-state">
          <p>Aún no se han registrado juntas directivas de torre. Crea una nueva para elegir presidente, secretario y tesorero por torre.</p>
        </div>
      ) : (
        <div className="modules-grid">
          {[...boardsByTower.entries()].map(([towerId, towerBoards]) => {
            const tower = boards.find(b => b.id === towerBoards[0]?.id)?.towers;
            return (
              <div key={towerId} className="module-card">
                <div className="module-card-head">
                  <div>
                    <h4>{tower?.name || 'Torre'}</h4>
                    <p>
                      {towerBoards.length} junta{towerBoards.length !== 1 ? 's' : ''} registrada{towerBoards.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                {towerBoards.map(b => (
                  <div key={b.id} className="board-entry" style={{ borderTop: '1px solid var(--border,#e5e7eb)', paddingTop: '0.6rem', marginTop: '0.6rem' }}>
                    <div className="board-entry-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`status-badge ${b.is_active ? 'status-occupied' : 'status-vacant'}`}>
                        {b.is_active ? 'Vigente' : 'Histórica'}
                      </span>
                      <small className="text-on-surface-variant">
                        {formatDate(b.start_date)} → {formatDate(b.end_date)}
                      </small>
                      {b.is_active && (
                        <button className="icon-btn danger" title="Desactivar junta" onClick={() => handleDeactivate(b.id, tower?.name || '')}>
                          <span className="material-symbols-outlined">power_off</span>
                        </button>
                      )}
                    </div>
                    {b.notes && <div className="board-notes text-muted" style={{ marginTop: '0.3rem' }}>{b.notes}</div>}
                    <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1rem' }}>
                      {(b.members || []).slice().sort((a, z) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(z.role)).map(m => (
                        <li key={m.id} style={{ margin: '0.2rem 0' }}>
                          <strong>{ROLE_LABELS[m.role] || m.role}:</strong>{' '}
                          {m.residents?.full_name || '—'}
                          {m.residents?.departments?.towers?.code ? ` · ${m.residents.departments.towers.code}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Nueva Junta Directiva de Torre</h3>
                <p className="text-on-surface-variant">Elige al Presidente, Secretario y Tesorero entre los residentes de la torre.</p>
              </div>
              <button className="modal-close" onClick={() => setShowForm(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Torre</label>
                <select value={form.tower_id} onChange={e => setForm({ ...form, tower_id: e.target.value, members: {} })}>
                  {towers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Fecha de inicio (vigencia de 1 año)</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="module-example">
                <span className="material-symbols-outlined">info</span>
                <span>Solo se pueden elegir residentes de la torre seleccionada. La vigencia es de un año, prorrogable mediante nuevas elecciones.</span>
              </div>
              {ROLE_ORDER.map(role => (
                <div className="form-group" key={role}>
                  <label>{ROLE_LABELS[role]}</label>
                  <select
                    value={form.members[role] || ''}
                    onChange={e => setForm({ ...form, members: { ...form.members, [role]: e.target.value } })}
                  >
                    <option value="">Seleccionar residente...</option>
                    {selectedTowerResidents.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}{r.departments?.department_number ? ` · ${r.departments.department_number}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="form-group">
                <label>Notas (opcional)</label>
                <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones de la junta" />
              </div>
              {formError && <div className="error-message">{formError}</div>}
              {selectedTowerResidents.length === 0 && selectedTower && (
                <div className="empty-state"><p>Esta torre no tiene residentes registrados. Asigna residentes a sus departamentos para poder elegir la junta.</p></div>
              )}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                <button onClick={handleCreate} disabled={submitting}>
                  <span className="material-symbols-outlined">how_to_reg</span> {submitting ? 'Creando...' : 'Registrar junta'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}