// Coreógrafo: liga o estado do servidor (espelho do snapshot e do SSE) ao mundo. Não decide nada
// de negócio: estado, sala, fila "precisa de você", obras e métricas chegam prontos do servidor;
// aqui cada mudança vira lugar e gesto (seção 4.3 do prompt, ADRs 0003 e 0004):
//   - sessão que chega: feixe no teletransporte e caminhada até a mesa, com a câmera do aquário
//     junto; que sai (saindo) ou dorme (dormindo): volta pelo teletransporte;
//   - bot em pausa ou dormindo: cápsula de recarga da própria ala; com trabalho, volta à mesa;
//   - sessão em pausa: academia ou lounge (de noite, cochila na mesa);
//   - na fila: recepção; sem sinal: congela translúcido onde está; limite: apagão na ala;
//   - delegação: drone com envelope até o colega e de volta na conclusão; pedido seu: drone do
//     Cockpit; espera resolvida: drone verde com o check; entrega: confete e pacote até o Núcleo;
//   - subagente: minidrone ao lado do pai, com o ícone do estado dele;
//   - sala nova: obra num terreno da ala e, no fim, a cápsula com o nome dela. Sem terreno livre na
//     ala, o andar cresce: o mundo é remontado com um anexo de cápsulas, e a obra continua lá.
// Quadro velho (mais de 20 s, como na volta de uma aba escondida) muda o lugar sem anúncio, balão
// nem drone. Na carga e no resync, todo mundo vai direto para o lugar certo.
import type { Estado, Personagem, PostoCena, Sala as SalaMundo, Spot } from '../cena/formato.ts';
import { Mundo, Pessoa, VEL_CHEGADA, VEL_PADRAO, type ObjRT } from '../cena/mundo.ts';
import type { Simulador } from '../cena/simulador.ts';
import { CORES_ESTADO, PRIORIDADE } from '../arte/estados.ts';
import { assinaturaAlas, type Espelho, type Sinal } from './espelho.ts';
import type { Agente, ArcadiaEvent, Delegacao, EstadoAgente, Obra, SalaServidor } from './tipos.ts';
import { APARENCIAS_SESSAO, aparenciaDoAgente, chaveAparencia } from './aparencias.ts';
import type { MapaPlanta } from './planta.ts';

type Espera = { ate: number } | (() => boolean);
type Roteiro = Generator<Espera, void, unknown>;
export type Lugar = 'posto' | 'recarga' | 'pausa' | 'fila' | 'fora';

/** Estado do servidor para o estado do mundo (ADR 0003). */
export const ESTADO_MUNDO: Record<EstadoAgente, Estado> = {
  chegando: 'chegando', pensando: 'pensando', lendo: 'lendo', editando: 'editando', comando: 'comando', trabalhando: 'comando',
  delegando: 'delegando', esperando: 'esperando', 'talvez-esperando': 'talvez', erro: 'erro', entregou: 'entregou', ocioso: 'ocioso',
  pausa: 'pausa', dormindo: 'dormindo', 'na-fila': 'fila', 'sem-sinal': 'semSinal', limite: 'limite', saindo: 'ocioso',
};

/** Rótulo do estado do servidor, para cartões e faixa de eventos. */
export const ROTULO_SERVIDOR: Record<EstadoAgente, string> = {
  chegando: 'chegando', pensando: 'pensando', lendo: 'lendo', editando: 'editando', comando: 'rodando comando', trabalhando: 'trabalhando',
  delegando: 'delegando', esperando: 'esperando você', 'talvez-esperando': 'talvez esperando você', erro: 'erro', entregou: 'entregou',
  ocioso: 'ocioso', pausa: 'em pausa', dormindo: 'dormindo', 'na-fila': 'na fila', 'sem-sinal': 'sem sinal', limite: 'limite de uso', saindo: 'saindo',
};

const TRABALHO: ReadonlySet<EstadoAgente> = new Set<EstadoAgente>(['pensando', 'lendo', 'editando', 'comando', 'trabalhando', 'delegando']);
export const NOME_MOTOR: Record<string, string> = { claude: 'Claude', codex: 'Codex', outro: 'Agente' };

/** Quadro mais velho que isso muda o lugar sem animação. */
export const ANIMA_ATE_MS = 20_000;

export function nomeDoAgente(a: Agente): string {
  if (a.nome) return a.nome;
  const motor = NOME_MOTOR[a.motor] ?? 'Agente';
  return a.tipo === 'subagente' ? `Subagente do ${motor}` : motor;
}
export function curtoDoAgente(a: Agente): string { const n = nomeDoAgente(a); return n.length > 12 ? n.split(/\s+/)[0] : n; }
export function cargoDoAgente(a: Agente): string {
  if (a.tipo === 'bot') return [a.cargo ?? 'Bot', a.equipe].filter(Boolean).join(' · ');
  const motor = NOME_MOTOR[a.motor] ?? 'Agente';
  return a.tipo === 'subagente' ? `Subagente do ${motor}` : `Sessão do ${motor}`;
}

/**
 * Nome da sala na placa da cápsula: até 12 letras. Passou disso, as palavras do começo viram
 * abreviação com ponto ("PORT. AURORA") e a última fica inteira; sem espaço, corta.
 */
export function nomeCurto(nome: string): string {
  let p = nome.replace(/([a-zà-ú])([A-ZÀ-Ú])/g, '$1 $2').toUpperCase().split(/[^A-Z0-9ÁÀÂÃÉÊÍÓÔÕÚÜÇ]+/).filter(Boolean);
  const cabe = (l: string[]) => l.join(' ').length <= 12;
  if (!p.length) return 'SALA';
  if (cabe(p)) return p.join(' ');
  // sem as palavras de ligação; depois, só as duas últimas palavras (o começo costuma ser comum)
  const ligacao = new Set(['A', 'O', 'E', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'EM', 'NA', 'NO']);
  p = p.filter((x, k) => k === p.length - 1 || !ligacao.has(x));
  if (cabe(p)) return p.join(' ');
  if (p.length >= 3 && cabe(p.slice(-2))) return p.slice(-2).join(' ');
  if (p.length < 2) return p[0].slice(0, 12);
  // última palavra comprida (9 letras ou mais) diz mais sozinha do que abreviada
  if (p[p.length - 1].length >= 9) return p[p.length - 1].slice(0, 12);
  const ult = p[p.length - 1].slice(0, 9), antes = p.slice(0, -1).slice(-2);
  const cada = Math.floor((12 - ult.length - antes.length) / antes.length);
  if (cada < 2) return p.join(' ').slice(0, 12).trim();
  return [...antes.map((x) => (x.length <= cada ? x : `${x.slice(0, cada - 1)}.`)), ult].join(' ');
}

function hash(s: string): number { let h = 0x811c9dc5; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); } return h >>> 0; }

interface PostoRT extends PostoCena { zona: string; dono: string | null; sala?: string; obj?: ObjRT }

