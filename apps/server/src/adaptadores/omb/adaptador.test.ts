// Testes do adaptador do OpenMausBot contra um OMB falso local, com dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ArcadiaEvent } from '@arcadia/shared';
import { criarAdaptadorOmb } from './adaptador.ts';
import { rotaPermitida } from './cliente.ts';
import { criarFusao } from '../fusao.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import { relogioReal } from '../../util/relogio.ts';
import { pastaTemporaria } from '../../testes/apoio.ts';
import { esperarAte, iniciarOmbFalso } from '../../testes/omb-falso.ts';

const PRIVADA = 'C:\\Users\\fulano\\.openmausbot\\task-workspaces\\bot-a\\th-a';

function bots(activityA = 'idle') {
  return [
    {
      id: 'bot-a', threadId: 'th-a-main', mainThreadId: 'th-a-main', name: 'Coordenação Teste', title: 'Coordenação', color: 'purple',
      section: 'Equipe Teste', activity: activityA, busy: activityA !== 'idle', soul: 'ALMA-SECRETA', description: 'DESCRICAO-SECRETA',
      modelSelection: { instanceId: 'claude', model: 'x' },
      tasks: [{ threadId: 'th-a', cwd: PRIVADA, activity: activityA, title: 'TITULO-DA-TAREFA-SECRETO' }],
    },
    {
      id: 'bot-b', threadId: 'th-b-main', name: 'Código Teste', title: 'Código', color: 'blue', mascotBody: 'blob', section: 'Equipe Teste',
      activity: 'idle', modelSelection: { instanceId: 'codex' },
      tasks: [{ threadId: 'th-b', activity: 'idle', openedBy: { kind: 'work', botId: 'bot-a' } }],
    },
  ];
}

