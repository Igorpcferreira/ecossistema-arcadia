// Vista isométrica em PixiJS: monta a cena (camadas, ordenação por profundidade, luz) a partir
// do Mundo e só troca texturas e posições a cada quadro. Tudo o que é desenhado vem do atlas,
// assado na carga com chaves numéricas.
// Ala em espera: meia-luz fria no piso e na parede (multiplicação), mobília escurecida (tint),
// hologramas, telas e LEDs desligados, letreiro apagado respirando devagar e brilhos apagados.
// Ao acordar, tudo acende em sequência a partir da porta da ala (limiar de cada objeto).
import { Container, Matrix, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Mundo, ObjRT, Pessoa } from '../cena/mundo.ts';
import { pontoNaLinha } from '../cena/mundo.ts';
import type { Aparencia, Estado, Pose } from '../cena/formato.ts';
import { Atlas, type Quadro } from './texturas.ts';
import type { Camera, AlvosCamera } from './camera.ts';
import type { Preset } from '../qualidade/presets.ts';
import { cp, mistura, numeroCor, paletaAtual, usarPaleta, type NomePaleta } from '../arte/cor.ts';
import { caixaLetreiro, construirEstatico, corLetreiro, feixesDeSol, textoParede } from '../arte/estatico.ts';
import { tipoDe, type CtxObjeto, type InfoAnim } from '../arte/objetos.ts';
import { DIM, INDICE_POSE, INDICE_ROSTO, POSES, ROSTOS, desenharPersonagem, desenharRosto, dyPose, quadroPose, type PasseMao, type Tam } from '../arte/personagens.ts';
import {
  desenharBrilho, desenharCarga, desenharCarroJanela, desenharCoracao, desenharDrone, desenharIcone, desenharIconeEsperaAla, desenharMini, desenharNuvem,
  desenharPlaca, desenharPulso, desenharSombra, desenharTexto, larguraTexto, placaPlana, type Carga,
} from '../arte/efeitos.ts';
import { CORES_ESTADO, ICONES } from '../arte/estados.ts';
import { linha, pxl, ret } from '../arte/primitivas.ts';

export interface OpcoesVista { tam: Tam; maoFeita: PasseMao; paleta: NomePaleta; preset: Preset }

export interface Vista {
  readonly alvos: AlvosCamera;
  /** Largura de arte que a vista quer caber na tela (o corte lateral pede o prédio inteiro). */
  readonly larguraIdeal?: number;
  readonly medidas: { sprites: number; texturas: number; atlasMb: number; atlasOcupacao: number; quadrosAtlas: number; estaticoMb: number; assarMs: number; assarDesenhoMs: number; assarAparoMs: number; assarCopiaMs: number; estaticoMs: number };
  preparar(progresso?: (f: number) => Promise<void> | void): Promise<void>;
  definirNoite(noite: boolean): void;
  desenhar(cam: Camera, dt: number): void;
  /** Movimento reduzido: sem piscadas nem balanço (quem liga é criarMundo). */
  movimentoReduzido: boolean;
  /** Âncora do balão de alguém, em pixels de arte do mundo da vista (ou null). */
  pontoBalao(p: Pessoa): [number, number] | null;
  /** Quem ou que zona está sob um ponto da tela (pixels de arte da vista). */
  tocar(x: number, y: number): { pessoa?: Pessoa; zona?: string } | null;
  destruir(): void;
}

const PADO = 28;
const ESTADOS_ICONE = Object.keys(ICONES) as Estado[];
const CORES_PARTICULA_PADRAO = 0xffffff;
/** Cores da meia-luz fria (multiplicam): mobília apagada, piso e quem dorme na cápsula. */
export const TINT_APAGADO = 0x8d97c6, TINT_PISO_ESPERA = 0x5d6ba6, TINT_RECARGA = 0xaab3dc;

interface VisCamada { s: Sprite; ids: Int32Array; quadro: (o: CtxObjeto, a: InfoAnim) => number; emEspera?: number | 'anima' }
interface VisObj { o: ObjRT; ax: number; ay: number; base: Sprite; camadas: VisCamada[]; ret: [number, number, number, number]; vivo?: (t: number, dentro: boolean) => void; limiar: number; apagado: boolean; noite: number }
interface VisPessoa { corpo: Sprite; rosto: Sprite | null; icone: Sprite; coluna: Sprite; apIdx: number; olhoIdx: number; criatura: boolean; androide: boolean }

/** Multiplica duas cores 0xRRGGBB (o que o tint e a luz da noite fazem). */
export function mulCor(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255), g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255), bl = Math.round(((a & 255) * (b & 255)) / 255);
  return (r << 16) | (g << 8) | bl;
}

/** Respiração lenta do letreiro em espera: quase sempre apagado, um brilho fraco a cada 8 s. */
export function respiracao(t: number): number { return Math.pow(Math.max(0, Math.sin((t * Math.PI * 2) / 8)), 3); }
/** Letreiro ao acordar: pisca enquanto a luz da ala passa de 0,74 para 0,92. */
export function luzLetreiro(nivel: number, espera: boolean, t: number, reduzido = false): number {
  if (nivel >= 0.92) return 1;
  // movimento reduzido: meia-luz fixa em espera e, ao acordar, só sobe dela até acesa, sem piscar
  if (reduzido) return nivel >= 0.74 ? 0.18 + (0.82 * (nivel - 0.74)) / 0.18 : espera || nivel > 0 ? 0.18 : 0;
  // acordando: o neon falha antes de firmar; em espera, respira devagar
  if (nivel >= 0.74) return Math.floor(nivel * 50) % 3 === 0 ? 0 : 1;
  return espera ? respiracao(t) * 0.35 : 0;
}

export class VistaIso implements Vista {
  readonly m: Mundo;
  readonly r: Renderer;
  readonly atlas: Atlas;
  readonly op: OpcoesVista;
  readonly palco = new Container();
  movimentoReduzido = false;
  private mundoC = new Container();
  private fundoDia = new Container();
  private ceu = new Container();
  private estatico = new Sprite(Texture.EMPTY);
  private estaticoNoite: boolean | null = null;
  private janelasC = new Container();
  private pulsosC = new Container();
  private planosC = new Container();
  private sombrasC = new Container();
  private obraC = new Container();
  private ordenada = new Container();
  private minisC = new Container();
  private dronesC = new Container();
  private particulasC = new Container();
  private placasC = new Container();
  /** Ícones fixos de ala em espera, ao lado da placa (emitem luz: a noite não escurece). */
  private iconesEsperaC = new Container();
  private iconesEspera: { s: Sprite; zona: string }[] = [];
  private idIconeEspera = -1;
  private luzMundo = new Container();
  /** Luz ambiente da noite (multiplica o que é iluminado); o que emite luz (olhos, peito, ícones) fica fora. */
  private corNoite = 0xffffff;
  private apagoes = new Container();
  private sol = new Container();
  private esperaC = new Container();
  private letreirosC = new Container();
  private zonasVis: { id: string; piso: Sprite; parede: Sprite | null }[] = [];
  private letreirosDef: { ids: [number, number]; x: number; y: number; zona: string | null }[] = [];
  private letreirosVis: { s: Sprite; ids: [number, number]; zona: string | null }[] = [];
  private placasVis: { s: Sprite; on: Quadro; off: Quadro; zona: string; x: number; y: number }[] = [];
  /** Objetos grandes e o retângulo de tela de cada um (base e camadas), para corrigir a ordem das pessoas. */
  private ordenaveis: { o: ObjRT; x0: number; y0: number; x1: number; y1: number }[] = [];
  /** Telas de site na parede (estático): com a ala em espera, uma película escura as desliga. */
  private telasParede: { s: Sprite; zona: string; limiar: number }[] = [];
  private objetos: VisObj[] = [];
  private pessoas = new Map<Pessoa, VisPessoa>();
  private versaoVista = -1;
  private quadroN = 0;
  // ids e tabelas
  private idsPessoa: Int32Array = new Int32Array(0);
  private apIndice = new Map<string, number>();
  private idsRosto: Int32Array = new Int32Array(0);
  private olhoIndice = new Map<string, number>();
  private idIcone = new Map<Estado, number>();
  private idsDrone = new Map<string, [number, number]>();
  private idsMini = new Map<string, [number, number]>();
  private idCarga = new Map<Carga, number>();
  private idPulso = new Map<string, number>();
  private idBrilho = new Map<string, number>();
  private idPonto = 0; private idCoracao = 0; private idZ = 0; private idSombra = 0;
  private idsCarro: number[] = [];
  private idsOnAir: [number, number] = [0, 0];
  private idsNuvem: number[] = [];
  private idsObra: number[] = []; private idBarraFundo = 0; private idBarraCheia = 0;
  private idsDigito: number[] = []; private idRotuloEntregas = 0;
  private idsPeixe: number[] = [];
  private idColunaTalvez = 0;
  // sprites de pools
  private estrelas: Sprite[] = [];
  private nuvens: Sprite[] = [];
  private carros: Sprite[] = [];
  private onAir: Sprite[] = [];
  private pool = { pulsos: [] as Sprite[], sombras: [] as Sprite[], minis: [] as Sprite[][], drones: [] as Sprite[][], particulas: [] as Sprite[], brilhos: [] as Sprite[] };
  private brilhosFixos: { s: Sprite; L: Mundo['luzes'][number] }[] = [];
  private textoEntregas: { rotulo: Sprite; digitos: Sprite[]; x: number; y: number } | null = null;
  private obraSprites: { andaime: Sprite; drones: Sprite[]; fundo: Sprite; cheia: Sprite } | null = null;
  private apagaoSprites = new Map<string, Sprite>();
  private nLuzes = -1;
  readonly medidas = { sprites: 0, texturas: 0, atlasMb: 0, atlasOcupacao: 0, quadrosAtlas: 0, estaticoMb: 0, assarMs: 0, assarDesenhoMs: 0, assarAparoMs: 0, assarCopiaMs: 0, estaticoMs: 0 };
  readonly alvos: AlvosCamera;