export interface Ator {
  chave: string;
  p: Pessoa;
  bot: boolean;
  zona: string;
  sala: string | undefined;
  posto: PostoRT | null;
  recarga: ObjRT | null;
  spot: Spot | null;
  fila: number;
  /** Para onde vai (ou onde já está). */
  alvo: Lugar;
  rot: { g: Roteiro; e: Espera } | null;
  estado: EstadoAgente;
  cochilo: boolean;
  proxZ: number;
  ultimoPulso: number;
  /** Instante (servidor) do último sinal deste agente: decide se a próxima mudança anima. */
  ultimoSinal: number;
  /** Chegando ao posto (do teletransporte ou da cápsula): mostra "chegando" até sentar. */
  entrando: boolean;
  /** Fumaça do erro: sai em baforadas até este instante (relógio do mundo). */
  fumacaAte: number;
  proxFumaca: number;
  /** Pausas que já fez: a próxima alterna entre a academia e o lounge. */
  pausas: number;
}

export interface ItemPrecisa { p: Pessoa; tipo: string; desde: number; sala?: string; chave: string }

export class Coreografo {
  readonly m: Mundo;
  readonly espelho: Espelho;
  readonly mapa: MapaPlanta;
  readonly amb: Simulador;
  readonly atores = new Map<string, Ator>();
  readonly assinatura: string;
  /** A planta mudou (ala nova, renomeada ou que saiu): quem criou o mundo remonta tudo. */
  aoRemontar: (() => void) | null = null;
  private postos = new Map<string, PostoRT[]>();
  private podDaSala = new Map<string, PostoRT>();
  private salaMundo = new Map<string, SalaMundo>();
  private vagaReservada = new Map<string, [number, number]>();
  private vagasUsadas = new Set<string>();
  /** Zona da cápsula de cada sala (a da planta ou, para sala que nasceu depois, a que tinha terreno). */
  private zonaEscolhida = new Map<string, string>();
  private recargasUsadas = new Set<string>();
  private filaDe: (string | null)[];
  private efeitos: { g: Roteiro; e: Espera }[] = [];
  private luzesSujas = false;
  private entregasAlvo = 0;
  private cubosNoAr = 0;
  private remontando = false;
  private versaoUrgentes = -1;

  constructor(m: Mundo, espelho: Espelho, mapa: MapaPlanta, amb: Simulador) {
    this.m = m; this.espelho = espelho; this.mapa = mapa; this.amb = amb;
    m.servidor = true;
    amb.soAmbiente = true;
    for (const [zona, lista] of Object.entries(m.cena.postos)) this.postos.set(zona, lista.map((p) => ({ ...p, zona, dono: p.ocupadoPor ?? null, obj: p.mesa !== undefined ? m.objetos[p.mesa] : undefined })));
    for (const o of m.objetos) if (o.tipo === 'recarga') this.recargasUsadas.add(`${o.i},${o.j}`);
    this.filaDe = m.cena.pontos.fila.map(() => null);
    this.assinatura = assinaturaAlas(espelho.estado);
    // os terrenos que a planta já deu a cada sala ficam guardados: sala nova nunca toma o de outra
    for (const [chave, pl] of mapa.salas) {
      const v = m.cena.vagasPod[pl.zona]?.[pl.vaga];
      if (!v) continue;
      this.vagasUsadas.add(`${pl.zona}|${pl.vaga}`); this.vagaReservada.set(chave, v); this.zonaEscolhida.set(chave, pl.zona);
    }
    for (const [k, ap] of Object.entries(APARENCIAS_SESSAO)) { m.cena.aparencias[k] = ap; m.aparenciasPrevistas.push(k); }
  }

  /* ======================= carga e resync ======================= */

  /** Carga: salas, cápsulas e agentes direto no lugar, antes de a vista assar o atlas. */
  montar(): void {
    const e = this.espelho.estado;
    // o que chegou antes de montar já está no estado: nada de animar de novo
    this.espelho.tirarSinais();
    for (const s of this.salasEmOrdem()) this.atualizarSala(s);
    // obra recente (a carga ou a remontagem do andar que cresceu para ela): a câmera vai até lá
    for (const ob of e.obras) this.iniciarObra(ob, false, this.recente(ob.inicio));
    this.colocarPods(false);
    for (const a of Object.values(e.agentes)) {
      if (a.tipo === 'humano' || a.tipo === 'subagente') continue;
      const at = this.criarAtor(a);
      // quem está chegando agora (a carga ou a remontagem bem na hora da chegada) entra pelo teletransporte
      if (a.estado === 'chegando' && this.recente(a.desde)) { at.ultimoSinal = a.desde; this.iniciar(at, this.lugarDesejado(a, at), true); }
      else this.colocar(at, this.lugarDesejado(a, at));
    }
    this.reconciliarMinis();
    this.entregasAlvo = e.metricas.entregas; this.m.global.entregas = e.metricas.entregas; this.m.global.erros = e.metricas.erros;
    this.atualizarUrgentes();
    if (this.luzesSujas) { this.m.montarLuzes(); this.luzesSujas = false; }
    this.m.assentarZonas();
    const dono = this.dono(), fixo = this.m.pessoas.find((p) => p.def.papel === 'fixo');
    if (dono) { dono.estado = 'ocioso'; dono.falar(dono.def.falas?.saudacao ?? 'Bem-vindo ao Arcadia', 2, 'dono', 6); }
    if (fixo) { fixo.estado = 'ocioso'; fixo.falar(fixo.def.falas?.inicio ?? 'Trabalhando', 1, 'fixo', 6); }
  }

  /** O espelho trocou o estado inteiro (resync): tudo direto para o lugar, sem animação. */
  ressincronizar(): void {
    const e = this.espelho.estado;
    if (assinaturaAlas(e) !== this.assinatura) { this.pedirRemontagem(); return; }
    this.espelho.tirarSinais();
    for (const s of this.salasEmOrdem()) this.atualizarSala(s);
    this.m.obras = this.m.obras.filter((o) => e.obras.some((x) => x.salaChave === o.chave));
    for (const ob of e.obras) this.iniciarObra(ob, false);
    this.colocarPods(false);
    for (const a of Object.values(e.agentes)) {
      if (a.tipo === 'humano' || a.tipo === 'subagente') continue;
      const at = this.atores.get(a.chave) ?? this.criarAtor(a);
      at.estado = a.estado;
      this.mudarZona(at, a, false);
      this.colocar(at, this.lugarDesejado(a, at));
    }
    for (const at of [...this.atores.values()]) if (!e.agentes[at.chave]) this.removerAtor(at);
    this.reconciliarMinis();
    this.entregasAlvo = e.metricas.entregas; this.m.global.entregas = e.metricas.entregas;
    this.atualizarUrgentes();
    if (this.luzesSujas) { this.m.montarLuzes(); this.luzesSujas = false; }
    this.m.assentarZonas();
  }

  private pedirRemontagem(motivo = 'as alas mudaram'): void {
    if (this.remontando) return;
    this.remontando = true;
    console.info(`[arcadia] o andar vai ser remontado: ${motivo}`);
    this.aoRemontar?.();
  }

  /* ======================= passo ======================= */

  passo(dt: number): void {
    for (const s of this.espelho.tirarSinais()) this.sinal(s);
    if (this.remontando) { this.amb.passo(dt); return; }
    this.reconciliar();
    this.reconciliarMinis();
    this.rodar();
    this.continuos();
    if (this.luzesSujas) { this.m.montarLuzes(); this.luzesSujas = false; }
    this.amb.passo(dt);
  }

  private recente(ts: number): boolean { return this.espelho.agora() - ts < ANIMA_ATE_MS; }

