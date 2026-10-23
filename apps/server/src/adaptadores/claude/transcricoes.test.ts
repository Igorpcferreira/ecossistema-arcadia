// Testes do adaptador de transcrições do Claude Code com linhas inventadas no formato observado em 22/10/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ArcadiaEvent } from '@arcadia/shared';
import { criarAdaptadorTranscricoes } from './transcricoes.ts';
import { criarFusao } from '../fusao.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import { relogioFalso } from '../../util/relogio.ts';
import { pastaTemporaria } from '../../testes/apoio.ts';

const T = Date.UTC(2026, 9, 22, 15, 0, 0);
const iso = (ms: number) => new Date(T + ms).toISOString();
const CWD = 'C:\\Users\\fulano\\projetos\\produto-teste';
const comum = { sessionId: 'sess-1', cwd: CWD, entrypoint: 'claude-vscode', gitBranch: 'main', version: '2.1.306', isSidechain: false, userType: 'external' };

export const SESSAO: string[] = [
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: 'sess-1', content: 'PROMPT-SECRETO-1', timestamp: iso(0) }),
  JSON.stringify({ ...comum, type: 'user', uuid: 'u1', timestamp: iso(1), promptId: 'p1', message: { role: 'user', content: 'PROMPT-SECRETO-1 faça o deploy com password=hunter2' } }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a1', timestamp: iso(2), requestId: 'r1', message: { id: 'm1', role: 'assistant', content: [{ type: 'thinking', thinking: 'PENSAMENTO-SECRETO' }], stop_reason: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a2', timestamp: iso(3), requestId: 'r1', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'C:\\Users\\fulano\\projetos\\produto-teste\\src\\app.ts', old_string: 'CONTEUDO-SECRETO', new_string: 'x' }, caller: 'x' }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }),
  JSON.stringify({ ...comum, type: 'user', uuid: 'u2', timestamp: iso(4), toolUseResult: { stdout: 'SAIDA-SECRETA' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'SAIDA-SECRETA' }] } }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a3', timestamp: iso(5), requestId: 'r2', message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'AskUserQuestion', input: { questions: [{ question: 'PERGUNTA-SECRETA' }] } }], stop_reason: 'tool_use' } }),
  JSON.stringify({ ...comum, type: 'user', uuid: 'u3', timestamp: iso(6), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'RESPOSTA-SECRETA' }] } }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a4', timestamp: iso(7), requestId: 'r3', message: { id: 'm3', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'COMANDO-SECRETO rm -rf' } }], stop_reason: 'tool_use' } }),
  JSON.stringify({ ...comum, type: 'user', uuid: 'u4', timestamp: iso(8), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_3', is_error: true, content: 'ERRO-SECRETO' }] } }),
  JSON.stringify({ type: 'ai-title', sessionId: 'sess-1', aiTitle: 'Título automático' }),
  JSON.stringify({ type: 'custom-title', sessionId: 'sess-1', customTitle: 'Título escolhido' }),
  JSON.stringify({ type: 'agent-name', sessionId: 'sess-1', agentName: 'Ajudante' }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a5', timestamp: iso(9), requestId: 'r4', message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'RESPOSTA-FINAL-SECRETA' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } }),
  JSON.stringify({ ...comum, type: 'system', uuid: 's1', timestamp: iso(10), subtype: 'compact_boundary', content: 'RESUMO-SECRETO' }),
  JSON.stringify({ ...comum, type: 'system', uuid: 's2', timestamp: iso(11), subtype: 'api_error', error: 'x' }),
  JSON.stringify({ ...comum, type: 'assistant', uuid: 'a6', timestamp: iso(12), isApiErrorMessage: true, message: { id: 'm5', role: 'assistant', content: [{ type: 'text', text: 'API Error' }] } }),
  JSON.stringify({ type: 'tipo-que-ainda-nao-existe', sessionId: 'sess-1' }),
  'isto não é JSON',
  JSON.stringify({ type: 'attachment', sessionId: 'sess-1', attachment: { content: 'ANEXO-SECRETO' } }),
];

function montar(opcoes: { ombConectado?: boolean } = {}) {
  const emitidos: EntradaBruta[] = [];
  const fusao = criarFusao();
  if (opcoes.ombConectado) fusao.definirOmbConectado(true);
  const a = criarAdaptadorTranscricoes({ pasta: 'C:\\nao-usada', catchUpHoras: 24, relogio: relogioFalso(T), emitir: (e) => emitidos.push(e), fusao, observar: false });
  return { a, emitidos, fusao };
}

const evs = (lista: EntradaBruta[]) => lista.map((e) => e.evento as ArcadiaEvent);

test('linhas da sessão viram os eventos certos, na ordem', () => {
  const { a, emitidos } = montar();
  a.processar('C--proj/sess-1.jsonl', SESSAO, { doComeco: true });
  assert.deepEqual(evs(emitidos).map((e) => e.tipo), [
    'sessao.inicio', 'pedido.humano', 'pensando', 'uso', 'ferramenta.inicio', 'uso', 'ferramenta.fim', 'ferramenta.inicio', 'espera.inicio',
    'espera.fim', 'ferramenta.fim', 'ferramenta.inicio', 'ferramenta.erro', 'pensando', 'turno.fim', 'uso', 'compactacao', 'erro',
  ]);
  const todos = evs(emitidos);
  assert.ok(todos.every((e) => e.agente.chave === 'claude:sess-1' && e.agente.tipo === 'sessao' && e.origem === 'claude-transcricao'));
  const edit = todos.find((e) => e.tipo === 'ferramenta.inicio' && e.ferramenta?.nome === 'Edit');
  assert.deepEqual(edit?.ferramenta, { nome: 'Edit', categoria: 'editar', id: 'toolu_1' });
  const erro = todos.find((e) => e.tipo === 'ferramenta.erro');
  assert.deepEqual(erro?.ferramenta, { nome: 'Bash', categoria: 'comando', id: 'toolu_3', ok: false });
  assert.equal(todos.find((e) => e.tipo === 'espera.inicio')?.espera?.tipo, 'pergunta');
  assert.equal(todos.find((e) => e.tipo === 'pensando' && e.turno?.texto)?.ts, T + 9);
  // Tokens: soma por mensagem, sem repetir a mesma resposta.
  const usos = todos.filter((e) => e.tipo === 'uso').map((e) => e.uso);
  assert.deepEqual(usos, [{ entrada: 10, saida: 5, cache: 100 }, { entrada: 0, saida: 35, cache: 0 }, { entrada: 3, saida: 7, cache: 0 }]);
  // Título e nome escolhidos entram nos eventos seguintes.
  const fim = todos.find((e) => e.tipo === 'turno.fim');
  assert.equal(fim?.tarefa?.titulo, 'Título escolhido');
  assert.equal(fim?.agente.nome, 'Ajudante');
});

test('sala: o primeiro evento e o pedido votam pelo cwd; a ferramenta vota pelo arquivo', () => {
  const { a, emitidos } = montar();
  a.processar('C--proj/sess-1.jsonl', SESSAO, { doComeco: true });
  assert.deepEqual(emitidos[0]?.caminhos, { cwd: CWD });
  assert.deepEqual(emitidos[1]?.caminhos, { cwd: CWD });
  const edit = emitidos.find((e) => (e.evento as ArcadiaEvent).ferramenta?.nome === 'Edit');
  assert.deepEqual(edit?.caminhos, { arquivo: 'C:\\Users\\fulano\\projetos\\produto-teste\\src\\app.ts' });
  assert.equal(emitidos.find((e) => (e.evento as ArcadiaEvent).tipo === 'pensando')?.caminhos, undefined);
});

test('nenhum conteúdo da conversa entra no evento', () => {
  const { a, emitidos } = montar();
  a.processar('C--proj/sess-1.jsonl', SESSAO, { doComeco: true });
  const texto = JSON.stringify(evs(emitidos));
  for (const proibido of ['SECRET', 'hunter2', 'rm -rf', 'fulano', 'API Error', 'Users']) assert.ok(!texto.includes(proibido), proibido);
});

test('formato novo e JSON quebrado são contados, não derrubam nada', () => {
  const { a } = montar();
  a.processar('C--proj/sess-1.jsonl', SESSAO);
  const d = a.diagnostico();
  assert.equal(d.contadores['invalidas'], 1);
  assert.deepEqual(d.desconhecidos, { 'tipo-que-ainda-nao-existe': 1 });
  assert.ok(d.linhas.some((l) => l.includes('tipo-que-ainda-nao-existe 1')));
});

test('ids estáveis: ler de novo dá os mesmos ids (a deduplicação do núcleo descarta)', () => {
  const um = montar();
  um.a.processar('C--proj/sess-1.jsonl', SESSAO);
  const dois = montar();
  dois.a.processar('C--proj/sess-1.jsonl', SESSAO);
  assert.deepEqual(evs(um.emitidos).map((e) => e.id), evs(dois.emitidos).map((e) => e.id));
  assert.equal(new Set(evs(um.emitidos).map((e) => e.id)).size, um.emitidos.length);
});

test('subagente: nasce com pai, termina com subagente.fim', () => {
  const { a, emitidos } = montar();
  const sub = { sessionId: 'sess-1', agentId: 'ab12', isSidechain: true, cwd: CWD, entrypoint: 'claude-vscode' };
  a.processar('C--proj/sess-1/subagents/agent-ab12.jsonl', [
    JSON.stringify({ ...sub, type: 'user', uuid: 's-u1', timestamp: iso(1), message: { role: 'user', content: 'TAREFA-DO-SUBAGENTE' } }),
    JSON.stringify({ ...sub, type: 'assistant', uuid: 's-a1', timestamp: iso(2), message: { id: 'sm1', content: [{ type: 'tool_use', id: 't9', name: 'Read', input: { file_path: 'C:\\x\\y.ts' } }], stop_reason: 'tool_use' } }),
    JSON.stringify({ ...sub, type: 'assistant', uuid: 's-a2', timestamp: iso(3), message: { id: 'sm2', content: [{ type: 'text', text: 'pronto' }], stop_reason: 'end_turn' } }),
  ]);
  const todos = evs(emitidos);
  assert.deepEqual(todos.map((e) => e.tipo), ['subagente.inicio', 'ferramenta.inicio', 'pensando', 'subagente.fim']);
  assert.deepEqual(todos[0]?.agente, { chave: 'claude:sess-1:ab12', tipo: 'subagente', paiChave: 'claude:sess-1' });
  assert.equal(todos[2]?.turno, undefined, 'subagente não usa o timer de 5 s');
});

test('sessão de bot do OpenMausBot fica com o adaptador do OMB', () => {
  const linhaSdk = JSON.stringify({ ...comum, entrypoint: 'sdk-cli', type: 'user', uuid: 'b1', timestamp: iso(1), message: { content: 'x' } });
  const conectado = montar({ ombConectado: true });
  conectado.a.processar('C--proj/sess-1.jsonl', [linhaSdk]);
  assert.equal(conectado.emitidos.length, 0);
  assert.equal(conectado.a.diagnostico().contadores['doOmb'], 1);
  const desligado = montar();
  desligado.a.processar('C--proj/sess-1.jsonl', [linhaSdk]);
  assert.equal(desligado.emitidos.length, 1, 'sem o OMB conectado, a sessão aparece');
  const privada = montar();
  privada.a.processar('C--proj/sess-1.jsonl', [JSON.stringify({ ...comum, cwd: 'C:\\Users\\x\\.openmausbot\\task-workspaces\\b\\t', type: 'user', uuid: 'b2', timestamp: iso(1), message: { content: 'x' } })]);
  assert.equal(privada.emitidos.length, 0, 'pasta privada de tarefa é sempre do OMB');
  const registrada = montar();
  registrada.fusao.registrarSessaoDoOmb('sess-1', 'omb:b1');
  registrada.a.processar('C--proj/sess-1.jsonl', [JSON.stringify({ ...comum, type: 'user', uuid: 'b3', timestamp: iso(1), message: { content: 'x' } })]);
  assert.equal(registrada.emitidos.length, 0, 'sessão anunciada pelo OMB (session.started)');
});

test('sessão sdk-cli (bot por baixo) nunca leva título nem nome, mesmo antes de o OMB conectar', () => {
  const { a, emitidos } = montar();
  a.processar('C--proj/sess-sdk.jsonl', [
    JSON.stringify({ type: 'custom-title', sessionId: 'sess-sdk', customTitle: 'TITULO-DE-BOT' }),
    JSON.stringify({ type: 'agent-name', sessionId: 'sess-sdk', agentName: 'NOME-DE-BOT' }),
    JSON.stringify({ ...comum, sessionId: 'sess-sdk', entrypoint: 'sdk-cli', type: 'user', uuid: 'k1', timestamp: iso(1), message: { content: 'x' } }),
  ], { doComeco: true });
  assert.ok(emitidos.length > 0, 'sem o OMB conectado, a sessão ainda aparece como visitante');
  const texto = JSON.stringify(evs(emitidos));
  assert.ok(!texto.includes('TITULO-DE-BOT') && !texto.includes('NOME-DE-BOT'), texto);
});

test('cwd que muda vai junto no evento seguinte (sala e exclusão); id sem uuid não leva o nome da pasta', () => {
  const { a, emitidos } = montar();
  a.processar('C--Users-fulano-Clientes-Acme/sess-cw.jsonl', [
    JSON.stringify({ ...comum, sessionId: 'sess-cw', type: 'user', uuid: 'c1', timestamp: iso(1), message: { content: 'x' } }),
    JSON.stringify({ ...comum, sessionId: 'sess-cw', cwd: 'C:\\Users\\fulano\\outra', type: 'assistant', timestamp: iso(2), message: { id: 'mc', content: [{ type: 'tool_use', id: 'tc', name: 'Read', input: { file_path: 'C:\\Users\\fulano\\outra\\a.ts' } }], stop_reason: 'tool_use' } }),
  ], { doComeco: true });
  const ferramenta = emitidos.find((e) => (e.evento as ArcadiaEvent).tipo === 'ferramenta.inicio');
  assert.deepEqual(ferramenta?.caminhos, { arquivo: 'C:\\Users\\fulano\\outra\\a.ts', cwd: 'C:\\Users\\fulano\\outra' });
  // Linha sem uuid: o id tem que ser o mesmo se a pasta (o cwd codificado no nome) for outra.
  const outro = montar();
  outro.a.processar('C--Users-fulano-Clientes-Outra/sess-cw.jsonl', [
    JSON.stringify({ ...comum, sessionId: 'sess-cw', type: 'user', uuid: 'c1', timestamp: iso(1), message: { content: 'x' } }),
    JSON.stringify({ ...comum, sessionId: 'sess-cw', cwd: 'C:\\Users\\fulano\\outra', type: 'assistant', timestamp: iso(2), message: { id: 'mc', content: [{ type: 'tool_use', id: 'tc', name: 'Read', input: { file_path: 'C:\\Users\\fulano\\outra\\a.ts' } }], stop_reason: 'tool_use' } }),
  ], { doComeco: true });
  assert.deepEqual(evs(outro.emitidos).map((e) => e.id), evs(emitidos).map((e) => e.id));
});

test('seguidor de verdade: catch-up do fim e linha nova ao vivo', async () => {
  const p = pastaTemporaria();
  try {
    const dir = path.join(p.caminho, 'C--proj');
    fs.mkdirSync(dir, { recursive: true });
    const arq = path.join(dir, 'sess-1.jsonl');
    fs.writeFileSync(arq, SESSAO.slice(0, 3).join('\n') + '\n');
    const relogio = relogioFalso(Date.now());
    const emitidos: EntradaBruta[] = [];
    const a = criarAdaptadorTranscricoes({ pasta: p.caminho, catchUpHoras: 24, relogio, emitir: (e) => emitidos.push(e), fusao: criarFusao(), observar: false });
    await a.iniciar();
    assert.ok(evs(emitidos).some((e) => e.tipo === 'pedido.humano'));
    // Arquivo pequeno é lido inteiro no catch-up: o começo da sessão sai com o horário original (o motor não anima
    // evento velho; teste "evento velho (catch-up)" em motor.test.ts).
    assert.ok(evs(emitidos).filter((e) => e.tipo === 'sessao.inicio').every((e) => e.ts === T + 1));
    const antes = emitidos.length;
    fs.appendFileSync(arq, SESSAO[3] + '\n');
    relogio.avancar(2_000);
    await a.seguidor.varrer();
    assert.ok(evs(emitidos.slice(antes)).some((e) => e.tipo === 'ferramenta.inicio'));
    const novo = path.join(dir, 'sess-2.jsonl');
    fs.writeFileSync(novo, SESSAO[1]?.replaceAll('sess-1', 'sess-2') + '\n');
    relogio.avancar(2_000);
    await a.seguidor.varrer();
    const doNovo = evs(emitidos).filter((e) => e.agente.chave === 'claude:sess-2').map((e) => e.tipo);
    assert.deepEqual(doNovo, ['sessao.inicio', 'pedido.humano'], 'sessão nova chega pelo teletransporte');
    await a.parar();
  } finally {
    p.remover();
  }
});
