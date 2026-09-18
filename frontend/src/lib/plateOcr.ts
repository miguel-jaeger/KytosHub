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

// Peruvian plates are 6 characters split by a hyphen: the first 3 are
// alphanumeric (ABC-123, A1B-234) and the last 3 are digits. Legacy 7-char
// formats (ABC-1234, ABCD-123) are kept as fallbacks.
const HEAD_LETTER_FIX: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '8': 'B' };
const TAIL_DIGIT_FIX: Record<string, string> = { O: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };

// Normalize a raw OCR token into canonical hyphenated plate candidates.
function plateVariants(token: string): string[] {
  const base = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!base) return [];
  const out: string[] = [];
  const add = (p: string) => { if (p && !out.includes(p)) out.push(p); };

  if (/^[A-Z0-9]{3}[0-9]{3}$/.test(base)) {
    add(`${base.slice(0, 3)}-${base.slice(3)}`);
  }
  // Legacy 7-char plates.
  if (/^[A-Z]{3}[0-9]{4}$/.test(base)) add(`${base.slice(0, 3)}-${base.slice(3)}`);
  if (/^[A-Z]{4}[0-9]{3}$/.test(base)) add(`${base.slice(0, 4)}-${base.slice(4)}`);

  // Fix common OCR misreads on 6-char plates: the last 3 must be digits and
  // the first 3 usually letters.
  if (/^[A-Z0-9]{6}$/.test(base)) {
    const head = base.slice(0, 3);
    const fixedTail = [...base.slice(3)].map(ch => TAIL_DIGIT_FIX[ch] ?? ch).join('');
    if (/^[0-9]{3}$/.test(fixedTail)) {
      add(`${head}-${fixedTail}`);
      for (let i = 0; i < head.length; i++) {
        const fix = HEAD_LETTER_FIX[head[i]];
        if (!fix) continue;
        add(`${head.slice(0, i)}${fix}${head.slice(i + 1)}-${fixedTail}`);
      }
    }
  }
  return out;
}

function tokenize(text: string): string[] {
  const upper = text.toUpperCase();
  const tokens = new Set<string>();
  for (const word of upper.split(/\s+/)) {
    const compact = word.replace(/[^A-Z0-9]/g, '');
    if (compact.length >= 4 && compact.length <= 8) tokens.add(compact);
  }
  // OCR can glue the plate to neighboring text; scan the full line, but avoid
  // partial/spurious matches inside longer alphanumeric runs.
  const compactAll = upper.replace(/[^A-Z0-9]/g, '');
  for (const m of compactAll.matchAll(/(?<![A-Z0-9])(?:[A-Z0-9]{3}[0-9]{3}|[A-Z]{3}[0-9]{4}|[A-Z]{4}[0-9]{3})(?![A-Z0-9])/g)) {
    tokens.add(m[0]);
  }
  return [...tokens];
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
          for (const c of plateVariants(tok)) {
            if (!seen.has(c)) {
              seen.add(c);
            }
          }
        }
      }
    } catch {}
  }

  // Prefer canonical ABC-123 plates first, then other letter+digit plates.
  const ordered: string[] = [];
  const canonical = [...seen].filter(t => /^[A-Z0-9]{3}-[0-9]{3}$/.test(t));
  const plateLike = [...seen].filter(t => !canonical.includes(t) && /[A-Z]/.test(t) && /[0-9]/.test(t));
  const others = [...seen].filter(t => !canonical.includes(t) && !plateLike.includes(t));
  ordered.push(...canonical, ...plateLike, ...others);

  return { candidates: ordered, full_text: texts.join(' · ') };
}