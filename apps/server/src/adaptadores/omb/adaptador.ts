// Adaptador do OpenMausBot: descoberta (porta e environment-id), snapshot (/api/bots?messages=0), SSE com
// Last-Event-ID (resumed:false refaz o snapshot) e árvore de delegação (/api/threads/{id}/job, debounce de 300 ms).
// Só GET, só a lista fixa de rotas do cliente. Do bot saem nome, cargo, cor, corpo (sem mascotBody vale cursor),
// equipe e estado; alma, descrição, mensagens, perguntas, respostas e resultados nunca são lidos para fora.
import type { AgenteRef, ArcadiaEvent, CategoriaFerramenta, EstadoPresenca, Motor } from '@arcadia/shared';
import { idDeEvento } from '../../util/hash.ts';
import { descreverErro, type Log } from '../../util/log.ts';
import type { Agendamento, Relogio } from '../../util/relogio.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import {
  absoluto, categoriaDaFerramenta, descreverDesconhecidos, ehObjeto, ehPastaPrivadaOmb, fmt, instante, nomeDeTipo, numero,
  somar, texto, textoDoMapa, type Adaptador, type DiagnosticoAdaptador, type Emissor,
} from '../comum.ts';
import type { Fusao } from '../fusao.ts';
import { descobrirOmb, lerJson, VERSAO_CONFERIDA_OMB, type Descoberta } from './cliente.ts';
import { abrirSseOmb, type ConexaoSse, type QuadroSse } from './sse.ts';

const REGEX_ID_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/;
const REGEX_THREAD = /^[A-Za-z0-9_-]{1,80}$/;

/** Quadros conhecidos que o mundo não usa (não contam como formato novo). */
const QUADROS_SEM_USO = new Set([
  'group', 'group.deleted', 'sections', 'message', 'message.patch', 'thread', 'notify', 'routine', 'routine.run',
  'routine.deleted', 'computer', 'computer-control', 'config', 'data', 'webhook', 'webhook.deleted', 'webhook.request',
  'app-trigger', 'app-trigger.deleted', 'live.call', 'screen',
]);
/** RuntimeEvent conhecidos que o mundo não usa. */
const RUNTIME_SEM_USO = new Set(['turn.retrying', 'item.updated', 'content.delta', 'thread.token-usage.updated', 'session.exited']);

type Tarefa = { cwd?: string; pinnedCwd?: string; activity?: string; deTrabalho: boolean; esperandoColegas: boolean; aberta: boolean };

type Bot = {
  id: string;
  nome?: string;
  cargo?: string;
  cor?: string;
  corpo: string;
  equipe?: string;
  motor: Motor;
  cwd?: string;
  threadPrincipal?: string;
  activity?: string;
  esperandoColegas: boolean;
  tarefas: Map<string, Tarefa>;
  assinatura?: string;
  naFila: boolean;
};

export type OpcoesOmb = {
  portas: number[];
  /** Pasta do usuário (para conferir o environment-id). */
  casa: string;
  qgPorEquipe: Record<string, string>;
  relogio: Relogio;
  emitir: Emissor;
  fusao: Fusao;
  log?: Log;
  intervaloDescobertaMs?: number;
  debounceJobMs?: number;
};

export type AdaptadorOmb = Adaptador & {
  /** Resolve quando a primeira tentativa de descoberta (e, se achou, o snapshot) terminou. */
  pronto(): Promise<void>;
  conectado(): boolean;
};

function motorDe(v: unknown): Motor {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s.includes('codex')) return 'codex';
  if (s.includes('claude')) return 'claude';
  return 'outro';
}

function presencaDe(activity: string | undefined): EstadoPresenca {
  switch (activity) {
    case 'working':
      return 'ativo';
    case 'waiting-on-you':
      return 'esperando';
    case 'no-signal':
    case 'dead':
      return 'sem-sinal';
    case 'parked.computer':
      return 'na-fila';
    default:
      return 'ocioso';
  }
}

