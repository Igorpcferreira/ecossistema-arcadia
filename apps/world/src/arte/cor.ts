// Cores: conversões, tons, misturas e a troca de paleta (noite fria ou quente).
// Tudo trabalha com '#rrggbb'. A troca de paleta vale só para o cenário assado
// (piso, paredes, mobília e luz); personagens, ícones e HUD mantêm as cores próprias.

export type Rgb = [number, number, number];

const cacheRgb = new Map<string, Rgb>();

export function hexRgb(h: string): Rgb {
  let v = cacheRgb.get(h);
  if (!v) {
    const n = parseInt(h.slice(1, 7), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cacheRgb.set(h, v);
  }
  return v;
}

export function rgbHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return '#' + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
}

/** Clareia (f > 0) ou escurece (f < 0) uma cor. */
export function tom(h: string, f: number): string {
  const [r, g, b] = hexRgb(h);
  return f >= 0
    ? rgbHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f)
    : rgbHex(r * (1 + f), g * (1 + f), b * (1 + f));
}

export function mistura(a: string, b: string, t: number): string {
  const A = hexRgb(a), B = hexRgb(b);
  return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export function numeroCor(h: string): number {
  return parseInt(h.slice(1, 7), 16);
}

/* ---------- HSL para a paleta quente ---------- */
function rgbHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return rgbHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return rgbHex(f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255);
}

/**
 * Noite quente: os tons frios do cenário (ciano, azul, violeta e os cinzas azulados)
 * viram âmbar, cobre e marrom de madeira; o resto quase não muda.
 */
function aquecer(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  const [h, s, l] = rgbHsl(r, g, b);
  if (h >= 165 && h <= 275) {
    if (s > 0.45) {
      // neon frio: ciano vira âmbar, azul vira laranja, violeta vira rosa queimado
      const alvo = h < 200 ? 38 : h < 240 ? 28 : 350;
      return hslHex(alvo, Math.min(1, s * 0.95), Math.min(0.92, l * 1.02));
    }
    // cinza azulado (paredes, piso, metal): marrom de madeira
    return hslHex(28 + (h - 220) * 0.08, Math.min(0.42, s * 0.9 + 0.12), l * 0.98);
  }
  return hex;
}

export type NomePaleta = 'fria' | 'quente';

let paletaAtiva: NomePaleta = 'fria';
const cacheQuente = new Map<string, string>();

/** Define a paleta usada pelas primitivas enquanto o cenário é assado. */
export function usarPaleta(p: NomePaleta): void { paletaAtiva = p; }
export function paletaAtual(): NomePaleta { return paletaAtiva; }

/** Cor final de um pixel do cenário na paleta ativa. */
export function cp(hex: string): string {
  if (paletaAtiva === 'fria' || hex.length < 7 || hex[0] !== '#') return hex;
  let v = cacheQuente.get(hex);
  if (!v) { v = aquecer(hex); cacheQuente.set(hex, v); }
  return v;
}

/** Igual a cp, mas para personagens e HUD: nunca troca a cor. */
export function fixa(hex: string): string { return hex; }
