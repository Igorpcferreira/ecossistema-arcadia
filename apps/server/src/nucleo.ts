// Núcleo do servidor: liga as peças. Toda entrada passa por aqui, nesta ordem:
//   saneamento (allowlist e regex) > deduplicação > sala decidida pelo caminho (só em memória; se o disco ainda não
//   respondeu, o evento espera na fila do próprio agente, com teto de tempo e de tamanho, sem furar a ordem dele; o
//   cwd decide só para agente sem sala ou quando muda de sala, e arquivo só leva para sala de projeto) >
//   marca de pasta excluída (tabela do banco, carregada antes de qualquer evento) esconde o que o agente não pode
//   mostrar > guarda da saída > banco > motor (redutor puro) > layout e métricas no banco > transmissão (com a guarda).
import path from 'node:path';
import {
  LIMITES, nomeCurtoDeArquivo, protegerSaida, sanearEvento, sanearTexto,
  type Ala, type ArcadiaEvent, type Contador, type EstadoFonte, type EstadoMundo, type Mudanca,
} from '@arcadia/shared';
import type { Config } from './config/esquema.ts';
import type { Banco, TipoMarca } from './db/banco.ts';
import {
  aplicar, configMotorPadrao, criarEstadoInicial, iniciaTurno, limparPorPrivacidade, proximoVencimento,
  type AlaConfig, type ConfigMotor, type Entrada, type EstadoMotor, type Resultado,
} from './mundo/motor.ts';
import { ORIGENS_DE_PROJETO, criarResolvedor, type Resolvedor, type ResultadoSala, type SalaResolvida, type SistemaArquivos } from './mundo/salas.ts';
import { criarTransmissor, type Transmissor } from './http/transmissor.ts';
import { descreverErro, type Log } from './util/log.ts';
import type { AmbienteCaminhos } from './util/caminhos.ts';
import { hashCurto } from './util/hash.ts';
import type { Agendamento, Relogio } from './util/relogio.ts';

/**
 * O que um adaptador entrega: o evento (ainda bruto) e, só em memória, os caminhos para decidir a sala:
 * `cwd` da sessão, `arquivo` que uma ferramenta mexe (a sala é a da pasta dele) e `pasta` que ela percorre.
 * Qualquer um deles numa pasta excluída marca o agente (veja `marcarPorExclusao`).
 */
export type EntradaBruta = { evento: unknown; caminhos?: { cwd?: string; arquivo?: string; pasta?: string } };
type Caminhos = NonNullable<EntradaBruta['caminhos']>;

/** Pasta de um arquivo, em Windows ou não, sem depender do sistema em que o servidor roda. */
function pastaDoArquivo(arquivo: string): string {
  return /^[A-Za-z]:[\\/]/.test(arquivo) || arquivo.includes('\\') ? path.win32.dirname(arquivo) : path.posix.dirname(arquivo);
}

/** Só textos razoáveis passam como caminho (um adaptador com defeito não derruba o núcleo). */
function limparCaminhos(c: unknown): Caminhos | undefined {
  if (typeof c !== 'object' || c === null) return undefined;
  const o = c as Record<string, unknown>;
  const r: Caminhos = {};
  for (const k of ['cwd', 'arquivo', 'pasta'] as const) {
    const v = Object.hasOwn(o, k) ? o[k] : undefined;
    if (typeof v === 'string' && v.trim().length > 0 && v.length <= 4_096) r[k] = v;
  }
  return Object.keys(r).length > 0 ? r : undefined;
}

export type Contadores = {
  recebidos: number;
  aceitos: number;
  recusados: number;
  duplicados: number;
  camposDescartados: number;
  textosMascarados: number;
  /** Eventos de pasta da lista de exclusão: sem sala e sem nome de arquivo; o agente fica marcado. */
  excluidos: number;
  /** Eventos com caminho que não vira sala aqui (pasta privada de tarefa do OMB, resolvida pelo adaptador). */
  foraDaSala: number;
  /** Eventos que passaram pela fila: esperaram o disco responder (procura de .git) ou um evento da frente. */
  esperaramSala: number;
  /** Eventos que estouraram o teto da fila (tempo ou tamanho) e entraram com a sala atual do agente. */
  esperaEstourada: number;
  /** Eventos sem sala porque o disco não respondeu no prazo (ou a raiz estava marcada como lenta). */
  salaDesconhecida: number;
  /** Eventos de arquivo (ou pasta percorrida) fora das raízes conhecidas: ficaram na sala atual do agente. */
  arquivoForaDasRaizes: number;
  /** Arquivos que não mudaram a sala do agente, pelo motivo: pasta de rascunho (`salas.rascunho`). */
  arquivoEmRascunho: number;
  /** ... pasta de apoio na raiz de uma agregadora, ou a própria raiz da agregadora. */
  arquivoEmApoio: number;
  /** ... pasta comum sem git (só o cwd faz dela uma sala), a pasta pessoal ou a raiz do disco. */
  arquivoEmPastaComum: number;
  /** ... sala fixa (pastas dos agentes, dados do Arcadia, pasta de rede). */
  arquivoEmSalaFixa: number;
  /** ... leitura ou busca isolada em outra sala de projeto (só três seguidas na mesma sala levam o agente). */
  leituraIsolada: number;
  /** Falhas ao decidir a sala (o evento seguiu sem sala). */
  errosDeSala: number;
  /** Textos que a guarda trocou por [oculto] antes de gravar no banco (o normal é zero). */
  bloqueadosNaGravacao: number;
};

