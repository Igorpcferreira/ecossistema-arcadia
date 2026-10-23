// Pequenas texturas de efeito: drones, minidrones, ícones de estado, brilhos, cargas,
// pulsos, partículas, carros nas janelas, placas e textos curtos. Tudo assado uma vez.
import type { Estado } from '../cena/formato.ts';
import { hexRgb, tom } from './cor.ts';
import { COR_ICONE, ICONES } from './estados.ts';
import { elipse, esquecerEstilo, estilo, linha, pixelsTexto, pxl, ret, textoPlano, type G } from './primitivas.ts';

export function desenharDrone(g: G, cor: string, q: number): void {
  ret(g, 3, 4, 8, 4, '#3a4054'); ret(g, 4, 3, 6, 1, '#59617a'); ret(g, 4, 8, 6, 1, cor);
  ret(g, 6, 5, 2, 1, '#9ff3ff');
  if (q % 2) { ret(g, 0, 2, 5, 1, '#c9cfdc'); ret(g, 9, 2, 5, 1, '#c9cfdc'); } else { ret(g, 1, 1, 3, 1, '#c9cfdc'); ret(g, 10, 1, 3, 1, '#c9cfdc'); }
  ret(g, 2, 2, 1, 2, '#59617a'); ret(g, 11, 2, 1, 2, '#59617a');
}

export function desenharMini(g: G, cor: string, q: number): void {
  elipse(g, 6, 7, 4, 3, cor); elipse(g, 5, 6, 2, 1, tom(cor, 0.35)); ret(g, 4, 7, 4, 1, '#141a2b'); ret(g, 5, 7, 2, 1, '#7ef3ff');
  ret(g, 6, 2, 1, 2, '#8a93ad'); if (q % 2) ret(g, 3, 1, 7, 1, '#c9cfdc'); else ret(g, 5, 1, 3, 1, '#c9cfdc');
}

/** Ícone 9 por 9 do estado (fundo na cor do estado, desenho escuro). */
export function desenharIcone(g: G, estado: Estado): void {
  const bits = ICONES[estado]; if (!bits) return;
  desenharIconeBits(g, bits, COR_ICONE[estado]);
}

/** Símbolo de stand-by (círculo aberto com a haste), 5 por 5. */
const BITS_ESPERA_ALA = '0010010101101011000101110';

/** Ícone fixo de ala em espera, ao lado da placa da ala: o símbolo de stand-by em azul frio. */
export function desenharIconeEsperaAla(g: G): void { desenharIconeBits(g, BITS_ESPERA_ALA, '#9aa6d6'); }

function desenharIconeBits(g: G, bits: string, fundo: string): void {
  ret(g, 0, 0, 9, 9, '#14162b'); ret(g, 1, 1, 7, 7, fundo);
  estilo(g, '#14162b');
  for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) if (bits[r * 5 + k] === '1') g.fillRect(2 + k, 2 + r, 1, 1);
}

/** Brilho radial (luz aditiva). */
export function desenharBrilho(g: G, cor: string, r: number): void {
  const [R, Gc, B] = hexRgb(cor);
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, `rgba(${R},${Gc},${B},0.9)`); gr.addColorStop(0.35, `rgba(${R},${Gc},${B},0.35)`); gr.addColorStop(1, `rgba(${R},${Gc},${B},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  esquecerEstilo(g);
}

export type Carga = 'envelope' | 'cubo' | 'check' | 'nenhuma';
export function desenharCarga(g: G, tipo: Carga): void {
  const cx = 4, cy = 0;
  if (tipo === 'envelope') { ret(g, cx - 3, cy, 6, 4, '#f6f2e8'); pxl(g, cx, cy + 1, '#e0a030'); linha(g, cx - 3, cy, cx, cy + 2, '#cfc8b8'); linha(g, cx + 2, cy, cx, cy + 2, '#cfc8b8'); }
  else if (tipo === 'cubo') { ret(g, cx - 2, cy, 5, 5, '#7dffa8'); ret(g, cx - 1, cy + 1, 3, 3, '#d6ffe6'); }
  else if (tipo === 'check') { ret(g, cx - 3, cy, 7, 6, '#7dffa8'); linha(g, cx - 2, cy + 3, cx - 1, cy + 4, '#0e3a20'); linha(g, cx - 1, cy + 4, cx + 2, cy + 1, '#0e3a20'); }
}

export function desenharPulso(g: G, cor: string): void { ret(g, 0, 1, 3, 1, cor); pxl(g, 1, 0, '#ffffff'); }
export function desenharSombra(g: G): void { elipse(g, 5, 2, 5, 2, '#05060f'); }
export function desenharCoracao(g: G, cor: string): void { for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, 0], [-1, -1], [1, -1]] as const) pxl(g, 1 + dx, 1 + dy, cor); }
export function desenharCarroJanela(g: G, noite: boolean, impar: boolean): void { ret(g, 1, 0, 3, 1, noite ? '#c9d2ff' : '#3a4568'); pxl(g, impar ? 4 : 0, 0, noite ? (impar ? '#fff3b0' : '#ff4040') : '#ffffff'); }
export function desenharNuvem(g: G, w: number): void { ret(g, 0, 5, w, 4, '#f4fbff'); ret(g, 4, 2, w - 10, 3, '#f4fbff'); ret(g, 7, 0, Math.max(4, w - 18), 2, '#ffffff'); ret(g, 2, 9, w - 4, 1, '#cfe6f2'); }

/** Placa flutuante com o nome da zona. Devolve o tamanho do canvas e o centro. */
export function placaPlana(texto: string): { w: number; h: number; xc: number; yc: number } {
  const { largura } = pixelsTexto(texto);
  return { w: largura + 12, h: 13, xc: Math.ceil(largura / 2) + 5, yc: 6 };
}
export function desenharPlaca(g: G, texto: string, cor: string): void {
  const { largura } = pixelsTexto(texto);
  const x = Math.ceil(largura / 2) + 5, y = 6;
  ret(g, x - largura / 2 - 4, y - 5, largura + 8, 11, '#0c0e1f');
  ret(g, x - largura / 2 - 4, y - 5, largura + 8, 1, cor); ret(g, x - largura / 2 - 4, y + 5, largura + 8, 1, cor);
  textoPlano(g, texto, x - largura / 2, y - 2, cor);
}

/** Texto curto na fonte 3 por 5 (ON AIR, Z, rótulos e dígitos). */
export function desenharTexto(g: G, texto: string, cor: string): void { textoPlano(g, texto, 0, 2, cor); }
export function larguraTexto(texto: string): number { return pixelsTexto(texto).largura; }
