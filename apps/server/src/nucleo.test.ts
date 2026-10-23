// Testes do núcleo com os achados da revisão de privacidade e segurança do marco 3. Dados e pastas inventados;
// o ambiente é falso (casa e LOCALAPPDATA dentro da pasta do teste) e o disco, quando aparece, é um espião.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ArcadiaEvent } from '@arcadia/shared';
import { criarNucleo, type Nucleo, type OpcoesNucleo } from './nucleo.ts';
import { abrirBanco, type Banco } from './db/banco.ts';
import { validarConfig } from './config/carregar.ts';
import { relogioFalso, type RelogioFalso } from './util/relogio.ts';
import { criarLog } from './util/log.ts';
import { criarAdaptadorTranscricoes } from './adaptadores/claude/transcricoes.ts';
import { criarFusao } from './adaptadores/fusao.ts';
import type { SistemaArquivos } from './mundo/salas.ts';
import type { AmbienteCaminhos } from './util/caminhos.ts';
import { pastaTemporaria } from './testes/apoio.ts';

const T = Date.UTC(2026, 9, 22, 15, 0, 0);
const cc = (...c: number[]) => String.fromCharCode(...c);
const cp = (...c: number[]) => String.fromCodePoint(...c);

const AMB: AmbienteCaminhos = {
  casa: 'C:\\Users\\Joana Canario',
  variaveis: { LOCALAPPDATA: 'C:\\Users\\Joana Canario\\AppData\\Local', USERPROFILE: 'C:\\Users\\Joana Canario' },
  windows: true,
  cwd: 'C:\\',
};

type Montagem = { nucleo: Nucleo; relogio: RelogioFalso; logs: string[]; banco?: Banco };

function montar(
  opcoes: { config?: Record<string, unknown>; fs?: SistemaArquivos; banco?: Banco; relogio?: RelogioFalso; extra?: Partial<OpcoesNucleo> } = {},
): Montagem {
  const { config } = validarConfig({ versao: 1, ...opcoes.config }, AMB);
  const relogio = opcoes.relogio ?? relogioFalso(T);
  const logs: string[] = [];
  const nucleo = criarNucleo({
    config,
    relogio,
    amb: AMB,
    buildId: 'teste',
    instancia: 'teste',
    log: criarLog({ saida: (l) => logs.push(l), agora: () => relogio.agora() }),
    fs: opcoes.fs ?? { existe: () => false },
    ...(opcoes.banco ? { banco: opcoes.banco } : {}),
    ...opcoes.extra,
  });
  return { nucleo, relogio, logs, ...(opcoes.banco ? { banco: opcoes.banco } : {}) };
}

function transcricoes(nucleo: Nucleo, relogio: RelogioFalso) {
  return criarAdaptadorTranscricoes({ pasta: 'C:\\nao-existe', catchUpHoras: 24, relogio, emitir: (e) => nucleo.ingerir(e), fusao: criarFusao(), observar: false });
}

/** Bancos abertos pelo teste: fechados no fim mesmo quando uma verificação falha (no Windows, arquivo aberto não sai). */
const abertos: Banco[] = [];
function abrir(arquivo: string): Banco {
  const b = abrirBanco(arquivo);
  abertos.push(b);
  return b;
}
function fecharBancos(): void {
  for (const b of abertos.splice(0)) {
    try {
      b.fechar();
    } catch {
      // já fechado
    }
  }
}

const iso = (ms: number) => new Date(T + ms).toISOString();
const linha = (o: Record<string, unknown>) => JSON.stringify(o);

test('caminho de rede ou do WSL citado numa ferramenta ou num cwd: nenhuma pergunta ao disco, sala fixa', async () => {
  const perguntas: string[] = [];
  const { nucleo, relogio } = montar({ fs: { existe: (p) => (perguntas.push(p), Promise.resolve(false)) } });
  const ad = transcricoes(nucleo, relogio);
  const remotos = ['\\\\servidor-externo.exemplo\\publico\\leia.txt', '\\\\wsl.localhost\\Ubuntu\\home\\teste\\app\\a.ts', '\\\\wsl$\\Ubuntu\\x.ts', '//servidor/compartilhado/a.txt', '\\\\?\\UNC\\servidor\\x\\a.txt', '\\\\.\\pipe\\cano'];
  ad.processar('C--x/s1.jsonl', [
    linha({ type: 'user', sessionId: 's1', cwd: '\\\\servidor-externo.exemplo\\publico', uuid: 'u1', timestamp: iso(1), entrypoint: 'claude-vscode', message: { content: 'pedido' } }),
    ...remotos.map((p, i) =>
      linha({ type: 'assistant', sessionId: 's1', cwd: '\\\\servidor-externo.exemplo\\publico', uuid: `a${i}`, timestamp: iso(2 + i), message: { id: `m${i}`, content: [{ type: 'tool_use', id: `t${i}`, name: i % 2 ? 'Glob' : 'Read', input: i % 2 ? { path: p } : { file_path: p } }], stop_reason: 'tool_use' } }),
    ),
  ], { doComeco: true });
  await nucleo.ocioso();
  assert.deepEqual(perguntas, [], 'nenhum acesso ao disco por caminho de rede');
  const a = nucleo.mundo().agentes['claude:s1'];
  const sala = a?.salaChave ? nucleo.mundo().salas[a.salaChave] : undefined;
  assert.equal(sala?.nome, 'Pasta de rede');
  assert.ok(!JSON.stringify(nucleo.mundo()).includes('servidor'), 'nenhum pedaço do caminho vira nome');
  nucleo.parar();
});

