// Monta o servidor inteiro, nesta ordem: os dois listeners (portas antes de tudo), a trava da pasta de dados, o banco,
// o núcleo, o simulador (opcional) e as fontes.
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { VERSAO_ESQUEMA } from '@arcadia/shared';
import { RAIZ_REPO, arquivoDoPacoteLocal, ehHostLocal, pastaDeDados, type ConfigCarregada } from './config/carregar.ts';
import { abrirBanco } from './db/banco.ts';
import { adquirirTrava, descreverDono } from './db/trava.ts';
import { criarNucleo, type Nucleo } from './nucleo.ts';
import { iniciarSimulacao, DESCRICAO_CENARIO, type Cenario, type Simulacao } from './adaptadores/sim/simulador.ts';
import { criarAppVisualizacao } from './http/visualizacao.ts';
import { criarAppIngestao } from './http/ingestao.ts';
import { ouvir, type Atendimento, type Ouvinte } from './http/servir.ts';
import {
  coletarFontes, descreverConfig, descreverDados, infoDoBanco, resumoDoMundo, versaoNode, type Diagnostico,
} from './doctor/diagnostico.ts';
import { type AmbienteCaminhos } from './util/caminhos.ts';
import { hashCurto, idAleatorio } from './util/hash.ts';
import { criarLog, descreverErro, type Log } from './util/log.ts';
import { relogioReal, type Agendamento, type Relogio } from './util/relogio.ts';
import { criarAdaptadores, type Adaptadores } from './adaptadores/registro.ts';
import type { Adaptador, DiagnosticoAdaptador } from './adaptadores/comum.ts';

export type OpcoesServidor = {
  carregada: ConfigCarregada;
  amb: AmbienteCaminhos;
  relogio?: Relogio;
  log?: Log;
  /** Só para testes: pasta de dados fora da configuração. */
  dirDados?: string;
  simulador?: { cenario: Cenario; semente: number; velocidade?: number; repetir?: boolean };
  /** Só para testes: portas (0 = qualquer livre). */
  portas?: { ingestao?: number; visualizacao?: number };
  semSondarOmb?: boolean;
  buildId?: string;
  tickMs?: number;
  /**
   * Liga os adaptadores reais (OpenMausBot, transcrições, sessões vivas, rollouts) conforme a configuração.
   * Padrão: desligado (testes); o main.ts liga fora do modo simulador.
   */
  fontesReais?: boolean;
  /** Observador de arquivos dos adaptadores (padrão: ligado). */
  observar?: boolean;
  /**
   * Só para testes: adaptadores a mais (falsos), ligados e desligados com o servidor. O diagnóstico deles entra na
   * saúde e no doctor como o de um adaptador real (com o mesmo id, ele toma o lugar da conferência estática).
   */
  adaptadoresExtras?: Adaptador[];
  /** Guarda do processo de onde a saúde e o doctor leem as exceções (padrão: a instalada pelo main.ts). */
  guarda?: GuardaDoProcesso;
  /** Pasta do build do mundo (padrão: apps/world/dist do repositório). */
  dirMundo?: string;
};

export type Servidor = {
  nucleo: Nucleo;
  adaptadores?: Adaptadores;
  arquivoBanco: string;
  ingestao: Ouvinte;
  visualizacao: Ouvinte;
  diagnosticar(): Promise<Diagnostico>;
  parar(): Promise<void>;
};

/** Janela da contagem de exceções que a saúde mostra (com alguma exceção nela, `ok` fica falso). */
const JANELA_EXCECOES_MS = 10 * 60_000;
/** A mesma assinatura de erro vai para o log no máximo uma vez nesta janela, com a contagem das repetidas. */
const JANELA_LOG_MS = 60_000;

export type GuardaDoProcesso = {
  /** Uma exceção ou promessa recusada escapou de um adaptador: conta e registra (o servidor segue no ar). */
  registrar(tipo: 'exceção' | 'promessa', erro: unknown): void;
  /** Exceções nos últimos 10 minutos e desde a partida. */
  contagem(): { recentes: number; total: number };
};

