import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCondominiums } from '../hooks/useCondominiums';
import { useCondominium } from '../../../contexts/CondominiumContext';

export function SuperAdminDashboard() {
  const { condominiums, loading, error, search, setSearch, fetchCondominiums, updateCondominium, deleteCondominium } = useCondominiums();
  const { setCondominium } = useCondominium();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createData, setCreateData] = useState({ name: '', address: '', admin_phone: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', address: '', admin_phone: '' });

  const openCondominium = (e: React.MouseEvent, c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }) => {
    if (editingId || showCreate) return;
    e.stopPropagation();
    setCondominium({ tenant_id: c.id, name: c.name, slug: c.slug, short_name: c.short_name || c.slug, schema_name: c.schema_name, image_url: c.image_url });
    navigate('/setup');
  };

  const startEdit = (e: React.MouseEvent, c: { id: string; name: string; address: string | null; admin_phone: string | null }) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditData({ name: c.name, address: c.address || '', admin_phone: c.admin_phone || '' });
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingId) return;
    try {
      await updateCondominium(editingId, editData);
      setEditingId(null);
      fetchCondominiums();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleCreate = async () => {
    if (!createData.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: { tenant_id: string; name: string; slug: string; short_name: string; schema_name: string } | null; error: { message: string } | null }>('register-condominium', {
        method: 'POST',
        body: createData
      });
      if (fnError) throw fnError;
      if (data?.success && data.data) {
        setCondominium({ tenant_id: data.data.tenant_id, name: data.data.name, slug: data.data.slug, short_name: data.data.short_name, schema_name: data.data.schema_name, image_url: null });
        setShowCreate(false);
        setCreateData({ name: '', address: '', admin_phone: '' });
        fetchCondominiums();
        navigate('/setup');
      } else {
        setCreateError(data?.error?.message || 'Error al crear condominio');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar "${name}" y todos sus datos asociados?`)) return;
    try { await deleteCondominium(id); } catch (err) { alert(err instanceof Error ? err.message : 'Error al eliminar'); }
  };

  if (loading) return <div className="loading-message">Cargando condominios...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Administrar Condominios</h2>
        <button onClick={() => setShowCreate(true)}><span className="material-symbols-outlined">add_business</span> Agregar Condominio</button>
      </div>

      {showCreate && (
        <div className="form-modal">
          <h3>Nuevo Condominio</h3>
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={createData.name} onChange={e => setCreateData({ ...createData, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Dirección</label>
            <input type="text" value={createData.address} onChange={e => setCreateData({ ...createData, address: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Teléfono administración</label>
            <input type="text" value={createData.admin_phone} onChange={e => setCreateData({ ...createData, admin_phone: e.target.value })} />
          </div>
          {createError && <div className="error-message">{createError}</div>}
          <div className="form-actions">
            <button onClick={() => setShowCreate(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleCreate} disabled={creating}><span className="material-symbols-outlined">check</span> {creating ? 'Creando...' : 'Crear'}</button>
          </div>
        </div>
      )}

      <div className="search-bar">
        <input type="text" placeholder="Buscar por nombre..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {condominiums.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No se encontraron condominios.' : 'No hay condominios registrados.'}</p>
        </div>
      ) : (
        <div className="condominiums-grid">
          {condominiums.map(c => (
            <div key={c.id} className="condominium-card clickable" onClick={(e) => openCondominium(e, c)}>
              {c.image_url && <img src={c.image_url} alt={c.name} className="condo-img" />}
              <div className="condo-info">
                {editingId === c.id ? (
                  <div className="condo-edit-form" onClick={(e) => e.stopPropagation()}>
                    <label>Nombre</label>
                    <input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                    <label>Dirección</label>
                    <input value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} />
                    <label>Teléfono</label>
                    <input value={editData.admin_phone} onChange={e => setEditData({ ...editData, admin_phone: e.target.value })} />
                    <div className="form-actions">
                      <button onClick={handleSaveEdit}><span className="material-symbols-outlined">save</span> Guardar</button>
                      <button onClick={() => setEditingId(null)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3>{c.name}</h3>
                    <p>{c.address || 'Sin dirección'}</p>
                    <div className="condo-counts">
                      <span className="count-item"><span className="material-symbols-outlined">apartment</span>{c.towers_count ?? 0} torres</span>
                      <span className="count-item"><span className="material-symbols-outlined">layers</span>{c.floors_count ?? 0} pisos</span>
                      <span className="count-item"><span className="material-symbols-outlined">door_front</span>{c.departments_count ?? 0} deptos</span>
                      <span className="count-item"><span className="material-symbols-outlined">group</span>{c.residents_count ?? 0} residentes</span>
                    </div>
                    <div className="form-actions">
                      <button onClick={(e) => startEdit(e, c)}><span className="material-symbols-outlined">edit</span> Editar</button>
                      <button className="delete-btn" onClick={(e) => handleDelete(e, c.id, c.name)}><span className="material-symbols-outlined">delete</span> Eliminar</button>
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