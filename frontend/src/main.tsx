import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { CondominiumProvider } from './contexts/CondominiumContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <CondominiumProvider>
        <App />
      </CondominiumProvider>
    </AuthProvider>
  </React.StrictMode>
);