// Mobília do andar: desenho estático, camadas de animação com quadros enumeráveis (para
// pré-assar tudo na carga) e as luzes de cada tipo. Portado da prancha aprovada; as animações
// que a prancha redesenhava a cada quadro viraram listas de quadros com índice numérico.
import type { Estado, ValorProp } from '../cena/formato.ts';
import { tom } from './cor.ts';
import { CORES_ESTADO, ESTADOS_HOLO } from './estados.ts';
import { anel, elipse, estilo, linha, poli, pixelsTexto, pxl, ret, textoPlano, type G, type Ponto, type Proj } from './primitivas.ts';

export interface CtxObjeto {
  tipo: string;
  i: number;
  j: number;
  props: Record<string, ValorProp>;
}

export interface InfoAnim {
  t: number;
  /** Estado do dono quando ele está no posto e trabalhando (null: desligado). */
  ativo: Estado | null;
  /** Dono no posto, mesmo ocioso. */
  presente: boolean;
  /** Equipamento em uso (esteira, bicicleta). */
  usada: boolean;
  erro: boolean;
  faseRack: number;
  noite: boolean;
}

export interface Camada {
  nome: string;
  /** Quantos quadros a camada tem para este objeto. */
  n: (o: CtxObjeto) => number;
  /** Parte da chave que muda entre objetos do mesmo tipo (cor, nome). */
  variante?: (o: CtxObjeto) => string;
  desenhar: (g: G, Q: Proj, k: number, o: CtxObjeto) => void;
  /** Quadro do instante; -1 esconde a camada. */
  quadro: (o: CtxObjeto, a: InfoAnim) => number;
  /**
   * Com a ala em espera (stand-by): um quadro fixo, 'anima' para seguir animando, ou nada
   * (padrão) para apagar a camada: hologramas, telas e LEDs desligados.
   */
  emEspera?: number | 'anima';
}

export interface Luz { ii: number; jj: number; z: number; r: number; cor: string; int: number }

export interface TipoObjeto {
  w: number;
  d: number;
  h: number;
  bloqueia?: boolean;
  /** Rente ao chão: desenhado num passe antes dos objetos ordenados. */
  plano?: boolean;
  desenho: (g: G, P: Proj, o: CtxObjeto) => void;
  /** Parte da chave do desenho estático (props que mudam o desenho). */
  varianteBase?: (o: CtxObjeto) => string;
  camadas?: Camada[];
  luzes?: (o: CtxObjeto) => Luz[];
}

/* ---------- utilidades de props ---------- */
const s = (o: CtxObjeto, k: string, padrao = ''): string => { const v = o.props[k]; return typeof v === 'string' ? v : padrao; };
const n = (o: CtxObjeto, k: string, padrao: number): number => { const v = o.props[k]; return typeof v === 'number' ? v : padrao; };
const b = (o: CtxObjeto, k: string): boolean => o.props[k] === true;
const fixo = (k: number) => () => k;

/** Índice do quadro num ciclo de P segundos com N quadros, e o instante do meio dele. */
export function ciclo(t: number, P: number, N: number): number { return Math.floor(((((t % P) + P) % P) / P) * N) % N; }
const meio = (k: number, P: number, N: number) => ((k + 0.5) / N) * P;

/* ---------- formas isométricas ---------- */
interface OpcCaixa { topo?: string; esq?: string; dir?: string; brilho?: boolean }
export function caixa(g: G, P: Proj, i0: number, j0: number, w: number, d: number, z0: number, h: number, base: string, o: OpcCaixa = {}): void {
  const topo = o.topo ?? tom(base, 0.16), esq = o.esq ?? base, dir = o.dir ?? tom(base, -0.28);
  const A = P(i0, j0, z0 + h), B = P(i0 + w, j0, z0 + h), C = P(i0 + w, j0 + d, z0 + h), D = P(i0, j0 + d, z0 + h);
  if (h > 0) {
    const Cb = P(i0 + w, j0 + d, z0), Db = P(i0, j0 + d, z0), Bb = P(i0 + w, j0, z0);
    poli(g, [D, C, Cb, Db], esq);
    poli(g, [C, B, Bb, Cb], dir);
  }
  poli(g, [A, B, C, D], topo);
  if (o.brilho !== false && h > 0) { const cl = tom(topo, 0.3); linha(g, D[0], D[1], A[0], A[1], cl); linha(g, A[0], A[1], B[0], B[1], cl); }
}
export function faceE(g: G, P: Proj, i0: number, j0: number, w: number, d: number, z0: number, u0: number, u1: number, v0: number, v1: number, cor: string): void {
  poli(g, [P(i0 + u0, j0 + d, z0 + v1), P(i0 + u1, j0 + d, z0 + v1), P(i0 + u1, j0 + d, z0 + v0), P(i0 + u0, j0 + d, z0 + v0)], cor);
}
export function faceD(g: G, P: Proj, i0: number, j0: number, w: number, d: number, z0: number, u0: number, u1: number, v0: number, v1: number, cor: string): void {
  poli(g, [P(i0 + w, j0 + u0, z0 + v1), P(i0 + w, j0 + u1, z0 + v1), P(i0 + w, j0 + u1, z0 + v0), P(i0 + w, j0 + u0, z0 + v0)], cor);
}
export function topoR(g: G, P: Proj, i0: number, j0: number, i1: number, j1: number, z: number, cor: string): void {
  poli(g, [P(i0, j0, z), P(i1, j0, z), P(i1, j1, z), P(i0, j1, z)], cor);
}
export function folhagem(g: G, x: number, y: number, s1 = 1, cores = ['#2f7a45', '#3f9656', '#56b06a', '#7fd08a']): void {
  elipse(g, x, y, 6 * s1, 4 * s1, cores[0]);
  elipse(g, x - 3 * s1, y - 2 * s1, 4 * s1, 3 * s1, cores[1]);
  elipse(g, x + 3 * s1, y - 3 * s1, 4 * s1, 3 * s1, cores[1]);
  elipse(g, x, y - 5 * s1, 3 * s1, 3 * s1, cores[2]);
  pxl(g, x - 2, y - 6 * s1, cores[3]); pxl(g, x + 2, y - 4 * s1, cores[3]); pxl(g, x - 4 * s1, y - 2, cores[3]);
}
function semente(sd: number): () => number { let v = sd % 2147483647; if (v <= 0) v += 2147483646; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; }

/** Holograma vertical (código, linha do tempo ou desligado). */
export function holo(c: G, Q: Proj, a: number, bb: number, jj: number, z0: number, z1: number, ativo: boolean, cor: string, t: number, modo: 'codigo' | 'linhatempo' = 'codigo'): void {
  const p1 = Q(a, jj, z1), p2 = Q(bb, jj, z1), p3 = Q(bb, jj, z0), p4 = Q(a, jj, z0);
  c.globalAlpha = ativo ? 0.32 : 0.14;
  poli(c, [p1, p2, p3, p4], ativo ? '#3ee0ff' : '#5a6a90');
  c.globalAlpha = 1;
  const borda = ativo ? '#bff8ff' : '#6d7ba3';
  linha(c, p1[0], p1[1], p2[0], p2[1], borda); linha(c, p4[0], p4[1], p3[0], p3[1], borda);
  if (!ativo) return;
  if (modo === 'linhatempo') {
    const cores = ['#ff6b5a', '#ffb347', '#3ee0ff', '#7dffa8'];
    for (let k = 0; k < 4; k++) {
      const zz = z1 - 4 - k * 3, ini = a + 0.08 + ((k * 0.17 + t * 0.05) % 0.3), fim = Math.min(bb - 0.06, ini + 0.25 + (k % 2) * 0.15);
      const s0 = Q(ini, jj, zz), e = Q(fim, jj, zz); linha(c, s0[0], s0[1], e[0], e[1], cores[k]); linha(c, s0[0], s0[1] + 1, e[0], e[1] + 1, cores[k]);
    }
    const ph = a + 0.1 + ((t * 0.12) % 1) * (bb - a - 0.2); const s0 = Q(ph, jj, z1 - 1), e = Q(ph, jj, z0 + 1); linha(c, s0[0], s0[1], e[0], e[1], '#ffffff');
    return;
  }
  for (let k = 0; k < 5; k++) {
    const zz = z1 - 3 - k * 2.3;
    const len = 0.22 + (((k * 7 + Math.floor(t * 3)) % 6) / 10);
    const s0 = Q(a + 0.07, jj, zz), e = Q(Math.min(bb - 0.06, a + 0.07 + len * (bb - a)), jj, zz);
    linha(c, s0[0], s0[1], e[0], e[1], k % 2 ? cor : '#e8fdff');
  }
}

/** Camada de holograma de código ligada ao estado do dono (desligado + 6 quadros por estado). */
function camadaHolo(a: number, bb: number, jj: number, z0: number, z1: number): Camada {
  return {
    nome: 'holo',
    n: (o) => (s(o, 'modo') === 'linhatempo' ? 41 : 1 + ESTADOS_HOLO.length * 6),
    variante: (o) => (s(o, 'modo') === 'linhatempo' ? 'lt' : 'cod'),
    desenhar: (g, Q, k, o) => {
      if (k === 0) { holo(g, Q, a, bb, jj, z0, z1, false, '#fff', 0); return; }
      if (s(o, 'modo') === 'linhatempo') { holo(g, Q, a, bb, jj, z0, z1, true, '#fff', meio(k - 1, 25 / 3, 40), 'linhatempo'); return; }
      const e = Math.floor((k - 1) / 6), f = (k - 1) % 6;
      holo(g, Q, a, bb, jj, z0, z1, true, CORES_ESTADO[ESTADOS_HOLO[e]], (f + 0.5) / 3);
    },
    quadro: (o, an) => {
      if (!an.ativo) return 0;
      if (s(o, 'modo') === 'linhatempo') return 1 + ciclo(an.t, 25 / 3, 40);
      const e = ESTADOS_HOLO.indexOf(an.ativo);
      return e < 0 ? 0 : 1 + e * 6 + (Math.floor(an.t * 3) % 6);
    },
  };
}