test('OpenMausBot: snapshot, SSE, delegação, fila, retomada e só leitura', async () => {
  const casa = pastaTemporaria();
  fs.mkdirSync(path.join(casa.caminho, '.openmausbot'), { recursive: true });
  fs.writeFileSync(path.join(casa.caminho, '.openmausbot', 'environment-id'), 'env-teste\n');
  const omb = await iniciarOmbFalso({ environmentId: 'env-teste', versao: '0.1.121', bots: bots() });
  const emitidos: EntradaBruta[] = [];
  const fusao = criarFusao();
  const a = criarAdaptadorOmb({
    portas: [1, omb.porta], casa: casa.caminho, qgPorEquipe: { 'Equipe Teste': 'C:\\QG\\projeto' }, relogio: relogioReal(),
    emitir: (e) => emitidos.push(e), fusao,
  });
  const evs = () => emitidos.map((e) => e.evento as ArcadiaEvent);
  const ev = (rt: Record<string, unknown>) => omb.enviar({ kind: 'runtime', event: { eventId: `e-${Math.random()}`, provider: 'claude', createdAt: new Date().toISOString(), ...rt } });
  try {
    await a.iniciar();
    await esperarAte(() => omb.conexoesSse() === 1 && a.conectado());
    assert.equal(fusao.ombConectado(), true);
    // Snapshot: presença e metadados de cada bot; sala pela tarefa ou, se a pasta é privada, pelo QG da equipe.
    const [pa, pb] = evs();
    assert.equal(pa?.tipo, 'presenca');
    assert.deepEqual(pa?.agente, { chave: 'omb:bot-a', tipo: 'bot', corpo: 'cursor', nome: 'Coordenação Teste', cargo: 'Coordenação', cor: 'purple' });
    assert.deepEqual(pa?.local, { equipe: 'Equipe Teste' });
    assert.equal(pa?.presenca?.estado, 'ocioso');
    assert.deepEqual(emitidos[0]?.caminhos, { cwd: 'C:\\QG\\projeto' });
    assert.equal(pb?.agente.corpo, 'blob');
    assert.equal(pb?.motor, 'codex');

    ev({ type: 'session.started', threadId: 'th-a', sessionId: 'sessao-do-claude-9', model: 'x' });
    ev({ type: 'turn.started', threadId: 'th-a', turnId: 't1' });
    ev({ type: 'item.started', threadId: 'th-a', itemId: 'i1', itemType: 'tool', title: 'Edit', input: { file_path: 'C:\\QG\\projeto\\src\\a.ts', old_string: 'CONTEUDO-SECRETO' } });
    ev({ type: 'item.completed', threadId: 'th-a', itemId: 'i1', itemType: 'tool', ok: true, output: 'SAIDA-SECRETA' });
    ev({ type: 'request.opened', threadId: 'th-a', requestId: 'q1', requestType: 'permission', tool: 'Bash', summary: 'RESUMO-SECRETO' });
    ev({ type: 'request.resolved', threadId: 'th-a', requestId: 'q1', behavior: 'allow', source: 'user' });
    ev({ type: 'item.completed', threadId: 'th-a', itemType: 'assistant_text', text: 'TEXTO-SECRETO' });
    ev({ type: 'content.delta', threadId: 'th-a', streamKind: 'assistant_text', delta: 'DELTA-SECRETO' });
    ev({ type: 'turn.completed', threadId: 'th-a', ok: true, usage: { input: 100, output: 20, cachedInput: 5 }, cost: 0.01 });
    await esperarAte(() => evs().some((e) => e.tipo === 'turno.fim'));
    assert.equal(fusao.sessaoDoOmb('sessao-do-claude-9'), 'omb:bot-a');
    const doTurno = evs().filter((e) => e.agente.chave === 'omb:bot-a' && e.tipo !== 'presenca').map((e) => e.tipo);
    assert.deepEqual(doTurno, ['turno.inicio', 'ferramenta.inicio', 'ferramenta.fim', 'espera.inicio', 'espera.fim', 'uso', 'turno.fim']);
    assert.deepEqual(evs().find((e) => e.tipo === 'uso')?.uso, { entrada: 100, saida: 20, cache: 5, custoUsd: 0.01 });
    assert.deepEqual(emitidos.find((e) => (e.evento as ArcadiaEvent).tipo === 'ferramenta.inicio')?.caminhos, { arquivo: 'C:\\QG\\projeto\\src\\a.ts' });
    assert.equal(evs().find((e) => e.tipo === 'espera.inicio')?.espera?.tipo, 'permissao');

    // Delegação: coordinate_bots dispara a leitura da árvore (debounce de 300 ms).
    omb.definirJob('th-a', { nodes: [
      { id: 'n-raiz', rootId: 'n-raiz', botId: 'bot-a', threadId: 'th-a', status: 'running', question: 'PERGUNTA-SECRETA', result: 'RESULTADO-SECRETO' },
      { id: 'n-filho', rootId: 'n-raiz', parentId: 'n-raiz', botId: 'bot-b', threadId: 'th-b', status: 'running', reply: 'RESPOSTA-SECRETA' },
    ] });
    ev({ type: 'item.started', threadId: 'th-a', itemId: 'i2', itemType: 'tool', title: 'mcp__agents__coordinate_bots' });
    await esperarAte(() => evs().some((e) => e.tipo === 'delegacao.recebida'));
    const enviada = evs().find((e) => e.tipo === 'delegacao.enviada');
    assert.deepEqual(enviada?.delegacao, { de: 'omb:bot-a', para: 'omb:bot-b', jobId: 'n-filho', status: 'running' });
    assert.equal(enviada?.agente.chave, 'omb:bot-a');
    omb.definirJob('th-a', { nodes: [
      { id: 'n-raiz', rootId: 'n-raiz', botId: 'bot-a', threadId: 'th-a', status: 'running' },
      { id: 'n-filho', rootId: 'n-raiz', parentId: 'n-raiz', botId: 'bot-b', threadId: 'th-b', status: 'completed', finishedAt: Date.now() },
    ] });
    ev({ type: 'item.completed', threadId: 'th-a', itemId: 'i2', itemType: 'tool', ok: true });
    await esperarAte(() => evs().some((e) => e.tipo === 'delegacao.concluida'));
    assert.equal(evs().find((e) => e.tipo === 'delegacao.concluida')?.agente.chave, 'omb:bot-b');

    // Fila (só contagem; o texto da mensagem nunca é lido) e bot trabalhando pelo quadro "bot".
    omb.enviar({ kind: 'bot.queued', queues: { 'th-b': [{ queueId: 'x', text: 'TEXTO-NA-FILA-SECRETO' }] } });
    await esperarAte(() => evs().some((e) => e.agente.chave === 'omb:bot-b' && e.presenca?.estado === 'na-fila'));
    omb.enviar({ kind: 'bot', bot: bots('working')[0] });
    await esperarAte(() => evs().some((e) => e.agente.chave === 'omb:bot-a' && e.presenca?.estado === 'ativo'));
    omb.enviar({ kind: 'quadro-que-nao-existe', algo: 1 });
    await esperarAte(() => (a.diagnostico().desconhecidos['quadro-que-nao-existe'] ?? 0) === 1);

    // Retomada: o app reinicia (fluxo novo); o adaptador volta com Last-Event-ID e refaz o snapshot (resumed:false).
    const snapshotsAntes = omb.pedidos.filter((p) => p.rota === '/api/bots?messages=0').length;
    omb.reiniciarFluxo();
    omb.derrubarSse();
    await esperarAte(() => omb.pedidos.filter((p) => p.rota === '/api/bots?messages=0').length > snapshotsAntes, 6_000);
    const reconexao = omb.pedidos.filter((p) => p.rota === '/api/events?screens=off').at(-1);
    assert.match(String(reconexao?.cabecalhos['last-event-id']), /^S1:\d+$/);

    // Só leitura: só GET, só rotas permitidas, sem cabeçalhos que tiram a confiança de loopback.
    for (const p of omb.pedidos) {
      assert.equal(p.metodo, 'GET');
      assert.ok(rotaPermitida(p.rota), p.rota);
      for (const c of ['origin', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'x-forwarded-for', 'cookie', 'authorization']) assert.equal(p.cabecalhos[c], undefined, c);
    }
    assert.ok(omb.pedidos.every((p) => !p.rota.startsWith('/api/events') || p.rota === '/api/events?screens=off'));
    const texto = JSON.stringify(evs());
    for (const proibido of ['SECRET', 'fulano', 'task-workspaces']) assert.ok(!texto.includes(proibido), proibido);
    const d = a.diagnostico();
    assert.equal(d.versao, '0.1.121');
    assert.ok(d.linhas.some((l) => l.includes('environment-id confere')));
  } finally {
    await a.parar();
    await omb.fechar();
    casa.remover();
  }
});

