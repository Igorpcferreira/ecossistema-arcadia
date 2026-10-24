// Motor do mundo: redutor puro. aplicar(estado, entrada) devolve um estado novo (o anterior não muda) e a lista
// de mudanças para transmitir. Nada de Date.now nem Math.random aqui: o tempo vem das entradas.
//
// Timers (prompt, seção 4.3), todos processados no instante exato em que vencem, em ordem cronológica. Por isso
// tanto faz o servidor chamar o tick a cada segundo ou o replay avançar só a cada evento: o estado é o mesmo.
//   debounce de 300 ms no estado visível (borda de subida e de descida);
//   turno com saída só de texto e sem dados por 5 s = concluído;
//   ferramenta sem resultado por mais de 7 s, sem sinal exato (hook ou OMB) = "talvez esperando";
//   3 min sem atividade = pausa (academia ou lounge); 20 min = dorme.
import {
  ORIGENS_EXATAS, compactar, sanearTexto,
  type Acao, type Agente, type Ala, type ArcadiaEvent, type CategoriaFerramenta, type Delegacao, type EstadoAgente,
  type EstadoFonte, type EstadoMundo, type EstadoPresenca, type ItemPrecisaDeVoce, type Metricas, type Mudanca, type Obra, type Sala,
  type SaudeFonte, type TemaAla, type TipoEspera, type TipoEvento,
} from '@arcadia/shared';
import { loteDaOrdem, terrenoDoIndice } from './layout.ts';
import { chaveDoDia, diaTexto, proximaMeiaNoite } from './tempo.ts';

export type ConfigMotor = {
  fuso: string;
  debounceMs: number;
  textoConcluiMs: number;
  talvezEsperandoMs: number;
  pausaMs: number;
  dormeMs: number;
  chegandoMs: number;
  saindoMs: number;
  histereseSalaMs: number;
  obraMs: number;
  salaDormeMs: number;
  /** Visitante (sessão ou subagente) dormindo há este tempo vai embora. */
  visitanteSaiMs: number;
  delegacaoExpiraMs: number;
  maxUltimasAcoes: number;
  /** `privacidade.mostrarTituloDaTarefa`: desligado, o motor apaga e ignora título de tarefa e de delegação. */
  mostrarTitulo: boolean;
  /** `privacidade.mostrarNomeCurtoDoArquivo`: desligado, o motor apaga e ignora o nome curto do arquivo. */
  mostrarAlvo: boolean;
};

export function configMotorPadrao(parcial: Partial<ConfigMotor> = {}): ConfigMotor {
  return {
    mostrarTitulo: true,
    mostrarAlvo: true,
    fuso: 'America/Sao_Paulo',
    debounceMs: 300,
    textoConcluiMs: 5_000,
    talvezEsperandoMs: 7_000,
    pausaMs: 3 * 60_000,
    dormeMs: 20 * 60_000,
    chegandoMs: 10_000,
    saindoMs: 10_000,
    histereseSalaMs: 20_000,
    obraMs: 60_000,
    salaDormeMs: 20 * 60_000,
    visitanteSaiMs: 4 * 3600_000,
    delegacaoExpiraMs: 2 * 3600_000,
    maxUltimasAcoes: 5,
    ...parcial,
  };
}

/** Ala da configuração. O tema (opcional) só vem daqui: o banco não o guarda, e cada partida o aplica de novo. */
export type AlaConfig = { id: string; nome: string; cor: string; tema?: TemaAla };

export type FerramentaVisivel = { nome: string; categoria: CategoriaFerramenta; alvo?: string };
export type Visivel = { estado: EstadoAgente; ferramenta?: FerramentaVisivel; espera?: { tipo: TipoEspera; desde: number } };
export type FerramentaPendente = { nome: string; categoria: CategoriaFerramenta; alvo?: string; desde: number };

export type InternoAgente = {
  /** Estado lógico imediato; o visível segue com debounce. */
  bruto: Visivel;
  brutoDesde: number;
  visivelMudouEm: number;
  commitEm?: number;
  /** Ferramentas iniciadas e ainda sem fim, por id da chamada. */
  pendentes: Record<string, FerramentaPendente>;
  ordem: string[];
  textoEm?: number;
  turnoAtivo: boolean;
  /** Recebe sinal exato de espera e de fim de turno (bot do OMB ou hook): sem heurística de 5 s e de 7 s. */
  exato: boolean;
  ultimaTrocaSalaEm: number;
  salaPendente?: string;
  /**
   * Sessão ou subagente que mexeu em pasta excluída (ou sessão-mãe de um subagente que mexeu): o nome, a tarefa e os
   * nomes de arquivo não voltam mais. Depois de reiniciar, quem marca de novo é o núcleo (tabela de marcas do banco).
   */
  privado?: true;
  /**
   * Bot que mexeu em pasta excluída neste turno (ou que delegou a tarefa a um bot que mexeu): a tarefa e os nomes de
   * arquivo somem até ele começar um turno novo. O nome do bot fica (vem do OpenMausBot).
   */
  privadoTurno?: true;
};

export type Interno = {
  agentes: Record<string, InternoAgente>;
  proximoTerreno: Record<string, number>;
  proximaOrdemAla: number;
  recepcaoId: string;
  /** Chave do dia corrente (aaaa-mm-dd no fuso). */
  dia: string;
  meiaNoite: number;
  vistosAgentes: Record<string, true>;
  vistasSalas: Record<string, true>;
  contador: number;
};

export type EstadoMotor = { mundo: EstadoMundo; interno: Interno };
export type DiaFechado = { dia: string; metricas: Metricas };
export type Resultado = { estado: EstadoMotor; mudancas: Mudanca[]; diasFechados: DiaFechado[] };

export type Entrada =
  | { k: 'evento'; evento: ArcadiaEvent }
  | { k: 'tick'; agora: number }
  | { k: 'alas'; agora: number; alas: AlaConfig[]; recepcao: AlaConfig }
  | { k: 'saude'; agora: number; fonte: string; saude: { estado: EstadoFonte; mensagem?: string; versao?: string; ignoradas?: number } };

/** Evento mais velho que isso (catch-up, replay de história) muda o estado, mas não vira animação no cliente. */
export const EVENTO_RECENTE_MS = 60_000;

const ESTADO_DA_CATEGORIA: Record<CategoriaFerramenta, EstadoAgente> = {
  ler: 'lendo',
  web: 'lendo',
  editar: 'editando',
  comando: 'comando',
  delegar: 'delegando',
  navegador: 'trabalhando',
  integracao: 'trabalhando',
  outro: 'trabalhando',
};

const ESTADOS_DE_FERRAMENTA: ReadonlySet<EstadoAgente> = new Set(['lendo', 'editando', 'comando', 'trabalhando', 'delegando']);
const PAUSAVEIS: ReadonlySet<EstadoAgente> = new Set(['ocioso', 'entregou', 'erro', 'chegando']);
const DORMIVEIS: ReadonlySet<EstadoAgente> = new Set(['ocioso', 'entregou', 'erro', 'chegando', 'pausa', 'talvez-esperando']);
/** Eventos que mostram trabalho novo: tiram o agente da espera exata. */
const RETOMAM: ReadonlySet<TipoEvento> = new Set(['ferramenta.inicio', 'pedido.humano', 'turno.inicio']);

/** Evento que abre um turno novo do próprio agente (a marca de turno de um bot cai aqui). */
export function iniciaTurno(ev: ArcadiaEvent): boolean {
  return ev.tipo === 'turno.inicio' || ev.tipo === 'pedido.humano' || (ev.tipo === 'delegacao.recebida' && ev.delegacao?.para === ev.agente.chave);
}

function pausavel(est: EstadoAgente, ia: InternoAgente): boolean {
  return PAUSAVEIS.has(est) || (!ia.exato && est === 'pensando');
}

function dormivel(est: EstadoAgente, ia: InternoAgente): boolean {
  return DORMIVEIS.has(est) || (!ia.exato && (est === 'pensando' || ESTADOS_DE_FERRAMENTA.has(est)));
}

function metricasVazias(dia: string): Metricas {
  return {
    dia, entregas: 0, erros: 0, ferramentas: 0, turnos: 0, pedidos: 0, delegacoes: 0, esperas: 0,
    tokens: { entrada: 0, saida: 0, cache: 0 }, custoUsd: 0, agentes: 0, salas: 0,
  };
}

