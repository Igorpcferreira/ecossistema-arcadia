// Projeção isométrica 2:1 com ladrilhos de 32 por 16 (cada passo de ladrilho anda 16 px na
// horizontal e 8 px na vertical). O mundo inteiro vive em pixels de arte; a câmera amplia
// em múltiplos inteiros.
import type { Ponto } from '../arte/primitivas.ts';

export interface Geo {
  ni: number;
  nj: number;
  parede: number;
  ox: number;
  oy: number;
  larg: number;
  alt: number;
  iso(i: number, j: number, z?: number): Ponto;
  /** Ponto (u, v) numa parede do fundo: u corre ao longo da parede, v sobe. */
  mapaParede(p: 'I' | 'J', u: number, v: number): Ponto;
  /** Ladrilho (fracionário) sob um ponto do chão (z = 0). */
  ladrilho(x: number, y: number): [number, number];
}

export function criarGeo(ni: number, nj: number, parede: number): Geo {
  const ox = nj * 16 + 20, oy = parede + 26;
  const larg = ox + ni * 16 + 20, alt = oy + (ni + nj) * 8 + 40;
  return {
    ni, nj, parede, ox, oy, larg, alt,
    iso: (i, j, z = 0) => [ox + (i - j) * 16, oy + (i + j) * 8 - z],
    mapaParede: (p, u, v) => (p === 'J' ? [ox + u, oy + Math.floor(u / 2) - v] : [ox - 1 - u, oy + Math.floor(u / 2) - v]),
    ladrilho: (x, y) => [((x - ox) / 16 + (y - oy) / 8) / 2, ((y - oy) / 8 - (x - ox) / 16) / 2],
  };
}