  private sinal(s: Sinal): void {
    const anim = this.recente(s.ts);
    switch (s.k) {
      case 'agente': {
        const a = s.depois;
        if (a.tipo === 'humano' || a.tipo === 'subagente') return;
        const at = this.atores.get(a.chave) ?? this.criarAtor(a);
        at.ultimoSinal = Math.max(at.ultimoSinal, s.ts);
        if (!s.antes || s.antes.estado !== a.estado) this.mudouEstado(at, s.antes, a, anim);
        else if (anim && at.p.visivel && (s.antes.ferramenta?.alvo !== a.ferramenta?.alvo || s.antes.tarefa !== a.tarefa)) {
          const t = this.textoDoEstado(a);
          if (t) at.p.falar(t, PRIORIDADE[ESTADO_MUNDO[a.estado]] ?? 1, '', 4);
        }
        return;
      }
      case 'saiu': { const at = this.atores.get(s.chave); if (at) at.ultimoSinal = Math.max(at.ultimoSinal, s.ts); return; }
      case 'sala': {
        this.atualizarSala(s.depois);
        return;
      }
      case 'ala': if (assinaturaAlas(this.espelho.estado) !== this.assinatura) this.pedirRemontagem(`a ala ${s.depois.id} mudou`); return;
      case 'delegacao': if (!s.antes && anim) this.delegou(s.depois); return;
      case 'delegacao.fim': if (s.antes && anim) this.voltouDelegacao(s.antes); return;
      case 'precisa': this.atualizarUrgentes(); return;
      case 'metricas': this.entregasAlvo = this.espelho.estado.metricas.entregas; return;
      case 'obra': this.iniciarObra(s.obra, anim); return;
      case 'obra.fim': this.terminarObra(s.salaChave, anim); return;
      case 'evento': if (anim) this.evento(s.evento); return;
    }
  }

  /* ======================= atores ======================= */

  private dono(): Pessoa | undefined { return this.m.pessoas.find((p) => p.def.papel === 'dono'); }

  /** Zona da cápsula de uma sala: a da planta; sala que nasceu depois fica na primeira zona da ala com terreno livre. */
  zonaDaSala(s: SalaServidor): string {
    const ja = this.zonaEscolhida.get(s.chave) ?? this.mapa.salas.get(s.chave)?.zona;
    if (ja) return ja;
    this.vagaDaSala(s);
    return this.zonaEscolhida.get(s.chave) ?? this.zonaDaSalaPadrao(s);
  }
  private zonaDaSalaPadrao(s: SalaServidor): string { return this.mapa.zonaDaAla.get(s.alaId) ?? this.mapa.zonaRecepcao; }
  zonaDoAgente(a: Agente): string {
    const s = a.salaChave ? this.espelho.estado.salas[a.salaChave] : undefined;
    return s ? this.zonaDaSala(s) : this.mapa.zonaRecepcao;
  }

  private criarAtor(a: Agente): Ator {
    const chaveAp = chaveAparencia(a);
    if (!this.m.cena.aparencias[chaveAp]) this.m.cena.aparencias[chaveAp] = aparenciaDoAgente(a);
    const zona = this.zonaDoAgente(a);
    const z = this.m.zonaPorId.get(zona)!;
    const casa: [number, number] = [Math.floor((z.i0 + z.i1) / 2), Math.floor((z.j0 + z.j1) / 2)];
    const def: Personagem = {
      id: a.chave, nome: nomeDoAgente(a), curto: curtoDoAgente(a), cargo: cargoDoAgente(a), tipo: 'agente',
      papel: a.tipo === 'bot' && /coorden/i.test(a.cargo ?? '') ? 'coordenador' : 'agente', aparencia: chaveAp, zona, casa, poseCasa: 'parado',
      motor: a.motor, equipe: a.equipe, tipoAgente: a.tipo === 'bot' ? 'bot' : 'sessao', visivel: false,
    };
    const p = this.m.adicionarPessoa(def, (hash(a.chave) % 1000) / 200);
    p.tarefa = a.tarefa ?? '';
    const at: Ator = {
      chave: a.chave, p, bot: a.tipo === 'bot', zona, sala: a.salaChave, posto: null, recarga: null, spot: null, fila: -1, alvo: 'fora',
      rot: null, estado: a.estado, cochilo: false, proxZ: 0, ultimoPulso: -99, ultimoSinal: 0, entrando: false, fumacaAte: -1, proxFumaca: 0, pausas: 0,
    };
    this.atores.set(a.chave, at);
    return at;
  }

  private removerAtor(at: Ator): void {
    this.soltarPosto(at); this.soltarExtras(at, 'fora');
    this.m.removerPessoa(at.p);
    this.atores.delete(at.chave);
  }

  /** Onde o agente deve estar, pelo estado do servidor (ADR 0003 e 0004). */
  lugarDesejado(a: Agente, at: Ator): Lugar {
    // sem sinal: congela onde está (quem ainda não está no andar aparece na mesa)
    if (a.estado === 'sem-sinal') return at.alvo === 'fora' && !at.p.visivel ? 'posto' : at.alvo;
    if (a.tipo === 'bot') {
      if (a.estado === 'pausa' || a.estado === 'dormindo') return 'recarga';
      if (a.estado === 'na-fila') return 'fila';
      return 'posto';
    }
    if (a.estado === 'dormindo' || a.estado === 'saindo') return 'fora';
    if (a.estado === 'na-fila') return 'fila';
    if (a.estado === 'pausa' && !this.m.noite) return 'pausa';
    return 'posto';
  }

  private mudarZona(at: Ator, a: Agente, anim: boolean): void {
    const zona = this.zonaDoAgente(a);
    if (zona !== at.zona) {
      this.soltarPosto(at);
      at.zona = zona; at.p.zona = zona; at.sala = a.salaChave;
      if (anim && at.alvo === 'posto' && at.p.visivel) this.iniciar(at, 'posto', false);
      return;
    }
    if (a.salaChave !== at.sala) {
      at.sala = a.salaChave;
      const pod = at.sala ? this.podDaSala.get(at.sala) : undefined;
      if (pod && !pod.dono && at.posto !== pod) { this.soltarPosto(at); if (anim && at.alvo === 'posto' && at.p.visivel) this.iniciar(at, 'posto', false); }
    }
  }

  private reconciliar(): void {
    const e = this.espelho.estado;
    for (const a of Object.values(e.agentes)) {
      if (a.tipo === 'humano' || a.tipo === 'subagente') continue;
      const at = this.atores.get(a.chave) ?? this.criarAtor(a);
      const anim = this.recente(at.ultimoSinal);
      this.mudarZona(at, a, true);
      const alvo = this.lugarDesejado(a, at);
      if (alvo !== at.alvo) this.iniciar(at, alvo, anim);
      else if (!at.rot) this.aplicarVisual(at);
      else if (!at.entrando) this.visualAndando(at, a);
    }
    // quem saiu do estado: volta pelo teletransporte (se estava no andar) e sai do mundo
    for (const at of [...this.atores.values()]) {
      if (e.agentes[at.chave]) continue;
      if (at.alvo !== 'fora') this.iniciar(at, 'fora', this.recente(at.ultimoSinal));
      else if (!at.rot) this.removerAtor(at);
    }
  }

