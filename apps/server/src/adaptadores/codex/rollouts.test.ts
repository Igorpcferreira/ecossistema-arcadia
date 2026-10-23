// Testes do adaptador de rollouts do Codex com linhas inventadas no formato observado em 22/10/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArcadiaEvent } from '@arcadia/shared';
import { arquivoDoPatch, criarAdaptadorRollouts } from './rollouts.ts';
import { criarFusao } from '../fusao.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import { relogioFalso } from '../../util/relogio.ts';

const T = Date.UTC(2026, 9, 22, 15, 0, 0);
const iso = (ms: number) => new Date(T + ms).toISOString();
const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const PAI = '0199a1b2-c3d4-7e5f-8a9b-ffffffffffff';
const REL = `2026/10/22/rollout-2026-10-22T12-00-00-${ID}.jsonl`;
const CWD = 'C:\\Users\\fulano\\projetos\\produto-teste';
let ordinal = 0;
const linha = (type: string, payload: Record<string, unknown>, ms: number) => JSON.stringify({ timestamp: iso(ms), ordinal: ordinal++, type, payload });

export const ROLLOUT: string[] = [
  linha('session_meta', { id: ID, session_id: ID, cwd: CWD, originator: 'codex_vscode', source: 'vscode', cli_version: '0.163.0', base_instructions: 'INSTRUCOES-SECRETAS' }, 0),
  linha('turn_context', { turn_id: 't1', cwd: CWD, model: 'x' }, 1),
  linha('event_msg', { type: 'task_started', turn_id: 't1' }, 2),
  linha('event_msg', { type: 'user_message', message: 'PROMPT-SECRETO' }, 3),
  linha('response_item', { type: 'reasoning', summary: [{ text: 'PENSAMENTO-SECRETO' }], encrypted_content: 'x' }, 4),
  linha('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_1', input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-CONTEUDO-SECRETO\n+x\n*** End Patch' }, 5),
  linha('response_item', { type: 'custom_tool_call_output', call_id: 'call_1', output: 'SAIDA-SECRETA' }, 6),
  linha('response_item', { type: 'function_call', name: 'exec_command', call_id: 'call_2', arguments: JSON.stringify({ cmd: 'COMANDO-SECRETO', workdir: CWD }) }, 7),
  linha('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 'outro-id', command: 'COMANDO-SECRETO', status: 'failed', exit_code: 1, aggregated_output: 'SAIDA-SECRETA' } }, 8),
  linha('response_item', { type: 'function_call_output', call_id: 'call_2', output: 'SAIDA-SECRETA' }, 9),
  linha('response_item', { type: 'function_call', name: 'request_user_input_async', call_id: 'call_3', arguments: JSON.stringify({ questions: ['PERGUNTA-SECRETA'] }) }, 10),
  linha('response_item', { type: 'function_call_output', call_id: 'call_3', output: 'RESPOSTA-SECRETA' }, 11),
  linha('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1050 }, total_token_usage: {} } }, 12),
  linha('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'RESPOSTA-SECRETA' }] }, 13),
  linha('event_msg', { type: 'task_complete', turn_id: 't1', last_agent_message: 'RESPOSTA-SECRETA' }, 14),
  linha('event_msg', { type: 'task_started', turn_id: 't2' }, 15),
  linha('event_msg', { type: 'turn_aborted', turn_id: 't2', reason: 'interrupted' }, 16),
  linha('world_state', { full: {}, state: {} }, 17),
  linha('tipo_novo_do_codex', {}, 18),
  linha('event_msg', { type: 'evento_novo' }, 19),
];

function montar(ombConectado = false) {
  const emitidos: EntradaBruta[] = [];
  const fusao = criarFusao();
  if (ombConectado) fusao.definirOmbConectado(true);
  const a = criarAdaptadorRollouts({ pasta: 'C:\\nao-usada', catchUpHoras: 24, relogio: relogioFalso(T), emitir: (e) => emitidos.push(e), fusao, observar: false });
  return { a, emitidos };
}
const evs = (l: EntradaBruta[]) => l.map((e) => e.evento as ArcadiaEvent);

test('arquivo do apply_patch: só o caminho do cabeçalho', () => {
  assert.equal(arquivoDoPatch('*** Begin Patch\n*** Add File: docs/novo.md\n+oi'), 'docs/novo.md');
  assert.equal(arquivoDoPatch('sem cabeçalho'), undefined);
});

test('linhas do rollout viram os eventos certos', () => {
  const { a, emitidos } = montar();
  a.processar(REL, ROLLOUT, { doComeco: true });
  const todos = evs(emitidos);
  assert.deepEqual(todos.map((e) => e.tipo), [
    'sessao.inicio', 'turno.inicio', 'pedido.humano', 'pensando', 'ferramenta.inicio', 'ferramenta.fim', 'ferramenta.inicio',
    'ferramenta.erro', 'ferramenta.fim', 'ferramenta.inicio', 'espera.inicio', 'espera.fim', 'ferramenta.fim', 'uso', 'pensando',
    'turno.fim', 'turno.inicio', 'turno.fim',
  ]);
  assert.ok(todos.every((e) => e.agente.chave === `codex:${ID}` && e.motor === 'codex' && e.origem === 'codex-rollout'));
  assert.deepEqual(todos[4]?.ferramenta, { nome: 'apply_patch', categoria: 'editar', id: 'call_1' });
  assert.deepEqual(emitidos[4]?.caminhos, { arquivo: 'C:\\Users\\fulano\\projetos\\produto-teste\\src\\app.ts' });
  assert.deepEqual(todos[13]?.uso, { entrada: 200, saida: 50, cache: 800 });
  assert.equal(todos.at(-1)?.turno?.interrompido, true);
  const texto = JSON.stringify(todos);
  for (const proibido of ['SECRET', 'fulano', 'Users']) assert.ok(!texto.includes(proibido), proibido);
  const d = a.diagnostico();
  assert.deepEqual(d.desconhecidos, { tipo_novo_do_codex: 1, 'event_msg:evento_novo': 1 });
});

test('subagente do Codex tem pai; rollout de bot do OMB fica com o adaptador do OMB', () => {
  const sub = montar();
  sub.a.processar(`2026/10/22/rollout-2026-10-22T12-00-01-${PAI.replace('ffffffffffff', 'aaaaaaaaaaaa')}.jsonl`, [
    linha('session_meta', { id: PAI.replace('ffffffffffff', 'aaaaaaaaaaaa'), cwd: CWD, originator: 'codex_vscode', parent_thread_id: PAI, agent_nickname: 'Explorador' }, 0),
    linha('event_msg', { type: 'task_started' }, 1),
  ], { doComeco: true });
  const [inicio] = evs(sub.emitidos);
  assert.equal(inicio?.tipo, 'subagente.inicio');
  assert.deepEqual(inicio?.agente, { chave: `codex:${PAI.replace('ffffffffffff', 'aaaaaaaaaaaa')}`, tipo: 'subagente', paiChave: `codex:${PAI}`, nome: 'Explorador' });
  const bot = montar(true);
  bot.a.processar(REL, [linha('session_meta', { id: ID, cwd: CWD, originator: 'openmausbot' }, 0), linha('event_msg', { type: 'task_started' }, 1)], { doComeco: true });
  assert.equal(bot.emitidos.length, 0);
});