test('pasta excluída: o agente perde tarefa e nome em todos os eventos, também depois de reiniciar', async () => {
  const p = pastaTemporaria();
  try {
    const arquivo = path.join(p.caminho, 'arcadia.sqlite');
    const config = { privacidade: { mostrarTituloDaTarefa: true }, salas: { excluir: ['**/Pessoal/**', '~/Documentos/Diario'] } };
    let m = montar({ config, banco: abrir(arquivo) });
    const ad = transcricoes(m.nucleo, m.relogio);
    // Sessão aberta numa pasta excluída: título e nome nunca entram.
    ad.processar('C--x/s-ex.jsonl', [
      linha({ type: 'custom-title', sessionId: 's-ex', customTitle: 'CANARIO-TITULO-EXCLUIDO consulta' }),
      linha({ type: 'agent-name', sessionId: 's-ex', agentName: 'CANARIO-NOME-EXCLUIDO' }),
      linha({ type: 'user', sessionId: 's-ex', cwd: 'C:\\Users\\Joana Canario\\Documentos\\Pessoal\\terapia', uuid: 'u1', timestamp: iso(1), entrypoint: 'claude-vscode', message: { content: 'x' } }),
      linha({ type: 'assistant', sessionId: 's-ex', cwd: 'C:\\Users\\Joana Canario\\Documentos\\Pessoal\\terapia', uuid: 'a1', timestamp: iso(2), message: { id: 'm1', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } }),
    ], { doComeco: true });
    // Exclusão escrita sem /**: a subpasta também fica de fora.
    ad.processar('C--y/s-dia.jsonl', [
      linha({ type: 'custom-title', sessionId: 's-dia', customTitle: 'CANARIO-TITULO-DIARIO' }),
      linha({ type: 'user', sessionId: 's-dia', cwd: 'C:\\Users\\Joana Canario\\Documentos\\Diario\\2026', uuid: 'u2', timestamp: iso(3), entrypoint: 'claude-vscode', message: { content: 'x' } }),
    ], { doComeco: true });
    // Sessão normal que lê um arquivo de pasta excluída: perde nome e tarefa daí em diante.
    ad.processar('C--z/s-mix.jsonl', [
      linha({ type: 'custom-title', sessionId: 's-mix', customTitle: 'CANARIO-TITULO-MISTO' }),
      linha({ type: 'agent-name', sessionId: 's-mix', agentName: 'CANARIO-NOME-MISTO' }),
      linha({ type: 'user', sessionId: 's-mix', cwd: 'C:\\Users\\Joana Canario\\projetos\\app', uuid: 'u3', timestamp: iso(4), entrypoint: 'claude-vscode', message: { content: 'x' } }),
    ], { doComeco: true });
    await m.nucleo.ocioso();
    assert.equal(m.nucleo.mundo().agentes['claude:s-mix']?.tarefa, 'CANARIO-TITULO-MISTO', 'antes de tocar na pasta excluída, o título aparece');
    ad.processar('C--z/s-mix.jsonl', [
      linha({ type: 'assistant', sessionId: 's-mix', cwd: 'C:\\Users\\Joana Canario\\projetos\\app', uuid: 'a3', timestamp: iso(5), message: { id: 'm3', content: [{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'C:\\Users\\Joana Canario\\Documentos\\Pessoal\\notas.txt' } }], stop_reason: 'tool_use' } }),
      linha({ type: 'assistant', sessionId: 's-mix', cwd: 'C:\\Users\\Joana Canario\\projetos\\app', uuid: 'a4', timestamp: iso(6), message: { id: 'm4', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } }),
    ]);
    await m.nucleo.ocioso();
    const agentes = m.nucleo.mundo().agentes;
    for (const k of ['claude:s-ex', 'claude:s-dia', 'claude:s-mix']) {
      assert.ok(agentes[k], k);
      assert.equal(agentes[k]?.tarefa, undefined, `${k} sem tarefa`);
      assert.equal(agentes[k]?.nome, undefined, `${k} sem nome`);
    }
    assert.equal(agentes['claude:s-ex']?.salaChave, undefined);
    m.relogio.avancar(1_000);
    m.nucleo.parar();
    m.banco?.fechar();
    // Reinício: a marca vem da tabela de marcas do banco (sem o adaptador mandar o cwd de novo).
    m = montar({ config, banco: abrir(arquivo), relogio: m.relogio });
    m.nucleo.ingerir({ evento: { v: 1, id: 'depois:1', ts: T + 9_000, recebidoEm: T + 9_000, origem: 'claude-transcricao', motor: 'claude', agente: { chave: 'claude:s-mix', tipo: 'sessao', nome: 'CANARIO-NOME-MISTO' }, local: {}, tipo: 'pensando', tarefa: { titulo: 'CANARIO-TITULO-MISTO' } } });
    assert.equal(m.nucleo.mundo().agentes['claude:s-mix']?.tarefa, undefined);
    assert.equal(m.nucleo.mundo().agentes['claude:s-mix']?.nome, undefined);
    m.nucleo.parar();
    m.banco?.fechar();
    const bytes = ['', '-wal', '-shm'].map((s) => (fs.existsSync(arquivo + s) ? fs.readFileSync(arquivo + s).toString('latin1') : '')).join('\n');
    for (const canario of ['CANARIO-TITULO-EXCLUIDO', 'CANARIO-NOME-EXCLUIDO', 'CANARIO-TITULO-DIARIO', 'terapia', 'notas.txt']) {
      assert.ok(!bytes.includes(canario), `o banco guardou ${canario}`);
    }
  } finally {
    fecharBancos();
    p.remover();
  }
});

test('opção de título ou de nome de arquivo desligada depois de gravar: some do mundo e do snapshot novo', () => {
  const p = pastaTemporaria();
  try {
    const arquivo = path.join(p.caminho, 'arcadia.sqlite');
    const ligado = { privacidade: { mostrarTituloDaTarefa: true, mostrarNomeCurtoDoArquivo: true } };
    const desligado = { privacidade: { mostrarTituloDaTarefa: false, mostrarNomeCurtoDoArquivo: false } };
    let m = montar({ config: ligado, banco: abrir(arquivo) });
    const base = { v: 1, origem: 'claude-transcricao', motor: 'claude', agente: { chave: 'claude:s1', tipo: 'sessao' }, local: {} } as const;
    m.nucleo.ingerir({ evento: { ...base, id: 'o:1', ts: T, recebidoEm: T, tipo: 'pedido.humano', tarefa: { titulo: 'Proposta CANARIO-TAREFA' } } });
    m.nucleo.ingerir({ evento: { ...base, id: 'o:2', ts: T + 1, recebidoEm: T + 1, tipo: 'ferramenta.inicio', ferramenta: { nome: 'Read', categoria: 'ler', id: 'tu1' } }, caminhos: { arquivo: 'C:\\Users\\Joana Canario\\proj\\canario-alvo.docx' } });
    m.nucleo.ingerir({ evento: { ...base, id: 'o:3', ts: T + 2, recebidoEm: T + 2, tipo: 'delegacao.enviada', delegacao: { de: 'claude:s1', para: 'claude:s2', jobId: 'j1', titulo: 'Delegar CANARIO-DELEGACAO' } } });
    assert.equal(m.nucleo.mundo().agentes['claude:s1']?.tarefa, 'Proposta CANARIO-TAREFA');
    m.relogio.avancar(1_000);
    m.nucleo.parar();
    m.banco?.fechar();
    m = montar({ config: desligado, banco: abrir(arquivo), relogio: m.relogio });
    const a = m.nucleo.mundo().agentes['claude:s1'];
    assert.equal(a?.tarefa, undefined);
    assert.equal(a?.ferramenta?.alvo, undefined);
    assert.ok(a?.ultimasAcoes.every((x) => x.alvo === undefined), JSON.stringify(a?.ultimasAcoes));
    assert.equal(m.nucleo.mundo().delegacoes['j1']?.titulo, undefined);
    const ultimo = m.banco?.ultimoSnapshot();
    assert.ok(ultimo, 'grava um snapshot limpo já na partida');
    const json = JSON.stringify(ultimo?.estado);
    for (const c of ['CANARIO-TAREFA', 'canario-alvo', 'CANARIO-DELEGACAO']) assert.ok(!json.includes(c), `o snapshot novo ainda tem ${c}`);
    m.nucleo.parar();
    m.banco?.fechar();
  } finally {
    fecharBancos();
    p.remover();
  }
});

