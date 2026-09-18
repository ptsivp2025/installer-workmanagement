/**
 * Theme color bridge: turns one admin-picked "primary color" into the full
 * brand-50..900 Tailwind scale by writing CSS custom properties on <html>.
 * tailwind.config.ts's `brand` colors read `var(--brand-XXX, <default hex>)`,
 * so as long as nobody has customized the theme, the vars are simply unset
 * and the original static hexes apply — no flash, no mismatch.
 */

export const DEFAULT_PRIMARY = '#2563eb';
export const DEFAULT_SECONDARY = '#1d4ed8';

const SHADE_LIGHTNESS: Record<number, number> = {
  50: 0.97, 100: 0.94, 200: 0.87, 300: 0.79, 400: 0.66,
  500: 0.55, 600: 0.45, 700: 0.37, 800: 0.32, 900: 0.27,
};

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) { const v = Math.round(l * 255); return `#${[v, v, v].map(x => x.toString(16).padStart(2, '0')).join('')}`; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const r = Math.round(hue2rgb(h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(h) * 255);
  const b = Math.round(hue2rgb(h - 1 / 3) * 255);
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

/** A full 50..900 scale generated from one hex, matching this hue/saturation. */
export function generateShades(baseHex: string): Record<number, string> | null {
  const hsl = hexToHsl(baseHex);
  if (!hsl) return null;
  const [h, s] = hsl;
  const shades: Record<number, string> = {};
  for (const [step, l] of Object.entries(SHADE_LIGHTNESS)) shades[Number(step)] = hslToHex(h, s, l);
  return shades;
}

/** Writes --brand-50..--brand-900 on <html>. No-op (clears vars) for the default color. */
export function applyThemeColor(primaryColor: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const color = (primaryColor ?? '').trim() || DEFAULT_PRIMARY;
  if (color.toLowerCase() === DEFAULT_PRIMARY) {
    for (const step of Object.keys(SHADE_LIGHTNESS)) root.style.removeProperty(`--brand-${step}`);
    return;
  }
  const shades = generateShades(color);
  if (!shades) return;
  for (const [step, hex] of Object.entries(shades)) root.style.setProperty(`--brand-${step}`, hex);
}