  private iniciar(at: Ator, alvo: Lugar, anim: boolean): void {
    at.alvo = alvo; at.entrando = false;
    this.soltarExtras(at, alvo);
    const g = alvo === 'posto' ? this.irAoPosto(at, anim) : alvo === 'recarga' ? this.irParaRecarga(at, anim) : alvo === 'pausa' ? this.irParaPausa(at, anim) : alvo === 'fila' ? this.irParaFila(at, anim) : this.irParaFora(at, anim);
    const r = g.next();
    at.rot = r.done ? null : { g, e: r.value };
  }

  private rodar(): void {
    const pronto = (e: Espera) => (typeof e === 'function' ? e() : this.m.relogio.agora >= e.ate);
    for (const at of this.atores.values()) {
      const r = at.rot;
      if (!r) continue;
      for (let guarda = 0; guarda < 8 && pronto(r.e); guarda++) {
        const nx = r.g.next();
        if (nx.done) { if (at.rot === r) at.rot = null; break; }
        r.e = nx.value;
      }
    }
    for (let i = this.efeitos.length - 1; i >= 0; i--) {
      const r = this.efeitos[i];
      for (let guarda = 0; guarda < 8 && pronto(r.e); guarda++) {
        const nx = r.g.next();
        if (nx.done) { this.efeitos.splice(i, 1); break; }
        r.e = nx.value;
      }
    }
  }

  private efeito(g: Roteiro): void { const r = g.next(); if (!r.done) this.efeitos.push({ g, e: r.value }); }
  private esperar(seg: number): Espera { return { ate: this.m.relogio.agora + seg }; }

  /* ======================= lugares ======================= */

  private garantirPosto(at: Ator): PostoRT | null {
    if (at.posto && at.posto.zona === at.zona) return at.posto;
    this.soltarPosto(at);
    const lista = this.postos.get(at.zona) ?? [];
    const livre = (x: PostoRT) => !x.dono;
    let po: PostoRT | undefined;
    if (at.sala) { const pod = this.podDaSala.get(at.sala); if (pod && livre(pod)) po = pod; }
    const coord = at.p.def.papel === 'coordenador';
    if (!po && coord) po = lista.find((x) => x.tipo === 'mesa' && x.papel === 'coordenador' && livre(x));
    if (!po) { const mesas = lista.filter((x) => x.tipo === 'mesa' && !x.papel && livre(x)); if (mesas.length) po = mesas[hash(at.chave) % mesas.length]; }
    if (!po) po = lista.find((x) => x.tipo === 'mesa' && livre(x));
    if (!po) { const pes = lista.filter((x) => x.tipo === 'pe' && livre(x)); if (pes.length) po = pes[hash(at.chave) % pes.length]; }
    if (!po) return null;
    po.dono = at.chave; at.posto = po;
    at.p.casa = [po.casa[0], po.casa[1]]; at.p.poseCasa = po.tipo === 'pe' ? 'operando' : po.pose;
    // mesa e cápsula mostram o estado de quem senta nelas (tela, holograma)
    if (po.obj && (po.tipo === 'mesa' || po.tipo === 'pod')) po.obj.dono = at.chave;
    return po;
  }

  private soltarPosto(at: Ator): void {
    const po = at.posto;
    if (!po) return;
    po.dono = null;
    if (po.obj && (po.tipo === 'mesa' || po.tipo === 'pod') && po.obj.dono === at.chave) po.obj.dono = null;
    at.posto = null;
  }

  private garantirRecarga(at: Ator): ObjRT | null {
    if (at.recarga && at.recarga.zona === at.zona) return at.recarga;
    const ja = this.m.objetos.find((o) => o.tipo === 'recarga' && o.dono === at.chave && o.zona === at.zona);
    if (ja) { at.recarga = ja; return ja; }
    const v = (this.m.cena.vagasRecarga[at.zona] ?? []).find(([i, j]) => !this.recargasUsadas.has(`${i},${j}`));
    if (!v) return null;
    this.recargasUsadas.add(`${v[0]},${v[1]}`);
    const ap = at.p.ap;
    const o = this.m.adicionarObjeto('recarga', v[0], v[1], { dono: at.chave, cor: ap?.tipo === 'androide' ? ap.papel : '#3ee0ff' });
    this.luzesSujas = true;
    at.recarga = o;
    return o;
  }

  /** Ponto de pausa: academia ou lounge, alternando a cada pausa (cada agente começa por um dos dois). */
  private reservarSpot(at: Ator): Spot | null {
    const { treinos, pausas } = this.m.cena.pontos;
    const ordem = (hash(at.chave) + at.pausas++) % 2 ? [pausas, treinos] : [treinos, pausas];
    for (const lista of ordem) {
      const livres = lista.filter((s) => !this.m.vagas.has(s.t.join(',')));
      if (!livres.length) continue;
      const sp = livres[hash(at.chave + lista.length) % livres.length];
      this.m.vagas.add(sp.t.join(','));
      at.spot = sp;
      return sp;
    }
    return null;
  }

  private reservarFila(at: Ator): number {
    const k = this.filaDe.findIndex((x) => x === null);
    if (k < 0) return -1;
    this.filaDe[k] = at.chave; at.fila = k;
    return k;
  }

  /** Solta o que o destino novo não usa: o ponto de pausa e o lugar na fila. */
  private soltarExtras(at: Ator, alvo: Lugar): void {
    if (alvo !== 'pausa' && at.spot) { this.m.vagas.delete(at.spot.t.join(',')); at.spot = null; at.p.z = 0; }
    if (alvo !== 'fila' && at.fila >= 0) { if (this.filaDe[at.fila] === at.chave) this.filaDe[at.fila] = null; at.fila = -1; }
  }

  /** Coloca direto no lugar (carga e resync). */
  private colocar(at: Ator, lugar: Lugar): void {
    const p = at.p;
    at.rot = null; at.alvo = lugar;
    this.soltarExtras(at, lugar);
    p.caminho = []; p.z = 0; p.costas = false; p.espelho = false; p.vel = VEL_PADRAO; p.alpha = 1; p.naRecarga = false; p.emCasa = false;
    const em = (i: number, j: number) => { p.pi = i + 0.5; p.pj = j + 0.5; };
    if (lugar === 'fora') { p.visivel = false; if (!at.bot) this.soltarPosto(at); return; }
    p.visivel = true;
    if (lugar === 'recarga') {
      const rc = this.garantirRecarga(at);
      if (rc) { this.garantirPosto(at); em(rc.i, rc.j); p.naRecarga = true; p.pose = 'parado'; this.aplicarVisual(at); return; }
    }
    if (lugar === 'pausa') {
      this.garantirPosto(at);
      const sp = at.spot ?? this.reservarSpot(at);
      if (sp) { em(sp.t[0], sp.t[1]); p.pose = sp.pose; p.z = sp.z ?? 0; p.costas = !!sp.costas; this.aplicarVisual(at); return; }
    }
    if (lugar === 'fila') {
      const k = this.reservarFila(at);
      if (k >= 0) { const f = this.m.cena.pontos.fila[k]; em(f[0], f[1]); p.pose = 'parado'; p.costas = true; this.aplicarVisual(at); return; }
    }
    const po = this.garantirPosto(at);
    em(p.casa[0], p.casa[1]);
    p.pose = po ? (po.tipo === 'pe' ? 'operando' : po.pose) : 'parado';
    p.emCasa = true;
    this.aplicarVisual(at);
  }