  constructor(m: Mundo, r: Renderer, op: OpcoesVista) {
    this.m = m; this.r = r; this.op = op;
    this.atlas = new Atlas(2048, op.preset.nome === 'alto' ? 2 : 1);
    const geo = m.geo;
    this.alvos = {
      alvoZona: (id) => { const z = m.zonaPorId.get(id); if (!z) return null; const [x, y] = geo.iso((z.i0 + z.i1 + 1) / 2, (z.j0 + z.j1 + 1) / 2); return [x, y - 26]; },
      alvoUrgente: () => { const p = m.pessoas.find((a) => a.visivel && a.estado === 'esperando'); if (!p) return null; const [x, y] = geo.iso(p.pi, p.pj); return [x, y - 20]; },
      alvoForcado: () => {
        const f = m.focoForcado;
        if (!f || f.ate <= m.relogio.agora) return null;
        if (f.pessoa) {
          // segue o androide e, perto da ala dele, puxa o quadro para o meio da ala: o acordar
          // (que começa quando ele cruza a porta) fica inteiro na tela
          const p = f.pessoa, [x, y] = geo.iso(p.pi, p.pj);
          const z = m.zonaPorId.get(p.zona);
          if (!z) return [x, y - 24];
          const [zx, zy] = geo.iso((z.i0 + z.i1 + 1) / 2, (z.j0 + z.j1 + 1) / 2);
          // movimento reduzido: sem seguir quem anda; a câmera corta direto para a ala de destino
          if (this.movimentoReduzido) return [zx, zy - 26];
          const di = Math.max(z.i0 - p.pi, 0, p.pi - (z.i1 + 1)), dj = Math.max(z.j0 - p.pj, 0, p.pj - (z.j1 + 1));
          const w = 0.55 * Math.max(0, Math.min(1, 1 - Math.hypot(di, dj) / 6));
          return [x + (zx - x) * w, y - 24 + (zy - 26 - (y - 24)) * w];
        }
        return [f.x, f.y];
      },
      emEspera: (id) => m.emEspera(id),
      limites: (vw, vh) => ({ minX: geo.ox - geo.nj * 16 + vw * 0.25, maxX: geo.ox + geo.ni * 16 - vw * 0.25, minY: geo.oy - geo.parede + vh * 0.32, maxY: geo.oy + (geo.ni + geo.nj) * 8 - vh * 0.32 }),
    };
    this.ordenada.sortableChildren = true;
    this.palco.addChild(this.mundoC);
    for (const c of [this.fundoDia, this.ceu, this.estatico, this.esperaC, this.janelasC, this.letreirosC, this.pulsosC, this.planosC, this.sombrasC, this.obraC, this.ordenada, this.minisC, this.dronesC, this.particulasC, this.placasC, this.iconesEsperaC, this.apagoes]) this.mundoC.addChild(c);
    this.palco.addChild(this.luzMundo);
    this.luzMundo.addChild(this.sol);
  }

  /* ======================= Assar tudo ======================= */
  async preparar(progresso?: (f: number) => Promise<void> | void): Promise<void> {
    const m = this.m, A = this.atlas, tam = this.op.tam;
    const paletaCena = this.op.paleta;
    const passos: (() => void)[] = [];
    // 1. objetos (bases e camadas), inclusive os que nascem na obra
    usarPaleta(paletaCena);
    const extras: CtxObjeto[] = [{ tipo: 'pod', i: 0, j: 0, props: { nome: m.cena.textos.obra.salaNome } }, { tipo: 'planta', i: 0, j: 0, props: {} }];
    for (const o of [...m.objetos, ...extras]) passos.push(() => this.assarObjeto(o));
    // 2. personagens
    const aps = new Set<string>(m.pessoas.map((p) => p.aparencia));
    aps.add(m.cena.textos.obra.agente.aparencia);
    const lista = [...aps].filter((k) => m.cena.aparencias[k]);
    lista.forEach((k, i) => this.apIndice.set(k, i));
    const NQ = 4;
    this.idsPessoa = new Int32Array(lista.length * POSES.length * NQ * 2).fill(-1);
    for (const k of lista) {
      const ap = m.cena.aparencias[k];
      passos.push(() => {
        usarPaleta('fria');
        const ai = this.apIndice.get(k)!;
        const { w, h } = DIM[tam];
        POSES.forEach((ps, pi) => {
          for (let q = 0; q < ps.n; q++) for (let c = 0; c < 2; c++) {
            const id = A.assar(`p|${k}|${tam}|${this.op.maoFeita}|${ps.pose}|${q}|${c}`, w, h, w / 2, h - 1, (g) => desenharPersonagem(g, ap, ps.pose, q, c === 1, tam, this.op.maoFeita));
            this.idsPessoa[((ai * POSES.length + pi) * NQ + q) * 2 + c] = id;
          }
        });
        usarPaleta(paletaCena);
      });
    }
    // olhos e luz do peito por estado
    const olhos = [...new Set(lista.map((k) => m.cena.aparencias[k]).filter((ap): ap is Extract<Aparencia, { tipo: 'androide' }> => ap?.tipo === 'androide').map((ap) => ap.olho ?? '#7ef3ff'))];
    olhos.forEach((o, i) => this.olhoIndice.set(o, i));
    this.idsRosto = new Int32Array(olhos.length * ROSTOS.length).fill(-1);
    passos.push(() => {
      usarPaleta('fria');
      const { w, h } = DIM[tam];
      olhos.forEach((olho, oi) => ROSTOS.forEach((ro, ri) => {
        this.idsRosto[oi * ROSTOS.length + ri] = A.assar(`r|${olho}|${tam}|${ro}`, w, h, w / 2, h - 1, (g) => desenharRosto(g, { tipo: 'androide', papel: '#888888', olho }, ro, tam));
      }));
      usarPaleta(paletaCena);
    });
    // 3. efeitos e letreiros acesos (o estático tem o tubo apagado)
    passos.push(() => this.assarEfeitos());
    passos.push(() => this.assarLetreiros());
    const total = passos.length;
    const tIni = performance.now();
    let feito = 0, ultimo = performance.now();
    for (const passo of passos) {
      passo(); feito++;
      if (progresso && performance.now() - ultimo > 100) { ultimo = performance.now(); await progresso(feito / total); }
    }
    usarPaleta(paletaCena);
    A.finalizar();
    const uso = A.uso();
    Object.assign(this.medidas, { atlasMb: uso.mb, atlasOcupacao: uso.ocupacao, quadrosAtlas: uso.quadros, assarMs: performance.now() - tIni, assarDesenhoMs: A.tempos.desenho, assarAparoMs: A.tempos.aparar, assarCopiaMs: A.tempos.copia });
    this.montarFixos();
  }

