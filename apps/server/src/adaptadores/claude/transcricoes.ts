// Transcrições do Claude Code (~/.claude/projects/<pasta>/<sessão>.jsonl e <sessão>/subagents/agent-<id>.jsonl).
// Zero instalação. De cada linha saem só tipo, ids, horário, cwd (em memória, para a sala), entrypoint, nomes de
// ferramenta, caminho de arquivo citado (em memória), stop_reason e contagem de tokens. Prompt, resposta, thinking,
// entrada e saída de ferramenta ficam no arquivo: nada disso é copiado para o evento.
import { idDeEvento } from '../../util/hash.ts';
import type { Log } from '../../util/log.ts';
import type { Relogio } from '../../util/relogio.ts';
import type { ArcadiaEvent, AgenteRef } from '@arcadia/shared';
import type { EntradaBruta } from '../../nucleo.ts';
import {
  absoluto, categoriaDaFerramenta, descreverDesconhecidos, ehObjeto, ehPastaPrivadaOmb, fmt, instante, nomeDeTipo, numero,
  somar, texto, type Adaptador, type DiagnosticoAdaptador, type Emissor,
} from '../comum.ts';
import type { Fusao } from '../fusao.ts';
import { criarSeguidor, type ArquivoSeguido, type Linha, type Seguidor } from '../seguidor.ts';

/** Tipos de linha conhecidos que não viram evento (não contam como desconhecidos). */
const SEM_EVENTO = new Set([
  'attachment', 'queue-operation', 'mode', 'last-prompt', 'cost-state', 'file-history-snapshot', 'file-history-delta',
  'api-request', 'api-request-blob', 'api-request-shape', 'atis-latch', 'bridge-session', 'frame-link',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'progress',
]);

const REGEX_SESSAO = /^([^/]+)\/([^/]+)\.jsonl$/;
const REGEX_SUBAGENTE = /^([^/]+)\/([^/]+)\/subagents\/agent-([^/]+)\.jsonl$/;
const REGEX_ID_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/;

/** Sessão aberta pelo OpenMausBot por baixo de um bot (entrypoint sdk-cli). */
function ehSdk(c: { entrypoint?: string }): boolean {
  return c.entrypoint === 'sdk-cli';
}

type Pendente = { nome: string; categoria: ReturnType<typeof categoriaDaFerramenta>; espera?: boolean };

type Contexto = {
  sessionId?: string;
  agentId?: string;
  subagente: boolean;
  entrypoint?: string;
  cwd?: string;
  /** Último cwd mandado ao núcleo (um cwd novo vai junto no próximo evento: decide sala e exclusão). */
  cwdEnviado?: string;
  titulo?: string;
  tituloProprio?: boolean;
  nome?: string;
  iniciou: boolean;
  semEventoAinda: boolean;
  pendentes: Map<string, Pendente>;
  uso: Map<string, { e: number; s: number; c: number }>;
};

export type OpcoesTranscricoes = {
  /** Pasta ~/.claude/projects já expandida. */
  pasta: string;
  catchUpHoras: number;
  relogio: Relogio;
  emitir: Emissor;
  fusao: Fusao;
  log?: Log;
  observar?: boolean;
  varreduraMs?: number;
  bytesDoFim?: number;
};

export type AdaptadorTranscricoes = Adaptador & {
  /** Para testes: processa linhas de um arquivo (caminho relativo à pasta) como se tivessem chegado agora. */
  processar(relativo: string, linhas: string[], opcoes?: { catchUp?: boolean; doComeco?: boolean }): void;
  readonly seguidor: Seguidor;
};

