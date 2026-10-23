// Estado vivo do mundo: zonas, objetos, pessoas, drones, pulsos e partículas, construído a
// partir da CenaDados. O simulador (ou, na Fase 3, os eventos do servidor) muda este estado;
// as vistas (isométrica e corte lateral) só leem.
// Alas em espera (stand-by): a sala dorme depois de `ocio.dormeMinutos` sem atividade (campos
// `dormindo` e `ultimaAtividade`, como no servidor) e a ala fica em espera quando todas as salas
// dela dormem e nenhum agente trabalha nela. A luz da ala (nivel) anda devagar para as vistas
// acenderem e apagarem tudo em sequência.
import type { Aparencia, CenaDados, Estado, Personagem, Pose, Sala, ValorProp, Zona } from './formato.ts';
import { criarGeo, type Geo } from '../motor/iso.ts';
import { tipoDe, type CtxObjeto, type TipoObjeto } from '../arte/objetos.ts';
import { ROTULO_ESTADO } from '../arte/estados.ts';
import { rota } from './rota.ts';
import type { Ponto } from '../arte/primitivas.ts';
import type { Carga } from '../arte/efeitos.ts';

export function semeado(sd: number): () => number {
  let s = Math.floor(Math.abs(sd)) % 2147483647; if (s === 0) s = 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export interface ObjRT extends CtxObjeto {
  id: number;
  def: TipoObjeto;
  w: number; d: number; h: number;
  plano: boolean;
  /** Chave de profundidade (borda da frente). */
  chave: number;
  zona: string | null;
  dono: string | null;
}

export interface Drone { origem: () => Ponto; destino: () => Ponto; k: number; dur: number; alt: number; cor: string; carga: Carga; x: number; y: number; z: number; feito: boolean }
export interface Mini { x: number; y: number; cor: string; ate: number; pai: Pessoa }
export interface Pulso { pts: Ponto[]; seg: number[]; total: number; s: number; vel: number; cor: string; zona: string }
export interface Particula { x: number; y: number; vx: number; vy: number; vida: number; max: number; cor: string; tam: number; g: number; tipo: 'px' | 'coracao' | 'z' }
/** Luz do mundo. `limiar`: em que ponto do acordar da ala ela acende (0 a 1). */
export interface LuzRT { x: number; y: number; r: number; cor: string; int: number; neon?: boolean; onAir?: boolean; zona: string | null; limiar: number; recarga?: ObjRT }
export interface Anuncio { quem: string; cor: string; texto: string; quando: number }

/** Estados de descanso: quem está neles não conta como trabalhando na ala. */
export const DESCANSO: ReadonlySet<Estado> = new Set<Estado>(['ocioso', 'pausa', 'dormindo', 'treinando', 'fila']);

export interface EstadoZona {
  /** Em espera (stand-by): todas as salas dormem e ninguém trabalha na ala. */
  espera: boolean;
  /** Luz da ala: 0 em espera, 1 acordada. Anda devagar: as luzes acendem em sequência. */
  nivel: number;
  /** Luz de presença numa ala em espera, quando alguém acordado está nela (0 a 1). */
  presenca: number;
  mudouEm: number;
  /** De onde as luzes acendem: a saída da linha de dados da ala (ladrilho). */
  porta: [number, number];
  /**
   * Instante (s) em que o trabalho chegou a uma ala ainda em espera, ou -1. O acordar visual
   * espera alguém da ala estar dentro dela (a sessão que cruza a porta, o bot na cápsula).
   */
  trabalhoDesde: number;
}

/** Sem ninguém chegando, a ala acorda sozinha depois deste tempo (dado sem androide, por exemplo). */
export const FOLGA_CHEGADA = 45;

/** Velocidade de quem anda (ladrilhos por segundo); a sessão que chega anda mais depressa. */
export const VEL_PADRAO = 2.6, VEL_CHEGADA = 4;

/** Tempo do acordar (as luzes acendem em sequência) e do apagar, em segundos. */
export const TEMPO_ACORDAR = 1.6, TEMPO_APAGAR = 2.6;

export class Pessoa {
  readonly def: Personagem;
  readonly id: string;
  nome: string;
  curto: string;
  cargo: string;
  aparencia: string;
  zona: string;
  casa: [number, number];
  poseCasa: Pose;
  pi: number;
  pj: number;
  z = 0;
  pose: Pose;
  estado: Estado = 'ocioso';
  desde = 0;
  tarefa: string;
  historico: { t: number; texto: string }[] = [];
  caminho: [number, number][] = [];
  passosTotal = 0;
  costas = false;
  espelho = false;
  ocupado = false;
  emCasa = true;
  /** Bot dentro da cápsula de recarga (em espera, olhos apagados). */
  naRecarga = false;
  /** Instante (s) da última tarefa: os tempos de ócio contam daqui. */
  ultimaTarefa = 0;
  /** Instante (s) em que chegou ao posto (sessão nova, bot saindo da cápsula): logo depois, nada de pausa. */
  chegouEm = -999;
  visivel: boolean;
  alpha = 1;
  t: number;
  vel: number;
  bolha = { texto: '', ate: -1, prio: 0, tipo: '' };
  /** Para o corte lateral: de que zona saiu e para qual vai. */
  zonaOrigem: string | null = null;
  zonaDestino: string | null = null;
  private mundo: Mundo;

  constructor(def: Personagem, mundo: Mundo, t0: number) {
    this.def = def; this.id = def.id; this.nome = def.nome; this.curto = def.curto; this.cargo = def.cargo; this.aparencia = def.aparencia;
    this.zona = def.zona; this.casa = def.casa; this.poseCasa = def.poseCasa;
    this.pi = def.casa[0] + 0.5; this.pj = def.casa[1] + 0.5;
    this.pose = def.poseCasa;
    this.tarefa = def.tarefaInicial ?? 'Sem tarefa agora';
    this.visivel = def.visivel !== false;
    this.t = t0;
    this.vel = def.tipo === 'npc' ? 1.8 : VEL_PADRAO;
    this.mundo = mundo;
  }

  get ap(): Aparencia | undefined { return this.mundo.cena.aparencias[this.aparencia]; }

  get tipoAgente(): Personagem['tipoAgente'] { return this.def.tipoAgente; }

  /** Zona onde a pessoa trabalha agora: a do posto em que está sentada, ou a de casa. */
  get zonaTrabalho(): string {
    return this.emCasa ? (this.mundo.zonaEm(Math.floor(this.pi), Math.floor(this.pj))?.id ?? this.zona) : this.zona;
  }

  definir(estado: Estado, tarefa?: string, bolha = true): void {
    this.estado = estado; this.desde = this.mundo.relogio.agora;
    // trabalho marca a sala (acorda a ala, como um evento no servidor)
    if (!DESCANSO.has(estado)) { this.ultimaTarefa = this.mundo.relogio.agora; this.mundo.atividade(this.zonaTrabalho); }
    if (tarefa) this.tarefa = tarefa;
    this.historico.unshift({ t: this.mundo.relogio.agora, texto: tarefa ?? ROTULO_ESTADO[estado] });
    if (this.historico.length > 6) this.historico.length = 6;
    if (bolha && tarefa) this.falar(tarefa, estado === 'esperando' ? 5 : estado === 'erro' ? 4 : 2, estado);
  }

  falar(texto: string, prio = 1, tipo = '', dur = 5): void {
    this.bolha = { texto, ate: this.mundo.relogio.agora + dur, prio, tipo };
  }

  irPara(alvo: [number, number]): void {
    const de: [number, number] = [Math.floor(this.pi), Math.floor(this.pj)];
    this.zonaOrigem = this.mundo.zonaEm(de[0], de[1])?.id ?? this.zonaOrigem;
    this.zonaDestino = this.mundo.zonaEm(alvo[0], alvo[1])?.id ?? null;
    this.caminho = rota(this.mundo.geo.ni, this.mundo.geo.nj, this.mundo.bloqueado, de, alvo);
    this.passosTotal = this.caminho.length;
    this.emCasa = false;
  }

  atualizar(dt: number): void {
    // o passo da animação acompanha a velocidade (quem anda mais rápido dá passos mais rápidos)
    if (this.estado !== 'semSinal') this.t += this.caminho.length ? dt * (this.vel / VEL_PADRAO) : dt;
    if (!this.caminho.length) return;
    const [ti, tj] = this.caminho[0];
    const ai = ti + 0.5, aj = tj + 0.5, di = ai - this.pi, dj = aj - this.pj, dist = Math.hypot(di, dj), passo = this.vel * dt;
    if (Math.abs(di) > Math.abs(dj)) { this.costas = di < 0; this.espelho = di < 0; } else if (dj !== 0) { this.costas = dj < 0; this.espelho = dj > 0; }
    if (dist <= passo) { this.pi = ai; this.pj = aj; this.caminho.shift(); }
    else { this.pi += (di / dist) * passo; this.pj += (dj / dist) * passo; }
  }

  get andando(): boolean { return this.caminho.length > 0; }
  /** Progresso no caminho atual (0 a 1), para o corte lateral. */
  get progresso(): number { return this.passosTotal ? 1 - this.caminho.length / this.passosTotal : 1; }
}

export interface EstadoGlobal {
  erroAte: number;
  teleAte: number;
  atividade: number;
  entregas: number;
  onAir: boolean;
  apagao: Map<string, number>;
  faseRack: number;
}

export class Mundo {
  readonly cena: CenaDados;
  readonly geo: Geo;
  readonly zonas: Zona[];
  readonly zonaPorId: Map<string, Zona>;
  private indiceZona: Int16Array;
  bloqueado: Uint8Array;
  objetos: ObjRT[] = [];
  pessoas: Pessoa[] = [];
  porId = new Map<string, Pessoa>();
  drones: Drone[] = [];
  minis: Mini[] = [];
  pulsos: Pulso[] = [];
  particulas: Particula[] = [];
  luzes: LuzRT[] = [];
  anuncios: Anuncio[] = [];
  relogio = { agora: 0 };
  tAnim = 0;
  global: EstadoGlobal = { erroAte: 0, teleAte: 0, atividade: 0, entregas: 12, onAir: false, apagao: new Map(), faseRack: 0 };
  obra = { fase: 'vazio' as 'vazio' | 'obra' | 'pronta', inicio: 0 };
  /** Foco do aquário: um ponto fixo ou alguém andando (a sessão que chega pelo teletransporte). */
  focoForcado: { x: number; y: number; ate: number; pessoa?: Pessoa } | null = null;
  noite = false;
  maxParticulas = 400;
  /** Sobe quando objetos ou pessoas entram (as vistas sincronizam). */
  versao = 0;
  readonly rng: () => number;
  readonly rngFx: () => number;
  readonly rngExtra: () => number;
  ouvintes: { anuncio?: (a: Anuncio) => void; zona?: (zonaId: string, acordou: boolean) => void } = {};
  /** Estado de espera de cada zona (áreas comuns nunca entram em espera). */
  readonly estadoZona = new Map<string, EstadoZona>();
  readonly salasPorZona = new Map<string, Sala[]>();
  /** Relógio de parede no início da simulação: `ultimaAtividade` fica em ms desde 1970, como no servidor. */
  readonly inicioEpoch: number;
  private trabalhoZona = new Set<string>();
  private presencaZona = new Set<string>();
  /** Zonas com algum agente fisicamente dentro (inclusive o bot na cápsula). */
  private agenteDentro = new Set<string>();

  constructor(cena: CenaDados, semente: number, inicioEpoch = Date.now()) {
    this.cena = cena;
    this.inicioEpoch = inicioEpoch;
    this.geo = criarGeo(cena.andar.ni, cena.andar.nj, cena.andar.parede);
    this.zonas = cena.zonas;
    this.zonaPorId = new Map(cena.zonas.map((z) => [z.id, z]));
    const { ni, nj } = this.geo;
    this.indiceZona = new Int16Array(ni * nj).fill(-1);
    cena.zonas.forEach((z, k) => { for (let j = z.j0; j <= z.j1; j++) for (let i = z.i0; i <= z.i1; i++) if (i < ni && j < nj) this.indiceZona[j * ni + i] = k; });
    this.bloqueado = new Uint8Array(ni * nj);
    this.rng = semeado(semente);
    this.rngFx = semeado(semente * 31 + 7);
    this.rngExtra = semeado(semente * 17 + 3);
    // salas e estado de espera das zonas; sem última atividade nos dados, a semente estima uma
    // (sala acordada: há pouco; sala dormindo: entre 30 min e 8 h atrás)
    const rs = semeado(semente + 5);
    for (const s of cena.salas) {
      if (!s.ultimaAtividade) s.ultimaAtividade = inicioEpoch - (s.dormindo ? (30 + rs() * 450) * 60000 : rs() * 60000);
      const l = this.salasPorZona.get(s.zona) ?? []; l.push(s); this.salasPorZona.set(s.zona, l);
    }
    for (const z of cena.zonas) {
      const linha = cena.linhas.find((l) => l.zona === z.id);
      const porta: [number, number] = linha ? [linha.pontos[0][0], linha.pontos[0][1]] : [(z.i0 + z.i1 + 1) / 2, (z.j0 + z.j1 + 1) / 2];
      const salas = this.salasPorZona.get(z.id) ?? [];
      const espera = z.tipo === 'ala' && salas.length > 0 && salas.every((s) => s.dormindo);
      this.estadoZona.set(z.id, { espera, nivel: espera ? 0 : 1, presenca: 0, mudouEm: -999, porta, trabalhoDesde: -1 });
    }
    for (const o of cena.objetos) this.adicionarObjeto(o.tipo, o.i, o.j, o.props ?? {});
    const r0 = semeado(semente + 99);
    for (const p of cena.personagens) this.adicionarPessoa(p, r0() * 5);
    this.montarLuzes();
  }

  /* ---------- salas, ócio e espera ---------- */
  agoraEpoch(): number { return this.inicioEpoch + this.relogio.agora * 1000; }
  emEspera(zonaId: string | null): boolean { return !!zonaId && !!this.estadoZona.get(zonaId)?.espera; }
  /** Luz da zona, de 0 (em espera) a 1 (acordada). Áreas e corredores: sempre 1. */
  nivelZona(zonaId: string | null): number { return zonaId ? (this.estadoZona.get(zonaId)?.nivel ?? 1) : 1; }
  presencaNaZona(zonaId: string | null): number { return zonaId ? (this.estadoZona.get(zonaId)?.presenca ?? 0) : 0; }
  ultimaAtividadeZona(zonaId: string): number { return Math.max(0, ...(this.salasPorZona.get(zonaId) ?? []).map((s) => s.ultimaAtividade)); }

  /** Em que ponto do acordar (0 a 1) um ladrilho da zona acende: de perto da porta para dentro. */
  limiarEm(zonaId: string | null, i: number, j: number): number {
    const z = zonaId ? this.zonaPorId.get(zonaId) : null;
    const e = zonaId ? this.estadoZona.get(zonaId) : null;
    if (!z || !e) return 0;
    const d = Math.hypot(i - e.porta[0], j - e.porta[1]), dmax = Math.hypot(z.i1 - z.i0 + 1, z.j1 - z.j0 + 1);
    return 0.08 + 0.7 * Math.min(1, d / dmax);
  }

  /** Sala nova (obra): entra na cena e na lista da zona. */
  adicionarSala(s: Sala): void {
    this.cena.salas.push(s);
    const l = this.salasPorZona.get(s.zona) ?? []; l.push(s); this.salasPorZona.set(s.zona, l);
  }

  /** Atividade numa zona (um evento numa sala): as salas acordam e a ala sai da espera. */
  atividade(zonaId: string): void {
    const salas = this.salasPorZona.get(zonaId);
    if (!salas) return;
    const agora = this.agoraEpoch();
    for (const s of salas) { s.ultimaAtividade = agora; s.dormindo = false; }
    const z = this.zonaPorId.get(zonaId), e = this.estadoZona.get(zonaId);
    if (z && e) this.reavaliarZona(z, e);
  }

  /**
   * Espera e acordar de uma ala. Entra em espera quando todas as salas dormem e ninguém trabalha
   * nela. Sai da espera quando o trabalho chega (sala acordada, como no servidor) e há alguém da
   * ala dentro dela: o bot na cápsula acorda a ala na hora; a sessão que vem do teletransporte
   * acorda a ala quando cruza a porta, com a câmera indo junto (na Fase 3 vale o mesmo para o
   * `sala.dormindo` do servidor). Sem ninguém chegando, acorda depois de FOLGA_CHEGADA segundos.
   */
  private reavaliarZona(z: Zona, e: EstadoZona): void {
    const salas = this.salasPorZona.get(z.id) ?? [];
    if (z.tipo !== 'ala' || !salas.length) return;
    const ativa = !salas.every((s) => s.dormindo) || this.trabalhoZona.has(z.id);
    const agora = this.relogio.agora;
    let alvo = e.espera;
    if (!e.espera) { if (!ativa) alvo = true; }
    else if (!ativa) e.trabalhoDesde = -1;
    else {
      if (e.trabalhoDesde < 0) e.trabalhoDesde = agora;
      const obraAqui = this.obra.fase === 'obra' && this.cena.pontos.terreno?.zona === z.id;
      if (this.agenteDentro.has(z.id) || obraAqui || agora - e.trabalhoDesde >= FOLGA_CHEGADA) alvo = false;
    }
    if (alvo === e.espera) return;
    e.espera = alvo; e.mudouEm = agora; e.trabalhoDesde = -1;
    if (!alvo) {
      this.emitirPulso(z.id, '#3ee0ff', 3);
      this.anunciar({ nome: z.titulo, cor: z.cor }, 'acordou com trabalho novo');
      // o aquário vai até a ala que acordou (se ninguém mais estiver com o foco)
      if (!this.focoForcado || this.focoForcado.ate <= this.relogio.agora) {
        const [x, y] = this.geo.iso((z.i0 + z.i1 + 1) / 2, (z.j0 + z.j1 + 1) / 2);
        this.focoForcado = { x, y: y - 26, ate: this.relogio.agora + 7 };
      }
    } else this.anunciar({ nome: z.titulo, cor: z.cor }, 'ficou em espera');
    this.ouvintes.zona?.(z.id, !alvo);
  }

  /** Um passo do ócio: salas dormem, alas entram e saem da espera, luzes andam. */
  atualizarOcio(dt: number): void {
    const agora = this.agoraEpoch(), dormeMs = this.cena.ocio.dormeMinutos * 60000;
    for (const s of this.cena.salas) if (!s.dormindo && agora - s.ultimaAtividade >= dormeMs) s.dormindo = true;
    // quem trabalha (por zona) e quem está acordado dentro de uma ala em espera (luz de presença)
    this.trabalhoZona.clear(); this.presencaZona.clear(); this.agenteDentro.clear();
    for (const p of this.pessoas) {
      if (!p.visivel) continue;
      const z = this.zonaEm(Math.floor(p.pi), Math.floor(p.pj));
      if (p.def.tipo === 'agente') {
        if (!DESCANSO.has(p.estado)) this.trabalhoZona.add(p.zonaTrabalho);
        // só conta quem é da ala (ou trabalha nela): quem só passa pelo meio não acorda ninguém
        if (z && (p.zona === z.id || p.zonaTrabalho === z.id)) this.agenteDentro.add(z.id);
      }
      if (p.naRecarga || p.estado === 'dormindo' || p.def.papel === 'figurante') continue;
      if (z && this.estadoZona.get(z.id)?.espera) this.presencaZona.add(z.id);
    }
    for (const z of this.zonas) {
      const e = this.estadoZona.get(z.id)!;
      if (z.tipo === 'ala') this.reavaliarZona(z, e);
      const alvo = e.espera ? 0 : 1;
      if (e.nivel < alvo) e.nivel = Math.min(1, e.nivel + dt / TEMPO_ACORDAR);
      else if (e.nivel > alvo) e.nivel = Math.max(0, e.nivel - dt / TEMPO_APAGAR);
      const pr = e.espera && this.presencaZona.has(z.id) ? 1 : 0;
      if (e.presenca < pr) e.presenca = Math.min(1, e.presenca + dt / 0.7);
      else if (e.presenca > pr) e.presenca = Math.max(0, e.presenca - dt / 1.2);
    }
  }

  zonaEm(i: number, j: number): Zona | null {
    const { ni, nj } = this.geo;
    if (i < 0 || j < 0 || i >= ni || j >= nj) return null;
    const k = this.indiceZona[j * ni + i];
    return k >= 0 ? this.zonas[k] : null;
  }

  adicionarObjeto(tipo: string, i: number, j: number, props: Record<string, ValorProp>): ObjRT {
    const def = tipoDe(tipo);
    const o: ObjRT = {
      id: this.objetos.length, tipo, i, j, props, def, w: def.w, d: def.d, h: def.h, plano: !!def.plano,
      chave: (i + def.w) + (j + def.d) - 1.5, zona: this.zonaEm(i, j)?.id ?? null, dono: typeof props.dono === 'string' ? props.dono : null,
    };
    this.objetos.push(o);
    if (def.bloqueia !== false) {
      const { ni, nj } = this.geo;
      for (let a = 0; a < o.w; a++) for (let b = 0; b < o.d; b++) { const ii = i + a, jj = j + b; if (ii < ni && jj < nj) this.bloqueado[jj * ni + ii] = 1; }
    }
    this.versao++;
    return o;
  }

  adicionarPessoa(def: Personagem, t0: number): Pessoa {
    const p = new Pessoa(def, this, t0);
    this.pessoas.push(p); this.porId.set(p.id, p);
    this.versao++;
    return p;
  }

  montarLuzes(): void {
    const L: LuzRT[] = [];
    for (const o of this.objetos) {
      if (!o.def.luzes) continue;
      const limiar = this.limiarEm(o.zona, o.i + o.w / 2, o.j + o.d / 2);
      for (const l of o.def.luzes(o)) { const [x, y] = this.geo.iso(o.i + l.ii, o.j + l.jj, l.z); L.push({ x, y, r: l.r, cor: l.cor, int: l.int, zona: o.zona, limiar, recarga: o.tipo === 'recarga' ? o : undefined }); }
    }
    for (const t of this.cena.letreiros) { const p = this.geo.mapaParede(t.parede, t.u, 66); L.push({ x: p[0], y: p[1], r: 46, cor: t.cor, int: 0.45, neon: true, zona: t.zona ?? null, limiar: 0.86 }); }
    for (const jan of this.cena.janelas) for (let u = jan.u0 + 24; u < jan.u1; u += 48) { const p = this.geo.mapaParede(jan.parede, u, 30); L.push({ x: p[0], y: p[1] + 14, r: 34, cor: '#5a7dff', int: 0.35, zona: null, limiar: 0 }); }
    for (const d of this.cena.decoracoes) if (d.tipo === 'onAir') { const p = this.geo.mapaParede(d.parede, (d.u0 + d.u1) / 2, 63); L.push({ x: p[0], y: p[1], r: 22, cor: '#ff3030', int: 0, onAir: true, zona: null, limiar: 0 }); }
    this.luzes = L;
    this.versao++;
  }

  /** Ponto acima da cabeça de alguém (drones e partículas saem daí). */
  topo(p: Pessoa, alt = 30): Ponto { const [x, y] = this.geo.iso(p.pi, p.pj, p.z); return [x, y - alt]; }

  anunciar(p: Pessoa | { nome: string; cor: string }, texto: string): void {
    const cor = p instanceof Pessoa ? corPessoa(p) : p.cor;
    const a: Anuncio = { quem: p.nome, cor, texto, quando: this.relogio.agora };
    this.anuncios.push(a);
    if (this.anuncios.length > 12) this.anuncios.shift();
    this.ouvintes.anuncio?.(a);
  }

  particula(x: number, y: number, o: Partial<Particula> = {}): void {
    if (this.particulas.length >= this.maxParticulas) return;
    const r = this.rngFx;
    const vida = o.vida ?? 0.6 + r() * 0.6;
    this.particulas.push({ x, y, vx: o.vx ?? -6 + r() * 12, vy: o.vy ?? -18 + r() * 12, vida, max: vida, cor: o.cor ?? '#ffffff', tam: o.tam ?? 1, g: o.g ?? 0, tipo: o.tipo ?? 'px' });
  }

  lancarDrone(origem: () => Ponto, destino: () => Ponto, o: { dur?: number; alt?: number; cor?: string; carga?: Carga } = {}): Drone {
    const d: Drone = { origem, destino, k: 0, dur: o.dur ?? 2.2, alt: o.alt ?? 38, cor: o.cor ?? '#ffb347', carga: o.carga ?? 'envelope', x: 0, y: 0, z: 0, feito: false };
    this.drones.push(d);
    return d;
  }

  emitirPulso(zonaId: string, cor: string, n = 2): void {
    const linha = this.cena.linhas.find((l) => l.zona === zonaId);
    if (!linha) return;
    const pts = linha.pontos.map(([i, j]) => this.geo.iso(i, j));
    let total = 0; const seg: number[] = [];
    for (let k = 0; k + 1 < pts.length; k++) { const d = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); seg.push(d); total += d; }
    for (let m = 0; m < n; m++) this.pulsos.push({ pts, seg, total, s: -m * 14, vel: 120, cor, zona: zonaId });
  }

  /** Avança efeitos (drones, pulsos, partículas, minidrones) e o estado global. */
  atualizarEfeitos(dt: number): void {
    const agentes = this.pessoas.filter((p) => p.def.tipo === 'agente' && p.visivel);
    this.global.atividade = agentes.filter((p) => !DESCANSO.has(p.estado)).length / Math.max(1, agentes.length);
    this.global.onAir = this.pessoas.some((p) => p.estado === 'comando' && p.emCasa && this.zonaPorId.get(p.zona)?.tema === 'estudio');
    this.global.faseRack += dt * (2 + this.global.atividade * 1.5);
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      d.k = Math.min(1, d.k + dt / d.dur);
      const o = d.origem(), f = d.destino();
      const u = d.k * d.k * (3 - 2 * d.k);
      d.x = o[0] + (f[0] - o[0]) * u; d.y = o[1] + 30 + (f[1] - o[1]) * u; d.z = 30 + Math.sin(Math.PI * u) * d.alt;
      if (this.rngFx() < 0.35) this.particula(d.x, d.y - d.z + 4, { cor: d.cor, vx: 0, vy: 4, vida: 0.4, tam: 1 });
      if (d.k >= 1) { d.feito = true; this.drones.splice(i, 1); }
    }
    for (let i = this.pulsos.length - 1; i >= 0; i--) { const p = this.pulsos[i]; p.s += p.vel * dt; if (p.s > p.total) this.pulsos.splice(i, 1); }
    for (let i = this.particulas.length - 1; i >= 0; i--) { const p = this.particulas[i]; p.vida -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; if (p.vida <= 0) this.particulas.splice(i, 1); }
    for (let i = this.minis.length - 1; i >= 0; i--) {
      const m = this.minis[i]; const [x, y] = this.topo(m.pai);
      const k = Math.min(1, dt * 3);
      m.x += (x + 16 + Math.cos(this.tAnim * 2) * 6 - m.x) * k; m.y += (y - 6 - m.y) * k;
      if (this.relogio.agora > m.ate) this.minis.splice(i, 1);
    }
    for (const [z, ate] of this.global.apagao) if (ate < this.relogio.agora) this.global.apagao.delete(z);
  }
}

export function pontoNaLinha(p: Pulso, s: number): Ponto {
  let rest = s;
  for (let k = 0; k < p.seg.length; k++) {
    if (rest <= p.seg[k]) { const t = rest / p.seg[k]; return [p.pts[k][0] + (p.pts[k + 1][0] - p.pts[k][0]) * t, p.pts[k][1] + (p.pts[k + 1][1] - p.pts[k][1]) * t]; }
    rest -= p.seg[k];
  }
  return p.pts[p.pts.length - 1];
}

export function corPessoa(p: Pessoa): string {
  const ap = p.ap;
  if (!ap) return '#a9aed6';
  if (ap.tipo === 'androide') return ap.papel;
  if (ap.tipo === 'humano') return ap.cabelo.cor === '#000000' ? ap.roupa : (p.def.papel === 'fixo' ? ap.cabelo.luz : '#f2b45a');
  return ap.cor;
}
