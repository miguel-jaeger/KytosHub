import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useCondominium } from './contexts/CondominiumContext';
import { LoginPage } from './pages/LoginPage';
import { ResidentsManager } from './modules/core/components/ResidentsManager';
import { TowerStructureView } from './modules/core/components/TowerStructureView';
import { SetupWizard } from './modules/core/components/SetupWizard';

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
          <a href="/">Inicio</a>
          <a href="/structure">Estructura</a>
          <a href="/setup">Configurar Condominio</a>
          <a href="/residents">Residentes</a>
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
          <Route path="/structure" element={<TowerStructureView />} />
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/residents" element={<ResidentsManager />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="dashboard">
      <h2>Panel de Control</h2>
      <div className="quick-actions">
        <a href="/structure" className="action-card">
          <h3>Ver Estructura</h3>
          <p>Torres, pisos y departamentos del condominio</p>
        </a>
        <a href="/setup" className="action-card">
          <h3>Configurar Condominio</h3>
          <p>Registrar condominio y crear su estructura inicial</p>
        </a>
        <a href="/residents" className="action-card">
          <h3>Gestionar Residentes</h3>
          <p>Administrar padrones de residentes</p>
        </a>
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