export function criarAdaptadorTranscricoes(op: OpcoesTranscricoes): AdaptadorTranscricoes {
  const contextos = new Map<string, Contexto>();
  const cont: Record<string, number> = {};
  const desconhecidos: Record<string, number> = {};
  let ultimoEvento: number | undefined;

  function contexto(relativo: string): Contexto | undefined {
    let c = contextos.get(relativo);
    if (c) return c;
    const sub = REGEX_SUBAGENTE.exec(relativo);
    const ses = sub ? undefined : REGEX_SESSAO.exec(relativo);
    if (!sub && !ses) return undefined;
    c = { subagente: Boolean(sub), iniciou: false, semEventoAinda: true, pendentes: new Map(), uso: new Map() };
    if (sub) {
      c.sessionId = sub[2];
      c.agentId = sub[3];
    } else if (ses) {
      c.sessionId = ses[2];
    }
    contextos.set(relativo, c);
    return c;
  }

  function agenteDe(c: Contexto): AgenteRef | undefined {
    const sid = c.sessionId;
    if (!sid || !REGEX_ID_SEGURO.test(sid)) return undefined;
    if (c.subagente) {
      if (!c.agentId || !REGEX_ID_SEGURO.test(c.agentId)) return undefined;
      return { chave: `claude:${sid}:${c.agentId}`, tipo: 'subagente', paiChave: `claude:${sid}` };
    }
    const a: AgenteRef = { chave: `claude:${sid}`, tipo: 'sessao' };
    // Sessão sdk-cli é de bot (OpenMausBot) mesmo antes de o adaptador do OMB conectar: nunca leva nome nem título.
    if (c.nome && !ehSdk(c)) a.nome = c.nome;
    return a;
  }

  function evento(
    c: Contexto,
    agente: AgenteRef,
    tipo: ArcadiaEvent['tipo'],
    ts: number,
    partes: (string | number)[],
    extra: Partial<ArcadiaEvent> = {},
    caminhos?: EntradaBruta['caminhos'],
    votarSala = false,
  ): EntradaBruta {
    const ev: ArcadiaEvent = {
      v: 1,
      id: idDeEvento('claude-transcricao', agente.chave, ...partes),
      ts,
      recebidoEm: ts,
      origem: 'claude-transcricao',
      motor: 'claude',
      agente,
      local: {},
      tipo,
      ...extra,
    };
    if (c.titulo && !c.subagente && !ehSdk(c)) ev.tarefa = { titulo: c.titulo };
    // O primeiro evento de cada agente, os de começo de turno e o primeiro depois de o cwd mudar levam o cwd: ele
    // vota na sala (quando a ferramenta não aponta um arquivo) e diz ao núcleo se a sessão está em pasta excluída.
    let cam = caminhos;
    if (c.cwd && (votarSala || c.semEventoAinda || c.cwd !== c.cwdEnviado)) {
      cam = cam ? { ...cam, cwd: c.cwd } : { cwd: c.cwd };
      c.cwdEnviado = c.cwd;
    }
    c.semEventoAinda = false;
    ultimoEvento = Math.max(ultimoEvento ?? 0, ts);
    somar(cont, 'eventos');
    return cam ? { evento: ev, caminhos: cam } : { evento: ev };
  }

  function caminhoDaFerramenta(nome: string, entrada: unknown, cwd: string | undefined): EntradaBruta['caminhos'] | undefined {
    if (!ehObjeto(entrada)) return undefined;
    if (nome.startsWith('mcp__')) return undefined;
    const arquivo = texto(entrada['file_path']) ?? texto(entrada['notebook_path']);
    if (arquivo) {
      const abs = absoluto(arquivo, cwd);
      return abs ? { arquivo: abs } : undefined;
    }
    if (nome === 'Grep' || nome === 'Glob' || nome === 'LS') {
      const pasta = texto(entrada['path']);
      const abs = pasta ? absoluto(pasta, cwd) : undefined;
      return abs ? { pasta: abs } : undefined;
    }
    return undefined;
  }

  function processarLinha(l: Linha, a: { relativo: string; doComeco: boolean }, saida: EntradaBruta[]): void {
    const c = contexto(a.relativo);
    if (!c) {
      somar(cont, 'foraDoPadrao');
      return;
    }
    let o: unknown;
    try {
      o = JSON.parse(l.texto);
    } catch {
      somar(cont, 'invalidas');
      return;
    }
    if (!ehObjeto(o)) {
      somar(cont, 'invalidas');
      return;
    }
    somar(cont, 'linhas');
    const tipo = o['type'];
    // Campos de contexto (em memória). O cwd nunca sai daqui: vira sala no núcleo.
    const sid = texto(o['sessionId']);
    if (sid && !c.sessionId) c.sessionId = sid;
    const cwd = texto(o['cwd']);
    if (cwd) c.cwd = cwd;
    const entrypoint = texto(o['entrypoint']);
    if (entrypoint) c.entrypoint = entrypoint;
    if (!c.subagente && o['isSidechain'] === true && texto(o['agentId'])) {
      // Formato antigo: linha de subagente dentro do arquivo da sessão. Fica de fora (o arquivo próprio cobre).
      somar(cont, 'sidechainNoPrincipal');
      return;
    }
    if (op.fusao.ehDoOmb({ sessionId: c.sessionId, entrypoint: c.entrypoint, pastaPrivada: ehPastaPrivadaOmb(c.cwd) })) {
      somar(cont, 'doOmb');
      return;
    }
    const ts = instante(o['timestamp'], op.relogio.agora());
    // Sem uuid, o id usa a posição no arquivo e a sessão (nunca o nome da pasta, que guarda o cwd codificado).
    const uuid = texto(o['uuid']) ?? `${c.sessionId ?? ''}:${c.agentId ?? ''}@${l.inicio}`;

    switch (tipo) {
      case 'ai-title': {
        const t = texto(o['aiTitle']);
        if (t && !c.tituloProprio) c.titulo = t;
        return;
      }
      case 'custom-title': {
        const t = texto(o['customTitle']);
        if (t) {
          c.titulo = t;
          c.tituloProprio = true;
        }
        return;
      }
      case 'summary': {
        const t = texto(o['summary']);
        if (t && !c.tituloProprio) c.titulo = t;
        return;
      }
      case 'agent-name': {
        const n = texto(o['agentName']);
        if (n) c.nome = n;
        return;
      }
      case 'system': {
        const sub = o['subtype'];
        const agente = agenteDe(c);
        if (sub === 'compact_boundary' && agente) saida.push(evento(c, agente, 'compactacao', ts, [uuid]));
        else somar(cont, `system:${nomeDeTipo(sub)}`);
        return;
      }
      case 'user':
        return linhaDoUsuario(o, c, ts, uuid, a, saida);
      case 'assistant':
        return linhaDoAssistente(o, c, ts, uuid, saida);
      default:
        if (typeof tipo === 'string' && SEM_EVENTO.has(tipo)) somar(cont, 'semEvento');
        else somar(desconhecidos, nomeDeTipo(tipo));
    }
  }

  function linhaDoUsuario(o: Record<string, unknown>, c: Contexto, ts: number, uuid: string, a: { doComeco: boolean }, saida: EntradaBruta[]): void {
    const agente = agenteDe(c);
    if (!agente || o['isMeta'] === true) return;
    const msg = o['message'];
    const conteudo = ehObjeto(msg) ? msg['content'] : undefined;
    const blocos = Array.isArray(conteudo) ? conteudo.filter(ehObjeto) : [];
    const resultados = blocos.filter((b) => b['type'] === 'tool_result');
    const ehPedido = typeof conteudo === 'string' || (resultados.length === 0 && blocos.some((b) => b['type'] === 'text' || b['type'] === 'image' || b['type'] === 'document'));
    if (ehPedido) {
      if (c.subagente) {
        if (!c.iniciou) {
          c.iniciou = true;
          saida.push(evento(c, agente, 'subagente.inicio', ts, [uuid, 'inicio'], {}, undefined, true));
        } else {
          saida.push(evento(c, agente, 'pensando', ts, [uuid, 'pedido']));
        }
      } else {
        if (a.doComeco && !c.iniciou) saida.push(evento(c, agente, 'sessao.inicio', ts, [uuid, 'sessao'], {}, undefined, true));
        c.iniciou = true;
        saida.push(evento(c, agente, 'pedido.humano', ts, [uuid, 'pedido'], {}, undefined, true));
      }
    }
    for (const b of resultados) {
      const id = texto(b['tool_use_id']);
      if (!id) continue;
      const p = c.pendentes.get(id);
      c.pendentes.delete(id);
      const ferramenta = { nome: p?.nome ?? 'ferramenta', categoria: p?.categoria ?? ('outro' as const), id: id.slice(0, 100) };
      if (p?.espera) saida.push(evento(c, agente, 'espera.fim', ts, [uuid, 'espera', id]));
      const falhou = b['is_error'] === true;
      saida.push(evento(c, agente, falhou ? 'ferramenta.erro' : 'ferramenta.fim', ts, [uuid, 'fim', id], { ferramenta: { ...ferramenta, ok: !falhou } }));
    }
  }

  function linhaDoAssistente(o: Record<string, unknown>, c: Contexto, ts: number, uuid: string, saida: EntradaBruta[]): void {
    const agente = agenteDe(c);
    if (!agente) return;
    if (o['isApiErrorMessage'] === true) {
      saida.push(evento(c, agente, 'erro', ts, [uuid, 'erro']));
      return;
    }
    const msg = o['message'];
    if (!ehObjeto(msg)) return;
    const blocos = Array.isArray(msg['content']) ? msg['content'].filter(ehObjeto) : [];
    blocos.forEach((b, i) => {
      const t = b['type'];
      if (t === 'thinking' || t === 'redacted_thinking') {
        saida.push(evento(c, agente, 'pensando', ts, [uuid, i]));
      } else if (t === 'text') {
        saida.push(evento(c, agente, 'pensando', ts, [uuid, i], c.subagente ? {} : { turno: { texto: true } }));
      } else if (t === 'tool_use') {
        const nome = texto(b['name']) ?? 'ferramenta';
        const id = texto(b['id']) ?? `${uuid}#${i}`;
        const categoria = categoriaDaFerramenta(nome);
        const espera = nome === 'AskUserQuestion' ? 'pergunta' : nome === 'ExitPlanMode' ? 'aprovacao' : undefined;
        c.pendentes.set(id, espera ? { nome, categoria, espera: true } : { nome, categoria });
        if (c.pendentes.size > 200) {
          const primeiro = c.pendentes.keys().next().value;
          if (primeiro !== undefined) c.pendentes.delete(primeiro);
        }
        const caminhos = caminhoDaFerramenta(nome, b['input'], c.cwd);
        saida.push(evento(c, agente, 'ferramenta.inicio', ts, [uuid, 'f', id], { ferramenta: { nome, categoria, id: id.slice(0, 100) } }, caminhos));
        if (espera) saida.push(evento(c, agente, 'espera.inicio', ts, [uuid, 'espera', id], { espera: { tipo: espera } }));
      }
    });
    const parada = msg['stop_reason'];
    if (parada === 'end_turn' || parada === 'stop_sequence') {
      saida.push(evento(c, agente, c.subagente ? 'subagente.fim' : 'turno.fim', ts, [uuid, 'fim-turno']));
    }
    const uso = msg['usage'];
    if (ehObjeto(uso)) {
      const chave = `${texto(msg['id']) ?? uuid}|${texto(o['requestId']) ?? ''}`;
      const e = numero(uso['input_tokens']) ?? 0;
      const s = numero(uso['output_tokens']) ?? 0;
      const cc = (numero(uso['cache_read_input_tokens']) ?? 0) + (numero(uso['cache_creation_input_tokens']) ?? 0);
      const antes = c.uso.get(chave) ?? { e: 0, s: 0, c: 0 };
      const delta = { e: Math.max(0, e - antes.e), s: Math.max(0, s - antes.s), c: Math.max(0, cc - antes.c) };
      c.uso.set(chave, { e: Math.max(e, antes.e), s: Math.max(s, antes.s), c: Math.max(cc, antes.c) });
      if (c.uso.size > 64) {
        const primeiro = c.uso.keys().next().value;
        if (primeiro !== undefined) c.uso.delete(primeiro);
      }
      if (delta.e || delta.s || delta.c) {
        saida.push(evento(c, agente, 'uso', ts, ['uso', chave, e, s, cc], { uso: { entrada: delta.e, saida: delta.s, cache: delta.c } }));
      }
    }
  }

  function aoLer(linhas: Linha[], a: ArquivoSeguido): void {
    const saida: EntradaBruta[] = [];
    for (const l of linhas) processarLinha(l, a, saida);
    for (const e of saida) op.emitir(e);
  }

  const seguidor = criarSeguidor({
    raiz: op.pasta,
    incluir: (rel) => REGEX_SESSAO.test(rel) || REGEX_SUBAGENTE.test(rel),
    profundidade: 3,
    catchUpMs: op.catchUpHoras * 3600_000,
    bytesDoFim: op.bytesDoFim ?? 256 * 1024,
    varreduraMs: op.varreduraMs ?? 2_000,
    relogio: op.relogio,
    aoLer,
    aoRemover: (a) => contextos.delete(a.relativo),
    // Arquivo parado: a contagem de tokens e as ferramentas pendentes dele não servem mais (o resto fica pequeno).
    aoEsfriar: (a) => {
      const c = contextos.get(a.relativo);
      if (!c) return;
      c.uso.clear();
      c.pendentes.clear();
    },
    ...(op.observar !== undefined ? { observar: op.observar } : {}),
    ...(op.log ? { log: op.log } : {}),
  });

  return {
    id: 'claude-transcricao',
    nome: 'Transcrições do Claude Code',
    seguidor,
    iniciar: () => seguidor.iniciar(),
    parar: () => seguidor.parar(),
    processar(relativo, linhas, opcoes = {}) {
      const a = { relativo, doComeco: opcoes.doComeco ?? false };
      const saida: EntradaBruta[] = [];
      let pos = 0;
      for (const t of linhas) {
        processarLinha({ texto: t, inicio: pos, catchUp: opcoes.catchUp ?? false }, a, saida);
        pos += Buffer.byteLength(t) + 1;
      }
      for (const e of saida) op.emitir(e);
    },
    diagnostico(): DiagnosticoAdaptador {
      const s = seguidor.estatisticas();
      const linhas = [
        `${fmt(s.arquivos)} arquivos acompanhados; ${fmt(cont['linhas'] ?? 0)} linhas lidas, ${fmt(cont['eventos'] ?? 0)} eventos gerados.`,
        `Linhas ignoradas: ${fmt(cont['invalidas'] ?? 0)} com JSON inválido, ${fmt(Object.values(desconhecidos).reduce((x, y) => x + y, 0))} de tipo desconhecido, ${fmt(cont['doOmb'] ?? 0)} de bots do OpenMausBot (ficam com o adaptador do OMB).`,
        `Observador de arquivos: ${s.observador}; varredura de segurança a cada 2 s${s.erros ? `; ${fmt(s.erros)} erros de leitura` : ''}.`,
      ];
      const d = descreverDesconhecidos(desconhecidos);
      if (d) linhas.push(d);
      const r: DiagnosticoAdaptador = {
        estado: s.raizExiste ? 'ligada' : 'aguardando',
        resumo: s.raizExiste ? 'lendo' : 'pasta não encontrada',
        linhas,
        contadores: { ...cont, arquivos: s.arquivos, erros: s.erros },
        desconhecidos: { ...desconhecidos },
      };
      if (ultimoEvento !== undefined) r.ultimoEvento = ultimoEvento;
      return r;
    },
  };
}
