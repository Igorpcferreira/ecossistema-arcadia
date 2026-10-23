// Camada estática do andar: piso, tapetes, laje, linhas de dados, luzes-guia, paredes,
// janelas com a cidade, telas, letreiros. Desenhada uma vez num canvas e refeita só na
// troca de dia e noite (ou de paleta). Portada da prancha, agora a partir dos dados da cena.
import type { CenaDados, DecoParede, EstiloPiso, Janela, Zona } from '../cena/formato.ts';
import type { Geo } from '../motor/iso.ts';
import { mistura, paletaAtual, tom } from './cor.ts';
import { anel, linha, pixelsTexto, poli, pxl, ret, type G } from './primitivas.ts';

function semeado(sd: number): () => number { let v = sd; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; }

export interface MapaZonas { zonaEm(i: number, j: number): Zona | null }

export function criarMapaZonas(cena: CenaDados): MapaZonas & { indice: Int16Array } {
  const { ni, nj } = cena.andar;
  const indice = new Int16Array(ni * nj).fill(-1);
  cena.zonas.forEach((z, k) => { for (let j = z.j0; j <= z.j1; j++) for (let i = z.i0; i <= z.i1; i++) if (i < ni && j < nj) indice[j * ni + i] = k; });
  return {
    indice,
    zonaEm: (i, j) => {
      if (i < 0 || j < 0 || i >= ni || j >= nj) return null;
      const k = indice[j * ni + i];
      return k >= 0 ? cena.zonas[k] : null;
    },
  };
}

/* ---------- piso ---------- */
function losango(g: G, x: number, y: number, cor: string): void { for (let r = 0; r < 16; r++) { const m = r < 8 ? (r + 1) * 2 : (16 - r) * 2; ret(g, x - m, y + r, m * 2, 1, cor); } }
function bordas(g: G, x: number, y: number, clara: string | null, escura: string | null): void {
  if (clara) for (let r = 0; r < 8; r++) ret(g, x - (r + 1) * 2, y + r, 2, 1, clara);
  if (escura) for (let r = 8; r < 16; r++) { const m = (16 - r) * 2; ret(g, x + m - 2, y + r, 2, 1, escura); }
}
function pontoNoLosango(rnd: () => number, x: number, y: number): [number, number] { const r = 2 + Math.floor(rnd() * 12); const m = r < 8 ? (r + 1) * 2 : (16 - r) * 2; return [x - m + 2 + Math.floor(rnd() * Math.max(1, m * 2 - 4)), y + r]; }

