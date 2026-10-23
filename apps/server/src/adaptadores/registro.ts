// Cria e liga os adaptadores reais conforme a configuração. O do OpenMausBot sobe primeiro: assim, quando o
// catch-up das transcrições começa, a fusão já sabe se o OMB está conectado (sessões de bot não viram visitante).
import path from 'node:path';
import type { Config } from '../config/esquema.ts';
import { expandir, type AmbienteCaminhos } from '../util/caminhos.ts';
import { descreverErro, type Log } from '../util/log.ts';
import type { Relogio } from '../util/relogio.ts';
import type { Adaptador, DiagnosticoAdaptador, Emissor } from './comum.ts';
import { criarFusao, type Fusao } from './fusao.ts';
import { criarAdaptadorOmb } from './omb/adaptador.ts';
import { criarAdaptadorTranscricoes } from './claude/transcricoes.ts';
import { criarAdaptadorSessoes } from './claude/sessoes.ts';
import { criarAdaptadorRollouts } from './codex/rollouts.ts';

export type Adaptadores = {
  fusao: Fusao;
  lista: Adaptador[];
  iniciar(): Promise<void>;
  parar(): Promise<void>;
  diagnosticos(): Record<string, DiagnosticoAdaptador & { nome: string }>;
};

export type OpcoesAdaptadores = {
  config: Config;
  amb: AmbienteCaminhos;
  relogio: Relogio;
  emitir: Emissor;
  log: Log;
  /** Observador de arquivos (chokidar). Padrão: ligado. */
  observar?: boolean;
  varreduraMs?: number;
};

export function criarAdaptadores(op: OpcoesAdaptadores): Adaptadores {
  const f = op.config.fontes;
  const fusao = criarFusao();
  const pasta = (p: string) => path.resolve(op.amb.cwd, expandir(p, op.amb));
  const comuns = {
    relogio: op.relogio,
    emitir: op.emitir,
    fusao,
    log: op.log,
    ...(op.observar !== undefined ? { observar: op.observar } : {}),
    ...(op.varreduraMs !== undefined ? { varreduraMs: op.varreduraMs } : {}),
  };
  const omb = f.openmausbot.ligado
    ? criarAdaptadorOmb({
        portas: f.openmausbot.portas,
        casa: op.amb.casa,
        qgPorEquipe: f.openmausbot.qgPorEquipe,
        relogio: op.relogio,
        emitir: op.emitir,
        fusao,
        log: op.log,
      })
    : undefined;
  const arquivos: Adaptador[] = [];
  if (f.claudeTranscricoes.ligado) {
    arquivos.push(criarAdaptadorTranscricoes({ ...comuns, pasta: pasta(f.claudeTranscricoes.pasta), catchUpHoras: f.claudeTranscricoes.catchUpHoras }));
  }
  if (f.claudeSessoesVivas.ligado) {
    arquivos.push(criarAdaptadorSessoes({ relogio: op.relogio, emitir: op.emitir, fusao, log: op.log, pasta: pasta(f.claudeSessoesVivas.pasta) }));
  }
  if (f.codexRollouts.ligado) {
    arquivos.push(criarAdaptadorRollouts({ ...comuns, pasta: pasta(f.codexRollouts.pasta), catchUpHoras: f.claudeTranscricoes.catchUpHoras }));
  }
  const lista: Adaptador[] = [...(omb ? [omb] : []), ...arquivos];

  return {
    fusao,
    lista,
    async iniciar() {
      if (omb) {
        try {
          await omb.iniciar();
        } catch (e) {
          op.log.erro('o adaptador do OpenMausBot falhou na partida', { erro: descreverErro(e) });
        }
      }
      for (const a of arquivos) {
        try {
          await a.iniciar();
        } catch (e) {
          op.log.erro('um adaptador falhou na partida', { fonte: a.id, erro: descreverErro(e) });
        }
      }
    },
    async parar() {
      for (const a of lista) {
        try {
          await a.parar();
        } catch {
          // segue desligando os outros
        }
      }
    },
    diagnosticos() {
      const r: Record<string, DiagnosticoAdaptador & { nome: string }> = {};
      for (const a of lista) {
        try {
          r[a.id] = { ...a.diagnostico(), nome: a.nome };
        } catch {
          r[a.id] = { nome: a.nome, estado: 'erro', resumo: 'falhou ao se descrever', linhas: [], contadores: {}, desconhecidos: {} };
        }
      }
      return r;
    },
  };
}