export type Nucleo = {
  readonly transmissor: Transmissor;
  readonly resolvedor: Resolvedor;
  readonly configMotor: ConfigMotor;
  readonly iniciadoEm: number;
  readonly buildId: string;
  readonly instancia: string;
  estado(): EstadoMotor;
  mundo(): EstadoMundo;
  /**
   * Entrada de um evento. `ok` sem `seq` quando o evento ficou na fila do agente esperando o disco (a sala ainda não
   * foi decidida); ele entra no mundo, na ordem do agente, assim que o disco responder ou o teto de espera vencer.
   */
  ingerir(entrada: EntradaBruta): { ok: true; seq?: number } | { ok: false; motivo: 'esquema' | 'duplicado' };
  /** Resolve quando as filas de eventos esperando sala esvaziarem. */
  ocioso(): Promise<void>;
  informarSaude(fonte: string, saude: { estado: EstadoFonte; mensagem?: string; versao?: string; ignoradas?: number }): void;
  contadores(): Contadores;
  /** Agentes com marca de pasta excluída (de vez ou no turno) e salas que nasceram fora das raízes conhecidas. */
  privacidade(): { marcas: number; marcasDeTurno: number; salasForaDasRaizes: number };
  gravarSnapshot(): void;
  iniciar(): void;
  parar(): void;
};

export type OpcoesNucleo = {
  config: Config;
  relogio: Relogio;
  log: Log;
  amb: AmbienteCaminhos;
  buildId: string;
  instancia: string;
  /** Sem banco o mundo vive só em memória (testes e demonstração). */
  banco?: Banco;
  fs?: SistemaArquivos;
  /** Sal das chaves de sala e das marcas. Padrão: o do banco (ou um fixo de memória, sem banco). */
  sal?: string;
  tickMs?: number;
  snapshotACadaMs?: number;
  retencaoACadaMs?: number;
  configMotor?: Partial<ConfigMotor>;
  /** Teto de espera de cada evento pela sala (padrão: 3 s). Venceu: o evento entra com a sala atual do agente. */
  esperaMaxSalaMs?: number;
  /** Teto da fila de cada agente (padrão: 1.000 eventos). Cheia: o mais antigo entra já, com a sala atual. */
  limiteFilaPorAgente?: number;
  /** Prazos da sonda de disco (testes): veja as opções do resolvedor. */
  sonda?: { tempoMaxMs?: number; emVoo?: number; lentaPorMs?: number; validadeDesconhecidaMs?: number };
  /** Relógio de verdade dos tetos de espera (padrão: performance.now). O disco não segue o relógio do mundo. */
  agoraReal?: () => number;
};

/** Alas da configuração, com o nome saneado (o nome também sai para o navegador). */
function alasDaConfig(config: Config): { alas: AlaConfig[]; recepcao: AlaConfig } {
  const nome = (n: string, id: string) => sanearTexto(n, LIMITES.sala) || id;
  return {
    alas: config.alas.map((a) => ({ id: a.id, nome: nome(a.nome, a.id), cor: a.cor })),
    recepcao: { id: config.recepcao.id, nome: nome(config.recepcao.nome, config.recepcao.id), cor: config.recepcao.cor },
  };
}

/** Configuração do motor a partir da configuração do servidor (mundo e privacidade). */
export function configMotorDaConfig(config: Config, parcial: Partial<ConfigMotor> = {}): ConfigMotor {
  return configMotorPadrao({
    fuso: config.mundo.fuso,
    pausaMs: Math.round(config.mundo.ocio.pausaMinutos * 60_000),
    dormeMs: Math.round(config.mundo.ocio.dormeMinutos * 60_000),
    mostrarTitulo: config.privacidade.mostrarTituloDaTarefa,
    mostrarAlvo: config.privacidade.mostrarNomeCurtoDoArquivo,
    ...parcial,
  });
}

/**
 * Estado inicial a partir do banco: último snapshot (ou layout gravado) e os eventos depois dele. As opções de
 * privacidade valem também para o que já estava gravado: com o título ou o nome do arquivo desligado, eles somem.
 */
export function reconstruirEstado(
  banco: Banco | undefined,
  cfg: ConfigMotor,
  config: Config,
  agora: number,
): { estado: EstadoMotor; reaplicados: number; limpou: boolean } {
  const { alas, recepcao } = alasDaConfig(config);
  const snap = banco?.ultimoSnapshot();
  let estado: EstadoMotor;
  let limpou = false;
  if (snap) {
    const limpo = limparPorPrivacidade(snap.estado, cfg);
    limpou = limpo !== snap.estado;
    estado = limpo;
  } else {
    // Sem snapshot (queda antes do primeiro), o histórico está inteiro: a retenção só apaga o que um snapshot
    // já cobre. O mundo começa no primeiro evento gravado, e não agora, para o replay repetir o tempo como foi.
    const primeiro = banco?.primeiroRecebidoEm();
    estado = criarEstadoInicial(primeiro !== undefined ? Math.min(primeiro, agora) : agora, cfg, recepcao);
    if (banco) estado = semearAlas(estado, banco.alas());
  }
  estado = aplicar(estado, { k: 'alas', agora: estado.mundo.agora, alas, recepcao }, cfg).estado;
  let reaplicados = 0;
  if (banco) {
    for (const { evento } of banco.eventosDepois(snap?.seq ?? 0)) {
      estado = aplicar(estado, { k: 'evento', evento }, cfg).estado;
      reaplicados++;
    }
  }
  return { estado, reaplicados, limpou };
}