test('o banco passa pela guarda: token com seletor invisível no nome e texto sujo gravado direto viram [oculto]', () => {
  const p = pastaTemporaria();
  try {
    const arquivo = path.join(p.caminho, 'arcadia.sqlite');
    const banco = abrir(arquivo);
    const m = montar({ banco });
    const vs16 = cc(0xfe0f);
    m.nucleo.ingerir({ evento: { v: 1, id: 'g:1', ts: T, recebidoEm: T, origem: 'claude-transcricao', motor: 'claude', agente: { chave: 'claude:g1', tipo: 'sessao', nome: `Bot ghp_${vs16}CANARIOabcdefghijklmnopq` }, local: {}, tipo: 'sessao.inicio' } });
    assert.match(m.nucleo.mundo().agentes['claude:g1']?.nome ?? '', /^Bot \[oculto\]$/);
    // Defesa extra: gravação direta no banco (sem passar pelo saneamento) também passa pela guarda.
    const sujo = { v: 1, id: 'g:2', ts: T, recebidoEm: T, origem: 'sim', motor: 'claude', agente: { chave: 'sim:g2', tipo: 'sessao', nome: 'Joana Silva/Clientes/Acme CANARIO-BANCO/contrato.pdf' }, local: {}, tipo: 'sessao.inicio' } as ArcadiaEvent;
    banco.inserirEvento(sujo);
    m.nucleo.gravarSnapshot();
    assert.ok(banco.bloqueados() >= 1);
    m.nucleo.parar();
    banco.fechar();
    const db = new DatabaseSync(arquivo, { readOnly: true });
    const linhas = JSON.stringify(db.prepare('SELECT json FROM eventos').all()) + JSON.stringify(db.prepare('SELECT json FROM snapshots').all());
    db.close();
    const bytes = ['', '-wal', '-shm'].map((s) => (fs.existsSync(arquivo + s) ? fs.readFileSync(arquivo + s).toString('latin1') : '')).join('\n');
    for (const texto of [linhas, bytes]) {
      assert.ok(!texto.includes('CANARIOabcdefghijklmnopq'), 'o token não chega ao banco');
      assert.ok(!texto.includes('CANARIO-BANCO') && !texto.includes('Clientes/Acme'), 'o resto de caminho não chega ao banco');
    }
  } finally {
    fecharBancos();
    p.remover();
  }
});

test('sonda assíncrona: o evento espera o disco, a ordem se mantém e nada trava', { timeout: 20_000 }, async () => {
  let pendentes: (() => void)[] = [];
  const sondas: SistemaArquivos = {
    existe: () =>
      new Promise<boolean>((ok) => {
        pendentes.push(() => ok(false));
      }),
  };
  const { nucleo } = montar({ fs: sondas });
  const base = { v: 1, origem: 'claude-transcricao', motor: 'claude', agente: { chave: 'claude:o1', tipo: 'sessao' }, local: {} } as const;
  const r1 = nucleo.ingerir({ evento: { ...base, id: 'q:1', ts: T, recebidoEm: T, tipo: 'pedido.humano' }, caminhos: { cwd: 'C:\\Users\\Joana Canario\\projetos\\app' } });
  const r2 = nucleo.ingerir({ evento: { ...base, id: 'q:2', ts: T + 1, recebidoEm: T + 1, tipo: 'turno.fim' } });
  assert.deepEqual(r1, { ok: true }, 'ficou na fila');
  assert.deepEqual(r2, { ok: true }, 'atrás do primeiro, mesmo sem caminho');
  assert.equal(nucleo.mundo().agentes['claude:o1'], undefined, 'ainda não entrou');
  assert.equal(nucleo.contadores().esperaramSala, 2);
  // No máximo duas perguntas ao disco por vez: as respostas saem em rodadas, até a fila de sondas acabar.
  for (let i = 0; i < 200 && pendentes.length > 0; i++) {
    const agora = pendentes;
    pendentes = [];
    for (const f of agora) f();
    await new Promise((r) => setImmediate(r));
  }
  await nucleo.ocioso();
  const a = nucleo.mundo().agentes['claude:o1'];
  assert.ok(a, 'entrou');
  // Na ordem certa, o turno.fim fecha o turno aberto pelo pedido e conta a entrega; invertido, seria ignorado.
  assert.equal(a?.entregasHoje, 1, 'turno.fim veio depois do pedido');
  assert.equal(nucleo.mundo().salas[a?.salaChave ?? '']?.nome, 'app');
  nucleo.parar();
});

