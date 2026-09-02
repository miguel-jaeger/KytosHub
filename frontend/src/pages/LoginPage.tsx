import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface LoginPageProps {
  onSuccess?: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const { signInWithPassword, signUp, signInWithGoogle, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        const { error: signInError } = await signInWithPassword(email, password);
        if (signInError) {
          setError(signInError);
        } else {
          onSuccess?.();
        }
      } else {
        const { error: signUpError, requireVerification } = await signUp(email, password, name);
        if (signUpError) {
          setError(signUpError);
        } else if (requireVerification) {
          setVerificationPending(true);
        } else {
          onSuccess?.();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en la autenticación');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: googleError } = await signInWithGoogle();
    if (googleError) {
      setError(googleError);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setVerificationPending(false);
  };

  if (verificationPending) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-5">
        <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-xl shadow-lg p-6 flex flex-col gap-4 text-center">
          <span className="material-symbols-outlined fill text-[40px] text-secondary mx-auto">mark_email_read</span>
          <h1 className="text-2xl font-bold">Verifica tu correo</h1>
          <p className="text-on-surface-variant">
            Hemos enviado un código de 6 dígitos a <strong>{email}</strong>. Revisa tu bandeja de entrada para completar el registro.
          </p>
          <button
            onClick={() => setVerificationPending(false)}
            className="h-12 w-full rounded-lg font-semibold bg-primary-container text-on-primary hover:opacity-90"
          >
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-5 md:p-8">
      <main className="w-full max-w-[400px] bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-6 flex flex-col gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-container flex items-center justify-center mb-2">
            <span className="material-symbols-outlined fill text-on-primary text-[32px]" data-icon="apartment">
              apartment
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-on-surface">Bienvenido a KytosHub</h1>
          <p className="text-base text-on-surface-variant">Gestiona tu condominio con facilidad</p>
        </div>

        <form className="flex flex-col gap-6 w-full" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="flex flex-col gap-2">
              <label className="text-sm text-on-surface-variant" htmlFor="name">
                Nombre Completo
              </label>
              <div className="input-glass flex items-center rounded-lg px-4 h-12 w-full gap-2">
                <span className="material-symbols-outlined text-outline" data-icon="person">
                  person
                </span>
                <input
                  className="bg-transparent border-none focus:ring-0 w-full text-base text-on-surface placeholder-outline-variant outline-none"
                  id="name"
                  placeholder="Juan Pérez"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm text-on-surface-variant" htmlFor="email">
              Correo Electrónico
            </label>
            <div className="input-glass flex items-center rounded-lg px-4 h-12 w-full gap-2">
              <span className="material-symbols-outlined text-outline" data-icon="mail">
                mail
              </span>
              <input
                className="bg-transparent border-none focus:ring-0 w-full text-base text-on-surface placeholder-outline-variant outline-none"
                id="email"
                placeholder="ejemplo@correo.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-on-surface-variant" htmlFor="password">
              Contraseña
            </label>
            <div className="input-glass flex items-center rounded-lg px-4 h-12 w-full gap-2 relative">
              <span className="material-symbols-outlined text-outline" data-icon="lock">
                lock
              </span>
              <input
                className="bg-transparent border-none focus:ring-0 w-full text-base text-on-surface placeholder-outline-variant outline-none pr-10"
                id="password"
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                className="absolute right-4 text-outline hover:text-on-surface transition-colors"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Mostrar contraseña"
              >
                <span className="material-symbols-outlined" data-icon={showPassword ? 'visibility_off' : 'visibility'}>
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {mode === 'login' && (
              <div className="flex justify-end mt-1">
                <a className="text-sm text-secondary hover:underline" href="#">
                  Olvidé mi contraseña
                </a>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-error-container text-error p-3 rounded-lg text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-4 mt-1">
            <button
              className="btn-shadow h-12 w-full bg-primary-container text-on-primary rounded-lg font-semibold flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50"
              type="submit"
              disabled={submitting || loading}
            >
              <span className="material-symbols-outlined mr-2" data-icon={mode === 'login' ? 'login' : 'person_add'}>
                {mode === 'login' ? 'login' : 'person_add'}
              </span>
              {submitting ? 'Procesando...' : mode === 'login' ? 'Iniciar Sesión' : 'Crear cuenta'}
            </button>
            <button
              className="btn-shadow h-12 w-full bg-secondary text-on-secondary rounded-lg font-semibold flex items-center justify-center hover:opacity-90 transition-opacity"
              type="button"
              onClick={switchMode}
            >
              <span className="material-symbols-outlined mr-2" data-icon="switch_account">
                switch_account
              </span>
              {mode === 'login' ? 'Crear cuenta' : 'Ya tengo una cuenta'}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-4 w-full">
          <div className="flex items-center gap-4 w-full">
            <div className="h-px bg-outline-variant flex-1"></div>
            <span className="text-xs font-semibold tracking-widest text-on-surface-variant">O inicia sesión con</span>
            <div className="h-px bg-outline-variant flex-1"></div>
          </div>

          <div className="flex gap-4 w-full">
            <button
              className="btn-shadow flex-1 h-12 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-center hover:bg-surface-container-low transition-colors gap-2"
              type="button"
              onClick={handleGoogle}
              disabled={submitting}
            >
              <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span className="text-sm font-medium text-on-surface">Google</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}