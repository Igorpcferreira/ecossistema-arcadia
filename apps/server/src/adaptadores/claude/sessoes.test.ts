// Testes das sessões vivas do Claude Code: só .json, só os campos permitidos, transições de busy e idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ArcadiaEvent } from '@arcadia/shared';
import { criarAdaptadorSessoes, lerSessaoViva } from './sessoes.ts';
import { criarFusao } from '../fusao.ts';
import type { EntradaBruta } from '../../nucleo.ts';
import { relogioFalso } from '../../util/relogio.ts';
import { pastaTemporaria } from '../../testes/apoio.ts';

const T = Date.UTC(2026, 9, 22, 15, 0, 0);

function sessao(id: string, status: 'busy' | 'idle', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 4242, sessionId: id, cwd: 'C:\\Users\\fulano\\proj', startedAt: T - 60_000, version: '2.1.306', peerProtocol: 1,
    kind: 'interactive', entrypoint: 'claude-vscode', name: 'NOME-DA-SESSAO', status, statusUpdatedAt: T,
    peerToken: 'TOKEN-QUE-NUNCA-SAI', messagingSocketPath: '\\\\.\\pipe\\SOCKET-SECRETO', bridgeSessionId: 'b', ...extra,
  });
}

test('lerSessaoViva guarda só os campos permitidos', () => {
  const s = lerSessaoViva(sessao('s1', 'busy'));
  assert.deepEqual(Object.keys(s ?? {}).sort(), ['cwd', 'entrypoint', 'kind', 'pid', 'sessionId', 'startedAt', 'status', 'statusUpdatedAt', 'version']);
  assert.ok(!JSON.stringify(s).includes('TOKEN') && !JSON.stringify(s).includes('SOCKET') && !JSON.stringify(s).includes('NOME-DA'));
  assert.equal(lerSessaoViva('{quebrado'), undefined);
  assert.equal(lerSessaoViva(JSON.stringify({ sessionId: 'C:/caminho' })), undefined);
});

test('presença, turno pelo status, fim por arquivo removido ou processo morto; .key nunca é aberto', () => {
  const p = pastaTemporaria();
  const abertos: string[] = [];
  const mutavel = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originais = { readFileSync: mutavel['readFileSync'], openSync: mutavel['openSync'], statSync: mutavel['statSync'] } as Record<string, (...a: unknown[]) => unknown>;
  for (const nome of Object.keys(originais)) {
    mutavel[nome] = (...args: unknown[]) => {
      abertos.push(String(args[0]));
      return (originais[nome] as (...a: unknown[]) => unknown)(...args);
    };
  }
  try {
    fs.writeFileSync(path.join(p.caminho, '111.json'), sessao('s-a', 'busy'));
    fs.writeFileSync(path.join(p.caminho, '222.json'), sessao('s-b', 'idle', { pid: 5151 }));
    fs.writeFileSync(path.join(p.caminho, '111.key'), 'CHAVE-QUE-NUNCA-PODE-SER-ABERTA');
    const relogio = relogioFalso(T + 1_000);
    const emitidos: EntradaBruta[] = [];
    const vivos = new Set([4242, 5151]);
    const a = criarAdaptadorSessoes({ pasta: p.caminho, relogio, emitir: (e) => emitidos.push(e), fusao: criarFusao(), processoVivo: (pid) => vivos.has(pid) });
    a.varrer();
    const tipos = () => emitidos.map((e) => `${(e.evento as ArcadiaEvent).agente.chave} ${(e.evento as ArcadiaEvent).tipo}`);
    assert.deepEqual(tipos(), ['claude:s-a sessao.inicio', 'claude:s-a turno.inicio', 'claude:s-b sessao.inicio']);
    assert.deepEqual(emitidos[0]?.caminhos, { cwd: 'C:\\Users\\fulano\\proj' });
    assert.equal((emitidos[0]?.evento as ArcadiaEvent).ts, T - 60_000, 'sessão que já estava aberta chega com o horário de início');
    emitidos.length = 0;
    fs.writeFileSync(path.join(p.caminho, '222.json'), sessao('s-b', 'busy', { pid: 5151, statusUpdatedAt: T + 5_000 }));
    const futuro = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(p.caminho, '222.json'), futuro, futuro);
    a.varrer();
    assert.deepEqual(tipos(), ['claude:s-b turno.inicio']);
    emitidos.length = 0;
    fs.writeFileSync(path.join(p.caminho, '222.json'), sessao('s-b', 'idle', { pid: 5151, statusUpdatedAt: T + 9_000 }));
    const depois = new Date(Date.now() + 9_000);
    fs.utimesSync(path.join(p.caminho, '222.json'), depois, depois);
    a.varrer();
    assert.deepEqual(tipos(), ['claude:s-b turno.fim']);
    emitidos.length = 0;
    fs.rmSync(path.join(p.caminho, '111.json'));
    a.varrer();
    assert.deepEqual(tipos(), ['claude:s-a sessao.fim']);
    emitidos.length = 0;
    vivos.delete(5151);
    relogio.avancar(11_000);
    a.varrer();
    assert.deepEqual(tipos(), ['claude:s-b sessao.fim']);
    const textoEventos = JSON.stringify(emitidos.map((e) => e.evento));
    assert.ok(!textoEventos.includes('TOKEN') && !textoEventos.includes('SOCKET') && !textoEventos.includes('NOME-DA'));
    assert.deepEqual(abertos.filter((x) => x.endsWith('.key')), [], 'o .key nunca é tocado');
    assert.ok(abertos.some((x) => x.endsWith('.json')), 'o espião estava ligado');
  } finally {
    for (const [nome, f] of Object.entries(originais)) mutavel[nome] = f;
    p.remover();
  }
});

test('só os arquivos no padrão <pid>.json são lidos; qualquer outro .json da pasta fica fechado', () => {
  const p = pastaTemporaria();
  const lidos: string[] = [];
  const mutavel = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const original = mutavel['readFileSync'] as (...a: unknown[]) => unknown;
  mutavel['readFileSync'] = (...args: unknown[]) => {
    lidos.push(path.basename(String(args[0])));
    return original(...args);
  };
  try {
    fs.writeFileSync(path.join(p.caminho, '4242.json'), sessao('s-ok', 'idle'));
    for (const nome of ['config.json', 'sessions.json', 'abc.json', '4242.json.bak', '12345678901.json', '4242.a1b2c3.key']) {
      fs.writeFileSync(path.join(p.caminho, nome), sessao(`s-${nome.replace(/[^a-z0-9]/gi, '')}`, 'busy'));
    }
    const emitidos: EntradaBruta[] = [];
    const a = criarAdaptadorSessoes({ pasta: p.caminho, relogio: relogioFalso(T), emitir: (e) => emitidos.push(e), fusao: criarFusao(), processoVivo: () => true });
    a.varrer();
    assert.deepEqual(lidos, ['4242.json']);
    assert.deepEqual(emitidos.map((e) => (e.evento as ArcadiaEvent).agente.chave), ['claude:s-ok']);
    assert.ok(a.diagnostico().linhas[0]?.includes('5 arquivos fora do padrão'), a.diagnostico().linhas[0]);
  } finally {
    mutavel['readFileSync'] = original;
    p.remover();
  }
});
