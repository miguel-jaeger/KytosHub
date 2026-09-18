import { createWorker } from 'tesseract.js';

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

function getWorker(): Promise<Awaited<ReturnType<typeof createWorker>>> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      try {
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.'
        });
      } catch {}
      return worker;
    })();
  }
  return workerPromise;
}

// Resize, grayscale + binarize to make the plate characters easier to OCR.
async function preprocess(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = 900;
        const scale = width / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas no soportado');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = gray > 135 ? 255 : 0;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('No se pudo procesar la imagen'));
      }
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = dataUrl;
  });
}

// Common Peruvian plates: ABC-123, ABC-1234 (plus hyphenless variants).
function hyphenVariants(token: string): string[] {
  const out = [token];
  if (/^[A-Z]{3}[0-9]{3}$/.test(token)) out.push(`${token.slice(0, 3)}-${token.slice(3)}`);
  if (/^[A-Z]{3}[0-9]{4}$/.test(token)) out.push(`${token.slice(0, 3)}-${token.slice(3)}`);
  if (/^[A-Z]{4}[0-9]{3}$/.test(token)) out.push(`${token.slice(0, 4)}-${token.slice(4)}`);
  return out;
}

export interface PlateOcrResult {
  candidates: string[];
  full_text: string;
}

export async function recognizePlate(imageDataUrl: string): Promise<PlateOcrResult> {
  let text = '';
  try {
    const worker = await getWorker();
    const processed = await preprocess(imageDataUrl);
    const result = await worker.recognize(processed);
    text = (result.data?.text || '').toUpperCase();
  } catch {
    try {
      const worker = await getWorker();
      const result = await worker.recognize(imageDataUrl);
      text = (result.data?.text || '').toUpperCase();
    } catch {}
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const tokens = text.split(/[^A-Z0-9]/).filter(t => t.length >= 4 && t.length <= 8);
  for (const tok of new Set(tokens)) {
    for (const v of hyphenVariants(tok)) {
      if (!seen.has(v)) {
        seen.add(v);
        candidates.push(v);
      }
    }
  }
  return { candidates, full_text: text };
}