function ladrilho(g: G, geo: Geo, i: number, j: number, estilo: EstiloPiso, rnd: () => number): void {
  const [x, y] = geo.iso(i, j);
  const par = (i + j) % 2 === 0;
  const tabuas = (cor: string, aoLongoDeI: boolean) => {
    for (const t of [1 / 3, 2 / 3]) {
      const a = aoLongoDeI ? geo.iso(i, j + t) : geo.iso(i + t, j), b = aoLongoDeI ? geo.iso(i + 1, j + t) : geo.iso(i + t, j + 1);
      linha(g, a[0], a[1], b[0], b[1], cor);
    }
  };
  const quente = paletaAtual() === 'quente';
  switch (estilo) {
    case 'corredor':
      if (quente) { losango(g, x, y, par ? '#4a3426' : '#46311f'); tabuas('#36251a', (i + j) % 4 < 2); bordas(g, x, y, '#5a4030', '#2e2016'); break; }
      losango(g, x, y, par ? '#2a2f47' : '#2d334d'); bordas(g, x, y, '#3a4162', '#1f2338'); break;
    case 'servidor': losango(g, x, y, '#1b2032'); bordas(g, x, y, '#2a3150', '#121626'); if (par) for (let k = 4; k < 13; k += 3) ret(g, x - 7, y + k, 14, 1, '#232a42'); break;
    case 'madeira': losango(g, x, y, i % 2 ? '#8a5a36' : '#83552f'); tabuas('#6a4228', true); bordas(g, x, y, '#a37148', null); for (let k = 0; k < 2; k++) { const [px, py] = pontoNoLosango(rnd, x, y); pxl(g, px, py, '#9b6a42'); } break;
    case 'azulejo': losango(g, x, y, par ? '#33405f' : '#37456a'); bordas(g, x, y, '#4a5a85', '#27304a'); break;
    case 'estudio': losango(g, x, y, par ? '#25222c' : '#28252f'); bordas(g, x, y, '#35313f', '#1a1820'); break;
    case 'carpete': losango(g, x, y, '#4f566a'); bordas(g, x, y, null, '#454b5e'); for (let k = 0; k < 5; k++) { const [px, py] = pontoNoLosango(rnd, x, y); pxl(g, px, py, '#5c6479'); } break;
    case 'nucleo': losango(g, x, y, par ? '#d5dae6' : '#ccd2e0'); bordas(g, x, y, '#eef1f7', '#a9b0c4'); break;
    case 'academia': {
      losango(g, x, y, '#1c2026'); bordas(g, x, y, '#272c35', '#14171c');
      const cores = ['#2f3644', '#2f3644', '#8a2c35', '#245a9a'];
      for (let k = 0; k < 5; k++) { const [px, py] = pontoNoLosango(rnd, x, y); pxl(g, px, py, cores[Math.floor(rnd() * cores.length)]); }
      break;
    }
    case 'lounge': losango(g, x, y, par ? '#c79c6e' : '#b4875a'); bordas(g, x, y, '#d9b083', '#9c7349'); break;
    case 'recepcao': losango(g, x, y, par ? '#d2cbbe' : '#c8c0b2'); bordas(g, x, y, '#e4ded2', '#aaa294'); if (rnd() < 0.35) { const [px, py] = pontoNoLosango(rnd, x, y); linha(g, px, py, px + 4, py + 1, '#b8b0a2'); } break;
    case 'produtos': losango(g, x, y, par ? '#6b6862' : '#66635d'); bordas(g, x, y, '#7a766f', '#55524d'); for (let k = 0; k < 3; k++) { const [px, py] = pontoNoLosango(rnd, x, y); pxl(g, px, py, '#77736c'); } break;
    case 'cockpit': losango(g, x, y, j % 2 ? '#5d3a25' : '#57361f'); tabuas('#432818', false); bordas(g, x, y, '#704831', null); break;
    case 'laboratorio': losango(g, x, y, par ? '#1d3a44' : '#20404a'); bordas(g, x, y, '#2c5a66', '#142a32'); if (par) pxl(g, x, y + 8, '#3ee0ff'); break;
    case 'deposito': losango(g, x, y, par ? '#4a4d55' : '#474a52'); bordas(g, x, y, '#5a5e68', '#3a3d44'); for (let k = 0; k < 4; k++) { const [px, py] = pontoNoLosango(rnd, x, y); pxl(g, px, py, '#55585f'); } break;
    default: losango(g, x, y, '#2a2f47');
  }
}

function planoMundo(g: G, geo: Geo, i0: number, j0: number, i1: number, j1: number, cor: string): void {
  poli(g, [geo.iso(i0, j0), geo.iso(i1, j0), geo.iso(i1, j1), geo.iso(i0, j1)], cor);
}

/* ---------- céu nas janelas ---------- */
const V0 = 14, V1 = 58;
function criarSkyline() {
  const r = semeado(77), N = 7000, alt = new Int16Array(N), tipo = new Uint8Array(N);
  let u = 0;
  while (u < N) {
    const w = 6 + Math.floor(r() * 14), h = 8 + Math.floor(r() * 30), tp = r() < 0.5 ? 1 : 0;
    for (let k = 0; k < w && u < N; k++, u++) { alt[u] = (k === 0 || k === w - 1) ? h - 2 : h; tipo[u] = tp; }
    if (r() < 0.25 && u < N) alt[u - Math.floor(w / 2)] += 6;
    u += Math.floor(r() * 3);
  }
  const m = (x: number) => ((x % N) + N) % N;
  return {
    altura: (x: number) => alt[m(x)],
    camada: (x: number) => tipo[m(x)],
    janela: (x: number, h: number) => (x % 3 === 1) && (h % 4 === 2) && (((x * 7 + h * 13) % 5) < 3),
    quente: (x: number) => (x % 7) < 5,
    estrela: (x: number, h: number) => ((x * 37 + h * 91) % 97) === 0,
  };
}
const SKY = criarSkyline();

