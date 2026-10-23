// Mobília vista de frente, para o corte lateral do celular (estilo Tiny Tower).
// Cada tipo tem largura e altura em pixels, um desenho estático e, quando anima, camadas com
// quadros enumeráveis (assados na carga como no isométrico). A âncora é o meio da base.
import { tom } from './cor.ts';
import { CORES_ESTADO, ESTADOS_HOLO } from './estados.ts';
import { elipse, estilo, linha, pixelsTexto, pxl, ret, textoPlano, type G } from './primitivas.ts';
import type { CtxObjeto, InfoAnim } from './objetos.ts';

/** Camada animada de frente; `emEspera` funciona como no isométrico (objetos.ts). */
export interface CamadaFrente { nome: string; n: (o: CtxObjeto) => number; variante?: (o: CtxObjeto) => string; desenhar: (g: G, k: number, o: CtxObjeto, w: number, h: number) => void; quadro: (o: CtxObjeto, a: InfoAnim) => number; emEspera?: number | 'anima' }
/** `fundo`: fica atrás de quem está no mesmo ladrilho (cápsula de recarga). */
export interface Frente { w: number; h: number; desenho: (g: G, o: CtxObjeto, w: number, h: number) => void; varianteBase?: (o: CtxObjeto) => string; camadas?: CamadaFrente[]; luzes?: (o: CtxObjeto, w: number, h: number) => { x: number; y: number; r: number; cor: string; int: number }[]; fundo?: boolean }

const s = (o: CtxObjeto, k: string, p = ''): string => { const v = o.props[k]; return typeof v === 'string' ? v : p; };
const fixo = (k: number) => () => k;

/** Caixa de frente com topo claro, lado escuro e contorno embaixo. */
function bloco(g: G, x: number, y: number, w: number, h: number, cor: string, topo = true): void {
  ret(g, x, y, w, h, cor);
  if (topo) ret(g, x, y, w, 1, tom(cor, 0.25));
  ret(g, x + w - 1, y + 1, 1, h - 1, tom(cor, -0.25));
  ret(g, x, y + h - 1, w, 1, tom(cor, -0.35));
}
function pernas(g: G, x0: number, x1: number, y: number, h: number, cor = '#545b76'): void { ret(g, x0, y, 2, h, cor); ret(g, x1 - 2, y, 2, h, cor); }
function holoFrente(g: G, x: number, y: number, w: number, h: number, cor: string, k: number, ativo: boolean): void {
  g.globalAlpha = ativo ? 0.35 : 0.15; ret(g, x, y, w, h, ativo ? '#3ee0ff' : '#5a6a90'); g.globalAlpha = 1;
  ret(g, x, y, w, 1, ativo ? '#bff8ff' : '#6d7ba3'); ret(g, x, y + h - 1, w, 1, ativo ? '#bff8ff' : '#6d7ba3');
  if (!ativo) return;
  for (let r = 0; r < Math.floor((h - 3) / 2); r++) { const len = 3 + ((r * 5 + k) % Math.max(2, w - 5)); ret(g, x + 2, y + 2 + r * 2, Math.min(w - 4, len), 1, r % 2 ? cor : '#e8fdff'); }
}
function camadaHoloMesa(x: number, y: number, w: number, h: number): CamadaFrente {
  return {
    nome: 'holo', n: fixo(1 + ESTADOS_HOLO.length * 3),
    desenhar: (g, k, _o, W) => { const cx = Math.round(W / 2 + x); if (k === 0) { holoFrente(g, cx, y, w, h, '#fff', 0, false); return; } const e = Math.floor((k - 1) / 3); holoFrente(g, cx, y, w, h, CORES_ESTADO[ESTADOS_HOLO[e]], (k - 1) % 3, true); },
    quadro: (_o, a) => { if (!a.ativo) return 0; const e = ESTADOS_HOLO.indexOf(a.ativo); return e < 0 ? 0 : 1 + e * 3 + (Math.floor(a.t * 3) % 3); },
  };
}