export function criarEstadoInicial(agora: number, cfg: ConfigMotor, recepcao: AlaConfig): EstadoMotor {
  const ala: Ala = {
    id: recepcao.id, nome: recepcao.nome, cor: recepcao.cor, ordem: 0, lote: loteDaOrdem(0), tipo: 'recepcao', ativa: true, criadaEm: agora,
  };
  return {
    mundo: {
      v: 1,
      agora,
      alas: { [ala.id]: ala },
      salas: {},
      agentes: {},
      delegacoes: {},
      precisaDeVoce: [],
      metricas: metricasVazias(diaTexto(agora, cfg.fuso)),
      saude: { fontes: {} },
      obras: [],
    },
    interno: {
      agentes: {},
      proximoTerreno: {},
      proximaOrdemAla: 1,
      recepcaoId: ala.id,
      dia: chaveDoDia(agora, cfg.fuso),
      meiaNoite: proximaMeiaNoite(agora, cfg.fuso),
      vistosAgentes: {},
      vistasSalas: {},
      contador: 0,
    },
  };
}

/** Valor próprio do registro (nunca o herdado do Object, como `constructor` ou `toString`). */
function de<T>(registro: Record<string, T>, chave: string): T | undefined {
  return Object.hasOwn(registro, chave) ? registro[chave] : undefined;
}

// Rascunho: cópia sob escrita. Cada objeto é copiado só na primeira mudança; o estado de entrada nunca é tocado.

class Rascunho {
  mundo: EstadoMundo;
  interno: Interno;
  cfg: ConfigMotor;
  eventos: ArcadiaEvent[] = [];
  diasFechados: DiaFechado[] = [];
  sujos = {
    alas: new Set<string>(),
    salas: new Set<string>(),
    agentes: new Set<string>(),
    saiu: new Set<string>(),
    delegacoes: new Set<string>(),
    delegacoesFim: new Set<string>(),
    obras: new Set<string>(),
    obrasFim: new Set<string>(),
    fila: false,
    metricas: false,
    saude: false,
  };
  copiados = new Set<string>();

  constructor(base: EstadoMotor, cfg: ConfigMotor) {
    this.mundo = { ...base.mundo };
    this.interno = { ...base.interno };
    this.cfg = cfg;
  }

  umaVez(chave: string): boolean {
    if (this.copiados.has(chave)) return false;
    this.copiados.add(chave);
    return true;
  }

  agentes(): Record<string, Agente> {
    if (this.umaVez('m:agentes')) this.mundo.agentes = { ...this.mundo.agentes };
    return this.mundo.agentes;
  }
  salas(): Record<string, Sala> {
    if (this.umaVez('m:salas')) this.mundo.salas = { ...this.mundo.salas };
    return this.mundo.salas;
  }
  alas(): Record<string, Ala> {
    if (this.umaVez('m:alas')) this.mundo.alas = { ...this.mundo.alas };
    return this.mundo.alas;
  }
  delegacoes(): Record<string, Delegacao> {
    if (this.umaVez('m:delegacoes')) this.mundo.delegacoes = { ...this.mundo.delegacoes };
    return this.mundo.delegacoes;
  }
  internos(): Record<string, InternoAgente> {
    if (this.umaVez('i:agentes')) this.interno.agentes = { ...this.interno.agentes };
    return this.interno.agentes;
  }
  terrenos(): Record<string, number> {
    if (this.umaVez('i:terrenos')) this.interno.proximoTerreno = { ...this.interno.proximoTerreno };
    return this.interno.proximoTerreno;
  }
  vistos(): { agentes: Record<string, true>; salas: Record<string, true> } {
    if (this.umaVez('i:vistos')) {
      this.interno.vistosAgentes = { ...this.interno.vistosAgentes };
      this.interno.vistasSalas = { ...this.interno.vistasSalas };
    }
    return { agentes: this.interno.vistosAgentes, salas: this.interno.vistasSalas };
  }

  agente(k: string): Agente | undefined {
    return de(this.mundo.agentes, k);
  }
  /** Cópia mutável do agente. `marcar` falso: muda só campo que não vale uma retransmissão (ultimaAtividade). */
  agenteMut(k: string, marcar = true): Agente {
    const mapa = this.agentes();
    const a = de(mapa, k);
    if (!a) throw new Error(`agente inexistente: ${k}`);
    if (marcar) this.sujos.agentes.add(k);
    if (this.umaVez(`a:${k}`)) {
      const copia = { ...a };
      mapa[k] = copia;
      return copia;
    }
    return a;
  }
  ia(k: string): InternoAgente | undefined {
    return de(this.interno.agentes, k);
  }
  iaMut(k: string): InternoAgente {
    const mapa = this.internos();
    const ia = de(mapa, k);
    if (!ia) throw new Error(`agente inexistente: ${k}`);
    if (this.umaVez(`ia:${k}`)) {
      const copia = { ...ia };
      mapa[k] = copia;
      return copia;
    }
    return ia;
  }
  salaMut(k: string, marcar = true): Sala {
    const mapa = this.salas();
    const s = de(mapa, k);
    if (!s) throw new Error(`sala inexistente: ${k}`);
    if (marcar) this.sujos.salas.add(k);
    if (this.umaVez(`s:${k}`)) {
      const copia = { ...s };
      mapa[k] = copia;
      return copia;
    }
    return s;
  }
  alaMut(id: string): Ala {
    const mapa = this.alas();
    const a = de(mapa, id);
    if (!a) throw new Error(`ala inexistente: ${id}`);
    this.sujos.alas.add(id);
    if (this.umaVez(`al:${id}`)) {
      const copia = { ...a };
      mapa[id] = copia;
      return copia;
    }
    return a;
  }
  metricasMut(): Metricas {
    if (this.umaVez('m:metricas')) this.mundo.metricas = { ...this.mundo.metricas, tokens: { ...this.mundo.metricas.tokens } };
    this.sujos.metricas = true;
    return this.mundo.metricas;
  }
  fontes(marcar: boolean): Record<string, SaudeFonte> {
    if (this.umaVez('m:saude')) this.mundo.saude = { fontes: { ...this.mundo.saude.fontes } };
    if (marcar) this.sujos.saude = true;
    return this.mundo.saude.fontes;
  }
  definirFila(itens: ItemPrecisaDeVoce[]): void {
    this.mundo.precisaDeVoce = itens;
    this.sujos.fila = true;
  }
  definirObras(obras: Obra[]): void {
    this.mundo.obras = obras;
  }

  finalizar(): Resultado {
    const m: Mudanca[] = [];
    for (const id of this.sujos.alas) {
      const a = de(this.mundo.alas, id);
      if (a) m.push({ k: 'ala', ala: a });
    }
    for (const k of this.sujos.salas) {
      const s = de(this.mundo.salas, k);
      if (s) m.push({ k: 'sala', sala: s });
    }
    for (const k of this.sujos.obras) {
      const o = this.mundo.obras.find((x) => x.salaChave === k);
      if (o) m.push({ k: 'obra', obra: o });
    }
    for (const k of this.sujos.obrasFim) m.push({ k: 'obra.fim', salaChave: k });
    for (const k of this.sujos.agentes) {
      const a = de(this.mundo.agentes, k);
      if (a) m.push({ k: 'agente', agente: a });
    }
    for (const k of this.sujos.delegacoes) {
      const d = de(this.mundo.delegacoes, k);
      if (d) m.push({ k: 'delegacao', delegacao: d });
    }
    for (const k of this.sujos.delegacoesFim) m.push({ k: 'delegacao.fim', chave: k });
    if (this.sujos.fila) m.push({ k: 'precisaDeVoce', itens: this.mundo.precisaDeVoce });
    if (this.sujos.metricas) m.push({ k: 'metricas', metricas: this.mundo.metricas });
    if (this.sujos.saude) m.push({ k: 'saude', saude: this.mundo.saude });
    for (const k of this.sujos.saiu) m.push({ k: 'agente.saiu', chave: k });
    for (const ev of this.eventos) m.push({ k: 'evento', evento: ev });
    return { estado: { mundo: this.mundo, interno: this.interno }, mudancas: m, diasFechados: this.diasFechados };
  }
}