function corCeu(jan: Janela, u: number, v: number, noite: boolean): string {
  const h = v - V0, t = h / (V1 - V0);
  const ub = (jan.parede === 'J' ? 0 : 3000) + u;
  if (jan.lua !== undefined) {
    const du = u - jan.lua, dv = v - 47;
    if (du * du + dv * dv < 22) return noite ? '#f4efd2' : '#fff6c2';
    if (!noite && du * du + dv * dv < 40) return '#fff1b8';
  }
  const a = SKY.altura(ub);
  if (h < a) {
    const lit = SKY.janela(ub, h);
    if (noite) return lit ? (SKY.quente(ub) ? '#ffd36b' : '#7fd8ff') : (SKY.camada(ub) ? '#14172e' : '#1c203f');
    return lit ? '#c6d8ef' : (SKY.camada(ub) ? '#5d6f96' : '#6c80a9');
  }
  if (noite) return SKY.estrela(ub, h) ? '#e8ecff' : mistura('#2b2160', '#0a0e2c', t);
  return mistura('#d6f1fb', '#74c0ee', t);
}

/* ---------- paredes ---------- */
function pintarParede(g: G, geo: Geo, mapa: MapaZonas, p: 'I' | 'J', noite: boolean): void {
  const nTiles = p === 'J' ? geo.ni : geo.nj;
  const PAR = geo.parede;
  for (let u = 0; u < nTiles * 16; u++) {
    const t = Math.floor(u / 16);
    const z = p === 'J' ? mapa.zonaEm(t, 0) : mapa.zonaEm(0, t);
    let base = z?.parede ?? (z ? '#2a2e49' : '#272b45');
    if (p === 'I') base = tom(base, -0.14);
    const [x, yb] = geo.mapaParede(p, u, 0);
    ret(g, x, yb - PAR, 1, PAR, base);
    ret(g, x, yb - 5, 1, 5, tom(base, -0.38));
    ret(g, x, yb - PAR - 3, 1, 3, p === 'J' ? '#5a6194' : '#4a5080');
    pxl(g, x, yb - PAR + 1, noite ? '#3ee0ff' : '#5f86ad');
    if (u % 32 === 0) ret(g, x, yb - PAR + 2, 1, PAR - 8, tom(base, -0.24));
    if (!z && (u % 16 === 7 || u % 16 === 8)) ret(g, x, yb - PAR + 6, 1, PAR - 14, noite ? (t % 2 ? '#ff4fd8' : '#3ee0ff') : (t % 2 ? '#8a5aa8' : '#4f8fb0'));
    if (z?.tema === 'servidores') {
      for (const v of [56, 60]) { pxl(g, x, yb - v, '#48506e'); pxl(g, x, yb - v - 1, '#5e678a'); }
      if (u % 6 < 4) for (let v = 20; v < 42; v += 3) pxl(g, x, yb - v, '#1b2032');
    }
  }
}

function pintarJanela(g: G, geo: Geo, jan: Janela, noite: boolean): void {
  for (let u = jan.u0; u < jan.u1; u++) {
    for (let v = V0 - 2; v <= V1 + 2; v++) {
      const [x, y] = geo.mapaParede(jan.parede, u, v);
      const borda = v < V0 || v > V1 || u < jan.u0 + 2 || u >= jan.u1 - 2;
      const montante = ((u - jan.u0) % 32) < 2;
      pxl(g, x, y, borda || montante ? '#181b2c' : corCeu(jan, u, v, noite));
    }
  }
}

