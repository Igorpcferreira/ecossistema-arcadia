// Corte lateral para o celular em pé (estilo Tiny Tower): o mesmo Mundo e a mesma simulação
// da vista isométrica, mostrados como um prédio em corte. Cada zona vira uma sala numa faixa,
// uma em cima da outra, com o poço do elevador à direita (quem anda de uma ala para outra
// passa por ele) e os cabos de dados levando os pulsos até a sala do Núcleo.
import { Container, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Mundo, Pessoa } from '../cena/mundo.ts';
import type { Aparencia, Estado, Pose, Zona } from '../cena/formato.ts';
import { Atlas, type Quadro } from './texturas.ts';
import type { AlvosCamera, Camera } from './camera.ts';
import { TINT_APAGADO, TINT_PISO_ESPERA, TINT_RECARGA, luzLetreiro, mulCor, type OpcoesVista, type Vista } from './vistaIso.ts';
import { cp, mistura, numeroCor, tom, usarPaleta } from '../arte/cor.ts';
import { frenteDe, type Frente } from '../arte/frente.ts';
import type { CtxObjeto, InfoAnim } from '../arte/objetos.ts';
import { DIM, INDICE_POSE, INDICE_ROSTO, POSES, ROSTOS, desenharPersonagem, desenharRosto, dyPose, quadroPose } from '../arte/personagens.ts';
import { desenharBrilho, desenharCarga, desenharDrone, desenharIcone, desenharIconeEsperaAla, desenharMini, desenharTexto, type Carga } from '../arte/efeitos.ts';
import { ICONES } from '../arte/estados.ts';
import { pixelsTexto, pxl, ret, textoPlano, type G } from '../arte/primitivas.ts';

const MARG = 10, RW = 210, GAP = 4, POCO = 26, RH = 90, LAJE = 8, TOPO = 40, PAREDE = 56;
const ESTADOS_ICONE = Object.keys(ICONES) as Estado[];

interface Sala { z: Zona; x: number; y: number }
interface VisObj { o: Mundo['objetos'][number]; f: Frente; base: Sprite; camadas: { s: Sprite; ids: Int32Array; quadro: (o: CtxObjeto, a: InfoAnim) => number; emEspera?: number | 'anima' }[]; x: number; y: number; limiar: number; apagado: boolean; noite: number }
interface VisPessoa { corpo: Sprite; rosto: Sprite | null; icone: Sprite; cabine: Sprite; apIdx: number; olhoIdx: number; androide: boolean; xAnt: number; esp: boolean }

const COR_PISO: Record<string, [string, string]> = {
  corredor: ['#2d334d', '#3a4162'], servidor: ['#1b2032', '#2a3150'], madeira: ['#8a5a36', '#6a4228'], azulejo: ['#37456a', '#4a5a85'],
  estudio: ['#28252f', '#35313f'], carpete: ['#4f566a', '#5c6479'], nucleo: ['#ccd2e0', '#eef1f7'], academia: ['#1c2026', '#2f3644'],
  lounge: ['#b4875a', '#d9b083'], recepcao: ['#c8c0b2', '#e4ded2'], produtos: ['#66635d', '#7a766f'], cockpit: ['#57361f', '#704831'],
  laboratorio: ['#20404a', '#2c5a66'], deposito: ['#474a52', '#5a5e68'],
};
const TEMAS_JANELA = new Set(['equipe', 'corporativo', 'recepcao', 'pessoal', 'laboratorio', 'lounge', 'cockpit', 'produtos', 'academia']);

export class VistaCorte implements Vista {
  readonly m: Mundo;
  readonly r: Renderer;
  readonly op: OpcoesVista;
  readonly atlas: Atlas;
  readonly palco = new Container();
  movimentoReduzido = false;
  private mundoC = new Container();
  private fundo = new Sprite(Texture.EMPTY);
  private pulsosC = new Container();
  private ordenada = new Container();
  private efeitosC = new Container();
  private luzC = new Container();
  /** Luz ambiente da noite, sprite por sprite (olhos, peito e ícones emitem e ficam fora). */
  private corNoite = 0xffffff;
  private apagoes = new Container();
  private salas: Sala[] = [];
  private salaPorZona = new Map<string, Sala>();
  private W = 0; private H = 0;
  private pocoX = 0;
  private objetos: VisObj[] = [];
  private pessoas = new Map<Pessoa, VisPessoa>();
  private versaoVista = -1;
  private noite: boolean | null = null;
  private idsPessoa = new Int32Array(0);
  private apIndice = new Map<string, number>();
  private idsRosto = new Int32Array(0);
  private olhoIndice = new Map<string, number>();
  private idIcone = new Map<Estado, number>();
  private idsDrone = new Map<string, [number, number]>();
  private idsMini = new Map<string, [number, number]>();
  private idCarga = new Map<Carga, number>();
  private idBrilho = new Map<string, number>();
  private idPonto = 0; private idCabine = 0;
  private pool = { pulsos: [] as Sprite[], drones: [] as Sprite[][], minis: [] as Sprite[][], particulas: [] as Sprite[], brilhos: [] as Sprite[] };
  private brilhosFixos: { s: Sprite; x: number; y: number; r: number; int: number; zona: string | null; limiar: number; recarga?: Mundo['objetos'][number] }[] = [];
  private textoEntregas: { digitos: Sprite[]; x: number; y: number } | null = null;
  private idsDigito: number[] = [];
  private apagaoSprites = new Map<string, Sprite>();
  private esperaC = new Container();
  /** Ícones fixos de ala em espera, ao lado do letreiro da sala (sem a tinta da noite). */
  private iconesEsperaC = new Container();
  private idIconeEspera = -1;
  private salasEspera: { id: string; sombra: Sprite; letreiro: Sprite; icone: Sprite; telas: { s: Sprite; limiar: number }[] }[] = [];
  private idsLetreiroOff = new Map<string, number>();
  readonly medidas = { sprites: 0, texturas: 0, atlasMb: 0, atlasOcupacao: 0, quadrosAtlas: 0, estaticoMb: 0, assarMs: 0, assarDesenhoMs: 0, assarAparoMs: 0, assarCopiaMs: 0, estaticoMs: 0 };
  readonly alvos: AlvosCamera;
  get larguraIdeal(): number { return this.W + 6; }

