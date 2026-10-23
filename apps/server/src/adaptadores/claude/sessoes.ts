// Sessões vivas do Claude Code (~/.claude/sessions/<pid>.json): quem está aberto e se está trabalhando (busy) ou
// parado (idle). Só os arquivos com o número do processo no nome (<pid>.json, o padrão da pasta), e deles só status,
// statusUpdatedAt, startedAt, sessionId, cwd, entrypoint, pid, kind e version. peerToken e messagingSocketPath
// nunca saem da leitura. Os .key (<pid>.<hex>.key) e qualquer outro arquivo nunca são abertos.
import fs from 'node:fs';
import path from 'node:path';
import type { ArcadiaEvent } from '@arcadia/shared';
import { idDeEvento } from '../../util/hash.ts';
import type { Agendamento, Relogio } from '../../util/relogio.ts';
import type { Log } from '../../util/log.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import { ehObjeto, ehPastaPrivadaOmb, fmt, instante, numero, somar, texto, type Adaptador, type DiagnosticoAdaptador, type Emissor } from '../comum.ts';
import type { Fusao } from '../fusao.ts';

/** Os únicos campos que saem da leitura do .json. */
export type SessaoViva = {
  sessionId: string;
  status?: string;
  statusUpdatedAt?: number;
  startedAt?: number;
  cwd?: string;
  entrypoint?: string;
  pid?: number;
  kind?: string;
  version?: string;
};

/** Nome de arquivo de sessão viva: só o número do processo e .json. */
export const REGEX_ARQUIVO_SESSAO = /^\d{1,10}\.json$/;

export function lerSessaoViva(conteudo: string): SessaoViva | undefined {
  let o: unknown;
  try {
    o = JSON.parse(conteudo);
  } catch {
    return undefined;
  }
  if (!ehObjeto(o)) return undefined;
  const sessionId = texto(o['sessionId']);
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/.test(sessionId)) return undefined;
  const s: SessaoViva = { sessionId };
  const campos: [keyof SessaoViva, unknown][] = [
    ['status', texto(o['status'])],
    ['statusUpdatedAt', numero(o['statusUpdatedAt'])],
    ['startedAt', numero(o['startedAt'])],
    ['cwd', texto(o['cwd'])],
    ['entrypoint', texto(o['entrypoint'])],
    ['pid', numero(o['pid'])],
    ['kind', texto(o['kind'])],
    ['version', texto(o['version'])],
  ];
  for (const [k, v] of campos) if (v !== undefined) (s as Record<string, unknown>)[k] = v;
  return s;
}

export type OpcoesSessoes = {
  pasta: string;
  relogio: Relogio;
  emitir: Emissor;
  fusao: Fusao;
  log?: Log;
  intervaloMs?: number;
  /** Confere se o processo ainda existe (sinal 0, não mata nada). Injetável nos testes. */
  processoVivo?: (pid: number) => boolean;
};

export function processoVivoPadrao(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM';
  }
}

type Acompanhada = { arquivo: string; mtimeMs: number; s: SessaoViva };