const SITES = [
  { fundo: '#f4f1ea', topo: '#1d2b4f', imagem: '#c98a5a', sol: '#f6d27a', texto: '#9aa0ad', botao: '#2f6fe0' },
  { fundo: '#101418', topo: '#b0122a', imagem: '#3a3f48', sol: '#d8d8d8', texto: '#6b7280', botao: '#b0122a' },
  { fundo: '#eef7f1', topo: '#1f7a4d', imagem: '#7cc49a', sol: '#ffffff', texto: '#93a39a', botao: '#1f7a4d' },
  { fundo: '#fff8ef', topo: '#5b2a86', imagem: '#e2a3c7', sol: '#fde68a', texto: '#a59cb0', botao: '#f08c2b' },
];
function telaDeSite(g: G, geo: Geo, p: 'I' | 'J', u0: number, u1: number, paleta: typeof SITES[number]): void {
  for (let u = u0; u < u1; u++) {
    for (let v = 20; v <= 52; v++) {
      const [x, y] = geo.mapaParede(p, u, v);
      let c = '#0f121f';
      const iu = u - u0, w = u1 - u0;
      if (v > 21 && v < 51 && iu > 1 && iu < w - 2) {
        c = paleta.fundo;
        if (v >= 46) c = paleta.topo;
        else if (v >= 33 && v <= 43 && iu > 3 && iu < w - 4) c = ((iu - 6) ** 2 + (v - 39) ** 2 < 10) ? paleta.sol : paleta.imagem;
        else if ((v === 29 || v === 27 || v === 25) && iu > 3 && iu < (v === 25 ? w * 0.6 : w - 5)) c = paleta.texto;
        else if (v >= 30 && v <= 31 && iu > 3 && iu < 13) c = paleta.botao;
      }
      pxl(g, x, y, c);
    }
  }
}

export function textoParede(g: G, geo: Geo, parede: 'I' | 'J', texto: string, uCentro: number, vTopo: number, cor: string, esc = 2): void {
  const { pts, largura } = pixelsTexto(texto);
  const larg = largura * esc;
  for (const [fx, fy] of pts) {
    for (let a = 0; a < esc; a++) for (let b = 0; b < esc; b++) {
      const du = fx * esc + a, dv = fy * esc + b;
      const u = parede === 'J' ? uCentro - larg / 2 + du : uCentro + larg / 2 - du;
      const [x, y] = geo.mapaParede(parede, Math.round(u), vTopo - dv);
      pxl(g, x, y, cor);
    }
  }
}

function decoracao(g: G, geo: Geo, d: DecoParede, noite: boolean, k: number): void {
  if (d.tipo === 'sites') { telaDeSite(g, geo, d.parede, Math.round(d.u0), Math.round(d.u1), SITES[k % SITES.length]); return; }
  if (d.tipo === 'xadrez') {
    for (let u = Math.round(d.u0); u < d.u1; u++) for (let v = 8; v < 66; v++) {
      const [x, y] = geo.mapaParede(d.parede, u, v);
      pxl(g, x, y, (Math.floor(u / 4) + Math.floor(v / 4)) % 2 ? '#2c2836' : '#353042');
    }
    return;
  }
  if (d.tipo === 'onAir') {
    const uc = Math.round((d.u0 + d.u1) / 2);
    for (let u = -14; u <= 14; u++) for (let v = -4; v <= 4; v++) {
      const p = geo.mapaParede(d.parede, uc + u, 63 + v);
      pxl(g, p[0], p[1], Math.abs(u) === 14 || Math.abs(v) === 4 ? '#14090b' : '#3a1418');
    }
    return;
  }
  if (d.tipo === 'poster') {
    const cor = d.cor ?? '#ff6b5a';
    for (let u = Math.round(d.u0); u < d.u1; u++) for (let v = 18; v <= 50; v++) {
      const [x, y] = geo.mapaParede(d.parede, u, v);
      const iu = u - d.u0, w = d.u1 - d.u0;
      let c = '#14161f';
      if (v > 19 && v < 49 && iu > 1 && iu < w - 2) {
        c = tom(cor, -0.55);
        if ((iu - w / 2) ** 2 + (v - 36) ** 2 < 30) c = cor;
        if (v < 26) c = tom(cor, -0.25);
        if (v === 23 && iu > 3 && iu < w - 4) c = '#ffffff';
      }
      pxl(g, x, y, c);
    }
    return;
  }
  if (d.tipo === 'neon' && d.texto) textoParede(g, geo, d.parede, d.texto, (d.u0 + d.u1) / 2, 40, noite ? (d.cor ?? '#ff4fd8') : tom(d.cor ?? '#ff4fd8', -0.3));
}