/**
 * Alas gravadas voltam com a mesma ordem e o mesmo lote (alas nunca saem do andar). As salas não são semeadas:
 * elas renascem dos eventos, na mesma ordem e nos mesmos terrenos (semear antes embaralharia sala reclassificada).
 */
function semearAlas(estado: EstadoMotor, alas: Ala[]): EstadoMotor {
  if (alas.length === 0) return estado;
  const mundo = { ...estado.mundo, alas: {} as Record<string, Ala> };
  const interno = { ...estado.interno };
  const ordenadas = [...alas].sort((a, b) => a.ordem - b.ordem);
  if (!ordenadas.some((a) => a.tipo === 'recepcao')) Object.assign(mundo.alas, estado.mundo.alas);
  for (const a of ordenadas) {
    mundo.alas[a.id] = a;
    if (a.tipo === 'recepcao') interno.recepcaoId = a.id;
    interno.proximaOrdemAla = Math.max(interno.proximaOrdemAla, a.ordem + 1);
  }
  return { mundo, interno };
}

/** Espera a promessa, mas no máximo `ms` (relógio de verdade). */
function esperarAte(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((pronto) => {
    const t = setTimeout(pronto, Math.max(0, ms));
    t.unref?.();
    p.then(
      () => {
        clearTimeout(t);
        pronto();
      },
      () => {
        clearTimeout(t);
        pronto();
      },
    );
  });
}

type ItemFila = { ev: ArcadiaEvent; caminhos?: Caminhos; limite: number; ordem: number };

/** Leituras ou buscas seguidas na mesma outra sala de projeto que levam o agente para lá (gravação leva na hora). */
const LEITURAS_PARA_MUDAR = 3;

