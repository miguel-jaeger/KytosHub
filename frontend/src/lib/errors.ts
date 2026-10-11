// Translates common English backend/auth error messages to Spanish so the UI
// never shows raw messages like "Invalid Credentials".
const AUTH_ERROR_MAP: Array<[RegExp, string]> = [
  [/invalid login credentials|invalid credentials|invalid password|wrong password/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed|email not verified|not verified|unverified/i, 'Debes verificar tu correo electrónico antes de ingresar.'],
  [/already registered|user already|email.*already|already exists/i, 'Este correo ya está registrado.'],
  [/password should be|password must|weak password|password.*(least|length)/i, 'La contraseña no cumple los requisitos mínimos.'],
  [/rate limit|too many requests|for security purposes|too many attempts/i, 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'],
  [/user not found|no user found/i, 'No existe una cuenta con ese correo.'],
  [/invalid email|email.*invalid/i, 'El correo electrónico no es válido.'],
  [/failed to fetch|network|connection (refused|error)/i, 'No se pudo conectar. Revisa tu conexión.'],
  [/token.*(expired|invalid)|jwt|session.*(expired|invalid)/i, 'La sesión expiró. Vuelve a iniciar sesión.'],
  [/permission denied|not authorized|unauthorized|forbidden/i, 'No tienes permisos para realizar esta acción.'],
];

export function translateAuthError(message?: string | null): string {
  const raw = String(message || '').trim();
  if (!raw) return 'Ocurrió un error. Inténtalo de nuevo.';
  for (const [pattern, spanish] of AUTH_ERROR_MAP) {
    if (pattern.test(raw)) return spanish;
  }
  return raw;
}