/** Monta o canvas estático do andar inteiro (dia ou noite, na paleta ativa). */
export function construirEstatico(cena: CenaDados, geo: Geo, noite: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = geo.larg; c.height = geo.alt;
  const g = c.getContext('2d')!;
  const mapa = criarMapaZonas(cena);
  const rnd = semeado(11);
  const { ni, nj } = geo;
  for (let s = 0; s <= ni + nj - 2; s++) {
    for (let i = 0; i < ni; i++) {
      const j = s - i; if (j < 0 || j >= nj) continue;
      const z = mapa.zonaEm(i, j);
      ladrilho(g, geo, i, j, z ? z.piso : 'corredor', rnd);
    }
  }
  // tapetes
  for (const t of cena.tapetes) {
    planoMundo(g, geo, t.i0, t.j0, t.i1, t.j1, t.cor);
    if (t.borda) planoMundo(g, geo, t.i0 + 0.3, t.j0 + 0.3, t.i1 - 0.3, t.j1 - 0.3, t.borda);
    if (t.listras) for (let k = 0; k < t.i1 - t.i0 - 1; k++) { const a = geo.iso(t.i0 + 0.6 + k, t.j0 + 0.6), b = geo.iso(t.i0 + 0.6 + k, t.j1 - 0.6); linha(g, a[0], a[1], b[0], b[1], t.listras); }
  }
  // terreno da próxima sala (faixas de obra)
  const tr = cena.pontos.terreno;
  if (tr) {
    planoMundo(g, geo, tr.i, tr.j, tr.i + tr.w, tr.j + tr.d, '#4d4a45');
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
      const lados: [number, number][][] = [
        [[tr.i + tr.w * t, tr.j], [tr.i + tr.w * t + 0.12, tr.j]], [[tr.i + tr.w * t, tr.j + tr.d], [tr.i + tr.w * t + 0.12, tr.j + tr.d]],
        [[tr.i, tr.j + tr.d * t], [tr.i, tr.j + tr.d * t + 0.12]], [[tr.i + tr.w, tr.j + tr.d * t], [tr.i + tr.w, tr.j + tr.d * t + 0.12]],
      ];
      for (const [a, b] of lados) { const p = geo.iso(a[0], a[1]), q = geo.iso(b[0], b[1]); ret(g, Math.min(p[0], q[0]) - 1, Math.min(p[1], q[1]), 3, 2, k % 2 ? '#1d1d1d' : '#f2c230'); }
    }
  }
  // borda da laje: o andar flutua sobre a arcologia, com janelas dos andares de baixo
  poli(g, [geo.iso(0, nj), geo.iso(ni, nj), geo.iso(ni, nj, -22), geo.iso(0, nj, -22)], '#1b1f36');
  poli(g, [geo.iso(ni, 0), geo.iso(ni, nj), geo.iso(ni, nj, -22), geo.iso(ni, 0, -22)], '#141729');
  { const a = geo.iso(0, nj), b = geo.iso(ni, nj), cc = geo.iso(ni, 0); linha(g, a[0], a[1], b[0], b[1], '#3ee0ff'); linha(g, b[0], b[1], cc[0], cc[1], '#2bb7d9'); }
  for (let i = 1; i < ni; i += 2) { const p = geo.iso(i, nj, -11); ret(g, p[0] - 2, p[1] - 1, 4, 2, (i * 7) % 5 < 3 ? (noite ? '#ffd36b' : '#6c7aa8') : '#2a2f4a'); }
  for (let j = 1; j < nj; j += 2) { const p = geo.iso(ni, j, -11); ret(g, p[0] - 2, p[1] - 1, 4, 2, (j * 5) % 4 < 2 ? (noite ? '#7fd8ff' : '#56628a') : '#232741'); }
  // marcas de chão: o X da câmera no estúdio e os anéis do Núcleo
  for (const z of cena.zonas) if (z.tema === 'estudio') { const [x, y] = geo.iso(z.i0 + 3.5, z.j0 + 6.5); linha(g, x - 6, y - 3, x + 6, y + 3, '#d9c84a'); linha(g, x - 6, y + 3, x + 6, y - 3, '#d9c84a'); }
  if (cena.zonas.some((z) => z.tema === 'nucleo')) { const [cx, cy] = geo.iso(cena.pontos.nucleo[0], cena.pontos.nucleo[1]); for (const r of [78, 62]) anel(g, cx, cy, r, r / 2, noite ? '#46c9e8' : '#8fb7c8', 220); }
  // linhas de dados
  for (const l of cena.linhas) for (let k = 0; k + 1 < l.pontos.length; k++) {
    const a = geo.iso(l.pontos[k][0], l.pontos[k][1]), b = geo.iso(l.pontos[k + 1][0], l.pontos[k + 1][1]);
    linha(g, a[0], a[1], b[0], b[1], noite ? '#1f7f99' : '#3b6f86');
  }
  // luzes-guia ao longo dos corredores
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    if (mapa.zonaEm(i, j)) continue;
    const inicioV = i > 0 && !!mapa.zonaEm(i - 1, j), inicioH = j > 0 && !!mapa.zonaEm(i, j - 1);
    if (inicioV && j % 2 === 0) { const [x, y] = geo.iso(i + 0.5, j + 0.5); ret(g, x - 1, y, 2, 1, '#3ee0ff'); }
    else if (inicioH && i % 2 === 0) { const [x, y] = geo.iso(i + 0.5, j + 0.5); ret(g, x - 1, y, 2, 1, '#3ee0ff'); }
  }
  // paredes, janelas, decorações e letreiros
  pintarParede(g, geo, mapa, 'J', noite);
  pintarParede(g, geo, mapa, 'I', noite);
  for (const jan of cena.janelas) pintarJanela(g, geo, jan, noite);
  let nSites = 0;
  for (const d of cena.decoracoes) decoracao(g, geo, d, noite, d.tipo === 'sites' ? nSites++ : 0);
  // letreiros com o tubo apagado: a vista põe por cima a versão acesa (que some com a ala em espera)
  for (const L of cena.letreiros) textoParede(g, geo, L.parede, L.texto, L.u, 71, corLetreiroApagado(L.cor));
  return c;
}

