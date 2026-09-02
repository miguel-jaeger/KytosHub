import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useCondominium } from './contexts/CondominiumContext';
import { LoginPage } from './pages/LoginPage';
import { TowerStructureView } from './modules/core/components/TowerStructureView';
import { SetupWizard } from './modules/core/components/SetupWizard';
import { SuperAdminDashboard } from './modules/core/components/SuperAdminDashboard';
import { CondominioAdminDashboard } from './modules/core/components/CondominioAdminDashboard';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-on-surface-variant">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppShell() {
  const { user, signOut } = useAuth();
  const { condominium } = useCondominium();
  const navigate = useNavigate();

  const isSuperAdmin = user?.email === 'miguel.jaeger@gmail.com';

  return (
    <div className="app">
      <header>
        <h1>KytosHub - Gestión de Condominios</h1>
        {condominium && (
          <div className="active-condominium">
            {condominium.image_url && <img src={condominium.image_url} alt={condominium.name} />}
            <span>{condominium.name}</span>
          </div>
        )}
        <nav className="main-nav">
          <Link to="/">Inicio</Link>
          {isSuperAdmin && <Link to="/admin/condominiums">Condominios</Link>}
          {condominium && <Link to="/structure">Estructura</Link>}
          {condominium && <Link to="/setup">Configurar Condominio</Link>}
          {condominium && <Link to="/admin/users">Usuarios</Link>}
        </nav>
        {user && (
          <button
            className="logout-btn"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Cerrar sesión ({user.email})
          </button>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/admin/condominiums" element={<SuperAdminDashboard />} />
          <Route path="/admin/users" element={<CondominioAdminDashboard />} />
          <Route path="/structure" element={<TowerStructureView />} />
          <Route path="/setup" element={<SetupWizard />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.email === 'miguel.jaeger@gmail.com';

  return (
    <div className="dashboard">
      <h2>Panel de Control</h2>
      <div className="quick-actions">
        {isSuperAdmin && (
          <Link to="/admin/condominiums" className="action-card">
            <h3>Administrar Condominios</h3>
            <p>Ver, editar y gestionar todos los condominios</p>
          </Link>
        )}
        <Link to="/structure" className="action-card">
          <h3>Ver Estructura</h3>
          <p>Torres, pisos y departamentos del condominio</p>
        </Link>
        <Link to="/setup" className="action-card">
          <h3>Configurar Condominio</h3>
          <p>Registrar condominio y crear su estructura inicial</p>
        </Link>
        <Link to="/admin/users" className="action-card">
          <h3>Gestionar Usuarios</h3>
          <p>Administrar roles y accesos del condominio</p>
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
