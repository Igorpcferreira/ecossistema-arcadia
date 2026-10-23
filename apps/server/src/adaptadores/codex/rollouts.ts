// Rollouts do Codex (~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl). Cada linha: {timestamp, ordinal, type, payload}.
// O `originator` do session_meta diz a origem (codex_vscode, Codex Desktop, openmausbot). Saem só tipos, ids,
// horários, nomes de ferramenta, status e contagem de tokens; argumentos, saídas, mensagens e raciocínio não.
// O caminho de arquivo de um apply_patch é lido em memória só para decidir a sala (e o nome curto, se permitido).
import type { AgenteRef, ArcadiaEvent } from '@arcadia/shared';
import { idDeEvento } from '../../util/hash.ts';
import type { Log } from '../../util/log.ts';
import type { Relogio } from '../../util/relogio.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import {
  absoluto, categoriaDaFerramenta, descreverDesconhecidos, ehObjeto, ehPastaPrivadaOmb, fmt, instante, nomeDeTipo, numero,
  somar, texto, type Adaptador, type DiagnosticoAdaptador, type Emissor,
} from '../comum.ts';
import type { Fusao } from '../fusao.ts';
import { criarSeguidor, type ArquivoSeguido, type Linha, type Seguidor } from '../seguidor.ts';

const REGEX_ROLLOUT = /^(?:\d{4}\/\d{2}\/\d{2}\/)?rollout-[^/]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const REGEX_ID_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/;

/** Tipos (linha ou payload) conhecidos que não viram evento. */
const SEM_EVENTO = new Set([
  'world_state', 'token_usage_record', 'inter_agent_communication_metadata', 'event_msg:thread_settings_applied',
  'event_msg:sub_agent_activity', 'event_msg:mcp_tool_call_end', 'event_msg:patch_apply_end', 'event_msg:agent_message',
  'event_msg:exec_command_begin', 'event_msg:exec_command_end', 'event_msg:agent_reasoning', 'event_msg:agent_reasoning_delta',
  'event_msg:agent_message_delta', 'event_msg:web_search_end', 'response_item:additional_tools', 'response_item:web_search_call',
  'response_item:local_shell_call_output',
]);

type Pendente = { nome: string; categoria: ReturnType<typeof categoriaDaFerramenta>; espera?: boolean };

type Contexto = {
  sessionId?: string;
  cwd?: string;
  /** Último cwd mandado ao núcleo (um cwd novo vai junto no próximo evento: decide sala e exclusão). */
  cwdEnviado?: string;
  originator?: string;
  pai?: string;
  apelido?: string;
  iniciou: boolean;
  semEventoAinda: boolean;
  pendentes: Map<string, Pendente>;
};

export type OpcoesRollouts = {
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

export type AdaptadorRollouts = Adaptador & {
  processar(relativo: string, linhas: string[], opcoes?: { catchUp?: boolean; doComeco?: boolean }): void;
  readonly seguidor: Seguidor;
};

/** Primeiro arquivo citado num patch do apply_patch (só o caminho, em memória). */
export function arquivoDoPatch(patch: string): string | undefined {
  const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch);
  return m?.[1]?.trim() || undefined;
}