  /** A caminho de um lugar: o estado do servidor já aparece (voltando para casa, sem o de trabalho). */
  private visualAndando(at: Ator, a: Agente): void {
    const p = at.p, e = at.alvo === 'fora' ? 'ocioso' : ESTADO_MUNDO[a.estado];
    if (p.estado !== e) { p.estado = e; p.desde = this.m.relogio.agora; }
    p.alpha = a.estado === 'sem-sinal' ? 0.45 : 1;
    p.tarefa = a.tarefa ?? '';
  }

  /** Caminhada: na velocidade base e mais depressa nos caminhos longos (perto de 10 s no máximo). */
  private andar(p: Pessoa, alvo: [number, number], base: number): void {
    p.irPara(alvo);
    p.vel = Math.max(base, Math.min(8, p.caminho.length / 10));
  }

  /** Estado que o mundo mostra, pelo lugar em que o agente está agora. */
  private aplicarVisual(at: Ator): void {
    const a = this.espelho.estado.agentes[at.chave];
    if (!a) return;
    const p = at.p;
    at.estado = a.estado;
    let e = ESTADO_MUNDO[a.estado];
    if (at.spot && !p.andando) e = this.m.cena.pontos.treinos.includes(at.spot) ? 'treinando' : 'pausa';
    const cochilo = !at.bot && a.estado === 'pausa' && this.m.noite && p.emCasa;
    if (cochilo) { e = 'dormindo'; p.pose = 'dormir'; }
    else if (at.cochilo && p.emCasa) p.pose = at.posto ? (at.posto.tipo === 'pe' ? 'operando' : at.posto.pose) : 'parado';
    at.cochilo = cochilo;
    // de pé sem mesa: parado quando não trabalha, mexendo no holograma quando trabalha
    if (p.emCasa && at.posto?.tipo === 'pe' && !cochilo) p.pose = TRABALHO.has(a.estado) || a.estado === 'esperando' || a.estado === 'talvez-esperando' ? 'operando' : 'parado';
    if (p.estado !== e) { p.estado = e; p.desde = this.m.relogio.agora; }
    p.alpha = a.estado === 'sem-sinal' ? 0.45 : 1;
    p.tarefa = a.tarefa ?? '';
  }

  /* ======================= roteiros de lugar ======================= */

  private feixe(ti: number, tj: number): void {
    const fx = this.m.rngFx;
    const [x, y] = this.m.geo.iso(ti, tj);
    for (let k = 0; k < 20; k++) this.m.particulaNoChao(ti, tj, x - 10 + fx() * 20, y, { cor: '#9ff3ff', vy: -40 + fx() * 20, vx: 0, vida: 0.5 + fx() * 0.5 });
  }

  /** Quem não está no andar aparece no teletransporte (feixe, recepcionista acenando). */
  private *entrar(at: Ator, anim: boolean, foco: boolean): Generator<Espera, { x: number; y: number; ate: number; pessoa?: Pessoa } | null, unknown> {
    const p = at.p, m = this.m;
    const [ti, tj] = m.cena.pontos.teletransporte;
    p.pi = ti + 0.5; p.pj = tj + 0.5; p.caminho = []; p.pose = 'parado'; p.costas = false; p.espelho = false; p.naRecarga = false; p.emCasa = false; p.z = 0;
    p.visivel = true; p.alpha = 1;
    p.estado = 'chegando'; p.desde = m.relogio.agora;
    m.global.teleAte = m.relogio.agora + 1.2;
    this.feixe(ti, tj);
    let f: { x: number; y: number; ate: number; pessoa?: Pessoa } | null = null;
    const rec = m.pessoas.find((x) => x.def.papel === 'recepcionista');
    if (anim) {
      const z = m.zonaPorId.get(at.zona);
      m.anunciar(p, at.bot ? `chegou para trabalhar em ${z?.titulo ?? 'uma ala'}` : `abriu uma sessão em ${z?.titulo ?? 'uma sala'}`);
      if (foco && (!m.focoForcado || m.focoForcado.ate <= m.relogio.agora)) { f = { x: 0, y: 0, ate: m.relogio.agora + 90, pessoa: p }; m.focoForcado = f; }
      if (rec) { rec.pose = 'acenar'; rec.falar('Bem-vindo!', 1, '', 2); }
    }
    yield this.esperar(0.9);
    if (rec && rec.pose === 'acenar') rec.pose = 'parado';
    p.vel = VEL_CHEGADA;
    return f;
  }

  private *irAoPosto(at: Ator, anim: boolean): Roteiro {
    const p = at.p, m = this.m;
    p.vel = VEL_PADRAO;
    const po = this.garantirPosto(at);
    let foco: { ate: number } | null = null;
    const vindo = !p.visivel || p.naRecarga;
    at.entrando = vindo;
    if (!p.visivel) foco = yield* this.entrar(at, anim, true);
    else if (p.naRecarga) {
      p.naRecarga = false; p.estado = 'chegando'; p.desde = m.relogio.agora;
      if (anim) p.falar('Saindo da cápsula', 2, '', 2);
      yield this.esperar(0.7);
    } else { p.emCasa = false; p.z = 0; if (p.pose !== 'andar') p.pose = 'parado'; }
    this.andar(p, p.casa, vindo ? VEL_CHEGADA : VEL_PADRAO);
    yield () => !p.andando;
    p.pose = po ? (po.tipo === 'pe' ? 'operando' : po.pose) : 'parado';
    p.costas = false; p.espelho = false; p.z = 0; p.emCasa = true; p.vel = VEL_PADRAO; p.chegouEm = m.relogio.agora; at.entrando = false;
    if (foco && m.focoForcado === foco) foco.ate = m.relogio.agora + 2.5;
    this.aplicarVisual(at);
  }

  private *irParaFora(at: Ator, anim: boolean): Roteiro {
    const p = at.p, m = this.m;
    if (!p.visivel) { if (!at.bot) this.soltarPosto(at); return; }
    p.vel = VEL_PADRAO; p.naRecarga = false; p.emCasa = false; p.z = 0; p.pose = 'parado';
    if (anim) {
      const a = this.espelho.estado.agentes[at.chave];
      m.anunciar(p, a?.estado === 'dormindo' ? 'foi descansar e saiu pelo teletransporte' : 'encerrou a sessão');
    }
    const [ti, tj] = m.cena.pontos.teletransporte;
    this.andar(p, [ti, tj], VEL_PADRAO);
    yield () => !p.andando;
    p.vel = VEL_PADRAO;
    m.global.teleAte = m.relogio.agora + 1.2;
    this.feixe(ti, tj);
    yield this.esperar(0.4);
    p.visivel = false;
    if (!at.bot) this.soltarPosto(at);
  }

  private *irParaRecarga(at: Ator, anim: boolean): Roteiro {
    const p = at.p;
    const rc = this.garantirRecarga(at);
    if (!rc) { yield* this.irAoPosto(at, anim); return; }
    this.garantirPosto(at);
    if (p.naRecarga && Math.floor(p.pi) === rc.i && Math.floor(p.pj) === rc.j) { this.aplicarVisual(at); return; }
    if (!p.visivel) yield* this.entrar(at, anim, false);
    p.vel = VEL_PADRAO; p.emCasa = false; p.naRecarga = false; p.z = 0; p.pose = 'parado';
    if (anim) p.falar('Indo para a cápsula', 1, '', 2);
    this.andar(p, [rc.i, rc.j], VEL_PADRAO);
    yield () => !p.andando;
    p.vel = VEL_PADRAO;
    p.naRecarga = true; p.pose = 'parado'; p.costas = false; p.espelho = false;
    this.aplicarVisual(at);
  }

