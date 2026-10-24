// Testes do doctor: contagens sem abrir arquivo nenhum de conversa, .key nunca tocado, texto em português.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validarConfig, type ConfigCarregada } from '../config/carregar.ts';
import { coletarFontes, formatarDiagnostico, protegerDiagnostico, protegerTextoDoctor } from './diagnostico.ts';
import { diagnosticoLocal } from '../doctor.ts';
import type { AmbienteCaminhos } from '../util/caminhos.ts';
import { pastaTemporaria } from '../testes/apoio.ts';

function montarCasa(raiz: string): void {
  const escrever = (rel: string, conteudo = '{"conteudo":"inventado"}') => {
    const p = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, conteudo);
  };
  escrever('.claude/projects/C--projeto-a/sessao-1.jsonl');
  escrever('.claude/projects/C--projeto-a/sessao-2.jsonl');
  escrever('.claude/projects/C--projeto-a/sessao-1/subagents/agent-x.jsonl');
  escrever('.claude/projects/C--projeto-a/sessao-1/subagents/agent-x.meta.json');
  escrever('.claude/sessions/111.json');
  escrever('.claude/sessions/222.json');
  escrever('.claude/sessions/111.key', 'chave inventada que nunca pode ser aberta');
  escrever('.codex/sessions/2026/10/22/rollout-2026-10-22T10-00-00-abc.jsonl');
  const velho = path.join(raiz, '.claude/projects/C--projeto-a/sessao-2.jsonl');
  const tresDias = new Date(Date.now() - 3 * 24 * 3600_000);
  fs.utimesSync(velho, tresDias, tresDias);
}

test('fontes: só contagens e datas; transcrição, rollout e .key nunca são abertos', async () => {
  const pasta = pastaTemporaria();
  try {
    montarCasa(pasta.caminho);
    const amb: AmbienteCaminhos = { casa: pasta.caminho, variaveis: { LOCALAPPDATA: path.join(pasta.caminho, 'local') }, windows: process.platform === 'win32', cwd: pasta.caminho };
    const { config } = validarConfig({ versao: 1, servidor: { dados: '%LOCALAPPDATA%/Arcadia/dados' } }, amb);
    const tocados: string[] = [];
    // Espião nas funções síncronas e nas assíncronas (a contagem agora é assíncrona, para não travar o servidor).
    const alvos: [Record<string, (...a: unknown[]) => unknown>, string, string[]][] = [
      [fs as unknown as Record<string, (...a: unknown[]) => unknown>, '', ['readFileSync', 'openSync', 'createReadStream', 'statSync', 'readFile', 'open']],
      [fs.promises as unknown as Record<string, (...a: unknown[]) => unknown>, 'p.', ['readFile', 'open', 'stat', 'readdir']],
    ];
    const originais: [Record<string, (...a: unknown[]) => unknown>, string, (...a: unknown[]) => unknown][] = [];
    for (const [obj, prefixo, nomes] of alvos) {
      for (const nome of nomes) {
        const original = obj[nome] as (...a: unknown[]) => unknown;
        originais.push([obj, nome, original]);
        obj[nome] = (...args: unknown[]) => {
          tocados.push(`${prefixo}${nome}:${String(args[0])}`);
          return original(...args);
        };
      }
    }
    let fontes;
    try {
      fontes = await coletarFontes(config, amb, { agora: Date.now(), semOmb: true });
    } finally {
      for (const [obj, nome, original] of originais) obj[nome] = original;
    }
    assert.deepEqual(tocados.filter((t) => t.endsWith('.key')), [], 'o .key nunca é tocado');
    assert.deepEqual(tocados.filter((t) => /^(?:p\.)?(readFileSync|openSync|createReadStream|readFile|open):/.test(t)), [], 'nada é aberto, só listado');
    assert.ok(tocados.some((t) => t.startsWith('p.stat:')), 'o espião estava ligado');
    assert.ok(!tocados.some((t) => t.startsWith('statSync:')), 'a contagem não usa chamada síncrona');
    const porId = Object.fromEntries(fontes.map((f) => [f.id, f]));
    assert.match(porId['claude-transcricao']?.linhas[0] ?? '', /^2 sessões e 1 subagentes no disco; 2 arquivos mexidos nas últimas 24 h\.$/);
    assert.match(porId['claude-sessoes']?.linhas[0] ?? '', /^2 sessões registradas/);
    assert.match(porId['codex-rollout']?.linhas[0] ?? '', /^1 rollouts no disco; 1 mexidos/);
    assert.equal(porId['omb']?.estado, 'não sondado');
    assert.equal(porId['claude-hook']?.estado, 'desligado');
  } finally {
    pasta.remover();
  }
});

