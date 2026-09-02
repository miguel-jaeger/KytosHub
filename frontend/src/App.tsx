import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { SetupWizard } from './modules/core/components/SetupWizard';
import { SuperAdminDashboard } from './modules/core/components/SuperAdminDashboard';
import { CondominioAdminDashboard } from './modules/core/components/CondominioAdminDashboard';
import { invokeFunction } from './lib/insforge';

const SUPER_ADMIN_EMAIL = 'miguel.jaeger@gmail.com';

function useUserRole() {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<'loading' | 'super' | 'admin' | 'resident' | 'none'>('loading');

  useEffect(() => {
    if (loading || !user) { setRole('loading'); return; }
    if (user.email === SUPER_ADMIN_EMAIL) { setRole('super'); return; }

    let cancelled = false;
    invokeFunction<{ success: boolean; data: { role: string; status: string }[] | null }>('list-condominium-users', {
      method: 'POST',
      body: { action: 'list-by-user', user_id: user.id }
    }).then(({ data }) => {
      if (cancelled) return;
      if (data?.success && data.data) {
        const active = data.data.find(x => x.status === 'ACTIVE');
        if (active && (active.role === 'ADMIN' || active.role === 'SUPER_ADMIN')) setRole('admin');
        else setRole('resident');
      } else {
        setRole('resident');
      }
    }).catch(() => { if (!cancelled) setRole('resident'); });

    return () => { cancelled = true; };
  }, [user, loading]);

  return role;
}

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
  const canManageUsers = role === 'super' || role === 'admin';

  if (role === 'loading') return <div className="loading-message">Cargando...</div>;

  return (
    <div className="dashboard">
      <h2>Panel de Control</h2>

      {!canManageUsers ? (
        <div className="welcome-card">
          <span className="material-symbols-outlined">waving_hand</span>
          <h3>¡Bienvenido{user?.name ? `, ${user.name}` : ''}!</h3>
          <p>Gracias por usar KytosHub. Pronto podrás gestionar tu condominio desde esta app.</p>
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
          <Link to="/admin/users" className="action-card">
            <span className="material-symbols-outlined">group</span>
            <h3>Gestionar Usuarios</h3>
            <p>Administrar roles y accesos del condominio</p>
          </Link>
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