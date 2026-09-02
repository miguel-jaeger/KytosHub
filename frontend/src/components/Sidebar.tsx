import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCondominium } from '../contexts/CondominiumContext';
import { useUserRole, useRoleLabel, SUPER_ADMIN_EMAIL } from '../hooks/useUserRole';
import { invokeFunction } from '../lib/insforge';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 820;
    return false;
  });
  const [condoImgFailed, setCondoImgFailed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { condominium, setCondominium } = useCondominium();

  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;
  const role = useUserRole();
  const displayRole = role === 'super' ? 'Super Admin' : useRoleLabel(role);
  const canManageUsers = role === 'super' || role === 'admin';
  const canManageCondo = role === 'admin';

  const openMyCondominium = async () => {
    if (!user) return;
    setCondominium(null);
    try {
      const { data } = await invokeFunction<{ success: boolean; data: { tenant_id: string; role: string; status: string }[] | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'list-by-user', user_id: user.id }
      });
      const active = (data?.data || []).filter(x => x.status === 'ACTIVE');
      const tenantId = active[0]?.tenant_id;
      if (tenantId) {
        const { data: condo } = await invokeFunction<{ success: boolean; data: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null } | null }>('list-condominiums', {
          method: 'POST',
          body: { action: 'list', id: tenantId }
        });
        const c = condo?.data;
        if (c) {
          setCondominium({
            tenant_id: c.id,
            name: c.name,
            slug: c.slug,
            short_name: c.short_name || c.slug,
            schema_name: c.schema_name,
            image_url: c.image_url
          });
        }
      }
    } catch {}
    navigate('/setup');
  };

  const linkClass = (path: string) => `sidebar-link ${location.pathname === path ? 'active' : ''}`;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!collapsed && <span className="sidebar-logo-text">KytosHub</span>}
        <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
          <span className="material-symbols-outlined">{collapsed ? 'menu_open' : 'menu'}</span>
        </button>
      </div>

      {!collapsed && condominium && (
        <div className="sidebar-condominium">
          {condominium.image_url && !condoImgFailed && <img src={condominium.image_url} alt={condominium.name} onError={() => setCondoImgFailed(true)} />}
          <span>{condominium.name}</span>
        </div>
      )}

      <nav className="sidebar-nav">
        <Link to="/" className={linkClass('/')} title={collapsed ? 'Inicio' : undefined}>
          <span className="material-symbols-outlined">dashboard</span>
          {!collapsed && <span className="sidebar-label">Inicio</span>}
        </Link>

        {isSuperAdmin && (
          <Link to="/admin/condominiums" className={linkClass('/admin/condominiums')} title={collapsed ? 'Condominios' : undefined}>
            <span className="material-symbols-outlined">apartment</span>
            {!collapsed && <span className="sidebar-label">Condominios</span>}
          </Link>
        )}

        {canManageCondo && (
          <button onClick={openMyCondominium} className={`sidebar-link ${location.pathname === '/setup' ? 'active' : ''}`} title={collapsed ? 'Mi Condominio' : undefined}>
            <span className="material-symbols-outlined">home_work</span>
            {!collapsed && <span className="sidebar-label">Mi Condominio</span>}
          </button>
        )}

        {canManageUsers && (
          <Link to="/admin/users" className={linkClass('/admin/users')} title={collapsed ? 'Gestionar Usuarios' : undefined}>
            <span className="material-symbols-outlined">group</span>
            {!collapsed && <span className="sidebar-label">Gestionar Usuarios</span>}
          </Link>
        )}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <Link to="/profile" className="sidebar-user" title="Ir a Mi Perfil">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="avatar" className="sidebar-avatar" />
            ) : (
              <span className="material-symbols-outlined sidebar-avatar-icon">account_circle</span>
            )}
            {!collapsed && (
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{user.name || user.email}</span>
                <span className="sidebar-user-role">{displayRole}</span>
              </div>
            )}
          </Link>
        )}
        <button className="sidebar-logout" onClick={signOut} title="Cerrar sesión">
          <span className="material-symbols-outlined">logout</span>
          {!collapsed && <span>Salir</span>}
        </button>
      </div>
    </aside>
  );
}