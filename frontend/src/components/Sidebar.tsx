import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCondominium } from '../contexts/CondominiumContext';
import { useUserRole, useRoleLabel } from '../hooks/useUserRole';
import { useCondoModules } from '../modules/core/hooks/useCondoModules';
import { invokeFunction } from '../lib/insforge';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 820 : false));
  const [condoImgFailed, setCondoImgFailed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { condominium, setCondominium } = useCondominium();
  const { list: listModules } = useCondoModules();
  const [visitorEnabled, setVisitorEnabled] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Resolve the condominium schema even when the shared context has not
        // been populated yet, so residents always see the visitor module.
        let schema = condominium?.schema_name || '';
        if (!schema && user) {
          const { data } = await invokeFunction<{ success: boolean; data: { tenant_id: string; role: string; status: string }[] | null }>('list-condominium-users', {
            method: 'POST',
            body: { action: 'list-by-user', user_id: user.id }
          });
          const tenantId = (data?.data || []).find(x => x.status === 'ACTIVE')?.tenant_id;
          if (tenantId) {
            const { data: condo } = await invokeFunction<{ success: boolean; data: { schema_name: string } | null }>('list-condominiums', {
              method: 'POST',
              body: { action: 'list', id: tenantId }
            });
            schema = condo?.data?.schema_name || '';
          }
        }
        if (!schema) { if (!cancelled) setVisitorEnabled(false); return; }
        const r = await listModules(schema);
        if (!cancelled) setVisitorEnabled(r.modules.some(m => m.module_key === 'visitor_access' && m.is_enabled));
      } catch {
        if (!cancelled) setVisitorEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [condominium?.schema_name, user, listModules]);

  const role = useUserRole();
  const isSuperAdmin = role === 'super';
  const displayRole = role === 'super' ? 'Super Admin' : useRoleLabel(role);
  const canManageUsers = role === 'super' || role === 'admin';
  const canManageCondo = role === 'admin';
  const isSecurity = role === 'security';
  const isResident = role === 'resident';
  const canSeeVisitors = visitorEnabled && (isResident || isSecurity || canManageCondo || isSuperAdmin);

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

  if (isMobile) {
    return (
      <nav className="mobile-navbar">
        <Link to="/" className={`mobile-nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          <span className="material-symbols-outlined">dashboard</span>
          {!collapsed && <span className="mobile-nav-label">Inicio</span>}
        </Link>

        {isSecurity && (
          <Link to="/garita" className={`mobile-nav-link ${location.pathname === '/garita' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">shield</span>
            {!collapsed && <span className="mobile-nav-label">Garita</span>}
          </Link>
        )}

        {isResident && (
          <Link to="/parking" className={`mobile-nav-link ${location.pathname === '/parking' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">local_parking</span>
            {!collapsed && <span className="mobile-nav-label">Mi Estacionamiento</span>}
          </Link>
        )}

        {canSeeVisitors && (
          <Link to="/visitor" className={`mobile-nav-link ${location.pathname === '/visitor' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">badge</span>
            {!collapsed && <span className="mobile-nav-label">Visitas</span>}
          </Link>
        )}

        {isSuperAdmin && (
          <Link to="/admin/condominiums" className={`mobile-nav-link ${location.pathname === '/admin/condominiums' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">apartment</span>
            {!collapsed && <span className="mobile-nav-label">Condominios</span>}
          </Link>
        )}

        {canManageCondo && (
          <button onClick={openMyCondominium} className={`mobile-nav-link ${location.pathname === '/setup' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">home_work</span>
            {!collapsed && <span className="mobile-nav-label">Mi Cond</span>}
          </button>
        )}

        {canManageUsers && (
          <Link to="/admin/users" className={`mobile-nav-link ${location.pathname === '/admin/users' ? 'active' : ''}`}>
            <span className="material-symbols-outlined">group</span>
            {!collapsed && <span className="mobile-nav-label">Usuarios</span>}
          </Link>
        )}

        <Link to="/profile" className={`mobile-nav-link ${location.pathname === '/profile' ? 'active' : ''}`}>
          <span className="material-symbols-outlined">account_circle</span>
          {!collapsed && <span className="mobile-nav-label">Perfil</span>}
        </Link>

        <button className="mobile-nav-link mobile-logout" onClick={signOut} title="Cerrar sesión">
          <span className="material-symbols-outlined">logout</span>
          {!collapsed && <span className="mobile-nav-label">Salir</span>}
        </button>
      </nav>
    );
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!collapsed && <span className="sidebar-logo-text">KytosHub</span>}
        <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expandir menú' : 'Colapsar menú'} aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}>
          <span className="material-symbols-outlined">{collapsed ? 'last_page' : 'first_page'}</span>
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

        {isSecurity && (
          <Link to="/garita" className={linkClass('/garita')} title={collapsed ? 'Garita' : undefined}>
            <span className="material-symbols-outlined">shield</span>
            {!collapsed && <span className="sidebar-label">Garita</span>}
          </Link>
        )}

        {isResident && (
          <Link to="/parking" className={linkClass('/parking')} title={collapsed ? 'Mi Estacionamiento' : undefined}>
            <span className="material-symbols-outlined">local_parking</span>
            {!collapsed && <span className="sidebar-label">Mi Estacionamiento</span>}
          </Link>
        )}

        {canSeeVisitors && (
          <Link to="/visitor" className={linkClass('/visitor')} title={collapsed ? 'Visitas' : undefined}>
            <span className="material-symbols-outlined">badge</span>
            {!collapsed && <span className="sidebar-label">Visitas</span>}
          </Link>
        )}

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