test('caminho que não é texto, chave reservada e caracteres de etiqueta não derrubam nem passam', () => {
  const { nucleo } = montar();
  const base = { v: 1, origem: 'claude-transcricao', motor: 'claude', local: {} } as const;
  const etiquetas = [...'sk-ant-api03-CANARIO'].map((c) => cp(0xe0000 + c.charCodeAt(0))).join('');
  const r = nucleo.ingerir({ evento: { ...base, id: 'x:1', ts: T, recebidoEm: T, agente: { chave: 'claude:x1', tipo: 'sessao' }, tipo: 'pedido.humano', tarefa: { titulo: `Revisar login${etiquetas}` } }, caminhos: { cwd: 42, arquivo: { trim: 1 } } as unknown as { cwd: string } });
  assert.equal(r.ok, true);
  assert.equal(nucleo.mundo().agentes['claude:x1']?.tarefa, 'Revisar login');
  assert.ok(!/[\u{E0000}-\u{E007F}]/u.test(JSON.stringify(nucleo.mundo())));
  assert.deepEqual(nucleo.ingerir({ evento: { ...base, id: 'x:2', ts: T, recebidoEm: T, agente: { chave: 'constructor', tipo: 'sessao' }, tipo: 'pedido.humano' } }), { ok: false, motivo: 'esquema' });
  assert.equal(Object.hasOwn(nucleo.mundo().agentes, 'constructor'), false);
  nucleo.parar();
});

// Revisão do marco 4: salas fora das raízes conhecidas (A), fila por agente e disco lento (B) e marcas de pasta
// excluída no banco (C). Pastas e nomes inventados; o disco é falso.

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Campos = Record<string, unknown>;
const evento = (id: string, agente: Campos, tipo: string, t: number, extra: Campos = {}) => ({
  v: 1, id, ts: T + t, recebidoEm: T + t, origem: 'claude-transcricao', motor: 'claude', agente, local: {}, tipo, ...extra,
});
const leitura = (id: string, nome = 'Read', categoria = 'ler') => ({ ferramenta: { nome, categoria, id } });
const PROJETO = 'C:\\Users\\Joana Canario\\projetos\\app';
const PESSOAL = 'C:\\Users\\Joana Canario\\Documentos\\Pessoal';

test('fora das raízes conhecidas: arquivo não cria sala; a sessão fica na sala do cwd, que o doctor conta', { timeout: 20_000 }, async () => {
  const p = pastaTemporaria();
  try {
    const banco = abrir(path.join(p.caminho, 'arcadia.sqlite'));
    const perguntas: string[] = [];
    // Só o projeto "site", dentro da pasta pessoal, tem .git.
    const { nucleo, relogio } = montar({ banco, fs: { existe: (x) => (perguntas.push(x), /[\\/]projetos[\\/]site[\\/]\.git$/i.test(x)) } });
    const sessao = { chave: 'claude:fora', tipo: 'sessao' };
    const cwd = 'F:\\trabalho\\app';
    nucleo.ingerir({ evento: evento('fr:1', sessao, 'pedido.humano', 1), caminhos: { cwd } });
    const arquivos = ['F:\\trabalho\\app\\src\\components\\botao.tsx', 'F:\\trabalho\\app\\src\\servicos\\api.ts', 'F:\\outra\\coisa\\x.md'];
    arquivos.forEach((arquivo, i) => nucleo.ingerir({ evento: evento(`fr:${i + 2}`, sessao, 'ferramenta.inicio', i + 2, leitura(`t${i}`)), caminhos: { arquivo, cwd } }));
    // Agente novo cujo primeiro evento é um arquivo de fora: nasce na sala do cwd (e não na pasta do arquivo).
    nucleo.ingerir({ evento: evento('fr:9', { chave: 'claude:fora-2', tipo: 'sessao' }, 'ferramenta.inicio', 9, leitura('t9')), caminhos: { arquivo: 'F:\\trabalho\\app\\docs\\leia.md', cwd } });
    await nucleo.ocioso();
    const m = nucleo.mundo();
    assert.deepEqual(Object.values(m.salas).map((s) => s.nome), ['app'], 'uma sala só: a do cwd');
    const salaApp = m.agentes['claude:fora']?.salaChave;
    assert.equal(m.salas[salaApp ?? '']?.nome, 'app');
    assert.equal(m.agentes['claude:fora-2']?.salaChave, salaApp);
    assert.equal(nucleo.contadores().arquivoForaDasRaizes, 4);
    assert.equal(nucleo.privacidade().salasForaDasRaizes, 1);
    assert.deepEqual(banco.salasFora(), [salaApp], 'gravada no banco (só a chave) para o doctor contar');
    assert.deepEqual(perguntas.filter((x) => x.toLowerCase().startsWith('f:')), [], 'fora das raízes, nenhuma pergunta ao disco');
    // Dentro da pasta pessoal (raiz conhecida), gravação num projeto com git leva o agente para lá (passada a histerese).
    relogio.avancar(25_000);
    nucleo.ingerir({ evento: evento('fr:10', sessao, 'ferramenta.inicio', 25_000, leitura('t10', 'Edit', 'editar')), caminhos: { arquivo: 'C:\\Users\\Joana Canario\\projetos\\site\\src\\a.ts', cwd } });
    await nucleo.ocioso();
    assert.equal(nucleo.mundo().salas[nucleo.mundo().agentes['claude:fora']?.salaChave ?? '']?.nome, 'site');
    nucleo.parar();
  } finally {
    fecharBancos();
    p.remover();
  }
});

test('fila por agente: disco lento num agente não segura os outros; teto de tamanho e de espera', { timeout: 20_000 }, async () => {
  const { nucleo } = montar({ fs: { existe: () => new Promise<boolean>(() => {}) }, extra: { esperaMaxSalaMs: 80, limiteFilaPorAgente: 3, sonda: { tempoMaxMs: 60_000 } } });
  const lento = { chave: 'claude:lento', tipo: 'sessao' };
  const arquivo = `${PROJETO}\\src\\a.ts`;
  assert.deepEqual(nucleo.ingerir({ evento: evento('l:1', lento, 'ferramenta.inicio', 1, leitura('a1')), caminhos: { arquivo } }), { ok: true });
  assert.equal(nucleo.mundo().agentes['claude:lento'], undefined, 'esperando o disco');
  // Outro agente sem caminho (um bot do OMB): entra na hora, sem esperar a fila de ninguém.
  assert.equal(nucleo.ingerir({ evento: { ...evento('b:1', { chave: 'omb:bot-1', tipo: 'bot' }, 'turno.inicio', 2), origem: 'omb' } }).ok, true);
  assert.ok(nucleo.mundo().agentes['omb:bot-1'], 'o bot entrou na hora');
  // Teto de tamanho: com 3 na fila, o mais antigo entra já (com a sala atual do agente: nenhuma), na ordem.
  for (let i = 2; i <= 4; i++) nucleo.ingerir({ evento: evento(`l:${i}`, lento, 'ferramenta.inicio', i + 2, leitura(`a${i}`)), caminhos: { arquivo } });
  assert.equal(nucleo.contadores().esperaEstourada, 1);
  assert.ok(nucleo.mundo().agentes['claude:lento'], 'o mais antigo já entrou');
  // Teto de espera: em 80 ms o resto entra, sem sala inventada, e nada trava.
  const inicio = performance.now();
  await nucleo.ocioso();
  assert.ok(performance.now() - inicio < 2_000, 'a fila não ficou presa no disco');
  assert.equal(nucleo.contadores().esperaEstourada, 4);
  assert.equal(nucleo.contadores().aceitos, 5);
  assert.deepEqual(Object.keys(nucleo.mundo().salas), [], 'nenhuma sala inventada');
  assert.equal(nucleo.mundo().agentes['claude:lento']?.ultimasAcoes.filter((x) => x.tipo === 'ferramenta.inicio').length, 4, 'os quatro entraram');
  nucleo.parar();
});

