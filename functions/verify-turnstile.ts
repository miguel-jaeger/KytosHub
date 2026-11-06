// Valida un token de Cloudflare Turnstile contra la API Siteverify.
//
// El secret key vive en los secrets de InsForge (TURNSTILE_SECRET_KEY) y nunca
// se expone al navegador. El login/registro del frontend llama a esta función
// antes de autenticar, de modo que un token inválido, expirado o reutilizado
// no permite continuar.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const REQUEST_TIMEOUT_MS = 8000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(
  body: Record<string, unknown>,
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function getRemoteIp(req: Request): string {
  const direct = req.headers.get('cf-connecting-ip')?.trim();
  if (direct) return direct;

  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  return '';
}

interface SiteverifyResponse {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  action?: string;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(
      { success: false, data: null, error: { code: 'METHOD_NOT_ALLOWED', message: 'Solo se permite POST' } },
      405
    );
  }

  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')?.trim();
  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY no está configurado en los secrets de InsForge');
    return json(
      { success: false, data: null, error: { code: 'CONFIG_ERROR', message: 'La verificación de seguridad no está configurada.' } },
      500
    );
  }

  let token = '';
  try {
    const body = (await req.json()) as Record<string, unknown>;
    token = typeof body.token === 'string' ? body.token.trim() : '';
  } catch {
    return json(
      { success: false, data: null, error: { code: 'INVALID_BODY', message: 'Cuerpo de la solicitud inválido.' } },
      400
    );
  }

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return json(
      { success: false, data: null, error: { code: 'INVALID_TOKEN', message: 'Completa la verificación de seguridad.' } },
      400
    );
  }

  const params = new URLSearchParams({ secret, response: token });
  const remoteIp = getRemoteIp(req);
  if (remoteIp) params.set('remoteip', remoteIp);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.error('Turnstile Siteverify respondió', response.status);
      return json(
        { success: false, data: null, error: { code: 'TURNSTILE_UNAVAILABLE', message: 'No se pudo validar la verificación de seguridad. Inténtalo de nuevo.' } },
        502
      );
    }

    const result = (await response.json()) as SiteverifyResponse;

    if (!result.success) {
      const codes = result['error-codes'] ?? [];
      console.warn('Turnstile rechazó el token:', codes.join(', '));
      return json(
        { success: false, data: null, error: { code: 'TURNSTILE_FAILED', message: 'La verificación de seguridad falló o expiró. Inténtalo de nuevo.' } },
        400
      );
    }

    return json(
      {
        success: true,
        data: {
          hostname: result.hostname ?? null,
          challengeTs: result.challenge_ts ?? null
        },
        error: null
      },
      200
    );
  } catch (error) {
    console.error('Error validando Turnstile:', error);
    return json(
      { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'No se pudo validar la verificación de seguridad. Inténtalo de nuevo.' } },
      502
    );
  }
}