export function criarAdaptadorOmb(op: OpcoesOmb): AdaptadorOmb {
  const bots = new Map<string, Bot>();
  const threadParaBot = new Map<string, string>();
  const pendentes = new Map<string, { nome: string; categoria: CategoriaFerramenta }>();
  const jobs = new Map<string, string>();
  const timersJob = new Map<string, Agendamento>();
  const cont: Record<string, number> = {};
  const quadros: Record<string, number> = {};
  const desconhecidos: Record<string, number> = {};
  // Mapa de verdade (e não objeto): equipe chamada constructor, toString ou __proto__ não acha função herdada.
  const qg = new Map<string, string>();
  for (const [equipe, pasta] of Object.entries(op.qgPorEquipe)) if (typeof pasta === 'string' && pasta.length > 0) qg.set(equipe, pasta);
  let descoberta: Descoberta | undefined;
  /** Algo respondeu na rota pública, mas o environment-id não conferiu: não conectei (o doctor diz). */
  let recusado: Descoberta | undefined;
  let seqPresenca = 0;
  let tentativasDescoberta: string | undefined;
  let conexao: ConexaoSse | undefined;
  let conectado = false;
  let ultimoId: string | undefined;
  let ultimoEvento: number | undefined;
  let ultimoQuadro: number | undefined;
  let parado = false;
  let falhasSeguidas = 0;
  let timerDescoberta: Agendamento | undefined;
  let timerReconexao: Agendamento | undefined;
  let snapshotPedido: Agendamento | undefined;
  let buscandoSnapshot = false;
  let resolverPronto: () => void = () => {};
  const prontoPromessa = new Promise<void>((r) => (resolverPronto = r));

  function agenteDe(b: Bot): AgenteRef {
    const a: AgenteRef = { chave: `omb:${b.id}`, tipo: 'bot', corpo: b.corpo };
    if (b.nome) a.nome = b.nome;
    if (b.cargo) a.cargo = b.cargo;
    if (b.cor) a.cor = b.cor;
    return a;
  }

  function salaDoBot(b: Bot, threadId?: string): string | undefined {
    const t = threadId ? b.tarefas.get(threadId) : undefined;
    for (const c of [t?.cwd, t?.pinnedCwd, b.cwd]) if (c && !ehPastaPrivadaOmb(c)) return c;
    return textoDoMapa(qg, b.equipe);
  }

  function tarefaAtiva(b: Bot): string | undefined {
    for (const [id, t] of b.tarefas) if (t.aberta && t.activity && t.activity !== 'idle') return id;
    return b.threadPrincipal;
  }

  function emitir(b: Bot, tipo: ArcadiaEvent['tipo'], ts: number, partes: (string | number)[], extra: Partial<ArcadiaEvent> = {}, opcoes: { motor?: Motor; sala?: string; arquivo?: string } = {}): void {
    const ev: ArcadiaEvent = {
      v: 1,
      id: idDeEvento('omb', ...partes),
      ts,
      recebidoEm: ts,
      origem: 'omb',
      motor: opcoes.motor ?? b.motor,
      agente: agenteDe(b),
      local: b.equipe ? { equipe: b.equipe } : {},
      tipo,
      ...extra,
    };
    let caminhos: EntradaBruta['caminhos'] | undefined;
    if (opcoes.arquivo) caminhos = { arquivo: opcoes.arquivo };
    else if (opcoes.sala) caminhos = { cwd: opcoes.sala };
    ultimoEvento = Math.max(ultimoEvento ?? 0, ts);
    somar(cont, 'eventos');
    op.emitir(caminhos ? { evento: ev, caminhos } : { evento: ev });
  }

  /** Conversa para bot, com teto (o mapa é refeito a cada snapshot). */
  function ligarThread(threadId: string, botId: string): void {
    threadParaBot.delete(threadId);
    threadParaBot.set(threadId, botId);
    if (threadParaBot.size > 5_000) {
      const primeiro = threadParaBot.keys().next().value;
      if (primeiro !== undefined) threadParaBot.delete(primeiro);
    }
  }

  function lerBot(wb: unknown): Bot | undefined {
    if (!ehObjeto(wb)) return undefined;
    const id = texto(wb['id']);
    if (!id || !REGEX_ID_SEGURO.test(id)) return undefined;
    const antigo = bots.get(id);
    const ms = ehObjeto(wb['modelSelection']) ? wb['modelSelection'] : {};
    const b: Bot = {
      id,
      corpo: texto(wb['mascotBody']) ?? 'cursor',
      motor: motorDe(ms['instanceId']),
      esperandoColegas: wb['waitingForTeammates'] === true,
      tarefas: new Map(),
      naFila: antigo?.naFila ?? false,
    };
    if (antigo?.assinatura !== undefined) b.assinatura = antigo.assinatura;
    const nome = texto(wb['name']);
    if (nome) b.nome = nome;
    const cargo = texto(wb['title']);
    if (cargo) b.cargo = cargo;
    const cor = texto(wb['color']);
    if (cor) b.cor = cor;
    const equipe = texto(wb['section']);
    if (equipe) b.equipe = equipe;
    const cwd = texto(wb['cwd']);
    if (cwd) b.cwd = cwd;
    const activity = texto(wb['activity']);
    if (activity) b.activity = activity;
    const principal = texto(wb['threadId']) ?? texto(wb['mainThreadId']);
    if (principal) b.threadPrincipal = principal;
    for (const campo of ['threadId', 'mainThreadId']) {
      const t = texto(wb[campo]);
      if (t) ligarThread(t, id);
    }
    if (Array.isArray(wb['tasks'])) {
      for (const t of wb['tasks']) {
        if (!ehObjeto(t)) continue;
        const threadId = texto(t['threadId']);
        if (!threadId) continue;
        ligarThread(threadId, id);
        const opened = ehObjeto(t['openedBy']) ? t['openedBy'] : undefined;
        const tarefa: Tarefa = {
          deTrabalho: opened?.['kind'] === 'work',
          esperandoColegas: t['waitingForTeammates'] === true,
          aberta: t['archivedAt'] === undefined && t['closedBy'] === undefined,
        };
        const tc = texto(t['cwd']);
        if (tc) tarefa.cwd = tc;
        const tp = texto(t['pinnedCwd']);
        if (tp) tarefa.pinnedCwd = tp;
        const ta = texto(t['activity']);
        if (ta) tarefa.activity = ta;
        b.tarefas.set(threadId, tarefa);
      }
    }
    bots.set(id, b);
    return b;
  }

  /** Bot novo ou mudado: presença, metadados e sala. Repetição igual não gera evento. */
  function sincronizarBot(b: Bot, agora: number, forcar: boolean): void {
    const thread = tarefaAtiva(b);
    const sala = salaDoBot(b, thread);
    const presenca = b.naFila ? 'na-fila' : presencaDe(b.activity);
    const assinatura = JSON.stringify([presenca, b.nome, b.cargo, b.cor, b.corpo, b.equipe, sala]);
    if (!forcar && assinatura === b.assinatura) return;
    b.assinatura = assinatura;
    // O id não leva a assinatura (que tem a pasta): um hash sem sal da pasta deixaria conferir um palpite dela.
    seqPresenca++;
    emitir(b, 'presenca', agora, ['presenca', b.id, agora, seqPresenca], { presenca: { estado: presenca } }, sala ? { sala } : {});
    // Tarefa aberta por outro bot ou bot esperando colegas: há delegação em andamento.
    for (const [threadId, t] of b.tarefas) if (t.aberta && (t.deTrabalho || t.esperandoColegas) && t.activity && t.activity !== 'idle') agendarJob(threadId);
    if (b.esperandoColegas && thread) agendarJob(thread);
  }

  function aplicarSnapshot(corpo: unknown): void {
    if (!ehObjeto(corpo) || !Array.isArray(corpo['bots'])) {
      somar(cont, 'snapshotsInvalidos');
      return;
    }
    const agora = op.relogio.agora();
    // O snapshot traz todos os bots e tarefas: o mapa de conversas é refeito (conversa arquivada sai dele).
    threadParaBot.clear();
    for (const wb of corpo['bots']) {
      const b = lerBot(wb);
      if (b) sincronizarBot(b, agora, false);
    }
    somar(cont, 'snapshots');
  }

  async function buscarSnapshot(): Promise<void> {
    if (!descoberta || buscandoSnapshot) return;
    buscandoSnapshot = true;
    try {
      const r = await lerJson(descoberta.porta, '/api/bots?messages=0', 4_000);
      if (r.status === 200) aplicarSnapshot(r.corpo);
      else somar(cont, 'snapshotsFalhos');
    } catch (e) {
      somar(cont, 'snapshotsFalhos');
      op.log?.aviso('não consegui ler o snapshot do OpenMausBot', { erro: descreverErro(e) });
    } finally {
      buscandoSnapshot = false;
    }
  }

  function pedirSnapshot(): void {
    if (snapshotPedido) return;
    snapshotPedido = op.relogio.agendar(5_000, () => {
      snapshotPedido = undefined;
      void buscarSnapshot();
    });
  }

  function agendarJob(threadId: string): void {
    if (!REGEX_THREAD.test(threadId) || timersJob.has(threadId)) return;
    timersJob.set(
      threadId,
      op.relogio.agendar(op.debounceJobMs ?? 300, () => {
        timersJob.delete(threadId);
        void buscarJob(threadId);
      }),
    );
  }

  async function buscarJob(threadId: string): Promise<void> {
    if (!descoberta || parado) return;
    let corpo: unknown;
    try {
      const r = await lerJson(descoberta.porta, `/api/threads/${threadId}/job?scope=job`, 4_000);
      if (r.status !== 200) {
        somar(cont, 'jobsFalhos');
        return;
      }
      corpo = r.corpo;
    } catch {
      somar(cont, 'jobsFalhos');
      return;
    }
    somar(cont, 'jobs');
    aplicarJob(corpo);
  }

  function aplicarJob(corpo: unknown): void {
    if (!ehObjeto(corpo) || !Array.isArray(corpo['nodes'])) return;
    const nos = corpo['nodes'].filter(ehObjeto).map((n) => ({
      id: texto(n['id']),
      parentId: texto(n['parentId']),
      botId: texto(n['botId']),
      status: texto(n['status']),
      fim: n['finishedAt'],
    }));
    const porId = new Map(nos.filter((n) => n.id).map((n) => [n.id as string, n]));
    const agora = op.relogio.agora();
    for (const n of nos) {
      if (!n.id || !n.parentId || !n.botId || !n.status || !REGEX_ID_SEGURO.test(n.id)) continue;
      const pai = porId.get(n.parentId);
      const deBot = pai?.botId ? bots.get(pai.botId) : undefined;
      const paraBot = bots.get(n.botId);
      if (!deBot || !paraBot) continue;
      const antes = jobs.get(n.id);
      jobs.set(n.id, n.status);
      if (jobs.size > 2_000) {
        const primeiro = jobs.keys().next().value;
        if (primeiro !== undefined) jobs.delete(primeiro);
      }
      if (antes === n.status) continue;
      const delegacao = { de: `omb:${deBot.id}`, para: `omb:${paraBot.id}`, jobId: n.id, status: n.status.replace(/[^a-z_-]/g, '') };
      const terminou = n.status === 'completed' || n.status === 'failed' || n.status === 'cancelled';
      const recente = typeof n.fim === 'number' ? agora - n.fim < 120_000 : typeof n.fim === 'string' ? agora - Date.parse(n.fim) < 120_000 : true;
      if (antes === undefined) {
        if (terminou && !recente) continue;
        emitir(deBot, 'delegacao.enviada', agora, ['job', n.id, 'enviada'], { delegacao });
        if (n.status !== 'queued' && n.status !== 'resume') emitir(paraBot, 'delegacao.recebida', agora, ['job', n.id, 'recebida'], { delegacao });
      } else if ((antes === 'queued' || antes === 'resume') && !terminou) {
        emitir(paraBot, 'delegacao.recebida', agora, ['job', n.id, 'recebida'], { delegacao });
      }
      if (n.status === 'needs_input') emitir(paraBot, 'espera.inicio', agora, ['job', n.id, 'espera', agora], { espera: { tipo: 'pergunta' } });
      else if (antes === 'needs_input') emitir(paraBot, 'espera.fim', agora, ['job', n.id, 'espera-fim', agora]);
      if (terminou) emitir(paraBot, 'delegacao.concluida', agora, ['job', n.id, 'concluida'], { delegacao });
    }
  }

  function aoRuntime(ev: unknown): void {
    if (!ehObjeto(ev)) return;
    const tipo = texto(ev['type']);
    const threadId = texto(ev['threadId']);
    if (!tipo || !threadId) return;
    somar(cont, 'runtime');
    const botId = threadParaBot.get(threadId);
    const b = botId ? bots.get(botId) : undefined;
    if (!b) {
      somar(cont, 'threadDesconhecida');
      pedirSnapshot();
      return;
    }
    const ts = instante(ev['createdAt'], op.relogio.agora());
    const eid = texto(ev['eventId']) ?? `${threadId}:${ts}:${tipo}`;
    const motor = motorDe(ev['provider']);
    const itemId = texto(ev['itemId']);
    switch (tipo) {
      case 'session.started': {
        const sid = texto(ev['sessionId']);
        if (sid) op.fusao.registrarSessaoDoOmb(sid, `omb:${b.id}`);
        return;
      }
      case 'turn.started': {
        const sala = salaDoBot(b, threadId);
        emitir(b, 'turno.inicio', ts, [eid], {}, sala ? { motor, sala } : { motor });
        return;
      }
      case 'turn.completed': {
        const uso = ehObjeto(ev['usage']) ? ev['usage'] : undefined;
        if (uso) {
          const u: NonNullable<ArcadiaEvent['uso']> = {};
          const entrada = numero(uso['input']);
          const saida = numero(uso['output']);
          const cache = numero(uso['cachedInput']) ?? numero(uso['cached_input']);
          const custo = numero(ev['cost']);
          if (entrada !== undefined) u.entrada = entrada;
          if (saida !== undefined) u.saida = saida;
          if (cache !== undefined) u.cache = cache;
          if (custo !== undefined) u.custoUsd = custo;
          if (Object.keys(u).length) emitir(b, 'uso', ts, [eid, 'uso'], { uso: u }, { motor });
        }
        if (ev['ok'] === true) emitir(b, 'turno.fim', ts, [eid], {}, { motor });
        else {
          const motivo = texto(ev['stopReason']) ?? '';
          if (motivo === 'interrupted') emitir(b, 'turno.fim', ts, [eid], { turno: { interrompido: true } }, { motor });
          else if (/limit|quota|usage|cap/i.test(motivo)) emitir(b, 'limite', ts, [eid], {}, { motor });
          else emitir(b, 'erro', ts, [eid], {}, { motor });
        }
        return;
      }
      case 'turn.wait_started':
        emitir(b, 'presenca', ts, [eid], { presenca: { estado: 'na-fila' } }, { motor });
        return;
      case 'turn.wait_ended':
        emitir(b, 'presenca', ts, [eid], { presenca: { estado: 'ativo' } }, { motor });
        return;
      case 'cap.exhausted':
        emitir(b, 'limite', ts, [eid], {}, { motor });
        return;
      case 'item.started': {
        if (ev['itemType'] === 'reasoning') {
          emitir(b, 'pensando', ts, [eid], {}, { motor });
          return;
        }
        const nome = texto(ev['title']) ?? 'ferramenta';
        const categoria = categoriaDaFerramenta(nome);
        const id = itemId ?? eid;
        pendentes.set(`${threadId}:${id}`, { nome, categoria });
        if (pendentes.size > 2_000) {
          const primeiro = pendentes.keys().next().value;
          if (primeiro !== undefined) pendentes.delete(primeiro);
        }
        const entrada = ehObjeto(ev['input']) ? ev['input'] : undefined;
        const arquivoBruto = entrada ? texto(entrada['file_path']) ?? texto(entrada['notebook_path']) : undefined;
        const arquivo = arquivoBruto ? absoluto(arquivoBruto, salaDoBot(b, threadId)) : undefined;
        emitir(b, 'ferramenta.inicio', ts, [eid], { ferramenta: { nome, categoria, id: id.slice(0, 100) } }, arquivo ? { motor, arquivo } : { motor });
        if (categoria === 'delegar') agendarJob(threadId);
        return;
      }
      case 'item.completed': {
        if (ev['itemType'] !== 'tool') return;
        const id = itemId ?? eid;
        const p = pendentes.get(`${threadId}:${id}`);
        pendentes.delete(`${threadId}:${id}`);
        const ok = ev['ok'] === true;
        emitir(b, ok ? 'ferramenta.fim' : 'ferramenta.erro', ts, [eid], { ferramenta: { nome: p?.nome ?? 'ferramenta', categoria: p?.categoria ?? 'outro', id: id.slice(0, 100), ok } }, { motor });
        if (p?.categoria === 'delegar') agendarJob(threadId);
        return;
      }
      case 'request.opened': {
        const t = ev['requestType'] === 'question' ? 'pergunta' : 'permissao';
        emitir(b, 'espera.inicio', ts, [eid], { espera: { tipo: t } }, { motor });
        return;
      }
      case 'request.resolved':
        emitir(b, 'espera.fim', ts, [eid], {}, { motor });
        return;
      case 'runtime.error':
        emitir(b, 'erro', ts, [eid], {}, { motor });
        return;
      case 'runtime.notice':
        if (ev['stalled'] === true || ev['stalled'] === 'true') emitir(b, 'presenca', ts, [eid], { presenca: { estado: 'sem-sinal' } }, { motor });
        else if (ev['limitResetsAt'] !== undefined) emitir(b, 'limite', ts, [eid], {}, { motor });
        return;
      default:
        if (RUNTIME_SEM_USO.has(tipo)) return;
        somar(desconhecidos, `runtime:${nomeDeTipo(tipo)}`);
    }
  }

  /** Um quadro com defeito (ou formato novo que quebra a leitura) não derruba o adaptador nem o servidor. */
  function aoQuadro(q: QuadroSse): void {
    try {
      tratarQuadro(q);
    } catch (e) {
      somar(cont, 'quadrosComFalha');
      op.log?.erro('um quadro do OpenMausBot falhou; sigo com os próximos', { erro: descreverErro(e) });
      pedirSnapshot();
    }
  }

  function tratarQuadro(q: QuadroSse): void {
    if (q.id) ultimoId = q.id;
    ultimoQuadro = op.relogio.agora();
    if (!ehObjeto(q.dados)) return;
    const kind = nomeDeTipo(q.dados['kind']);
    somar(quadros, kind);
    switch (kind) {
      case 'hello':
        conectado = true;
        op.fusao.definirOmbConectado(true);
        falhasSeguidas = 0;
        // Retomada impossível (outro processo ou buffer estourado): refaz o snapshot.
        if (q.dados['resumed'] !== true) void buscarSnapshot();
        return;
      case 'ping':
        return;
      case 'bot': {
        const b = lerBot(q.dados['bot']);
        if (b) sincronizarBot(b, op.relogio.agora(), false);
        return;
      }
      case 'bot.deleted': {
        const id = texto(q.dados['botId']);
        if (id) {
          bots.delete(id);
          for (const [t, dono] of [...threadParaBot]) if (dono === id) threadParaBot.delete(t);
        }
        return;
      }
      case 'bot.queued': {
        // Só a contagem por conversa: o texto das mensagens na fila nunca é lido.
        const filas = ehObjeto(q.dados['queues']) ? q.dados['queues'] : {};
        const comFila = new Set<string>();
        for (const [threadId, itens] of Object.entries(filas)) {
          const botId = threadParaBot.get(threadId);
          if (botId && Array.isArray(itens) && itens.length > 0) comFila.add(botId);
        }
        const agora = op.relogio.agora();
        for (const b of bots.values()) {
          const naFila = comFila.has(b.id);
          if (naFila !== b.naFila) {
            b.naFila = naFila;
            sincronizarBot(b, agora, false);
          }
        }
        return;
      }
      case 'runtime':
        aoRuntime(q.dados['event']);
        return;
      default:
        if (QUADROS_SEM_USO.has(kind) || kind.startsWith('webhook') || kind.startsWith('app-trigger')) return;
        somar(desconhecidos, kind);
        pedirSnapshot();
    }
  }

  function conectarSse(): void {
    if (!descoberta || parado) return;
    conexao?.fechar();
    conexao = abrirSseOmb({
      porta: descoberta.porta,
      ...(ultimoId !== undefined ? { ultimoId } : {}),
      relogio: op.relogio,
      aoQuadro,
      aoFim: () => {
        conexao = undefined;
        conectado = false;
        op.fusao.definirOmbConectado(false);
        if (parado) return;
        falhasSeguidas++;
        if (falhasSeguidas >= 3) {
          descoberta = undefined;
          return;
        }
        timerReconexao = op.relogio.agendar(Math.min(10_000, 1_000 * 2 ** (falhasSeguidas - 1)), conectarSse);
      },
    });
  }

  async function tentar(): Promise<void> {
    if (parado || conexao) return;
    const d = await descobrirOmb(op.portas, op.casa, 800);
    tentativasDescoberta = d.tentativas.map((t) => `${t.porta}: ${t.resultado}`).join('; ');
    recusado = d.encontrado ? undefined : d.recusado;
    if (!d.encontrado) {
      descoberta = undefined;
      conectado = false;
      op.fusao.definirOmbConectado(false);
      if (d.recusado) somar(cont, 'recusas');
      return;
    }
    descoberta = d.encontrado;
    falhasSeguidas = 0;
    // Achado e conferido: a fusão já sabe que as sessões sdk-cli são de bots, antes do primeiro quadro do SSE.
    op.fusao.definirOmbConectado(true);
    await buscarSnapshot();
    conectarSse();
  }

  return {
    id: 'omb',
    nome: 'OpenMausBot',
    pronto: () => prontoPromessa,
    conectado: () => conectado,
    async iniciar() {
      try {
        await tentar();
      } finally {
        resolverPronto();
      }
      timerDescoberta = op.relogio.repetir(op.intervaloDescobertaMs ?? 30_000, () => {
        if (!conexao) void tentar();
      });
    },
    async parar() {
      parado = true;
      timerDescoberta?.cancelar();
      timerReconexao?.cancelar();
      snapshotPedido?.cancelar();
      for (const t of timersJob.values()) t.cancelar();
      conexao?.fechar();
      op.fusao.definirOmbConectado(false);
    },
    diagnostico(): DiagnosticoAdaptador {
      const linhas: string[] = [];
      if (!descoberta && recusado) {
        linhas.push(`Algo respondeu na porta ${recusado.porta}, mas o environment-id não confere com o do app instalado (ou não deu para conferir): não conectei. Pode ser outro programa nessa porta.`);
        linhas.push(`Tentativas: ${tentativasDescoberta ?? 'nenhuma'}.`);
      } else if (!descoberta) linhas.push(`Não encontrado (${tentativasDescoberta ?? 'ainda não procurei'}). O mundo segue com as outras fontes.`);
      else {
        linhas.push(`Porta ${descoberta.porta}, versão ${descoberta.versao ?? 'desconhecida'}${descoberta.versao && descoberta.versao !== VERSAO_CONFERIDA_OMB ? ` (diferente da conferida, ${VERSAO_CONFERIDA_OMB}: confira o teste de contrato)` : ''}.`);
        if (descoberta.confereComArquivo === true) linhas.push('O environment-id confere com o do app instalado.');
        if (descoberta.confereComArquivo === false) linhas.push('O environment-id não confere: pode ser outro programa nessa porta.');
        const atividades: Record<string, number> = {};
        for (const b of bots.values()) somar(atividades, nomeDeTipo(b.activity ?? 'idle'));
        linhas.push(`SSE ${conectado ? 'conectado' : 'desconectado'}; ${fmt(bots.size)} bots (${Object.entries(atividades).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || 'nenhum'}).`);
        linhas.push(`Quadros: ${Object.entries(quadros).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || 'nenhum ainda'}; ${fmt(cont['runtime'] ?? 0)} eventos de motor, ${fmt(cont['jobs'] ?? 0)} leituras de delegação.`);
      }
      const d = descreverDesconhecidos(desconhecidos);
      if (d) linhas.push(d);
      const r: DiagnosticoAdaptador = {
        estado: conectado ? 'ligada' : descoberta ? 'aguardando' : recusado ? 'erro' : 'desligada',
        resumo: conectado ? 'conectado' : descoberta ? 'encontrado, reconectando' : recusado ? 'recusado (o environment-id não confere)' : 'fechado',
        linhas,
        contadores: { ...cont, bots: bots.size },
        desconhecidos: { ...desconhecidos },
      };
      if (descoberta?.versao) r.versao = descoberta.versao;
      if (ultimoEvento !== undefined) r.ultimoEvento = ultimoEvento;
      if (ultimoQuadro !== undefined) linhas.push(`Último quadro do SSE há ${fmt(Math.max(0, Math.round((op.relogio.agora() - ultimoQuadro) / 1000)))} s.`);
      return r;
    },
  };
}