function colunasQuadro(c: G, Q: Proj, k: number, base: number, passo: number, jj: number, zTopo: number, larg: number, alt: number, rotulos: string[] | null): void {
  for (let col = 0; col < 5; col++) {
    const p = Q(base + col * passo, jj, zTopo);
    if (rotulos) textoPlano(c, rotulos[col] ?? '', p[0], p[1], '#ffffff'); else pxl(c, p[0], p[1], '#ffffff');
    const nBarras = 1 + ((col * (rotulos ? 2 : 1) + k) % 3);
    for (let m = 0; m < nBarras; m++) {
      const q = Q(base + col * passo + (rotulos ? 0.05 : 0), jj, zTopo - (rotulos ? 8 : 4) - m * 4);
      ret(c, q[0] - (rotulos ? 0 : 1), q[1], larg, alt, col < 2 ? '#7dffa8' : (col === 2 ? '#ffcf4d' : '#c9b8ff'));
    }
  }
}

function carro(c: G, Q: Proj, bob: number, esp: number, pisca: boolean, forma: string): void {
  const p = Q(1, 1, 18 + bob);
  c.globalAlpha = 0.16; poli(c, [Q(0.4, 1, 6), Q(1.6, 1, 6), [p[0] + 14, p[1] - 6], [p[0] - 14, p[1] - 6]], '#3ee0ff'); c.globalAlpha = 1;
  const cor = pisca ? '#9ff3ff' : '#3ee0ff';
  if (forma === 'carro') {
    const desenho = ['..........##########........', '.......####..........###.....', '.....###.................##..', '####...........................##', '#..........................#..#', '##..###..............###....##.', '...#...#............#...#......', '....###..............###.......'];
    desenho.forEach((l, y) => { for (let x = 0; x < l.length; x++) if (l[x] === '#') pxl(c, p[0] + (esp > 0 ? x - 15 : 15 - x), p[1] - 18 + y, cor); });
  } else {
    // vitrine genérica: cubo de arame girando
    const r = 9, a = esp > 0 ? 0.3 : 1.1;
    const pts: Ponto[] = [];
    for (let k = 0; k < 4; k++) { const ang = a + (k * Math.PI) / 2; pts.push([p[0] + Math.cos(ang) * r, p[1] - 9 + Math.sin(ang) * r * 0.45]); }
    for (let k = 0; k < 4; k++) {
      const A = pts[k], B = pts[(k + 1) % 4];
      linha(c, A[0], A[1], B[0], B[1], cor); linha(c, A[0], A[1] - 12, B[0], B[1] - 12, cor); linha(c, A[0], A[1], A[0], A[1] - 12, cor);
    }
  }
  for (let y = 0; y < 8; y += 2) { c.globalAlpha = 0.25; ret(c, p[0] - 15, p[1] - 18 + y, 31, 1, '#bff8ff'); }
  c.globalAlpha = 1;
}