function casaComAmbiente(id: string): ReturnType<typeof pastaTemporaria> {
  const casa = pastaTemporaria();
  fs.mkdirSync(path.join(casa.caminho, '.openmausbot'), { recursive: true });
  fs.writeFileSync(path.join(casa.caminho, '.openmausbot', 'environment-id'), `${id}\n`);
  return casa;
}

test('equipe chamada constructor, toString, valueOf ou __proto__ não derruba o adaptador nem o núcleo', async () => {
  const { criarNucleo } = await import('../../nucleo.ts');
  const { validarConfig } = await import('../../config/carregar.ts');
  const { criarLog } = await import('../../util/log.ts');
  const casa = casaComAmbiente('env-proto');
  const amb = { casa: casa.caminho, variaveis: { LOCALAPPDATA: path.join(casa.caminho, 'local') }, windows: process.platform === 'win32', cwd: casa.caminho };
  const { config } = validarConfig({ versao: 1 }, amb);
  const nucleo = criarNucleo({ config, relogio: relogioReal(), amb, buildId: 't', instancia: 't', log: criarLog({ silencioso: true }), fs: { existe: () => false } });
  const privada = (b: string) => path.join(casa.caminho, '.openmausbot', 'task-workspaces', b, 'th');
  const equipes = ['constructor', 'toString', 'valueOf', '__proto__'];
  const bot = (i: number, equipe: string) => ({ id: `bot-p${i}`, threadId: `th-p${i}`, name: `Unidade P${i}`, section: equipe, activity: 'idle', tasks: [{ threadId: `th-p${i}`, cwd: privada(`bot-p${i}`), activity: 'idle' }] });
  const omb = await iniciarOmbFalso({ environmentId: 'env-proto', versao: '0.1.121', bots: equipes.map((e, i) => bot(i, e)) });
  // O que o adaptador manda como caminho: sem QG e com a pasta privada, nada (nunca a função herdada do Object).
  const caminhos: unknown[] = [];
  const emitir = (e: EntradaBruta) => {
    if (e.caminhos !== undefined) caminhos.push(e.caminhos);
    nucleo.ingerir(e);
  };
  const a = criarAdaptadorOmb({ portas: [omb.porta], casa: casa.caminho, qgPorEquipe: {}, relogio: relogioReal(), emitir, fusao: criarFusao() });
  try {
    await a.iniciar();
    await esperarAte(() => a.conectado());
    // Snapshot e quadro "bot" ao vivo, com as quatro equipes.
    for (const [i, e] of equipes.entries()) omb.enviar({ kind: 'bot', bot: { ...bot(i, e), activity: 'working' } });
    await esperarAte(() => equipes.every((_, i) => nucleo.mundo().agentes[`omb:bot-p${i}`]?.estado !== undefined) && Object.keys(nucleo.mundo().agentes).length === 4);
    for (let i = 0; i < equipes.length; i++) assert.equal(nucleo.mundo().agentes[`omb:bot-p${i}`]?.salaChave, undefined, 'sem QG: sem sala, e sem função herdada no lugar do caminho');
    assert.deepEqual(caminhos, [], 'nenhum caminho sai do adaptador (nem a função herdada do Object no lugar do QG)');
    assert.equal(a.diagnostico().contadores['quadrosComFalha'] ?? 0, 0);
  } finally {
    await a.parar();
    await omb.fechar();
    nucleo.parar();
    casa.remover();
  }
});