/** Cor do letreiro aceso (de noite brilha, de dia fica mais fechado) e apagado (tubo frio). */
export function corLetreiro(cor: string, noite: boolean): string { return noite ? cor : tom(cor, -0.25); }
export function corLetreiroApagado(cor: string): string { return mistura(cor, '#20253c', 0.74); }

/** Retângulo (x, y, w, h) que um letreiro ocupa no mundo. */
export function caixaLetreiro(geo: Geo, parede: 'I' | 'J', texto: string, uCentro: number, vTopo: number, esc = 2): [number, number, number, number] {
  const { pts, largura } = pixelsTexto(texto);
  const larg = largura * esc;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [fx, fy] of pts) for (const [a, b] of [[0, 0], [esc - 1, esc - 1]]) {
    const du = fx * esc + a, dv = fy * esc + b;
    const u = parede === 'J' ? uCentro - larg / 2 + du : uCentro + larg / 2 - du;
    const [x, y] = geo.mapaParede(parede, Math.round(u), vTopo - dv);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1 - x0) + 3, Math.ceil(y1 - y0) + 3];
}

/** Polígonos dos feixes de sol (dia), em coordenadas do mundo: um por janela. */
export function feixesDeSol(cena: CenaDados, geo: Geo): [number, number][][] {
  const out: [number, number][][] = [];
  for (const jan of cena.janelas) {
    const t0 = jan.u0 / 16, t1 = jan.u1 / 16;
    if (jan.parede === 'J') out.push([geo.iso(t0 - 0.2, 0), geo.iso(t1 + 0.2, 0), geo.iso(t1 + 3, 7), geo.iso(t0 + 3, 7)]);
    else out.push([geo.iso(0, t0 - 0.2), geo.iso(0, t1 + 0.2), geo.iso(7, t1 + 3), geo.iso(7, t0 + 3)]);
  }
  return out;
}