/* ======================= Tipos ======================= */
export const TIPOS: Record<string, TipoObjeto> = {
  mesa: {
    w: 2, d: 1, h: 34,
    varianteBase: (o) => [s(o, 'cor'), s(o, 'neon'), s(o, 'caneca'), s(o, 'itens')].join(','),
    desenho(g, P, o) {
      for (const [a, b2] of [[0.06, 0.1], [1.8, 0.1], [0.06, 0.78], [1.8, 0.78]] as const) caixa(g, P, a, b2, 0.14, 0.14, 0, 9, '#545b76', { brilho: false });
      caixa(g, P, 0, 0, 2, 1, 9, 2, s(o, 'cor', '#e7eaf2'));
      const a = P(0, 1, 9), c2 = P(2, 1, 9); linha(g, a[0], a[1], c2[0], c2[1], s(o, 'neon', '#3ee0ff'));
      caixa(g, P, 0.25, 0.45, 0.7, 0.3, 11, 1, '#242838', { brilho: false });
      const caneca = s(o, 'caneca');
      if (caneca) caixa(g, P, 1.1, 0.6, 0.16, 0.16, 11, 3, caneca, { brilho: false });
      const itens = s(o, 'itens');
      if (itens === 'celulares') for (let k = 0; k < 3; k++) caixa(g, P, 1.05 + k * 0.2, 0.3, 0.1, 0.05, 11, 6, '#1d2030', { brilho: false });
      if (itens === 'paleta') { caixa(g, P, 1.05, 0.55, 0.4, 0.3, 11, 1, '#f3efe6', { brilho: false }); ['#ff6b5a', '#ffd35c', '#4ea8ff', '#7dffa8'].forEach((cor, k) => { const p = P(1.12 + k * 0.08, 0.68, 12.5); pxl(g, p[0], p[1], cor); }); }
      if (itens === 'carimbo') caixa(g, P, 1.1, 0.55, 0.18, 0.18, 11, 4, '#c0304a', { brilho: false });
      caixa(g, P, 1.55, 0.12, 0.1, 0.1, 11, 4, '#8a93ad', { brilho: false });
    },
    camadas: [camadaHolo(1.25, 1.98, 0.1, 15, 29)],
    luzes: () => [{ ii: 1.6, jj: 0.1, z: 22, r: 18, cor: '#3ee0ff', int: 0.55 }],
  },
  cadeira: {
    w: 1, d: 1, h: 28, bloqueia: false,
    varianteBase: (o) => s(o, 'cor') + s(o, 'detalhe'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#3a3f5c');
      caixa(g, P, 0.42, 0.42, 0.16, 0.16, 0, 5, '#262a3c', { brilho: false });
      caixa(g, P, 0.2, 0.25, 0.6, 0.55, 5, 3, cor);
      caixa(g, P, 0.2, 0.14, 0.6, 0.12, 8, 17, cor);
      caixa(g, P, 0.3, 0.13, 0.4, 0.13, 19, 4, s(o, 'detalhe', tom(cor, 0.35)), { brilho: false });
    },
  },
  console: {
    w: 2, d: 1, h: 52,
    desenho(g, P) {
      caixa(g, P, 0.7, 0.25, 0.6, 0.5, 0, 10, '#3b3f58');
      caixa(g, P, 0.2, 0.1, 1.6, 0.8, 10, 4, '#2a2e44', { topo: '#4a5078' });
      const a = P(0.2, 0.9, 12), c2 = P(1.8, 0.9, 12); linha(g, a[0], a[1], c2[0], c2[1], '#8a5cff');
    },
    camadas: [
      {
        nome: 'holo', n: fixo((ESTADOS_HOLO.length + 1) * 6),
        desenhar: (g, Q, k) => { const e = Math.floor(k / 6), f = k % 6; holo(g, Q, 0.15, 1.85, 0.1, 22, 46, true, e === 0 ? '#8a5cff' : CORES_ESTADO[ESTADOS_HOLO[e - 1]], (f + 0.5) / 3); },
        quadro: (_o, an) => { const e = an.ativo ? ESTADOS_HOLO.indexOf(an.ativo) + 1 : 0; return Math.max(0, e) * 6 + (Math.floor(an.t * 3) % 6); },
      },
      { nome: 'colunas', n: fixo(3), desenhar: (g, Q, k) => colunasQuadro(g, Q, k, 0.3, 0.32, 0.1, 44, 4, 2, null), quadro: (_o, an) => Math.floor(an.t / 3) % 3 },
    ],
    luzes: () => [{ ii: 1, jj: 0.1, z: 34, r: 26, cor: '#8a5cff', int: 0.6 }],
  },
  rack: {
    w: 1, d: 1, h: 40,
    desenho(g, P) {
      caixa(g, P, 0.08, 0.08, 0.84, 0.84, 0, 38, '#232838', { topo: '#343a52' });
      for (let v = 4; v < 36; v += 4) { faceE(g, P, 0.08, 0.08, 0.84, 0.84, 0, 0.1, 0.8, v, v + 1, '#161a28'); faceD(g, P, 0.08, 0.08, 0.84, 0.84, 0, 0.1, 0.8, v, v + 1, '#121521'); }
    },
    camadas: [{
      nome: 'leds', n: fixo(32),
      desenhar: (g, Q, k) => {
        const erro = k >= 16, phi = (((k % 16) + 0.5) / 16) * Math.PI * 2;
        for (let v = 6; v < 36; v += 4) for (let kk = 0; kk < 3; kk++) {
          if (Math.sin(phi + v * 1.7 + kk * 2.3) <= 0.1) continue;
          const p = Q(0.2 + kk * 0.22, 0.92, v); pxl(g, p[0], p[1], erro ? '#ff5050' : (kk === 2 ? '#3ee0ff' : '#52ffa8'));
        }
      },
      quadro: (o, an) => {
        const dois = Math.PI * 2, fase = (((an.faseRack + o.i * 3.1 + o.j) % dois) + dois) % dois;
        return (Math.floor((fase / dois) * 16) % 16) + (an.erro ? 16 : 0);
      },
    }],
    luzes: (o) => ((o.i + o.j) % 3 === 0 ? [{ ii: 0.5, jj: 0.9, z: 20, r: 22, cor: '#2ad8ff', int: 0.35 }] : []),
  },
  resfriador: {
    w: 2, d: 1, h: 30,
    desenho(g, P) { caixa(g, P, 0.05, 0.1, 1.9, 0.8, 0, 26, '#5b6380', { topo: '#7a83a3' }); faceE(g, P, 0.05, 0.1, 1.9, 0.8, 0, 0.2, 0.9, 6, 22, '#2e3348'); faceE(g, P, 0.05, 0.1, 1.9, 0.8, 0, 1.0, 1.7, 6, 22, '#2e3348'); },
    camadas: [{
      nome: 'helice', n: fixo(8),
      desenhar: (g, Q, k) => { const a = meio(k, Math.PI / 9, 8) * 9; for (const cx of [0.55, 1.35]) { const p = Q(cx, 0.9, 14); for (let r = 1; r < 6; r++) { pxl(g, p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.9, '#9fb3d9'); pxl(g, p[0] - Math.cos(a) * r, p[1] - Math.sin(a) * r * 0.9, '#9fb3d9'); } } },
      quadro: (_o, an) => ciclo(an.t, Math.PI / 9, 8),
      emEspera: 0,
    }],
  },
  planta: {
    w: 1, d: 1, h: 30,
    varianteBase: (o) => s(o, 'vaso') + n(o, 's', 1),
    desenho(g, P, o) { caixa(g, P, 0.28, 0.28, 0.44, 0.44, 0, 8, s(o, 'vaso', '#e3e6ee')); const p = P(0.5, 0.5, 18); folhagem(g, p[0], p[1], n(o, 's', 1)); },
  },
  estante: {
    w: 2, d: 1, h: 34,
    varianteBase: (o) => `${s(o, 'cor')}${b(o, 'trofeus')}${o.i},${o.j}`,
    desenho(g, P, o) {
      const base = s(o, 'cor', '#6b4a32');
      caixa(g, P, 0, 0.12, 2, 0.5, 0, 32, base, { topo: tom(base, 0.2) });
      const r = semente(o.i * 7 + o.j * 13 + 3);
      const livros = ['#c0392b', '#2f80ed', '#f2c94c', '#27ae60', '#9b51e0', '#ebe6dc'];
      for (const v of [3, 12, 21]) {
        faceE(g, P, 0, 0.12, 2, 0.5, 0, 0.05, 1.95, v - 1, v, tom(base, -0.35));
        let u = 0.1;
        while (u < 1.85) {
          const w = 0.08 + r() * 0.08, h = 5 + Math.floor(r() * 3);
          const cor = b(o, 'trofeus') ? (r() < 0.5 ? '#e8c14e' : '#c0c7d6') : livros[Math.floor(r() * livros.length)];
          faceE(g, P, 0, 0.12, 2, 0.5, 0, u, Math.min(1.9, u + w), v, v + h, cor);
          u += w + 0.03 + (b(o, 'trofeus') ? 0.12 : 0);
        }
      }
    },
  },
  sofa: {
    w: 3, d: 1, h: 18,
    varianteBase: (o) => s(o, 'cor') + s(o, 'almofada'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#4a3a7a');
      caixa(g, P, 0.04, 0.15, 2.92, 0.8, 0, 6, tom(cor, -0.2));
      caixa(g, P, 0.15, 0.3, 2.7, 0.62, 6, 2, cor);
      caixa(g, P, 0.04, 0.12, 2.92, 0.22, 6, 10, tom(cor, -0.1));
      caixa(g, P, 0.02, 0.15, 0.2, 0.8, 6, 5, tom(cor, -0.15));
      caixa(g, P, 2.78, 0.15, 0.2, 0.8, 6, 5, tom(cor, -0.15));
      const al = s(o, 'almofada'); if (al) caixa(g, P, 0.5, 0.35, 0.4, 0.15, 8, 5, al);
    },
  },
  puff: {
    w: 1, d: 1, h: 14,
    varianteBase: (o) => s(o, 'cor'),
    desenho(g, P, o) { const cor = s(o, 'cor', '#ff6fae'); const p = P(0.5, 0.5, 4); elipse(g, p[0], p[1] + 2, 9, 5, tom(cor, -0.25)); elipse(g, p[0], p[1], 9, 5, cor); elipse(g, p[0] - 2, p[1] - 2, 4, 2, tom(cor, 0.3)); },
  },
  balcao: {
    w: 3, d: 1, h: 30,
    desenho(g, P) {
      caixa(g, P, 0, 0.2, 3, 0.75, 0, 12, '#2c3150', { topo: '#e9ecf3' });
      const a = P(0, 0.95, 5), c2 = P(3, 0.95, 5); linha(g, a[0], a[1], c2[0], c2[1], '#ff8fd0');
      caixa(g, P, 0.25, 0.3, 0.6, 0.45, 12, 10, '#b9c0d0', { topo: '#d6dbe6' });
      faceE(g, P, 0.25, 0.3, 0.6, 0.45, 12, 0.1, 0.5, 2, 7, '#2a2e40');
      for (const u of [1.2, 1.5, 1.8]) caixa(g, P, u, 0.55, 0.16, 0.16, 12, 3, '#f4f1ea', { brilho: false });
      caixa(g, P, 2.3, 0.35, 0.5, 0.4, 12, 7, '#c79c6e');
    },
    camadas: [{
      nome: 'vapor', n: fixo(15),
      desenhar: (g, Q, k) => { const t = meio(k, 1.25, 15); for (let kk = 0; kk < 3; kk++) { const f = (t * 0.8 + kk * 0.33) % 1; const p = Q(0.55, 0.5, 23 + f * 12); g.globalAlpha = 1 - f; pxl(g, p[0] + Math.sin(t * 3 + kk) * 1.5, p[1], '#e8f0ff'); g.globalAlpha = 1; } },
      quadro: (_o, an) => ciclo(an.t, 1.25, 15),
    }],
    luzes: () => [{ ii: 1.5, jj: 1, z: 6, r: 24, cor: '#ff8fd0', int: 0.45 }],
  },
  vending: {
    w: 1, d: 1, h: 36,
    desenho(g, P) {
      caixa(g, P, 0.08, 0.15, 0.84, 0.75, 0, 34, '#2b7fd6', { topo: '#5aa3ea' });
      faceE(g, P, 0.08, 0.15, 0.84, 0.75, 0, 0.08, 0.62, 8, 28, '#15203a');
      const cores = ['#ffcf4d', '#ff6b5a', '#7dffa8', '#ffffff'];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) faceE(g, P, 0.08, 0.15, 0.84, 0.75, 0, 0.12 + k * 0.12, 0.17 + k * 0.12, 10 + r * 5, 13 + r * 5, cores[(r + k) % 4]);
      const p = P(0.2, 0.9, 32); textoPlano(g, 'WHEY', p[0] - 1, p[1] - 1, '#ffffff');
    },
    luzes: () => [{ ii: 0.4, jj: 0.9, z: 18, r: 24, cor: '#4ea8ff', int: 0.6 }],
  },
  arcade: {
    w: 1, d: 1, h: 40,
    varianteBase: (o) => s(o, 'cor'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#4a2d8a');
      caixa(g, P, 0.15, 0.2, 0.7, 0.65, 0, 22, cor);
      caixa(g, P, 0.15, 0.2, 0.7, 0.4, 22, 14, cor);
      caixa(g, P, 0.15, 0.6, 0.7, 0.25, 18, 3, '#1d1f2e', { topo: '#2a2d42' });
      faceE(g, P, 0.15, 0.2, 0.7, 0.4, 22, 0.08, 0.62, 1, 11, '#0b0d18');
      faceE(g, P, 0.15, 0.2, 0.7, 0.65, 0, 0.08, 0.62, 23, 25, '#ffcf4d');
    },
    camadas: [{
      nome: 'tela', n: fixo(28),
      desenhar: (g, Q, f) => { for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) { if (((x * 3 + y * 5 + f) % 7) > 2) continue; const p = Q(0.32 + x * 0.12, 0.6, 25 + y * 2); pxl(g, p[0], p[1], ['#ff4fd8', '#3ee0ff', '#ffcf4d', '#7dffa8'][(x + y + f) % 4]); } },
      quadro: (_o, an) => Math.floor(an.t * 6) % 28,
    }],
    luzes: (o) => [{ ii: 0.5, jj: 0.65, z: 28, r: 20, cor: s(o, 'cor') === '#2d6a8a' ? '#3ee0ff' : '#ff4fd8', int: 0.6 }],
  },
  halteres: {
    w: 2, d: 1, h: 18,
    desenho(g, P) {
      caixa(g, P, 0.05, 0.2, 1.9, 0.6, 0, 3, '#2a2f3a');
      caixa(g, P, 0.05, 0.25, 0.12, 0.5, 3, 11, '#4a5266'); caixa(g, P, 1.83, 0.25, 0.12, 0.5, 3, 11, '#4a5266');
      caixa(g, P, 0.05, 0.25, 1.9, 0.5, 8, 1, '#3a4152');
      for (let k = 0; k < 5; k++) { caixa(g, P, 0.25 + k * 0.33, 0.3, 0.1, 0.4, 3, 4, '#1b1d24'); caixa(g, P, 0.25 + k * 0.33, 0.3, 0.1, 0.4, 9, 4, '#22252e'); }
    },
  },
  supino: {
    w: 2, d: 1, h: 26,
    desenho(g, P) {
      caixa(g, P, 0.3, 0.35, 1.4, 0.3, 0, 7, '#2c303c');
      caixa(g, P, 0.3, 0.32, 1.4, 0.36, 7, 3, '#a8323e', { topo: '#c4404c' });
      caixa(g, P, 0.15, 0.2, 0.1, 0.1, 0, 20, '#596179'); caixa(g, P, 0.15, 0.7, 0.1, 0.1, 0, 20, '#596179');
      caixa(g, P, 0.05, 0.1, 0.08, 0.8, 18, 1, '#c5cad6', { brilho: false });
      caixa(g, P, 0.02, 0.05, 0.08, 0.18, 15, 7, '#16181f'); caixa(g, P, 0.02, 0.77, 0.08, 0.18, 15, 7, '#16181f');
    },
  },
  agachamento: {
    w: 2, d: 2, h: 44,
    desenho(g, P) {
      for (const [a, b2] of [[0.15, 0.15], [1.75, 0.15], [0.15, 1.75], [1.75, 1.75]] as const) caixa(g, P, a, b2, 0.12, 0.12, 0, 40, '#59617a');
      caixa(g, P, 0.15, 0.15, 1.72, 0.12, 40, 2, '#6b7390'); caixa(g, P, 0.15, 1.75, 1.72, 0.12, 40, 2, '#6b7390');
      caixa(g, P, 0.1, 0.9, 1.8, 0.08, 26, 1, '#cfd4de', { brilho: false });
      caixa(g, P, 0.02, 0.7, 0.1, 0.5, 21, 10, '#14161c'); caixa(g, P, 1.88, 0.7, 0.1, 0.5, 21, 10, '#14161c');
    },
  },
  esteira: {
    w: 1, d: 2, h: 26, bloqueia: false, plano: true,
    desenho(g, P) {
      caixa(g, P, 0.12, 0.1, 0.76, 1.8, 0, 3, '#22252f', { topo: '#2c303c' });
      caixa(g, P, 0.12, 0.1, 0.08, 0.6, 3, 16, '#596179'); caixa(g, P, 0.8, 0.1, 0.08, 0.6, 3, 16, '#596179');
      caixa(g, P, 0.12, 0.08, 0.76, 0.22, 17, 5, '#3a4152', { topo: '#4b546a' });
    },
    camadas: [{
      nome: 'esteira', n: fixo(7),
      desenhar: (g, Q, k) => {
        const desloc = k > 0 ? ((k - 1) + 0.5) / 6 : 0;
        for (let kk = 0; kk < 6; kk++) { const jj = 0.35 + ((kk / 6 + desloc / 6) % 1) * 1.5; const a = Q(0.2, jj, 3), c2 = Q(0.8, jj, 3); linha(g, a[0], a[1], c2[0], c2[1], '#3a3f4e'); }
        const p = Q(0.5, 0.19, 21); pxl(g, p[0], p[1], k > 0 ? '#52ffa8' : '#2a4a3a');
      },
      quadro: (_o, an) => (an.usada ? 1 + (Math.floor(((an.t * 3) % 1) * 6) % 6) : 0),
      emEspera: 'anima',
    }],
  },
  palco: {
    w: 3, d: 2, h: 10, bloqueia: false, plano: true,
    desenho(g, P) {
      caixa(g, P, 0, 0, 3, 2, 0, 5, '#2a2333', { topo: '#3d3150' });
      const a = P(0, 2, 5), c2 = P(3, 2, 5), d2 = P(3, 0, 5); linha(g, a[0], a[1], c2[0], c2[1], '#e8c14e'); linha(g, c2[0], c2[1], d2[0], d2[1], '#e8c14e');
      const p = P(0.8, 2, 3); textoPlano(g, 'POSE', p[0], p[1] - 3, '#e8c14e');
    },
    luzes: () => [{ ii: 1.5, jj: 1, z: 18, r: 40, cor: '#ffe6a8', int: 0.5 }],
  },
  espelho: {
    w: 3, d: 1, h: 42,
    desenho(g, P) {
      caixa(g, P, 0, 0.72, 3, 0.16, 0, 38, '#9aa3b8', { topo: '#c9cfdc' });
      faceE(g, P, 0, 0.72, 3, 0.16, 0, 0.08, 2.92, 3, 36, '#a9cfe8');
      for (let k = 0; k < 5; k++) { const a = P(0.3 + k * 0.6, 0.88, 33), c2 = P(0.55 + k * 0.6, 0.88, 6); linha(g, a[0], a[1], c2[0], c2[1], '#dff3ff'); }
    },
  },
  refletor: {
    w: 1, d: 1, h: 40,
    desenho(g, P) { caixa(g, P, 0.42, 0.42, 0.16, 0.16, 0, 30, '#2c303c'); caixa(g, P, 0.25, 0.3, 0.5, 0.4, 30, 7, '#1d2030'); faceE(g, P, 0.25, 0.3, 0.5, 0.4, 30, 0.1, 0.4, 2, 5, '#fff3c4'); },
    luzes: () => [{ ii: 0.5, jj: 0.8, z: 32, r: 18, cor: '#fff3c4', int: 0.7 }],
  },
  telaVerde: {
    w: 4, d: 1, h: 48,
    desenho(g, P) { caixa(g, P, 0, 0.08, 4, 0.15, 0, 44, '#2fae4f', { topo: '#4cc86a' }); topoR(g, P, 0, 0.23, 4, 1, 0, '#2a9c47'); },
  },
  camera: {
    w: 1, d: 1, h: 30,
    desenho(g, P) {
      const base = P(0.5, 0.5, 18);
      for (const [a, b2] of [[0.15, 0.3], [0.85, 0.3], [0.5, 0.9]] as const) { const p = P(a, b2, 0); linha(g, p[0], p[1], base[0], base[1], '#3a3f50'); }
      caixa(g, P, 0.25, 0.3, 0.5, 0.4, 18, 7, '#1d2030');
      caixa(g, P, 0.3, 0.7, 0.25, 0.22, 20, 4, '#2a2e40');
    },
    camadas: [{ nome: 'rec', n: fixo(2), desenhar: (g, Q, k) => { const p = Q(0.7, 0.3, 26); pxl(g, p[0], p[1], k ? '#ff3030' : '#4a1a1a'); }, quadro: (_o, an) => (an.usada && Math.floor(an.t * 2) % 2 ? 1 : 0), emEspera: 0 }],
  },
  ringlight: {
    w: 1, d: 1, h: 42,
    desenho(g, P) { caixa(g, P, 0.45, 0.45, 0.1, 0.1, 0, 28, '#3a3f50'); const p = P(0.5, 0.5, 34); anel(g, p[0], p[1], 6, 6, '#fffbe8', 60); anel(g, p[0], p[1], 5, 5, '#e9e2c6', 60); },
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 34, r: 24, cor: '#fff8e0', int: 0.7 }],
  },
  nucleo: {
    w: 4, d: 4, h: 78,
    desenho(g, P) {
      caixa(g, P, 0, 0, 4, 4, 0, 4, '#8f98b3', { topo: '#c3cad9' });
      caixa(g, P, 0.6, 0.6, 2.8, 2.8, 4, 4, '#6d7694', { topo: '#a8b0c6' });
      caixa(g, P, 1.3, 1.3, 1.4, 1.4, 8, 8, '#3a4160', { topo: '#59648f' });
      const c = P(2, 2, 16); elipse(g, c[0], c[1], 9, 4, '#1b2a44'); anel(g, c[0], c[1], 9, 4, '#3ee0ff', 80);
    },
    camadas: [
      {
        nome: 'esfera', n: fixo(24),
        desenhar: (c, Q, k) => {
          const t = meio(k, Math.PI / 0.9, 24);
          const base = Q(2, 2, 16), cen = Q(2, 2, 50);
          c.globalAlpha = 0.18; ret(c, base[0] - 6, cen[1], 13, base[1] - cen[1], '#3ee0ff'); c.globalAlpha = 1;
          const R = 13;
          c.globalAlpha = 0.85; elipse(c, cen[0], cen[1], R, R, '#0f3a52'); c.globalAlpha = 1;
          anel(c, cen[0], cen[1], R, R, '#3ee0ff', 120);
          for (let kk = 0; kk < 3; kk++) { const f = t * 0.9 + (kk * Math.PI) / 3; anel(c, cen[0], cen[1], Math.max(1, Math.abs(Math.cos(f)) * R), R, '#2ab3d9', 90); }
          for (const yy of [-7, 0, 7]) anel(c, cen[0], cen[1] + yy, Math.sqrt(R * R - yy * yy), 2, '#2ab3d9', 60);
        },
        quadro: (_o, an) => ciclo(an.t, Math.PI / 0.9, 24),
      },
      {
        nome: 'ouro', n: fixo(48),
        desenhar: (c, Q, k) => { const a = ((k + 0.5) / 48) * Math.PI * 2; const cen = Q(2, 2, 50); anel(c, cen[0], cen[1], 22, 7, '#ffcf4d', 90, a, a + 2.2); },
        quadro: (_o, an) => ciclo(an.t * 1.4, Math.PI * 2, 48),
      },
      {
        nome: 'magenta', n: fixo(48),
        desenhar: (c, Q, k) => { const a = ((k + 0.5) / 48) * Math.PI * 2; const cen = Q(2, 2, 50); anel(c, cen[0], cen[1], 26, 9, '#ff4fd8', 90, -a, -a + 1.6); },
        quadro: (_o, an) => ciclo(an.t * 0.98, Math.PI * 2, 48),
      },
    ],
    luzes: () => [{ ii: 2, jj: 2, z: 48, r: 70, cor: '#3ee0ff', int: 0.85 }, { ii: 2, jj: 2, z: 10, r: 46, cor: '#2a8cff', int: 0.5 }],
  },
  doca: {
    w: 2, d: 1, h: 6, bloqueia: false, plano: true,
    desenho(g, P) { caixa(g, P, 0.05, 0.1, 1.9, 0.8, 0, 2, '#3a4160', { topo: '#4c557a' }); for (const u of [0.5, 1.5]) { const p = P(u, 0.5, 2); anel(g, p[0], p[1], 5, 2, '#3ee0ff', 30); } },
    camadas: [{ nome: 'luz', n: fixo(4), desenhar: (g, Q, k) => { const t = (k + 0.5) / 4; for (const u of [0.5, 1.5]) { const p = Q(u, 0.5, 2); if (Math.floor(t * 2 + u) % 2) pxl(g, p[0], p[1], '#ffcf4d'); } }, quadro: (_o, an) => Math.floor(an.t * 4) % 4 }],
  },
  terminal: {
    w: 1, d: 1, h: 34,
    desenho(g, P) { caixa(g, P, 0.3, 0.3, 0.4, 0.4, 0, 14, '#3a4160', { topo: '#59648f' }); caixa(g, P, 0.2, 0.25, 0.6, 0.5, 14, 2, '#2a2e44'); },
    camadas: [{ nome: 'holo', n: fixo(6), desenhar: (g, Q, k) => holo(g, Q, 0.15, 0.85, 0.5, 18, 30, true, '#3ee0ff', (k + 0.5) / 3), quadro: (o, an) => Math.floor((an.t + o.i) * 3) % 6 }],
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 24, r: 16, cor: '#3ee0ff', int: 0.5 }],
  },
  teleporte: {
    w: 2, d: 2, h: 6, bloqueia: false, plano: true,
    desenho(g, P) {
      caixa(g, P, 0.1, 0.1, 1.8, 1.8, 0, 3, '#3a4160', { topo: '#4b557a' });
      const p = P(1, 1, 3); elipse(g, p[0], p[1], 20, 9, '#232a48'); anel(g, p[0], p[1], 20, 9, '#3ee0ff', 120); anel(g, p[0], p[1], 14, 6, '#2ab3d9', 90);
    },
    camadas: [{
      nome: 'arco', n: fixo(64),
      desenhar: (g, Q, k) => { const pos = k % 32, pisca = k >= 32; const a = ((pos + 0.5) / 32) * Math.PI * 2; const p = Q(1, 1, 3); anel(g, p[0], p[1], 17, 7.5, pisca ? '#9ff3ff' : '#3ee0ff', 40, a, a + 1.2); },
      quadro: (_o, an) => ciclo(an.t, Math.PI * 2, 32) + (Math.floor(an.t * 4) % 2) * 32,
    }],
    luzes: () => [{ ii: 1, jj: 1, z: 6, r: 40, cor: '#3ee0ff', int: 0.6 }],
  },
  balcaoRecepcao: {
    w: 3, d: 1, h: 20,
    desenho(g, P) {
      caixa(g, P, 0, 0.2, 3, 0.75, 0, 13, '#e6e9f2', { topo: '#f5f7fb' });
      const a = P(0, 0.95, 6), c2 = P(3, 0.95, 6); linha(g, a[0], a[1], c2[0], c2[1], '#ffe08a');
      const p = P(0.6, 0.95, 11); textoPlano(g, 'BEM-VINDO', p[0], p[1] - 1, '#9a7a2a');
    },
    luzes: () => [{ ii: 1.5, jj: 1, z: 6, r: 28, cor: '#ffe08a', int: 0.45 }],
  },
  cubiculo: {
    w: 2, d: 2, h: 22, bloqueia: false,
    desenho(g, P) { caixa(g, P, 0, 0, 2, 0.12, 0, 18, '#5a6380', { topo: '#7a83a3' }); caixa(g, P, 0, 0.12, 0.12, 1.88, 0, 18, '#525b77', { topo: '#7a83a3' }); },
  },
  aquario: {
    w: 2, d: 1, h: 34,
    desenho(g, P) {
      caixa(g, P, 0.05, 0.15, 1.9, 0.7, 0, 10, '#3a2a22', { topo: '#5a4234' });
      caixa(g, P, 0.08, 0.18, 1.84, 0.64, 10, 16, '#2b6fa8', { topo: '#7cc6ff', esq: '#2f7dbe', dir: '#2163a0' });
      for (const u of [0.3, 0.9, 1.5]) { const p = P(u, 0.82, 11); linha(g, p[0], p[1], p[0], p[1] - 7, '#3fae5a'); pxl(g, p[0] + 1, p[1] - 4, '#56c46c'); }
    },
    luzes: () => [{ ii: 1, jj: 0.82, z: 18, r: 26, cor: '#4fb3ff', int: 0.55 }],
  },
  mesaComando: {
    w: 3, d: 1, h: 46,
    desenho(g, P) {
      for (const [a, b2] of [[0.06, 0.1], [2.8, 0.1], [0.06, 0.78], [2.8, 0.78]] as const) caixa(g, P, a, b2, 0.14, 0.14, 0, 10, '#2a2c3a', { brilho: false });
      caixa(g, P, 0, 0, 3, 1, 10, 2, '#1d1f2e', { topo: '#2b2e44' });
      caixa(g, P, 0.75, 0.45, 1.5, 0.3, 12, 1, '#20222f', { brilho: false });
      caixa(g, P, 2.35, 0.5, 0.18, 0.22, 12, 1, '#2a2d40', { brilho: false });
      caixa(g, P, 2.45, 0.55, 0.16, 0.16, 12, 3, '#f2efe8', { brilho: false });
      caixa(g, P, 0.15, 0.55, 0.12, 0.2, 12, 8, '#3a3d52', { brilho: false });
    },
    camadas: [
      {
        nome: 'borda', n: fixo(24),
        desenhar: (g, Q, k) => { const t = meio(k, 3, 24); const a = Q(0, 1, 10), c2 = Q(3, 1, 10); for (let kk = 0; kk < 24; kk++) { const x = a[0] + ((c2[0] - a[0]) * kk) / 24, y = a[1] + ((c2[1] - a[1]) * kk) / 24; estilo(g, `hsl(${(kk * 15 + t * 120) % 360} 90% 60%)`); g.fillRect(Math.round(x), Math.round(y), 2, 1); } },
        quadro: (_o, an) => ciclo(an.t, 3, 24),
      },
      {
        nome: 'teclas', n: fixo(18),
        desenhar: (g, Q, k) => { const t = meio(k, 1.8, 18); for (let kk = 0; kk < 10; kk++) { const p = Q(0.8 + kk * 0.14, 0.6, 13); estilo(g, `hsl(${(kk * 36 + t * 200) % 360} 90% 65%)`); g.fillRect(p[0], p[1], 1, 1); } },
        quadro: (_o, an) => ciclo(an.t, 1.8, 18),
      },
      {
        nome: 'fone', n: fixo(2),
        desenhar: (g, Q, k) => { const f = Q(0.21, 0.75, 16); ret(g, f[0] - 1, f[1] - 2, 3, 4, '#0b0d18'); pxl(g, f[0], f[1] - 1, k ? '#3ee0ff' : '#ffcf4d'); pxl(g, f[0], f[1], '#7dffa8'); },
        quadro: (_o, an) => Math.floor(an.t * 2) % 2,
      },
      {
        nome: 'holoE', n: fixo(7),
        desenhar: (g, Q, k) => holo(g, Q, 0.05, 0.6, 0.1, 18, 36, k > 0, '#ffcf4d', (k - 1 + 0.5) / 3),
        quadro: (_o, an) => (an.presente ? 1 + (Math.floor(an.t * 3) % 6) : 0),
      },
      {
        nome: 'holoD', n: fixo(7),
        desenhar: (g, Q, k) => holo(g, Q, 2.4, 2.95, 0.1, 18, 36, k > 0, '#3ee0ff', (k - 1 + 0.5) / 3),
        quadro: (_o, an) => (an.presente ? 1 + (Math.floor((an.t + 1.7) * 3) % 6) : 0),
      },
    ],
    // luz âmbar no tampo, na frente do teclado: não lava o rosto de quem senta atrás da mesa
    luzes: () => [{ ii: 1.5, jj: 0.85, z: 13, r: 24, cor: '#ffcf4d', int: 0.25 }, { ii: 2.7, jj: 0.1, z: 26, r: 18, cor: '#3ee0ff', int: 0.5 }],
  },
  mesaNotebook: {
    w: 2, d: 1, h: 34,
    desenho(g, P) {
      for (const [a, b2] of [[0.06, 0.1], [1.8, 0.1], [0.06, 0.78], [1.8, 0.78]] as const) caixa(g, P, a, b2, 0.14, 0.14, 0, 9, '#c9cfdc', { brilho: false });
      caixa(g, P, 0, 0, 2, 1, 9, 2, '#f4f1ec', { topo: '#fbf9f5' });
      caixa(g, P, 0.45, 0.4, 0.8, 0.35, 11, 1, '#c9cfdc', { brilho: false });
      caixa(g, P, 0.45, 0.3, 0.8, 0.1, 12, 10, '#d7dce6', { topo: '#e8ecf3' });
      caixa(g, P, 1.45, 0.55, 0.16, 0.16, 11, 3, '#ff8fb8', { brilho: false });
      caixa(g, P, 1.65, 0.2, 0.22, 0.22, 11, 4, '#e6e1d8', { brilho: false });
      const p = P(1.76, 0.31, 20); folhagem(g, p[0], p[1], 0.6);
      caixa(g, P, 0.1, 0.55, 0.3, 0.3, 11, 1, '#e8c14e', { brilho: false });
    },
    camadas: [
      {
        nome: 'coracao', n: fixo(2),
        desenhar: (g, Q, k) => { const c0 = Q(0.85, 0.4, 17); const cor = k ? '#ff5f8f' : '#ff86a8'; for (const [dx, dy] of [[-1, 0], [1, 0], [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, 1], [0, 1], [1, 1], [0, 2], [0, 0]] as const) pxl(g, c0[0] + dx, c0[1] + dy, cor); },
        quadro: (_o, an) => Math.floor(an.t * 1.2) % 2,
      },
      {
        nome: 'vapor', n: fixo(14),
        desenhar: (g, Q, k) => { const t = meio(k, 1 / 0.7, 14); for (let kk = 0; kk < 2; kk++) { const f = (t * 0.7 + kk * 0.5) % 1; const p = Q(1.53, 0.63, 15 + f * 8); g.globalAlpha = 1 - f; pxl(g, p[0] + Math.sin(t * 3 + kk), p[1], '#ffffff'); g.globalAlpha = 1; } },
        quadro: (_o, an) => ciclo(an.t, 1 / 0.7, 14),
      },
    ],
    luzes: () => [{ ii: 0.85, jj: 0.35, z: 18, r: 22, cor: '#ff8fb8', int: 0.5 }],
  },
  luminaria: {
    w: 1, d: 1, h: 40,
    desenho(g, P) { caixa(g, P, 0.35, 0.35, 0.3, 0.3, 0, 2, '#2a2c3a'); caixa(g, P, 0.46, 0.46, 0.08, 0.08, 2, 28, '#2a2c3a', { brilho: false }); caixa(g, P, 0.25, 0.25, 0.5, 0.5, 30, 7, '#f2d8a8', { topo: '#fff0cc' }); },
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 32, r: 36, cor: '#ffd9a0', int: 0.8 }],
  },
  pod: {
    w: 2, d: 2, h: 50,
    desenho(g, P) {
      caixa(g, P, 0, 0, 2, 2, 0, 3, '#3a3550', { topo: '#4b4568' });
      caixa(g, P, 0.05, 0.05, 1.9, 0.08, 3, 30, '#8a7fb3', { topo: '#b9b0dc', esq: '#6f6696' });
      caixa(g, P, 0.05, 0.13, 0.08, 1.82, 3, 30, '#7a70a3', { topo: '#b9b0dc' });
      for (const [a, b2] of [[0.2, 1.1], [1.65, 1.1], [0.2, 1.7], [1.65, 1.7]] as const) caixa(g, P, a, b2, 0.1, 0.1, 3, 9, '#8c93ab', { brilho: false });
      caixa(g, P, 0.15, 1.05, 1.7, 0.75, 12, 2, '#ece9f5');
      caixa(g, P, 0.7, 1.2, 0.6, 0.12, 14, 8, '#2a2840', { topo: '#3a3858' });
    },
    camadas: [
      { nome: 'tela', n: fixo(2), desenhar: (g, Q, k) => { const tl = Q(1, 1.32, 18); ret(g, tl[0] - 3, tl[1] - 3, 7, 4, k ? '#3ee0ff' : '#1a1830'); }, quadro: (_o, an) => (an.presente ? 1 : 0), emEspera: 0 },
      {
        nome: 'z', n: fixo(8),
        desenhar: (g, Q, k) => { const p = Q(1.6, 0.6, 40 + ((k + 0.5) / 8) * 8); textoPlano(g, 'Z', p[0], p[1], '#b9b0dc'); },
        quadro: (o, an) => (an.presente || Math.floor(an.t + o.i) % 4 !== 0 ? -1 : Math.floor((((an.t % 1) + 1) % 1) * 8) % 8),
        emEspera: 'anima',
      },
      {
        nome: 'placa', n: fixo(2), variante: (o) => s(o, 'nome'),
        desenhar: (g, Q, k, o) => { const nome = s(o, 'nome'); const p = Q(1, 1, 44); const { largura } = pixelsTexto(nome); ret(g, p[0] - largura / 2 - 3, p[1] - 4, largura + 6, 9, '#14122a'); ret(g, p[0] - largura / 2 - 3, p[1] - 4, largura + 6, 1, k ? '#c9a7ff' : '#4b4568'); textoPlano(g, nome, p[0] - largura / 2, p[1] - 2, k ? '#e9dcff' : '#8a7fb3'); },
        quadro: (_o, an) => (an.presente ? 1 : 0),
        emEspera: 0,
      },
    ],
    luzes: () => [{ ii: 1, jj: 1.3, z: 18, r: 20, cor: '#c9a7ff', int: 0.35 }],
  },
  saco: {
    w: 1, d: 1, h: 50,
    varianteBase: (o) => s(o, 'cor'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#b3262f');
      caixa(g, P, 0.1, 0.1, 0.12, 0.12, 0, 46, '#3a3f50'); caixa(g, P, 0.1, 0.1, 0.6, 0.1, 44, 2, '#3a3f50');
      const p = P(0.6, 0.5, 30); ret(g, p[0] - 4, p[1] - 12, 9, 22, cor); ret(g, p[0] + 3, p[1] - 12, 2, 22, tom(cor, -0.25)); ret(g, p[0] - 4, p[1] - 12, 9, 2, tom(cor, 0.2)); ret(g, p[0] - 4, p[1] - 2, 9, 1, '#14161c');
    },
  },
  bebedouro: {
    w: 1, d: 1, h: 30,
    desenho(g, P) { caixa(g, P, 0.25, 0.25, 0.5, 0.5, 0, 14, '#e6e9f2'); const p = P(0.5, 0.5, 22); elipse(g, p[0], p[1], 4, 5, '#7cc6ff'); pxl(g, p[0] - 1, p[1] - 2, '#d6f3ff'); },
  },
  impressora: {
    w: 1, d: 1, h: 16,
    desenho(g, P) { caixa(g, P, 0.15, 0.2, 0.7, 0.6, 0, 10, '#d6dbe6'); caixa(g, P, 0.25, 0.3, 0.5, 0.2, 10, 2, '#f8f8f8', { brilho: false }); },
  },
  quadro: {
    w: 2, d: 1, h: 38,
    varianteBase: (o) => s(o, 'estilo'),
    desenho(g, P, o) {
      caixa(g, P, 0.15, 0.45, 0.08, 0.08, 0, 10, '#596179'); caixa(g, P, 1.77, 0.45, 0.08, 0.08, 0, 10, '#596179');
      caixa(g, P, 0.05, 0.4, 1.9, 0.1, 10, 24, '#e9edf5', { topo: '#c9cfdc' });
      const F = (u0: number, u1: number, v0: number, v1: number, cor: string) => faceE(g, P, 0.05, 0.4, 1.9, 0.1, 10, u0, u1, v0, v1, cor);
      const estilo = s(o, 'estilo');
      if (estilo === 'kanban') {
        const cores = ['#ffd35c', '#9fe3ff', '#ffb3c7', '#b8f5c8'];
        for (let col = 0; col < 3; col++) { F(0.15 + col * 0.58, 0.17 + col * 0.58, 3, 21, '#c9cfdc'); for (let r = 0; r < 3 - (col === 2 ? 1 : 0); r++) F(0.22 + col * 0.58, 0.6 + col * 0.58, 15 - r * 5, 19 - r * 5, cores[(col + r) % 4]); }
      } else if (estilo === 'mural') {
        F(0.15, 0.9, 8, 20, '#2f80ed'); F(1.0, 1.75, 12, 20, '#ff6b5a'); F(1.0, 1.75, 5, 10, '#f2c94c'); F(0.15, 0.9, 3, 6, '#27ae60');
      } else {
        F(0.15, 0.8, 14, 21, '#4f8cff'); F(0.2, 0.75, 15, 20, '#e9edf5');
        F(1.0, 1.7, 17, 21, '#ff6b5a'); F(1.0, 1.5, 12, 13, '#4a5168');
        F(0.15, 1.6, 6, 7, '#4a5168'); F(0.15, 1.2, 3, 4, '#4a5168');
      }
    },
  },
  geladeira: {
    w: 1, d: 1, h: 26,
    desenho(g, P) { caixa(g, P, 0.15, 0.2, 0.7, 0.65, 0, 22, '#2b2f40', { topo: '#3a3f55' }); faceE(g, P, 0.15, 0.2, 0.7, 0.65, 0, 0.08, 0.6, 3, 19, '#16213a'); for (let k = 0; k < 3; k++) faceE(g, P, 0.15, 0.2, 0.7, 0.65, 0, 0.12 + k * 0.16, 0.2 + k * 0.16, 5, 11, ['#52ffa8', '#ff4fd8', '#3ee0ff'][k]); },
    luzes: () => [{ ii: 0.4, jj: 0.85, z: 12, r: 16, cor: '#52ffa8', int: 0.45 }],
  },
  haltereChao: {
    w: 1, d: 1, h: 6, bloqueia: false,
    desenho(g, P) { for (const bb of [0.35, 0.65]) { caixa(g, P, 0.25, bb, 0.5, 0.06, 1, 1, '#9aa3b8', { brilho: false }); caixa(g, P, 0.2, bb - 0.06, 0.1, 0.18, 0, 4, '#1b1d24'); caixa(g, P, 0.7, bb - 0.06, 0.1, 0.18, 0, 4, '#1b1d24'); } },
  },
  vitrine: {
    w: 2, d: 2, h: 40,
    desenho(g, P) { caixa(g, P, 0.2, 0.2, 1.6, 1.6, 0, 6, '#2a2e44', { topo: '#3a4160' }); const p = P(1, 1, 6); elipse(g, p[0], p[1], 18, 8, '#1f3350'); anel(g, p[0], p[1], 18, 8, '#3ee0ff', 120); },
    camadas: [{
      nome: 'holo', n: fixo(16), variante: (o) => s(o, 'forma', 'carro'),
      desenhar: (g, Q, k, o) => { const bob = (k % 4) - 1, esp = Math.floor(k / 4) % 2 ? -1 : 1, pisca = k >= 8; carro(g, Q, bob, esp, pisca, s(o, 'forma', 'carro')); },
      quadro: (_o, an) => { const bob = Math.max(-1, Math.min(2, Math.round(Math.sin(an.t * 1.5) * 1.5))); const esp = Math.cos(an.t * 0.8) >= 0 ? 0 : 1; const pisca = Math.floor(an.t * 10) % 7 === 0 ? 1 : 0; return (bob + 1) + esp * 4 + pisca * 8; },
    }],
    luzes: () => [{ ii: 1, jj: 1, z: 18, r: 34, cor: '#3ee0ff', int: 0.6 }],
  },
  mural: {
    w: 4, d: 1, h: 52, bloqueia: false,
    varianteBase: () => '',
    desenho() { /* só camadas */ },
    camadas: [
      { nome: 'holo', n: fixo(6), variante: (o) => s(o, 'cor', '#ff6b5a'), desenhar: (g, Q, k, o) => holo(g, Q, 0.1, 3.9, 0.5, 26, 48, true, s(o, 'cor', '#ff6b5a'), (k + 0.5) / 3), quadro: (_o, an) => Math.floor(an.t * 3) % 6 },
      {
        nome: 'colunas', n: fixo(3), variante: (o) => ((o.props.colunas as string[] | undefined) ?? []).join(','),
        desenhar: (g, Q, k, o) => colunasQuadro(g, Q, k, 0.4, 0.72, 0.5, 47, 6, 2, (o.props.colunas as string[] | undefined) ?? ['G0', 'G1', 'G2', 'G3', 'G4']),
        quadro: (_o, an) => Math.floor(an.t / 4) % 3,
      },
    ],
    luzes: (o) => [{ ii: 2, jj: 0.5, z: 38, r: 40, cor: s(o, 'cor', '#ff6b5a'), int: 0.4 }],
  },

  /* ----- tipos novos: noite quente e andar cheio ----- */
  lampiao: {
    w: 1, d: 1, h: 52, bloqueia: false,
    desenho(g, P) {
      caixa(g, P, 0.38, 0.38, 0.24, 0.24, 0, 3, '#2a2420');
      caixa(g, P, 0.46, 0.46, 0.08, 0.08, 3, 34, '#3a3028', { brilho: false });
      caixa(g, P, 0.3, 0.3, 0.4, 0.4, 37, 2, '#4a3a2e');
      caixa(g, P, 0.34, 0.34, 0.32, 0.32, 39, 7, '#ffcf7a', { topo: '#fff0c4', dir: '#e8a84a' });
      caixa(g, P, 0.28, 0.28, 0.44, 0.44, 46, 2, '#4a3a2e');
    },
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 42, r: 44, cor: '#ffc46a', int: 0.85 }],
  },
  painelEnergia: {
    w: 1, d: 1, h: 36,
    desenho(g, P) { caixa(g, P, 0.15, 0.55, 0.7, 0.3, 0, 34, '#4a5068', { topo: '#6a7090' }); faceE(g, P, 0.15, 0.55, 0.7, 0.3, 0, 0.1, 0.6, 4, 30, '#2a2e40'); faceE(g, P, 0.15, 0.55, 0.7, 0.3, 0, 0.12, 0.3, 26, 29, '#ffcf4d'); },
    camadas: [{ nome: 'leds', n: fixo(4), desenhar: (g, Q, k) => { for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { if ((r + c + k) % 3 === 0) continue; const p = Q(0.3 + c * 0.16, 0.85, 8 + r * 5); pxl(g, p[0], p[1], (r + k) % 4 === 0 ? '#ff6b5a' : '#52ffa8'); } }, quadro: (_o, an) => Math.floor(an.t * 2) % 4 }],
    luzes: () => [{ ii: 0.5, jj: 0.85, z: 18, r: 16, cor: '#52ffa8', int: 0.35 }],
  },
  caixas: {
    w: 1, d: 1, h: 26,
    desenho(g, P) { caixa(g, P, 0.1, 0.1, 0.8, 0.8, 0, 10, '#a8835a'); caixa(g, P, 0.18, 0.2, 0.62, 0.62, 10, 8, '#c49a68'); caixa(g, P, 0.3, 0.3, 0.42, 0.42, 18, 6, '#8a6a48'); const p = P(0.5, 0.9, 6); ret(g, p[0] - 2, p[1] - 1, 5, 1, '#5a4430'); },
  },
  cafeteira: {
    w: 1, d: 1, h: 26,
    desenho(g, P) { caixa(g, P, 0.15, 0.2, 0.7, 0.6, 0, 12, '#3a3f55', { topo: '#c9cfdc' }); caixa(g, P, 0.25, 0.3, 0.45, 0.4, 12, 9, '#1d2030', { topo: '#3a3f55' }); faceE(g, P, 0.25, 0.3, 0.45, 0.4, 12, 0.1, 0.3, 2, 5, '#ff6b5a'); caixa(g, P, 0.55, 0.5, 0.14, 0.14, 12, 3, '#f4f1ea', { brilho: false }); },
    camadas: [{ nome: 'vapor', n: fixo(8), desenhar: (g, Q, k) => { const t = meio(k, 1.2, 8); for (let kk = 0; kk < 2; kk++) { const f = (t / 1.2 + kk * 0.5) % 1; const p = Q(0.6, 0.55, 17 + f * 9); g.globalAlpha = 1 - f; pxl(g, p[0] + Math.sin(t * 4 + kk), p[1], '#e8f0ff'); g.globalAlpha = 1; } }, quadro: (_o, an) => ciclo(an.t, 1.2, 8) }],
    luzes: () => [{ ii: 0.5, jj: 0.6, z: 12, r: 14, cor: '#ff8f6a', int: 0.4 }],
  },
  caixaSom: {
    w: 1, d: 1, h: 24,
    desenho(g, P) { caixa(g, P, 0.25, 0.3, 0.5, 0.45, 0, 22, '#1d1f28', { topo: '#2c2f3c' }); for (const v of [5, 14]) { const p = P(0.5, 0.75, v); elipse(g, p[0], p[1], 2, 2, '#3a3d4c'); pxl(g, p[0], p[1], '#5a5f74'); } },
  },
  arquivo: {
    w: 1, d: 1, h: 28,
    desenho(g, P) { caixa(g, P, 0.15, 0.2, 0.7, 0.6, 0, 26, '#7a8299', { topo: '#a3aac0' }); for (const v of [5, 13, 21]) { faceE(g, P, 0.15, 0.2, 0.7, 0.6, 0, 0.06, 0.64, v - 1, v, '#5a6178'); faceE(g, P, 0.15, 0.2, 0.7, 0.6, 0, 0.28, 0.42, v + 2, v + 3, '#d6dbe6'); } },
  },
  holoPainel: {
    w: 1, d: 1, h: 40,
    desenho(g, P) { caixa(g, P, 0.3, 0.3, 0.4, 0.4, 0, 4, '#3a4160', { topo: '#59648f' }); caixa(g, P, 0.46, 0.46, 0.08, 0.08, 4, 10, '#59648f', { brilho: false }); },
    camadas: [{ nome: 'holo', n: fixo(6), desenhar: (g, Q, k) => holo(g, Q, 0.0, 1.0, 0.5, 16, 36, true, '#c9b8ff', (k + 0.5) / 3), quadro: (o, an) => Math.floor((an.t + o.j) * 3) % 6 }],
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 26, r: 18, cor: '#9fb3ff', int: 0.45 }],
  },
  kettlebells: {
    w: 1, d: 1, h: 10, bloqueia: false,
    desenho(g, P) { caixa(g, P, 0.1, 0.2, 0.8, 0.6, 0, 2, '#2a2f3a'); for (const [u, cor] of [[0.25, '#1b1d24'], [0.5, '#a8323e'], [0.75, '#2f6fb0']] as const) { const p = P(u, 0.5, 4); elipse(g, p[0], p[1], 2, 2, cor); anel(g, p[0], p[1] - 3, 1, 1, '#4a5266', 8); } },
  },
  bike: {
    w: 1, d: 1, h: 24, bloqueia: false,
    desenho(g, P) {
      caixa(g, P, 0.2, 0.3, 0.6, 0.4, 0, 2, '#2c303c');
      const a = P(0.3, 0.5, 2), c2 = P(0.7, 0.5, 2), sel = P(0.4, 0.5, 16), gui = P(0.75, 0.45, 20);
      linha(g, a[0], a[1], sel[0], sel[1], '#596179'); linha(g, c2[0], c2[1], gui[0], gui[1], '#596179'); linha(g, sel[0], sel[1], gui[0], gui[1] + 3, '#596179');
      ret(g, sel[0] - 2, sel[1] - 1, 4, 2, '#1d1f28'); ret(g, gui[0] - 2, gui[1], 4, 1, '#c5cad6');
      const r = P(0.65, 0.5, 6); anel(g, r[0], r[1], 4, 4, '#3a3f50', 24); pxl(g, r[0], r[1], '#ff7ab8');
    },
  },
  sacoPancada: {
    w: 1, d: 1, h: 50,
    desenho(g, P) {
      caixa(g, P, 0.1, 0.1, 0.12, 0.12, 0, 46, '#3a3f50'); caixa(g, P, 0.1, 0.1, 0.6, 0.1, 44, 2, '#3a3f50');
      const p = P(0.6, 0.5, 30); ret(g, p[0] - 4, p[1] - 12, 9, 22, '#2f5fa8'); ret(g, p[0] + 3, p[1] - 12, 2, 22, '#22467e'); ret(g, p[0] - 4, p[1] - 12, 9, 2, '#4a7cc8'); ret(g, p[0] - 4, p[1] - 2, 9, 1, '#14161c');
    },
  },
  colchonete: {
    w: 2, d: 1, h: 2, bloqueia: false, plano: true,
    desenho(g, P) { caixa(g, P, 0.1, 0.15, 1.8, 0.7, 0, 1, '#2f6f73', { topo: '#3a8e8f' }); const a = P(0.1, 0.5, 1), c2 = P(1.9, 0.5, 1); linha(g, a[0], a[1], c2[0], c2[1], '#2b6266'); },
  },
  placaNeon: {
    w: 1, d: 1, h: 46,
    varianteBase: (o) => s(o, 'texto') + s(o, 'cor'),
    desenho(g, P) { caixa(g, P, 0.42, 0.42, 0.16, 0.16, 0, 22, '#2a2c3a', { brilho: false }); caixa(g, P, 0.38, 0.38, 0.24, 0.24, 0, 2, '#2a2c3a'); },
    camadas: [{
      nome: 'neon', n: fixo(2), variante: (o) => s(o, 'texto') + s(o, 'cor'),
      desenhar: (g, Q, k, o) => {
        const texto = s(o, 'texto', 'ARCADIA'), cor = s(o, 'cor', '#ff4fd8');
        const { largura } = pixelsTexto(texto); const p = Q(0.5, 0.5, 34);
        ret(g, p[0] - largura / 2 - 3, p[1] - 4, largura + 6, 11, '#0c0e1f'); ret(g, p[0] - largura / 2 - 3, p[1] - 4, largura + 6, 1, cor); ret(g, p[0] - largura / 2 - 3, p[1] + 6, largura + 6, 1, cor);
        textoPlano(g, texto, p[0] - largura / 2, p[1] - 1, k ? tom(cor, -0.5) : cor);
      },
      quadro: (o, an) => (Math.sin(an.t * 13 + o.i * 7) > 0.97 ? 1 : 0),
      emEspera: 1,
    }],
    luzes: (o) => [{ ii: 0.5, jj: 0.5, z: 34, r: 30, cor: s(o, 'cor', '#ff4fd8'), int: 0.55 }],
  },
  pinball: {
    w: 1, d: 1, h: 32,
    desenho(g, P) {
      for (const [a, b2] of [[0.2, 0.2], [0.7, 0.2], [0.2, 0.75], [0.7, 0.75]] as const) caixa(g, P, a, b2, 0.08, 0.08, 0, 12, '#2a2c3a', { brilho: false });
      caixa(g, P, 0.15, 0.15, 0.7, 0.75, 12, 5, '#7a2a8a', { topo: '#1a1430' });
      caixa(g, P, 0.15, 0.1, 0.7, 0.12, 12, 18, '#5a1f6a', { topo: '#7a2a8a' });
    },
    camadas: [{ nome: 'luzes', n: fixo(8), desenhar: (g, Q, k) => { for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { if ((r * 3 + c + k) % 4 === 0) continue; const p = Q(0.28 + c * 0.2, 0.3 + r * 0.18, 17); pxl(g, p[0], p[1], ['#ffcf4d', '#ff4fd8', '#3ee0ff'][(r + c + k) % 3]); } const pf = Q(0.5, 0.1, 26); ret(g, pf[0] - 3, pf[1], 6, 2, k % 2 ? '#ff4fd8' : '#ffcf4d'); }, quadro: (_o, an) => Math.floor(an.t * 5) % 8 }],
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 22, r: 18, cor: '#ff4fd8', int: 0.5 }],
  },
  tvGame: {
    w: 1, d: 1, h: 34,
    desenho(g, P) { caixa(g, P, 0.15, 0.2, 0.7, 0.55, 0, 10, '#2a2c3a', { topo: '#3a3d52' }); caixa(g, P, 0.05, 0.4, 0.9, 0.12, 10, 20, '#14161f', { topo: '#2a2c3a' }); caixa(g, P, 0.3, 0.3, 0.3, 0.2, 10, 2, '#e9ecf3', { brilho: false }); },
    camadas: [{
      nome: 'tela', n: fixo(8),
      desenhar: (g, Q, k) => {
        const F = (u0: number, u1: number, v0: number, v1: number, cor: string) => poli(g, [Q(0.05 + u0, 0.52, 10 + v1), Q(0.05 + u1, 0.52, 10 + v1), Q(0.05 + u1, 0.52, 10 + v0), Q(0.05 + u0, 0.52, 10 + v0)], cor);
        F(0.06, 0.84, 2, 18, '#1f3a6a'); F(0.06, 0.84, 2, 6, '#2f7a45');
        F(0.2 + (k % 4) * 0.12, 0.3 + (k % 4) * 0.12, 6, 10, '#ffcf4d'); F(0.6 - (k % 3) * 0.1, 0.68 - (k % 3) * 0.1, 6, 9, '#ff6b5a');
      },
      quadro: (_o, an) => Math.floor(an.t * 4) % 8,
    }],
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 20, r: 22, cor: '#4f8cff', int: 0.5 }],
  },
  totem: {
    w: 1, d: 1, h: 38,
    desenho(g, P) { caixa(g, P, 0.3, 0.35, 0.4, 0.3, 0, 34, '#e6e9f2', { topo: '#f5f7fb' }); faceE(g, P, 0.3, 0.35, 0.4, 0.3, 0, 0.05, 0.35, 14, 30, '#1d2030'); },
    camadas: [{ nome: 'tela', n: fixo(6), desenhar: (g, Q, k) => { for (let r = 0; r < 4; r++) { const a = Q(0.38, 0.65, 27 - r * 3), c2 = Q(0.38 + 0.08 + ((r + k) % 3) * 0.06, 0.65, 27 - r * 3); linha(g, a[0], a[1], c2[0], c2[1], r === 0 ? '#ffe08a' : '#9fe3ff'); } }, quadro: (_o, an) => Math.floor(an.t * 1.5) % 6 }],
    luzes: () => [{ ii: 0.5, jj: 0.65, z: 22, r: 16, cor: '#ffe08a', int: 0.4 }],
  },
  banco: {
    w: 2, d: 1, h: 12,
    desenho(g, P) { for (const a of [0.15, 1.75]) caixa(g, P, a, 0.3, 0.1, 0.4, 0, 6, '#3a3f50', { brilho: false }); caixa(g, P, 0.05, 0.25, 1.9, 0.5, 6, 2, '#a8744a', { topo: '#c79c6e' }); },
  },
  impressora3d: {
    w: 1, d: 1, h: 28,
    desenho(g, P) { caixa(g, P, 0.15, 0.15, 0.7, 0.7, 0, 3, '#2a2c3a'); for (const [a, b2] of [[0.15, 0.15], [0.78, 0.15], [0.15, 0.78], [0.78, 0.78]] as const) caixa(g, P, a, b2, 0.07, 0.07, 3, 20, '#596179', { brilho: false }); caixa(g, P, 0.15, 0.15, 0.7, 0.7, 23, 2, '#3a3f50', { brilho: false }); },
    camadas: [{ nome: 'bico', n: fixo(8), desenhar: (g, Q, k) => { const u = 0.3 + (k % 4) * 0.12, h = 4 + Math.floor(k / 2); caixa(g, Q, 0.35, 0.35, 0.3, 0.3, 3, Math.min(h, 9), '#ff7ab8', { brilho: false }); const p = Q(u, 0.5, 18); ret(g, p[0] - 1, p[1] - 2, 3, 3, '#c5cad6'); pxl(g, p[0], p[1] + 1, '#ffcf4d'); }, quadro: (_o, an) => Math.floor(an.t * 3) % 8, emEspera: 0 }],
  },
  cadeiraGamer: {
    w: 1, d: 1, h: 32, bloqueia: false,
    desenho(g, P) {
      caixa(g, P, 0.42, 0.42, 0.16, 0.16, 0, 5, '#262a3c', { brilho: false });
      caixa(g, P, 0.2, 0.25, 0.6, 0.55, 5, 3, '#1d1f28');
      caixa(g, P, 0.2, 0.14, 0.6, 0.12, 8, 21, '#1d1f28');
      caixa(g, P, 0.25, 0.13, 0.12, 0.13, 10, 18, '#ff4fd8', { brilho: false }); caixa(g, P, 0.63, 0.13, 0.12, 0.13, 10, 18, '#ff4fd8', { brilho: false });
    },
  },
  posterJogo: {
    w: 1, d: 1, h: 44,
    varianteBase: (o) => s(o, 'cor'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#ff6b5a');
      caixa(g, P, 0.42, 0.42, 0.16, 0.16, 0, 14, '#2a2c3a', { brilho: false });
      caixa(g, P, 0.1, 0.45, 0.8, 0.1, 14, 26, '#14161f', { topo: '#2a2c3a' });
      const F = (u0: number, u1: number, v0: number, v1: number, c: string) => faceE(g, P, 0.1, 0.45, 0.8, 0.1, 14, u0, u1, v0, v1, c);
      F(0.06, 0.74, 2, 24, tom(cor, -0.55)); F(0.06, 0.74, 2, 8, tom(cor, -0.3));
      // arte genérica: uma nave e duas estrelas (sem marca nenhuma)
      F(0.32, 0.48, 10, 18, cor); F(0.24, 0.56, 12, 14, tom(cor, 0.25)); F(0.36, 0.44, 18, 20, '#ffcf4d');
      F(0.12, 0.16, 20, 21, '#ffffff'); F(0.62, 0.66, 16, 17, '#ffffff');
    },
  },
  mesaHolo: {
    w: 3, d: 3, h: 40,
    desenho(g, P) {
      caixa(g, P, 0.8, 0.8, 1.4, 1.4, 0, 12, '#2a2e44', { topo: '#3a4160' });
      caixa(g, P, 0.3, 0.3, 2.4, 2.4, 12, 3, '#3a4160', { topo: '#1a2440' });
      const c = P(1.5, 1.5, 15); anel(g, c[0], c[1], 30, 14, '#3ee0ff', 140);
    },
    camadas: [{
      nome: 'mini', n: fixo(12),
      desenhar: (g, Q, k) => {
        // um andar em miniatura girando devagar: o Arcadia dentro do Arcadia
        const c = Q(1.5, 1.5, 22);
        g.globalAlpha = 0.35; poli(g, [[c[0] - 22, c[1]], [c[0], c[1] - 11], [c[0] + 22, c[1]], [c[0], c[1] + 11]], '#3ee0ff'); g.globalAlpha = 1;
        const cores = ['#ff6b5a', '#4f8cff', '#ffb347', '#3fd28b', '#c9a7ff', '#f2b45a'];
        for (let q = 0; q < 6; q++) { const a = (q / 6) * Math.PI * 2 + (k / 12) * Math.PI * 2; const x = c[0] + Math.cos(a) * 12, y = c[1] + Math.sin(a) * 6; ret(g, x - 2, y - 3, 4, 3, cores[q]); }
        pxl(g, c[0], c[1] - 6, '#ffffff'); ret(g, c[0] - 1, c[1] - 4, 3, 4, '#3ee0ff');
      },
      quadro: (_o, an) => ciclo(an.t, 6, 12),
    }],
    luzes: () => [{ ii: 1.5, jj: 1.5, z: 24, r: 40, cor: '#3ee0ff', int: 0.6 }],
  },

  /* ----- cápsula de recarga: o bot parado espera aqui, na própria ala ----- */
  recarga: {
    w: 1, d: 1, h: 60,
    varianteBase: (o) => s(o, 'cor'),
    desenho(g, P, o) {
      const cor = s(o, 'cor', '#3ee0ff');
      // base com anel de indução
      caixa(g, P, 0.04, 0.04, 0.92, 0.92, 0, 3, '#262c44', { topo: '#343c5e' });
      const c = P(0.5, 0.5, 3); elipse(g, c[0], c[1], 9, 4, '#1a2036'); anel(g, c[0], c[1], 12, 6, '#2ab3d9', 80);
      // painéis de vidro escuro no fundo (ficam atrás do bot)
      caixa(g, P, 0.14, 0.02, 0.72, 0.1, 3, 50, '#1f2640', { topo: '#3a4466', dir: '#171c30' });
      caixa(g, P, 0.02, 0.14, 0.1, 0.72, 3, 50, '#1b2138', { topo: '#3a4466' });
      for (const v of [14, 26, 38]) { faceE(g, P, 0.14, 0.02, 0.72, 0.1, 3, 0.05, 0.67, v, v + 1, '#2c3658'); faceD(g, P, 0.02, 0.14, 0.1, 0.72, 3, 0.05, 0.67, v, v + 1, '#28304e'); }
      // colunas nas quinas dos lados
      caixa(g, P, 0.84, 0.0, 0.14, 0.14, 3, 50, '#4a5478', { topo: '#6a76a0' });
      caixa(g, P, 0.0, 0.84, 0.14, 0.14, 3, 50, '#4a5478', { topo: '#6a76a0' });
      // tampa (separada da vizinha) com friso na cor do bot e o anel de luz por baixo
      caixa(g, P, 0.05, 0.05, 0.9, 0.9, 53, 4, '#3a4262', { topo: '#55608a' });
      const a = P(0.05, 0.95, 53), b2 = P(0.95, 0.95, 53), d2 = P(0.95, 0.05, 53);
      linha(g, a[0], a[1], b2[0], b2[1], cor); linha(g, b2[0], b2[1], d2[0], d2[1], tom(cor, -0.25));
      const lc = P(0.5, 0.5, 52); anel(g, lc[0], lc[1], 9, 4, '#2a8fb0', 40, 0, Math.PI);
    },
    camadas: [{
      // barras de carga nas duas colunas: de 0 a 7 enche devagar com o bot dentro; 8 é a cápsula vazia
      nome: 'carga', n: fixo(9),
      desenhar: (g, Q, k) => {
        const nivel = k < 8 ? Math.floor(((k + 1) * 6) / 8) : 0;
        for (let sg = 0; sg < 6; sg++) {
          let cor: string | null = null;
          if (k === 8) cor = sg === 5 ? '#2f6f86' : null;
          else if (sg < nivel) cor = '#52ffa8';
          else if (sg === nivel) cor = '#1f6a4a';
          if (!cor) continue;
          const z0 = 10 + sg * 6;
          faceE(g, Q, 0.84, 0.0, 0.14, 0.14, z0, 0.02, 0.12, 0, 3, cor);
          faceD(g, Q, 0.0, 0.84, 0.14, 0.14, z0, 0.02, 0.12, 0, 3, cor);
        }
      },
      quadro: (_o, an) => (an.presente ? ciclo(an.t, 6, 8) : 8),
      emEspera: 'anima',
    }],
    luzes: () => [{ ii: 0.5, jj: 0.5, z: 30, r: 22, cor: '#52ffa8', int: 0.3 }],
  },
};

/** Tipos com textura "viva" (posição muda a cada quadro): peixes do aquário e feixe do teletransporte. */
export const VIVOS = new Set(['aquario', 'teleporte']);

export function tipoDe(nome: string): TipoObjeto {
  return TIPOS[nome] ?? TIPOS.caixas;
}