test('o id da presença não depende da pasta do bot (hash sem sal deixaria conferir um palpite)', async () => {
  const ids: string[] = [];
  for (const pasta of ['C:\\Users\\fulano\\Clientes\\Outro\\portal', 'C:\\Users\\fulano\\Clientes\\Acme Saude\\portal']) {
    const casa = casaComAmbiente('env-id');
    const omb = await iniciarOmbFalso({ environmentId: 'env-id', versao: '0.1.121', bots: [{ id: 'bot-z', threadId: 'th-z', name: 'Unidade Z', section: 'Equipe Z', activity: 'idle', cwd: pasta, tasks: [] }] });
    const emitidos: EntradaBruta[] = [];
    const relogio = { ...relogioReal(), agora: () => 1_792_000_000_000 };
    const a = criarAdaptadorOmb({ portas: [omb.porta], casa: casa.caminho, qgPorEquipe: {}, relogio, emitir: (e) => emitidos.push(e), fusao: criarFusao() });
    try {
      await a.iniciar();
      await esperarAte(() => emitidos.length > 0);
      const ev = emitidos[0]?.evento as ArcadiaEvent;
      assert.equal(ev.tipo, 'presenca');
      ids.push(ev.id);
      assert.deepEqual(emitidos[0]?.caminhos, { cwd: pasta }, 'a pasta só vai em memória, para a sala');
    } finally {
      await a.parar();
      await omb.fechar();
      casa.remover();
    }
  }
  assert.equal(ids[0], ids[1], 'mesma presença, pastas diferentes: mesmo id');
});

