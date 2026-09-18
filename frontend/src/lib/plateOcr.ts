import { createWorker } from 'tesseract.js';

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

function getWorker(): Promise<Awaited<ReturnType<typeof createWorker>>> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      try {
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.',
          tessedit_pageseg_mode: '7'
        } as never);
      } catch {}
      return worker;
    })();
  }
  return workerPromise;
}

export interface ScanBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlateOcrResult {
  candidates: string[];
  full_text: string;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = dataUrl;
  });
}

// Crop to a normalized box (0..1) around the plate, with a small margin so the
// entire plate is never cut off.
async function cropBox(dataUrl: string, box: ScanBox): Promise<string> {
  const img = await loadImage(dataUrl);
  const margin = 0.06;
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  const w = Math.min(1 - x, box.w + margin * 2);
  const h = Math.min(1 - y, box.h + margin * 2);
  const sx = Math.max(0, Math.min(img.width, Math.round(img.width * x)));
  const sy = Math.max(0, Math.min(img.height, Math.round(img.height * y)));
  const sw = Math.max(1, Math.min(img.width - sx, Math.round(img.width * w)));
  const sh = Math.max(1, Math.min(img.height - sy, Math.round(img.height * h)));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no soportado');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

// Upscale + grayscale + binarize at two thresholds to help digit recognition.
async function thresholdVariant(dataUrl: string, width: number, threshold: number): Promise<string> {
  const img = await loadImage(dataUrl);
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
    d[i] = d[i + 1] = d[i + 2] = gray > threshold ? 255 : 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// Common Peruvian plates: ABC-123, ABC-1234 (plus hyphenless variants).
function hyphenVariants(token: string): string[] {
  const out = [token];
  if (/^[A-Z]{3}[0-9]{3}$/.test(token)) out.push(`${token.slice(0, 3)}-${token.slice(3)}`);
  if (/^[A-Z]{3}[0-9]{4}$/.test(token)) out.push(`${token.slice(0, 3)}-${token.slice(3)}`);
  if (/^[A-Z]{4}[0-9]{3}$/.test(token)) out.push(`${token.slice(0, 4)}-${token.slice(4)}`);
  return out;
}

function tokenize(text: string): string[] {
  return text.toUpperCase().split(/[^A-Z0-9]/).filter(t => t.length >= 4 && t.length <= 8);
}

export async function recognizePlate(imageDataUrl: string, box?: ScanBox): Promise<PlateOcrResult> {
  const worker = await getWorker();
  const src = box ? await cropBox(imageDataUrl, box).catch(() => imageDataUrl) : imageDataUrl;

  const variants: string[] = [];
  for (const width of [700, 1200]) {
    for (const threshold of [120, 175]) {
      try {
        variants.push(await thresholdVariant(src, width, threshold));
      } catch {}
    }
  }

  const texts: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    try {
      const result = await worker.recognize(variant);
      const text = (result.data?.text || '').toUpperCase();
      if (text) {
        texts.push(text.trim());
        for (const tok of tokenize(text)) {
          for (const c of hyphenVariants(tok)) {
            if (!seen.has(c)) {
              seen.add(c);
            }
          }
        }
      }
    } catch {}
  }

  // Prefer variants that look like a plate (letters + digits) first.
  const ordered: string[] = [];
  const plateLike = [...seen].filter(t => /[A-Z]/.test(t) && /[0-9]/.test(t));
  const others = [...seen].filter(t => !plateLike.includes(t));
  ordered.push(...plateLike, ...others);

  return { candidates: ordered, full_text: texts.join(' · ') };
}