test('disco lento: sonda que passa do prazo não vira sala errada; quando o disco volta, a sala certa aparece', { timeout: 20_000 }, async () => {
  const fs: SistemaArquivos = {
    existe: (p) => (/[\\/]projetos[\\/]app[\\/]\.git$/i.test(p) ? new Promise<boolean>((ok) => setTimeout(() => ok(true), 150)) : false),
  };
  const { nucleo } = montar({ fs, extra: { sonda: { tempoMaxMs: 40, lentaPorMs: 300 } } });
  const s1 = { chave: 'claude:s1', tipo: 'sessao' };
  const salas = () => Object.values(nucleo.mundo().salas).map((s) => s.nome);
  nucleo.ingerir({ evento: evento('d:1', s1, 'ferramenta.inicio', 1, leitura('d1')), caminhos: { arquivo: `${PROJETO}\\src\\componentes\\botao.ts` } });
  await nucleo.ocioso();
  assert.deepEqual(salas(), [], 'sem resposta no prazo: sem sala (e nunca a pasta "componentes")');
  assert.equal(nucleo.contadores().salaDesconhecida, 1);
  nucleo.ingerir({ evento: evento('d:2', s1, 'ferramenta.inicio', 2, leitura('d2')), caminhos: { arquivo: `${PROJETO}\\src\\servicos\\api.ts` } });
  await nucleo.ocioso();
  assert.deepEqual(salas(), [], 'raiz lenta: sem sonda e sem sala inventada');
  await dormir(400);
  nucleo.ingerir({ evento: evento('d:3', s1, 'ferramenta.inicio', 3, leitura('d3')), caminhos: { arquivo: `${PROJETO}\\src\\outros\\c.ts` } });
  await nucleo.ocioso();
  assert.deepEqual(salas(), ['app'], 'a resposta atrasada (o .git existe) ficou no cache');
  nucleo.parar();
});