  constructor(m: Mundo, r: Renderer, op: OpcoesVista) {
    this.m = m; this.r = r; this.op = op;
    this.atlas = new Atlas(2048, 1);
    this.salas = m.zonas.map((z, k) => ({ z, x: MARG, y: TOPO + k * (RH + LAJE) }));
    for (const s of this.salas) this.salaPorZona.set(s.z.id, s);
    this.W = MARG + RW + GAP + POCO + MARG;
    this.H = TOPO + this.salas.length * (RH + LAJE) + 30;
    this.pocoX = MARG + RW + GAP;
    this.alvos = {
      alvoZona: (id) => { const s = this.salaPorZona.get(id); return s ? [this.W / 2, s.y + RH / 2] : null; },
      alvoUrgente: () => { const p = m.pessoas.find((a) => a.visivel && a.estado === 'esperando'); return p ? this.posPessoa(p) : null; },
      alvoForcado: () => {
        const f = m.focoForcado;
        if (!f || f.ate <= m.relogio.agora) return null;
        if (f.pessoa) {
          // movimento reduzido: sem seguir quem anda; corta direto para o andar da ala de destino
          const s = this.movimentoReduzido ? this.salaPorZona.get(f.pessoa.zona) : undefined;
          return s ? [this.W / 2, s.y + RH / 2] : [this.W / 2, this.posPessoa(f.pessoa)[1] - 20];
        }
        const [i, j] = m.geo.ladrilho(f.x, f.y + 20); return this.lado(i, j);
      },
      emEspera: (id) => m.emEspera(id),
      limites: (vw, vh) => {
        const minX = vw >= this.W ? this.W / 2 : vw / 2, maxX = vw >= this.W ? this.W / 2 : this.W - vw / 2;
        return { minX, maxX, minY: Math.min(vh / 2 - 10, this.H / 2), maxY: Math.max(this.H - vh / 2 + 10, this.H / 2) };
      },
    };
    this.ordenada.sortableChildren = true;
    this.palco.addChild(this.mundoC);
    for (const c of [this.fundo, this.esperaC, this.pulsosC, this.ordenada, this.efeitosC, this.iconesEsperaC, this.apagoes]) this.mundoC.addChild(c);
    this.palco.addChild(this.luzC);
  }

  /* ---------- geometria do corte ---------- */
  private lado(i: number, j: number): [number, number] {
    const z = this.m.zonaEm(Math.floor(i), Math.floor(j));
    if (!z) {
      // fora de qualquer zona: a sala mais perto
      let melhor: Sala | null = null, d = Infinity;
      for (const s of this.salas) { const cz = s.z; const dd = Math.abs((cz.i0 + cz.i1) / 2 - i) + Math.abs((cz.j0 + cz.j1) / 2 - j); if (dd < d) { d = dd; melhor = s; } }
      return melhor ? [this.pocoX + POCO / 2, melhor.y + RH - 8] : [this.W / 2, this.H / 2];
    }
    return this.ladoNaZona(z, i, j);
  }
  private ladoNaZona(z: Zona, i: number, j: number): [number, number] {
    const s = this.salaPorZona.get(z.id)!;
    const u = Math.max(0, Math.min(1, (i - z.i0) / (z.i1 - z.i0 + 1)));
    const v = Math.max(0, Math.min(1, (j - z.j0) / (z.j1 - z.j0 + 1)));
    return [s.x + 12 + u * (RW - 24), s.y + PAREDE + 4 + v * (RH - PAREDE - 8)];
  }
  /** Posição dos pés de alguém no corte (no poço do elevador quando está no corredor). */
  private posPessoa(p: Pessoa): [number, number] {
    const z = this.m.zonaEm(Math.floor(p.pi), Math.floor(p.pj));
    if (z) { const [x, y] = this.ladoNaZona(z, p.pi, p.pj); return [x, y - p.z * 0.6]; }
    const so = (p.zonaOrigem && this.salaPorZona.get(p.zonaOrigem)) || this.salas[0];
    const sd = (p.zonaDestino && this.salaPorZona.get(p.zonaDestino)) || so;
    const k = p.progresso;
    return [this.pocoX + POCO / 2, so.y + RH - 8 + (sd.y - so.y) * k];
  }

