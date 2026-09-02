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
      <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-container-margin md:p-xl">
        <main className="w-full max-w-[400px] bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-lg flex flex-col gap-lg text-center">
          <span className="material-symbols-outlined fill text-secondary text-[40px] mx-auto">mark_email_read</span>
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">Verifica tu correo</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant">
            Enviamos un código de 6 dígitos a <strong>{email}</strong>. Revisa tu bandeja de entrada para completar el registro.
          </p>
          <button
            onClick={() => setVerificationPending(false)}
            className="btn-shadow h-12 w-full bg-primary-container text-on-primary rounded-lg font-headline-md text-headline-md flex items-center justify-center hover:opacity-90 transition-opacity"
          >
            Volver al inicio de sesión
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-container-margin md:p-xl">
      <main className="w-full max-w-[400px] bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-lg flex flex-col gap-xl">
        <div className="flex flex-col items-center gap-sm text-center">
          <div className="w-16 h-16 rounded-full bg-primary-container flex items-center justify-center mb-sm">
            <span className="material-symbols-outlined fill text-on-primary text-[32px]">apartment</span>
          </div>
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">Bienvenido a KytosHub</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant">Gestiona tu condominio con facilidad</p>
        </div>

        <form className="flex flex-col gap-lg w-full" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="flex flex-col gap-sm">
              <label className="font-body-sm text-body-sm text-on-surface-variant" htmlFor="name">
                Nombre Completo
              </label>
              <div className="input-glass flex items-center rounded-lg px-md h-12 w-full gap-sm">
                <span className="material-symbols-outlined text-outline">person</span>
                <input
                  className="bg-transparent border-none focus:ring-0 w-full font-body-lg text-body-lg text-on-surface placeholder-outline outline-none"
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

          <div className="flex flex-col gap-sm">
            <label className="font-body-sm text-body-sm text-on-surface-variant" htmlFor="email">
              Correo Electrónico
            </label>
            <div className="input-glass flex items-center rounded-lg px-md h-12 w-full gap-sm">
              <span className="material-symbols-outlined text-outline">mail</span>
              <input
                className="bg-transparent border-none focus:ring-0 w-full font-body-lg text-body-lg text-on-surface placeholder-outline outline-none"
                id="email"
                placeholder="ejemplo@correo.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-sm">
            <label className="font-body-sm text-body-sm text-on-surface-variant" htmlFor="password">
              Contraseña
            </label>
            <div className="input-glass flex items-center rounded-lg px-md h-12 w-full gap-sm relative">
              <span className="material-symbols-outlined text-outline">lock</span>
              <input
                className="bg-transparent border-none focus:ring-0 w-full font-body-lg text-body-lg text-on-surface placeholder-outline outline-none pr-10"
                id="password"
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                className="absolute right-md text-outline hover:text-on-surface transition-colors"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Mostrar contraseña"
              >
                <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {mode === 'login' && (
              <div className="flex justify-end mt-xs">
                <a className="font-body-sm text-body-sm text-secondary hover:underline" href="#">
                  Olvidé mi contraseña
                </a>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-error-container text-on-error-container p-md rounded-lg font-body-sm text-body-sm" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-md mt-sm">
            <button
              className="btn-shadow h-12 w-full bg-primary-container text-on-primary rounded-lg font-headline-md text-headline-md flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50"
              type="submit"
              disabled={submitting || loading}
            >
              <span className="material-symbols-outlined mr-sm">{mode === 'login' ? 'login' : 'person_add'}</span>
              {submitting ? 'Procesando...' : mode === 'login' ? 'Iniciar Sesión' : 'Crear cuenta'}
            </button>
            <button
              className="btn-shadow h-12 w-full bg-secondary text-on-secondary rounded-lg font-headline-md text-headline-md flex items-center justify-center hover:opacity-90 transition-opacity"
              type="button"
              onClick={switchMode}
            >
              <span className="material-symbols-outlined mr-sm">switch_account</span>
              {mode === 'login' ? 'Crear cuenta' : 'Ya tengo una cuenta'}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-md w-full">
          <div className="flex items-center gap-md w-full">
            <div className="h-px bg-outline-variant flex-1"></div>
            <span className="font-label-caps text-label-caps text-on-surface-variant">O inicia sesión con</span>
            <div className="h-px bg-outline-variant flex-1"></div>
          </div>

          <div className="flex gap-md w-full">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={submitting}
              className="btn-shadow flex-1 h-12 bg-surface-container-lowest border border-outline-variant rounded-lg flex items-center justify-center hover:bg-surface-container-low transition-colors gap-sm"
            >
              <img
                className="w-5 h-5 object-contain"
                alt="Google"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDG8M9mHYimHKxL_LDQznOQvzylnxvNDrw5CXICQgycXD3veRm7u1IVw3khhhlsqDMwHWpgcdsqrUjWYO-kGT0y2TwAp3G71AtQS_88kBoPsi68z-dsFjNBLx2a0haBUzSjPNcxWJkcPT-JRCPP_IjxHoy53X80IvOUUeQCPu9BuG8RXXvyOMO1086dpe9p5JqUBMS8sE0ghpQrMkOT1SUE2OZ6Z_-AhX6rK4LtjiTaisRqW7qH5pZP"
              />
              <span className="font-numeric-data text-numeric-data text-on-surface">Google</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}