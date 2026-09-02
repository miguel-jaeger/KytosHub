import { useState, useEffect, useRef } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useCondominiums } from '../hooks/useCondominiums';
import { PaginationBar, paginate } from '../../../components/Pagination';

interface TenantUser {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  name?: string;
  email?: string;
  source?: 'tenant_user' | 'resident';
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
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'RESIDENT', tenant_id: '' });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  const [condoSearch, setCondoSearch] = useState(condominium?.name || '');
  const [condoDropdownOpen, setCondoDropdownOpen] = useState(false);
  const condoDropdownRef = useRef<HTMLDivElement>(null);

  const [addCondoSearch, setAddCondoSearch] = useState('');
  const [addCondoDropdownOpen, setAddCondoDropdownOpen] = useState(false);
  const addCondoDropdownRef = useRef<HTMLDivElement>(null);

  const openAddForm = () => {
    const initial = condominium?.tenant_id || '';
    const initialName = condominiums.find(c => c.id === initial)?.name || '';
    setNewUser({ email: '', name: '', role: 'RESIDENT', tenant_id: initial });
    setAddCondoSearch(initialName);
    setShowAddForm(true);
  };
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    if (!condominium) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: TenantUser[] | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'list', tenant_id: condominium.tenant_id }
      });

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setUsers(data.data);
        setPage(1);
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
  }, [condominium]);

  const filteredUsers = users.filter(u => {
    const q = searchTerm.trim().toLowerCase();
    const email = (u.email || u.users_global?.email || '').toLowerCase();
    const name = (u.name || '').toLowerCase();
    const matchesSearch = !q || email.includes(q) || name.includes(q);
    const matchesRole = !filterRole || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const { slice: pagedUsers } = paginate(filteredUsers, page, perPage === 'all' ? filteredUsers.length : perPage);

  const handleAddUser = async () => {
    if (!condominium) return;
    setSubmitting(true);
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: { user_id: string; email: string; role: string } | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: {
          tenant_id: newUser.tenant_id || condominium.tenant_id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role
        }
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setShowAddForm(false);
        setNewUser({ email: '', name: '', role: 'RESIDENT', tenant_id: '' });
        setAddCondoSearch('');
        if (condominium && newUser.tenant_id && newUser.tenant_id !== condominium.tenant_id) {
          setCondominium({
            tenant_id: newUser.tenant_id,
            name: condominiums.find(c => c.id === newUser.tenant_id)?.name || '',
            slug: condominiums.find(c => c.id === newUser.tenant_id)?.slug || '',
            short_name: condominiums.find(c => c.id === newUser.tenant_id)?.short_name || '',
            schema_name: condominiums.find(c => c.id === newUser.tenant_id)?.schema_name || '',
            image_url: null
          });
        }
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

  const startEdit = (u: TenantUser) => {
    setEditingUser(u);
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      const body: Record<string, unknown> = {
        action: 'update',
        id: editingUser.id,
        source: editingUser.source || 'tenant_user',
        name: editingUser.name,
        email: editingUser.email
      };
      if (editingUser.source === 'resident') {
        body.schema_name = condominium?.schema_name;
      } else {
        body.role = editingUser.role;
        body.status = editingUser.status;
      }

      const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error?.message || 'Error al actualizar usuario');
        return;
      }
      setShowEditForm(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  const handleDeleteUser = async (u: TenantUser) => {
    const label = u.name || u.email || u.user_id;
    if (!confirm(`¿Eliminar el usuario "${label}"? Esta acción no se puede deshacer.`)) return;
    try {
      const body: Record<string, unknown> = {
        action: 'delete',
        id: u.id,
        source: u.source || 'tenant_user'
      };
      if (u.source === 'resident') body.schema_name = condominium?.schema_name;

      const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error?.message || 'Error al eliminar usuario');
        return;
      }
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  useEffect(() => {
    setCondoSearch(condominium?.name || '');
    setCondoDropdownOpen(false);
  }, [condominium]);

  const selectCondo = (c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }) => {
    setCondominium({
      tenant_id: c.id,
      name: c.name,
      slug: c.slug,
      short_name: c.short_name || c.slug,
      schema_name: c.schema_name,
      image_url: c.image_url
    });
    setCondoSearch(c.name);
    setCondoDropdownOpen(false);
  };

  const filteredCondos = condominiums.filter(c => c.name.toLowerCase().includes(condoSearch.trim().toLowerCase()));

  const filteredAddCondos = condominiums.filter(c => c.name.toLowerCase().includes(addCondoSearch.trim().toLowerCase()));

  const selectAddCondo = (c: { id: string; name: string }) => {
    setNewUser(prev => ({ ...prev, tenant_id: c.id }));
    setAddCondoSearch(c.name);
    setAddCondoDropdownOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (condoDropdownRef.current && !condoDropdownRef.current.contains(e.target as Node)) {
        setCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addCondoDropdownRef.current && !addCondoDropdownRef.current.contains(e.target as Node)) {
        setAddCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Usuarios - {condominium?.name || 'Seleccione un condominio'}</h2>
        {condominium && <button onClick={openAddForm}><span className="material-symbols-outlined">person_add</span> Adicionar</button>}
      </div>
      <div className="condo-search-panel">
        {isSuperAdmin && condominiums.length > 0 && (
          <div className="search-bar condo-picker" ref={condoDropdownRef} style={{ marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined search-icon">apartment</span>
            <input
              type="text"
              value={condoSearch}
              placeholder="Buscar condominio..."
              onFocus={() => setCondoDropdownOpen(true)}
              onChange={(e) => { setCondoSearch(e.target.value); setCondoDropdownOpen(true); }}
              style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}
            />
            {condoDropdownOpen && (
              <div className="condo-picker-dropdown">
                {filteredCondos.length === 0 ? (
                  <div className="condo-picker-empty">Sin resultados</div>
                ) : (
                  filteredCondos.map(c => (
                    <button key={c.id} type="button" className={`condo-picker-item ${c.id === condominium?.tenant_id ? 'selected' : ''}`} onClick={() => selectCondo(c)}>
                      <span className="material-symbols-outlined">apartment</span>
                      <span>{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">search</span>
          <input type="text" placeholder="Buscar usuario por nombre o correo..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }} />
          {searchTerm && <button className="clear-search" onClick={() => setSearchTerm('')}><span className="material-symbols-outlined">close</span></button>}
        </div>
        <div className="search-bar" style={{ marginTop: '0.75rem' }}>
          <span className="material-symbols-outlined search-icon">filter_list</span>
          <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}>
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
          {isSuperAdmin && (
            <div className="form-group">
              <label>Condominio</label>
              <div className="search-bar condo-picker" ref={addCondoDropdownRef}>
                <input
                  type="text"
                  value={addCondoSearch}
                  placeholder="Buscar condominio..."
                  style={{ paddingLeft: '0.75rem' }}
                  onFocus={() => setAddCondoDropdownOpen(true)}
                  onChange={(e) => { setAddCondoSearch(e.target.value); setAddCondoDropdownOpen(true); }}
                />
                {addCondoDropdownOpen && (
                  <div className="condo-picker-dropdown">
                    {filteredAddCondos.length === 0 ? (
                      <div className="condo-picker-empty">Sin resultados</div>
                    ) : (
                      filteredAddCondos.map(c => (
                        <button key={c.id} type="button" className={`condo-picker-item ${c.id === newUser.tenant_id ? 'selected' : ''}`} onClick={() => selectAddCondo(c)}>
                          <span className="material-symbols-outlined">apartment</span>
                          <span>{c.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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
          <small>Se creará una cuenta con contraseña: <code>12345678</code></small>
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowAddForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleAddUser} disabled={submitting}>
              <span className="material-symbols-outlined">person_add</span> {submitting ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {showEditForm && editingUser && (
        <div className="form-modal">
          <h3>Editar Usuario</h3>
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={editingUser.name || ''} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} />
          </div>
          {editingUser.source !== 'resident' && (
            <>
              <div className="form-group">
                <label>Rol</label>
                <select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={editingUser.status} onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>
            </>
          )}
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowEditForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleSaveEdit}><span className="material-symbols-outlined">save</span> Guardar</button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-message">Cargando usuarios...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="empty-state"><p>No hay usuarios registrados en este condominio.</p></div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map(u => (
                <tr key={`${u.id}-${u.user_id}`}>
                  <td>{u.name || '-'}</td>
                  <td>{u.email || u.users_global?.email || '-'}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td><span className={`status-badge ${u.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{u.status}</span></td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('es-PE') : '-'}</td>
                  <td>
                    <div className="condo-card-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', justifyContent: 'flex-start' }}>
                      <button className="icon-btn" onClick={() => startEdit(u)} title="Editar usuario">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button className="icon-btn danger" onClick={() => handleDeleteUser(u)} title="Eliminar usuario">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <PaginationBar
            total={filteredUsers.length}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={(n) => setPerPage(n)}
            itemLabel="usuario"
          />
        </>
      )}
    </div>
  );
}