  /* ---------- carga ---------- */
  async preparar(progresso?: (f: number) => Promise<void> | void): Promise<void> {
    const m = this.m, A = this.atlas, tam = this.op.tam;
    const tIni = performance.now();
    usarPaleta(this.op.paleta);
    const passos: (() => void)[] = [];
    const extras: CtxObjeto[] = [{ tipo: 'pod', i: 0, j: 0, props: { nome: m.cena.textos.obra.salaNome } }, { tipo: 'planta', i: 0, j: 0, props: {} }];
    for (const o of [...m.objetos, ...extras]) passos.push(() => this.assarObjeto(o));
    const aps = new Set<string>(m.pessoas.map((p) => p.aparencia)); aps.add(m.cena.textos.obra.agente.aparencia);
    const lista = [...aps].filter((k) => m.cena.aparencias[k]);
    lista.forEach((k, i) => this.apIndice.set(k, i));
    this.idsPessoa = new Int32Array(lista.length * POSES.length * 4 * 2).fill(-1);
    for (const k of lista) passos.push(() => {
      usarPaleta('fria');
      const ap = m.cena.aparencias[k], ai = this.apIndice.get(k)!, { w, h } = DIM[tam];
      POSES.forEach((ps, pi) => { for (let q = 0; q < ps.n; q++) for (let c = 0; c < 2; c++) this.idsPessoa[((ai * POSES.length + pi) * 4 + q) * 2 + c] = A.assar(`p|${k}|${tam}|${this.op.maoFeita}|${ps.pose}|${q}|${c}`, w, h, w / 2, h - 1, (g) => desenharPersonagem(g, ap, ps.pose, q, c === 1, tam, this.op.maoFeita)); });
      usarPaleta(this.op.paleta);
    });
    const olhos = [...new Set(lista.map((k) => m.cena.aparencias[k]).filter((ap): ap is Extract<Aparencia, { tipo: 'androide' }> => ap?.tipo === 'androide').map((ap) => ap.olho ?? '#7ef3ff'))];
    olhos.forEach((o, i) => this.olhoIndice.set(o, i));
    this.idsRosto = new Int32Array(olhos.length * ROSTOS.length).fill(-1);
    passos.push(() => {
      usarPaleta('fria');
      const { w, h } = DIM[tam];
      olhos.forEach((olho, oi) => ROSTOS.forEach((ro, ri) => { this.idsRosto[oi * ROSTOS.length + ri] = A.assar(`r|${olho}|${tam}|${ro}`, w, h, w / 2, h - 1, (g) => desenharRosto(g, { tipo: 'androide', papel: '#888888', olho }, ro, tam)); }));
      for (const e of ESTADOS_ICONE) this.idIcone.set(e, A.assar(`icone|${e}`, 9, 9, 0, 0, (g) => desenharIcone(g, e)));
      this.idIconeEspera = A.assar('icone|esperaAla', 9, 9, 0, 0, (g) => desenharIconeEsperaAla(g));
      const coresDrone = new Set<string>(['#ffb347', '#7dffa8', '#f2b45a', '#f2c230']);
      const coresMini = new Set<string>(['#e0704f']);
      for (const ap of Object.values(m.cena.aparencias)) if (ap.tipo === 'androide') { coresDrone.add(ap.papel); coresMini.add(ap.papel); }
      for (const c of coresDrone) this.idsDrone.set(c, [0, 1].map((q) => A.assar(`drone|${c}|${q}`, 14, 10, 0, 0, (g) => desenharDrone(g, c, q))) as [number, number]);
      for (const c of coresMini) this.idsMini.set(c, [0, 1].map((q) => A.assar(`mini|${c}|${q}`, 12, 12, 0, 0, (g) => desenharMini(g, c, q))) as [number, number]);
      for (const t of ['envelope', 'cubo', 'check'] as Carga[]) this.idCarga.set(t, A.assar(`carga|${t}`, 9, 7, 4, 0, (g) => desenharCarga(g, t)));
      this.idPonto = A.assar('ponto', 1, 1, 0, 0, (g) => ret(g, 0, 0, 1, 1, '#ffffff'));
      const { h: HP } = DIM[tam];
      this.idCabine = A.assar('cabine', POCO - 4, HP + 6, 0, 0, (g) => { ret(g, 0, 0, POCO - 4, 1, '#9ff3ff'); ret(g, 0, HP + 5, POCO - 4, 1, '#9ff3ff'); ret(g, 0, 0, 1, HP + 6, '#3ee0ff'); ret(g, POCO - 5, 0, 1, HP + 6, '#3ee0ff'); });
      usarPaleta(this.op.paleta);
      for (let d = 0; d < 10; d++) this.idsDigito.push(A.assar(`dig|${d}`, 4, 7, 0, 0, (g) => desenharTexto(g, String(d), '#e8fdff')));
      const brilhos = new Set<string>(['#9fb3ff|30', '#ffcf4d|26', '#9ff3ff|34', '#3ee0ff|22']);
      for (const z of m.zonas) brilhos.add(`${z.cor}|36`);
      for (const c of coresDrone) brilhos.add(`${c}|12`);
      for (const o of [...m.objetos, ...extras]) { const f = frenteDe(o.tipo); for (const L of f.luzes?.(o, f.w, f.h) ?? []) brilhos.add(`${L.cor}|${L.r}`); }
      for (const k of brilhos) { const [cor, rs] = k.split('|'); const r = Number(rs); this.idBrilho.set(k, A.assar(`brilho|${k}`, r * 2, r * 2, r, r, (g) => desenharBrilho(g, cp(cor), r))); }
      // letreiro de cada sala apagado (ala em espera), por cima do aceso do fundo
      for (const s of this.salas) {
        const z = s.z, { largura } = pixelsTexto(z.nome), w = largura + 8, h = 11, c = mistura(z.cor, '#20253c', 0.74);
        this.idsLetreiroOff.set(z.id, A.assar(`letreiroSala|${z.id}|off`, w, h, 0, 0, (g) => { ret(g, 0, 0, w, h, '#0c0e1f'); ret(g, 0, 0, w, 1, c); ret(g, 0, h - 1, w, 1, c); textoPlano(g, z.nome, 4, 3, c); }));
      }
    });
    let feito = 0, ultimo = performance.now();
    for (const p of passos) { p(); feito++; if (progresso && performance.now() - ultimo > 100) { ultimo = performance.now(); await progresso(feito / passos.length); } }
    usarPaleta(this.op.paleta);
    A.finalizar();
    const uso = A.uso();
    Object.assign(this.medidas, { atlasMb: uso.mb, atlasOcupacao: uso.ocupacao, quadrosAtlas: uso.quadros, assarMs: performance.now() - tIni, assarDesenhoMs: A.tempos.desenho, assarAparoMs: A.tempos.aparar, assarCopiaMs: A.tempos.copia });
    this.montarFixos();
  }

  private assarObjeto(o: CtxObjeto): void {
    const f = frenteDe(o.tipo);
    const W = f.w + 16, H = f.h + 40, ox = 8 + f.w / 2, oy = H - 8;
    const desenhar = (fn: (g: G) => void) => (g: G) => { g.translate(8, H - 8 - f.h); fn(g); };
    this.atlas.assar(`f|${o.tipo}|${f.varianteBase?.(o) ?? ''}`, W, H, ox, oy, desenhar((g) => f.desenho(g, o, f.w, f.h)));
    for (const c of f.camadas ?? []) {
      const vk = `fa|${o.tipo}|${c.nome}|${c.variante?.(o) ?? ''}`;
      const n = c.n(o);
      for (let k = 0; k < n; k++) this.atlas.assar(`${vk}|${k}`, W, H, ox, oy, desenhar((g) => c.desenhar(g, k, o, f.w, f.h)));
    }
  }

  private q(id: number): Quadro { return this.atlas.quadro(id); }
  private spr(id: number, pai: Container): Sprite { const s = new Sprite(this.q(id).tex); s.roundPixels = true; pai.addChild(s); return s; }

