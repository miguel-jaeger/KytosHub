import { useState, useEffect, useCallback } from 'react';
import { useCondoGates } from '../hooks/useCondoGates';
import type { Gate } from '../types';

const CART_TYPE_LABELS: Record<string, string> = { CARGA: 'Carga', COMPRA: 'Compras' };

const emptyForm = { name: '', code: '', is_entry_exit: true, carts_carga: 0, carts_compra: 0 };

export function GatesManager({ schemaName }: { schemaName?: string }) {
  const { list, create, update, remove } = useCondoGates();
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Gate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!schemaName) { setGates([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setGates(await list(schemaName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar puertas');
    } finally {
      setLoading(false);
    }
  }, [schemaName, list]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!schemaName) return;
    if (!form.name.trim()) { alert('El nombre de la puerta es obligatorio'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        is_entry_exit: form.is_entry_exit,
        carts_carga: Number(form.carts_carga) || 0,
        carts_compra: Number(form.carts_compra) || 0
      };
      if (editing) {
        await update(schemaName, editing.id, payload);
        setMessage('Puerta guardada');
      } else {
        await create(schemaName, payload);
        setMessage('Puerta creada');
      }
      setForm(emptyForm);
      setEditing(null);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (g: Gate) => {
    setEditing(g);
    setForm({ name: g.name, code: g.code || '', is_entry_exit: g.is_entry_exit, carts_carga: g.carts_carga, carts_compra: g.carts_compra });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(false);
  };

  const toggleActive = async (g: Gate) => {
    if (!schemaName) return;
    try {
      await update(schemaName, g.id, { is_active: !g.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleDelete = async (g: Gate) => {
    if (!schemaName) return;
    if (!confirm(`¿Eliminar la puerta "${g.name}"?`)) return;
    try {
      await remove(schemaName, g.id);
      setMessage('Puerta eliminada');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  if (loading) return <div className="loading-message">Cargando puertas...</div>;
  if (error && gates.length === 0) return <div className="error-message">{error} — clic para cerrar</div>;

  return (
    <div>
      <div className="header">
        <div>
          <h2>Puertas del Condominio</h2>
          <small>Define las puertas/garitas con su nombre y cuántos carritos de cada tipo están asignados. Se generan automáticamente los carritos físicos según la capacidad. Se reutilizan como puntos de ingreso/salida del estacionamiento.</small>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm); }}>
            <span className="material-symbols-outlined">add_business</span> Adicionar
          </button>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {showForm && (
        <div className="cart-form">
          <h4>{editing ? 'Editar Puerta' : 'Registrar Puerta'}</h4>
          <div className="form-row">
            <div className="form-group">
              <label>Nombre</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Puerta Principal" autoFocus />
            </div>
            <div className="form-group">
              <label>Código (opcional)</label>
              <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Ej: P1" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Carritos de carga asignados</label>
              <input type="number" min={0} value={form.carts_carga} onChange={e => setForm({ ...form, carts_carga: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label>Carritos de compras asignados</label>
              <input type="number" min={0} value={form.carts_compra} onChange={e => setForm({ ...form, carts_compra: Number(e.target.value) })} />
            </div>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.is_entry_exit} onChange={e => setForm({ ...form, is_entry_exit: e.target.checked })} />
            <span>Es punto de ingreso/salida de vehículos (estacionamiento)</span>
          </label>
          <div className="form-actions">
            <button className="btn-cancel" onClick={cancelEdit}>Cancelar</button>
            <button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : editing ? 'Guardar' : 'Registrar'}</button>
          </div>
        </div>
      )}

      {gates.length === 0 ? (
        <div className="empty-state">
          <p>No hay puertas registradas aún. Registra la primera puerta.</p>
          <button onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm); }}>
            <span className="material-symbols-outlined">add_business</span> Adicionar
          </button>
        </div>
      ) : (
        <table className="residents-table residents-desktop">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>·</th>
              <th>Carritos carga</th>
              <th>Carritos compras</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gates.map(g => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.code || '-'}</td>
                <td>{g.is_entry_exit ? <span className="btn-edit" style={{ padding: '0.2rem 0.5rem' }}>Vehículos</span> : '-'}</td>
                <td>{g.carts_carga} de {CART_TYPE_LABELS.CARGA}</td>
                <td>{g.carts_compra} de {CART_TYPE_LABELS.COMPRA}</td>
                <td><span className={`status-badge ${g.is_active ? 'status-occupied' : 'status-vacant'}`}>{g.is_active ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  <div className="resident-row-actions">
                    <button className="btn-edit" onClick={() => startEdit(g)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                    <button className={g.is_active ? 'btn-danger' : 'btn-edit'} onClick={() => toggleActive(g)} title={g.is_active ? 'Desactivar' : 'Activar'}>
                      <span className="material-symbols-outlined">{g.is_active ? 'toggle_off' : 'toggle_on'}</span>
                    </button>
                    <button className="btn-edit" onClick={() => handleDelete(g)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