  private *irParaPausa(at: Ator, anim: boolean): Roteiro {
    const p = at.p;
    this.garantirPosto(at);
    const sp = at.spot ?? this.reservarSpot(at);
    if (!sp) { yield* this.irAoPosto(at, anim); return; }
    if (!p.visivel) yield* this.entrar(at, anim, false);
    p.vel = VEL_PADRAO; p.emCasa = false; p.naRecarga = false; p.z = 0; p.pose = 'parado';
    if (anim) { this.m.anunciar(p, `foi para ${this.m.cena.pontos.treinos.includes(sp) ? 'a academia' : 'o lounge'}: ${sp.txt.charAt(0).toLowerCase()}${sp.txt.slice(1)}`); }
    this.andar(p, sp.t, VEL_PADRAO);
    yield () => !p.andando;
    p.vel = VEL_PADRAO;
    p.pose = sp.pose; p.z = sp.z ?? 0; p.costas = !!sp.costas; p.espelho = false;
    if (anim) p.falar(sp.txt, 1, 'treinando', 4);
    this.aplicarVisual(at);
  }

  private *irParaFila(at: Ator, anim: boolean): Roteiro {
    const p = at.p;
    const k = at.fila >= 0 ? at.fila : this.reservarFila(at);
    if (k < 0) { yield* this.irAoPosto(at, anim); return; }
    if (!p.visivel) yield* this.entrar(at, anim, false);
    p.vel = VEL_PADRAO; p.emCasa = false; p.naRecarga = false; p.z = 0; p.pose = 'parado';
    this.andar(p, this.m.cena.pontos.fila[k], VEL_PADRAO);
    yield () => !p.andando;
    p.vel = VEL_PADRAO;
    p.costas = true; p.pose = 'parado';
    this.aplicarVisual(at);
  }

  /* ======================= gestos ======================= */

  textoDoEstado(a: Agente): string | null {
    switch (a.estado) {
      case 'pensando': return a.tarefa ? a.tarefa : 'Pensando';
      case 'lendo': return a.ferramenta?.alvo ? `Lendo ${a.ferramenta.alvo}` : 'Lendo';
      case 'editando': return a.ferramenta?.alvo ? `Editando ${a.ferramenta.alvo}` : 'Editando';
      case 'comando': return 'Rodando um comando';
      case 'trabalhando': return a.ferramenta?.nome ? `Usando ${a.ferramenta.nome}` : 'Trabalhando';
      case 'delegando': return 'Delegando';
      case 'esperando': return a.espera?.tipo === 'permissao' ? 'Precisa da sua permissão' : a.espera?.tipo === 'pergunta' ? 'Tem uma pergunta para você' : 'Precisa da sua aprovação';
      case 'talvez-esperando': return 'Talvez esperando você';
      case 'erro': return 'Algo deu erro';
      case 'entregou': return 'Entregou';
      case 'limite': return 'Bateu o limite de uso';
      case 'sem-sinal': return 'Sem sinal';
      case 'na-fila': return 'Na fila';
      default: return null;
    }
  }

  private mudouEstado(at: Ator, antes: Agente | undefined, a: Agente, anim: boolean): void {
    at.estado = a.estado;
    if (!anim) return;
    const p = at.p, m = this.m, e = ESTADO_MUNDO[a.estado];
    const texto = this.textoDoEstado(a);
    if (texto) p.falar(texto, PRIORIDADE[e] ?? 1, '', a.estado === 'esperando' ? 8 : 4);
    const motor = NOME_MOTOR[a.motor] ?? 'Agente';
    switch (a.estado) {
      case 'entregou': this.efeito(this.entregar(at)); m.anunciar(p, 'entregou'); break;
      case 'erro': this.falhar(at); m.anunciar(p, 'viu um erro'); break;
      case 'esperando': m.anunciar(p, a.espera?.tipo === 'permissao' ? 'espera a sua permissão' : a.espera?.tipo === 'pergunta' ? 'tem uma pergunta para você' : 'espera a sua aprovação'); break;
      case 'talvez-esperando': m.anunciar(p, 'talvez esteja esperando você'); break;
      case 'limite': m.anunciar(p, `bateu o limite de uso do ${motor}`); break;
      case 'sem-sinal': m.anunciar(p, 'ficou sem sinal'); break;
      case 'na-fila': m.anunciar(p, 'entrou na fila da recepção'); break;
      default: break;
    }
    if (antes?.estado === 'esperando' && TRABALHO.has(a.estado)) this.efeito(this.aprovar(at));
    if (TRABALHO.has(a.estado) && m.relogio.agora - at.ultimoPulso > 0.8) { m.emitirPulso(at.zona, CORES_ESTADO[e], 1); at.ultimoPulso = m.relogio.agora; }
  }

  /** Entrega: confete e um drone com o pacote até o Núcleo, que soma no contador. */
  private *entregar(at: Ator): Roteiro {
    const m = this.m, p = at.p;
    if (!p.visivel) return;
    const fx = m.rngFx;
    for (let k = 0; k < 14; k++) { const [x, y] = m.topo(p); m.particulaDe(p, x, y, { cor: ['#7dffa8', '#ffcf4d', '#ff4fd8', '#3ee0ff'][Math.floor(fx() * 4)], vx: -20 + fx() * 40, vy: -30 + fx() * 20, g: 40, vida: 0.7 + fx() * 0.5 }); }
    const [ni, nj] = m.cena.pontos.nucleo;
    const alvo = m.geo.iso(ni, nj, 50);
    this.cubosNoAr++;
    const d = m.lancarDrone(() => m.topo(p), () => alvo, { cor: '#7dffa8', carga: 'cubo', dur: 2.6, alt: 30 });
    yield () => d.feito;
    this.cubosNoAr--;
    m.global.entregas = Math.min(this.entregasAlvo, m.global.entregas + 1);
    m.emitirPulso(at.zona, '#7dffa8', 3);
  }

  /** Erro: racks piscando, pulso vermelho e fumaça saindo da cabeça por uns 4 s (baforadas em continuos). */
  private falhar(at: Ator): void {
    const m = this.m, p = at.p;
    m.global.erroAte = m.relogio.agora + 2;
    m.emitirPulso(at.zona, '#ff6b5a', 1);
    if (!p.visivel) return;
    at.fumacaAte = m.relogio.agora + 4; at.proxFumaca = m.relogio.agora + 0.35;
    this.baforada(p, 12);
  }

  /**
   * Uma baforada de fumaça clara (para se ver de noite) saindo dos dois lados da cabeça e subindo em leque, em
   * quadrados de 2 e 3 px, com faíscas vermelhas: fica em volta da cabeça, sem se esconder atrás do ícone.
   */
  private baforada(p: Pessoa, n: number): void {
    const m = this.m, fx = m.rngFx, [x, y] = m.topo(p, 26);
    for (let k = 0; k < n; k++) {
      const lado = k % 2 ? 1 : -1, faisca = fx() < 0.18;
      m.particulaDe(p, x + lado * (5 + fx() * 6), y - fx() * 6, faisca
        ? { cor: '#ff6b5a', vx: lado * (8 + fx() * 12), vy: -16 + fx() * 6, vida: 0.5 + fx() * 0.3, tam: 1 }
        : { cor: ['#aab0c2', '#c9cdd8', '#7f869c'][Math.floor(fx() * 3)], vx: lado * (4 + fx() * 9), vy: -8 - fx() * 8, vida: 1.4 + fx() * 0.8, tam: fx() < 0.5 ? 2 : 3 });
    }
  }