export function criarNucleo(op: OpcoesNucleo): Nucleo {
  const { config, relogio, log, banco } = op;
  const cfg = configMotorDaConfig(config, op.configMotor);
  const opcoesSaneamento = {
    permitirAlvo: config.privacidade.mostrarNomeCurtoDoArquivo,
    permitirTitulo: config.privacidade.mostrarTituloDaTarefa,
  };
  const sal = op.sal ?? banco?.sal() ?? 'sal-de-memoria';
  const agoraReal = op.agoraReal ?? (() => performance.now());
  const resolvedorOpcoes: Parameters<typeof criarResolvedor>[1] = { sal, amb: op.amb, agora: () => relogio.agora(), agoraReal };
  if (op.fs) resolvedorOpcoes.fs = op.fs;
  if (op.sonda?.tempoMaxMs !== undefined) resolvedorOpcoes.tempoMaxSondaMs = op.sonda.tempoMaxMs;
  if (op.sonda?.emVoo !== undefined) resolvedorOpcoes.sondasEmVoo = op.sonda.emVoo;
  if (op.sonda?.lentaPorMs !== undefined) resolvedorOpcoes.lentaPorMs = op.sonda.lentaPorMs;
  if (op.sonda?.validadeDesconhecidaMs !== undefined) resolvedorOpcoes.validadeDesconhecidaMs = op.sonda.validadeDesconhecidaMs;
  const f = config.fontes;
  const resolvedor = criarResolvedor(
    {
      alas: config.alas.map((a) => ({ id: a.id, regras: a.regras, tipo: a.tipo })),
      recepcaoId: config.recepcao.id,
      pastasAgregadoras: config.salas.pastasAgregadoras,
      excluir: config.salas.excluir,
      apelidos: config.salas.apelidos,
      pastasDosAgentes: [f.claudeTranscricoes.pasta, f.claudeSessoesVivas.pasta, f.codexRollouts.pasta],
      pastasDeApoio: config.salas.pastasDeApoio,
      rascunho: config.salas.rascunho,
    },
    resolvedorOpcoes,
  );
  const esperaMax = op.esperaMaxSalaMs ?? 3_000;
  const limiteFila = Math.max(1, Math.floor(op.limiteFilaPorAgente ?? 1_000));

  const iniciadoEm = relogio.agora();
  const transmissor = criarTransmissor({ relogio, buildId: op.buildId, instancia: op.instancia, seqInicial: iniciadoEm });
  const inicio = reconstruirEstado(banco, cfg, config, iniciadoEm);
  let estado = inicio.estado;
  if (inicio.reaplicados > 0) log.info('estado reconstruído do banco', { eventos: inicio.reaplicados });
  if (inicio.limpou) log.info('título ou nome de arquivo apagados do estado gravado (opção de privacidade desligada)');

  const contadores: Contadores = {
    recebidos: 0, aceitos: 0, recusados: 0, duplicados: 0, camposDescartados: 0, textosMascarados: 0, excluidos: 0,
    foraDaSala: 0, esperaramSala: 0, esperaEstourada: 0, salaDesconhecida: 0, arquivoForaDasRaizes: 0, arquivoEmRascunho: 0,
    arquivoEmApoio: 0, arquivoEmPastaComum: 0, arquivoEmSalaFixa: 0, leituraIsolada: 0, errosDeSala: 0, bloqueadosNaGravacao: 0,
  };
  const guardaGravacao: Contador = { mascarados: 0 };
  const recentes = new Set<string>();
  /** Filas por agente: um disco lento num projeto não segura os eventos dos outros agentes. */
  const filas = new Map<string, ItemFila[]>();
  const drenos = new Map<string, Promise<void>>();
  let ordemGlobal = 0;
  let parado = false;
  let ultimoSeq = banco?.ultimoSeq() ?? 0;
  const timers: Agendamento[] = [];
  /**
   * Sala do último cwd de cada agente (só a chave, hash com sal). O cwd decide de novo só quando ela muda; depois de
   * reiniciar, o primeiro cwd só é guardado (o agente fica na sala que o snapshot trouxe).
   */
  const salaDoCwd = new Map<string, string>();
  /** Leituras e buscas seguidas de cada agente numa mesma outra sala de projeto. */
  const leituras = new Map<string, { sala: string; n: number }>();

  // Marcas de pasta excluída, por hash com sal da chave do agente. Carregadas antes de qualquer evento (o catch-up
  // das fontes também passa por elas) e gravadas no banco, com a mesma retenção dos eventos.
  const marcas = new Map<string, TipoMarca>();
  /** Última vez que a data de cada marca foi renovada no banco (no máximo uma vez por hora). */
  const tocadas = new Map<string, number>();
  const chaveDaMarca = (k: string) => `m${hashCurto(`${sal}\u0000marca:${k}`, 20)}`;
  function carregarMarcas(): void {
    if (!banco) return;
    try {
      marcas.clear();
      for (const m of banco.marcasPrivadas()) marcas.set(m.chave, m.tipo);
      for (const h of [...tocadas.keys()]) if (!marcas.has(h)) tocadas.delete(h);
    } catch (e) {
      log.erro('falha ao ler as marcas de pasta excluída', { erro: descreverErro(e) });
    }
  }
  carregarMarcas();
  /** Salas que nasceram de pasta fora das raízes conhecidas (o doctor conta e sugere uma regra). */
  const salasFora = new Set<string>();
  try {
    for (const c of banco?.salasFora() ?? []) salasFora.add(c);
  } catch (e) {
    log.erro('falha ao ler as salas fora das raízes conhecidas', { erro: descreverErro(e) });
  }

  function gravarMarcaNoBanco(h: string, tipo: TipoMarca): void {
    if (!banco) return;
    try {
      banco.gravarMarca(h, tipo, relogio.agora());
      tocadas.set(h, relogio.agora());
    } catch (e) {
      log.erro('falha ao gravar a marca de pasta excluída', { erro: descreverErro(e) });
    }
  }

  function marcaDe(k: string): TipoMarca | undefined {
    return marcas.get(chaveDaMarca(k));
  }

  /** Marca um agente. A marca de vez nunca vira marca de turno. */
  function marcar(k: string, tipo: TipoMarca): void {
    const h = chaveDaMarca(k);
    const atual = marcas.get(h);
    if (atual === 'agente' || atual === tipo) return;
    marcas.set(h, tipo);
    gravarMarcaNoBanco(h, tipo);
  }

  /** Bot que começa turno novo: a marca do turno anterior cai (a marca de vez, de sessão, só sai pela retenção). */
  function desmarcarTurno(k: string): void {
    const h = chaveDaMarca(k);
    if (marcas.get(h) !== 'turno') return;
    marcas.delete(h);
    tocadas.delete(h);
    if (!banco) return;
    try {
      banco.apagarMarcaDeTurno(h);
    } catch (e) {
      log.erro('falha ao tirar a marca de turno', { erro: descreverErro(e) });
    }
  }

  /** Agente marcado em atividade: a retenção conta da última atividade dele (data renovada no máximo uma vez por hora). */
  function tocarMarca(k: string): void {
    const h = chaveDaMarca(k);
    const tipo = marcas.get(h);
    if (!tipo) return;
    const ultima = tocadas.get(h);
    if (ultima !== undefined && relogio.agora() - ultima < 3_600_000) return;
    gravarMarcaNoBanco(h, tipo);
  }

  /**
   * Evento de pasta excluída. Sessão e subagente ficam marcados de vez, e o subagente marca também a sessão-mãe.
   * Bot fica marcado só no turno, junto com o turno de quem delegou a tarefa a ele por drone.
   */
  function marcarPorExclusao(ev: ArcadiaEvent): void {
    const k = ev.agente.chave;
    if (ev.agente.tipo === 'bot') {
      marcar(k, 'turno');
      for (const d of Object.values(estado.mundo.delegacoes)) {
        if (d.para !== k || d.de === k) continue;
        const quem = Object.hasOwn(estado.mundo.agentes, d.de) ? estado.mundo.agentes[d.de] : undefined;
        marcar(d.de, quem && quem.tipo !== 'bot' ? 'agente' : 'turno');
      }
      return;
    }
    marcar(k, 'agente');
    const pai = ev.agente.paiChave;
    if (pai !== undefined && pai !== k) marcar(pai, 'agente');
  }

  function registrarSalaFora(chave: string): void {
    if (salasFora.has(chave)) return;
    salasFora.add(chave);
    if (!banco) return;
    try {
      banco.gravarSalaFora(chave, relogio.agora());
    } catch (e) {
      log.erro('falha ao gravar a sala fora das raízes conhecidas', { erro: descreverErro(e) });
    }
  }

  function persistir(r: Resultado): void {
    if (!banco) return;
    try {
      banco.transacao(() => {
        for (const m of r.mudancas) {
          if (m.k === 'sala') banco.gravarSala(m.sala, relogio.agora());
          else if (m.k === 'ala') banco.gravarAla(m.ala);
        }
        for (const d of r.diasFechados) banco.gravarMetricasDia(d.dia, d.metricas);
      });
    } catch (e) {
      log.erro('falha ao gravar o layout no banco', { erro: descreverErro(e) });
    }
  }

  /** Aplica uma entrada no motor. Se o redutor falhar (defeito), o estado fica como estava e o erro vai para o log. */
  function aplicarEntrada(entrada: Entrada): Mudanca[] {
    let r: Resultado;
    try {
      r = aplicar(estado, entrada, cfg);
    } catch (e) {
      log.erro('o motor do mundo falhou numa entrada; o estado ficou como estava', { entrada: entrada.k, erro: descreverErro(e) });
      return [];
    }
    estado = r.estado;
    persistir(r);
    transmissor.publicar(r.mudancas);
    return r.mudancas;
  }

  function gravarSnapshot(): void {
    if (!banco) return;
    try {
      const agora = relogio.agora();
      banco.gravarSnapshot(ultimoSeq, agora, estado);
      banco.gravarMetricasDia(estado.interno.dia, estado.mundo.metricas);
      banco.desbastarSnapshots(agora);
    } catch (e) {
      log.erro('falha ao gravar snapshot', { erro: descreverErro(e) });
    }
  }

  // Marca gravada só no estado do motor (banco de antes da tabela de marcas): vira marca da tabela já na partida.
  for (const [k, ia] of Object.entries(estado.interno.agentes)) {
    if (ia.privado !== true) continue;
    const a = Object.hasOwn(estado.mundo.agentes, k) ? estado.mundo.agentes[k] : undefined;
    if (a?.tipo !== 'bot') marcar(k, 'agente');
  }

  // Layout inicial (alas da configuração) gravado e enviado.
  if (banco) {
    banco.transacao(() => {
      for (const a of Object.values(estado.mundo.alas)) banco.gravarAla(a);
      for (const s of Object.values(estado.mundo.salas)) banco.gravarSala(s, iniciadoEm);
    });
  }
  aplicarEntrada({ k: 'tick', agora: iniciadoEm });
  // Reconstruiu a partir de eventos (ou limpou o que a privacidade não permite mais): snapshot já.
  if (inicio.reaplicados > 0 || inicio.limpou) gravarSnapshot();

  function lembrar(id: string): boolean {
    if (recentes.has(id)) return false;
    recentes.add(id);
    if (recentes.size > 20_000) {
      const primeiro = recentes.values().next().value;
      if (primeiro !== undefined) recentes.delete(primeiro);
    }
    return true;
  }

  /** Agente marcado: sem tarefa, título de delegação e nome de arquivo; fora o bot (nome vem do OMB), também sem nome. */
  function esconder(ev: ArcadiaEvent, marca: TipoMarca): void {
    if (marca === 'agente' || ev.agente.tipo !== 'bot') delete ev.agente.nome;
    if (ev.tarefa) {
      delete ev.tarefa.titulo;
      if (Object.keys(ev.tarefa).length === 0) delete ev.tarefa;
    }
    if (ev.delegacao) delete ev.delegacao.titulo;
    if (ev.ferramenta) delete ev.ferramenta.alvo;
    ev.local = { ...ev.local, excluida: true };
  }

  /** Sala em que o agente está, ou para onde ele já vai (a troca pode estar esperando a histerese de 20 s). */
  function salaAtual(k: string): string | undefined {
    const ia = Object.hasOwn(estado.interno.agentes, k) ? estado.interno.agentes[k] : undefined;
    const a = Object.hasOwn(estado.mundo.agentes, k) ? estado.mundo.agentes[k] : undefined;
    return ia?.salaPendente ?? a?.salaChave;
  }

  /** Mapa por agente com teto (o mais antigo sai): só chaves com hash e contagens, nada de caminho. */
  function guardarNoMapa<V>(m: Map<string, V>, k: string, v: V): void {
    m.delete(k);
    m.set(k, v);
    if (m.size > 20_000) {
      const primeiro = m.keys().next().value;
      if (primeiro !== undefined) m.delete(primeiro);
    }
  }

  /**
   * Caminhos que o disco precisa responder: a pasta do arquivo e a pasta percorrida (fora do rascunho, onde arquivo
   * não decide nada) e o cwd (sempre: é ele que diz se o cwd mudou de sala).
   */
  function alvosDaSala(c: Caminhos): string[] {
    const alvos: string[] = [];
    const daFerramenta = c.arquivo !== undefined ? pastaDoArquivo(c.arquivo) : c.pasta;
    if (daFerramenta !== undefined && !resolvedor.ehRascunho(daFerramenta)) alvos.push(daFerramenta);
    if (c.cwd !== undefined) alvos.push(c.cwd);
    return alvos;
  }

  /** O que falta o disco responder para decidir a sala destes caminhos (undefined: nada, dá para seguir já). */
  function esperaDe(c: Caminhos): Promise<void> | undefined {
    if ([c.arquivo, c.pasta, c.cwd].some((p) => p !== undefined && resolvedor.excluido(p))) return undefined;
    const promessas: Promise<void>[] = [];
    for (const p of alvosDaSala(c)) {
      const r = resolvedor.resolver(p);
      if (r.tipo === 'pendente') promessas.push(r.pronto);
    }
    return promessas.length > 0 ? Promise.all(promessas).then(() => undefined) : undefined;
  }

  /**
   * O arquivo (ou a pasta percorrida) muda a sala do agente? Só para sala de projeto (raiz git, filha de agregadora
   * que não seja pasta de apoio, ou apelido): gravação leva na hora; leitura e busca, depois de três eventos seguidos
   * com caminho na mesma outra sala (agente ainda sem sala, e sem cwd para decidir, vai na primeira). O resto não
   * muda a sala e é contado para o doctor, pelo motivo.
   */
  function decidirPorArquivo(k: string, atual: string | undefined, r: ResultadoSala | undefined, emRascunho: boolean, gravacao: boolean): SalaResolvida | undefined {
    if (emRascunho) {
      contadores.arquivoEmRascunho++;
      return undefined;
    }
    if (r === undefined || r.tipo === 'excluida' || r.tipo === 'pendente') return undefined;
    if (r.tipo === 'omb-privada') {
      contadores.foraDaSala++;
      return undefined;
    }
    if (r.tipo === 'desconhecida') {
      contadores.salaDesconhecida++;
      return undefined;
    }
    if (r.chave === atual) {
      // De volta à sala em que já está: a sequência de leituras em outra sala recomeça.
      leituras.delete(k);
      return undefined;
    }
    if (!ORIGENS_DE_PROJETO.has(r.origem)) {
      if (r.origem === 'fixa') contadores.arquivoEmSalaFixa++;
      else if (r.origem === 'apoio' || r.origem === 'agregadora') contadores.arquivoEmApoio++;
      else if (r.foraDasRaizes) contadores.arquivoForaDasRaizes++;
      else contadores.arquivoEmPastaComum++;
      return undefined;
    }
    if (gravacao || atual === undefined) {
      leituras.delete(k);
      return r;
    }
    const antes = leituras.get(k);
    const n = antes !== undefined && antes.sala === r.chave ? antes.n + 1 : 1;
    if (n >= LEITURAS_PARA_MUDAR) {
      leituras.delete(k);
      return r;
    }
    guardarNoMapa(leituras, k, { sala: r.chave, n });
    contadores.leituraIsolada++;
    return undefined;
  }

  /**
   * Decide a sala pelos caminhos (em memória) e completa o evento. Evento sem caminho deixa o agente onde está. O cwd
   * decide só quando o agente ainda não tem sala ou quando a sala do cwd muda; o arquivo, só sala de projeto (veja
   * `decidirPorArquivo`). Devolve se o evento mexe em pasta excluída (qualquer um dos caminhos): aí não há sala nem
   * nome de arquivo.
   */
  function localizar(ev: ArcadiaEvent, caminhos: Caminhos): boolean {
    const { arquivo, cwd, pasta } = caminhos;
    const k = ev.agente.chave;
    let excluido = [arquivo, pasta, cwd].some((p) => p !== undefined && resolvedor.excluido(p));
    const atual = salaAtual(k);
    // 1. Arquivo, ou pasta percorrida (Glob, Grep, LS): pasta de rascunho nem é resolvida.
    const daFerramenta = arquivo !== undefined ? pastaDoArquivo(arquivo) : pasta;
    let rFerramenta: ResultadoSala | undefined;
    let emRascunho = false;
    if (!excluido && daFerramenta !== undefined) {
      emRascunho = resolvedor.ehRascunho(daFerramenta);
      if (!emRascunho) {
        rFerramenta = resolvedor.resolver(daFerramenta);
        if (rFerramenta.tipo === 'excluida') excluido = true;
      }
    }
    if (!excluido && arquivo !== undefined) {
      const r = rFerramenta;
      // Arquivo das pastas dos agentes, dos dados do Arcadia ou da rede (salas fixas): nem o nome curto sai.
      const fixa = r !== undefined && r.tipo === 'sala' && r.raiz.startsWith('fixa:');
      if (fixa && ev.ferramenta) delete ev.ferramenta.alvo;
      else if (!excluido && ev.ferramenta && opcoesSaneamento.permitirAlvo && ev.ferramenta.alvo === undefined) {
        const curto = nomeCurtoDeArquivo(arquivo);
        if (curto !== undefined) ev.ferramenta.alvo = curto;
      }
    }
    // 2. cwd: a sala dele fica guardada (só a chave), para saber quando ela muda.
    let salaDoCwdAgora: SalaResolvida | undefined;
    let cwdMudou = false;
    if (!excluido && cwd !== undefined) {
      const r = resolvedor.resolver(cwd);
      if (r.tipo === 'excluida') excluido = true;
      else if (r.tipo === 'omb-privada') contadores.foraDaSala++;
      else if (r.tipo === 'desconhecida') contadores.salaDesconhecida++;
      else if (r.tipo === 'sala') {
        const anterior = salaDoCwd.get(k);
        cwdMudou = anterior !== undefined && anterior !== r.chave;
        guardarNoMapa(salaDoCwd, k, r.chave);
        salaDoCwdAgora = r;
      }
    }
    let destino: SalaResolvida | undefined;
    if (!excluido) {
      // 3. O cwd decide para agente sem sala e quando a sala do cwd muda; gravação em sala de projeto passa na frente.
      const cwdDecide = salaDoCwdAgora !== undefined && (atual === undefined || cwdMudou) ? salaDoCwdAgora : undefined;
      const porArquivo = daFerramenta !== undefined ? decidirPorArquivo(k, cwdDecide?.chave ?? atual, rFerramenta, emRascunho, ev.ferramenta?.categoria === 'editar') : undefined;
      destino = porArquivo ?? cwdDecide;
      if (destino !== undefined && destino === cwdDecide) {
        leituras.delete(k);
        // A sala do cwd fora das raízes conhecidas é a própria pasta: o doctor conta e sugere uma regra.
        if (destino.foraDasRaizes) registrarSalaFora(destino.chave);
      }
    }
    if (!excluido && destino !== undefined && ev.local.projetoChave === undefined) {
      ev.local = { ...ev.local, projetoChave: destino.chave, sala: { nome: destino.nome, ala: destino.ala, tipo: destino.tipoSala } };
    }
    if (excluido) {
      contadores.excluidos++;
      if (ev.ferramenta) delete ev.ferramenta.alvo;
      if (ev.local.projetoChave !== undefined || ev.local.sala !== undefined) {
        const resto = { ...ev.local };
        delete resto.projetoChave;
        delete resto.sala;
        ev.local = resto;
      }
    }
    return excluido;
  }

  /** Do evento já saneado ao mundo: sala, marca de privacidade, guarda, banco e motor. Síncrono. */
  function processar(ev: ArcadiaEvent, caminhos: Caminhos | undefined): { ok: true; seq?: number } | { ok: false; motivo: 'duplicado' } {
    let excluido = false;
    if (caminhos) {
      try {
        excluido = localizar(ev, caminhos);
      } catch (e) {
        contadores.errosDeSala++;
        log.erro('falha ao decidir a sala; o evento segue sem sala', { erro: descreverErro(e) });
      }
    }
    const k = ev.agente.chave;
    // Bot começando turno novo deixa a marca do turno anterior para trás (o nome do bot vem do OMB e fica).
    if (ev.agente.tipo === 'bot' && !excluido && iniciaTurno(ev)) desmarcarTurno(k);
    if (excluido) marcarPorExclusao(ev);
    const marca = marcaDe(k);
    if (marca) esconder(ev, marca);
    if (marca) tocarMarca(k);
    // Instante de aplicação gravado no próprio evento: o replay repete exatamente o que o servidor viu.
    ev.recebidoEm = Math.max(relogio.agora(), estado.mundo.agora);
    // A guarda vale também para o banco: o que é gravado é o mesmo que o motor aplica.
    const seguro = protegerSaida(ev, guardaGravacao);
    contadores.bloqueadosNaGravacao = guardaGravacao.mascarados;
    let seq: number | undefined;
    if (banco) {
      try {
        seq = banco.inserirEvento(seguro);
      } catch (e) {
        log.erro('falha ao gravar evento', { erro: descreverErro(e) });
      }
      if (seq === undefined) {
        contadores.duplicados++;
        return { ok: false, motivo: 'duplicado' };
      }
      ultimoSeq = seq;
    }
    contadores.aceitos++;
    aplicarEntrada({ k: 'evento', evento: seguro });
    return seq !== undefined ? { ok: true, seq } : { ok: true };
  }

  function processarSemFalhar(ev: ArcadiaEvent, caminhos: Caminhos | undefined): void {
    try {
      processar(ev, caminhos);
    } catch (e) {
      log.erro('falha ao processar um evento da fila', { erro: descreverErro(e) });
    }
  }

  /**
   * Esvazia a fila de um agente, na ordem: cada evento espera o disco responder (até quatro rodadas de sonda), mas
   * nunca além do teto; venceu, ele entra com a sala atual do agente. A volta começa sempre depois do evento atual.
   */
  function drenar(k: string): void {
    if (drenos.has(k)) return;
    let fim: () => void = () => {};
    drenos.set(k, new Promise<void>((pronto) => (fim = pronto)));
    void (async () => {
      try {
        await Promise.resolve();
        for (;;) {
          const fila = filas.get(k);
          const item = fila?.[0];
          if (!fila || !item || parado) break;
          for (let volta = 0; volta < 4; volta++) {
            let espera: Promise<void> | undefined;
            try {
              espera = item.caminhos ? esperaDe(item.caminhos) : undefined;
            } catch {
              espera = undefined;
            }
            if (!espera) break;
            const resta = item.limite - agoraReal();
            if (resta <= 0) {
              contadores.esperaEstourada++;
              break;
            }
            await esperarAte(espera, resta);
            if (parado || fila[0] !== item) break;
          }
          if (parado) break;
          if (fila[0] !== item) continue;
          fila.shift();
          processarSemFalhar(item.ev, item.caminhos);
        }
      } finally {
        drenos.delete(k);
        const fila = filas.get(k);
        if (fila && fila.length === 0) filas.delete(k);
        fim();
        if (fila && fila.length > 0 && !parado) drenar(k);
      }
    })();
  }

  return {
    transmissor,
    resolvedor,
    configMotor: cfg,
    iniciadoEm,
    buildId: op.buildId,
    instancia: op.instancia,
    estado: () => estado,
    mundo: () => estado.mundo,
    ingerir(entrada) {
      contadores.recebidos++;
      const s = sanearEvento(typeof entrada === 'object' && entrada !== null ? entrada.evento : undefined, opcoesSaneamento);
      if (!s.ok) {
        contadores.recusados++;
        log.aviso('evento recusado pelo esquema', { problemas: s.problemas.length });
        return { ok: false, motivo: 'esquema' };
      }
      contadores.camposDescartados += s.descartados;
      contadores.textosMascarados += s.mascarados;
      const ev = s.evento;
      const caminhos = limparCaminhos(entrada.caminhos);
      if (!lembrar(ev.id)) {
        contadores.duplicados++;
        return { ok: false, motivo: 'duplicado' };
      }
      // Depois de parar, nada mais espera o disco: entra já (sem sala, se faltava sondar).
      if (parado) return processar(ev, caminhos);
      const k = ev.agente.chave;
      let fila = filas.get(k);
      if (!fila || fila.length === 0) {
        let espera: Promise<void> | undefined;
        try {
          espera = caminhos ? esperaDe(caminhos) : undefined;
        } catch (e) {
          contadores.errosDeSala++;
          log.erro('falha ao preparar a sala', { erro: descreverErro(e) });
        }
        if (espera === undefined) return processar(ev, caminhos);
      }
      // Sala ainda sem resposta do disco (ou evento do mesmo agente na frente): espera a vez na fila dele.
      if (!fila) {
        fila = [];
        filas.set(k, fila);
      }
      // Fila cheia: o mais antigo entra já, com a sala atual do agente (a ordem do agente se mantém).
      while (fila.length >= limiteFila) {
        const velho = fila.shift();
        if (!velho) break;
        contadores.esperaEstourada++;
        processarSemFalhar(velho.ev, velho.caminhos);
      }
      fila.push(caminhos ? { ev, caminhos, limite: agoraReal() + esperaMax, ordem: ++ordemGlobal } : { ev, limite: agoraReal() + esperaMax, ordem: ++ordemGlobal });
      contadores.esperaramSala++;
      drenar(k);
      return { ok: true };
    },
    async ocioso() {
      while (drenos.size > 0) await Promise.all([...drenos.values()]);
    },
    informarSaude(fonte, saude) {
      aplicarEntrada({ k: 'saude', agora: Math.max(relogio.agora(), estado.mundo.agora), fonte, saude });
    },
    contadores: () => ({ ...contadores }),
    privacidade() {
      let deTurno = 0;
      for (const t of marcas.values()) if (t === 'turno') deTurno++;
      return { marcas: marcas.size, marcasDeTurno: deTurno, salasForaDasRaizes: salasFora.size };
    },
    gravarSnapshot,
    iniciar() {
      const tick = () => {
        const agora = relogio.agora();
        let vence: number;
        try {
          vence = proximoVencimento(estado, cfg);
        } catch (e) {
          log.erro('falha ao calcular o próximo timer', { erro: descreverErro(e) });
          return;
        }
        if (vence <= agora) aplicarEntrada({ k: 'tick', agora });
      };
      timers.push(relogio.repetir(op.tickMs ?? 250, tick));
      if (banco) {
        timers.push(relogio.repetir(op.snapshotACadaMs ?? 10 * 60_000, gravarSnapshot));
        const reter = () => {
          try {
            const r = banco.aplicarRetencao(relogio.agora(), config.servidor.retencaoDias);
            if (r.eventos || r.snapshots || r.marcas) log.info('retenção aplicada', { eventos: r.eventos, snapshots: r.snapshots, marcas: r.marcas });
            if (r.marcas) carregarMarcas();
          } catch (e) {
            log.erro('falha na retenção', { erro: descreverErro(e) });
          }
        };
        reter();
        timers.push(relogio.repetir(op.retencaoACadaMs ?? 6 * 3600_000, reter));
      }
    },
    parar() {
      parado = true;
      // O que ainda esperava o disco entra agora, sem sala (o disco não responde mais a tempo), na ordem de chegada.
      const todos = [...filas.values()].flat().sort((a, b) => a.ordem - b.ordem);
      filas.clear();
      for (const item of todos) processarSemFalhar(item.ev, item.caminhos);
      for (const t of timers) t.cancelar();
      timers.length = 0;
      transmissor.descarregar();
      gravarSnapshot();
      transmissor.parar();
    },
  };
}