  private montarFixos(): void {
    const nuc = this.salas.find((s) => s.z.tema === 'nucleo');
    if (nuc) this.textoEntregas = { digitos: [0, 1, 2, 3].map(() => this.spr(this.idsDigito[0], this.efeitosC)), x: nuc.x + RW / 2 + 22, y: nuc.y + 10 };
    // meia-luz fria e letreiro apagado das alas em espera
    for (const s of this.salas) {
      if (s.z.tipo !== 'ala') continue;
      const sombra = new Sprite(Texture.WHITE); sombra.blendMode = 'multiply'; sombra.tint = TINT_PISO_ESPERA; sombra.position.set(s.x, s.y); sombra.width = RW; sombra.height = RH; sombra.visible = false;
      this.esperaC.addChild(sombra);
      const id = this.idsLetreiroOff.get(s.z.id)!;
      const letreiro = this.spr(id, this.esperaC); const fr = this.q(id); letreiro.position.set(s.x + 6 + fr.dx, s.y + 6 + fr.dy); letreiro.visible = false;
      // ícone fixo de stand-by logo depois do letreiro
      const icone = this.spr(this.idIconeEspera, this.iconesEsperaC); icone.position.set(letreiro.x + fr.w + 2, letreiro.y + Math.round((fr.h - 9) / 2)); icone.visible = false;
      // telas de site da parede (tema de agência): desligam com a ala em espera
      const telas: { s: Sprite; limiar: number }[] = [];
      if (s.z.tema === 'agencia') for (let k = 0; k < 4; k++) {
        const t = new Sprite(Texture.WHITE); t.tint = 0x070912; t.alpha = 0.92; t.visible = false;
        const x = s.x + 72 + k * 34 + 2; t.position.set(x, s.y + 12); t.width = 24; t.height = 20;
        this.esperaC.addChild(t); telas.push({ s: t, limiar: this.limiarX(s.z.id, x) });
      }
      this.salasEspera.push({ id: s.z.id, sombra, letreiro, icone, telas });
    }
  }

  /** Em que ponto do acordar (0 a 1) um ponto da sala acende: do lado do poço (a porta) para dentro. */
  private limiarX(zona: string | null, x: number): number {
    const s = zona ? this.salaPorZona.get(zona) : null;
    if (!s) return 0;
    return 0.08 + 0.7 * Math.max(0, Math.min(1, 1 - (x - s.x) / RW));
  }

  private montarBrilhos(): void {
    for (const b of this.brilhosFixos) b.s.destroy();
    this.brilhosFixos = [];
    const add = (cor: string, r: number, x: number, y: number, int: number, zona: string | null, limiar: number, recarga?: Mundo['objetos'][number]) => {
      const id = this.idBrilho.get(`${cor}|${r}`); if (id === undefined) return;
      const s = this.spr(id, this.luzC); s.blendMode = 'add';
      const fr = this.q(id); s.position.set(Math.round(x) + fr.dx, Math.round(y) + fr.dy);
      this.brilhosFixos.push({ s, x, y, r, int, zona, limiar, recarga });
    };
    for (const s of this.salas) {
      add('#9fb3ff', 30, s.x + RW * 0.25, s.y + 6, 0.35, s.z.id, this.limiarX(s.z.id, s.x + RW * 0.25)); add('#9fb3ff', 30, s.x + RW * 0.75, s.y + 6, 0.35, s.z.id, this.limiarX(s.z.id, s.x + RW * 0.75));
      add(s.z.cor, 36, s.x + 30, s.y + 14, 0.4, s.z.id, 0.86);
    }
    for (const v of this.objetos) for (const L of v.f.luzes?.(v.o, v.f.w, v.f.h) ?? []) add(L.cor, L.r, v.x - v.f.w / 2 + L.x, v.y - v.f.h + L.y, L.int, v.o.zona, v.limiar, v.o.tipo === 'recarga' ? v.o : undefined);
  }

  /** Fundo do prédio em corte: céu, salas, janelas, pisos, lajes, poço e letreiros. */
  definirNoite(noite: boolean): void {
    if (this.noite === noite) return;
    this.noite = noite;
    usarPaleta(this.op.paleta);
    const t0 = performance.now();
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const g = c.getContext('2d')!;
    // céu
    for (let y = 0; y < this.H; y += 2) ret(g, 0, y, this.W, 2, noite ? mistura('#0a0e2c', '#05060f', y / this.H) : mistura('#74c0ee', '#d6f1fb', y / this.H));
    if (noite) for (let k = 0; k < 120; k++) pxl(g, (k * 977) % this.W, (k * 613) % this.H, k % 3 ? '#5a6290' : '#e8ecff');
    // estrutura do prédio
    ret(g, MARG - 4, TOPO - 10, RW + GAP + POCO + 8, this.H - TOPO, '#141729');
    ret(g, MARG - 6, TOPO - 14, RW + GAP + POCO + 12, 4, '#3a4162');
    textoPlano(g, 'ARCADIA', this.W / 2 - 13, TOPO - 24, noite ? '#3ee0ff' : '#2a6f86');
    for (const s of this.salas) this.pintarSala(g, s, noite);
    // poço do elevador e cabos de dados
    ret(g, this.pocoX, TOPO - 6, POCO, this.H - TOPO - 20, noite ? '#0c1024' : '#26304e');
    ret(g, this.pocoX, TOPO - 6, 1, this.H - TOPO - 20, '#3a4162'); ret(g, this.pocoX + POCO - 1, TOPO - 6, 1, this.H - TOPO - 20, '#3a4162');
    for (let k = 0; k < 3; k++) ret(g, this.pocoX + 4 + k * 3, TOPO - 6, 1, this.H - TOPO - 20, noite ? '#1f7f99' : '#3b6f86');
    for (let y = TOPO; y < this.H - 30; y += 12) ret(g, this.pocoX + 14, y, 8, 1, noite ? '#3ee0ff' : '#5f86ad');
    const antiga = this.fundo.texture;
    const tex = Texture.from(c); tex.source.scaleMode = 'nearest';
    this.fundo.texture = tex;
    if (antiga && antiga !== Texture.EMPTY) antiga.destroy(true);
    this.medidas.estaticoMb = (c.width * c.height * 4) / 1048576;
    this.medidas.estaticoMs = performance.now() - t0;
    this.corNoite = noite ? numeroCor(cp('#4b5592')) : 0xffffff;
    for (const c of [this.fundo, this.pulsosC, this.efeitosC, this.apagoes]) c.tint = this.corNoite;
    for (const se of this.salasEspera) { se.letreiro.tint = this.corNoite; for (const tl of se.telas) tl.s.tint = this.corNoite; }
    this.r.background.color = noite ? mulCor(0x05060f, this.corNoite) : 0x9fd3ef;
  }

