// Carga el script oficial de Cloudflare Turnstile (render explícito) una sola
// vez y expone el sitekey público configurado en Vercel.
//
// El sitekey es público y se incrusta en el bundle en tiempo de build; el
// secret key NUNCA debe estar aquí: se valida en la función verify-turnstile.

export const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

// Sin sitekey no se muestra el widget. En producción la app exige la
// verificación igualmente (ver AuthContext) para no degradar la seguridad.
export const TURNSTILE_ENABLED = TURNSTILE_SITE_KEY.length > 0;

export interface TurnstileRenderOptions {
  sitekey: string;
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'compact' | 'flexible';
  action?: string;
  callback?: (token: string) => void;
  'error-callback'?: (errorCode: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
}

export interface TurnstileApi {
  render: (container: string | HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
  ready: (callback: () => void) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loadPromise: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile solo está disponible en el navegador'));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const resolveApi = () => {
      if (!window.turnstile) {
        loadPromise = null;
        reject(new Error('Turnstile no se inicializó correctamente'));
        return;
      }
      window.turnstile.ready(() => resolve(window.turnstile as TurnstileApi));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolveApi();
        return;
      }
      existing.addEventListener('load', resolveApi, { once: true });
      existing.addEventListener('error', () => {
        loadPromise = null;
        reject(new Error('No se pudo cargar Turnstile'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolveApi();
    }, { once: true });
    script.addEventListener('error', () => {
      loadPromise = null;
      reject(new Error('No se pudo cargar Turnstile'));
    }, { once: true });
    document.head.appendChild(script);
  });

  return loadPromise;
}