test('doctor local (servidor desligado) explica em português', async () => {
  const pasta = pastaTemporaria();
  try {
    const amb: AmbienteCaminhos = { casa: pasta.caminho, variaveis: { LOCALAPPDATA: path.join(pasta.caminho, 'local') }, windows: process.platform === 'win32', cwd: pasta.caminho };
    const { config, avisos } = validarConfig({ versao: 1, fontes: { openmausbot: { ligado: false } }, servidor: { ingestao: { porta: 1 }, visualizacao: { porta: 2 } } }, amb);
    const carregada: ConfigCarregada = { config, arquivo: 'x.yaml', descricao: 'x.yaml', origem: 'argumento', avisos };
    const d = await diagnosticoLocal(carregada, amb);
    const texto = formatarDiagnostico(d);
    for (const trecho of ['Não está rodando', 'x.yaml (indicada em --config)', 'ainda não existe', 'OpenMausBot: desligado na configuração', 'Transcrições do Claude Code: pasta não encontrada', 'Hooks do Claude Code: desligado']) {
      assert.ok(texto.includes(trecho), `faltou "${trecho}":\n${texto}`);
    }
    assert.match(texto, /Arcadia doctor, \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    assert.ok(!texto.includes(pasta.caminho), 'nenhum caminho completo');
  } finally {
    pasta.remover();
  }
});

test('pasta configurada sai sem o caminho completo; chave desconhecida com caminho não se repete; guarda do doctor', async () => {
  const pasta = pastaTemporaria();
  try {
    const casa = path.join(pasta.caminho, 'fulano.canario');
    const amb: AmbienteCaminhos = { casa, variaveis: { LOCALAPPDATA: path.join(casa, 'AppData', 'Local') }, windows: process.platform === 'win32', cwd: pasta.caminho };
    const barra = (p: string) => p.replace(/\\/g, '/');
    const { config, avisos } = validarConfig(
      {
        versao: 1,
        fontes: { claudeTranscricoes: { pasta: barra(path.join(casa, 'Clientes Canario Saude', '.claude', 'nao-existe')) }, openmausbot: { ligado: false } },
        // A pessoa esqueceu o nível "apelidos:" e escreveu o caminho direto em "salas".
        salas: { [barra(path.join(casa, 'Clientes', 'Acme Canario', 'prontuarios'))]: 'Acme' },
      },
      amb,
    );
    assert.ok(avisos.some((a) => a.includes('1 com nome que não é simples')), avisos.join('; '));
    assert.ok(!avisos.join(' ').includes('Acme Canario'), 'o aviso não repete a chave com caminho');
    const carregada: ConfigCarregada = { config, arquivo: 'x.yaml', descricao: 'x.yaml', origem: 'argumento', avisos };
    const d = protegerDiagnostico(await diagnosticoLocal(carregada, amb), amb);
    const texto = protegerTextoDoctor(formatarDiagnostico(d), amb);
    const json = JSON.stringify(d);
    for (const saida of [texto, json]) {
      assert.ok(!saida.includes(casa) && !saida.includes(barra(casa)) && !saida.includes(casa.replace(/\\/g, '\\\\')), 'nenhum caminho completo');
      assert.ok(!saida.includes('Acme Canario'), 'nada da chave com caminho');
    }
    assert.match(texto, /Pasta configurada: %USERPROFILE%[\\/]Clientes Canario Saude/);
    // A guarda tira a linha inteira quando uma mensagem levar caminho absoluto, pasta de rede ou e-mail.
    const sujo = ['  Fonte X: C:\\Users\\fulano\\Clientes\\a.txt', '  Fonte Y: \\\\servidor\\publico', '  Fonte Z: fulano@exemplo.com', '  Fonte W: tudo certo'].join('\n');
    const limpo = protegerTextoDoctor(sujo, amb).split('\n');
    assert.deepEqual(limpo, ['  [linha omitida pela guarda do doctor]', '  [linha omitida pela guarda do doctor]', '  [linha omitida pela guarda do doctor]', '  Fonte W: tudo certo']);
  } finally {
    pasta.remover();
  }
});

test('doctor em texto: aviso na primeira linha, exceções recentes, salas fora das raízes com a sugestão, marcas e sonda', () => {
  const d: Parameters<typeof formatarDiagnostico>[0] = {
    geradoEm: Date.UTC(2026, 9, 22, 15, 0, 0),
    fuso: 'America/Sao_Paulo',
    servidor: { rodando: true, versaoEsquema: 1, node: '24.5.0', excecoes: 5, excecoesRecentes: 2 },
    configuracao: { descricao: 'configuração de teste', origem: 'argumento', avisos: ['primeira parte\nsegunda parte'] },
    dados: { pasta: 'dados', existe: true },
    portas: [],
    fontes: [],
    privacidade: { marcas: 3, marcasDeTurno: 1, salasForaDasRaizes: 2, sondas: { emVoo: 1, esperando: 0, lentas: 1 } },
  };
  const texto = formatarDiagnostico(d);
  assert.match(texto.split('\n')[0] ?? '', /^Atenção: este relatório mostra nomes de pastas desta máquina\. .*não cole em arquivo do repositório\.$/);
  assert.match(texto, /Exceções não tratadas: 2 nos últimos 10 min, 5 desde a partida\./);
  assert.match(texto, /Salas que nasceram de pasta fora das raízes conhecidas: 2 /);
  assert.match(texto, /crie uma regra de ala \(alas, regras\) ou uma pasta agregadora \(salas, pastasAgregadoras\)/);
  assert.match(texto, /Agentes com marca de pasta excluída: 3, dos quais 1 só no turno atual \(bot\)\./);
  assert.match(texto, /raízes marcadas como lentas 1/);
  assert.match(texto, /Aviso: primeira parte segunda parte/, 'um texto com quebra de linha continua numa linha só');
});

test('doctor em texto: arquivos que não mudaram a sala, por motivo', () => {
  const zero = {
    recebidos: 0, aceitos: 0, recusados: 0, duplicados: 0, camposDescartados: 0, textosMascarados: 0, excluidos: 0, foraDaSala: 0,
    esperaramSala: 0, esperaEstourada: 0, salaDesconhecida: 0, arquivoForaDasRaizes: 0, arquivoEmRascunho: 0, arquivoEmApoio: 0,
    arquivoEmPastaComum: 0, arquivoEmSalaFixa: 0, leituraIsolada: 0, errosDeSala: 0, bloqueadosNaGravacao: 0, bloqueadosNaSaida: 0,
  };
  const texto = formatarDiagnostico({
    geradoEm: Date.UTC(2026, 9, 22, 15, 0, 0),
    fuso: 'America/Sao_Paulo',
    servidor: { rodando: true, versaoEsquema: 1, node: '24.5.0' },
    configuracao: { descricao: 'configuração de teste', origem: 'argumento', avisos: [] },
    dados: { pasta: 'dados', existe: true },
    portas: [],
    fontes: [],
    saneamento: { ...zero, arquivoEmRascunho: 4, arquivoEmApoio: 2, arquivoEmPastaComum: 3, leituraIsolada: 5, arquivoEmSalaFixa: 1 },
  });
  assert.match(texto, /Arquivos que não mudaram a sala do agente: rascunho 4, pasta de apoio ou raiz da agregadora 2, pasta comum sem git 3, leitura isolada 5 .*, sala fixa 1\./);
});
