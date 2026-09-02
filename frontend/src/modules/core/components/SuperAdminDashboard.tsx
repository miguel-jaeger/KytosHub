import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCondominiums } from '../hooks/useCondominiums';
import { useCondominium } from '../../../contexts/CondominiumContext';

export function SuperAdminDashboard() {
  const { condominiums, loading, error, search, setSearch, updateCondominium, deleteCondominium } = useCondominiums();
  const { setCondominium } = useCondominium();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', address: '', admin_phone: '' });

  const startEdit = (e: React.MouseEvent, c: { id: string; name: string; address: string | null; admin_phone: string | null }) => {
    e.stopPropagation();
    setEditing(c.id);
    setEditData({ name: c.name, address: c.address || '', admin_phone: c.admin_phone || '' });
  };

  const saveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing) return;
    try {
      await updateCondominium(editing, editData);
      setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar "${name}" y todos sus datos asociados? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteCondominium(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  const openCondominium = (c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }) => {
    if (editing) return;
    setCondominium({
      tenant_id: c.id,
      name: c.name,
      slug: c.slug,
      short_name: c.short_name || c.slug,
      schema_name: c.schema_name,
      image_url: c.image_url
    });
    navigate('/structure');
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
          placeholder="Buscar por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {condominiums.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No se encontraron condominios.' : 'No hay condominios registrados.'}</p>
        </div>
      ) : (
        <div className="condominiums-grid">
          {condominiums.map(c => (
            <div
              key={c.id}
              className={`condominium-card ${editing !== c.id ? 'clickable' : ''}`}
              onClick={() => openCondominium(c)}
            >
              {c.image_url && <img src={c.image_url} alt={c.name} className="condo-img" />}
              <div className="condo-info">
                {editing === c.id ? (
                  <div className="condo-edit-form" onClick={(e) => e.stopPropagation()}>
                    <label>Nombre</label>
                    <input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                    <label>Dirección</label>
                    <input value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} />
                    <label>Teléfono</label>
                    <input value={editData.admin_phone} onChange={e => setEditData({ ...editData, admin_phone: e.target.value })} />
                    <div className="form-actions">
                      <button onClick={saveEdit}>Guardar</button>
                      <button onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3>{c.name}</h3>
                    <p>{c.address || 'Sin dirección'}</p>
                    <p>{c.admin_phone || 'Sin teléfono'}</p>
                    <span className={`status-badge ${c.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{c.status}</span>
                    <div className="form-actions">
                      <button onClick={(e) => startEdit(e, c)}>Editar</button>
                      <button className="delete-btn" onClick={(e) => handleDelete(e, c.id, c.name)}>Eliminar</button>
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