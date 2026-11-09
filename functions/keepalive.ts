// Endpoint público y sin autenticación para cron externos.
// Cada invocación cuenta como actividad de "functions" en InsForge y ayuda a
// reiniciar el contador de inactividad de 7 días del plan gratuito.
export default async function (_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'insforge-keepalive',
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