  private assarObjeto(o: CtxObjeto): void {
    const def = tipoDe(o.tipo);
    const W = (def.w + def.d) * 16 + PADO * 2, H = (def.w + def.d) * 8 + def.h + PADO * 2;
    const ox = def.d * 16 + PADO, oy = def.h + PADO;
    const P = (ii: number, jj: number, z = 0): [number, number] => [Math.round(ox + (ii - jj) * 16), Math.round(oy + (ii + jj) * 8 - z)];
    this.atlas.assar(`o|${o.tipo}|${def.varianteBase?.(o) ?? ''}`, W, H, ox, oy, (g) => def.desenho(g, P, o));
    for (const c of def.camadas ?? []) {
      const vk = `a|${o.tipo}|${c.nome}|${c.variante?.(o) ?? ''}`;
      const n = c.n(o);
      for (let k = 0; k < n; k++) this.atlas.assar(`${vk}|${k}`, W, H, ox, oy, (g) => c.desenhar(g, P, k, o));
    }
    if (o.tipo === 'aquario') {
      const cores = ['#ff8a3c', '#ffd35c', '#ff5fa8'];
      cores.forEach((cor, k) => [0, 1].forEach((lado) => { this.idsPeixe[k * 2 + lado] = this.atlas.assar(`peixe|${cor}|${lado}`, 4, 2, 0, 0, (g) => { ret(g, lado ? 0 : 1, 0, 3, 2, cor); pxl(g, lado ? 3 : 0, 0, cor); }); }));
    }
  }

  private assarEfeitos(): void {
    const A = this.atlas, m = this.m;
    usarPaleta('fria');
    for (const e of ESTADOS_ICONE) this.idIcone.set(e, A.assar(`icone|${e}`, 9, 9, 0, 0, (g) => desenharIcone(g, e)));
    this.idIconeEspera = A.assar('icone|esperaAla', 9, 9, 0, 0, (g) => desenharIconeEsperaAla(g));
    const coresDrone = new Set<string>(['#ffb347', '#7dffa8', '#f2b45a', '#f2c230', '#6fd3ff']);
    const coresMini = new Set<string>(['#e0704f']);
    for (const ap of Object.values(m.cena.aparencias)) if (ap.tipo === 'androide') { coresDrone.add(ap.papel); coresMini.add(ap.papel); }
    for (const c of coresDrone) this.idsDrone.set(c, [0, 1].map((q) => A.assar(`drone|${c}|${q}`, 14, 10, 0, 0, (g) => desenharDrone(g, c, q))) as [number, number]);
    for (const c of coresMini) this.idsMini.set(c, [0, 1].map((q) => A.assar(`mini|${c}|${q}`, 12, 12, 0, 0, (g) => desenharMini(g, c, q))) as [number, number]);
    for (const t of ['envelope', 'cubo', 'check'] as Carga[]) this.idCarga.set(t, A.assar(`carga|${t}`, 9, 7, 4, 0, (g) => desenharCarga(g, t)));
    const coresPulso = new Set<string>([...Object.values(CORES_ESTADO), '#ffb347', '#7dffa8', '#ff6b5a', '#f2b45a']);
    for (const c of coresPulso) this.idPulso.set(c, A.assar(`pulso|${c}`, 3, 2, 1, 1, (g) => desenharPulso(g, c)));
    this.idPonto = A.assar('ponto', 1, 1, 0, 0, (g) => ret(g, 0, 0, 1, 1, '#ffffff'));
    this.idCoracao = A.assar('coracao', 3, 3, 1, 1, (g) => desenharCoracao(g, '#ffffff'));
    this.idZ = A.assar('z', 3, 5, 1, 2, (g) => desenharTexto(g, 'Z', '#ffffff'));
    this.idSombra = A.assar('sombra', 11, 5, 5, 2, (g) => desenharSombra(g));
    this.idColunaTalvez = A.assar('colunaTalvez', 4, 58, 0, 0, (g) => { for (let y = 0; y < 58; y += 6) ret(g, 0, y, 4, 3, '#d9b45a'); });
    for (const n of [false, true]) for (const im of [false, true]) this.idsCarro.push(A.assar(`carroJ|${n}|${im}`, 5, 1, 1, 0, (g) => desenharCarroJanela(g, n, im)));
    usarPaleta(this.op.paleta);
    const lOn = larguraTexto('ON AIR');
    this.idsOnAir = [A.assar('onair|0', lOn + 1, 7, 0, 0, (g) => desenharTexto(g, 'ON AIR', '#5a1f24')), A.assar('onair|1', lOn + 1, 7, 0, 0, (g) => desenharTexto(g, 'ON AIR', '#ff4040'))];
    // nuvens
    for (let k = 0; k < 9; k++) { const w = 18 + (k % 4) * 8; this.idsNuvem.push(A.assar(`nuvem|${w}`, w, 10, 0, 0, (g) => desenharNuvem(g, w))); }
    // placas flutuantes, acesas e apagadas (ala em espera)
    for (const z of m.zonas) if (z.placa) {
      const pl = placaPlana(z.nome);
      A.assar(`placa|${z.id}`, pl.w, pl.h, pl.xc, pl.yc, (g) => desenharPlaca(g, z.nome, z.cor));
      A.assar(`placa|${z.id}|off`, pl.w, pl.h, pl.xc, pl.yc, (g) => desenharPlaca(g, z.nome, mistura(z.cor, '#20253c', 0.74)));
    }
    // dígitos do contador de entregas do Núcleo
    this.idRotuloEntregas = A.assar('entregas', larguraTexto('ENTREGAS') + 1, 7, 0, 0, (g) => desenharTexto(g, 'ENTREGAS', '#e8fdff'));
    for (let d = 0; d < 10; d++) this.idsDigito.push(A.assar(`dig|${d}`, 4, 7, 0, 0, (g) => desenharTexto(g, String(d), '#e8fdff')));
    // obra: andaime em 16 alturas e barra de progresso
    const ox = 2 * 16 + PADO, oy = 40 + PADO;
    const Q = (ii: number, jj: number, z: number): [number, number] => [Math.round(ox + (ii - jj) * 16), Math.round(oy + (ii + jj) * 8 - z)];
    for (let k = 0; k < 16; k++) {
      const h = 40 * (k / 15);
      this.idsObra.push(A.assar(`obra|${k}`, 4 * 16 + PADO * 2, 4 * 8 + 40 + PADO * 2, ox, oy, (g) => {
        for (const [a, b] of [[0, 0], [2, 0], [2, 2], [0, 2]] as const) { const p = Q(a, b, 0), q = Q(a, b, h); linha(g, p[0], p[1], q[0], q[1], '#f2c230'); }
        for (const zz of [h * 0.5, h]) { const ps = [Q(0, 0, zz), Q(2, 0, zz), Q(2, 2, zz), Q(0, 2, zz)]; for (let i = 0; i < 4; i++) linha(g, ps[i][0], ps[i][1], ps[(i + 1) % 4][0], ps[(i + 1) % 4][1], '#f2c230'); }
      }));
    }
    this.idBarraFundo = A.assar('barraF', 40, 4, 0, 0, (g) => ret(g, 0, 0, 40, 4, '#14162b'));
    this.idBarraCheia = A.assar('barraC', 1, 2, 0, 0, (g) => ret(g, 0, 0, 1, 2, '#ffcf4d'));
    // brilhos: todas as luzes do mundo, as dinâmicas e as que a obra acrescenta
    const brilhos = new Set<string>();
    for (const L of m.luzes) brilhos.add(`${L.cor}|${L.r}`);
    for (const c of this.idsDrone.keys()) brilhos.add(`${c}|14`);
    for (const k of ['#ffcf4d|30', '#9ff3ff|40', '#c9a7ff|20', '#d9b45a|26']) brilhos.add(k);
    for (const k of brilhos) {
      const [cor, rs] = k.split('|'); const r = Number(rs);
      this.idBrilho.set(k, A.assar(`brilho|${k}|${paletaAtual()}`, r * 2, r * 2, r, r, (g) => desenharBrilho(g, cp(cor), r)));
    }
  }

  /** Letreiros das paredes, acesos de noite e de dia, recortados no retângulo de cada um. */
  private assarLetreiros(): void {
    const geo = this.m.geo;
    this.m.cena.letreiros.forEach((L, k) => {
      const [bx, by, bw, bh] = caixaLetreiro(geo, L.parede, L.texto, L.u, 71);
      const ids = [false, true].map((noite) => this.atlas.assar(`letreiro|${k}|${noite ? 1 : 0}|${paletaAtual()}`, bw, bh, 0, 0, (g) => {
        g.translate(-bx, -by);
        textoParede(g, geo, L.parede, L.texto, L.u, 71, corLetreiro(L.cor, noite));
      })) as [number, number];
      this.letreirosDef.push({ ids, x: bx, y: by, zona: L.zona ?? null });
    });
  }

  private q(id: number): Quadro { return this.atlas.quadro(id); }
  private spr(id: number, pai: Container): Sprite { const s = new Sprite(this.q(id).tex); s.roundPixels = true; pai.addChild(s); return s; }