// Comparações e ajudantes

function mesmaFerramenta(a?: FerramentaVisivel, b?: FerramentaVisivel): boolean {
  if (!a || !b) return a === b;
  return a.nome === b.nome && a.categoria === b.categoria && a.alvo === b.alvo;
}

function mesmoVisivel(a: Visivel, b: Visivel): boolean {
  return a.estado === b.estado && mesmaFerramenta(a.ferramenta, b.ferramenta) && a.espera?.tipo === b.espera?.tipo;
}

function visivelDe(a: Agente): Visivel {
  const v: Visivel = { estado: a.estado };
  if (a.ferramenta) v.ferramenta = a.ferramenta;
  if (a.espera) v.espera = a.espera;
  return v;
}

function definirOpcional<T extends object, K extends keyof T>(obj: T, chave: K, valor: T[K] | undefined): void {
  if (valor === undefined) delete obj[chave];
  else obj[chave] = valor;
}

function commitar(r: Rascunho, k: string, quando: number): void {
  const ia = r.iaMut(k);
  const a = r.agenteMut(k);
  a.estado = ia.bruto.estado;
  a.desde = ia.brutoDesde;
  definirOpcional(a, 'ferramenta', ia.bruto.ferramenta ? { ...ia.bruto.ferramenta } : undefined);
  definirOpcional(a, 'espera', ia.bruto.espera ? { ...ia.bruto.espera } : undefined);
  ia.visivelMudouEm = quando;
  delete ia.commitEm;
}

/** Muda o estado lógico; o visível acompanha na hora ou, se mudou há menos de 300 ms, quando a janela fechar. */
function definirBruto(r: Rascunho, k: string, vis: Visivel, quando: number): void {
  const ia = r.iaMut(k);
  if (!mesmoVisivel(ia.bruto, vis)) ia.brutoDesde = quando;
  ia.bruto = vis;
  const a = r.agente(k);
  if (!a) return;
  if (mesmoVisivel(vis, visivelDe(a))) {
    delete ia.commitEm;
    return;
  }
  if (quando - ia.visivelMudouEm >= r.cfg.debounceMs) commitar(r, k, quando);
  else ia.commitEm = ia.visivelMudouEm + r.cfg.debounceMs;
}

function visivelDasPendentes(ia: InternoAgente): Visivel {
  const ultimo = ia.ordem.at(-1);
  const p = ultimo !== undefined ? de(ia.pendentes, ultimo) : undefined;
  if (p) {
    const ferramenta: FerramentaVisivel = { nome: p.nome, categoria: p.categoria };
    if (p.alvo !== undefined) ferramenta.alvo = p.alvo;
    return { estado: ESTADO_DA_CATEGORIA[p.categoria], ferramenta };
  }
  return { estado: ia.turnoAtivo ? 'pensando' : 'ocioso' };
}

function emitirSintetico(r: Rascunho, k: string, tipo: TipoEvento, quando: number, extra: Partial<ArcadiaEvent> = {}): void {
  const a = r.agente(k);
  if (!a) return;
  r.interno.contador++;
  const ev: ArcadiaEvent = {
    v: 1,
    id: `sint.${r.interno.contador}`,
    ts: quando,
    recebidoEm: quando,
    origem: a.origem,
    motor: a.motor,
    agente: { chave: k, tipo: a.tipo },
    local: a.salaChave ? { projetoChave: a.salaChave } : {},
    tipo,
    ...extra,
  };
  r.eventos.push(ev);
}

function registrarAcao(r: Rascunho, k: string, acao: Acao): void {
  const a = r.agenteMut(k);
  a.ultimasAcoes = [...a.ultimasAcoes, acao].slice(-r.cfg.maxUltimasAcoes);
}

function porNaFila(r: Rascunho, k: string, tipo: 'permissao' | 'pergunta' | 'aprovacao', desde: number): void {
  const sala = r.agente(k)?.salaChave;
  const itens = r.mundo.precisaDeVoce.filter((i) => i.agenteChave !== k);
  itens.push(compactar({ agenteChave: k, tipo, desde, salaChave: sala }));
  itens.sort((a, b) => a.desde - b.desde || (a.agenteChave < b.agenteChave ? -1 : 1));
  r.definirFila(itens);
}

function tirarDaFila(r: Rascunho, k: string): void {
  if (r.mundo.precisaDeVoce.some((i) => i.agenteChave === k)) r.definirFila(r.mundo.precisaDeVoce.filter((i) => i.agenteChave !== k));
}

function contarEntrega(r: Rascunho, k: string): void {
  const m = r.metricasMut();
  m.entregas++;
  const a = r.agenteMut(k);
  a.entregasHoje++;
  if (a.salaChave && de(r.mundo.salas, a.salaChave)) {
    const s = r.salaMut(a.salaChave);
    s.entregas++;
    s.entregasHoje++;
  }
}

function contarErro(r: Rascunho, k: string): void {
  const m = r.metricasMut();
  m.erros++;
  const a = r.agenteMut(k);
  a.errosHoje++;
  if (a.salaChave && de(r.mundo.salas, a.salaChave)) {
    const s = r.salaMut(a.salaChave);
    s.erros++;
    s.errosHoje++;
  }
}

function limparTurno(r: Rascunho, k: string): void {
  const ia = r.iaMut(k);
  ia.turnoAtivo = false;
  delete ia.textoEm;
  ia.pendentes = {};
  ia.ordem = [];
}

function fimDeTurno(r: Rascunho, k: string, quando: number, sintetico: boolean): void {
  limparTurno(r, k);
  tirarDaFila(r, k);
  contarEntrega(r, k);
  definirBruto(r, k, { estado: 'entregou' }, quando);
  if (sintetico) emitirSintetico(r, k, 'turno.fim', quando);
}

function removerAgente(r: Rascunho, k: string, quando: number): void {
  const filhos = Object.values(r.mundo.agentes).filter((x) => x.paiChave === k && x.chave !== k);
  delete r.agentes()[k];
  delete r.internos()[k];
  r.sujos.agentes.delete(k);
  r.sujos.saiu.add(k);
  tirarDaFila(r, k);
  for (const f of filhos) if (r.ia(f.chave)?.bruto.estado !== 'saindo') definirBruto(r, f.chave, { estado: 'saindo' }, quando);
}

function definirSala(r: Rascunho, k: string, sala: string, quando: number): void {
  const a = r.agenteMut(k);
  a.salaChave = sala;
  const ia = r.iaMut(k);
  ia.ultimaTrocaSalaEm = quando;
  delete ia.salaPendente;
  if (r.mundo.precisaDeVoce.some((i) => i.agenteChave === k && i.salaChave !== sala)) {
    r.definirFila(r.mundo.precisaDeVoce.map((i) => (i.agenteChave === k ? { ...i, salaChave: sala } : i)));
  }
}

/** Histerese de 20 s: o agente só troca de sala se a última troca foi há 20 s ou mais; senão a troca fica pendente. */
function moverAgente(r: Rascunho, k: string, sala: string, quando: number): void {
  const a = r.agente(k);
  const ia = r.ia(k);
  if (!a || !ia) return;
  if (a.salaChave === undefined) return definirSala(r, k, sala, quando);
  if (a.salaChave === sala) {
    if (ia.salaPendente !== undefined) delete r.iaMut(k).salaPendente;
    return;
  }
  if (quando - ia.ultimaTrocaSalaEm >= r.cfg.histereseSalaMs) return definirSala(r, k, sala, quando);
  if (ia.salaPendente !== sala) r.iaMut(k).salaPendente = sala;
}

function tocarAtividade(r: Rascunho, k: string, t: number): void {
  const a = r.agente(k);
  if (!a) return;
  if (a.ultimaAtividade < t) r.agenteMut(k, false).ultimaAtividade = t;
  if (!de(r.interno.vistosAgentes, k)) {
    r.vistos().agentes[k] = true;
    r.metricasMut().agentes = Object.keys(r.interno.vistosAgentes).length;
  }
}

function tocarSala(r: Rascunho, chave: string, t: number): void {
  const s = de(r.mundo.salas, chave);
  if (!s) return;
  if (s.dormindo) r.salaMut(chave).dormindo = false;
  if (s.ultimaAtividade < t) r.salaMut(chave, false).ultimaAtividade = t;
  if (!de(r.interno.vistasSalas, chave)) {
    r.vistos().salas[chave] = true;
    r.metricasMut().salas = Object.keys(r.interno.vistasSalas).length;
  }
}