  private pintarSala(g: G, s: Sala, noite: boolean): void {
    const z = s.z, x = s.x, y = s.y;
    const parede = z.parede ?? '#2f3550';
    ret(g, x, y, RW, PAREDE, parede);
    ret(g, x, y, RW, 2, tom(parede, -0.4));
    for (let u = 16; u < RW; u += 32) ret(g, x + u, y + 4, 1, PAREDE - 6, tom(parede, -0.2));
    ret(g, x, y + PAREDE - 4, RW, 4, tom(parede, -0.35));
    // janela para a cidade
    if (TEMAS_JANELA.has(z.tema)) {
      const jx = x + 70, jw = RW - 84, jy = y + 8, jh = 30;
      ret(g, jx - 2, jy - 2, jw + 4, jh + 4, '#181b2c');
      for (let u = 0; u < jw; u++) {
        const ub = u * 3 + z.i0 * 41 + z.j0 * 17;
        const alt = 6 + (((ub * 7) % 23) + ((Math.floor(ub / 9) * 13) % 11));
        for (let v = 0; v < jh; v++) {
          const h = jh - v;
          let c: string;
          if (h < alt) { const lit = (u % 3 === 1) && (h % 4 === 2) && ((u * 7 + h * 13) % 5 < 3); c = noite ? (lit ? ((u % 7) < 5 ? '#ffd36b' : '#7fd8ff') : '#14172e') : (lit ? '#c6d8ef' : '#5d6f96'); }
          else c = noite ? (((u * 37 + v * 91) % 97) === 0 ? '#e8ecff' : mistura('#2b2160', '#0a0e2c', v / jh)) : mistura('#d6f1fb', '#74c0ee', v / jh);
          pxl(g, jx + u, jy + v, c);
        }
      }
      for (let u = 0; u < jw; u += 34) ret(g, jx + u, jy, 2, jh, '#181b2c');
    }
    if (z.tema === 'estudio') for (let u = 70; u < RW - 4; u += 4) for (let v = 6; v < PAREDE - 6; v += 4) if (((u + v) / 4) % 2 < 1) ret(g, x + u, y + v, 4, 4, '#353042');
    if (z.tema === 'agencia') for (const [k, cor] of [[0, '#f4f1ea'], [1, '#101418'], [2, '#eef7f1'], [3, '#fff8ef']] as const) { const sx = x + 72 + k * 34; ret(g, sx, y + 10, 28, 24, '#0f121f'); ret(g, sx + 2, y + 12, 24, 20, cor); ret(g, sx + 2, y + 12, 24, 3, ['#1d2b4f', '#b0122a', '#1f7a4d', '#5b2a86'][k]); ret(g, sx + 5, y + 20, 10, 6, ['#c98a5a', '#3a3f48', '#7cc49a', '#e2a3c7'][k]); }
    // letreiro da sala
    const { largura } = pixelsTexto(z.nome);
    ret(g, x + 6, y + 6, largura + 8, 11, '#0c0e1f');
    ret(g, x + 6, y + 6, largura + 8, 1, z.cor); ret(g, x + 6, y + 16, largura + 8, 1, z.cor);
    textoPlano(g, z.nome, x + 10, y + 9, noite ? z.cor : tom(z.cor, -0.25));
    // luz do teto
    ret(g, x + 4, y + 2, RW - 8, 1, noite ? '#9fb3ff' : '#c9d2ff');
    // piso
    const [pa, pb] = COR_PISO[z.piso] ?? COR_PISO.corredor;
    ret(g, x, y + PAREDE, RW, RH - PAREDE, pa);
    for (let v = y + PAREDE + 6; v < y + RH; v += 7) ret(g, x, v, RW, 1, tom(pa, -0.15));
    for (let u = 0; u < RW; u += 24) ret(g, x + u + ((Math.floor(u / 24) % 2) * 12), y + PAREDE, 1, RH - PAREDE, tom(pa, -0.1));
    ret(g, x, y + PAREDE, RW, 1, pb);
    // laje embaixo, com janelas dos andares de baixo
    ret(g, x - 4, y + RH, RW + 8, LAJE, '#1b1f36');
    for (let u = 8; u < RW; u += 14) ret(g, x + u, y + RH + 3, 4, 2, (u * 7) % 5 < 3 ? (noite ? '#ffd36b' : '#6c7aa8') : '#2a2f4a');
  }

