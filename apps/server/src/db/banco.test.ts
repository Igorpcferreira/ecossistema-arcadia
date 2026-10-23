// Testes do banco: WAL, eventos só de acréscimo, deduplicação, snapshots, layout, métricas e retenção.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { abrirBanco } from './banco.ts';
import { configMotorPadrao, criarEstadoInicial } from '../mundo/motor.ts';
import { ev, pastaTemporaria } from '../testes/apoio.ts';

const DIA = 24 * 3600_000;
const T0 = Date.UTC(2026, 9, 22, 15, 0, 0);

function comBanco(fn: (b: ReturnType<typeof abrirBanco>) => void): void {
  const pasta = pastaTemporaria();
  const b = abrirBanco(path.join(pasta.caminho, 'arcadia.sqlite'));
  try {
    fn(b);
  } finally {
    b.fechar();
    pasta.remover();
  }
}

test('modo WAL e sal estável', () => {
  comBanco((b) => {
    assert.equal(b.modoJournal(), 'wal');
    const s = b.sal();
    assert.match(s, /^[0-9a-f]{32}$/);
    assert.equal(b.sal(), s);
  });
});

test('eventos: acréscimo, deduplicação por id e leitura em ordem', () => {
  comBanco((b) => {
    const e1 = ev('turno.inicio', T0);
    const e2 = ev('turno.fim', T0 + 1);
    const s1 = b.inserirEvento(e1);
    const s2 = b.inserirEvento(e2);
    assert.ok(s1 !== undefined && s2 !== undefined && s2 > s1);
    assert.equal(b.inserirEvento(e1), undefined, 'id repetido não entra');
    assert.equal(b.contarEventos(), 2);
    assert.deepEqual([...b.eventosDepois(0)].map((x) => x.evento.id), [e1.id, e2.id]);
    assert.deepEqual([...b.eventosDepois(s1 ?? 0)].map((x) => x.evento.tipo), ['turno.fim']);
    assert.equal(b.ultimoSeq(), s2);
  });
});

test('eventos não podem ser alterados (só acréscimo)', () => {
  const pasta = pastaTemporaria();
  const arquivo = path.join(pasta.caminho, 'arcadia.sqlite');
  const b = abrirBanco(arquivo);
  b.inserirEvento(ev('turno.inicio', T0));
  b.fechar();
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(arquivo);
    try {
      assert.throws(() => db.exec("UPDATE eventos SET tipo = 'erro'"), /acrescimo/);
    } finally {
      db.close();
      pasta.remover();
    }
  });
});

test('snapshot, alas, salas com posição e métricas voltam iguais', () => {
  comBanco((b) => {
    const cfg = configMotorPadrao();
    const e = criarEstadoInicial(T0, cfg, { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' });
    b.gravarSnapshot(10, T0, e);
    b.gravarSnapshot(20, T0 + 1000, e);
    assert.equal(b.ultimoSnapshot()?.seq, 20);
    assert.equal(b.ultimoSnapshot(T0 + 500)?.seq, 10);
    assert.deepEqual(b.ultimoSnapshot()?.estado, JSON.parse(JSON.stringify(e)));
    const ala = e.mundo.alas['recepcao'];
    assert.ok(ala);
    b.gravarAla(ala);
    b.gravarSala({
      chave: 'sabc', nome: 'Portal', alaId: 'recepcao', tipo: 'web', terreno: { indice: 4, col: 1, lin: 1 }, andar: 1,
      criadaEm: T0, ultimaAtividade: T0, dormindo: false, entregas: 9, erros: 1, entregasHoje: 2, errosHoje: 0,
    }, T0 + 5);
    assert.deepEqual(b.alas(), [ala]);
    const [sala] = b.salas();
    assert.deepEqual(sala?.terreno, { indice: 4, col: 1, lin: 1 });
    assert.equal(sala?.alaId, 'recepcao');
    b.gravarMetricasDia('2026-10-22', e.mundo.metricas);
    assert.deepEqual(b.metricasDia('2026-10-22'), e.mundo.metricas);
  });
});

test('retenção apaga o velho, mas nunca o último snapshot nem o que vem depois dele', () => {
  comBanco((b) => {
    const cfg = configMotorPadrao();
    const e = criarEstadoInicial(T0, cfg, { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' });
    const velho = b.inserirEvento(ev('turno.inicio', T0 - 200 * DIA, { recebidoEm: T0 - 200 * DIA }));
    b.gravarSnapshot(velho ?? 0, T0 - 199 * DIA, e);
    b.inserirEvento(ev('turno.fim', T0 - 190 * DIA, { recebidoEm: T0 - 190 * DIA }));
    const r = b.aplicarRetencao(T0, 180);
    assert.equal(r.eventos, 1, 'só o evento antes do último snapshot sai');
    assert.equal(r.snapshots, 0, 'o último snapshot fica');
    b.gravarSnapshot(99, T0 - DIA, e);
    const r2 = b.aplicarRetencao(T0, 180);
    assert.equal(r2.snapshots, 1);
    assert.equal(b.contarSnapshots(), 1);
  });
});

test('desbaste: tudo das últimas 24 h, um por hora até 7 dias, um por dia depois', () => {
  comBanco((b) => {
    const cfg = configMotorPadrao();
    const e = criarEstadoInicial(T0, cfg, { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' });
    const hora = 3600_000;
    for (let i = 0; i < 6; i++) b.gravarSnapshot(i, T0 - i * 10 * 60_000, e);
    for (let i = 0; i < 6; i++) b.gravarSnapshot(100 + i, T0 - 2 * DIA - 60_000 - i * 5 * 60_000, e);
    for (let i = 0; i < 4; i++) b.gravarSnapshot(200 + i, T0 - 10 * DIA - i * 3 * hora, e);
    const antes = b.contarSnapshots();
    const apagados = b.desbastarSnapshots(T0);
    assert.equal(antes - apagados, b.contarSnapshots());
    assert.equal(b.contarSnapshots(), 6 + 1 + 1, 'seis recentes, um da hora de dois dias atrás, um do dia de dez dias atrás');
  });
});

test('marcas de pasta excluída: a de vez nunca vira de turno, a de turno sai no turno novo e a retenção apaga a parada', () => {
  comBanco((b) => {
    b.gravarMarca('mhashum', 'agente', T0);
    b.gravarMarca('mhashum', 'turno', T0 + 1);
    b.gravarMarca('mhashdois', 'turno', T0);
    assert.deepEqual(b.marcasPrivadas(), [{ chave: 'mhashdois', tipo: 'turno' }, { chave: 'mhashum', tipo: 'agente' }]);
    b.apagarMarcaDeTurno('mhashum');
    b.apagarMarcaDeTurno('mhashdois');
    assert.deepEqual(b.marcasPrivadas(), [{ chave: 'mhashum', tipo: 'agente' }], 'a de vez fica; a de turno sai');
    // Agente marcado que segue ativo renova a data; o parado há mais tempo que a retenção sai.
    b.gravarMarca('mhashtres', 'agente', T0 + 40 * DIA);
    const r = b.aplicarRetencao(T0 + 40 * DIA, 30);
    assert.equal(r.marcas, 1);
    assert.deepEqual(b.marcasPrivadas(), [{ chave: 'mhashtres', tipo: 'agente' }]);
    b.gravarSalaFora('sabc', T0);
    b.gravarSalaFora('sabc', T0 + 1);
    assert.deepEqual(b.salasFora(), ['sabc']);
  });
});