function alocarTerreno(r: Rascunho, alaId: string): { indice: number; col: number; lin: number } {
  const mapa = r.terrenos();
  const indice = de(mapa, alaId) ?? 0;
  mapa[alaId] = indice + 1;
  return terrenoDoIndice(indice);
}

function abrirObra(r: Rascunho, chave: string, alaId: string, quando: number): void {
  const obra: Obra = { salaChave: chave, alaId, inicio: quando, fim: quando + r.cfg.obraMs };
  r.definirObras([...r.mundo.obras.filter((o) => o.salaChave !== chave), obra]);
  r.sujos.obras.add(chave);
  r.sujos.obrasFim.delete(chave);
}

/** Sala nasce na primeira vez que aparece e nunca é apagada. Pode mudar de ala quando o dono classifica. */
function garantirSala(r: Rascunho, ev: ArcadiaEvent, agora: number, t: number): string | undefined {
  const chave = ev.local.projetoChave;
  if (!chave) return undefined;
  const info = ev.local.sala;
  const alaPedida = info?.ala !== undefined && de(r.mundo.alas, info.ala) ? info.ala : undefined;
  const atual = de(r.mundo.salas, chave);
  if (!atual) {
    const alaId = alaPedida ?? r.interno.recepcaoId;
    const sala: Sala = {
      chave,
      nome: info?.nome ?? 'Sala nova',
      alaId,
      tipo: info?.tipo ?? 'outro',
      terreno: alocarTerreno(r, alaId),
      andar: 1,
      criadaEm: agora,
      ultimaAtividade: t,
      dormindo: false,
      entregas: 0,
      erros: 0,
      entregasHoje: 0,
      errosHoje: 0,
    };
    r.salas()[chave] = sala;
    r.umaVez(`s:${chave}`);
    r.sujos.salas.add(chave);
    abrirObra(r, chave, alaId, agora);
    return chave;
  }
  if (alaPedida !== undefined && alaPedida !== atual.alaId) {
    const s = r.salaMut(chave);
    s.alaId = alaPedida;
    s.terreno = alocarTerreno(r, alaPedida);
    abrirObra(r, chave, alaPedida, agora);
  }
  if (info?.nome !== undefined && info.nome !== atual.nome) r.salaMut(chave).nome = info.nome;
  if (info?.tipo !== undefined && info.tipo !== atual.tipo) r.salaMut(chave).tipo = info.tipo;
  return chave;
}

function garantirAgente(r: Rascunho, ev: ArcadiaEvent, agora: number, t: number): boolean {
  const k = ev.agente.chave;
  const exato = ev.agente.tipo === 'bot' || ORIGENS_EXATAS.has(ev.origem);
  if (r.agente(k)) {
    const ia = r.ia(k);
    if (ia && exato && !ia.exato) r.iaMut(k).exato = true;
    return false;
  }
  const a: Agente = compactar({
    chave: k,
    tipo: ev.agente.tipo,
    motor: ev.motor,
    origem: ev.origem,
    nome: ev.local.excluida && ev.agente.tipo !== 'bot' ? undefined : ev.agente.nome,
    cargo: ev.agente.cargo,
    cor: ev.agente.cor,
    corpo: ev.agente.corpo,
    paiChave: ev.agente.paiChave,
    equipe: ev.local.equipe,
    estado: 'chegando' as EstadoAgente,
    desde: agora,
    ultimasAcoes: [] as Acao[],
    uso: { entrada: 0, saida: 0, cache: 0, custoUsd: 0 },
    chegouEm: t,
    ultimaAtividade: t,
    entregasHoje: 0,
    errosHoje: 0,
  });
  r.agentes()[k] = a;
  r.umaVez(`a:${k}`);
  r.sujos.agentes.add(k);
  r.sujos.saiu.delete(k);
  const ia: InternoAgente = {
    bruto: { estado: 'chegando' },
    brutoDesde: agora,
    visivelMudouEm: agora - r.cfg.debounceMs,
    pendentes: {},
    ordem: [],
    turnoAtivo: false,
    exato,
    ultimaTrocaSalaEm: agora - r.cfg.histereseSalaMs,
  };
  r.internos()[k] = ia;
  r.umaVez(`ia:${k}`);
  return true;
}

function atualizarMetadados(r: Rascunho, ev: ArcadiaEvent): void {
  const k = ev.agente.chave;
  const a = r.agente(k);
  if (!a) return;
  const ia = r.ia(k);
  // Sessão de pasta excluída perde nome e tarefa de vez; bot marcado perde só a tarefa, até o turno novo. Com o
  // título desligado, a tarefa também some.
  const bot = ev.agente.tipo === 'bot';
  const privado = ia?.privado === true || (ev.local.excluida === true && !bot);
  const semTarefa = privado || ia?.privadoTurno === true || ev.local.excluida === true || !r.cfg.mostrarTitulo;
  const novos: Partial<Agente> = compactar({
    tipo: ev.agente.tipo,
    motor: ev.motor,
    nome: privado ? undefined : ev.agente.nome,
    cargo: ev.agente.cargo,
    cor: ev.agente.cor,
    corpo: ev.agente.corpo,
    paiChave: ev.agente.paiChave,
    equipe: ev.local.equipe,
    tarefa: semTarefa ? undefined : ev.tarefa?.titulo,
  });
  if (ORIGENS_EXATAS.has(ev.origem) || !ia?.exato) novos.origem = ev.origem;
  let muda = false;
  for (const [campo, valor] of Object.entries(novos)) {
    if ((a as Record<string, unknown>)[campo] !== valor) muda = true;
  }
  const apagar = (privado && a.nome !== undefined) || (semTarefa && a.tarefa !== undefined);
  if (!muda && !apagar) return;
  const m = r.agenteMut(k);
  Object.assign(m, novos);
  if (privado) delete m.nome;
  if (semTarefa) delete m.tarefa;
}

/** O agente está marcado (de vez ou só no turno): nada de tarefa nem nome de arquivo. */
function marcado(r: Rascunho, k: string): boolean {
  const ia = r.ia(k);
  return ia?.privado === true || ia?.privadoTurno === true;
}

const semAlvo = <T extends { alvo?: string }>(x: T): T => {
  if (x.alvo === undefined) return x;
  const y = { ...x };
  delete y.alvo;
  return y;
};

/**
 * Marca um agente: `agente` de vez (sessão e subagente), `turno` até o próximo turno (bot). O que já aparecia sai
 * agora: os nomes de arquivo e, quando `outro` (o pai de um subagente ou quem delegou ao bot), também a tarefa e,
 * na marca de vez, o nome. Do próprio agente do evento, quem tira nome e tarefa é atualizarMetadados.
 */
function aplicarMarca(r: Rascunho, k: string, tipo: 'agente' | 'turno', outro: boolean): void {
  const ia = r.ia(k);
  const a = r.agente(k);
  if (!ia || !a) return;
  if (tipo === 'agente' ? !ia.privado : !ia.privado && !ia.privadoTurno) {
    const m = r.iaMut(k);
    if (tipo === 'agente') {
      m.privado = true;
      delete m.privadoTurno;
    } else {
      m.privadoTurno = true;
    }
  }
  const tirarNome = outro && tipo === 'agente' && a.nome !== undefined;
  const tirarTarefa = outro && a.tarefa !== undefined;
  const comAlvo = a.ferramenta?.alvo !== undefined || a.ultimasAcoes.some((x) => x.alvo !== undefined);
  if (tirarNome || tirarTarefa || comAlvo) {
    const m = r.agenteMut(k);
    if (tirarNome) delete m.nome;
    if (tirarTarefa) delete m.tarefa;
    if (m.ferramenta?.alvo !== undefined) m.ferramenta = semAlvo(m.ferramenta);
    if (m.ultimasAcoes.some((x) => x.alvo !== undefined)) m.ultimasAcoes = m.ultimasAcoes.map(semAlvo);
  }
  const ib = r.ia(k);
  if (ib && (ib.bruto.ferramenta?.alvo !== undefined || Object.values(ib.pendentes).some((p) => p.alvo !== undefined))) {
    const m = r.iaMut(k);
    if (m.bruto.ferramenta?.alvo !== undefined) m.bruto = { ...m.bruto, ferramenta: semAlvo(m.bruto.ferramenta) };
    m.pendentes = Object.fromEntries(Object.entries(m.pendentes).map(([id, p]) => [id, semAlvo(p)]));
  }
}

