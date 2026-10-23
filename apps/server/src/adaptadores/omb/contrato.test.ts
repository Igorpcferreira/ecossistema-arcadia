// Teste de contrato contra o OpenMausBot instalado (%LOCALAPPDATA%\Programs\openmausbot\resources\server).
// Só lê o código do app como texto (nada é executado, nada é escrito). Sem o app instalado, o teste se declara pulado.
// Falha quando some algo de que o adaptador depende; avisa (diagnóstico) quando aparece coisa nova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanearEvento } from '@arcadia/shared';
import { VERSAO_CONFERIDA_OMB } from './cliente.ts';

const BASE = process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'openmausbot', 'resources', 'server') : '';
const SH = path.join(BASE, 'shared');
const S = path.join(BASE, 'server');
const instalado = BASE !== '' && fs.existsSync(path.join(SH, 'wire.js')) && fs.existsSync(path.join(S, 'thread-events.js'));

const ler = (arquivo: string) => fs.readFileSync(arquivo, 'utf8');
const lista = (fonte: string, nome: string): string[] => {
  const m = new RegExp(`${nome}\\s*=\\s*\\[([^\\]]*)\\]`).exec(fonte);
  return m ? [...(m[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1] ?? '') : [];
};

/** RuntimeEvent que o adaptador traduz (precisam existir no app) e os que ele conhece e ignora. */
const RUNTIME_USADOS = ['session.started', 'turn.started', 'turn.completed', 'turn.wait_started', 'turn.wait_ended', 'item.started', 'item.completed', 'request.opened', 'request.resolved', 'runtime.error', 'runtime.notice'];
const RUNTIME_IGNORADOS = ['turn.retrying', 'item.updated', 'content.delta', 'thread.token-usage.updated', 'session.exited'];

test('contrato com o OpenMausBot instalado', { skip: instalado ? false : 'OpenMausBot não está instalado nesta máquina' }, (t) => {
  const versao = JSON.parse(ler(path.join(BASE, 'package.json'))).version as string;
  t.diagnostic(`OpenMausBot instalado: ${versao} (conferido no estudo: ${VERSAO_CONFERIDA_OMB})`);

  // Cores e corpos: o saneamento aceita todos; o corpo padrão continua "cursor" (mascotBody ausente vale cursor).
  const cores = lista(ler(path.join(SH, 'wire.js')), 'MAUS_COLOR_NAMES');
  assert.ok(cores.length >= 5, 'lista de cores não encontrada');
  const corpos = lista(ler(path.join(SH, 'mascot-bodies.js')), 'MASCOT_BODY_IDS');
  const sazonais = fs.existsSync(path.join(SH, 'halloween-bodies.js')) ? lista(ler(path.join(SH, 'halloween-bodies.js')), 'HALLOWEEN_BODY_IDS') : [];
  assert.ok(corpos.includes('cursor'));
  assert.match(ler(path.join(SH, 'mascot-bodies.js')), /DEFAULT_MASCOT_BODY\s*=\s*"cursor"/);
  for (const cor of cores) for (const corpo of [...corpos, ...sazonais]) {
    const r = sanearEvento({ v: 1, id: 'c:1', ts: 1, recebidoEm: 1, origem: 'omb', motor: 'claude', agente: { chave: 'omb:x', tipo: 'bot', cor, corpo }, local: {}, tipo: 'turno.inicio' });
    assert.ok(r.ok && r.evento.agente.cor === cor && r.evento.agente.corpo === corpo, `${cor}/${corpo}`);
  }

  // RuntimeEvent: os tipos que o adaptador usa continuam validados pelo app.
  const eventos = [...ler(path.join(S, 'thread-events.js')).matchAll(/case "([a-z][a-z._-]+)":/g)].map((m) => m[1] ?? '');
  for (const tipo of RUNTIME_USADOS) assert.ok(eventos.includes(tipo), `o app não valida mais "${tipo}"`);
  const novos = eventos.filter((e) => !RUNTIME_USADOS.includes(e) && !RUNTIME_IGNORADOS.includes(e));
  if (novos.length) t.diagnostic(`RuntimeEvent novos no app (o adaptador ignora): ${novos.join(', ')}`);
  const fonteEventos = ler(path.join(S, 'thread-events.js'));
  for (const campo of ['eventId', 'threadId', 'createdAt', 'itemType', 'requestType']) assert.ok(fonteEventos.includes(`value.${campo}`), `campo ${campo}`);

  // SSE: id STREAM:seq, hello com resumed, screens=off, Last-Event-ID, e os quadros que o adaptador trata.
  const index = ler(path.join(S, 'index.js'));
  assert.match(index, /id: \$\{STREAM_ID\}:\$\{seq\}/);
  assert.match(index, /kind: "hello"/);
  assert.match(index, /resumed/);
  assert.match(index, /searchParams\.get\("screens"\) !== "off"/);
  assert.match(index, /last-event-id/);
  for (const kind of ['bot', 'runtime', 'bot.queued', 'bot.deleted', 'sections', 'group']) assert.ok(index.includes(`kind: "${kind}"`), `quadro ${kind}`);

  // Árvore de delegação: campos do nó que o adaptador lê.
  const job = ler(path.join(S, 'job-view.js'));
  for (const trecho of ['id: row.id', 'rootId: row.rootId', 'parentId: row.parentId', 'botId: row.assignee.botId', 'status: row.status', 'nodes:']) {
    assert.ok(job.includes(trecho), `nó da árvore: ${trecho}`);
  }
});