  /** A espera foi resolvida: um drone verde leva o check do Cockpit até o agente. */
  private *aprovar(at: Ator): Roteiro {
    const m = this.m, dono = this.dono(), p = at.p;
    m.emitirPulso(at.zona, '#7dffa8');
    if (!dono || !dono.visivel || !p.visivel) return;
    dono.falar((dono.def.falas?.aprovar ?? 'Aprovado, {curto}!').replace('{curto}', p.curto), 3, 'dono', 3);
    const d = m.lancarDrone(() => m.topo(dono), () => m.topo(p), { cor: '#7dffa8', carga: 'check', dur: 2.4 });
    yield () => d.feito;
  }

  private corDe(p: Pessoa): string { const ap = p.ap; return ap?.tipo === 'androide' ? ap.papel : '#ffb347'; }

  private delegou(d: Delegacao): void {
    const de = this.atores.get(d.de)?.p, para = this.atores.get(d.para)?.p;
    if (!de || !de.visivel) return;
    const m = this.m;
    m.anunciar(de, para ? `delegou para ${para.curto}${d.titulo ? `: ${d.titulo}` : ''}` : 'delegou uma tarefa');
    if (para && para.visivel) m.lancarDrone(() => m.topo(de), () => m.topo(para), { cor: this.corDe(de), carga: 'envelope', dur: 1.8, alt: 26 });
    m.emitirPulso(de.zona, '#ffb347');
  }

  private voltouDelegacao(d: Delegacao): void {
    const de = this.atores.get(d.de)?.p, para = this.atores.get(d.para)?.p;
    if (!de || !para || !de.visivel || !para.visivel) return;
    const m = this.m;
    m.lancarDrone(() => m.topo(para), () => m.topo(de), { cor: this.corDe(para), carga: 'envelope', dur: 1.8, alt: 26 });
    m.anunciar(para, `devolveu a tarefa para ${de.curto}`);
  }

  private evento(ev: ArcadiaEvent): void {
    if (ev.tipo !== 'pedido.humano') return;
    // pedido seu: um drone sai do Cockpit com o envelope até o agente
    const at = this.atores.get(ev.agente.chave) ?? (ev.agente.paiChave ? this.atores.get(ev.agente.paiChave) : undefined);
    const dono = this.dono(), m = this.m;
    if (!at || !dono || !dono.visivel) return;
    dono.falar(`Pedido para ${at.p.curto}`, 3, 'dono', 3);
    m.anunciar(dono, `mandou um pedido para ${at.p.curto}`);
    const p = at.p;
    m.lancarDrone(() => m.topo(dono), () => (p.visivel ? m.topo(p) : m.geo.iso(p.casa[0] + 0.5, p.casa[1] + 0.5, 30)), { cor: '#f2b45a', carga: 'envelope', dur: 3.2, alt: 46 });
  }

  /* ======================= salas, cápsulas e obras ======================= */

  private salasEmOrdem(): SalaServidor[] {
    return Object.values(this.espelho.estado.salas).sort((a, b) => a.alaId.localeCompare(b.alaId) || a.terreno.indice - b.terreno.indice || a.chave.localeCompare(b.chave));
  }

  /** A sala do servidor no mundo: dormindo e última atividade vêm dele. */
  private atualizarSala(s: SalaServidor): void {
    const w = this.salaMundo.get(s.chave);
    if (w) { w.dormindo = s.dormindo; w.ultimaAtividade = s.ultimaAtividade; w.nome = s.nome; return; }
    const zona = this.zonaDaSala(s), z = this.m.zonaPorId.get(zona)!;
    const nova: SalaMundo = { id: s.chave, nome: s.nome, zona, i: z.i0, j: z.j0, w: z.i1 - z.i0 + 1, d: z.j1 - z.j0 + 1, estilo: 'sala', dormindo: s.dormindo, ultimaAtividade: s.ultimaAtividade };
    this.m.adicionarSala(nova);
    this.salaMundo.set(s.chave, nova);
  }

  /**
   * Terreno da cápsula de uma sala. A planta já deu um a cada sala que conhecia (no lote da ala ou num
   * anexo); sala que nasceu depois fica no primeiro terreno livre das zonas da ala. Sem nenhum, o andar
   * cresce: o mundo é remontado com um anexo (ADR 0004) e a obra continua lá. Nunca sai calado.
   */
  private vagaDaSala(s: SalaServidor): [number, number] | null {
    const ja = this.vagaReservada.get(s.chave);
    if (ja) return ja;
    const plano = this.mapa.salas.get(s.chave);
    const zonas = plano ? [plano.zona] : this.mapa.zonasDaAla.get(s.alaId) ?? [this.mapa.zonaDaAla.get(s.alaId) ?? this.mapa.zonaRecepcao];
    for (const zona of zonas) {
      const vagas = this.m.cena.vagasPod[zona] ?? [];
      const usada = (k: number) => this.vagasUsadas.has(`${zona}|${k}`);
      const quer = plano ? plano.vaga : s.terreno.indice;
      const k = quer < vagas.length && !usada(quer) ? quer : vagas.findIndex((_, i) => !usada(i));
      if (k < 0) continue;
      this.vagasUsadas.add(`${zona}|${k}`);
      this.vagaReservada.set(s.chave, vagas[k]);
      this.zonaEscolhida.set(s.chave, zona);
      return vagas[k];
    }
    // a planta contou esta sala e mesmo assim não sobrou terreno: não remonta (sairia igual), só avisa
    if (plano || this.mapa.conhecidas.has(s.chave)) console.warn(`[arcadia] a sala ${s.chave} ficou sem terreno (zona ${plano?.zona ?? this.zonaDaSalaPadrao(s)})`);
    else this.pedirRemontagem(`a sala ${s.chave} nasceu sem terreno livre na ala ${s.alaId}: o andar ganha um anexo`);
    return null;
  }