/**
 * Evento de pasta excluída (ou de agente já marcado pelo núcleo). Sessão e subagente ficam marcados de vez, e o
 * subagente marca também a sessão-mãe. Bot fica marcado só no turno, junto com o turno de quem delegou a tarefa a
 * ele (a delegação perde o título).
 */
function marcarPrivado(r: Rascunho, ev: ArcadiaEvent): void {
  const k = ev.agente.chave;
  if (ev.agente.tipo !== 'bot') {
    aplicarMarca(r, k, 'agente', false);
    const pai = ev.agente.paiChave;
    if (pai !== undefined && pai !== k) aplicarMarca(r, pai, 'agente', true);
    return;
  }
  aplicarMarca(r, k, 'turno', false);
  for (const d of Object.values(r.mundo.delegacoes)) {
    if (d.para !== k) continue;
    if (d.titulo !== undefined) {
      const sem = { ...d };
      delete sem.titulo;
      gravarDelegacao(r, sem);
    }
    if (d.de !== k) {
      const quem = r.agente(d.de);
      aplicarMarca(r, d.de, quem && quem.tipo !== 'bot' ? 'agente' : 'turno', true);
    }
  }
}

/**
 * Aplica as opções de privacidade ao que já estava gravado (snapshot do banco): título desligado apaga tarefa e
 * título de delegação; nome do arquivo desligado apaga o alvo da ferramenta, das últimas ações e das pendentes;
 * sessão marcada como de pasta excluída perde nome e tarefa; bot com o turno marcado perde a tarefa. A marca de vez
 * num bot (gravada antes de a marca do bot valer só no turno) cai: o nome do bot vem do OpenMausBot e volta no
 * próximo evento. Devolve o mesmo objeto quando nada muda.
 */
export function limparPorPrivacidade(estado: EstadoMotor, cfg: ConfigMotor): EstadoMotor {
  const semTitulo = !cfg.mostrarTitulo;
  const semAlvo = !cfg.mostrarAlvo;
  let mudou = false;
  const semAlvoEm = <T extends { alvo?: string }>(x: T): T => {
    if (x.alvo === undefined) return x;
    const y = { ...x };
    delete y.alvo;
    mudou = true;
    return y;
  };
  const ehBot = (k: string) => de(estado.mundo.agentes, k)?.tipo === 'bot';
  const agentes = Object.fromEntries(
    Object.entries(estado.mundo.agentes).map(([k, a]) => {
      const ia = de(estado.interno.agentes, k);
      const privado = ia?.privado === true && a.tipo !== 'bot';
      const semTarefa = semTitulo || privado || ia?.privadoTurno === true;
      let novo = a;
      if ((semTarefa && a.tarefa !== undefined) || (privado && a.nome !== undefined)) {
        novo = { ...novo };
        if (semTarefa) delete novo.tarefa;
        if (privado) delete novo.nome;
        mudou = true;
      }
      if (semAlvo) {
        if (novo.ferramenta?.alvo !== undefined) novo = { ...novo, ferramenta: semAlvoEm(novo.ferramenta) };
        if (novo.ultimasAcoes.some((x) => x.alvo !== undefined)) novo = { ...novo, ultimasAcoes: novo.ultimasAcoes.map(semAlvoEm) };
      }
      return [k, novo];
    }),
  ) as Record<string, Agente>;
  const delegacoes = Object.fromEntries(
    Object.entries(estado.mundo.delegacoes).map(([k, d]) => {
      if (!semTitulo || d.titulo === undefined) return [k, d];
      const novo = { ...d };
      delete novo.titulo;
      mudou = true;
      return [k, novo];
    }),
  ) as Record<string, Delegacao>;
  const internos = Object.fromEntries(
    Object.entries(estado.interno.agentes).map(([k, ia]) => {
      let novo = ia;
      if (ia.privado === true && ehBot(k)) {
        novo = { ...novo };
        delete novo.privado;
        mudou = true;
      }
      if (!semAlvo) return [k, novo];
      if (ia.bruto.ferramenta?.alvo !== undefined) novo = { ...novo, bruto: { ...novo.bruto, ferramenta: semAlvoEm(ia.bruto.ferramenta) } };
      if (Object.values(ia.pendentes).some((p) => p.alvo !== undefined)) {
        novo = { ...novo, pendentes: Object.fromEntries(Object.entries(ia.pendentes).map(([id, p]) => [id, semAlvoEm(p)])) };
      }
      return [k, novo];
    }),
  ) as Record<string, InternoAgente>;
  if (!mudou) return estado;
  return { mundo: { ...estado.mundo, agentes, delegacoes }, interno: { ...estado.interno, agentes: internos } };
}

function contarFonte(r: Rascunho, ev: ArcadiaEvent): void {
  const atual = de(r.mundo.saude.fontes, ev.origem);
  const nova = !atual;
  const fontes = r.fontes(nova);
  fontes[ev.origem] = {
    ...(atual ?? { estado: ev.origem === 'sim' ? 'simulada' : 'ligada', ignoradas: 0 }),
    eventos: (atual?.eventos ?? 0) + 1,
    ultimoEvento: Math.max(atual?.ultimoEvento ?? 0, ev.ts),
  } as SaudeFonte;
}

function adicionarPendente(r: Rascunho, k: string, ev: ArcadiaEvent, quando: number): void {
  const f = ev.ferramenta;
  if (!f) return;
  const ia = r.iaMut(k);
  let id = f.id;
  if (id === undefined) {
    r.interno.contador++;
    id = `anon.${r.interno.contador}`;
  }
  const p: FerramentaPendente = { nome: f.nome, categoria: f.categoria, desde: quando };
  if (f.alvo !== undefined && r.cfg.mostrarAlvo && !marcado(r, k)) p.alvo = f.alvo;
  ia.pendentes = { ...ia.pendentes, [id]: p };
  let ordem = [...ia.ordem.filter((x) => x !== id), id];
  if (ordem.length > 50) {
    const sobra = ordem.slice(0, ordem.length - 50);
    ordem = ordem.slice(-50);
    const pendentes = { ...ia.pendentes };
    for (const s of sobra) delete pendentes[s];
    ia.pendentes = pendentes;
  }
  ia.ordem = ordem;
}

function removerPendente(r: Rascunho, k: string, ev: ArcadiaEvent): void {
  const f = ev.ferramenta;
  const ia = r.ia(k);
  if (!f || !ia) return;
  let id: string | undefined = f.id !== undefined && de(ia.pendentes, f.id) ? f.id : undefined;
  if (id === undefined) id = ia.ordem.find((x) => de(ia.pendentes, x)?.nome === f.nome);
  if (id === undefined) return;
  const m = r.iaMut(k);
  const pendentes = { ...m.pendentes };
  delete pendentes[id];
  m.pendentes = pendentes;
  m.ordem = m.ordem.filter((x) => x !== id);
}

function acharDelegacao(r: Rascunho, d: { de: string; para: string; jobId?: string | undefined }): Delegacao | undefined {
  if (d.jobId !== undefined) {
    const porJob = de(r.mundo.delegacoes, d.jobId);
    if (porJob) return porJob;
  }
  return Object.values(r.mundo.delegacoes).find((x) => x.de === d.de && x.para === d.para);
}

function gravarDelegacao(r: Rascunho, d: Delegacao): void {
  r.delegacoes()[d.chave] = d;
  r.sujos.delegacoes.add(d.chave);
  r.sujos.delegacoesFim.delete(d.chave);
}

function removerDelegacao(r: Rascunho, chave: string): void {
  if (!de(r.mundo.delegacoes, chave)) return;
  delete r.delegacoes()[chave];
  r.sujos.delegacoes.delete(chave);
  r.sujos.delegacoesFim.add(chave);
}

function esperandoExato(r: Rascunho, k: string): boolean {
  return r.ia(k)?.bruto.estado === 'esperando';
}

