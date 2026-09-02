import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCondominium } from '../contexts/CondominiumContext';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  requiresCondo?: boolean;
  requiresAdmin?: boolean;
}

const navItems: NavItem[] = [
  { path: '/', icon: 'dashboard', label: 'Inicio' },
  { path: '/admin/condominiums', icon: 'apartment', label: 'Condominios', requiresAdmin: true },
  { path: '/setup', icon: 'settings', label: 'Configurar', requiresCondo: true },
  { path: '/admin/users', icon: 'group', label: 'Usuarios', requiresCondo: true },
  { path: '/profile', icon: 'account_circle', label: 'Mi Perfil' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { condominium } = useCondominium();

  const isSuperAdmin = user?.email === 'miguel.jaeger@gmail.com';

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
          {condominium.image_url && <img src={condominium.image_url} alt={condominium.name} />}
          <span>{condominium.name}</span>
        </div>
      )}

      <nav className="sidebar-nav">
        {navItems.filter(item => {
          if (item.requiresAdmin && !isSuperAdmin) return false;
          if (item.requiresCondo && !condominium) return false;
          return true;
        }).map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`sidebar-link ${location.pathname === item.path ? 'active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {!collapsed && <span className="sidebar-label">{item.label}</span>}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && user && (
          <span className="sidebar-user">{user.email}</span>
        )}
        <button className="sidebar-logout" onClick={signOut} title="Cerrar sesión">
          <span className="material-symbols-outlined">logout</span>
          {!collapsed && <span>Salir</span>}
        </button>
      </div>
    </aside>
  );
}