  /** Cápsula com o nome de cada sala que ainda não tem uma (e que não está em obra). */
  private colocarPods(anim: boolean): void {
    const obras = new Set(this.espelho.estado.obras.map((o) => o.salaChave));
    for (const s of this.salasEmOrdem()) {
      if (this.podDaSala.has(s.chave) || obras.has(s.chave)) continue;
      const v = this.vagaDaSala(s);
      if (!v) continue;
      const zona = this.zonaDaSala(s);
      const obj = this.m.adicionarObjeto('pod', v[0], v[1], { nome: nomeCurto(s.nome), sala: s.chave });
      // o posto fica dentro da cápsula, no ladrilho do fundo à direita, atrás da bancada
      const po: PostoRT = { casa: [v[0] + 1, v[1]], pose: 'digitando', tipo: 'pod', zona, dono: null, sala: s.chave, obj };
      (this.postos.get(zona) ?? this.postos.set(zona, []).get(zona)!).push(po);
      this.podDaSala.set(s.chave, po);
      const w = this.salaMundo.get(s.chave);
      if (w) { w.i = v[0]; w.j = v[1]; w.w = 2; w.d = 2; w.estilo = 'pod'; }
      this.luzesSujas = true;
      // quem trabalha nessa sala e está numa mesa (ou em pé) da mesma ala muda para a cápsula nova
      for (const at of this.atores.values()) {
        if (at.sala !== s.chave || at.zona !== zona || at.posto?.tipo === 'pod' || at.alvo !== 'posto' || !at.p.visivel) continue;
        this.soltarPosto(at);
        this.iniciar(at, 'posto', false);
      }
      if (anim) {
        const m = this.m, fx = m.rngFx;
        for (let k = 0; k < 30; k++) { const [x, y] = m.geo.iso(v[0] + 1, v[1] + 1, 20); m.particulaNoChao(v[0] + 1, v[1] + 2, x - 20 + fx() * 40, y - 10 + fx() * 20, { cor: ['#ffcf4d', '#c9a7ff', '#ffffff'][Math.floor(fx() * 3)], vx: -30 + fx() * 60, vy: -40 + fx() * 30, g: 50, vida: 0.8 + fx() * 0.6 }); }
        m.anunciar({ nome: s.nome, cor: '#c9a7ff' }, 'sala nova pronta');
      }
    }
  }

  private iniciarObra(ob: Obra, anim: boolean, focar = anim): void {
    if (this.m.obras.some((o) => o.chave === ob.salaChave)) return;
    const s = this.espelho.estado.salas[ob.salaChave];
    if (!s) return;
    this.atualizarSala(s);
    const v = this.vagaDaSala(s);
    const m = this.m;
    if (anim || focar) m.anunciar({ nome: 'Sala nova', cor: '#ffcf4d' }, `em obra: ${s.nome}`);
    // sem terreno, vagaDaSala já pediu o andar maior: a obra aparece no anexo, depois da remontagem
    if (!v) return;
    const inicio = m.relogio.agora - Math.max(0, this.espelho.agora() - ob.inicio) / 1000;
    m.obras.push({ chave: ob.salaChave, i: v[0], j: v[1], zona: this.zonaDaSala(s), inicio, dur: Math.max(1, (ob.fim - ob.inicio) / 1000) });
    if (focar && (!m.focoForcado || m.focoForcado.ate <= m.relogio.agora)) {
      const [cx, cy] = m.geo.iso(v[0] + 1, v[1] + 1);
      m.focoForcado = { x: cx, y: cy - 20, ate: m.relogio.agora + 9 };
    }
  }

  private terminarObra(salaChave: string, anim: boolean): void {
    this.m.obras = this.m.obras.filter((o) => o.chave !== salaChave);
    this.colocarPods(anim);
  }

  /* ======================= subagentes, fila e efeitos contínuos ======================= */

  private reconciliarMinis(): void {
    const m = this.m, vivos = new Set<string>(), porPai = new Map<string, number>();
    for (const a of Object.values(this.espelho.estado.agentes)) {
      if (a.tipo !== 'subagente' || !a.paiChave) continue;
      if (a.estado === 'saindo' || a.estado === 'pausa' || a.estado === 'dormindo') continue;
      const pai = this.atores.get(a.paiChave);
      if (!pai || !pai.p.visivel) continue;
      vivos.add(a.chave);
      const idx = porPai.get(a.paiChave) ?? 0; porPai.set(a.paiChave, idx + 1);
      let mi = m.minis.find((x) => x.chave === a.chave);
      if (!mi) { const [x, y] = m.topo(pai.p); mi = { x: x + 14, y: y - 4, cor: this.corDe(pai.p), ate: Infinity, pai: pai.p, chave: a.chave }; m.minis.push(mi); }
      mi.estado = ESTADO_MUNDO[a.estado]; mi.idx = idx; mi.pai = pai.p;
    }
    for (let i = m.minis.length - 1; i >= 0; i--) {
      const mi = m.minis[i];
      if (!mi.chave || vivos.has(mi.chave)) continue;
      const fx = m.rngFx;
      for (let k = 0; k < 6; k++) m.particulaDe(mi.pai, mi.x, mi.y, { cor: mi.cor, vx: -10 + fx() * 20, vy: -12 + fx() * 8, vida: 0.5 });
      m.minis.splice(i, 1);
    }
  }

  /** Fila "precisa de você" do servidor, do pedido mais antigo para o mais novo. */
  itensPrecisa(): ItemPrecisa[] {
    const e = this.espelho.estado, out: ItemPrecisa[] = [];
    for (const it of [...e.precisaDeVoce].sort((a, b) => a.desde - b.desde)) {
      const ag = e.agentes[it.agenteChave];
      const at = this.atores.get(it.agenteChave) ?? (ag?.paiChave ? this.atores.get(ag.paiChave) : undefined);
      if (!at) continue;
      const sala = it.salaChave ? e.salas[it.salaChave]?.nome : undefined;
      out.push({ p: at.p, tipo: it.tipo, desde: it.desde, sala, chave: it.agenteChave });
    }
    return out;
  }

  private atualizarUrgentes(): void { this.versaoUrgentes = this.espelho.versao; this.m.urgentes = this.itensPrecisa().map((x) => x.p); }

  private continuos(): void {
    const m = this.m, agora = m.relogio.agora, fx = m.rngFx;
    for (const at of this.atores.values()) {
      const p = at.p;
      if (!p.visivel) continue;
      if (at.estado === 'limite') m.global.apagao.set(at.zona, agora + 1.5);
      if (at.cochilo && agora >= at.proxZ) { at.proxZ = agora + 1.4; const [x, y] = m.topo(p, 34); m.particulaDe(p, x + 6, y, { tipo: 'z', cor: '#b9b0dc', vx: 4, vy: -8, vida: 1.6 }); }
      // fumaça do erro: uma baforada a cada 0,35 s durante uns 4 s (perto de 30 partículas no ar, dentro do orçamento de 120 do celular)
      if (agora < at.fumacaAte && agora >= at.proxFumaca) { at.proxFumaca = agora + 0.35; this.baforada(p, 5); }
    }
    for (const ob of m.obras) {
      if (fx() < 0.5) { const prog = Math.min(1, (agora - ob.inicio) / ob.dur); const pt = m.geo.iso(ob.i + fx() * 2, ob.j + fx() * 2, 40 * prog); m.particulaNoChao(ob.i + 1, ob.j + 2, pt[0], pt[1], { cor: ['#ffcf4d', '#ffffff', '#ff9a3c'][Math.floor(fx() * 3)], vx: -20 + fx() * 40, vy: -20 + fx() * 20, g: 60, vida: 0.5 }); }
    }
    // obra que passou do fim sem o aviso do servidor (aba escondida, por exemplo)
    const emObra = new Set(this.espelho.estado.obras.map((o) => o.salaChave));
    for (const ob of [...m.obras]) if (!emObra.has(ob.chave) && agora > ob.inicio + ob.dur) this.terminarObra(ob.chave, false);
    if (this.cubosNoAr === 0 && m.global.entregas !== this.entregasAlvo) m.global.entregas = this.entregasAlvo;
    m.global.erros = this.espelho.estado.metricas.erros;
    // a fila pode citar quem só entrou no mundo depois do sinal dela
    if (this.versaoUrgentes !== this.espelho.versao) this.atualizarUrgentes();
  }
}
