import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useCondominiums } from '../hooks/useCondominiums';

interface TenantUser {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  users_global?: { email: string; is_superadmin: boolean } | null;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  SECURITY_AGENT: 'Agente de Seguridad',
  RESIDENT: 'Residente',
  VISITOR: 'Visitante'
};

export function CondominioAdminDashboard() {
  const { condominium, setCondominium } = useCondominium();
  const { user } = useAuth();
  const { condominiums } = useCondominiums();
  const isSuperAdmin = user?.email === 'miguel.jaeger@gmail.com';
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'RESIDENT' });
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    if (!condominium) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: TenantUser[] | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'list', tenant_id: condominium.tenant_id, role: filterRole || undefined }
      });

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setUsers(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar usuarios');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [condominium, filterRole]);

  const handleAddUser = async () => {
    if (!condominium) return;
    setSubmitting(true);
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: { user_id: string; email: string; role: string } | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: {
          tenant_id: condominium.tenant_id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role
        }
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setShowAddForm(false);
        setNewUser({ email: '', name: '', role: 'RESIDENT' });
        fetchUsers();
      } else {
        setError(data?.error?.message || 'Error al agregar usuario');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setSubmitting(false);
    }
  };

  if (!condominium) return <div className="empty-state"><p>No hay condominio seleccionado.</p>{isSuperAdmin && <p>Seleccione un condominio desde <strong>Condominios</strong>.</p>}</div>;

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Usuarios - {condominium.name}</h2>
        <button onClick={() => setShowAddForm(true)}><span className="material-symbols-outlined">person_add</span> Adicionar</button>
      </div>
      <div className="condo-search-panel">
        {isSuperAdmin && condominiums.length > 0 && (
          <div className="search-bar" style={{ marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined search-icon">apartment</span>
            <select value={condominium.tenant_id} onChange={e => {
              const c = condominiums.find(x => x.id === e.target.value);
              if (c) setCondominium({ tenant_id: c.id, name: c.name, slug: c.slug, short_name: c.short_name || c.slug, schema_name: c.schema_name, image_url: c.image_url });
            }} style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}>
              {condominiums.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">filter_list</span>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}>
            <option value="">Todos los roles</option>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {showAddForm && (
        <div className="form-modal">
          <h3>Agregar Usuario</h3>
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Nombre completo" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="correo@ejemplo.com" required />
          </div>
          <div className="form-group">
            <label>Rol</label>
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <small>Se creará una cuenta con contraseña: <code>{newUser.email.split('@')[0]}Kytos</code></small>
          <div className="form-actions">
            <button onClick={() => setShowAddForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleAddUser} disabled={submitting}>
              <span className="material-symbols-outlined">person_add</span> {submitting ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-message">Cargando usuarios...</div>
      ) : users.length === 0 ? (
        <div className="empty-state"><p>No hay usuarios registrados en este condominio.</p></div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{(u as unknown as { email?: string }).email || u.users_global?.email || '-'}</td>
                <td>{ROLE_LABELS[u.role] || u.role}</td>
                <td><span className={`status-badge ${u.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{u.status}</span></td>
                <td>{new Date(u.created_at).toLocaleDateString('es-PE')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