  private sincronizar(): void {
    const m = this.m;
    for (let k = this.objetos.length; k < m.objetos.length; k++) {
      const o = m.objetos[k];
      const f = frenteDe(o.tipo);
      const z = o.zona ? m.zonaPorId.get(o.zona) : null;
      const [x, y] = z ? this.ladoNaZona(z, o.i + o.w / 2, o.j + o.d) : [-999, -999];
      const idBase = this.atlas.idDe(`f|${o.tipo}|${f.varianteBase?.(o) ?? ''}`);
      const fr = idBase !== undefined ? this.q(idBase) : { tex: Texture.EMPTY, dx: 0, dy: 0, w: 0, h: 0 };
      const ax = Math.round(x), ay = Math.round(y);
      const base = new Sprite(fr.tex); base.roundPixels = true; base.position.set(ax + fr.dx, ay + fr.dy); base.zIndex = ay - (f.h < 8 ? 40 : 0) - (f.fundo ? 6 : 0);
      base.visible = !!z;
      this.ordenada.addChild(base);
      const vis: VisObj = { o, f, base, camadas: [], x: ax, y: ay, limiar: this.limiarX(o.zona, ax), apagado: false, noite: -1 };
      (f.camadas ?? []).forEach((c, ci) => {
        const vk = `fa|${o.tipo}|${c.nome}|${c.variante?.(o) ?? ''}`;
        const n = c.n(o); const ids = new Int32Array(n);
        for (let q = 0; q < n; q++) ids[q] = this.atlas.idDe(`${vk}|${q}`) ?? -1;
        const s = new Sprite(Texture.EMPTY); s.roundPixels = true; s.zIndex = base.zIndex + 1e-3 * (ci + 1); s.visible = false;
        this.ordenada.addChild(s);
        vis.camadas.push({ s, ids, quadro: c.quadro, emEspera: c.emEspera });
      });
      this.objetos.push(vis);
    }
    for (const p of m.pessoas) {
      if (this.pessoas.has(p)) continue;
      const ap = p.ap, androide = ap?.tipo === 'androide';
      const corpo = new Sprite(Texture.EMPTY); corpo.roundPixels = true;
      const rosto = androide ? new Sprite(Texture.EMPTY) : null;
      const icone = new Sprite(Texture.EMPTY);
      const cabine = new Sprite(this.q(this.idCabine).tex); cabine.visible = false; cabine.alpha = 0.8;
      for (const s of [corpo, rosto, icone, cabine]) if (s) this.ordenada.addChild(s);
      this.pessoas.set(p, { corpo, rosto, icone, cabine, apIdx: this.apIndice.get(p.aparencia) ?? 0, olhoIdx: androide ? (this.olhoIndice.get((ap as { olho?: string }).olho ?? '#7ef3ff') ?? 0) : 0, androide, xAnt: NaN, esp: false });
    }
    this.montarBrilhos();
    this.versaoVista = m.versao;
  }

  desenhar(cam: Camera, _dt: number): void {
    const m = this.m, t = m.tAnim, noite = !!this.noite, tam = this.op.tam;
    if (m.versao !== this.versaoVista) this.sincronizar();
    const [x0, y0] = cam.origem();
    const vw = cam.vw, vh = cam.vh;
    this.mundoC.position.set(-x0, -y0);
    this.luzC.position.set(-x0, -y0);
    let n = 1;
    // alas em espera: meia-luz fria na sala e letreiro apagado (respirando devagar)
    const forca = noite ? 0.62 : 0.46;
    for (const se of this.salasEspera) {
      const e = m.estadoZona.get(se.id); if (!e) continue;
      const k = 1 - e.nivel, a = forca * k * k * (3 - 2 * k) * (1 - 0.45 * e.presenca);
      se.sombra.visible = a > 0.01; if (se.sombra.visible) { se.sombra.alpha = a; n++; }
      const apagado = 1 - luzLetreiro(e.nivel, e.espera, t, this.movimentoReduzido);
      se.letreiro.visible = apagado > 0.02; if (se.letreiro.visible) { se.letreiro.alpha = apagado; n++; }
      se.icone.visible = e.espera; if (e.espera) n++;
      for (const tl of se.telas) { tl.s.visible = e.nivel < tl.limiar; if (tl.s.visible) n++; }
    }
    const info: InfoAnim = { t, ativo: null, presente: false, usada: false, erro: m.global.erroAte > m.relogio.agora, faseRack: m.global.faseRack, noite };
    for (const v of this.objetos) {
      const dentro = v.base.visible && v.y - y0 > -20 && v.y - v.f.h - y0 < vh + 20;
      if (dentro) n++;
      const apagado = v.o.zona !== null && m.nivelZona(v.o.zona) < v.limiar;
      if (apagado !== v.apagado || v.noite !== this.corNoite) {
        v.apagado = apagado; v.noite = this.corNoite;
        const escuro = mulCor(TINT_APAGADO, this.corNoite);
        v.base.tint = apagado ? escuro : this.corNoite;
        for (const c of v.camadas) c.s.tint = apagado && typeof c.emEspera === 'number' ? escuro : this.corNoite;
      }
      if (!v.camadas.length) continue;
      if (!dentro) { for (const c of v.camadas) c.s.visible = false; continue; }
      this.infoObjeto(v.o, info);
      for (const c of v.camadas) {
        const k = apagado && c.emEspera !== 'anima' ? (c.emEspera ?? -1) : c.quadro(v.o, info);
        if (k < 0 || k >= c.ids.length || c.ids[k] < 0) { c.s.visible = false; continue; }
        const fr = this.q(c.ids[k]);
        if (c.s.texture !== fr.tex) { c.s.texture = fr.tex; c.s.position.set(v.x + fr.dx, v.y + fr.dy); }
        c.s.visible = fr.w > 0; if (fr.w > 0) n++;
      }
    }
    // pessoas
    const { h: Hs } = DIM[tam];
    for (const [p, v] of this.pessoas) {
      if (!p.visivel) { v.corpo.visible = false; if (v.rosto) v.rosto.visible = false; v.icone.visible = false; v.cabine.visible = false; continue; }
      const [fx, fy] = this.posPessoa(p);
      const noPoco = !this.m.zonaEm(Math.floor(p.pi), Math.floor(p.pj));
      const dentro = fy - y0 > -10 && fy - Hs - y0 < vh + 10;
      if (!dentro) { v.corpo.visible = false; if (v.rosto) v.rosto.visible = false; v.icone.visible = false; v.cabine.visible = false; continue; }
      const dx = Number.isNaN(v.xAnt) ? 0 : fx - v.xAnt; v.xAnt = fx;
      if (Math.abs(dx) > 0.05) v.esp = dx < 0;
      const andando = p.andando;
      const pose: Pose = andando ? 'andar' : p.pose;
      const nq = POSES[INDICE_POSE[pose]].n;
      const q = Math.min(nq - 1, quadroPose(pose, p.t, andando));
      const costas = andando ? false : p.costas;
      const esp = andando ? v.esp : p.espelho;
      const fr = this.q(this.idsPessoa[((v.apIdx * POSES.length + INDICE_POSE[pose]) * 4 + q) * 2 + (costas ? 1 : 0)]);
      const ax = Math.round(fx), ay = Math.round(fy);
      this.colocar(v.corpo, fr, ax, ay, esp);
      const z = ay + 0.5;
      v.corpo.zIndex = z; v.corpo.alpha = p.alpha; v.corpo.visible = true; n++;
      const dormente = p.naRecarga || (p.def.papel === 'figurante' && v.androide && m.emEspera(p.zona));
      const tint = dormente ? mulCor(TINT_RECARGA, this.corNoite) : this.corNoite;
      if (v.corpo.tint !== tint) v.corpo.tint = tint;
      if (v.cabine.tint !== this.corNoite) v.cabine.tint = this.corNoite;
      if (v.rosto) {
        if (costas) v.rosto.visible = false;
        else {
          let ro: string = p.estado;
          // na cápsula, a luz do peito pisca devagar; com movimento reduzido, fica acesa
          if (dormente) ro = this.movimentoReduzido || Math.floor(t / 1.6 + p.pi * 0.37) % 2 ? 'recargaLuz' : 'recarga';
          else if (ro === 'ocioso' && (p.t % 4.1) > 3.95) ro = 'piscar';
          const frR = this.q(this.idsRosto[v.olhoIdx * ROSTOS.length + (INDICE_ROSTO[ro] ?? 0)]);
          this.colocar(v.rosto, frR, ax, ay + dyPose(pose, q, tam), esp);
          v.rosto.zIndex = z + 1e-4; v.rosto.alpha = p.alpha; v.rosto.visible = true; n++;
        }
      }
      if (v.androide && !dormente && p.estado !== 'ocioso' && this.idIcone.has(p.estado)) {
        v.icone.texture = this.q(this.idIcone.get(p.estado)!).tex;
        v.icone.position.set(ax - 4, ay - Hs - 10 + (pose === 'digitando' ? 4 : 0) + (this.movimentoReduzido ? 0 : Math.round(Math.sin(t * 3 + p.pi))));
        v.icone.zIndex = z + 2e-4; v.icone.visible = true; n++;
      } else v.icone.visible = false;
      v.cabine.visible = noPoco;
      if (noPoco) { v.cabine.position.set(this.pocoX + 2, ay - Hs - 3); v.cabine.zIndex = z + 3e-4; n++; }
    }
    n += this.atualizarEfeitos(t, y0, vh);
    this.atualizarTexto();
    n += this.atualizarLuz(t, x0, y0, vw, vh, noite);
    this.medidas.sprites = n;
    this.r.render(this.palco);
  }