const DESCANSO: ReadonlySet<EstadoAgente> = new Set(['ocioso', 'entregou', 'pausa', 'dormindo', 'chegando']);

/**
 * Presença informada pela fonte (snapshot e quadros de bot do OpenMausBot): acerta o estado sem contar métrica.
 * É idempotente: repetir a mesma presença não muda nada nem reinicia timer.
 */
function aplicarPresenca(r: Rascunho, k: string, estado: EstadoPresenca | undefined, agora: number): void {
  const ia = r.ia(k);
  if (!ia || !estado) return;
  const atual = ia.bruto.estado;
  switch (estado) {
    case 'ativo': {
      if (ia.turnoAtivo && !DESCANSO.has(atual) && atual !== 'na-fila' && atual !== 'sem-sinal') return;
      const m = r.iaMut(k);
      m.turnoAtivo = true;
      if (atual === 'esperando') return;
      definirBruto(r, k, visivelDasPendentes(m), agora);
      return;
    }
    case 'ocioso': {
      if (DESCANSO.has(atual) && !ia.turnoAtivo) return;
      limparTurno(r, k);
      tirarDaFila(r, k);
      if (!DESCANSO.has(atual)) definirBruto(r, k, { estado: 'ocioso' }, agora);
      return;
    }
    case 'esperando': {
      if (atual === 'esperando') return;
      porNaFila(r, k, 'aprovacao', agora);
      definirBruto(r, k, { estado: 'esperando', espera: { tipo: 'aprovacao', desde: agora } }, agora);
      return;
    }
    case 'na-fila':
    case 'sem-sinal': {
      if (atual === estado) return;
      definirBruto(r, k, { estado }, agora);
      return;
    }
  }
}

function tratarTipo(r: Rascunho, ev: ArcadiaEvent, agora: number, t: number): void {
  const k = ev.agente.chave;
  const a = r.agente(k);
  if (!a) return;
  if (RETOMAM.has(ev.tipo) && esperandoExato(r, k)) tirarDaFila(r, k);

  switch (ev.tipo) {
    case 'sessao.inicio': {
      if (a.tipo === 'bot') return;
      limparTurno(r, k);
      definirBruto(r, k, { estado: 'chegando' }, agora);
      return;
    }
    case 'sessao.fim': {
      limparTurno(r, k);
      tirarDaFila(r, k);
      definirBruto(r, k, { estado: a.tipo === 'bot' ? 'ocioso' : 'saindo' }, agora);
      return;
    }
    case 'pedido.humano':
    case 'turno.inicio': {
      const ia = r.iaMut(k);
      ia.turnoAtivo = true;
      delete ia.textoEm;
      const m = r.metricasMut();
      if (ev.tipo === 'pedido.humano') m.pedidos++;
      else m.turnos++;
      definirBruto(r, k, visivelDasPendentes(r.iaMut(k)), agora);
      return;
    }
    case 'pensando': {
      const ia = r.iaMut(k);
      ia.turnoAtivo = true;
      // Só texto, sem ferramenta pendente: arma o timer de 5 s. Raciocínio depois do texto desarma.
      if (ia.ordem.length === 0 && ev.turno?.texto) ia.textoEm = agora;
      else delete ia.textoEm;
      if (esperandoExato(r, k)) return;
      definirBruto(r, k, visivelDasPendentes(ia), agora);
      return;
    }
    case 'ferramenta.inicio': {
      const f = ev.ferramenta;
      if (!f) return;
      adicionarPendente(r, k, ev, agora);
      const ia = r.iaMut(k);
      ia.turnoAtivo = true;
      delete ia.textoEm;
      r.metricasMut().ferramentas++;
      registrarAcao(r, k, compactar({ ts: t, tipo: ev.tipo, categoria: f.categoria, nome: f.nome, alvo: r.cfg.mostrarAlvo && !marcado(r, k) ? f.alvo : undefined }));
      definirBruto(r, k, visivelDasPendentes(ia), agora);
      return;
    }
    case 'ferramenta.fim':
    case 'ferramenta.erro': {
      const f = ev.ferramenta;
      if (!f) return;
      removerPendente(r, k, ev);
      const falhou = ev.tipo === 'ferramenta.erro' || f.ok === false;
      if (falhou) {
        contarErro(r, k);
        registrarAcao(r, k, compactar({ ts: t, tipo: ev.tipo, categoria: f.categoria, nome: f.nome, ok: false }));
      }
      if (esperandoExato(r, k)) return;
      definirBruto(r, k, falhou ? { estado: 'erro' } : visivelDasPendentes(r.iaMut(k)), agora);
      return;
    }
    case 'espera.inicio': {
      const tipo = ev.espera?.tipo ?? 'talvez';
      if (tipo === 'talvez') {
        if (esperandoExato(r, k)) return;
        definirBruto(r, k, { estado: 'talvez-esperando', espera: { tipo, desde: agora } }, agora);
        return;
      }
      r.metricasMut().esperas++;
      porNaFila(r, k, tipo, agora);
      registrarAcao(r, k, { ts: t, tipo: ev.tipo });
      definirBruto(r, k, { estado: 'esperando', espera: { tipo, desde: agora } }, agora);
      return;
    }
    case 'espera.fim': {
      tirarDaFila(r, k);
      const est = r.ia(k)?.bruto.estado;
      if (est === 'esperando' || est === 'talvez-esperando') definirBruto(r, k, visivelDasPendentes(r.iaMut(k)), agora);
      return;
    }
    case 'delegacao.enviada': {
      const d = ev.delegacao;
      if (!d) return;
      gravarDelegacao(r, compactar({
        chave: d.jobId ?? ev.id, de: d.de, para: d.para, jobId: d.jobId, titulo: r.cfg.mostrarTitulo && !ev.local.excluida ? d.titulo : undefined, status: d.status ?? 'enviada', desde: agora, atualizadaEm: agora,
      }));
      r.metricasMut().delegacoes++;
      registrarAcao(r, k, { ts: t, tipo: ev.tipo, categoria: 'delegar' });
      if (k === d.de && !esperandoExato(r, k)) definirBruto(r, k, { estado: 'delegando' }, agora);
      return;
    }
    case 'delegacao.recebida': {
      const d = ev.delegacao;
      if (!d) return;
      const atual = acharDelegacao(r, d);
      gravarDelegacao(r, compactar({
        chave: atual?.chave ?? d.jobId ?? ev.id, de: d.de, para: d.para, jobId: d.jobId ?? atual?.jobId,
        titulo: r.cfg.mostrarTitulo && !ev.local.excluida ? (d.titulo ?? atual?.titulo) : undefined, status: d.status ?? 'recebida', desde: atual?.desde ?? agora, atualizadaEm: agora,
      }));
      if (k === d.para) {
        r.iaMut(k).turnoAtivo = true;
        if (d.titulo !== undefined && r.cfg.mostrarTitulo && !marcado(r, k) && a.tarefa !== d.titulo) r.agenteMut(k).tarefa = d.titulo;
        if (!esperandoExato(r, k)) definirBruto(r, k, visivelDasPendentes(r.iaMut(k)), agora);
      }
      return;
    }
    case 'delegacao.concluida': {
      const d = ev.delegacao;
      if (!d) return;
      const atual = acharDelegacao(r, d);
      if (atual) removerDelegacao(r, atual.chave);
      const remetente = d.de;
      const aindaDelega = Object.values(r.mundo.delegacoes).some((x) => x.de === remetente);
      const ia = r.ia(remetente);
      if (ia && ia.bruto.estado === 'delegando' && !aindaDelega && ia.ordem.length === 0) {
        r.iaMut(remetente).turnoAtivo = true;
        definirBruto(r, remetente, { estado: 'pensando' }, agora);
      }
      return;
    }
    case 'subagente.inicio': {
      r.iaMut(k).turnoAtivo = true;
      definirBruto(r, k, { estado: 'pensando' }, agora);
      return;
    }
    case 'subagente.fim': {
      limparTurno(r, k);
      definirBruto(r, k, { estado: 'saindo' }, agora);
      return;
    }
    case 'compactacao': {
      registrarAcao(r, k, { ts: t, tipo: ev.tipo });
      return;
    }
    case 'erro': {
      limparTurno(r, k);
      tirarDaFila(r, k);
      contarErro(r, k);
      registrarAcao(r, k, { ts: t, tipo: ev.tipo, ok: false });
      definirBruto(r, k, { estado: 'erro' }, agora);
      return;
    }
    case 'limite': {
      limparTurno(r, k);
      tirarDaFila(r, k);
      registrarAcao(r, k, { ts: t, tipo: ev.tipo });
      definirBruto(r, k, { estado: 'limite' }, agora);
      return;
    }
    case 'uso': {
      const u = ev.uso;
      if (!u) return;
      const ag = r.agenteMut(k);
      ag.uso = {
        entrada: ag.uso.entrada + (u.entrada ?? 0),
        saida: ag.uso.saida + (u.saida ?? 0),
        cache: ag.uso.cache + (u.cache ?? 0),
        custoUsd: Math.round((ag.uso.custoUsd + (u.custoUsd ?? 0)) * 1e6) / 1e6,
      };
      const m = r.metricasMut();
      m.tokens = { entrada: m.tokens.entrada + (u.entrada ?? 0), saida: m.tokens.saida + (u.saida ?? 0), cache: m.tokens.cache + (u.cache ?? 0) };
      m.custoUsd = Math.round((m.custoUsd + (u.custoUsd ?? 0)) * 1e6) / 1e6;
      return;
    }
    case 'entrega': {
      contarEntrega(r, k);
      registrarAcao(r, k, { ts: t, tipo: ev.tipo });
      return;
    }
    case 'turno.fim': {
      // Duas fontes podem fechar o mesmo turno (transcrição e sessão viva, por exemplo): só o primeiro fim conta.
      if (!r.ia(k)?.turnoAtivo) return;
      if (ev.turno?.interrompido) {
        limparTurno(r, k);
        tirarDaFila(r, k);
        registrarAcao(r, k, { ts: t, tipo: ev.tipo, ok: false });
        definirBruto(r, k, { estado: 'ocioso' }, agora);
        return;
      }
      registrarAcao(r, k, { ts: t, tipo: ev.tipo, ok: true });
      fimDeTurno(r, k, agora, false);
      return;
    }
    case 'presenca': {
      aplicarPresenca(r, k, ev.presenca?.estado, agora);
      return;
    }
    case 'dominio':
      return;
  }
}

