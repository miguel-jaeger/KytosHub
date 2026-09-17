const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) {
      return json({ success: false, data: null, error: { code: 'VISION_KEY_MISSING', message: 'La API key de Google Cloud Vision no está configurada (secreto GOOGLE_VISION_API_KEY).' } }, 500);
    }

    const body = await req.json();
    const image = body.image as string | undefined;
    if (!image) {
      return json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Se requiere la imagen (base64 o URL) para el reconocimiento' } }, 400);
    }

    // image can be: dataURL with base64, raw base64, or an https URL
    let payload: { content?: string; imageUri?: string } = {};
    if (/^https?:\/\//i.test(image)) {
      payload.imageUri = image;
    } else {
      const base64 = image.includes('base64,') ? image.split('base64,')[1] : image;
      payload.content = base64;
    }

    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: payload,
          features: [{ type: 'TEXT_DETECTION', maxResults: 5 }]
        }]
      })
    });

    const vision = await res.json();
    if (!res.ok) {
      console.error('Google Vision error:', JSON.stringify(vision));
      return json({ success: false, data: null, error: { code: 'VISION_ERROR', message: String((vision as { error?: { message?: string } })?.error?.message || 'Error al llamar a Google Vision') } }, 502);
    }

    const annotations = vision?.responses?.[0]?.textAnnotations as Array<{ description: string }> | undefined;
    const fullText = annotations?.[0]?.description || '';
    const blocks = annotations?.slice(1).map(a => a.description) || [];

    const plate = inferPlate(fullText, blocks);

    if (!plate) {
      return json({
        success: true,
        data: { plate: null, full_text: fullText, detected: blocks },
        error: null
      }, 200);
    }

    return json({ success: true, data: { plate, full_text: fullText, detected: blocks }, error: null }, 200);
  } catch (error) {
    console.error('Error in plate-ocr:', error);
    return json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } }, 500);
  }
}

// Peruvian-style plates: 3 letters + 3 digits (cars), or 1 letter + 3 digits + 2 letters
// (motos / newer), or generic alphabetic-numeric tokens. We normalize to how the
// system stores plates (uppercase alphanumeric with optional hyphen).
function inferPlate(fullText: string, blocks: string[]): string | null {
  const candidates = [fullText, ...blocks];
  const cleaned = candidates
    .map(c => c.replace(/[^A-Za-z0-9\- ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const c of cleaned) {
    const expr = /\b([A-Za-z]{2,3}[\s\-]?\d{3,4}(?:[A-Za-z]{0,2})?)\b|\b([A-Za-z]\d{3}[A-Za-z]{2})\b/g;
    const m = c.toUpperCase().match(expr);
    if (m && m[0]) return normalize(m[0]);
  }

  // Fallback: any token composed of letters+digits of length 6-8
  for (const c of cleaned) {
    const tokens = c.split(' ');
    for (const t of tokens) {
      const alpha = t.replace(/[^A-Za-z]/g, '');
      const digit = t.replace(/[^0-9]/g, '');
      if (alpha.length >= 2 && digit.length >= 3 && (alpha.length + digit.length) <= 8) {
        return normalize(t);
      }
    }
  }

  return null;
}

function normalize(p: string): string {
  return p.toUpperCase().replace(/[\s\-]+/g, ' ').trim();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}