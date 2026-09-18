const KEY = 'kytos_text_scale';

export const TEXT_SCALES = [0.9, 1, 1.15, 1.3];

export function getTextScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY) || 1);
    return TEXT_SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function applyTextScale(scale: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${(16 * scale).toFixed(2)}px`;
}

export function setTextScale(scale: number): void {
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {}
  applyTextScale(scale);
}

export function initTextScale(): void {
  applyTextScale(getTextScale());
}