export function criarAdaptadorSessoes(op: OpcoesSessoes): Adaptador & { varrer(): void } {
  const vivo = op.processoVivo ?? processoVivoPadrao;
  const sessoes = new Map<string, Acompanhada>();
  const cont: Record<string, number> = {};
  let timer: Agendamento | undefined;
  let ultimoEvento: number | undefined;
  let pastaExiste = false;
  let primeira = true;
  let ultimaChecagemPid = 0;

  function emitir(s: SessaoViva, tipo: ArcadiaEvent['tipo'], ts: number, votar: boolean): void {
    const ev: ArcadiaEvent = {
      v: 1,
      id: idDeEvento('claude-transcricao', 'sessao-viva', s.sessionId, tipo, ts),
      ts,
      recebidoEm: ts,
      origem: 'claude-transcricao',
      motor: 'claude',
      agente: { chave: `claude:${s.sessionId}`, tipo: 'sessao' },
      local: {},
      tipo,
    };
    const e: EntradaBruta = votar && s.cwd ? { evento: ev, caminhos: { cwd: s.cwd } } : { evento: ev };
    ultimoEvento = Math.max(ultimoEvento ?? 0, ts);
    somar(cont, 'eventos');
    op.emitir(e);
  }

  function doOmb(s: SessaoViva): boolean {
    return op.fusao.ehDoOmb({ sessionId: s.sessionId, entrypoint: s.entrypoint, pastaPrivada: ehPastaPrivadaOmb(s.cwd) });
  }

  function encerrar(chave: string, a: Acompanhada, motivo: 'removida' | 'processo'): void {
    sessoes.delete(chave);
    somar(cont, motivo === 'removida' ? 'encerradas' : 'processoMorto');
    if (!doOmb(a.s)) emitir(a.s, 'sessao.fim', op.relogio.agora(), false);
  }

  function varrer(): void {
    let nomes: string[];
    try {
      const todos = fs.readdirSync(op.pasta);
      nomes = todos.filter((n) => REGEX_ARQUIVO_SESSAO.test(n));
      cont['foraDoPadrao'] = todos.filter((n) => !REGEX_ARQUIVO_SESSAO.test(n) && !/\.key$/i.test(n)).length;
      pastaExiste = true;
    } catch {
      pastaExiste = false;
      return;
    }
    const agora = op.relogio.agora();
    const vistos = new Set<string>();
    for (const nome of nomes) {
      const arquivo = path.join(op.pasta, nome);
      vistos.add(arquivo);
      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(arquivo).mtimeMs;
      } catch {
        continue;
      }
      const atual = [...sessoes.values()].find((x) => x.arquivo === arquivo);
      if (atual && atual.mtimeMs === mtimeMs) continue;
      let s: SessaoViva | undefined;
      try {
        s = lerSessaoViva(fs.readFileSync(arquivo, 'utf8'));
      } catch {
        s = undefined;
      }
      if (!s) {
        somar(cont, 'ilegiveis');
        continue;
      }
      somar(cont, 'leituras');
      const antes = sessoes.get(s.sessionId);
      sessoes.set(s.sessionId, { arquivo, mtimeMs, s });
      if (doOmb(s)) {
        somar(cont, 'doOmb');
        continue;
      }
      const quando = instante(s.statusUpdatedAt, agora);
      if (!antes) {
        // Sessão que já estava aberta na partida chega sem animação (horário antigo); a nova chega pelo teletransporte.
        emitir(s, 'sessao.inicio', primeira ? instante(s.startedAt, quando) : agora, true);
        if (s.status === 'busy') emitir(s, 'turno.inicio', quando, true);
        continue;
      }
      if (antes.s.status !== 'busy' && s.status === 'busy') emitir(s, 'turno.inicio', quando, true);
      else if (antes.s.status === 'busy' && s.status !== 'busy') emitir(s, 'turno.fim', quando, false);
    }
    for (const [chave, a] of [...sessoes]) if (!vistos.has(a.arquivo)) encerrar(chave, a, 'removida');
    if (agora - ultimaChecagemPid >= 10_000) {
      ultimaChecagemPid = agora;
      for (const [chave, a] of [...sessoes]) if (a.s.pid !== undefined && !vivo(a.s.pid)) encerrar(chave, a, 'processo');
    }
    primeira = false;
  }

  return {
    id: 'claude-sessoes',
    nome: 'Sessões vivas do Claude Code',
    varrer,
    async iniciar() {
      varrer();
      timer = op.relogio.repetir(op.intervaloMs ?? 1_000, varrer);
    },
    async parar() {
      timer?.cancelar();
    },
    diagnostico(): DiagnosticoAdaptador {
      const lista = [...sessoes.values()].filter((a) => !doOmb(a.s));
      const ocupadas = lista.filter((a) => a.s.status === 'busy').length;
      const r: DiagnosticoAdaptador = {
        estado: pastaExiste ? 'ligada' : 'aguardando',
        resumo: pastaExiste ? 'lendo' : 'pasta não encontrada',
        linhas: [
          `${fmt(lista.length)} sessões abertas (${fmt(ocupadas)} trabalhando); só os <pid>.json são lidos, os .key nunca são abertos e ${fmt(cont['foraDoPadrao'] ?? 0)} arquivos fora do padrão ficaram de fora.`,
          `Leituras: ${fmt(cont['leituras'] ?? 0)}; ilegíveis: ${fmt(cont['ilegiveis'] ?? 0)}; encerradas: ${fmt((cont['encerradas'] ?? 0) + (cont['processoMorto'] ?? 0))}.`,
        ],
        contadores: { ...cont, abertas: lista.length, ocupadas },
        desconhecidos: {},
      };
      if (ultimoEvento !== undefined) r.ultimoEvento = ultimoEvento;
      return r;
    },
  };
}