  /** Sprites que existem do começo ao fim: céu, carros, ON AIR, placas, texto do Núcleo, sol, luz. */
  private montarFixos(): void {
    const m = this.m, geo = m.geo, pre = this.op.preset;
    for (const [y, cor] of [[geo.oy + 260, '#b9e2f5'], [geo.oy + 520, '#d3eef9']] as const) {
      const s = new Sprite(Texture.WHITE); s.tint = numeroCor(cor); s.position.set(-4000, y); s.width = geo.larg + 8000; s.height = 6000; this.fundoDia.addChild(s);
    }
    for (let k = 0; k < pre.estrelas; k++) { const s = this.spr(this.idPonto, this.ceu); s.position.set((k * 977) % geo.larg, (k * 613) % geo.alt); this.estrelas.push(s); }
    if (pre.nuvens) this.idsNuvem.forEach((id, k) => { const s = this.spr(id, this.ceu); s.y = 40 + ((k * 151) % (geo.alt - 60)) - 5; this.nuvens.push(s); });
    for (let k = 0; k < pre.carrosJanela && m.cena.janelas.length; k++) this.carros.push(this.spr(this.idsCarro[0], this.janelasC));
    for (const d of m.cena.decoracoes) if (d.tipo === 'onAir') {
      const p = geo.mapaParede(d.parede, (d.u0 + d.u1) / 2, 63);
      const s = this.spr(this.idsOnAir[0], this.janelasC); s.position.set(Math.round(p[0] - 11), Math.round(p[1] - 9 - 2)); this.onAir.push(s);
    }
    for (const z of m.zonas) if (z.placa) {
      const id = this.atlas.idDe(`placa|${z.id}`), idOff = this.atlas.idDe(`placa|${z.id}|off`); if (id === undefined || idOff === undefined) continue;
      const fr = this.q(id); const p = geo.iso(z.i0 + 1.6, z.j0 + 0.6, 46);
      const s = this.spr(id, this.placasC); s.position.set(Math.round(p[0]) + fr.dx, Math.round(p[1]) + fr.dy);
      this.placasVis.push({ s, on: fr, off: this.q(idOff), zona: z.id, x: Math.round(p[0]), y: Math.round(p[1]) });
      // ala em espera: ícone fixo de stand-by na ponta direita da placa
      if (z.tipo === 'ala') { const ic = this.spr(this.idIconeEspera, this.iconesEsperaC); ic.position.set(s.x + fr.w + 1, s.y + Math.round((fr.h - 9) / 2)); ic.visible = false; this.iconesEspera.push({ s: ic, zona: z.id }); }
    }
    // letreiros acesos por cima do tubo apagado do estático
    for (const L of this.letreirosDef) {
      const fr = this.q(L.ids[1]); const s = this.spr(L.ids[1], this.letreirosC);
      s.position.set(L.x + fr.dx, L.y + fr.dy);
      this.letreirosVis.push({ s, ids: L.ids, zona: L.zona });
    }
    // alas sem placa (encostadas na parede do fundo): o ícone de espera vem logo depois do letreiro da parede
    const comIcone = new Set(this.iconesEspera.map((ie) => ie.zona));
    for (const L of m.cena.letreiros) {
      if (!L.zona || comIcone.has(L.zona) || m.zonaPorId.get(L.zona)?.tipo !== 'ala') continue;
      const meia = larguraTexto(L.texto); // o letreiro usa a fonte 3 por 5 ampliada 2 vezes
      const [x, y] = geo.mapaParede(L.parede, Math.round(L.parede === 'J' ? L.u + meia + 7 : L.u - meia - 7), 66);
      const ic = this.spr(this.idIconeEspera, this.iconesEsperaC); ic.position.set(Math.round(x) - 4, Math.round(y) - 4); ic.visible = false;
      this.iconesEspera.push({ s: ic, zona: L.zona }); comIcone.add(L.zona);
    }
    // meia-luz fria das alas em espera: piso e trecho de parede da ala (multiplicação)
    const H = geo.parede + 3;
    for (const z of m.zonas) {
      if (z.tipo !== 'ala') continue;
      const W = z.i1 - z.i0 + 1, D = z.j1 - z.j0 + 1, [ax, ay] = geo.iso(z.i0, z.j0);
      const piso = new Sprite(Texture.WHITE); piso.blendMode = 'multiply'; piso.tint = TINT_PISO_ESPERA; piso.visible = false;
      piso.setFromMatrix(new Matrix(16 * W, 8 * W, -16 * D, 8 * D, ax, ay));
      this.esperaC.addChild(piso);
      let parede: Sprite | null = null;
      if (z.j0 === 0 || z.i0 === 0) {
        parede = new Sprite(Texture.WHITE); parede.blendMode = 'multiply'; parede.tint = TINT_PISO_ESPERA; parede.visible = false;
        if (z.j0 === 0) { const L = W * 16, [x, y] = geo.mapaParede('J', z.i0 * 16, 0); parede.setFromMatrix(new Matrix(L, L / 2, 0, H, x, y - H)); }
        else { const L = D * 16, u0 = z.j0 * 16; parede.setFromMatrix(new Matrix(L, -L / 2, 0, H, geo.ox - u0 - L, geo.oy + Math.floor((u0 + L) / 2) - H)); }
        this.esperaC.addChild(parede);
      }
      this.zonasVis.push({ id: z.id, piso, parede });
    }
    // telas de site da parede: área da imagem (u de u0 + 2 a u1 - 2, v de 22 a 50)
    for (const d of m.cena.decoracoes) {
      if (d.tipo !== 'sites') continue;
      const ua = Math.round(d.u0) + 2, ub = Math.round(d.u1) - 2, L = ub - ua, uc = (ua + ub) / 2;
      const z = d.parede === 'J' ? m.zonaEm(Math.floor(uc / 16), 0) : m.zonaEm(0, Math.floor(uc / 16));
      if (!z || z.tipo !== 'ala' || L <= 0) continue;
      const s = new Sprite(Texture.WHITE); s.tint = 0x070912; s.alpha = 0.92; s.visible = false;
      if (d.parede === 'J') s.setFromMatrix(new Matrix(L, L / 2, 0, 29, geo.ox + ua, geo.oy + Math.floor(ua / 2) - 50));
      else s.setFromMatrix(new Matrix(L, -L / 2, 0, 29, geo.ox - ub, geo.oy + Math.floor(ub / 2) - 50));
      this.letreirosC.addChild(s);
      const limiar = d.parede === 'J' ? m.limiarEm(z.id, uc / 16, 0) : m.limiarEm(z.id, 0, uc / 16);
      this.telasParede.push({ s, zona: z.id, limiar });
    }
    const nuc = m.objetos.find((o) => o.tipo === 'nucleo');
    if (nuc) {
      const cen = geo.iso(nuc.i + 2, nuc.j + 2, 50);
      const x = Math.round(cen[0] - 20), y = Math.round(cen[1] + 24);
      this.textoEntregas = { rotulo: this.spr(this.idRotuloEntregas, this.placasC), digitos: [0, 1, 2, 3].map(() => this.spr(this.idsDigito[0], this.placasC)), x, y };
      this.textoEntregas.rotulo.position.set(x, y - 2);
    }
    // feixes de sol (dia): paralelogramos por matriz, sem textura própria
    for (const pts of feixesDeSol(m.cena, geo)) {
      const s = new Sprite(Texture.WHITE); s.tint = numeroCor(cp('#ffe9b0')); s.alpha = 0.07; s.blendMode = 'add';
      const [a, b, , d] = pts;
      s.setFromMatrix(new Matrix(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1], a[0], a[1]));
      this.sol.addChild(s);
    }
  }

  private montarBrilhos(): void {
    for (const b of this.brilhosFixos) b.s.destroy();
    this.brilhosFixos = this.m.luzes.map((L) => {
      const id = this.idBrilho.get(`${L.cor}|${L.r}`) ?? this.idBrilho.values().next().value!;
      const s = this.spr(id, this.luzMundo); s.blendMode = 'add';
      const fr = this.q(id); s.position.set(Math.round(L.x) + fr.dx, Math.round(L.y) + fr.dy);
      return { s, L };
    });
    this.nLuzes = this.m.luzes.length;
  }

  /** Cria os sprites dos objetos e das pessoas que ainda não existem na vista. */
  private sincronizar(): void {
    const m = this.m;
    for (let k = this.objetos.length; k < m.objetos.length; k++) {
      const o = m.objetos[k];
      const def = o.def;
      const idBase = this.atlas.idDe(`o|${o.tipo}|${def.varianteBase?.(o) ?? ''}`);
      const pai = o.plano ? this.planosC : this.ordenada;
      const [X, Y] = m.geo.iso(o.i, o.j);
      const fr = idBase !== undefined ? this.q(idBase) : { tex: Texture.EMPTY, dx: 0, dy: 0, w: 0, h: 0 };
      const base = new Sprite(fr.tex); base.roundPixels = true; base.position.set(Math.round(X) + fr.dx, Math.round(Y) + fr.dy);
      if (!o.plano) base.zIndex = o.chave;
      pai.addChild(base);
      const vis: VisObj = { o, ax: Math.round(X), ay: Math.round(Y), base, camadas: [], ret: [Math.round(X) + fr.dx, Math.round(Y) + fr.dy, fr.w, fr.h], limiar: m.limiarEm(o.zona, o.i + o.w / 2, o.j + o.d / 2), apagado: false, noite: -1 };
      (def.camadas ?? []).forEach((c, ci) => {
        const vk = `a|${o.tipo}|${c.nome}|${c.variante?.(o) ?? ''}`;
        const n = c.n(o);
        const ids = new Int32Array(n);
        for (let q = 0; q < n; q++) ids[q] = this.atlas.idDe(`${vk}|${q}`) ?? -1;
        const s = new Sprite(Texture.EMPTY); s.roundPixels = true; s.visible = false;
        if (!o.plano) s.zIndex = o.chave + 1e-4 * (ci + 1);
        pai.addChild(s);
        vis.camadas.push({ s, ids, quadro: c.quadro, emEspera: c.emEspera });
      });
      if (o.tipo === 'aquario') vis.vivo = this.vivoAquario(o, pai);
      if (o.tipo === 'teleporte') vis.vivo = this.vivoTeleporte(o, pai);
      this.objetos.push(vis);
      // objeto de 2 ladrilhos ou mais: a chave única de profundidade erra perto das pontas; quem
      // estiver na frente (ou atrás) da caixa dele é corrigido em atualizarPessoas
      if (!o.plano && o.w + o.d >= 3) {
        let ex0 = fr.w ? fr.dx : 1e9, ey0 = fr.w ? fr.dy : 1e9, ex1 = fr.w ? fr.dx + fr.w : -1e9, ey1 = fr.w ? fr.dy + fr.h : -1e9;
        for (const c of vis.camadas) for (const id of c.ids) {
          if (id < 0) continue;
          const q = this.q(id); if (!q.w) continue;
          ex0 = Math.min(ex0, q.dx); ey0 = Math.min(ey0, q.dy); ex1 = Math.max(ex1, q.dx + q.w); ey1 = Math.max(ey1, q.dy + q.h);
        }
        if (ex1 > ex0) this.ordenaveis.push({ o, x0: vis.ax + ex0, y0: vis.ay + ey0, x1: vis.ax + ex1, y1: vis.ay + ey1 });
      }
    }
    for (const p of m.pessoas) {
      if (this.pessoas.has(p)) continue;
      const ap = p.ap;
      const androide = ap?.tipo === 'androide';
      const corpo = new Sprite(Texture.EMPTY); corpo.roundPixels = true;
      const rosto = androide ? new Sprite(Texture.EMPTY) : null; if (rosto) rosto.roundPixels = true;
      const icone = new Sprite(Texture.EMPTY); icone.roundPixels = true;
      const coluna = new Sprite(Texture.WHITE); coluna.tint = 0xffcf4d; coluna.width = 4; coluna.height = this.op.tam === 24 ? 64 : 58; coluna.visible = false;
      this.ordenada.addChild(corpo); if (rosto) this.ordenada.addChild(rosto); this.ordenada.addChild(icone); this.ordenada.addChild(coluna);
      this.pessoas.set(p, {
        corpo, rosto, icone, coluna, apIdx: this.apIndice.get(p.aparencia) ?? 0,
        olhoIdx: androide ? (this.olhoIndice.get((ap as { olho?: string }).olho ?? '#7ef3ff') ?? 0) : 0,
        criatura: ap?.tipo === 'gato' || ap?.tipo === 'robo', androide,
      });
    }
    if (this.m.luzes.length !== this.nLuzes) this.montarBrilhos();
    this.versaoVista = m.versao;
  }

  private vivoAquario(o: ObjRT, pai: Container): (t: number, dentro: boolean) => void {
    const peixes = [0, 1, 2].map(() => { const s = new Sprite(Texture.EMPTY); s.roundPixels = true; s.zIndex = o.chave + 5e-4; pai.addChild(s); return s; });
    const bolha = this.spr(this.idPonto, pai); bolha.tint = 0xd6f3ff; bolha.zIndex = o.chave + 6e-4;
    const iso = this.m.geo.iso;
    return (t, dentro) => {
      for (let k = 0; k < 3; k++) {
        const s = peixes[k]; s.visible = dentro; if (!dentro) continue;
        const u = 0.3 + ((Math.sin(t * 0.6 + k * 2) + 1) / 2) * 1.4; const p = iso(o.i + u, o.j + 0.82, 15 + k * 3);
        const caudaEsq = Math.cos(t * 0.6 + k * 2) > 0;
        s.texture = this.q(this.idsPeixe[k * 2 + (caudaEsq ? 0 : 1)]).tex; s.position.set(Math.round(p[0]) - (caudaEsq ? 1 : 0), Math.round(p[1]));
        if (s.tint !== this.corNoite) s.tint = this.corNoite;
      }
      const corBolha = mulCor(0xd6f3ff, this.corNoite);
      if (bolha.tint !== corBolha) bolha.tint = corBolha;
      const mostra = dentro && Math.floor(t * 3) % 3 === 0; bolha.visible = mostra;
      if (mostra) { const p = iso(o.i + 1.2, o.j + 0.82, 22 + ((t * 8) % 4)); bolha.position.set(Math.round(p[0]), Math.round(p[1])); }
    };
  }

  private vivoTeleporte(o: ObjRT, pai: Container): (t: number, dentro: boolean) => void {
    const largo = new Sprite(Texture.WHITE), miolo = new Sprite(Texture.WHITE);
    largo.tint = 0x9ff3ff; pai.addChild(largo); pai.addChild(miolo);
    const p = this.m.geo.iso(o.i + 1, o.j + 1, 3), X = Math.round(p[0]), Y = Math.round(p[1]);
    largo.position.set(X - 12, Y - 70); largo.width = 25; largo.height = 70;
    miolo.position.set(X - 4, Y - 70); miolo.width = 9; miolo.height = 70;
    return (_t, dentro) => {
      const g = this.m.global, agora = this.m.relogio.agora;
      const ativo = dentro && g.teleAte > agora;
      largo.visible = miolo.visible = ativo;
      if (ativo) { const forca = Math.min(1, (g.teleAte - agora) / 0.6); largo.alpha = 0.35 * forca; miolo.alpha = 0.7 * forca; }
    };
  }

  definirNoite(noite: boolean): void {
    if (this.estaticoNoite === noite) return;
    this.estaticoNoite = noite;
    usarPaleta(this.op.paleta);
    const tE = performance.now();
    const c = construirEstatico(this.m.cena, this.m.geo, noite);
    this.medidas.estaticoMs = performance.now() - tE;
    const antiga = this.estatico.texture;
    const tex = Texture.from(c); tex.source.scaleMode = 'nearest';
    this.estatico.texture = tex;
    if (antiga && antiga !== Texture.EMPTY) antiga.destroy(true);
    this.medidas.estaticoMb = (c.width * c.height * 4) / 1048576;
    // a noite multiplica tudo o que é iluminado, sprite por sprite, no lugar de uma camada de tela
    // cheia por cima: os olhos de LED, a luz do peito, os ícones de estado e a coluna âmbar emitem
    // luz, ficam na cor cheia e continuam na ordem de profundidade de sempre
    this.corNoite = noite ? numeroCor(cp('#4b5592')) : 0xffffff;
    for (const c of [this.fundoDia, this.ceu, this.estatico, this.janelasC, this.letreirosC, this.pulsosC, this.planosC, this.sombrasC, this.obraC, this.minisC, this.dronesC, this.particulasC, this.placasC, this.apagoes]) c.tint = this.corNoite;
    this.r.background.color = noite ? mulCor(0x05060f, this.corNoite) : 0x9fd3ef;
    this.fundoDia.visible = !noite;
  }

  /* ======================= Quadro ======================= */
  desenhar(cam: Camera, _dt: number): void {
    const m = this.m, pre = this.op.preset, t = m.tAnim, noite = !!this.estaticoNoite;
    if (m.versao !== this.versaoVista) this.sincronizar();
    this.quadroN++;
    const [x0, y0] = cam.origem();
    const vw = cam.vw, vh = cam.vh;
    this.mundoC.position.set(-x0, -y0);
    this.luzMundo.position.set(-x0, -y0);
    let n = 2;
    // céu
    // estrelas: cintilam; com movimento reduzido, ficam fixas (uma em três acesa)
    const fixas = this.movimentoReduzido;
    for (let k = 0; k < this.estrelas.length; k++) { const s = this.estrelas[k]; s.visible = noite; if (noite) s.tint = (fixas ? k % 3 === 0 : Math.sin(t * 2 + k * 1.7) > 0.6) ? 0xffffff : 0x5a6290; }
    for (let k = 0; k < this.nuvens.length; k++) { const s = this.nuvens[k]; s.visible = !noite; if (!noite) { const v = 3 + (k % 3) * 2; s.x = Math.round(((((k * 263) % m.geo.larg) + t * v) % (m.geo.larg + 80)) - 40); } }
    n += noite ? this.estrelas.length : this.nuvens.length;
    // carros nas janelas e ON AIR
    const jans = m.cena.janelas;
    for (let k = 0; k < this.carros.length; k++) {
      const s = this.carros[k], jan = jans[k % jans.length];
      const span = jan.u1 - jan.u0, u = jan.u0 + ((t * (14 + k * 5) + k * 97) % span), v = 30 + ((k * 7) % 22);
      if ((Math.floor(u - jan.u0) % 32) < 2) { s.visible = false; continue; }
      const [x, y] = m.geo.mapaParede(jan.parede, Math.floor(u), v);
      s.texture = this.q(this.idsCarro[(noite ? 2 : 0) + (k % 2)]).tex; s.position.set(Math.round(x) - 1, Math.round(y)); s.visible = true; n++;
    }
    const onAirLuz = m.global.onAir && (this.movimentoReduzido || Math.floor(t * 2) % 2 === 1);
    for (const s of this.onAir) s.texture = this.q(this.idsOnAir[onAirLuz ? 1 : 0]).tex;
    // alas em espera: meia-luz no piso e na parede, letreiros e placas
    n += this.atualizarEspera(t, noite);
    // pulsos de dados
    n += this.atualizarPulsos();
    // objetos e camadas (numa ala em espera: mobília escurecida, telas e hologramas desligados)
    const info: InfoAnim = { t, ativo: null, presente: false, usada: false, erro: m.global.erroAte > m.relogio.agora, faseRack: m.global.faseRack, noite };
    const meia = pre.animMeiaTaxa && this.quadroN % 2 === 1;
    for (const v of this.objetos) {
      const [rx, ry, rw, rh] = v.ret;
      const dentro = rx - x0 < vw + 40 && ry - y0 < vh + 40 && rx - x0 + rw > -40 && ry - y0 + rh > -60;
      v.base.visible = dentro;
      if (dentro) n++;
      const apagado = v.o.zona !== null && m.nivelZona(v.o.zona) < v.limiar;
      const mudou = apagado !== v.apagado || v.noite !== this.corNoite;
      if (mudou) {
        v.apagado = apagado; v.noite = this.corNoite;
        const escuro = mulCor(TINT_APAGADO, this.corNoite);
        v.base.tint = apagado ? escuro : this.corNoite;
        for (const c of v.camadas) c.s.tint = apagado && typeof c.emEspera === 'number' ? escuro : this.corNoite;
      }
      if (v.camadas.length && (!meia || mudou)) {
        if (dentro) this.infoObjeto(v.o, info);
        for (const c of v.camadas) {
          if (!dentro) { c.s.visible = false; continue; }
          let k: number;
          if (apagado && c.emEspera !== 'anima') k = c.emEspera ?? -1;
          else k = c.quadro(v.o, info);
          if (k < 0 || k >= c.ids.length || c.ids[k] < 0) { c.s.visible = false; continue; }
          const fr = this.q(c.ids[k]);
          if (c.s.texture !== fr.tex) { c.s.texture = fr.tex; c.s.position.set(v.ax + fr.dx, v.ay + fr.dy); }
          c.s.visible = fr.w > 0; if (fr.w > 0) n++;
        }
      } else if (!dentro) for (const c of v.camadas) c.s.visible = false;
      else for (const c of v.camadas) if (c.s.visible) n++;
      if (v.vivo) v.vivo(t, dentro);
    }
    // sombras dos drones
    n += this.atualizarSombras();
    this.atualizarObra(t);
    n += this.atualizarPessoas(t, x0, y0, vw, vh);
    n += this.atualizarMinis(t);
    n += this.atualizarDrones(t);
    n += this.atualizarParticulas();
    this.atualizarTextoEntregas();
    n += this.atualizarLuz(t, x0, y0, vw, vh, noite);
    this.medidas.sprites = n;
    this.r.render(this.palco);
  }

  /** Estado do dono do objeto e equipamento em uso, para escolher o quadro. */
  private infoObjeto(o: ObjRT, info: InfoAnim): void {
    info.ativo = null; info.presente = false; info.usada = false;
    if (o.tipo === 'recarga') { info.presente = !!(o.dono && this.m.porId.get(o.dono)?.naRecarga); return; }
    if (o.dono) {
      const p = this.m.porId.get(o.dono);
      if (p && p.visivel && p.emCasa) { info.presente = true; if (p.estado !== 'ocioso' && p.estado !== 'dormindo' && p.estado !== 'semSinal' && p.estado !== 'limite') info.ativo = p.estado; }
    } else if (o.tipo === 'mesaComando' || o.tipo === 'mesaNotebook') {
      const p = this.m.pessoas.find((x) => x.def.papel === (o.tipo === 'mesaComando' ? 'dono' : 'fixo'));
      info.presente = !!p?.emCasa;
    }
    if (o.tipo === 'esteira' || o.tipo === 'bike') info.usada = this.m.pessoas.some((p) => !p.andando && p.pose === 'correr' && Math.floor(p.pi) >= o.i && Math.floor(p.pi) < o.i + o.w && Math.floor(p.pj) >= o.j && Math.floor(p.pj) < o.j + o.d);
    if (o.tipo === 'camera') info.usada = this.m.global.onAir;
    if (o.zona && this.m.global.apagao.has(o.zona)) { info.ativo = null; info.presente = false; }
  }

  /** Meia-luz das alas em espera (com luz de presença), letreiros e placas. */
  private atualizarEspera(t: number, noite: boolean): number {
    const m = this.m;
    let n = 0;
    const forca = noite ? 0.62 : 0.46;
    for (const zv of this.zonasVis) {
      const e = m.estadoZona.get(zv.id);
      if (!e) continue;
      const k = 1 - e.nivel, a = forca * k * k * (3 - 2 * k) * (1 - 0.45 * e.presenca);
      const ver = a > 0.01;
      zv.piso.visible = ver; if (ver) { zv.piso.alpha = a; n++; }
      if (zv.parede) { zv.parede.visible = ver; if (ver) { zv.parede.alpha = a * 0.75; n++; } }
    }
    for (const lv of this.letreirosVis) {
      const luz = lv.zona ? luzLetreiro(m.nivelZona(lv.zona), m.emEspera(lv.zona), t, this.movimentoReduzido) : 1;
      const tex = this.q(lv.ids[noite ? 1 : 0]).tex;
      if (lv.s.texture !== tex) lv.s.texture = tex;
      lv.s.visible = luz > 0.02; if (lv.s.visible) { lv.s.alpha = luz; n++; }
    }
    for (const pv of this.placasVis) {
      const acesa = luzLetreiro(m.nivelZona(pv.zona), m.emEspera(pv.zona), t, this.movimentoReduzido) > 0.5;
      const fr = acesa ? pv.on : pv.off;
      if (pv.s.texture !== fr.tex) { pv.s.texture = fr.tex; pv.s.position.set(pv.x + fr.dx, pv.y + fr.dy); }
    }
    for (const tp of this.telasParede) { tp.s.visible = m.nivelZona(tp.zona) < tp.limiar; if (tp.s.visible) n++; }
    for (const ie of this.iconesEspera) { ie.s.visible = m.emEspera(ie.zona); if (ie.s.visible) n++; }
    return n;
  }

  private atualizarPulsos(): number {
    let n = 0;
    for (const p of this.m.pulsos) {
      if (p.s < 0) continue;
      const [x, y] = pontoNaLinha(p, p.s);
      const s = this.pool.pulsos[n] ?? (this.pool.pulsos[n] = this.spr(this.idPonto, this.pulsosC));
      const id = this.idPulso.get(p.cor) ?? this.idPonto;
      const fr = this.q(id);
      s.texture = fr.tex; s.position.set(Math.round(x) + fr.dx, Math.round(y) + fr.dy); s.visible = true; n++;
    }
    for (let k = n; k < this.pool.pulsos.length; k++) this.pool.pulsos[k].visible = false;
    return n;
  }

  private atualizarSombras(): number {
    let n = 0;
    for (const d of this.m.drones) {
      const s = this.pool.sombras[n] ?? (this.pool.sombras[n] = this.spr(this.idSombra, this.sombrasC));
      s.alpha = 0.35; s.position.set(Math.round(d.x) - 5, Math.round(d.y) - 2); s.visible = true; n++;
    }
    for (let k = n; k < this.pool.sombras.length; k++) this.pool.sombras[k].visible = false;
    return n;
  }

  private atualizarObra(t: number): void {
    const m = this.m, tr = m.cena.pontos.terreno;
    if (!tr || m.obra.fase !== 'obra') { if (this.obraSprites) this.obraC.visible = false; return; }
    if (!this.obraSprites) {
      this.obraSprites = { andaime: this.spr(this.idsObra[0], this.obraC), drones: [0, 1, 2].map(() => this.spr(this.idsDrone.get('#f2c230')![0], this.obraC)), fundo: this.spr(this.idBarraFundo, this.obraC), cheia: this.spr(this.idBarraCheia, this.obraC) };
    }
    this.obraC.visible = true;
    const o = this.obraSprites;
    const prog = Math.min(1, (m.relogio.agora - m.obra.inicio) / 7.5);
    const [X, Y] = m.geo.iso(tr.i, tr.j);
    const fr = this.q(this.idsObra[Math.min(15, Math.floor(prog * 15))]);
    o.andaime.texture = fr.tex; o.andaime.position.set(Math.round(X) + fr.dx, Math.round(Y) + fr.dy);
    const centro = m.geo.iso(tr.i + 1, tr.j + 1, 60);
    for (let k = 0; k < 3; k++) {
      const a = t * 1.5 + (k * Math.PI * 2) / 3;
      o.drones[k].texture = this.q(this.idsDrone.get('#f2c230')![Math.floor(t * 16) % 2]).tex;
      o.drones[k].position.set(Math.round(centro[0] + Math.cos(a) * 26 - 7), Math.round(centro[1] + Math.sin(a) * 12 - 6));
    }
    const barra = m.geo.iso(tr.i + 1, tr.j + 1, 70);
    o.fundo.position.set(Math.round(barra[0] - 20), Math.round(barra[1]));
    o.cheia.position.set(Math.round(barra[0] - 19), Math.round(barra[1] + 1)); o.cheia.width = Math.max(1, Math.round(38 * prog));
  }

  private atualizarPessoas(t: number, x0: number, y0: number, vw: number, vh: number): number {
    let n = 0;
    const tam = this.op.tam, { w: W, h: H } = DIM[tam];
    for (const [p, v] of this.pessoas) {
      const [fx, fy] = this.m.geo.iso(p.pi, p.pj, p.z);
      const sx = Math.round(fx - W / 2), sy = Math.round(fy - (H - 1));
      const dentro = p.visivel && !(sx - x0 < -30 || sy - y0 < -50 || sx - x0 > vw + 30 || sy - y0 > vh + 50);
      if (!dentro) { v.corpo.visible = false; if (v.rosto) v.rosto.visible = false; v.icone.visible = false; v.coluna.visible = false; continue; }
      const pose: Pose = p.andando ? 'andar' : p.pose;
      const nq = POSES[INDICE_POSE[pose]].n;
      const q = Math.min(nq - 1, quadroPose(pose, p.t, p.andando));
      const id = this.idsPessoa[((v.apIdx * POSES.length + INDICE_POSE[pose]) * 4 + q) * 2 + (p.costas ? 1 : 0)];
      const fr = this.q(id);
      const z = this.profundidade(p, sx, sy, W, H);
      const ax = Math.round(fx), ay = Math.round(fy);
      this.colocar(v.corpo, fr, ax, ay, p.espelho, W);
      v.corpo.zIndex = z; v.corpo.alpha = p.alpha; v.corpo.visible = true; n++;
      // bot na cápsula (e figurante de ala em espera): meia-luz, olhos apagados, luz do peito lenta
      const dormente = p.naRecarga || (p.def.papel === 'figurante' && v.androide && this.m.emEspera(p.zona));
      const tint = dormente ? mulCor(TINT_RECARGA, this.corNoite) : this.corNoite;
      if (v.corpo.tint !== tint) v.corpo.tint = tint;
      if (v.rosto) {
        if (p.costas) v.rosto.visible = false;
        else {
          let ro: string = p.estado;
          // na cápsula, a luz do peito pisca devagar; com movimento reduzido, fica acesa
          if (dormente) ro = this.movimentoReduzido || Math.floor(t / 1.6 + p.pi * 0.37) % 2 ? 'recargaLuz' : 'recarga';
          else if (ro === 'ocioso' && (p.t % 4.1) > 3.95) ro = 'piscar';
          const ri = INDICE_ROSTO[ro] ?? 0;
          const frR = this.q(this.idsRosto[v.olhoIdx * ROSTOS.length + ri]);
          this.colocar(v.rosto, frR, ax, ay + dyPose(pose, q, tam), p.espelho, W);
          v.rosto.zIndex = z + 1e-5; v.rosto.alpha = p.alpha; v.rosto.visible = true; n++;
        }
      }
      const temIcone = v.androide && !dormente && p.estado !== 'ocioso' && this.idIcone.has(p.estado);
      if (temIcone) {
        const fi = this.q(this.idIcone.get(p.estado)!);
        v.icone.texture = fi.tex;
        v.icone.position.set(sx + (tam === 24 ? 7 : 3), sy - 12 + (pose === 'digitando' || pose === 'dormir' ? (tam === 24 ? 4 : 3) : 0) + (this.movimentoReduzido ? 0 : Math.round(Math.sin(t * 3 + p.pi))));
        v.icone.zIndex = z + 2e-5; v.icone.alpha = p.alpha; v.icone.visible = true; n++;
      } else v.icone.visible = false;
      if (p.estado === 'esperando' || p.estado === 'talvez') {
        const talvez = p.estado === 'talvez';
        if (talvez) { v.coluna.texture = this.q(this.idColunaTalvez).tex; v.coluna.tint = 0xffffff; v.coluna.width = 4; v.coluna.height = 58; }
        else { v.coluna.texture = Texture.WHITE; v.coluna.tint = 0xffcf4d; v.coluna.width = 4; v.coluna.height = tam === 24 ? 64 : 58; }
        v.coluna.position.set(sx + W / 2 - 2, sy - (tam === 24 ? 76 : 70));
        v.coluna.alpha = talvez ? 0.5 : this.movimentoReduzido ? 0.4 : 0.25 + Math.abs(Math.sin(t * 4)) * 0.25;
        v.coluna.zIndex = z + 3e-5; v.coluna.visible = true; n++;
      } else v.coluna.visible = false;
    }
    return n;
  }

  /**
   * Profundidade de uma pessoa: a soma i + j dela, corrigida contra a caixa dos objetos grandes
   * que ela cobre na tela. Quem está na frente da caixa (passou da borda da frente em i ou em j)
   * vai para depois do objeto; quem está atrás (antes da borda de trás) vai para antes.
   */
  private profundidade(p: Pessoa, sx: number, sy: number, W: number, H: number): number {
    let z = p.pi + p.pj + 0.01, zMin = -Infinity, zMax = Infinity;
    const px1 = sx + W, py1 = sy + H;
    for (const b of this.ordenaveis) {
      if (b.x0 >= px1 || sx >= b.x1 || b.y0 >= py1 || sy >= b.y1) continue;
      const o = b.o;
      const frente = p.pi - 0.3 >= o.i + o.w || p.pj - 0.3 >= o.j + o.d;
      const atras = p.pi + 0.3 <= o.i || p.pj + 0.3 <= o.j;
      if (frente && !atras) zMin = Math.max(zMin, o.chave + 0.003);
      else if (atras && !frente) zMax = Math.min(zMax, o.chave - 0.003);
    }
    if (z < zMin) z = zMin;
    else if (z > zMax) z = zMax;
    return z;
  }

  /** Posiciona um quadro com âncora (ax, ay), espelhando quando preciso. */
  private colocar(s: Sprite, fr: Quadro, ax: number, ay: number, espelho: boolean, _W: number): void {
    if (s.texture !== fr.tex) s.texture = fr.tex;
    if (espelho) { s.scale.x = -1; s.position.set(ax - fr.dx, ay + fr.dy); }
    else { s.scale.x = 1; s.position.set(ax + fr.dx, ay + fr.dy); }
  }

  private atualizarMinis(t: number): number {
    // um par de sprites por mini, indexado pela contagem de minis (sem buracos no pool)
    let k = 0;
    for (const mi of this.m.minis) {
      const v = this.pool.minis[k] ?? (this.pool.minis[k] = [this.spr(this.idPonto, this.minisC), this.spr(this.idIcone.get('lendo')!, this.minisC)]);
      const ids = this.idsMini.get(mi.cor) ?? this.idsMini.values().next().value!;
      v[0].texture = this.q(ids[Math.floor(t * 12) % 2]).tex;
      v[0].position.set(Math.round(mi.x - 6), Math.round(mi.y - 6 + (this.movimentoReduzido ? 0 : Math.sin(t * 4 + mi.x) * 2)));
      v[1].position.set(Math.round(mi.x - 3) - 1, Math.round(mi.y - 20));
      v[0].visible = v[1].visible = true; k++;
    }
    for (let j = k; j < this.pool.minis.length; j++) { this.pool.minis[j][0].visible = false; this.pool.minis[j][1].visible = false; }
    return k * 2;
  }

  private atualizarDrones(t: number): number {
    let n = 0;
    for (const d of this.m.drones) {
      const v = this.pool.drones[n] ?? (this.pool.drones[n] = [this.spr(this.idPonto, this.dronesC), this.spr(this.idPonto, this.dronesC)]);
      const ids = this.idsDrone.get(d.cor) ?? this.idsDrone.get('#ffb347')!;
      v[0].texture = this.q(ids[Math.floor(t * 16) % 2]).tex;
      v[0].position.set(Math.round(d.x - 7), Math.round(d.y - d.z - 6)); v[0].visible = true;
      const idc = this.idCarga.get(d.carga);
      if (idc !== undefined) { const fr = this.q(idc); v[1].texture = fr.tex; v[1].position.set(Math.round(d.x) + fr.dx, Math.round(d.y - d.z + 6) + fr.dy); v[1].visible = true; }
      else v[1].visible = false;
      n++;
    }
    for (let k = n; k < this.pool.drones.length; k++) { this.pool.drones[k][0].visible = false; this.pool.drones[k][1].visible = false; }
    return n * 2;
  }

  private atualizarParticulas(): number {
    let n = 0;
    const lim = this.op.preset.maxParticulas;
    for (const p of this.m.particulas) {
      if (n >= lim) break;
      const s = this.pool.particulas[n] ?? (this.pool.particulas[n] = this.spr(this.idPonto, this.particulasC));
      s.alpha = Math.min(1, Math.max(0, p.vida / p.max) * 1.5);
      s.tint = numeroCor(p.cor) || CORES_PARTICULA_PADRAO;
      const id = p.tipo === 'coracao' ? this.idCoracao : p.tipo === 'z' ? this.idZ : this.idPonto;
      const fr = this.q(id);
      s.texture = fr.tex; s.scale.set(p.tipo === 'px' ? p.tam : 1);
      s.position.set(Math.round(p.x) + fr.dx, Math.round(p.y) + fr.dy);
      s.visible = true; n++;
    }
    for (let k = n; k < this.pool.particulas.length; k++) this.pool.particulas[k].visible = false;
    return n;
  }

  private atualizarTextoEntregas(): void {
    const te = this.textoEntregas; if (!te) return;
    const txt = String(this.m.global.entregas).slice(-4);
    const lr = larguraTexto('ENTREGAS');
    for (let k = 0; k < te.digitos.length; k++) {
      const s = te.digitos[k];
      if (k >= txt.length) { s.visible = false; continue; }
      s.texture = this.q(this.idsDigito[Number(txt[k])]).tex; s.position.set(te.x + lr + 5 + k * 4, te.y - 2); s.visible = true;
    }
  }

  private atualizarLuz(t: number, x0: number, y0: number, vw: number, vh: number, noite: boolean): number {
    const m = this.m;
    this.sol.visible = !noite;
    // apagão (limite de uso): escurece a zona, de dia e de noite
    for (const [zid, ate] of m.global.apagao) {
      let s = this.apagaoSprites.get(zid);
      const z = m.zonaPorId.get(zid);
      if (!z) continue;
      if (!s) {
        s = new Sprite(Texture.WHITE); s.tint = 0x05060f;
        const W = z.i1 - z.i0 + 1, D = z.j1 - z.j0 + 1, [ax, ay] = m.geo.iso(z.i0, z.j0);
        s.setFromMatrix(new Matrix(16 * W, 8 * W, -16 * D, 8 * D, ax, ay));
        this.apagoes.addChild(s); this.apagaoSprites.set(zid, s);
      }
      s.alpha = Math.min(0.55, (ate - m.relogio.agora) * 0.5);
      s.visible = true;
    }
    for (const [zid, s] of this.apagaoSprites) if (!m.global.apagao.has(zid)) s.visible = false;
    let n = 0;
    if (!noite) { for (const b of this.brilhosFixos) b.s.visible = false; for (const s of this.pool.brilhos) s.visible = false; return this.sol.children.length; }
    // brilhos fixos visíveis, limitados pelo preset (os mais fortes ficam)
    const vis: { s: Sprite; int: number }[] = [];
    for (const { s, L } of this.brilhosFixos) {
      let int = L.int;
      if (L.onAir) int = m.global.onAir ? 0.8 : 0;
      if (L.recarga) {
        // cápsula: brilho que respira devagar com o bot dentro; vazia, quase apagada
        const dono = L.recarga.dono ? m.porId.get(L.recarga.dono) : undefined;
        int = dono?.naRecarga ? (this.movimentoReduzido ? 0.2 : 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.3 + L.x))) : 0.05;
      } else if (L.zona) {
        const nz = m.nivelZona(L.zona);
        if (L.neon) int *= luzLetreiro(nz, m.emEspera(L.zona), t, this.movimentoReduzido);
        else if (nz < L.limiar) int = 0;
      }
      if (L.neon && !this.movimentoReduzido && Math.sin(t * 13 + L.x) > 0.985) int *= 0.3;
      if (L.zona && m.global.apagao.has(L.zona)) int *= 0.15;
      const x = L.x - x0, y = L.y - y0;
      const ver = int > 0 && !(x < -L.r || y < -L.r || x > vw + L.r || y > vh + L.r);
      s.visible = false;
      if (ver) { s.alpha = int; vis.push({ s, int }); }
    }
    const max = this.op.preset.maxBrilhos;
    if (vis.length > max) vis.sort((a, b) => b.int - a.int);
    for (let k = 0; k < vis.length && k < max; k++) { vis[k].s.visible = true; n++; }
    // brilhos dinâmicos
    let k = 0;
    const usar = (chave: string, x: number, y: number, alpha: number) => {
      const id = this.idBrilho.get(chave); if (id === undefined) return;
      const s = this.pool.brilhos[k] ?? (this.pool.brilhos[k] = (() => { const sp = this.spr(id, this.luzMundo); sp.blendMode = 'add'; return sp; })());
      const fr = this.q(id); s.texture = fr.tex; s.position.set(Math.round(x) + fr.dx, Math.round(y) + fr.dy); s.alpha = alpha; s.visible = true; k++;
    };
    for (const d of m.drones) usar(`${d.cor}|14`, d.x, d.y - d.z - 10 + 14, 0.6);
    for (const p of m.pessoas) if (p.visivel && (p.estado === 'esperando' || p.estado === 'talvez')) { const [x, y] = m.geo.iso(p.pi, p.pj); usar(p.estado === 'esperando' ? '#ffcf4d|30' : '#d9b45a|26', x, y - 6, p.estado === 'esperando' ? 0.6 : 0.4); } // poça de luz no chão: o ícone em cima da cabeça fica na cor dele
    if (m.global.teleAte > m.relogio.agora) { const [ti, tj] = m.cena.pontos.teletransporte; const [x, y] = m.geo.iso(ti, tj); usar('#9ff3ff|40', x, y - 30, 0.8); }
    for (let j = k; j < this.pool.brilhos.length; j++) this.pool.brilhos[j].visible = false;
    return n + k + 1;
  }

  pontoBalao(p: Pessoa): [number, number] | null {
    if (!p.visivel) return null;
    const [fx, fy] = this.m.geo.iso(p.pi, p.pj, p.z);
    const alt = this.op.tam === 24 ? 54 : 46;
    const sent = p.pose === 'digitando' || p.pose === 'dormir' ? (this.op.tam === 24 ? 4 : 3) : 0;
    return [fx, fy - alt + sent];
  }

  tocar(x: number, y: number): { pessoa?: Pessoa; zona?: string } | null {
    const { w: W, h: H } = DIM[this.op.tam];
    const cands = this.m.pessoas.filter((a) => a.visivel).sort((a, b) => (b.pi + b.pj) - (a.pi + a.pj));
    for (const a of cands) { const [fx, fy] = this.m.geo.iso(a.pi, a.pj, a.z); if (x >= fx - W / 2 && x <= fx + W / 2 && y >= fy - H + 1 && y <= fy + 1) return { pessoa: a }; }
    const [i, j] = this.m.geo.ladrilho(x, y);
    const z = this.m.zonaEm(Math.floor(i), Math.floor(j));
    return z ? { zona: z.id } : null;
  }

  destruir(): void {
    this.palco.destroy({ children: true });
    this.atlas.destruir();
  }
}

