import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './hooks/useTheme';
import { useCondominium } from './contexts/CondominiumContext';
import { useUserRole } from './hooks/useUserRole';
import { useCondoModules } from './modules/core/hooks/useCondoModules';
import type { ModuleInfo } from './modules/core/types';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { GaritaPage } from './pages/GaritaPage';
import { ParkingPage } from './pages/ParkingPage';
import { SetupWizard } from './modules/core/components/SetupWizard';
import { SuperAdminDashboard } from './modules/core/components/SuperAdminDashboard';
import { CondominioAdminDashboard } from './modules/core/components/CondominioAdminDashboard';
import { invokeFunction } from './lib/insforge';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-on-surface-variant">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppShell() {
  useTheme();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div className="app-layout">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/garita" element={<GaritaPage />} />
          <Route path="/parking" element={<ParkingPage />} />
          <Route path="/admin/condominiums" element={<SuperAdminDashboard />} />
          <Route path="/admin/users" element={<AdminUsersRoute><CondominioAdminDashboard /></AdminUsersRoute>} />
          <Route path="/setup" element={<SetupWizard />} />
        </Routes>
      </div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const role = useUserRole();
  const { condominium, setCondominium } = useCondominium();
  const { list: listModules } = useCondoModules();
  const navigate = useNavigate();
  const canManageUsers = role === 'super' || role === 'admin';
  const canManageCondo = role === 'admin';
  const isSecurity = role === 'security';
  const isGaritaOperator = role === 'security';

  const [schemaName, setSchemaName] = useState<string | null>(condominium?.schema_name || null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [activeModules, setActiveModules] = useState<ModuleInfo[]>([]);

  useEffect(() => {
    if (condominium?.schema_name) {
      setSchemaName(condominium.schema_name);
      setTenantId(condominium.tenant_id);
      return;
    }
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await invokeFunction<{ success: boolean; data: { tenant_id: string; role: string; status: string }[] | null }>('list-condominium-users', {
          method: 'POST',
          body: { action: 'list-by-user', user_id: user.id }
        });
        const active = (data?.data || []).filter(x => x.status === 'ACTIVE');
        const tenant = active[0]?.tenant_id;
        if (!tenant) return;
        setTenantId(tenant);
        const { data: condo } = await invokeFunction<{ success: boolean; data: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null } | null }>('list-condominiums', {
          method: 'POST',
          body: { action: 'list', id: tenant }
        });
        const c = condo?.data;
        if (!cancelled && c) {
          setSchemaName(c.schema_name);
          setCondominium({ tenant_id: c.id, name: c.name, slug: c.slug, short_name: c.short_name || c.slug, schema_name: c.schema_name, image_url: c.image_url });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, condominium, setCondominium]);

  useEffect(() => {
    if (!schemaName) { setActiveModules([]); return; }
    let cancelled = false;
    listModules(schemaName)
      .then(r => { if (!cancelled) setActiveModules(r.modules.filter(m => m.is_enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [schemaName, listModules]);

  const openMyCondominium = async () => {
    if (!user) return;
    setCondominium(null);
    try {
      const { data } = await invokeFunction<{ success: boolean; data: { tenant_id: string; role: string; status: string }[] | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'list-by-user', user_id: user.id }
      });
      const active = (data?.data || []).filter(x => x.status === 'ACTIVE');
      const tenantId2 = active[0]?.tenant_id;
      if (tenantId2) {
        const { data: condo } = await invokeFunction<{ success: boolean; data: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null } | null }>('list-condominiums', {
          method: 'POST',
          body: { action: 'list', id: tenantId2 }
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

  const openCondoSection = async (section: string) => {
    if (!condominium && tenantId) {
      try {
        const { data: condo } = await invokeFunction<{ success: boolean; data: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null } | null }>('list-condominiums', {
          method: 'POST',
          body: { action: 'list', id: tenantId }
        });
        const c = condo?.data;
        if (c) {
          setCondominium({ tenant_id: c.id, name: c.name, slug: c.slug, short_name: c.short_name || c.slug, schema_name: c.schema_name, image_url: c.image_url });
        }
      } catch {}
    }
    navigate(`/setup?section=${section}`);
  };

  const modulesByAccess: { to?: string; onClick?: () => void; title: string; desc: string; icon: string }[] = [];
  for (const m of activeModules) {
    if (m.module_key === 'parking_control') {
      if (role === 'security') modulesByAccess.push({ to: '/garita', title: 'Estacionamiento', desc: 'Control de entradas y salidas en garita', icon: 'local_parking' });
      else if (role === 'resident') modulesByAccess.push({ to: '/parking', title: 'Mi Estacionamiento', desc: 'Tus estacionamientos, vehículos y préstamos', icon: 'local_parking' });
      else if (role === 'admin' || role === 'super') modulesByAccess.push({ onClick: () => void openCondoSection('parking'), title: 'Estacionamiento', desc: 'Configuración, vehículos y estadísticas', icon: 'local_parking' });
    }
    if (m.module_key === 'cart_lending') {
      if (role === 'security') modulesByAccess.push({ to: '/garita', title: 'Carritos', desc: 'Préstamo y devolución de carritos en garita', icon: 'shopping_cart' });
      else if (role === 'admin' || role === 'super') modulesByAccess.push({ onClick: () => void openCondoSection('carts'), title: 'Carritos y Multas', desc: 'Registro de carritos, estadísticas y multas', icon: 'shopping_cart' });
    }
  }

  if (role === 'loading') return <div className="loading-message">Cargando...</div>;

  return (
    <div className="dashboard">
      <h2>Panel de Control</h2>

      {(!canManageUsers && !isSecurity) ? (
        <div className="welcome-card">
          <span className="material-symbols-outlined">waving_hand</span>
          <h3>¡Bienvenido{user?.name ? `, ${user.name}` : ''}!</h3>
          <p>Estos son los módulos del condominio a los que tienes acceso según tus permisos.</p>
        </div>
      ) : (
        <div className="quick-actions">
          {role === 'super' && (
            <Link to="/admin/condominiums" className="action-card">
              <span className="material-symbols-outlined">apartment</span>
              <h3>Administrar Condominios</h3>
              <p>Ver, registrar y gestionar condominios</p>
            </Link>
          )}
          {isGaritaOperator && (
            <Link to="/garita" className="action-card">
              <span className="material-symbols-outlined">shield</span>
              <h3>Panel de Garita</h3>
              <p>Préstamo de carritos y control de estacionamiento</p>
            </Link>
          )}
          {canManageCondo && (
            <button onClick={openMyCondominium} className="action-card action-card-btn">
              <span className="material-symbols-outlined">home_work</span>
              <h3>Mi Condominio</h3>
              <p>Estructura, puertas, módulos activos, carritos y estacionamiento</p>
            </button>
          )}
          {canManageUsers && (
            <Link to="/admin/users" className="action-card">
              <span className="material-symbols-outlined">group</span>
              <h3>Gestionar Usuarios</h3>
              <p>Administrar roles y accesos del condominio</p>
            </Link>
          )}
        </div>
      )}

      <div className="modules-header">
        <h3>Módulos disponibles</h3>
        <small>Según tus permisos y los módulos activos del condominio.</small>
      </div>

      {modulesByAccess.length === 0 ? (
        <p className="text-muted">No hay módulos activos disponibles para tu perfil en este momento.</p>
      ) : (
        <div className="condominiums-grid">
          {modulesByAccess.map((c, i) => c.onClick ? (
            <button key={i} onClick={c.onClick} className="action-card action-card-btn">
              <span className="material-symbols-outlined">{c.icon}</span>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </button>
          ) : (
            <Link key={i} to={c.to || '/'} className="action-card">
              <span className="material-symbols-outlined">{c.icon}</span>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUsersRoute({ children }: { children: React.ReactNode }) {
  const role = useUserRole();
  if (role === 'loading') return <div className="loading-message">Cargando...</div>;
  if (role !== 'super' && role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-lg text-on-surface-variant">Cargando...</div>;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;