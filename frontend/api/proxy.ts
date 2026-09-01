const INSFORGE_FUNCTIONS_URL = process.env.INSFORGE_FUNCTIONS_URL || 'https://5vvsyy6z.function2.insforge.app/functions/v1';

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    const params = url.searchParams.toString();

    if (!slug) {
      return new Response(
        JSON.stringify({ error: 'Missing slug parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const insforgeUrl = `${INSFORGE_FUNCTIONS_URL}/${slug}`;
    const forwardParams = params.replace(`slug=${slug}&`, '').replace(`slug=${slug}`, '');

    const targetUrl = forwardParams ? `${insforgeUrl}?${forwardParams}` : insforgeUrl;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const init: RequestInit = {
      method: req.method,
      headers
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.text();
    }

    const response = await fetch(targetUrl, init);

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('Content-Type') || 'application/json'
      }
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal proxy error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
