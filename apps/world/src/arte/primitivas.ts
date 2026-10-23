// Primitivas de pixel art em canvas 2D. Toda coordenada é arredondada antes de pintar:
// a prancha borrava pontos por coordenada fracionária (pxl sem arredondar); aqui não.
// As cores passam pela paleta ativa (cp), o que permite assar o cenário na noite quente.
import { cp } from './cor.ts';

export type G = CanvasRenderingContext2D;
export type Ponto = [number, number];
/** Projeção local de um objeto: (i, j, altura) em ladrilhos para pixels do sprite. */
export type Proj = (i: number, j: number, z?: number) => Ponto;

const R = Math.round;

/** Troca o fillStyle só quando a cor muda: interpretar o texto da cor custa caro no celular. */
const ultimo = new WeakMap<G, string>();
export function estilo(g: G, cor: string): void {
  if (ultimo.get(g) === cor) return;
  g.fillStyle = cor;
  ultimo.set(g, cor);
}
/** Esquece a última cor (depois de alguém mexer no fillStyle por fora). */
export function esquecerEstilo(g: G): void { ultimo.delete(g); }

export function ret(g: G, x: number, y: number, w: number, h: number, cor: string): void {
  estilo(g, cp(cor));
  g.fillRect(R(x), R(y), R(w), R(h));
}

export function pxl(g: G, x: number, y: number, cor: string): void {
  estilo(g, cp(cor));
  g.fillRect(R(x), R(y), 1, 1);
}

export function linha(g: G, x0: number, y0: number, x1: number, y1: number, cor: string): void {
  estilo(g, cp(cor));
  x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if ((x0 === x1 && y0 === y1) || ++n > 4000) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Polígono preenchido por varredura de linhas (sem antisserrilhado). */
export function poli(g: G, pts: Ponto[], cor: string): void {
  estilo(g, cp(cor));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const xs: number[] = [];
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = R(xs[k]), xb = R(xs[k + 1]);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  }
}

export function elipse(g: G, cx: number, cy: number, rx: number, ry: number, cor: string): void {
  estilo(g, cp(cor));
  cx = R(cx); cy = R(cy);
  for (let y = -ry; y <= ry; y++) {
    const m = R(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    g.fillRect(cx - m, cy + R(y), m * 2 + 1, 1);
  }
}

export function anel(g: G, cx: number, cy: number, rx: number, ry: number, cor: string, passos = 72, de = 0, ate = Math.PI * 2): void {
  estilo(g, cp(cor));
  for (let k = 0; k < passos; k++) {
    const a = de + (k / passos) * (ate - de);
    g.fillRect(R(cx + Math.cos(a) * rx), R(cy + Math.sin(a) * ry), 1, 1);
  }
}

/** Retângulo com contorno de 1 px. */
export function moldura(g: G, x: number, y: number, w: number, h: number, borda: string, miolo?: string): void {
  if (miolo) ret(g, x, y, w, h, miolo);
  ret(g, x, y, w, 1, borda); ret(g, x, y + h - 1, w, 1, borda);
  ret(g, x, y, 1, h, borda); ret(g, x + w - 1, y, 1, h, borda);
}

/* ---------- Fonte bitmap 3 por 5 com acentos do português ---------- */
const F3: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  ' ': '000000000000000', '.': '000000000000010', '-': '000000111000000', ':': '000010000010000', '/': '001001010100100', '!': '010010010000010',
  '+': '000010111010000', '·': '000000010000000', '?': '110001010000010', '%': '101001010100101', '&': '010101010101011', '>': '100010001010100',
  '<': '001010100010001', '_': '000000000000111', '=': '000111000111000', ',': '000000000010100', "'": '010010000000000', '#': '101111101111101',
};
const ACENTO: Record<string, [string, string]> = {
  'Á': ['A', '/'], 'À': ['A', '\\'], 'Â': ['A', '^'], 'Ã': ['A', '~'], 'É': ['E', '/'], 'Ê': ['E', '^'], 'Í': ['I', '/'],
  'Ó': ['O', '/'], 'Ô': ['O', '^'], 'Õ': ['O', '~'], 'Ú': ['U', '/'], 'Ü': ['U', ':'], 'Ç': ['C', ','],
};

export interface TextoPixels { pts: Ponto[]; largura: number }
const cacheTexto = new Map<string, TextoPixels>();

export function pixelsTexto(texto: string): TextoPixels {
  let v = cacheTexto.get(texto);
  if (v) return v;
  const pts: Ponto[] = [];
  let x = 0;
  for (const c0 of texto.toUpperCase()) {
    let c = c0, ac: string | null = null;
    const a = ACENTO[c];
    if (a) { c = a[0]; ac = a[1]; }
    const b = F3[c] ?? F3[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (b[r * 3 + k] === '1') pts.push([x + k, r]);
    if (ac === '/') pts.push([x + 2, -2], [x + 1, -1]);
    if (ac === '\\') pts.push([x, -2], [x + 1, -1]);
    if (ac === '^') pts.push([x + 1, -2], [x, -1], [x + 2, -1]);
    if (ac === '~') pts.push([x, -1], [x + 1, -2], [x + 2, -1]);
    if (ac === ':') pts.push([x, -1], [x + 2, -1]);
    if (ac === ',') pts.push([x + 1, 5]);
    x += 4;
  }
  v = { pts, largura: Math.max(0, x - 1) };
  cacheTexto.set(texto, v);
  return v;
}

export function textoPlano(g: G, texto: string, x: number, y: number, cor: string, esc = 1): void {
  const { pts } = pixelsTexto(texto);
  estilo(g, cp(cor));
  x = R(x); y = R(y);
  for (const [px, py] of pts) g.fillRect(x + px * esc, y + py * esc, esc, esc);
}

/** Desenha um mapa de pixels feito à mão: cada linha é um texto, cada letra uma cor da paleta ('.' é vazio). */
export function mapaPixels(g: G, linhas: readonly string[], paleta: Readonly<Record<string, string>>, x: number, y: number, espelho = false): void {
  const w = linhas.reduce((m, l) => Math.max(m, l.length), 0);
  for (let r = 0; r < linhas.length; r++) {
    const l = linhas[r];
    let k = 0;
    while (k < l.length) {
      const ch = l[k];
      if (ch === '.' || ch === ' ') { k++; continue; }
      let n = 1;
      while (k + n < l.length && l[k + n] === ch) n++;
      const cor = paleta[ch];
      if (cor) {
        estilo(g, cor);
        const xx = espelho ? x + (w - k - n) : x + k;
        g.fillRect(R(xx), R(y + r), n, 1);
      }
      k += n;
    }
  }
}