test('marca de pasta excluída no banco: a sessão que saiu do mundo volta depois de reiniciar e segue sem nome e sem tarefa', { timeout: 20_000 }, async () => {
  const p = pastaTemporaria();
  try {
    const arquivo = path.join(p.caminho, 'arcadia.sqlite');
    const config = { salas: { excluir: ['**/Pessoal/**'] } };
    let m = montar({ config, banco: abrir(arquivo) });
    m.nucleo.iniciar();
    transcricoes(m.nucleo, m.relogio).processar('C--x/s-mix.jsonl', [
      linha({ type: 'custom-title', sessionId: 's-mix', customTitle: 'Título antes da pasta excluída' }),
      linha({ type: 'user', sessionId: 's-mix', cwd: PROJETO, uuid: 'u1', timestamp: iso(1), entrypoint: 'claude-vscode', message: { content: 'x' } }),
      linha({ type: 'assistant', sessionId: 's-mix', cwd: PROJETO, uuid: 'a1', timestamp: iso(2), message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${PESSOAL}\\notas.txt` } }], stop_reason: 'tool_use' } }),
      linha({ type: 'assistant', sessionId: 's-mix', cwd: PROJETO, uuid: 'a2', timestamp: iso(3), message: { id: 'm2', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' } }),
    ], { doComeco: true });
    await m.nucleo.ocioso();
    assert.equal(m.nucleo.mundo().agentes['claude:s-mix']?.tarefa, undefined);
    m.relogio.avancar(5 * 3600_000);
    assert.equal(m.nucleo.mundo().agentes['claude:s-mix'], undefined, 'parada há horas: saiu do mundo');
    m.nucleo.parar();
    m.banco?.fechar();
    // Reinício: o catch-up só relê o fim do arquivo (a leitura da pasta excluída ficou para trás). A marca vem do banco.
    m = montar({ config, banco: abrir(arquivo), relogio: m.relogio });
    transcricoes(m.nucleo, m.relogio).processar('C--x/s-mix.jsonl', [
      linha({ type: 'custom-title', sessionId: 's-mix', customTitle: 'CANARIO-TITULO-DEPOIS' }),
      linha({ type: 'agent-name', sessionId: 's-mix', agentName: 'CANARIO-NOME-DEPOIS' }),
      linha({ type: 'user', sessionId: 's-mix', cwd: PROJETO, uuid: 'u9', timestamp: iso(5 * 3600_000 + 10), entrypoint: 'claude-vscode', message: { content: 'x' } }),
    ]);
    await m.nucleo.ocioso();
    const a = m.nucleo.mundo().agentes['claude:s-mix'];
    assert.ok(a, 'a sessão voltou');
    assert.deepEqual([a?.tarefa, a?.nome], [undefined, undefined]);
    m.nucleo.parar();
    m.banco?.fechar();
    const db = new DatabaseSync(arquivo, { readOnly: true });
    const marcas = db.prepare('SELECT chave, tipo FROM marcas_privadas').all() as { chave: string; tipo: string }[];
    db.close();
    assert.deepEqual(marcas.map((x) => x.tipo), ['agente']);
    assert.ok(!JSON.stringify(marcas).includes('s-mix'), 'a chave gravada é um hash com sal, não a chave da sessão');
    const bytes = ['', '-wal', '-shm'].map((s) => (fs.existsSync(arquivo + s) ? fs.readFileSync(arquivo + s).toString('latin1') : '')).join('\n');
    for (const c of ['CANARIO-TITULO-DEPOIS', 'CANARIO-NOME-DEPOIS']) assert.ok(!bytes.includes(c), `o banco guardou ${c}`);
  } finally {
    fecharBancos();
    p.remover();
  }
});

test('subagente que mexe em pasta excluída marca de vez também a sessão-mãe', { timeout: 20_000 }, async () => {
  const { nucleo } = montar({ config: { salas: { excluir: ['**/Pessoal/**'] } } });
  const mae = { chave: 'claude:mae', tipo: 'sessao', nome: 'CANARIO-NOME-MAE' };
  const sub = { chave: 'claude:mae:sub-1', tipo: 'subagente', paiChave: 'claude:mae' };
  nucleo.ingerir({ evento: evento('sm:1', mae, 'pedido.humano', 1, { tarefa: { titulo: 'CANARIO-TAREFA-MAE' } }), caminhos: { cwd: PROJETO } });
  nucleo.ingerir({ evento: evento('sm:2', sub, 'subagente.inicio', 2), caminhos: { cwd: PROJETO } });
  assert.equal(nucleo.mundo().agentes['claude:mae']?.tarefa, 'CANARIO-TAREFA-MAE');
  nucleo.ingerir({ evento: evento('sm:3', sub, 'ferramenta.inicio', 3, leitura('s3')), caminhos: { arquivo: `${PESSOAL}\\diario.txt`, cwd: PROJETO } });
  nucleo.ingerir({ evento: evento('sm:4', mae, 'pedido.humano', 4, { tarefa: { titulo: 'CANARIO-TAREFA-MAE-2' } }), caminhos: { cwd: PROJETO } });
  await nucleo.ocioso();
  const m = nucleo.mundo();
  assert.deepEqual([m.agentes['claude:mae']?.tarefa, m.agentes['claude:mae']?.nome], [undefined, undefined], 'a mãe perdeu nome e tarefa, também no evento seguinte');
  assert.ok(!JSON.stringify(m).includes('CANARIO'), 'nada da mãe nem do subagente no mundo');
  assert.equal(nucleo.privacidade().marcas, 2, 'subagente e mãe marcados');
  nucleo.parar();
});

test('bot: a marca vale só no turno em que mexeu na pasta excluída (e no turno de quem delegou); o nome fica, e vale depois de reiniciar', { timeout: 20_000 }, async () => {
  const p = pastaTemporaria();
  try {
    const arquivo = path.join(p.caminho, 'arcadia.sqlite');
    const config = { privacidade: { mostrarTituloDaTarefa: true, mostrarNomeCurtoDoArquivo: true }, salas: { excluir: ['**/Pessoal/**'] } };
    let m = montar({ config, banco: abrir(arquivo) });
    const coord = { chave: 'omb:coord', tipo: 'bot', nome: 'Coordenação' };
    const bot = { chave: 'omb:bot-1', tipo: 'bot', nome: 'Unidade Teste' };
    const omb = (id: string, agente: Campos, tipo: string, t: number, extra: Campos = {}) => ({ ...evento(id, agente, tipo, t, extra), origem: 'omb' });
    const delegacao = { de: 'omb:coord', para: 'omb:bot-1', jobId: 'job-1', titulo: 'Tarefa delegada' };
    m.nucleo.ingerir({ evento: omb('o:1', coord, 'turno.inicio', 1, { tarefa: { titulo: 'Tarefa da coordenação' } }), caminhos: { cwd: PROJETO } });
    m.nucleo.ingerir({ evento: omb('o:2', coord, 'delegacao.enviada', 2, { delegacao }) });
    m.nucleo.ingerir({ evento: omb('o:3', bot, 'delegacao.recebida', 3, { delegacao, tarefa: { titulo: 'Tarefa delegada' } }), caminhos: { cwd: PROJETO } });
    m.nucleo.ingerir({ evento: omb('o:4', bot, 'ferramenta.inicio', 4, leitura('b1')), caminhos: { arquivo: `${PROJETO}\\leia-antes.md` } });
    await m.nucleo.ocioso();
    assert.equal(m.nucleo.mundo().agentes['omb:bot-1']?.tarefa, 'Tarefa delegada', 'antes da pasta excluída, a tarefa aparece');
    // O bot mexe na pasta excluída e depois num arquivo comum, no mesmo turno.
    m.nucleo.ingerir({ evento: omb('o:5', bot, 'ferramenta.inicio', 5, leitura('b2')), caminhos: { arquivo: `${PESSOAL}\\terapia.txt` } });
    m.nucleo.ingerir({ evento: omb('o:6', bot, 'ferramenta.inicio', 6, leitura('b3', 'Write', 'editar')), caminhos: { arquivo: `${PROJETO}\\resumo-canario.md` } });
    m.nucleo.ingerir({ evento: omb('o:7', coord, 'pensando', 7, { tarefa: { titulo: 'CANARIO-TAREFA-COORD' } }) });
    await m.nucleo.ocioso();
    const conferirMarcado = (mundo: ReturnType<Nucleo['mundo']>) => {
      const b = mundo.agentes['omb:bot-1'];
      assert.equal(b?.nome, 'Unidade Teste', 'o nome do bot fica');
      assert.equal(b?.tarefa, undefined);
      const texto = JSON.stringify(b);
      for (const x of ['leia-antes', 'resumo', 'terapia']) assert.ok(!texto.includes(x), `nome de arquivo no turno marcado: ${x}`);
      assert.equal(mundo.agentes['omb:coord']?.nome, 'Coordenação');
      assert.equal(mundo.agentes['omb:coord']?.tarefa, undefined, 'o turno de quem delegou também');
      assert.equal(mundo.delegacoes['job-1']?.titulo, undefined, 'a delegação perde o título');
    };
    conferirMarcado(m.nucleo.mundo());
    assert.deepEqual(m.nucleo.privacidade(), { marcas: 2, marcasDeTurno: 2, salasForaDasRaizes: 0 });
    // Reinício no meio do turno: a marca vem do banco antes do primeiro evento.
    m.relogio.avancar(1_000);
    m.nucleo.parar();
    m.banco?.fechar();
    m = montar({ config, banco: abrir(arquivo), relogio: m.relogio });
    m.nucleo.ingerir({ evento: omb('o:7b', bot, 'ferramenta.inicio', 1_100, leitura('b3b', 'Write', 'editar')), caminhos: { arquivo: `${PROJETO}\\resumo-canario-2.md` } });
    m.nucleo.ingerir({ evento: omb('o:7c', coord, 'pensando', 1_101, { tarefa: { titulo: 'CANARIO-TAREFA-COORD-2' } }) });
    await m.nucleo.ocioso();
    conferirMarcado(m.nucleo.mundo());
    // Turno novo: a marca cai e tarefa e nome de arquivo voltam a aparecer.
    m.nucleo.ingerir({ evento: omb('o:8', bot, 'turno.inicio', 30_000, { tarefa: { titulo: 'Tarefa nova do bot' } }) });
    m.nucleo.ingerir({ evento: omb('o:9', bot, 'ferramenta.inicio', 30_001, leitura('b4')), caminhos: { arquivo: `${PROJETO}\\guia.md` } });
    m.nucleo.ingerir({ evento: omb('o:10', coord, 'turno.inicio', 30_002, { tarefa: { titulo: 'Tarefa nova da coordenação' } }) });
    await m.nucleo.ocioso();
    const mundo = m.nucleo.mundo();
    assert.equal(mundo.agentes['omb:bot-1']?.tarefa, 'Tarefa nova do bot');
    assert.ok(mundo.agentes['omb:bot-1']?.ultimasAcoes.some((x) => x.alvo === 'guia.md'), 'o nome de arquivo volta no turno novo');
    assert.equal(mundo.agentes['omb:coord']?.tarefa, 'Tarefa nova da coordenação');
    assert.equal(m.nucleo.privacidade().marcas, 0);
    m.nucleo.parar();
    m.banco?.fechar();
    const db = new DatabaseSync(arquivo, { readOnly: true });
    const restantes = (db.prepare('SELECT count(*) AS n FROM marcas_privadas').get() as { n: number }).n;
    const eventos = JSON.stringify(db.prepare('SELECT json FROM eventos').all());
    db.close();
    assert.equal(restantes, 0, 'a marca de turno saiu do banco');
    for (const c of ['CANARIO-TAREFA-COORD', 'resumo-canario', 'terapia']) assert.ok(!eventos.includes(c), `o banco guardou ${c}`);
  } finally {
    fecharBancos();
    p.remover();
  }
});

// Regras de sala do marco 5: evento sem caminho não mexe na sala, arquivo só leva para sala de projeto, pasta de apoio,
// rascunho, pasta comum e leitura isolada contra três seguidas. Pastas inventadas; o disco é falso (só os .git abaixo).
const CASA = 'C:\\Users\\Joana Canario';
const PROJETOS = `${CASA}\\projetos`;
const TEMP = `${CASA}\\AppData\\Local\\Temp`;
const CONFIG_SALAS = { salas: { pastasAgregadoras: ['~/projetos', '~/AppData/Local/Temp'], rascunho: ['~/AppData/Local/Temp'] } };
const COM_GIT: SistemaArquivos = { existe: (p) => /[\\/]projetos[\\/]produto-(?:alfa|beta|gama)[\\/]\.git$/i.test(p) };
const gravacao = (id: string) => leitura(id, 'Edit', 'editar');
const nomeDaSala = (nucleo: Nucleo, k: string) => nucleo.mundo().salas[nucleo.mundo().agentes[k]?.salaChave ?? '']?.nome;
const nomesDasSalas = (nucleo: Nucleo) => Object.values(nucleo.mundo().salas).map((s) => s.nome).sort();

test('evento sem caminho e cwd repetido não devolvem o agente para a sala do cwd; cwd novo muda a sala', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: CONFIG_SALAS, fs: COM_GIT });
  const s = { chave: 'claude:vai-e-volta', tipo: 'sessao' };
  const cwdAlfa = `${PROJETOS}\\produto-alfa`;
  nucleo.ingerir({ evento: evento('v:1', s, 'turno.inicio', 1), caminhos: { cwd: cwdAlfa } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:vai-e-volta'), 'produto-alfa', 'agente sem sala: o cwd decide');
  relogio.avancar(25_000);
  nucleo.ingerir({ evento: evento('v:2', s, 'ferramenta.inicio', 25_000, gravacao('g1')), caminhos: { arquivo: `${PROJETOS}\\produto-beta\\src\\a.ts`, cwd: cwdAlfa } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:vai-e-volta'), 'produto-beta', 'gravação em outro projeto leva na hora');
  relogio.avancar(25_000);
  // Turno novo com o mesmo cwd (o adaptador manda o cwd em todo começo de turno) e evento sem caminho nenhum.
  nucleo.ingerir({ evento: evento('v:3', s, 'turno.inicio', 50_000), caminhos: { cwd: cwdAlfa } });
  nucleo.ingerir({ evento: evento('v:4', s, 'pensando', 50_001) });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:vai-e-volta'), 'produto-beta', 'sem caminho, ou com o mesmo cwd, o agente fica onde está');
  relogio.avancar(25_000);
  nucleo.ingerir({ evento: evento('v:5', s, 'turno.inicio', 75_000), caminhos: { cwd: `${PROJETOS}\\produto-gama\\src` } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:vai-e-volta'), 'produto-gama', 'o cwd mudou de sala: ele decide de novo');
  nucleo.parar();
});

test('pasta de apoio na raiz da agregadora não vira sala: arquivo ali conta para a agregadora e não move o agente', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: CONFIG_SALAS, fs: COM_GIT });
  const s = { chave: 'claude:apoio', tipo: 'sessao' };
  nucleo.ingerir({ evento: evento('a:1', s, 'turno.inicio', 1), caminhos: { cwd: `${PROJETOS}\\produto-alfa` } });
  relogio.avancar(25_000);
  nucleo.ingerir({ evento: evento('a:2', s, 'ferramenta.inicio', 25_000, gravacao('g1')), caminhos: { arquivo: `${PROJETOS}\\docs\\guia.md` } });
  nucleo.ingerir({ evento: evento('a:3', s, 'ferramenta.inicio', 25_001, gravacao('g2')), caminhos: { arquivo: `${PROJETOS}\\tmp\\saida.txt` } });
  await nucleo.ocioso();
  assert.deepEqual(nomesDasSalas(nucleo), ['produto-alfa'], 'nem "docs" nem "tmp" viraram sala');
  assert.equal(nomeDaSala(nucleo, 'claude:apoio'), 'produto-alfa');
  assert.equal(nucleo.contadores().arquivoEmApoio, 2);
  // Sessão aberta numa pasta de apoio: a sala é a da própria agregadora.
  nucleo.ingerir({ evento: evento('a:4', { chave: 'claude:na-raiz', tipo: 'sessao' }, 'turno.inicio', 25_002), caminhos: { cwd: `${PROJETOS}\\docs` } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:na-raiz'), 'projetos');
  nucleo.parar();
});

test('rascunho: arquivo ali nunca cria sala nem move o agente; o cwd ali continua criando sala', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: CONFIG_SALAS, fs: COM_GIT });
  const s = { chave: 'claude:rascunho', tipo: 'sessao' };
  nucleo.ingerir({ evento: evento('r:1', s, 'turno.inicio', 1), caminhos: { cwd: `${PROJETOS}\\produto-alfa` } });
  relogio.avancar(25_000);
  for (let i = 0; i < 4; i++) {
    nucleo.ingerir({ evento: evento(`r:${i + 2}`, s, 'ferramenta.inicio', 25_000 + i, i % 2 ? leitura(`l${i}`) : gravacao(`g${i}`)), caminhos: { arquivo: `${TEMP}\\claude\\sessao-x\\script-${i}.py` } });
  }
  await nucleo.ocioso();
  assert.deepEqual(nomesDasSalas(nucleo), ['produto-alfa'], 'nenhuma sala para a pasta de rascunho da sessão');
  assert.equal(nomeDaSala(nucleo, 'claude:rascunho'), 'produto-alfa');
  assert.equal(nucleo.contadores().arquivoEmRascunho, 4);
  nucleo.ingerir({ evento: evento('r:9', { chave: 'claude:no-temp', tipo: 'sessao' }, 'turno.inicio', 25_010), caminhos: { cwd: `${TEMP}\\claude\\sessao-x` } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:no-temp'), 'claude', 'cwd no rascunho: sala pela regra de sempre (aqui, filha da agregadora)');
  nucleo.parar();
});

test('pasta comum sem git: arquivo não cria sala, nem dentro das raízes conhecidas; só o cwd faz dela uma sala', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: CONFIG_SALAS, fs: COM_GIT });
  const s = { chave: 'claude:comum', tipo: 'sessao' };
  nucleo.ingerir({ evento: evento('c:1', s, 'turno.inicio', 1), caminhos: { cwd: `${PROJETOS}\\produto-alfa` } });
  relogio.avancar(25_000);
  nucleo.ingerir({ evento: evento('c:2', s, 'ferramenta.inicio', 25_000, gravacao('g1')), caminhos: { arquivo: `${CASA}\\Documentos\\planilhas\\orcamento.csv` } });
  nucleo.ingerir({ evento: evento('c:3', s, 'ferramenta.inicio', 25_001, gravacao('g2')), caminhos: { arquivo: `${CASA}\\notas.txt` } });
  await nucleo.ocioso();
  assert.deepEqual(nomesDasSalas(nucleo), ['produto-alfa']);
  assert.equal(nomeDaSala(nucleo, 'claude:comum'), 'produto-alfa');
  assert.equal(nucleo.contadores().arquivoEmPastaComum, 2);
  nucleo.ingerir({ evento: evento('c:4', { chave: 'claude:planilhas', tipo: 'sessao' }, 'turno.inicio', 25_002), caminhos: { cwd: `${CASA}\\Documentos\\planilhas` } });
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:planilhas'), 'planilhas', 'sessão aberta na pasta comum: a pasta vira sala');
  nucleo.parar();
});

test('leitura isolada em outro projeto não move o agente; três seguidas na mesma outra sala movem', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: CONFIG_SALAS, fs: COM_GIT });
  const s = { chave: 'claude:leitor', tipo: 'sessao' };
  const em = (projeto: string, arquivo: string) => `${PROJETOS}\\${projeto}\\src\\${arquivo}`;
  nucleo.ingerir({ evento: evento('l:1', s, 'turno.inicio', 1), caminhos: { cwd: `${PROJETOS}\\produto-alfa` } });
  relogio.avancar(25_000);
  const ler = (id: string, projeto: string, ferramenta = leitura(id)) => nucleo.ingerir({ evento: evento(id, s, 'ferramenta.inicio', 25_000, ferramenta), caminhos: { arquivo: em(projeto, `${id}.ts`) } });
  // Duas leituras no beta, uma de volta no alfa (zera a sequência), mais duas no beta: o agente não sai do alfa.
  ler('l2', 'produto-beta');
  ler('l3', 'produto-beta', leitura('l3', 'Grep', 'ler'));
  ler('l4', 'produto-alfa');
  ler('l5', 'produto-beta');
  ler('l6', 'produto-beta');
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:leitor'), 'produto-alfa', 'leituras isoladas não levam o agente');
  assert.equal(nucleo.contadores().leituraIsolada, 4);
  // A terceira seguida no beta leva o agente para lá.
  ler('l7', 'produto-beta');
  await nucleo.ocioso();
  assert.equal(nomeDaSala(nucleo, 'claude:leitor'), 'produto-beta', 'três leituras seguidas na mesma outra sala');
  nucleo.parar();
});

test('arquivo de sala fixa (pastas dos agentes) não move o agente nem mostra o nome curto', { timeout: 20_000 }, async () => {
  const { nucleo, relogio } = montar({ config: { ...CONFIG_SALAS, privacidade: { mostrarNomeCurtoDoArquivo: true } }, fs: COM_GIT });
  const s = { chave: 'claude:fixa', tipo: 'sessao' };
  nucleo.ingerir({ evento: evento('f:1', s, 'turno.inicio', 1), caminhos: { cwd: `${PROJETOS}\\produto-alfa` } });
  relogio.avancar(25_000);
  for (let i = 0; i < 3; i++) nucleo.ingerir({ evento: evento(`f:${i + 2}`, s, 'ferramenta.inicio', 25_000 + i, gravacao(`g${i}`)), caminhos: { arquivo: `${CASA}\\.claude\\projects\\C--x\\sessao-${i}.jsonl` } });
  await nucleo.ocioso();
  assert.deepEqual(nomesDasSalas(nucleo), ['produto-alfa']);
  assert.equal(nucleo.contadores().arquivoEmSalaFixa, 3);
  assert.ok(!JSON.stringify(nucleo.mundo().agentes['claude:fixa']).includes('sessao-'), 'sem nome curto de arquivo de sala fixa');
  nucleo.parar();
});
