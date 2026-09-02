import { useState } from 'react';
import { useCondominiums } from '../hooks/useCondominiums';

export function SuperAdminDashboard() {
  const { condominiums, loading, error, search, setSearch, updateCondominium, deleteCondominium } = useCondominiums();
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', address: '', admin_phone: '' });

  const startEdit = (c: { id: string; name: string; address: string | null; admin_phone: string | null }) => {
    setEditing(c.id);
    setEditData({ name: c.name, address: c.address || '', admin_phone: c.admin_phone || '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await updateCondominium(editing, editData);
      setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar "${name}" y todos sus datos asociados? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteCondominium(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  if (loading) return <div className="loading-message">Cargando condominios...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Administrar Condominios</h2>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Buscar por nombre, slug o dirección..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {condominiums.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No se encontraron condominios con ese criterio.' : 'No hay condominios registrados.'}</p>
          {!search && <p>Use el asistente de configuración para crear uno.</p>}
        </div>
      ) : (
        <div className="condominiums-grid">
          {condominiums.map(c => (
            <div key={c.id} className="condominium-card">
              {c.image_url && <img src={c.image_url} alt={c.name} className="condo-img" />}
              <div className="condo-info">
                {editing === c.id ? (
                  <>
                    <input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} placeholder="Nombre" />
                    <input value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} placeholder="Dirección" />
                    <input value={editData.admin_phone} onChange={e => setEditData({ ...editData, admin_phone: e.target.value })} placeholder="Teléfono" />
                    <div className="form-actions">
                      <button onClick={saveEdit}>Guardar</button>
                      <button onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{c.name}</h3>
                    <p className="text-on-surface-variant">{c.address || 'Sin dirección'}</p>
                    <p className="text-on-surface-variant">{c.admin_phone || 'Sin teléfono'}</p>
                    <span className={`status-badge ${c.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{c.status}</span>
                    <div className="form-actions">
                      <button onClick={() => startEdit(c)}>Editar</button>
                      <button className="delete-btn" onClick={() => handleDelete(c.id, c.name)}>Eliminar</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}