function aplicarEvento(r: Rascunho, ev: ArcadiaEvent): void {
  const agora = Math.max(r.mundo.agora, ev.recebidoEm);
  avancar(r, agora);
  const t = Math.min(ev.ts, agora);
  const k = ev.agente.chave;
  contarFonte(r, ev);
  const sala = garantirSala(r, ev, agora, t);
  const nova = garantirAgente(r, ev, agora, t);
  // Bot começando um turno novo: a marca do turno anterior cai (o núcleo tira a dele antes de esconder o evento).
  if (ev.agente.tipo === 'bot' && !ev.local.excluida && iniciaTurno(ev) && r.ia(k)?.privadoTurno) delete r.iaMut(k).privadoTurno;
  // Pasta excluída (ou agente que o núcleo já sabe marcado): a marca fica no estado interno.
  if (ev.local.excluida) marcarPrivado(r, ev);
  atualizarMetadados(r, ev);
  // Uso, domínio e presença de descanso não são atividade (não reiniciam os timers de pausa e sono).
  const atividade = ev.tipo !== 'uso' && ev.tipo !== 'dominio' && !(ev.tipo === 'presenca' && ev.presenca?.estado !== 'ativo');
  if (atividade) tocarAtividade(r, k, t);
  if (sala !== undefined) moverAgente(r, k, sala, agora);
  else if (nova && ev.agente.paiChave) {
    const salaDoPai = r.agente(ev.agente.paiChave)?.salaChave;
    if (salaDoPai !== undefined) moverAgente(r, k, salaDoPai, agora);
  }
  if (atividade && ev.agente.paiChave && ev.agente.paiChave !== k) tocarAtividade(r, ev.agente.paiChave, t);
  if (atividade) {
    const s = r.agente(k)?.salaChave;
    if (s !== undefined) tocarSala(r, s, t);
  }
  tratarTipo(r, ev, agora, t);
  // Evento semântico (animação no cliente) só quando é recente: o catch-up de 24 h muda o estado, mas não anima.
  if (ev.tipo !== 'pensando' && ev.tipo !== 'uso' && ev.tipo !== 'presenca' && agora - t <= EVENTO_RECENTE_MS) r.eventos.push(ev);
  avancar(r, agora);
}

// Timers

type TipoTimer = 'commit' | 'saida' | 'texto' | 'talvez' | 'chegada' | 'pausa' | 'dorme' | 'visitante' | 'sala';
type Candidato = { quando: number; tipo: TipoTimer };

function candidatos(a: Agente, ia: InternoAgente, cfg: ConfigMotor): Candidato[] {
  const c: Candidato[] = [];
  if (ia.commitEm !== undefined) c.push({ quando: ia.commitEm, tipo: 'commit' });
  const est = ia.bruto.estado;
  if (est === 'saindo') {
    c.push({ quando: ia.brutoDesde + cfg.saindoMs, tipo: 'saida' });
    return c;
  }
  if (ia.turnoAtivo && ia.textoEm !== undefined && ia.ordem.length === 0 && est !== 'esperando') {
    c.push({ quando: Math.max(ia.textoEm, a.ultimaAtividade) + cfg.textoConcluiMs, tipo: 'texto' });
  }
  // Só quem está trabalhando (ferramenta ou pensando) vira "talvez esperando". Em descanso (dormindo, pausa) ou em
  // erro, não: senão o "dorme" e o "talvez" se alternariam sem fim no mesmo instante (defeito achado no marco 3).
  if (!ia.exato && (est === 'pensando' || ESTADOS_DE_FERRAMENTA.has(est))) {
    let maisAntiga = Infinity;
    for (const id of ia.ordem) {
      const p = de(ia.pendentes, id);
      if (p && p.categoria !== 'delegar' && p.desde < maisAntiga) maisAntiga = p.desde;
    }
    if (maisAntiga !== Infinity) c.push({ quando: Math.max(maisAntiga, a.ultimaAtividade) + cfg.talvezEsperandoMs, tipo: 'talvez' });
  }
  if (est === 'chegando') c.push({ quando: ia.brutoDesde + cfg.chegandoMs, tipo: 'chegada' });
  if (pausavel(est, ia)) c.push({ quando: a.ultimaAtividade + cfg.pausaMs, tipo: 'pausa' });
  if (dormivel(est, ia)) c.push({ quando: a.ultimaAtividade + cfg.dormeMs, tipo: 'dorme' });
  if (est === 'dormindo' && (a.tipo === 'sessao' || a.tipo === 'subagente')) c.push({ quando: ia.brutoDesde + cfg.visitanteSaiMs, tipo: 'visitante' });
  if (ia.salaPendente !== undefined) c.push({ quando: ia.ultimaTrocaSalaEm + cfg.histereseSalaMs, tipo: 'sala' });
  return c;
}

function vencimentoAgente(a: Agente, ia: InternoAgente, cfg: ConfigMotor): number | undefined {
  let min: number | undefined;
  for (const c of candidatos(a, ia, cfg)) if (min === undefined || c.quando < min) min = c.quando;
  return min;
}

/** Instante do próximo timer do mundo (para o servidor agendar o tick, se quiser). */
export function proximoVencimento(estado: EstadoMotor, cfg: ConfigMotor): number {
  const { mundo, interno } = estado;
  let min = interno.meiaNoite;
  for (const [k, ia] of Object.entries(interno.agentes)) {
    const a = de(mundo.agentes, k);
    if (!a) continue;
    const v = vencimentoAgente(a, ia, cfg);
    if (v !== undefined && v < min) min = v;
  }
  for (const o of mundo.obras) if (o.fim < min) min = o.fim;
  for (const d of Object.values(mundo.delegacoes)) {
    const v = d.atualizadaEm + cfg.delegacaoExpiraMs;
    if (v < min) min = v;
  }
  for (const s of Object.values(mundo.salas)) {
    if (s.dormindo) continue;
    const v = s.ultimaAtividade + cfg.salaDormeMs;
    if (v < min) min = v;
  }
  return min;
}