  private infoObjeto(o: Mundo['objetos'][number], info: InfoAnim): void {
    info.ativo = null; info.presente = false; info.usada = false;
    if (o.tipo === 'recarga') { info.presente = !!(o.dono && this.m.porId.get(o.dono)?.naRecarga); return; }
    if (o.dono) { const p = this.m.porId.get(o.dono); if (p && p.visivel && p.emCasa) { info.presente = true; if (!['ocioso', 'dormindo', 'semSinal', 'limite'].includes(p.estado)) info.ativo = p.estado; } }
    else if (o.tipo === 'mesaComando' || o.tipo === 'mesaNotebook') info.presente = !!this.m.pessoas.find((x) => x.def.papel === (o.tipo === 'mesaComando' ? 'dono' : 'fixo'))?.emCasa;
    if (o.tipo === 'esteira' || o.tipo === 'bike') info.usada = this.m.pessoas.some((p) => !p.andando && p.pose === 'correr' && Math.floor(p.pi) >= o.i && Math.floor(p.pi) < o.i + o.w && Math.floor(p.pj) >= o.j && Math.floor(p.pj) < o.j + o.d);
    if (o.tipo === 'camera') info.usada = this.m.global.onAir;
    if (o.zona && this.m.global.apagao.has(o.zona)) { info.ativo = null; info.presente = false; }
  }

  private colocar(s: Sprite, fr: Quadro, ax: number, ay: number, espelho: boolean): void {
    if (s.texture !== fr.tex) s.texture = fr.tex;
    if (espelho) { s.scale.x = -1; s.position.set(ax - fr.dx, ay + fr.dy); } else { s.scale.x = 1; s.position.set(ax + fr.dx, ay + fr.dy); }
  }

  /** Converte um ponto do mundo isométrico (efeitos da simulação) para o corte. */
  private doIso(x: number, y: number, alt: number): [number, number] {
    const [i, j] = this.m.geo.ladrilho(x, y + alt);
    const [sx, sy] = this.lado(i, j);
    return [sx, sy - alt * 0.7];
  }