/** Relógio de verdade com temporizador que não segura o processo aberto. */
const relogioDaGuarda: Relogio = {
  agora: () => Date.now(),
  agendar(ms, fn) {
    const t = setTimeout(fn, Math.max(0, ms));
    t.unref?.();
    return { cancelar: () => clearTimeout(t) };
  },
  repetir(ms, fn) {
    const t = setInterval(fn, Math.max(1, ms));
    t.unref?.();
    return { cancelar: () => clearInterval(t) };
  },
};

/**
 * Rede de segurança do processo: exceção ou promessa recusada que escapou de um adaptador (formato novo, defeito)
 * é contada e vai para o log só com o código. A mesma assinatura (tipo e código) aparece no log no máximo uma vez
 * por minuto: a primeira na hora; as repetidas, somadas numa linha só no fim do minuto. O processo não sai numa
 * rajada (ainda não há supervisor que o suba de novo): a saúde responde `ok: false` enquanto houver exceção nos
 * últimos 10 minutos, e o doctor mostra a contagem.
 */
export function criarGuardaDoProcesso(log: Log, relogio: Relogio = relogioDaGuarda): GuardaDoProcesso {
  let total = 0;
  /** Contagem por minuto (relógio do servidor), só dos últimos 10 minutos. */
  const porMinuto = new Map<number, number>();
  const assinaturas = new Map<string, { repetidas: number; janela?: Agendamento }>();

  function podar(): number {
    const atual = Math.floor(relogio.agora() / 60_000);
    let n = 0;
    for (const [m, c] of porMinuto) {
      if (atual - m >= JANELA_EXCECOES_MS / 60_000) porMinuto.delete(m);
      else n += c;
    }
    return n;
  }

  function abrirJanela(chave: string, s: { repetidas: number; janela?: Agendamento }, tipo: string, codigo: string): void {
    s.janela = relogio.agendar(JANELA_LOG_MS, () => {
      if (s.repetidas === 0) {
        // Minuto sem repetição: a próxima ocorrência vai para o log na hora.
        assinaturas.delete(chave);
        return;
      }
      log.erro(`a mesma exceção não tratada (${tipo}) se repetiu no último minuto; o servidor segue no ar`, { erro: codigo, vezes: s.repetidas });
      s.repetidas = 0;
      abrirJanela(chave, s, tipo, codigo);
    });
  }

  return {
    registrar(tipo, erro) {
      total++;
      const minuto = Math.floor(relogio.agora() / 60_000);
      porMinuto.set(minuto, (porMinuto.get(minuto) ?? 0) + 1);
      if (porMinuto.size > 20) podar();
      const codigo = descreverErro(erro);
      const chave = `${tipo}|${codigo}`;
      const s = assinaturas.get(chave);
      if (s) {
        s.repetidas++;
        return;
      }
      log.erro(`exceção não tratada (${tipo}); o servidor segue no ar`, { erro: codigo });
      const nova = { repetidas: 0 };
      assinaturas.set(chave, nova);
      abrirJanela(chave, nova, tipo, codigo);
    },
    contagem: () => ({ recentes: podar(), total }),
  };
}

let guardaInstalada: GuardaDoProcesso | undefined;
const semGuarda: GuardaDoProcesso = { registrar: () => {}, contagem: () => ({ recentes: 0, total: 0 }) };

/** Liga a guarda do processo (main.ts). A saúde e o doctor de todo servidor deste processo leem dela. */
export function instalarGuardaDoProcesso(log: Log, relogio?: Relogio): GuardaDoProcesso {
  const guarda = criarGuardaDoProcesso(log, relogio);
  guardaInstalada = guarda;
  process.on('uncaughtException', (e) => guarda.registrar('exceção', e));
  process.on('unhandledRejection', (e) => guarda.registrar('promessa', e));
  return guarda;
}

