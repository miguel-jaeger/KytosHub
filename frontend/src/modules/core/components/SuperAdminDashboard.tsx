import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCondominiums } from '../hooks/useCondominiums';
import { useCondominium } from '../../../contexts/CondominiumContext';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';

export function SuperAdminDashboard() {
  const { condominiums, loading, error, search, setSearch, updateCondominium, deleteCondominium } = useCondominiums();
  const { setCondominium } = useCondominium();
  const navigate = useNavigate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', address: '', admin_phone: '' });
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEdit = (c: { id: string; name: string; address: string | null; admin_phone: string | null }) => {
    setEditingId(c.id);
    setEditData({ name: c.name, address: c.address || '', admin_phone: c.admin_phone || '' });
    setEditImageFile(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const updates: { name: string; address: string; admin_phone: string; image_url?: string } = { ...editData };
      if (editImageFile) {
        const url = await uploadImage(editImageFile, editingId);
        if (url) updates.image_url = url;
      }
      await updateCondominium(editingId, updates);
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File, condoId: string) => {
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      alert('Cloudinary no configurado');
      return null;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', UPLOAD_PRESET);
    fd.append('folder', `condominios/${condoId}`);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('No se pudo subir la imagen');
    const data = await res.json();
    return data.secure_url as string;
  };

  const openSection = (c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }, section: string) => {
    setCondominium({
      tenant_id: c.id,
      name: c.name,
      slug: c.slug,
      short_name: c.short_name || c.slug,
      schema_name: c.schema_name,
      image_url: c.image_url
    });
    navigate(`/setup?section=${section}`);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar "${name}" y todos sus datos asociados?`)) return;
    try { await deleteCondominium(id); } catch (err) { alert((err as Error).message); }
  };

  if (loading) return <div className="loading-message">Cargando condominios...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Administrar Condominios</h2>
        <button onClick={() => navigate('/setup')} className="btn-add-condo">
          <span className="material-symbols-outlined">add_business</span> Adicionar
        </button>
      </div>

      <div className="condo-search-panel">
        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">search</span>
          <input type="text" placeholder="Buscar condominio por nombre..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="clear-search" onClick={() => setSearch('')}><span className="material-symbols-outlined">close</span></button>}
        </div>
        <div className="condo-count">
          <span className="material-symbols-outlined">apartment</span>
          {condominiums.length} condominio{condominiums.length !== 1 ? 's' : ''} registrado{condominiums.length !== 1 ? 's' : ''}
        </div>
      </div>

      {condominiums.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No se encontraron condominios.' : 'No hay condominios registrados.'}</p>
          {!search && <p>Use el botón "Adicionar" para registrar uno.</p>}
        </div>
      ) : (
        <div className="condominiums-grid">
          {condominiums.map(c => (
            <div key={c.id} className="condominium-card">
              {editingId !== c.id && (
                <div className="condo-thumb">
                  {c.image_url ? (
                    <img src={c.image_url} alt={c.name} />
                  ) : (
                    <div className="condo-thumb-placeholder">
                      <span className="material-symbols-outlined">apartment</span>
                    </div>
                  )}
                </div>
              )}
              <div className="condo-info">
                {editingId === c.id ? (
                  <div className="condo-edit-form">
                    <div className="form-group">
                      <label>Nombre</label>
                      <input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Dirección</label>
                      <input value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Teléfono administración</label>
                      <input value={editData.admin_phone} onChange={e => setEditData({ ...editData, admin_phone: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Imagen del condominio</label>
                      <div className="image-uploader">
                        <div className="image-click-area" onClick={() => fileInputRef.current?.click()} title="Haz clic para seleccionar una imagen">
                          {editImageFile ? (
                            <div className="image-preview">
                              <img src={URL.createObjectURL(editImageFile)} alt="Nueva imagen" />
                            </div>
                          ) : c.image_url ? (
                            <div className="image-preview">
                              <img src={c.image_url} alt={c.name} />
                            </div>
                          ) : (
                            <div className="image-placeholder">
                              <span className="material-symbols-outlined">add_a_photo</span>
                              <p>Selecciona una imagen</p>
                            </div>
                          )}
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={e => setEditImageFile(e.target.files?.[0] || null)} />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button onClick={() => setEditingId(null)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                      <button onClick={handleSaveEdit} disabled={saving}><span className="material-symbols-outlined">save</span> {saving ? 'Guardando...' : 'Guardar'}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3>{c.name}</h3>
                    <p>{c.address || 'Sin dirección'}</p>
                    <span className={`status-badge ${c.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{c.status}</span>

                    <div className="condo-counts">
                      <button className="count-link" onClick={() => openSection(c, 'towers')} title="Gestionar torres">
                        <span className="material-symbols-outlined">apartment</span>
                        <span>{c.towers_count ?? 0} torres</span>
                      </button>
                      <button className="count-link" onClick={() => openSection(c, 'floors')} title="Gestionar pisos">
                        <span className="material-symbols-outlined">layers</span>
                        <span>{c.floors_count ?? 0} pisos</span>
                      </button>
                      <button className="count-link" onClick={() => openSection(c, 'departments')} title="Gestionar departamentos">
                        <span className="material-symbols-outlined">door_front</span>
                        <span>{c.departments_count ?? 0} deptos</span>
                      </button>
                      <button className="count-link" onClick={() => openSection(c, 'residents')} title="Gestionar residentes">
                        <span className="material-symbols-outlined">group</span>
                        <span>{c.residents_count ?? 0} residentes</span>
                      </button>
                    </div>

                    <div className="condo-card-actions">
                      <button className="icon-btn" onClick={() => startEdit(c)} title="Editar condominio">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button className="icon-btn danger" onClick={() => handleDelete(c.id, c.name)} title="Eliminar condominio">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
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