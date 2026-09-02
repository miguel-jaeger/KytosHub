import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { TowerStructureView } from './modules/core/components/TowerStructureView';
import { SetupWizard } from './modules/core/components/SetupWizard';
import { SuperAdminDashboard } from './modules/core/components/SuperAdminDashboard';
import { CondominioAdminDashboard } from './modules/core/components/CondominioAdminDashboard';

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
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div className="app-layout">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin/condominiums" element={<SuperAdminDashboard />} />
          <Route path="/admin/users" element={<CondominioAdminDashboard />} />
          <Route path="/structure" element={<TowerStructureView />} />
          <Route path="/setup" element={<SetupWizard />} />
        </Routes>
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="dashboard">
      <h2>Panel de Control</h2>
      <div className="quick-actions">
        <Link to="/structure" className="action-card">
          <span className="material-symbols-outlined">account_tree</span>
          <h3>Ver Estructura</h3>
          <p>Torres, pisos y departamentos del condominio</p>
        </Link>
        <Link to="/setup" className="action-card">
          <span className="material-symbols-outlined">settings</span>
          <h3>Configurar Condominio</h3>
          <p>Registrar condominio y crear su estructura inicial</p>
        </Link>
        <Link to="/admin/users" className="action-card">
          <span className="material-symbols-outlined">group</span>
          <h3>Gestionar Usuarios</h3>
          <p>Administrar roles y accesos del condominio</p>
        </Link>
        <Link to="/profile" className="action-card">
          <span className="material-symbols-outlined">account_circle</span>
          <h3>Mi Perfil</h3>
          <p>Cambiar contraseña, foto y tema</p>
        </Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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