/** Build do cliente: muda quando o mundo é reconstruído (o celular recarrega sozinho). */
export function calcularBuildId(): string {
  try {
    return `w${hashCurto(fs.readFileSync(path.join(RAIZ_REPO, 'apps', 'world', 'dist', 'index.html'), 'utf8'), 10)}`;
  } catch {
    return `dev-${VERSAO_ESQUEMA}`;
  }
}

/**
 * Atende com 503 enquanto o servidor sobe e, pronto, repassa ao app de verdade. É o que deixa as portas abrirem antes
 * do banco: com uma porta ocupada, a partida falha sem tocar em dado nenhum.
 */
function despachoAteFicarPronto(): { atender: Atendimento; ligar(app: Hono): void } {
  let alvo: Hono | undefined;
  return {
    atender: (req, env) =>
      alvo
        ? alvo.fetch(req, env)
        : new Response('O Arcadia está subindo. Tente de novo em instantes.', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '1', 'x-content-type-options': 'nosniff' },
          }),
    ligar: (app) => {
      alvo = app;
    },
  };
}

export async function iniciarServidor(op: OpcoesServidor): Promise<Servidor> {
  const config = op.carregada.config;
  const relogio = op.relogio ?? relogioReal();
  const log = op.log ?? criarLog({ fuso: config.mundo.fuso, agora: () => relogio.agora() });
  const guarda = () => op.guarda ?? guardaInstalada ?? semGuarda;
  for (const aviso of op.carregada.avisos) log.aviso(aviso);

  // Partida que falha no meio desfaz o que já subiu, na ordem inversa (portas, trava, banco, núcleo, simulador).
  const desfazer: (() => void | Promise<void>)[] = [];
  try {
    // 1. Portas antes de tudo: uma delas ocupada derruba a partida sem tocar em dado nenhum (nem na pasta de dados).
    const hostVis = ehHostLocal(config.servidor.visualizacao.host) ? config.servidor.visualizacao.host : '127.0.0.1';
    const despIngestao = despachoAteFicarPronto();
    const despVisualizacao = despachoAteFicarPronto();
    const ouvIngestao = await ouvir(despIngestao.atender, config.servidor.ingestao.host, op.portas?.ingestao ?? config.servidor.ingestao.porta, 'ingestão');
    desfazer.push(() => ouvIngestao.fechar());
    const ouvVisualizacao = await ouvir(despVisualizacao.atender, hostVis, op.portas?.visualizacao ?? config.servidor.visualizacao.porta, 'visualização');
    desfazer.push(() => ouvVisualizacao.fechar());

    // 2. Trava de instância única na pasta de dados, antes do banco: dois servidores nunca abrem o mesmo banco.
    const dirDados = op.dirDados ?? pastaDeDados(config, op.amb, Boolean(op.simulador));
    if (op.simulador && !op.dirDados && dirDados !== pastaDeDados(config, op.amb, false)) {
      log.info('simulador: os dados vão para uma pasta temporária própria, longe dos dados reais');
    }
    fs.mkdirSync(dirDados, { recursive: true });
    const trava = adquirirTrava(dirDados, {
      descricao: descreverDados(dirDados, op.amb),
      fuso: config.mundo.fuso,
      portas: { ingestao: ouvIngestao.porta, visualizacao: ouvVisualizacao.porta },
    });
    desfazer.push(() => trava.liberar());
    if (trava.retomada) {
      log.aviso(`a pasta de dados tinha a trava de um servidor que não está mais rodando (${descreverDono(trava.retomada, config.mundo.fuso)}); a trava foi retomada`);
    }

    // 3. Banco, núcleo e simulador.
    const arquivoBanco = path.join(dirDados, op.simulador ? 'arcadia-sim.sqlite' : 'arcadia.sqlite');
    const banco = abrirBanco(arquivoBanco);
    desfazer.push(() => banco.fechar());

    const nucleo = criarNucleo({
      config,
      relogio,
      log,
      amb: op.amb,
      banco,
      buildId: op.buildId ?? calcularBuildId(),
      instancia: idAleatorio(10),
      ...(op.tickMs !== undefined ? { tickMs: op.tickMs } : {}),
    });
    nucleo.iniciar();
    desfazer.push(() => nucleo.parar());

    let simulacao: Simulacao | undefined;
    let descricaoSim: string | undefined;
    if (op.simulador) {
      const s = op.simulador;
      descricaoSim = `cenário ${s.cenario} (${DESCRICAO_CENARIO[s.cenario]}), semente ${s.semente}, velocidade ${s.velocidade ?? 1}`;
      if (s.cenario === 'estados' && (s.velocidade ?? 1) !== 1) {
        log.aviso('o cenário estados foi feito para a velocidade 1: os timers do motor (chegada, texto, talvez, pausa e sono) não aceleram, e o roteiro sai da ordem');
      }
      nucleo.informarSaude('sim', { estado: 'simulada', mensagem: `cenário ${s.cenario}, semente ${s.semente}` });
      const sim = iniciarSimulacao({
        cenario: s.cenario,
        semente: s.semente,
        relogio,
        emitir: (ev) => nucleo.ingerir({ evento: ev }),
        alas: config.alas.map((a) => a.id),
        repetir: s.repetir ?? true,
        ...(s.velocidade !== undefined ? { velocidade: s.velocidade } : {}),
      });
      simulacao = sim;
      desfazer.push(() => sim.parar());
    }

    // 4. Os apps de verdade entram nas portas que já estavam abertas.
    const pacoteLocal = arquivoDoPacoteLocal(config, op.amb);
    const vis = criarAppVisualizacao({
      nucleo,
      relogio,
      dirMundo: op.dirMundo ?? path.join(RAIZ_REPO, 'apps', 'world', 'dist'),
      ...(pacoteLocal !== undefined ? { pacoteLocal } : {}),
    });
    let adaptadores: Adaptadores | undefined;
    const extras = op.adaptadoresExtras ?? [];

    function diagnosticosDosAdaptadores(): Record<string, DiagnosticoAdaptador & { nome: string }> | undefined {
      if (!adaptadores && extras.length === 0) return undefined;
      const r: Record<string, DiagnosticoAdaptador & { nome: string }> = { ...(adaptadores?.diagnosticos() ?? {}) };
      for (const a of extras) {
        try {
          r[a.id] = { ...a.diagnostico(), nome: a.nome };
        } catch {
          r[a.id] = { nome: a.nome, estado: 'erro', resumo: 'falhou ao se descrever', linhas: [], contadores: {}, desconhecidos: {} };
        }
      }
      return r;
    }

    async function diagnosticar(): Promise<Diagnostico> {
      const agora = relogio.agora();
      const vivos = diagnosticosDosAdaptadores();
      const d: Diagnostico = {
        geradoEm: agora,
        fuso: config.mundo.fuso,
        servidor: { rodando: true, versaoEsquema: VERSAO_ESQUEMA, node: versaoNode(), buildId: nucleo.buildId, instancia: nucleo.instancia, iniciadoEm: nucleo.iniciadoEm },
        configuracao: descreverConfig(op.carregada),
        dados: { pasta: descreverDados(dirDados, op.amb), existe: true },
        portas: [
          { nome: 'Ingestão, saúde e doctor', host: config.servidor.ingestao.host, porta: ouvIngestao.porta, estado: 'deste-servidor' },
          {
            nome: 'Visualização (mundo, snapshot, SSE e depuração)',
            host: hostVis,
            porta: ouvVisualizacao.porta,
            estado: 'deste-servidor',
            ...(hostVis !== config.servidor.visualizacao.host ? { observacao: `a configuração pede ${config.servidor.visualizacao.host}, mas sem pareamento (Fase 4) fica só no PC` } : {}),
          },
        ],
        fontes: await coletarFontes(config, op.amb, {
          agora,
          saude: nucleo.mundo().saude,
          ...(vivos ? { adaptadores: vivos } : {}),
          ...(descricaoSim !== undefined ? { simulador: descricaoSim } : {}),
          ...(op.semSondarOmb ? { semOmb: true } : {}),
        }),
        mundo: resumoDoMundo(nucleo.mundo(), nucleo.transmissor.conexoes(), nucleo.transmissor.seqAtual()),
        saneamento: (() => {
          const c = nucleo.contadores();
          return { ...c, bloqueadosNaGravacao: c.bloqueadosNaGravacao + banco.bloqueados(), bloqueadosNaSaida: vis.bloqueados() };
        })(),
        privacidade: { ...nucleo.privacidade(), sondas: nucleo.resolvedor.sondasAgora() },
      };
      if (descricaoSim !== undefined) d.servidor.simulador = descricaoSim;
      const ex = guarda().contagem();
      if (ex.total > 0) {
        d.servidor.excecoes = ex.total;
        d.servidor.excecoesRecentes = ex.recentes;
      }
      const b = infoDoBanco(arquivoBanco);
      if (b) d.dados.banco = b;
      return d;
    }

    const ing = criarAppIngestao({
      amb: op.amb,
      diagnosticar,
      saude: () => {
        const ex = guarda().contagem();
        return {
          // Exceção não tratada nos últimos 10 minutos: o servidor segue no ar, mas a saúde avisa.
          ok: ex.recentes === 0,
          servidor: 'arcadia',
          versaoEsquema: VERSAO_ESQUEMA,
          buildId: nucleo.buildId,
          instancia: nucleo.instancia,
          iniciadoEm: nucleo.iniciadoEm,
          agora: relogio.agora(),
          excecoes: { ultimos10min: ex.recentes, total: ex.total },
          fontes: nucleo.mundo().saude.fontes,
        };
      },
    });
    despIngestao.ligar(ing);
    despVisualizacao.ligar(vis.app);

    // 5. Fontes reais: só fora do simulador (os dados simulados nunca se misturam com os reais).
    let saudeTimer: Agendamento | undefined;
    if (op.fontesReais && !op.simulador) {
      const lista = criarAdaptadores({
        config,
        amb: op.amb,
        relogio,
        log,
        emitir: (e) => {
          nucleo.ingerir(e);
        },
        ...(op.observar !== undefined ? { observar: op.observar } : {}),
      });
      adaptadores = lista;
      desfazer.push(() => lista.parar());
      await lista.iniciar();
    }
    for (const a of extras) {
      try {
        await a.iniciar();
      } catch (e) {
        log.erro('um adaptador falhou na partida', { fonte: a.id, erro: descreverErro(e) });
      }
    }
    if (adaptadores || extras.length > 0) {
      const informar = () => {
        for (const [id, d] of Object.entries(diagnosticosDosAdaptadores() ?? {})) {
          const ignoradas = (d.contadores['invalidas'] ?? 0) + Object.values(d.desconhecidos).reduce((a, b) => a + b, 0);
          nucleo.informarSaude(id, { estado: d.estado, mensagem: d.resumo, ignoradas, ...(d.versao ? { versao: d.versao } : {}) });
        }
      };
      informar();
      saudeTimer = relogio.repetir(1_000, informar);
    }

    return {
      nucleo,
      ...(adaptadores ? { adaptadores } : {}),
      arquivoBanco,
      ingestao: ouvIngestao,
      visualizacao: ouvVisualizacao,
      diagnosticar,
      async parar() {
        simulacao?.parar();
        saudeTimer?.cancelar();
        await adaptadores?.parar();
        for (const a of extras) {
          try {
            await a.parar();
          } catch {
            // segue desligando
          }
        }
        // Eventos que ainda esperam o disco (sala) têm até 2 s para entrar; o resto entra sem sala no parar do núcleo.
        await Promise.race([nucleo.ocioso(), new Promise<void>((r) => setTimeout(r, 2_000).unref())]);
        nucleo.parar();
        await ouvVisualizacao.fechar();
        await ouvIngestao.fechar();
        banco.fechar();
        // A trava sai por último: até aqui, a pasta ainda é deste servidor.
        trava.liberar();
      },
    };
  } catch (e) {
    for (const passo of desfazer.reverse()) {
      try {
        await passo();
      } catch {
        // segue desfazendo
      }
    }
    throw e;
  }
}