function executarTimer(r: Rascunho, k: string, c: Candidato): void {
  const quando = c.quando;
  switch (c.tipo) {
    case 'commit':
      commitar(r, k, quando);
      return;
    case 'saida':
      removerAgente(r, k, quando);
      return;
    case 'texto':
      fimDeTurno(r, k, quando, true);
      return;
    case 'talvez':
      definirBruto(r, k, { estado: 'talvez-esperando', espera: { tipo: 'talvez', desde: quando } }, quando);
      emitirSintetico(r, k, 'espera.inicio', quando, { espera: { tipo: 'talvez' } });
      return;
    case 'chegada':
      definirBruto(r, k, { estado: 'ocioso' }, quando);
      return;
    case 'pausa':
      // Subagente é minidrone: sem trabalho, ele some em vez de ir para a academia.
      definirBruto(r, k, { estado: r.agente(k)?.tipo === 'subagente' ? 'saindo' : 'pausa' }, quando);
      return;
    case 'dorme':
      definirBruto(r, k, { estado: 'dormindo' }, quando);
      return;
    case 'visitante':
      definirBruto(r, k, { estado: 'saindo' }, quando);
      return;
    case 'sala': {
      const pendente = r.ia(k)?.salaPendente;
      if (pendente !== undefined) definirSala(r, k, pendente, quando);
      return;
    }
  }
}

function virarDia(r: Rascunho, quando: number): void {
  r.diasFechados.push({ dia: r.interno.dia, metricas: r.mundo.metricas });
  r.mundo.metricas = metricasVazias(diaTexto(quando, r.cfg.fuso));
  r.umaVez('m:metricas');
  r.sujos.metricas = true;
  r.interno.dia = chaveDoDia(quando, r.cfg.fuso);
  r.interno.meiaNoite = proximaMeiaNoite(quando, r.cfg.fuso);
  r.interno.vistosAgentes = {};
  r.interno.vistasSalas = {};
  r.umaVez('i:vistos');
  for (const a of Object.values(r.mundo.agentes)) {
    if (a.entregasHoje || a.errosHoje || a.uso.entrada || a.uso.saida || a.uso.cache || a.uso.custoUsd) {
      const m = r.agenteMut(a.chave);
      m.entregasHoje = 0;
      m.errosHoje = 0;
      m.uso = { entrada: 0, saida: 0, cache: 0, custoUsd: 0 };
    }
  }
  for (const s of Object.values(r.mundo.salas)) {
    if (s.entregasHoje || s.errosHoje) {
      const m = r.salaMut(s.chave);
      m.entregasHoje = 0;
      m.errosHoje = 0;
    }
  }
}

function vencer(r: Rascunho, t: number): void {
  if (t > r.mundo.agora) r.mundo.agora = t;
  if (r.interno.meiaNoite <= t) virarDia(r, r.interno.meiaNoite);
  for (const k of Object.keys(r.mundo.agentes)) {
    const a = r.agente(k);
    const ia = r.ia(k);
    if (!a || !ia) continue;
    let escolhido: Candidato | undefined;
    for (const c of candidatos(a, ia, r.cfg)) if (c.quando <= t && (!escolhido || c.quando < escolhido.quando)) escolhido = c;
    if (escolhido) executarTimer(r, k, escolhido);
  }
  if (r.mundo.obras.some((o) => o.fim <= t)) {
    for (const o of r.mundo.obras) {
      if (o.fim <= t) {
        r.sujos.obrasFim.add(o.salaChave);
        r.sujos.obras.delete(o.salaChave);
      }
    }
    r.definirObras(r.mundo.obras.filter((o) => o.fim > t));
  }
  for (const d of Object.values(r.mundo.delegacoes)) if (d.atualizadaEm + r.cfg.delegacaoExpiraMs <= t) removerDelegacao(r, d.chave);
  for (const s of Object.values(r.mundo.salas)) if (!s.dormindo && s.ultimaAtividade + r.cfg.salaDormeMs <= t) r.salaMut(s.chave).dormindo = true;
}

function avancar(r: Rascunho, ate: number): void {
  let anterior = -Infinity;
  let repetidas = 0;
  for (let guarda = 0; guarda < 1_000_000; guarda++) {
    const t = proximoVencimento({ mundo: r.mundo, interno: r.interno }, r.cfg);
    if (t > ate) break;
    // Trava de segurança: timers que se reativam sempre no mesmo instante (defeito) param aqui, em vez de girar
    // até a guarda e travar o servidor. Nenhum caso legítimo chega perto de mil disparos no mesmo milissegundo.
    if (t === anterior) {
      if (++repetidas > 1_000) break;
    } else {
      anterior = t;
      repetidas = 0;
    }
    vencer(r, t);
  }
  if (ate > r.mundo.agora) r.mundo.agora = ate;
}

function aplicarAlas(r: Rascunho, alas: AlaConfig[], recepcao: AlaConfig, agora: number): void {
  const recep = de(r.mundo.alas, r.interno.recepcaoId);
  if (recep && (recep.nome !== recepcao.nome || recep.cor !== recepcao.cor)) {
    const m = r.alaMut(recep.id);
    m.nome = recepcao.nome;
    m.cor = recepcao.cor;
  }
  const ids = new Set(alas.map((a) => a.id));
  for (const c of alas) {
    if (c.id === r.interno.recepcaoId) continue;
    const atual = de(r.mundo.alas, c.id);
    if (!atual) {
      const ordem = r.interno.proximaOrdemAla++;
      const nova: Ala = { id: c.id, nome: c.nome, cor: c.cor, ordem, lote: loteDaOrdem(ordem), tipo: 'projetos', ativa: true, criadaEm: agora };
      if (c.tema !== undefined) nova.tema = c.tema;
      r.alas()[c.id] = nova;
      r.umaVez(`al:${c.id}`);
      r.sujos.alas.add(c.id);
    } else if (atual.nome !== c.nome || atual.cor !== c.cor || !atual.ativa || atual.tema !== c.tema) {
      const m = r.alaMut(c.id);
      m.nome = c.nome;
      m.cor = c.cor;
      m.ativa = true;
      // O tema segue a configuração: tirado de lá, ele sai do estado (o mundo volta a escolher).
      if (c.tema !== undefined) m.tema = c.tema;
      else delete m.tema;
    }
  }
  for (const a of Object.values(r.mundo.alas)) {
    if (a.tipo === 'projetos' && a.ativa && !ids.has(a.id)) r.alaMut(a.id).ativa = false;
  }
}

function aplicarSaude(r: Rascunho, fonte: string, dados: Extract<Entrada, { k: 'saude' }>['saude']): void {
  const atual = de(r.mundo.saude.fontes, fonte);
  const nova: SaudeFonte = compactar({
    estado: dados.estado,
    mensagem: dados.mensagem !== undefined ? sanearTexto(dados.mensagem, 160) : undefined,
    versao: dados.versao !== undefined ? sanearTexto(dados.versao, 32) : atual?.versao,
    ultimoEvento: atual?.ultimoEvento,
    eventos: atual?.eventos ?? 0,
    ignoradas: dados.ignoradas ?? atual?.ignoradas ?? 0,
  });
  if (atual && JSON.stringify(atual) === JSON.stringify(nova)) return;
  r.fontes(true)[fonte] = nova;
}

/** O redutor: estado e entrada viram estado novo e mudanças. O estado recebido não é alterado. */
export function aplicar(estado: EstadoMotor, entrada: Entrada, cfg: ConfigMotor): Resultado {
  const r = new Rascunho(estado, cfg);
  switch (entrada.k) {
    case 'evento':
      aplicarEvento(r, entrada.evento);
      break;
    case 'tick':
      avancar(r, entrada.agora);
      break;
    case 'alas':
      avancar(r, entrada.agora);
      aplicarAlas(r, entrada.alas, entrada.recepcao, entrada.agora);
      break;
    case 'saude':
      avancar(r, entrada.agora);
      aplicarSaude(r, entrada.fonte, entrada.saude);
      break;
  }
  return r.finalizar();
}

/** Aplica uma sequência de entradas (replay, testes). */
export function aplicarTodas(estado: EstadoMotor, entradas: Iterable<Entrada>, cfg: ConfigMotor): EstadoMotor {
  let e = estado;
  for (const en of entradas) e = aplicar(e, en, cfg).estado;
  return e;
}