  private atualizarEfeitos(t: number, y0: number, vh: number): number {
    const m = this.m;
    let n = 0;
    // pulsos pelos cabos do poço até a sala do Núcleo
    const nuc = this.salas.find((s) => s.z.tema === 'nucleo');
    let k = 0;
    for (const p of m.pulsos) {
      if (p.s < 0 || !nuc) continue;
      const so = this.salaPorZona.get(p.zona); if (!so) continue;
      const f = Math.min(1, p.s / p.total);
      const y = so.y + RH / 2 + (nuc.y + RH / 2 - so.y - RH / 2) * f;
      const lane = (this.salas.indexOf(so) % 3) * 3;
      const s = this.pool.pulsos[k] ?? (this.pool.pulsos[k] = this.spr(this.idPonto, this.efeitosC));
      s.tint = numeroCor(p.cor); s.scale.set(1, 3); s.position.set(this.pocoX + 4 + lane, Math.round(y)); s.visible = true; k++;
    }
    for (let j = k; j < this.pool.pulsos.length; j++) this.pool.pulsos[j].visible = false;
    n += k;
    // drones
    k = 0;
    for (const d of m.drones) {
      const [x, y] = this.doIso(d.x, d.y, 0);
      const yy = y - 26 - (d.z - 30) * 0.5;
      const v = this.pool.drones[k] ?? (this.pool.drones[k] = [this.spr(this.idPonto, this.efeitosC), this.spr(this.idPonto, this.efeitosC)]);
      const ids = this.idsDrone.get(d.cor) ?? this.idsDrone.get('#ffb347')!;
      v[0].texture = this.q(ids[Math.floor(t * 16) % 2]).tex; v[0].position.set(Math.round(x - 7), Math.round(yy - 6)); v[0].visible = true;
      const idc = this.idCarga.get(d.carga);
      if (idc !== undefined) { const fr = this.q(idc); v[1].texture = fr.tex; v[1].position.set(Math.round(x) + fr.dx, Math.round(yy + 6)); v[1].visible = true; } else v[1].visible = false;
      k++;
    }
    for (let j = k; j < this.pool.drones.length; j++) { this.pool.drones[j][0].visible = false; this.pool.drones[j][1].visible = false; }
    n += k * 2;
    // minidrones
    k = 0;
    for (const mi of m.minis) {
      const [x, y] = this.doIso(mi.x, mi.y, 30);
      const v = this.pool.minis[k] ?? (this.pool.minis[k] = [this.spr(this.idPonto, this.efeitosC), this.spr(this.idIcone.get('lendo')!, this.efeitosC)]);
      const ids = this.idsMini.get(mi.cor) ?? this.idsMini.values().next().value!;
      v[0].texture = this.q(ids[Math.floor(t * 12) % 2]).tex; v[0].position.set(Math.round(x + 8), Math.round(y - 10 + (this.movimentoReduzido ? 0 : Math.sin(t * 4) * 2)));
      v[1].position.set(Math.round(x + 9), Math.round(y - 22)); v[0].visible = v[1].visible = true; k++;
    }
    for (let j = k; j < this.pool.minis.length; j++) { this.pool.minis[j][0].visible = false; this.pool.minis[j][1].visible = false; }
    n += k * 2;
    // partículas
    k = 0;
    for (const p of m.particulas) {
      if (k >= this.op.preset.maxParticulas) break;
      const [x, y] = this.doIso(p.x, p.y, 30);
      if (y - y0 < -10 || y - y0 > vh + 10) continue;
      const s = this.pool.particulas[k] ?? (this.pool.particulas[k] = this.spr(this.idPonto, this.efeitosC));
      s.alpha = Math.min(1, Math.max(0, p.vida / p.max) * 1.5); s.tint = numeroCor(p.cor); s.scale.set(p.tipo === 'px' ? p.tam : 2);
      s.position.set(Math.round(x), Math.round(y)); s.visible = true; k++;
    }
    for (let j = k; j < this.pool.particulas.length; j++) this.pool.particulas[j].visible = false;
    n += k;
    // apagão (limite de uso)
    for (const [zid, ate] of m.global.apagao) {
      const s0 = this.salaPorZona.get(zid); if (!s0) continue;
      let s = this.apagaoSprites.get(zid);
      if (!s) { s = new Sprite(Texture.WHITE); s.tint = 0x05060f; s.position.set(s0.x, s0.y); s.width = RW; s.height = RH; this.apagoes.addChild(s); this.apagaoSprites.set(zid, s); }
      s.alpha = Math.min(0.55, (ate - m.relogio.agora) * 0.5); s.visible = true;
    }
    for (const [zid, s] of this.apagaoSprites) if (!m.global.apagao.has(zid)) s.visible = false;
    return n;
  }

  private atualizarTexto(): void {
    const te = this.textoEntregas; if (!te) return;
    const txt = String(this.m.global.entregas).slice(-4);
    te.digitos.forEach((s, k) => { if (k >= txt.length) { s.visible = false; return; } s.texture = this.q(this.idsDigito[Number(txt[k])]).tex; s.position.set(te.x + k * 4, te.y); s.visible = true; });
  }

  private atualizarLuz(t: number, _x0: number, y0: number, _vw: number, vh: number, noite: boolean): number {
    if (!noite) { for (const b of this.brilhosFixos) b.s.visible = false; for (const s of this.pool.brilhos) s.visible = false; return 0; }
    const m = this.m;
    const vis: { s: Sprite; int: number }[] = [];
    for (const b of this.brilhosFixos) {
      b.s.visible = false;
      let int = b.int;
      if (b.recarga) {
        const dono = b.recarga.dono ? m.porId.get(b.recarga.dono) : undefined;
        int = dono?.naRecarga ? (this.movimentoReduzido ? 0.2 : 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.3 + b.x))) : 0.05;
      } else if (b.zona && m.nivelZona(b.zona) < b.limiar) int = 0;
      if (b.zona && m.global.apagao.has(b.zona)) int *= 0.15;
      if (b.y - y0 < -b.r || b.y - y0 > vh + b.r || int <= 0) continue;
      b.s.alpha = int; vis.push({ s: b.s, int });
    }
    const max = this.op.preset.maxBrilhos;
    if (vis.length > max) vis.sort((a, b) => b.int - a.int);
    let n = 0;
    for (let k = 0; k < vis.length && k < max; k++) { vis[k].s.visible = true; n++; }
    let k = 0;
    const usar = (chave: string, x: number, y: number, alpha: number) => {
      const id = this.idBrilho.get(chave); if (id === undefined) return;
      const s = this.pool.brilhos[k] ?? (this.pool.brilhos[k] = (() => { const sp = this.spr(id, this.luzC); sp.blendMode = 'add'; return sp; })());
      const fr = this.q(id); s.texture = fr.tex; s.position.set(Math.round(x) + fr.dx, Math.round(y) + fr.dy); s.alpha = alpha; s.visible = true; k++;
    };
    for (const p of m.pessoas) if (p.visivel && p.estado === 'esperando') { const [x, y] = this.posPessoa(p); usar('#ffcf4d|26', x, y - 4, this.movimentoReduzido ? 0.7 : 0.6 + Math.abs(Math.sin(t * 4)) * 0.2); }
    for (let j = k; j < this.pool.brilhos.length; j++) this.pool.brilhos[j].visible = false;
    return n + k;
  }

  pontoBalao(p: Pessoa): [number, number] | null {
    if (!p.visivel) return null;
    const [x, y] = this.posPessoa(p);
    return [x, y - DIM[this.op.tam].h - 12];
  }

  tocar(x: number, y: number): { pessoa?: Pessoa; zona?: string } | null {
    const { w: W, h: H } = DIM[this.op.tam];
    for (const p of this.m.pessoas) { if (!p.visivel) continue; const [fx, fy] = this.posPessoa(p); if (x >= fx - W / 2 && x <= fx + W / 2 && y >= fy - H && y <= fy + 1) return { pessoa: p }; }
    const s = this.salas.find((s0) => x >= s0.x && x <= s0.x + RW && y >= s0.y && y <= s0.y + RH);
    return s ? { zona: s.z.id } : null;
  }

  destruir(): void { this.palco.destroy({ children: true }); this.atlas.destruir(); }
}

