import { useState } from 'react';
import { useGeneralBoards } from '../hooks/useGeneralBoards';
import type { BoardRole } from '../types';

const ROLE_LABELS: Record<string, string> = {
  PRESIDENTE: 'Presidente',
  SECRETARIO: 'Secretario',
  TESORERO: 'Tesorero'
};

const ROLE_ORDER: BoardRole[] = ['PRESIDENTE', 'SECRETARIO', 'TESORERO'];

export function GeneralBoardsManager({ schemaName, enabled }: { schemaName?: string; enabled?: boolean }) {
  const { boards, candidates, loading, error, createBoard, deactivateBoard } = useGeneralBoards(schemaName, enabled);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    start_date: string;
    notes: string;
    members: Record<string, string>;
  }>({ start_date: new Date().toISOString().slice(0, 10), notes: '', members: {} });

  const openForm = () => {
    setForm({ start_date: new Date().toISOString().slice(0, 10), notes: '', members: {} });
    setFormError(null);
    setShowForm(true);
  };

  const candidateLabel = (boardMemberId: string) => {
    const c = candidates.find(x => x.board_member_id === boardMemberId);
    if (!c) return '—';
    const resident = c.residents;
    const tower = c.tower_board?.towers;
    return `${resident?.full_name || '—'}${tower?.code ? ` (T${tower.code})` : ''}`;
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!form.start_date) { setFormError('Indica la fecha de inicio del período.'); return; }
    const missing = ROLE_ORDER.filter(r => !form.members[r]);
    if (missing.length) { setFormError('Debes asignar los tres cargos de la junta directiva general.'); return; }
    const chosen = Object.values(form.members);
    if (new Set(chosen).size !== chosen.length) { setFormError('Cada cargo debe ser ocupado por un miembro diferente.'); return; }
    setSubmitting(true);
    try {
      await createBoard({
        start_date: form.start_date,
        notes: form.notes || undefined,
        members: ROLE_ORDER.map(role => ({ board_member_id: form.members[role], role }))
      });
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear la junta directiva general');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('¿Desactivar la junta directiva general vigente? Se dejará de considerar como la junta en ejercicio.')) return;
    try {
      await deactivateBoard(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al desactivar la junta directiva general');
    }
  };

  if (!enabled) return null;
  if (loading) return <div className="loading-message">Cargando la junta directiva general...</div>;
  if (error) return <div className="error-message">{error}</div>;

  const formatDate = (d: string) => {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('es-PE');
  };

  return (
    <div className="boards-manager">
      <div className="header">
        <h3>Junta Directiva General</h3>
        <button onClick={openForm} disabled={candidates.length === 0} title={candidates.length === 0 ? 'Se necesitan juntas de torre vigentes con miembros' : ''}>
          <span className="material-symbols-outlined">add</span> Nueva junta general
        </button>
      </div>

      {candidates.length === 0 && (
        <div className="module-example" style={{ marginBottom: '1rem' }}>
          <span className="material-symbols-outlined">info</span>
          <span>
            La junta directiva general se elige solo entre los miembros de las juntas directivas de las torres. Registra y mantén vigente una junta directiva de torre para habilitar sus miembros como candidatos.
          </span>
        </div>
      )}

      {boards.length === 0 ? (
        <div className="empty-state">
          <p>Aún no se ha registrado una junta directiva general.</p>
        </div>
      ) : (
        <div className="modules-grid">
          {boards.map(b => (
            <div key={b.id} className="module-card">
              <div className="module-card-head">
                <div>
                  <h4>Junta Directiva General</h4>
                  <p>
                    Vigencia: {formatDate(b.start_date)} → {formatDate(b.end_date)}
                  </p>
                </div>
                <div className="module-head-actions">
                  <span className={`status-badge ${b.is_active ? 'status-occupied' : 'status-vacant'}`}>
                    {b.is_active ? 'Vigente' : 'Histórica'}
                  </span>
                </div>
              </div>
              {b.notes && <div className="board-notes text-muted" style={{ marginTop: '0.3rem' }}>{b.notes}</div>}
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1rem' }}>
                {(b.members || []).slice().sort((a, z) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(z.role)).map(m => (
                  <li key={m.id} style={{ margin: '0.2rem 0' }}>
                    <strong>{ROLE_LABELS[m.role] || m.role}:</strong>{' '}
                    {m.board_member?.residents?.full_name || '—'}
                    {(() => {
                      const tower = m.board_member?.residents?.departments?.towers?.code;
                      return tower ? ` (miembro junta T${tower})` : '';
                    })()}
                  </li>
                ))}
              </ul>
              <div className="condo-card-actions" style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border,#e5e7eb)' }}>
                {b.is_active && (
                  <button className="btn-cancel" onClick={() => handleDeactivate(b.id)} disabled={submitting}>
                    <span className="material-symbols-outlined">power_off</span> Desactivar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Nueva Junta Directiva General</h3>
                <p className="text-on-surface-variant">Elige al Presidente, Secretario y Tesorero entre los miembros de las juntas directivas de las torres.</p>
              </div>
              <button className="modal-close" onClick={() => setShowForm(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Fecha de inicio (vigencia de 1 año)</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="module-example">
                <span className="material-symbols-outlined">info</span>
                <span>Solo pueden ser elegidos los miembros de las diferentes juntas directivas de las torres. La vigencia es de un año, prorrogable mediante nuevas elecciones.</span>
              </div>
              {ROLE_ORDER.map(role => (
                <div className="form-group" key={role}>
                  <label>{ROLE_LABELS[role]}</label>
                  <select
                    value={form.members[role] || ''}
                    onChange={e => setForm({ ...form, members: { ...form.members, [role]: e.target.value } })}
                  >
                    <option value="">Seleccionar miembro...</option>
                    {candidates.map(c => (
                      <option key={c.board_member_id} value={c.board_member_id}>{candidateLabel(c.board_member_id)}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="form-group">
                <label>Notas (opcional)</label>
                <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones de la junta general" />
              </div>
              {formError && <div className="error-message">{formError}</div>}
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