export function criarAdaptadorRollouts(op: OpcoesRollouts): AdaptadorRollouts {
  const contextos = new Map<string, Contexto>();
  const cont: Record<string, number> = {};
  const desconhecidos: Record<string, number> = {};
  const origens: Record<string, number> = {};
  let ultimoEvento: number | undefined;

  function contexto(relativo: string): Contexto | undefined {
    let c = contextos.get(relativo);
    if (c) return c;
    const m = REGEX_ROLLOUT.exec(relativo);
    if (!m) return undefined;
    c = { iniciou: false, semEventoAinda: true, pendentes: new Map() };
    if (m[1]) c.sessionId = m[1].toLowerCase();
    contextos.set(relativo, c);
    return c;
  }

  function agenteDe(c: Contexto): AgenteRef | undefined {
    if (!c.sessionId || !REGEX_ID_SEGURO.test(c.sessionId)) return undefined;
    if (c.pai && REGEX_ID_SEGURO.test(c.pai)) {
      const a: AgenteRef = { chave: `codex:${c.sessionId}`, tipo: 'subagente', paiChave: `codex:${c.pai}` };
      if (c.apelido && c.originator !== 'openmausbot') a.nome = c.apelido;
      return a;
    }
    return { chave: `codex:${c.sessionId}`, tipo: 'sessao' };
  }

  function evento(c: Contexto, agente: AgenteRef, tipo: ArcadiaEvent['tipo'], ts: number, partes: (string | number)[], extra: Partial<ArcadiaEvent> = {}, caminhos?: EntradaBruta['caminhos'], votarSala = false): EntradaBruta {
    const ev: ArcadiaEvent = {
      v: 1,
      id: idDeEvento('codex-rollout', agente.chave, ...partes),
      ts,
      recebidoEm: ts,
      origem: 'codex-rollout',
      motor: 'codex',
      agente,
      local: {},
      tipo,
      ...extra,
    };
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
    const tipoLinha = o['type'];
    const p = ehObjeto(o['payload']) ? o['payload'] : {};
    const sub = texto(p['type']);
    const chave = sub ? `${nomeDeTipo(tipoLinha)}:${nomeDeTipo(sub)}` : nomeDeTipo(tipoLinha);
    const ts = instante(o['timestamp'], op.relogio.agora());
    const marca = typeof o['ordinal'] === 'number' ? `o${o['ordinal']}` : `b${l.inicio}`;

    if (tipoLinha === 'session_meta') {
      const id = texto(p['id']);
      if (id) c.sessionId = id.toLowerCase();
      const cwd = texto(p['cwd']);
      if (cwd) c.cwd = cwd;
      const originator = texto(p['originator']);
      if (originator) {
        c.originator = originator;
        somar(origens, nomeDeTipo(originator.replace(/\s+/g, '_')));
      }
      const pai = texto(p['parent_thread_id']);
      if (pai) c.pai = pai.toLowerCase();
      const apelido = texto(p['agent_nickname']);
      if (apelido) c.apelido = apelido;
      if (op.fusao.ehDoOmb({ sessionId: c.sessionId, originator: c.originator, pastaPrivada: ehPastaPrivadaOmb(c.cwd) })) return;
      const agente = agenteDe(c);
      if (agente && a.doComeco && !c.iniciou) {
        c.iniciou = true;
        saida.push(evento(c, agente, c.pai ? 'subagente.inicio' : 'sessao.inicio', ts, [marca, 'inicio'], {}, undefined, true));
      }
      return;
    }
    if (tipoLinha === 'turn_context') {
      const cwd = texto(p['cwd']);
      if (cwd) c.cwd = cwd;
      return;
    }
    if (op.fusao.ehDoOmb({ sessionId: c.sessionId, originator: c.originator, pastaPrivada: ehPastaPrivadaOmb(c.cwd) })) {
      somar(cont, 'doOmb');
      return;
    }
    const agente = agenteDe(c);
    if (!agente) {
      somar(cont, 'semSessao');
      return;
    }

    switch (chave) {
      case 'event_msg:task_started':
        saida.push(evento(c, agente, 'turno.inicio', ts, [marca], {}, undefined, true));
        return;
      case 'event_msg:user_message':
        saida.push(evento(c, agente, 'pedido.humano', ts, [marca], {}, undefined, true));
        return;
      case 'response_item:reasoning':
      case 'response_item:message':
      case 'response_item:agent_message':
        if (sub === 'message' && p['role'] === 'user') return;
        saida.push(evento(c, agente, 'pensando', ts, [marca]));
        return;
      case 'response_item:function_call':
      case 'response_item:custom_tool_call':
      case 'response_item:local_shell_call': {
        const nome = texto(p['name']) ?? (sub === 'local_shell_call' ? 'local_shell' : 'ferramenta');
        const id = texto(p['call_id']) ?? texto(p['id']) ?? marca;
        const categoria = texto(p['namespace']) ? 'integracao' : categoriaDaFerramenta(nome);
        const espera = nome === 'request_user_input_async' || nome === 'request_user_input';
        c.pendentes.set(id, espera ? { nome, categoria, espera: true } : { nome, categoria });
        if (c.pendentes.size > 200) {
          const primeiro = c.pendentes.keys().next().value;
          if (primeiro !== undefined) c.pendentes.delete(primeiro);
        }
        let caminhos: EntradaBruta['caminhos'] | undefined;
        if (nome === 'apply_patch') {
          let patch = texto(p['input']);
          if (!patch) {
            try {
              const args: unknown = JSON.parse(texto(p['arguments']) ?? '{}');
              if (ehObjeto(args)) patch = texto(args['input']) ?? texto(args['patch']);
            } catch {
              patch = undefined;
            }
          }
          const arq = patch ? arquivoDoPatch(patch) : undefined;
          const abs = arq ? absoluto(arq, c.cwd) : undefined;
          if (abs) caminhos = { arquivo: abs };
        }
        saida.push(evento(c, agente, 'ferramenta.inicio', ts, [marca, id], { ferramenta: { nome, categoria, id: id.slice(0, 100) } }, caminhos));
        if (espera) saida.push(evento(c, agente, 'espera.inicio', ts, [marca, 'espera', id], { espera: { tipo: 'pergunta' } }));
        return;
      }
      case 'response_item:function_call_output':
      case 'response_item:custom_tool_call_output': {
        const id = texto(p['call_id']) ?? marca;
        const pend = c.pendentes.get(id);
        c.pendentes.delete(id);
        if (pend?.espera) saida.push(evento(c, agente, 'espera.fim', ts, [marca, 'espera', id]));
        saida.push(evento(c, agente, 'ferramenta.fim', ts, [marca, id], { ferramenta: { nome: pend?.nome ?? 'ferramenta', categoria: pend?.categoria ?? 'outro', id: id.slice(0, 100) } }));
        return;
      }
      case 'event_msg:item_completed': {
        const item = ehObjeto(p['item']) ? p['item'] : {};
        const tipoItem = texto(item['type']);
        if (tipoItem === 'ContextCompaction') {
          saida.push(evento(c, agente, 'compactacao', ts, [marca]));
          return;
        }
        if (item['status'] === 'failed' && (tipoItem === 'CommandExecution' || tipoItem === 'McpToolCall' || tipoItem === 'FileChange')) {
          const categoria = tipoItem === 'CommandExecution' ? 'comando' : tipoItem === 'FileChange' ? 'editar' : 'integracao';
          const nome = tipoItem === 'CommandExecution' ? 'exec_command' : tipoItem === 'FileChange' ? 'apply_patch' : 'MCP';
          saida.push(evento(c, agente, 'ferramenta.erro', ts, [marca, 'falhou'], { ferramenta: { nome, categoria, ok: false } }));
        }
        return;
      }
      case 'event_msg:task_complete': {
        if (p['error'] !== undefined && p['error'] !== null) saida.push(evento(c, agente, 'erro', ts, [marca]));
        else saida.push(evento(c, agente, 'turno.fim', ts, [marca]));
        return;
      }
      case 'event_msg:turn_aborted':
        saida.push(evento(c, agente, 'turno.fim', ts, [marca], { turno: { interrompido: true } }));
        return;
      case 'event_msg:token_count': {
        const info = ehObjeto(p['info']) ? p['info'] : undefined;
        const ultimo = info && ehObjeto(info['last_token_usage']) ? info['last_token_usage'] : undefined;
        if (!ultimo) return;
        const entrada = numero(ultimo['input_tokens']) ?? 0;
        const cache = numero(ultimo['cached_input_tokens']) ?? 0;
        const saidaTok = numero(ultimo['output_tokens']) ?? 0;
        if (entrada || saidaTok || cache) {
          saida.push(evento(c, agente, 'uso', ts, [marca, 'uso'], { uso: { entrada: Math.max(0, entrada - cache), saida: saidaTok, cache } }));
        }
        return;
      }
      case 'compacted':
        saida.push(evento(c, agente, 'compactacao', ts, [marca]));
        return;
      default:
        if (SEM_EVENTO.has(chave) || SEM_EVENTO.has(nomeDeTipo(tipoLinha))) somar(cont, 'semEvento');
        else somar(desconhecidos, chave);
    }
  }

  function aoLer(linhas: Linha[], a: ArquivoSeguido): void {
    const saida: EntradaBruta[] = [];
    for (const l of linhas) processarLinha(l, a, saida);
    for (const e of saida) op.emitir(e);
  }

  const seguidor = criarSeguidor({
    raiz: op.pasta,
    incluir: (rel) => REGEX_ROLLOUT.test(rel),
    profundidade: 3,
    catchUpMs: op.catchUpHoras * 3600_000,
    bytesDoFim: op.bytesDoFim ?? 256 * 1024,
    varreduraMs: op.varreduraMs ?? 2_000,
    relogio: op.relogio,
    primeiraLinha: true,
    aoLer,
    aoRemover: (a) => contextos.delete(a.relativo),
    // Rollout parado: as ferramentas pendentes dele não servem mais.
    aoEsfriar: (a) => contextos.get(a.relativo)?.pendentes.clear(),
    ...(op.observar !== undefined ? { observar: op.observar } : {}),
    ...(op.log ? { log: op.log } : {}),
  });

  return {
    id: 'codex-rollout',
    nome: 'Rollouts do Codex',
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
        `${fmt(s.arquivos)} rollouts acompanhados; ${fmt(cont['linhas'] ?? 0)} linhas lidas, ${fmt(cont['eventos'] ?? 0)} eventos gerados.`,
        `Linhas ignoradas: ${fmt(cont['invalidas'] ?? 0)} com JSON inválido, ${fmt(Object.values(desconhecidos).reduce((x, y) => x + y, 0))} de tipo desconhecido, ${fmt(cont['doOmb'] ?? 0)} de bots do OpenMausBot.`,
        `Origens vistas: ${Object.entries(origens).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || 'nenhuma ainda'}. Observador: ${s.observador}.`,
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
