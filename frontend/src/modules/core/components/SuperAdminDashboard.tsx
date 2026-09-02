import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCondominiums } from '../hooks/useCondominiums';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useAuth } from '../../../contexts/AuthContext';

export function SuperAdminDashboard() {
  const { condominiums, loading, error, search, setSearch, fetchCondominiums } = useCondominiums();
  const { setCondominium } = useCondominium();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createData, setCreateData] = useState({ name: '', address: '', admin_phone: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  const openCondominium = (c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }) => {
    if (showCreate) return;
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

  const handleCreate = async () => {
    if (!createData.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: { tenant_id: string; name: string; slug: string; short_name: string; schema_name: string } | null; error: { message: string } | null }>('register-condominium', {
        method: 'POST',
        body: { ...createData, owner_user_id: user?.id }
      });

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setCondominium({
          tenant_id: data.data.tenant_id,
          name: data.data.name,
          slug: data.data.slug,
          short_name: data.data.short_name,
          schema_name: data.data.schema_name,
          image_url: null
        });
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

  if (loading) return <div className="loading-message">Cargando condominios...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Administrar Condominios</h2>
        <button onClick={() => setShowCreate(true)}>+ Agregar Condominio</button>
      </div>

      {showCreate && (
        <div className="form-modal">
          <h3>Nuevo Condominio</h3>
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={createData.name} onChange={e => setCreateData({ ...createData, name: e.target.value })} placeholder="Condominio Las Flores" required />
          </div>
          <div className="form-group">
            <label>Dirección</label>
            <input type="text" value={createData.address} onChange={e => setCreateData({ ...createData, address: e.target.value })} placeholder="Av. Los Olivos 123" />
          </div>
          <div className="form-group">
            <label>Teléfono administración</label>
            <input type="text" value={createData.admin_phone} onChange={e => setCreateData({ ...createData, admin_phone: e.target.value })} placeholder="+51 999 888 777" />
          </div>
          {createError && <div className="error-message">{createError}</div>}
          <div className="form-actions">
            <button onClick={() => setShowCreate(false)}>Cancelar</button>
            <button onClick={handleCreate} disabled={creating}>{creating ? 'Creando...' : 'Crear Condominio'}</button>
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
            <div key={c.id} className="condominium-card clickable" onClick={() => openCondominium(c)}>
              {c.image_url && <img src={c.image_url} alt={c.name} className="condo-img" />}
              <div className="condo-info">
                <h3>{c.name}</h3>
                <div className="condo-counts">
                  <span className="count-item"><span className="material-symbols-outlined">apartment</span>{c.towers_count ?? 0} torres</span>
                  <span className="count-item"><span className="material-symbols-outlined">layers</span>{c.floors_count ?? 0} pisos</span>
                  <span className="count-item"><span className="material-symbols-outlined">door_front</span>{c.departments_count ?? 0} deptos</span>
                  <span className="count-item"><span className="material-symbols-outlined">group</span>{c.residents_count ?? 0} residentes</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}