test('environment-id que não confere: o adaptador não conecta e o doctor diz', async () => {
  const casa = casaComAmbiente('env-do-app-instalado');
  const omb = await iniciarOmbFalso({ environmentId: 'env-de-outro-programa', versao: '0.1.121', bots: [{ id: 'bot-q', threadId: 'th-q', name: 'Q', activity: 'idle', tasks: [] }] });
  const fusao = criarFusao();
  const emitidos: EntradaBruta[] = [];
  const a = criarAdaptadorOmb({ portas: [omb.porta], casa: casa.caminho, qgPorEquipe: {}, relogio: relogioReal(), emitir: (e) => emitidos.push(e), fusao });
  try {
    await a.iniciar();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(a.conectado(), false);
    assert.equal(fusao.ombConectado(), false);
    assert.equal(emitidos.length, 0);
    assert.deepEqual(omb.pedidos.map((p) => p.rota), ['/.well-known/openmausbot/environment'], 'só a rota pública: nem snapshot nem SSE');
    const d = a.diagnostico();
    assert.equal(d.estado, 'erro');
    assert.match(d.resumo, /recusado/);
    assert.ok(d.linhas.some((l) => l.includes('environment-id não confere')), d.linhas.join(' | '));
  } finally {
    await a.parar();
    await omb.fechar();
    casa.remover();
  }
});

test('activity estranha não vai crua para o doctor; quadro que quebra quem trata não derruba o fluxo', async () => {
  const casa = casaComAmbiente('env-a');
  const omb = await iniciarOmbFalso({ environmentId: 'env-a', versao: '0.1.121', bots: [{ id: 'bot-w', threadId: 'th-w', name: 'W', activity: 'C:\\Users\\fulano\\estranho valor', tasks: [] }] });
  let falhar = false;
  const emitidos: EntradaBruta[] = [];
  const a = criarAdaptadorOmb({
    portas: [omb.porta], casa: casa.caminho, qgPorEquipe: {}, relogio: relogioReal(), fusao: criarFusao(),
    emitir: (e) => {
      if (falhar) throw new Error('defeito inventado');
      emitidos.push(e);
    },
  });
  try {
    await a.iniciar();
    await esperarAte(() => a.conectado() && emitidos.length > 0);
    const texto = a.diagnostico().linhas.join('\n');
    assert.ok(!texto.includes('fulano') && !texto.includes('estranho'), texto);
    assert.match(texto, /\(sem tipo\) 1/);
    // O snapshot do falso acompanha cada quadro: o snapshot que o adaptador pede depois da falha (em 5 s) não traz
    // de volta o estado antigo, mesmo com a máquina carregada e a espera lenta.
    falhar = true;
    omb.definirBots([{ id: 'bot-w', threadId: 'th-w', name: 'W', activity: 'working', tasks: [] }]);
    omb.enviar({ kind: 'bot', bot: { id: 'bot-w', threadId: 'th-w', name: 'W', activity: 'working', tasks: [] } });
    await esperarAte(() => (a.diagnostico().contadores['quadrosComFalha'] ?? 0) === 1);
    falhar = false;
    omb.definirBots([{ id: 'bot-w', threadId: 'th-w', name: 'W', activity: 'idle', tasks: [] }]);
    omb.enviar({ kind: 'bot', bot: { id: 'bot-w', threadId: 'th-w', name: 'W', activity: 'idle', tasks: [] } });
    await esperarAte(() => emitidos.some((e) => (e.evento as ArcadiaEvent).presenca?.estado === 'ocioso' && emitidos.indexOf(e) > 0));
    assert.equal(a.conectado(), true, 'o fluxo seguiu depois do quadro com defeito');
  } finally {
    await a.parar();
    await omb.fechar();
    casa.remover();
  }
});

test('OpenMausBot fechado: o adaptador diz e o mundo segue', async () => {
  const fusao = criarFusao();
  const a = criarAdaptadorOmb({ portas: [1], casa: 'C:\\nada', qgPorEquipe: {}, relogio: relogioReal(), emitir: () => {}, fusao });
  try {
    await a.iniciar();
    const d = a.diagnostico();
    assert.equal(d.estado, 'desligada');
    assert.match(d.linhas[0] ?? '', /Não encontrado \(1: nada ouvindo\)/);
    assert.equal(fusao.ombConectado(), false);
  } finally {
    await a.parar();
  }
});
