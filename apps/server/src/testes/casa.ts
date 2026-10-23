// Casa falsa para testes com as fontes reais: ~/.claude/projects, ~/.claude/sessions, ~/.codex/sessions,
// ~/.openmausbot/environment-id e uma pasta de projeto com .git, tudo dentro de uma pasta temporária. O ambiente
// também é falso (casa, LOCALAPPDATA e TEMP lá dentro): nenhum teste lista a pasta real de quem roda.
import fs from 'node:fs';
import path from 'node:path';
import { iniciarServidor, type Servidor } from '../servidor.ts';
import { validarConfig } from '../config/carregar.ts';
import type { AmbienteCaminhos } from '../util/caminhos.ts';
import { criarLog } from '../util/log.ts';
import type { OmbFalso } from './omb-falso.ts';

export type Casa = { raiz: string; projeto: string; projetos: string; transcricoes: string; sessoes: string; codex: string; amb: AmbienteCaminhos };

/** Ambiente inventado com a casa em `casa` e o LOCALAPPDATA em `local` (os dois dentro da pasta do teste). */
export function ambienteFalso(casa: string, local = path.join(casa, 'AppData', 'Local')): AmbienteCaminhos {
  return {
    casa,
    variaveis: { USERPROFILE: casa, LOCALAPPDATA: local, APPDATA: path.join(casa, 'AppData', 'Roaming'), TEMP: path.join(local, 'Temp') },
    windows: process.platform === 'win32',
    cwd: casa,
  };
}

export function montarCasa(raiz: string, environmentId = 'env'): Casa {
  const projetos = path.join(raiz, 'projetos');
  const projeto = path.join(projetos, 'produto-alfa');
  fs.mkdirSync(path.join(projeto, '.git'), { recursive: true });
  const transcricoes = path.join(raiz, '.claude', 'projects');
  const sessoes = path.join(raiz, '.claude', 'sessions');
  const codex = path.join(raiz, '.codex', 'sessions');
  for (const p of [transcricoes, sessoes, codex, path.join(raiz, '.openmausbot')]) fs.mkdirSync(p, { recursive: true });
  // O adaptador do OMB só conecta quando o environment-id do app confere com o deste arquivo.
  fs.writeFileSync(path.join(raiz, '.openmausbot', 'environment-id'), `${environmentId}\n`);
  return { raiz, projeto, projetos, transcricoes, sessoes, codex, amb: ambienteFalso(raiz) };
}

export async function servidorComFontes(casa: Casa, omb: OmbFalso | undefined, logs: string[], dirDados: string, extra: Record<string, unknown> = {}): Promise<Servidor> {
  const barra = (p: string) => p.replace(/\\/g, '/');
  const { config } = validarConfig(
    {
      versao: 1,
      fontes: {
        openmausbot: omb ? { ligado: true, portas: [omb.porta], qgPorEquipe: { 'Equipe Teste': barra(casa.projeto) } } : { ligado: false },
        claudeTranscricoes: { ligado: true, pasta: barra(casa.transcricoes), catchUpHoras: 24 },
        claudeSessoesVivas: { ligado: true, pasta: barra(casa.sessoes) },
        codexRollouts: { ligado: true, pasta: barra(casa.codex) },
      },
      alas: [
        { id: 'produtos', nome: 'Produtos', cor: '#c9a7ff', regras: [`${barra(casa.projetos)}/produto-*/**`] },
        { id: 'bastidores', nome: 'Bastidores', cor: '#6fd3ff', regras: ['~'] },
      ],
      salas: { pastasAgregadoras: [barra(casa.projetos)], excluir: ['**/segredos/**'] },
      ...extra,
    },
    casa.amb,
  );
  return iniciarServidor({
    carregada: { config, arquivo: 'teste.yaml', descricao: 'configuração de teste', origem: 'argumento', avisos: [] },
    amb: casa.amb,
    log: criarLog({ saida: (l) => logs.push(l) }),
    dirDados,
    portas: { ingestao: 0, visualizacao: 0 },
    buildId: 'teste-fontes',
    fontesReais: true,
  });
}