export const FRENTE: Record<string, Frente> = {
  mesa: {
    w: 32, h: 30, varianteBase: (o) => s(o, 'cor') + s(o, 'neon') + s(o, 'caneca'),
    desenho(g, o, w, h) {
      pernas(g, 2, w - 2, h - 12, 12);
      bloco(g, 0, h - 14, w, 3, s(o, 'cor', '#e7eaf2'));
      ret(g, 0, h - 11, w, 1, s(o, 'neon', '#3ee0ff'));
      ret(g, 6, h - 16, 10, 2, '#242838');
      ret(g, 18, h - 22, 8, 7, '#1d2030'); ret(g, 19, h - 21, 6, 5, '#2a3150'); ret(g, 21, h - 15, 2, 1, '#545b76');
      const c = s(o, 'caneca'); if (c) ret(g, 3, h - 17, 2, 3, c);
    },
    camadas: [camadaHoloMesa(-1, 0, 14, 12)],
    luzes: (_o, w, h) => [{ x: w / 2 + 6, y: h - 26, r: 16, cor: '#3ee0ff', int: 0.5 }],
  },
  cadeira: { w: 12, h: 18, varianteBase: (o) => s(o, 'cor'), desenho(g, o, w, h) { const c = s(o, 'cor', '#3a3f5c'); bloco(g, 1, 0, w - 2, 10, c); ret(g, 3, 2, w - 6, 2, s(o, 'detalhe', tom(c, 0.35))); bloco(g, 0, 10, w, 3, tom(c, -0.1)); ret(g, w / 2 - 1, 13, 2, 3, '#262a3c'); ret(g, 2, h - 2, w - 4, 2, '#262a3c'); } },
  console: {
    w: 34, h: 50,
    desenho(g, _o, w, h) { bloco(g, 11, h - 12, 12, 12, '#3b3f58'); bloco(g, 2, h - 16, w - 4, 4, '#2a2e44'); ret(g, 2, h - 13, w - 4, 1, '#8a5cff'); },
    camadas: [{ nome: 'holo', n: fixo((ESTADOS_HOLO.length + 1) * 3), desenhar: (g, k, _o, w, h) => { const e = Math.floor(k / 3); holoFrente(g, 3, h - 48, w - 6, 30, e === 0 ? '#8a5cff' : CORES_ESTADO[ESTADOS_HOLO[e - 1]], k % 3, true); }, quadro: (_o, a) => { const e = a.ativo ? ESTADOS_HOLO.indexOf(a.ativo) + 1 : 0; return Math.max(0, e) * 3 + (Math.floor(a.t * 3) % 3); } }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 34, r: 24, cor: '#8a5cff', int: 0.6 }],
  },
  rack: {
    w: 14, h: 40,
    desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#232838'); for (let y = 3; y < h - 3; y += 4) ret(g, 1, y, w - 2, 1, '#161a28'); },
    camadas: [{ nome: 'leds', n: fixo(8), desenhar: (g, k) => { const erro = k >= 4; for (let y = 5; y < 36; y += 4) for (let c = 0; c < 3; c++) if ((y + c * 3 + k * 5) % 7 > 2) pxl(g, 3 + c * 3, y, erro ? '#ff5050' : c === 2 ? '#3ee0ff' : '#52ffa8'); }, quadro: (o, a) => (Math.floor(a.faseRack + o.i) % 4) + (a.erro ? 4 : 0) }],
    luzes: (o, w) => ((o.i + o.j) % 3 === 0 ? [{ x: w / 2, y: 18, r: 18, cor: '#2ad8ff', int: 0.35 }] : []),
  },
  resfriador: {
    w: 30, h: 28, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#5b6380'); for (const cx of [8, 22]) { elipse(g, cx, 14, 5, 5, '#2e3348'); } },
    camadas: [{ nome: 'helice', n: fixo(4), desenhar: (g, k) => { for (const cx of [8, 22]) { const a = (k / 4) * Math.PI; for (let r = 1; r < 5; r++) { pxl(g, cx + Math.cos(a) * r, 14 + Math.sin(a) * r, '#9fb3d9'); pxl(g, cx - Math.cos(a) * r, 14 - Math.sin(a) * r, '#9fb3d9'); } } }, quadro: (_o, a) => Math.floor(a.t * 18) % 4, emEspera: 0 }],
  },
  planta: { w: 14, h: 24, varianteBase: (o) => s(o, 'vaso'), desenho(g, o, w, h) { bloco(g, 3, h - 8, w - 6, 8, s(o, 'vaso', '#e3e6ee')); elipse(g, 7, h - 13, 6, 5, '#2f7a45'); elipse(g, 5, h - 15, 3, 3, '#3f9656'); elipse(g, 9, h - 16, 3, 3, '#56b06a'); pxl(g, 7, h - 19, '#7fd08a'); } },
  estante: {
    w: 30, h: 34, varianteBase: (o) => s(o, 'cor') + String(o.props.trofeus === true) + o.i + ',' + o.j,
    desenho(g, o, w, h) {
      const base = s(o, 'cor', '#6b4a32'); bloco(g, 0, 0, w, h, base);
      const tro = o.props.trofeus === true; let sd = o.i * 7 + o.j * 13 + 3;
      const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      for (const y of [3, 13, 23]) { ret(g, 1, y + 8, w - 2, 1, tom(base, -0.35)); let x = 2; while (x < w - 4) { const bw = tro ? 3 : 2 + Math.floor(r() * 2); const bh = 5 + Math.floor(r() * 3); ret(g, x, y + 8 - bh, bw, bh, tro ? (r() < 0.5 ? '#e8c14e' : '#c0c7d6') : ['#c0392b', '#2f80ed', '#f2c94c', '#27ae60', '#9b51e0', '#ebe6dc'][Math.floor(r() * 6)]); x += bw + (tro ? 3 : 1); } }
    },
  },
  sofa: { w: 42, h: 18, varianteBase: (o) => s(o, 'cor') + s(o, 'almofada'), desenho(g, o, w, h) { const c = s(o, 'cor', '#4a3a7a'); bloco(g, 0, 0, w, 10, tom(c, -0.1)); bloco(g, 0, 8, w, h - 8, c); bloco(g, 0, 4, 4, h - 4, tom(c, -0.15)); bloco(g, w - 4, 4, 4, h - 4, tom(c, -0.15)); const a = s(o, 'almofada'); if (a) ret(g, 7, 4, 6, 5, a); } },
  puff: { w: 16, h: 10, varianteBase: (o) => s(o, 'cor'), desenho(g, o) { const c = s(o, 'cor', '#ff6fae'); elipse(g, 8, 6, 7, 3, tom(c, -0.25)); elipse(g, 8, 4, 7, 3, c); ret(g, 5, 2, 4, 1, tom(c, 0.3)); } },
  balcao: {
    w: 44, h: 26, desenho(g, _o, w, h) { bloco(g, 0, h - 14, w, 14, '#2c3150'); ret(g, 0, h - 14, w, 2, '#e9ecf3'); ret(g, 0, h - 7, w, 1, '#ff8fd0'); bloco(g, 4, h - 24, 9, 10, '#b9c0d0'); ret(g, 6, h - 21, 5, 3, '#2a2e40'); for (const x of [18, 22, 26]) ret(g, x, h - 17, 2, 3, '#f4f1ea'); bloco(g, 32, h - 21, 8, 7, '#c79c6e'); },
    camadas: [{ nome: 'vapor', n: fixo(6), desenhar: (g, k, _o, _w, h) => { for (let kk = 0; kk < 2; kk++) { const f = ((k / 6) + kk * 0.5) % 1; g.globalAlpha = 1 - f; pxl(g, 8 + (kk ? 1 : -1), h - 26 - f * 8, '#e8f0ff'); g.globalAlpha = 1; } }, quadro: (_o, a) => Math.floor(a.t * 5) % 6 }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 8, r: 22, cor: '#ff8fd0', int: 0.45 }],
  },
  vending: { w: 16, h: 36, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#2b7fd6'); ret(g, 2, 6, 10, 20, '#15203a'); const cores = ['#ffcf4d', '#ff6b5a', '#7dffa8', '#ffffff']; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) ret(g, 3 + c * 3, 8 + r * 5, 2, 3, cores[(r + c) % 4]); textoPlano(g, 'WHEY', 1, 1, '#ffffff'); }, luzes: (_o, w) => [{ x: w / 2, y: 16, r: 22, cor: '#4ea8ff', int: 0.6 }] },
  arcade: {
    w: 16, h: 38, varianteBase: (o) => s(o, 'cor'),
    desenho(g, o, w, h) { const c = s(o, 'cor', '#4a2d8a'); bloco(g, 1, 0, w - 2, h, c); ret(g, 3, 5, w - 6, 11, '#0b0d18'); bloco(g, 0, 19, w, 4, '#1d1f2e'); pxl(g, 4, 20, '#ff4fd8'); pxl(g, 7, 20, '#3ee0ff'); ret(g, 3, 1, w - 6, 2, '#ffcf4d'); },
    camadas: [{ nome: 'tela', n: fixo(6), desenhar: (g, k) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (((x * 3 + y * 5 + k) % 6) > 2) pxl(g, 4 + x * 2, 6 + y * 2, ['#ff4fd8', '#3ee0ff', '#ffcf4d', '#7dffa8'][(x + y + k) % 4]); }, quadro: (_o, a) => Math.floor(a.t * 6) % 6 }],
    luzes: (o, w) => [{ x: w / 2, y: 10, r: 18, cor: s(o, 'cor') === '#2d6a8a' ? '#3ee0ff' : '#ff4fd8', int: 0.6 }],
  },
  halteres: { w: 30, h: 18, desenho(g, _o, w, h) { bloco(g, 0, h - 4, w, 4, '#2a2f3a'); ret(g, 1, 2, 2, h - 6, '#4a5266'); ret(g, w - 3, 2, 2, h - 6, '#4a5266'); for (let k = 0; k < 5; k++) { ret(g, 4 + k * 5, 4, 4, 3, '#1b1d24'); ret(g, 4 + k * 5, 9, 4, 3, '#22252e'); } } },
  supino: { w: 30, h: 26, desenho(g, _o, w, h) { bloco(g, 6, h - 10, 18, 4, '#a8323e'); ret(g, 12, h - 6, 4, 6, '#2c303c'); ret(g, 2, 2, 2, h - 2, '#596179'); ret(g, w - 4, 2, 2, h - 2, '#596179'); ret(g, 0, 4, w, 1, '#c5cad6'); ret(g, 0, 1, 3, 7, '#16181f'); ret(g, w - 3, 1, 3, 7, '#16181f'); } },
  agachamento: { w: 30, h: 44, desenho(g, _o, w, h) { ret(g, 2, 0, 2, h, '#59617a'); ret(g, w - 4, 0, 2, h, '#59617a'); ret(g, 2, 0, w - 4, 2, '#6b7390'); ret(g, 0, 16, w, 1, '#cfd4de'); ret(g, 0, 12, 3, 9, '#14161c'); ret(g, w - 3, 12, 3, 9, '#14161c'); ret(g, 0, h - 2, w, 2, '#9a6a3c'); } },
  esteira: {
    w: 18, h: 24, desenho(g, _o, w, h) { bloco(g, 0, h - 4, w, 4, '#2c303c'); ret(g, w - 4, 4, 2, h - 8, '#596179'); bloco(g, w - 7, 2, 7, 4, '#3a4152'); },
    camadas: [{ nome: 'faixa', n: fixo(3), desenhar: (g, k, _o, w, h) => { for (let x = (k * 2) % 6; x < w - 2; x += 6) ret(g, x, h - 3, 2, 1, '#4a5060'); pxl(g, w - 4, 3, k ? '#52ffa8' : '#2a4a3a'); }, quadro: (_o, a) => (a.usada ? 1 + (Math.floor(a.t * 8) % 2) : 0), emEspera: 'anima' }],
  },
  bike: { w: 16, h: 22, desenho(g, _o, w, h) { elipse(g, w / 2, h - 5, 4, 4, '#3a3f50'); ret(g, 3, 6, 2, h - 8, '#596179'); ret(g, w - 5, 2, 2, h - 6, '#596179'); ret(g, 1, 5, 6, 2, '#1d1f28'); ret(g, w - 7, 1, 6, 1, '#c5cad6'); ret(g, 2, h - 2, w - 4, 2, '#2c303c'); pxl(g, w / 2, h - 5, '#ff7ab8'); } },
  palco: { w: 46, h: 8, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#3d3150'); ret(g, 0, 0, w, 1, '#e8c14e'); textoPlano(g, 'POSE', w / 2 - 7, 2, '#e8c14e'); }, luzes: (_o, w) => [{ x: w / 2, y: -12, r: 34, cor: '#ffe6a8', int: 0.5 }] },
  espelho: { w: 44, h: 38, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#9aa3b8'); ret(g, 2, 2, w - 4, h - 4, '#a9cfe8'); for (let k = 0; k < 5; k++) linha(g, 6 + k * 8, 4, 2 + k * 8, h - 4, '#dff3ff'); } },
  refletor: { w: 12, h: 38, desenho(g, _o, w, h) { ret(g, 5, 8, 2, h - 8, '#2c303c'); bloco(g, 1, 0, 10, 8, '#1d2030'); ret(g, 3, 5, 6, 2, '#fff3c4'); ret(g, 2, h - 2, 8, 2, '#2c303c'); }, luzes: (_o, w) => [{ x: w / 2, y: 6, r: 16, cor: '#fff3c4', int: 0.7 }] },
  telaVerde: { w: 58, h: 46, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h - 6, '#2fae4f'); ret(g, 0, h - 6, w, 6, '#2a9c47'); } },
  camera: {
    w: 14, h: 28, desenho(g, _o, w, h) { linha(g, 7, 12, 2, h - 1, '#3a3f50'); linha(g, 7, 12, 12, h - 1, '#3a3f50'); linha(g, 7, 12, 7, h - 1, '#3a3f50'); bloco(g, 2, 4, 10, 8, '#1d2030'); ret(g, 0, 6, 3, 4, '#2a2e40'); },
    camadas: [{ nome: 'rec', n: fixo(2), desenhar: (g, k) => pxl(g, 10, 5, k ? '#ff3030' : '#4a1a1a'), quadro: (_o, a) => (a.usada && Math.floor(a.t * 2) % 2 ? 1 : 0), emEspera: 0 }],
  },
  ringlight: { w: 16, h: 40, desenho(g, _o, w, h) { ret(g, 7, 14, 2, h - 14, '#3a3f50'); for (let a = 0; a < 40; a++) { const t = (a / 40) * Math.PI * 2; pxl(g, 8 + Math.cos(t) * 6, 8 + Math.sin(t) * 6, '#fffbe8'); } ret(g, 3, h - 2, 10, 2, '#3a3f50'); }, luzes: () => [{ x: 8, y: 8, r: 22, cor: '#fff8e0', int: 0.7 }] },
  nucleo: {
    w: 56, h: 70,
    desenho(g, _o, w, h) { bloco(g, 0, h - 6, w, 6, '#8f98b3'); bloco(g, 8, h - 12, w - 16, 6, '#6d7694'); bloco(g, 18, h - 22, w - 36, 10, '#3a4160'); },
    camadas: [{
      nome: 'esfera', n: fixo(8),
      desenhar: (g, k, _o, w, h) => {
        const cx = w / 2, cy = h - 42, R = 13;
        g.globalAlpha = 0.18; ret(g, cx - 6, cy, 13, h - 22 - cy, '#3ee0ff'); g.globalAlpha = 0.85; elipse(g, cx, cy, R, R, '#0f3a52'); g.globalAlpha = 1;
        for (let a = 0; a < 90; a++) { const t = (a / 90) * Math.PI * 2; pxl(g, cx + Math.cos(t) * R, cy + Math.sin(t) * R, '#3ee0ff'); }
        for (let m = 0; m < 3; m++) { const rx = Math.max(1, Math.abs(Math.cos((k / 8) * Math.PI + (m * Math.PI) / 3)) * R); for (let a = 0; a < 60; a++) { const t = (a / 60) * Math.PI * 2; pxl(g, cx + Math.cos(t) * rx, cy + Math.sin(t) * R, '#2ab3d9'); } }
        const a0 = (k / 8) * Math.PI * 2; for (let a = 0; a < 30; a++) { const t = a0 + (a / 30) * 2.2; pxl(g, cx + Math.cos(t) * 22, cy + Math.sin(t) * 6, '#ffcf4d'); }
      },
      quadro: (_o, a) => Math.floor(a.t * 3) % 8,
    }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 42, r: 56, cor: '#3ee0ff', int: 0.85 }],
  },
  doca: { w: 26, h: 5, desenho(g, _o, w) { bloco(g, 0, 1, w, 4, '#3a4160'); ret(g, 4, 0, 6, 1, '#3ee0ff'); ret(g, w - 10, 0, 6, 1, '#3ee0ff'); } },
  terminal: {
    w: 14, h: 34, desenho(g, _o, w, h) { bloco(g, 4, h - 14, 6, 14, '#3a4160'); bloco(g, 2, h - 16, 10, 2, '#2a2e44'); },
    camadas: [{ nome: 'holo', n: fixo(3), desenhar: (g, k, _o, w, h) => holoFrente(g, 1, h - 30, w - 2, 12, '#3ee0ff', k, true), quadro: (o, a) => Math.floor((a.t + o.i) * 3) % 3 }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 24, r: 14, cor: '#3ee0ff', int: 0.5 }],
  },
  teleporte: {
    w: 34, h: 6, desenho(g, _o, w, h) { bloco(g, 0, 2, w, h - 2, '#3a4160'); ret(g, 3, 1, w - 6, 1, '#3ee0ff'); },
    camadas: [{ nome: 'anel', n: fixo(2), desenhar: (g, k, _o, w) => { ret(g, 6, 0, w - 12, 1, k ? '#9ff3ff' : '#3ee0ff'); }, quadro: (_o, a) => Math.floor(a.t * 4) % 2 }],
    luzes: (_o, w) => [{ x: w / 2, y: 0, r: 32, cor: '#3ee0ff', int: 0.6 }],
  },
  balcaoRecepcao: { w: 44, h: 20, desenho(g, _o, w, h) { bloco(g, 0, 2, w, h - 2, '#e6e9f2'); ret(g, 0, 2, w, 2, '#f5f7fb'); ret(g, 0, h - 7, w, 1, '#ffe08a'); textoPlano(g, 'BEM-VINDO', w / 2 - 17, h - 13, '#9a7a2a'); }, luzes: (_o, w, h) => [{ x: w / 2, y: h - 6, r: 24, cor: '#ffe08a', int: 0.45 }] },
  cubiculo: { w: 30, h: 22, desenho(g, _o, w, h) { bloco(g, 0, 0, 3, h, '#525b77'); bloco(g, w - 3, 0, 3, h, '#525b77'); ret(g, 0, 0, w, 2, '#7a83a3'); } },
  aquario: {
    w: 30, h: 30, desenho(g, _o, w, h) { bloco(g, 0, h - 10, w, 10, '#3a2a22'); ret(g, 1, 2, w - 2, h - 12, '#2b6fa8'); ret(g, 1, 2, w - 2, 1, '#7cc6ff'); for (const x of [5, 13, 22]) ret(g, x, h - 17, 1, 6, '#3fae5a'); },
    camadas: [{ nome: 'peixes', n: fixo(6), desenhar: (g, k, _o, w) => { const cores = ['#ff8a3c', '#ffd35c', '#ff5fa8']; for (let p = 0; p < 3; p++) { const x = 3 + ((k * 3 + p * 8) % (w - 8)); ret(g, x, 6 + p * 4, 3, 2, cores[p]); pxl(g, x + (k % 2 ? 3 : -1), 6 + p * 4, cores[p]); } }, quadro: (_o, a) => Math.floor(a.t * 2) % 6 }],
    luzes: (_o, w) => [{ x: w / 2, y: 10, r: 22, cor: '#4fb3ff', int: 0.55 }],
  },
  mesaComando: {
    w: 44, h: 32,
    desenho(g, _o, w, h) { pernas(g, 2, w - 2, h - 10, 10, '#2a2c3a'); bloco(g, 0, h - 12, w, 3, '#2b2e44'); ret(g, 12, h - 14, 20, 2, '#20222f'); ret(g, 2, h - 20, 2, 8, '#3a3d52'); ret(g, w - 8, h - 15, 3, 3, '#f2efe8'); },
    camadas: [
      { nome: 'rgb', n: fixo(6), desenhar: (g, k, _o, w, h) => { for (let x = 0; x < w; x += 2) { estilo(g, `hsl(${(x * 8 + k * 60) % 360} 90% 60%)`); g.fillRect(x, h - 9, 2, 1); } }, quadro: (_o, a) => Math.floor(a.t * 4) % 6 },
      { nome: 'holos', n: fixo(4), desenhar: (g, k, _o, w, h) => { const at = k > 0; holoFrente(g, 0, h - 30, 9, 14, '#ffcf4d', k, at); holoFrente(g, w - 9, h - 30, 9, 14, '#3ee0ff', k + 1, at); }, quadro: (_o, a) => (a.presente ? 1 + (Math.floor(a.t * 3) % 3) : 0) },
    ],
    // luz âmbar no tampo (como no iso): o rosto de quem senta atrás fica com a cor dele
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 11, r: 20, cor: '#ffcf4d', int: 0.25 }],
  },
  mesaNotebook: {
    w: 32, h: 28,
    desenho(g, _o, w, h) { pernas(g, 2, w - 2, h - 10, 10, '#c9cfdc'); bloco(g, 0, h - 12, w, 3, '#f4f1ec'); bloco(g, 8, h - 20, 12, 8, '#d7dce6'); ret(g, w - 7, h - 16, 3, 4, '#ff8fb8'); bloco(g, w - 5, h - 17, 4, 5, '#e6e1d8'); elipse(g, w - 3, h - 20, 3, 2, '#3f9656'); },
    camadas: [{ nome: 'coracao', n: fixo(2), desenhar: (g, k, _o, _w, h) => { const c = k ? '#ff5f8f' : '#ff86a8'; for (const [dx, dy] of [[-1, 0], [1, 0], [-1, -1], [1, -1], [0, 0], [0, 1]] as const) pxl(g, 14 + dx, h - 17 + dy, c); }, quadro: (_o, a) => Math.floor(a.t * 1.2) % 2 }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 18, r: 18, cor: '#ff8fb8', int: 0.5 }],
  },
  luminaria: { w: 12, h: 38, desenho(g, _o, w, h) { ret(g, 5, 8, 2, h - 8, '#2a2c3a'); bloco(g, 1, 0, 10, 8, '#f2d8a8'); ret(g, 2, h - 2, 8, 2, '#2a2c3a'); }, luzes: () => [{ x: 6, y: 4, r: 30, cor: '#ffd9a0', int: 0.8 }] },
  pod: {
    w: 34, h: 46,
    desenho(g, _o, w, h) { bloco(g, 0, h - 4, w, 4, '#3a3550'); bloco(g, 1, 8, w - 2, h - 12, '#8a7fb3'); ret(g, 3, 10, w - 6, h - 16, '#3a3558'); bloco(g, 5, h - 14, w - 10, 3, '#ece9f5'); },
    camadas: [
      { nome: 'tela', n: fixo(2), desenhar: (g, k, _o, w, h) => ret(g, w / 2 - 4, h - 20, 8, 5, k ? '#3ee0ff' : '#1a1830'), quadro: (_o, a) => (a.presente ? 1 : 0), emEspera: 0 },
      { nome: 'placa', n: fixo(2), variante: (o) => s(o, 'nome'), desenhar: (g, k, o, w) => { const nome = s(o, 'nome'); const { largura } = pixelsTexto(nome); const x = Math.round(w / 2 - largura / 2); ret(g, x - 2, 0, largura + 4, 8, '#14122a'); ret(g, x - 2, 0, largura + 4, 1, k ? '#c9a7ff' : '#4b4568'); textoPlano(g, nome, x, 2, k ? '#e9dcff' : '#8a7fb3'); }, quadro: (_o, a) => (a.presente ? 1 : 0), emEspera: 0 },
    ],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 18, r: 18, cor: '#c9a7ff', int: 0.35 }],
  },
  saco: { w: 12, h: 42, varianteBase: (o) => s(o, 'cor'), desenho(g, o, w, h) { const c = s(o, 'cor', '#b3262f'); ret(g, 1, 0, 2, h, '#3a3f50'); ret(g, 1, 0, 8, 2, '#3a3f50'); bloco(g, 4, 6, 7, 20, c); ret(g, 4, 6, 7, 2, tom(c, 0.2)); } },
  sacoPancada: { w: 12, h: 42, desenho(g, _o, w, h) { ret(g, 1, 0, 2, h, '#3a3f50'); ret(g, 1, 0, 8, 2, '#3a3f50'); bloco(g, 4, 6, 7, 20, '#2f5fa8'); } },
  bebedouro: { w: 10, h: 26, desenho(g, _o, w, h) { bloco(g, 1, h - 14, 8, 14, '#e6e9f2'); elipse(g, 5, h - 19, 3, 5, '#7cc6ff'); } },
  impressora: { w: 14, h: 12, desenho(g, _o, w, h) { bloco(g, 0, 2, w, h - 2, '#d6dbe6'); ret(g, 3, 0, w - 6, 2, '#f8f8f8'); } },
  quadro: { w: 30, h: 36, varianteBase: (o) => s(o, 'estilo'), desenho(g, o, w, h) { ret(g, 3, h - 10, 2, 10, '#596179'); ret(g, w - 5, h - 10, 2, 10, '#596179'); bloco(g, 0, 0, w, h - 10, '#e9edf5'); const e = s(o, 'estilo'); if (e === 'kanban') { for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) ret(g, 3 + c * 9, 3 + r * 7, 7, 5, ['#ffd35c', '#9fe3ff', '#ffb3c7', '#b8f5c8'][(c + r) % 4]); } else { ret(g, 3, 3, 11, 8, '#4f8cff'); ret(g, 17, 3, 10, 6, '#ff6b5a'); ret(g, 3, 14, 24, 1, '#4a5168'); ret(g, 3, 18, 16, 1, '#4a5168'); } } },
  geladeira: { w: 14, h: 24, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#2b2f40'); ret(g, 2, 2, w - 4, h - 6, '#16213a'); for (let k = 0; k < 3; k++) ret(g, 3 + k * 3, 6, 2, 6, ['#52ffa8', '#ff4fd8', '#3ee0ff'][k]); }, luzes: (_o, w) => [{ x: w / 2, y: 10, r: 14, cor: '#52ffa8', int: 0.45 }] },
  haltereChao: { w: 12, h: 5, desenho(g) { for (const x of [0, 7]) { ret(g, x, 1, 2, 4, '#1b1d24'); ret(g, x + 2, 2, 1, 2, '#9aa3b8'); ret(g, x + 3, 1, 2, 4, '#1b1d24'); } } },
  vitrine: {
    w: 40, h: 40, desenho(g, _o, w, h) { bloco(g, 4, h - 6, w - 8, 6, '#2a2e44'); ret(g, 6, h - 7, w - 12, 1, '#3ee0ff'); },
    camadas: [{ nome: 'holo', n: fixo(2), variante: (o) => s(o, 'forma', 'carro'), desenhar: (g, k, o, w, h) => { const c = k ? '#9ff3ff' : '#3ee0ff'; g.globalAlpha = 0.16; ret(g, 8, h - 26, w - 16, 20, '#3ee0ff'); g.globalAlpha = 1; if (s(o, 'forma', 'carro') === 'carro') { ret(g, 8, h - 20, w - 16, 1, c); ret(g, 12, h - 24, w - 24, 1, c); linha(g, 8, h - 20, 12, h - 24, c); linha(g, w - 8, h - 20, w - 12, h - 24, c); elipse(g, 13, h - 18, 2, 2, c); elipse(g, w - 13, h - 18, 2, 2, c); } else { const cx = w / 2; for (const [a, b2, c2, d] of [[cx - 8, h - 30, cx + 8, h - 30], [cx - 8, h - 14, cx + 8, h - 14], [cx - 8, h - 30, cx - 8, h - 14], [cx + 8, h - 30, cx + 8, h - 14]]) linha(g, a, b2, c2, d, c); } }, quadro: (_o, a) => (Math.floor(a.t * 10) % 7 === 0 ? 1 : 0) }],
    luzes: (_o, w, h) => [{ x: w / 2, y: h - 18, r: 28, cor: '#3ee0ff', int: 0.6 }],
  },
  mural: {
    w: 52, h: 30, desenho() { /* só camadas */ },
    camadas: [{ nome: 'holo', n: fixo(3), variante: (o) => s(o, 'cor', '#ff6b5a') + ((o.props.colunas as string[] | undefined) ?? []).join(','), desenhar: (g, k, o, w) => { holoFrente(g, 0, 0, w, 26, s(o, 'cor', '#ff6b5a'), k, true); const rot = (o.props.colunas as string[] | undefined) ?? ['G0', 'G1', 'G2', 'G3', 'G4']; rot.slice(0, 5).forEach((t, c) => { textoPlano(g, t, 3 + c * 10, 3, '#ffffff'); for (let m = 0; m < 1 + ((c * 2 + k) % 3); m++) ret(g, 3 + c * 10, 11 + m * 4, 6, 2, c < 2 ? '#7dffa8' : c === 2 ? '#ffcf4d' : '#c9b8ff'); }); }, quadro: (_o, a) => Math.floor(a.t / 4) % 3 }],
    luzes: (o, w) => [{ x: w / 2, y: 12, r: 30, cor: s(o, 'cor', '#ff6b5a'), int: 0.4 }],
  },
  lampiao: { w: 10, h: 46, desenho(g, _o, w, h) { ret(g, 4, 10, 2, h - 10, '#3a3028'); bloco(g, 1, 2, 8, 8, '#ffcf7a'); ret(g, 0, 0, 10, 2, '#4a3a2e'); ret(g, 0, 10, 10, 1, '#4a3a2e'); ret(g, 2, h - 2, 6, 2, '#2a2420'); }, luzes: () => [{ x: 5, y: 6, r: 36, cor: '#ffc46a', int: 0.85 }] },
  painelEnergia: { w: 12, h: 34, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#4a5068'); ret(g, 2, 3, w - 4, h - 8, '#2a2e40'); ret(g, 2, h - 4, 4, 2, '#ffcf4d'); for (let r = 0; r < 5; r++) pxl(g, 4 + (r % 2) * 3, 6 + r * 4, r % 3 ? '#52ffa8' : '#ff6b5a'); } },
  caixas: { w: 14, h: 18, desenho(g) { bloco(g, 0, 8, 14, 10, '#a8835a'); bloco(g, 2, 2, 10, 7, '#c49a68'); ret(g, 5, 12, 4, 1, '#5a4430'); } },
  cafeteira: { w: 12, h: 22, desenho(g, _o, w, h) { bloco(g, 0, h - 10, w, 10, '#3a3f55'); bloco(g, 1, h - 18, 10, 8, '#1d2030'); ret(g, 3, h - 15, 3, 2, '#ff6b5a'); ret(g, 7, h - 12, 2, 2, '#f4f1ea'); } },
  caixaSom: { w: 10, h: 22, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#1d1f28'); elipse(g, 5, 6, 2, 2, '#3a3d4c'); elipse(g, 5, 15, 3, 3, '#3a3d4c'); } },
  arquivo: { w: 12, h: 26, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#7a8299'); for (const y of [6, 14, 22]) { ret(g, 1, y - 1, w - 2, 1, '#5a6178'); ret(g, 4, y - 4, 4, 1, '#d6dbe6'); } } },
  holoPainel: { w: 16, h: 38, desenho(g, _o, w, h) { ret(g, 7, h - 14, 2, 14, '#59648f'); bloco(g, 4, h - 3, 8, 3, '#3a4160'); }, camadas: [{ nome: 'holo', n: fixo(3), desenhar: (g, k, _o, w, h) => holoFrente(g, 0, h - 38, w, 22, '#c9b8ff', k, true), quadro: (o, a) => Math.floor((a.t + o.j) * 3) % 3 }], luzes: (_o, w, h) => [{ x: w / 2, y: h - 26, r: 16, cor: '#9fb3ff', int: 0.45 }] },
  kettlebells: { w: 16, h: 8, desenho(g) { for (const [x, c] of [[1, '#1b1d24'], [6, '#a8323e'], [11, '#2f6fb0']] as const) { elipse(g, x + 2, 5, 2, 2, c); ret(g, x + 1, 1, 3, 1, '#4a5266'); } } },
  colchonete: { w: 30, h: 3, desenho(g, _o, w) { bloco(g, 0, 0, w, 3, '#2f6f73'); } },
  placaNeon: {
    w: 26, h: 40, desenho(g, _o, w, h) { ret(g, w / 2 - 1, 14, 2, h - 14, '#2a2c3a'); ret(g, w / 2 - 3, h - 2, 6, 2, '#2a2c3a'); },
    camadas: [{ nome: 'neon', n: fixo(2), variante: (o) => s(o, 'texto') + s(o, 'cor'), desenhar: (g, k, o, w) => { const t = s(o, 'texto', 'ARCADIA'), c = s(o, 'cor', '#ff4fd8'); const { largura } = pixelsTexto(t); const x = Math.round(w / 2 - largura / 2); ret(g, x - 3, 2, largura + 6, 11, '#0c0e1f'); ret(g, x - 3, 2, largura + 6, 1, c); ret(g, x - 3, 12, largura + 6, 1, c); textoPlano(g, t, x, 5, k ? tom(c, -0.5) : c); }, quadro: (o, a) => (Math.sin(a.t * 13 + o.i * 7) > 0.97 ? 1 : 0), emEspera: 1 }],
    luzes: (o, w) => [{ x: w / 2, y: 7, r: 26, cor: s(o, 'cor', '#ff4fd8'), int: 0.55 }],
  },
  pinball: { w: 16, h: 30, desenho(g, _o, w, h) { pernas(g, 1, w - 1, h - 12, 12, '#2a2c3a'); bloco(g, 0, h - 18, w, 6, '#7a2a8a'); bloco(g, 0, 0, w, h - 18, '#5a1f6a'); ret(g, 2, 2, w - 4, 8, '#1a1430'); }, camadas: [{ nome: 'luzes', n: fixo(4), desenhar: (g, k) => { for (let c = 0; c < 4; c++) if ((c + k) % 3) pxl(g, 3 + c * 3, 4 + (c % 2) * 3, ['#ffcf4d', '#ff4fd8', '#3ee0ff'][(c + k) % 3]); }, quadro: (_o, a) => Math.floor(a.t * 5) % 4 }], luzes: (_o, w) => [{ x: w / 2, y: 6, r: 16, cor: '#ff4fd8', int: 0.5 }] },
  tvGame: { w: 22, h: 30, desenho(g, _o, w, h) { bloco(g, 2, h - 10, w - 4, 10, '#2a2c3a'); bloco(g, 0, 0, w, h - 11, '#14161f'); ret(g, w / 2 - 2, h - 9, 4, 2, '#e9ecf3'); }, camadas: [{ nome: 'tela', n: fixo(4), desenhar: (g, k, _o, w, h) => { ret(g, 2, 2, w - 4, h - 15, '#1f3a6a'); ret(g, 2, h - 17, w - 4, 4, '#2f7a45'); ret(g, 4 + k * 3, h - 21, 3, 4, '#ffcf4d'); }, quadro: (_o, a) => Math.floor(a.t * 3) % 4 }], luzes: (_o, w) => [{ x: w / 2, y: 9, r: 20, cor: '#4f8cff', int: 0.5 }] },
  totem: { w: 10, h: 36, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#e6e9f2'); ret(g, 2, 3, w - 4, 16, '#1d2030'); for (let r = 0; r < 4; r++) ret(g, 3, 5 + r * 3, 3 + (r % 2) * 2, 1, r ? '#9fe3ff' : '#ffe08a'); } },
  banco: { w: 28, h: 10, desenho(g, _o, w, h) { ret(g, 2, 4, 2, h - 4, '#3a3f50'); ret(g, w - 4, 4, 2, h - 4, '#3a3f50'); bloco(g, 0, 2, w, 3, '#a8744a'); } },
  impressora3d: { w: 14, h: 26, desenho(g, _o, w, h) { ret(g, 0, 0, 2, h, '#596179'); ret(g, w - 2, 0, 2, h, '#596179'); ret(g, 0, 0, w, 2, '#3a3f50'); bloco(g, 0, h - 3, w, 3, '#2a2c3a'); bloco(g, 4, h - 9, 6, 6, '#ff7ab8'); ret(g, 6, 6, 3, 3, '#c5cad6'); } },
  cadeiraGamer: { w: 12, h: 28, desenho(g, _o, w, h) { bloco(g, 1, 0, w - 2, 16, '#1d1f28'); ret(g, 2, 2, 2, 12, '#ff4fd8'); ret(g, w - 4, 2, 2, 12, '#ff4fd8'); bloco(g, 0, 16, w, 4, '#1d1f28'); ret(g, w / 2 - 1, 20, 2, 5, '#262a3c'); ret(g, 2, h - 2, w - 4, 2, '#262a3c'); } },
  posterJogo: { w: 18, h: 40, varianteBase: (o) => s(o, 'cor'), desenho(g, o, w, h) { const c = s(o, 'cor', '#ff6b5a'); ret(g, w / 2 - 1, 26, 2, h - 26, '#2a2c3a'); bloco(g, 0, 0, w, 26, tom(c, -0.55)); ret(g, 7, 6, 4, 10, c); ret(g, 5, 10, 8, 3, tom(c, 0.25)); ret(g, 8, 17, 2, 2, '#ffcf4d'); pxl(g, 3, 4, '#ffffff'); pxl(g, 14, 9, '#ffffff'); } },
  mesaHolo: { w: 46, h: 30, desenho(g, _o, w, h) { bloco(g, 12, h - 12, w - 24, 12, '#2a2e44'); bloco(g, 2, h - 15, w - 4, 3, '#3a4160'); ret(g, 4, h - 16, w - 8, 1, '#3ee0ff'); }, camadas: [{ nome: 'mini', n: fixo(6), desenhar: (g, k, _o, w, h) => { g.globalAlpha = 0.3; ret(g, 8, h - 28, w - 16, 12, '#3ee0ff'); g.globalAlpha = 1; const cores = ['#ff6b5a', '#4f8cff', '#ffb347', '#3fd28b', '#c9a7ff', '#f2b45a']; for (let q = 0; q < 6; q++) { const x = 10 + ((q * 6 + k * 2) % (w - 22)); ret(g, x, h - 24 + (q % 2) * 4, 4, 3, cores[q]); } }, quadro: (_o, a) => Math.floor(a.t * 2) % 6 }], luzes: (_o, w, h) => [{ x: w / 2, y: h - 22, r: 30, cor: '#3ee0ff', int: 0.6 }] },
};

/** Cápsula de recarga de frente: o bot fica de pé na frente do painel, entre as duas colunas. */
FRENTE.recarga = {
  w: 22, h: 48, fundo: true, varianteBase: (o) => s(o, 'cor'),
  desenho(g, o, w, h) {
    const cor = s(o, 'cor', '#3ee0ff');
    bloco(g, 3, 4, w - 6, h - 8, '#1f2640', false);
    for (const y of [14, 24, 34]) ret(g, 4, y, w - 8, 1, '#2c3658');
    bloco(g, 0, 2, 3, h - 4, '#4a5478'); bloco(g, w - 3, 2, 3, h - 4, '#4a5478');
    bloco(g, 0, 0, w, 3, '#3a4262'); ret(g, 1, 3, w - 2, 1, cor);
    bloco(g, 1, h - 4, w - 2, 4, '#262c44'); ret(g, 4, h - 4, w - 8, 1, '#2ab3d9');
  },
  camadas: [{
    nome: 'carga', n: fixo(9),
    desenhar: (g, k, _o, w, h) => {
      const nivel = k < 8 ? Math.floor(((k + 1) * 6) / 8) : 0;
      for (let sg = 0; sg < 6; sg++) {
        let cor: string | null = null;
        if (k === 8) cor = sg === 5 ? '#2f6f86' : null;
        else if (sg < nivel) cor = '#52ffa8';
        else if (sg === nivel) cor = '#1f6a4a';
        if (!cor) continue;
        const y = h - 8 - sg * 6;
        ret(g, 1, y - 3, 1, 3, cor); ret(g, w - 2, y - 3, 1, 3, cor);
      }
    },
    quadro: (_o, a) => (a.presente ? Math.floor((((a.t % 6) + 6) % 6) / 6 * 8) % 8 : 8),
    emEspera: 'anima',
  }],
  luzes: (_o, w, h) => [{ x: w / 2, y: h - 22, r: 22, cor: '#52ffa8', int: 0.3 }],
};

/** Tipo genérico para o que não tem desenho de frente. */
export const FRENTE_PADRAO: Frente = { w: 14, h: 18, desenho(g, _o, w, h) { bloco(g, 0, 0, w, h, '#5a6178'); } };
export function frenteDe(tipo: string): Frente { return FRENTE[tipo] ?? FRENTE_PADRAO; }
