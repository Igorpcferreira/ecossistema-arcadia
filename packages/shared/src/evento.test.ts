// Testes do esquema do evento canônico. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaArcadiaEvent, REGEX_ID, TIPOS_EVENTO } from './evento.ts';

const base = {
  v: 1,
  id: 'sim:x:1',
  ts: 10,
  recebidoEm: 11,
  origem: 'sim',
  motor: 'codex',
  agente: { chave: 'codex:abc-123', tipo: 'sessao' },
  local: {},
  tipo: 'turno.inicio',
};

test('aceita o evento mínimo de cada tipo que não exige campo extra', () => {
  const exigem = new Set(['ferramenta.inicio', 'ferramenta.fim', 'ferramenta.erro', 'espera.inicio', 'delegacao.enviada', 'delegacao.recebida', 'delegacao.concluida', 'uso', 'presenca']);
  for (const tipo of TIPOS_EVENTO) {
    const r = EsquemaArcadiaEvent.safeParse({ ...base, tipo });
    assert.equal(r.success, !exigem.has(tipo), tipo);
  }
});

test('mantém os nomes da seção 5.3 e as extensões opcionais', () => {
  const r = EsquemaArcadiaEvent.safeParse({
    ...base,
    tipo: 'ferramenta.fim',
    agente: { chave: 'omb:b1', tipo: 'bot', nome: 'Unidade', cargo: 'Revisão', cor: 'teal', corpo: 'cursor', paiChave: 'omb:b0' },
    local: { projetoChave: 's-abc', equipe: 'Equipe Alfa', sala: { nome: 'Portal', ala: 'produtos', tipo: 'web' } },
    ferramenta: { nome: 'Bash', categoria: 'comando', ok: true, duracaoMs: 1200, id: 'toolu_9' },
    uso: { entrada: 10, saida: 20, cache: 5, custoUsd: 0.01 },
    tarefa: { chave: 't1', titulo: 'Revisar' },
    turno: { chave: 'p1', texto: false },
  });
  assert.ok(r.success);
});

test('presença e interrupção (extensões do marco 2)', () => {
  assert.ok(EsquemaArcadiaEvent.safeParse({ ...base, tipo: 'presenca', presenca: { estado: 'na-fila' } }).success);
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, tipo: 'presenca', presenca: { estado: 'dancando' } }).success, false);
  assert.ok(EsquemaArcadiaEvent.safeParse({ ...base, tipo: 'turno.fim', turno: { interrompido: true } }).success);
});

test('recusa versão, origem e identificador inválidos', () => {
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, v: 2 }).success, false);
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, origem: 'navegador' }).success, false);
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, agente: { chave: 'C:/Users/x', tipo: 'sessao' } }).success, false);
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, ts: -1 }).success, false);
  assert.equal(EsquemaArcadiaEvent.safeParse({ ...base, local: { sala: { nome: 'x', ala: 'Ala Com Espaco' } } }).success, false);
});

test('identificador não aceita espaço, barra, arroba nem porcentagem', () => {
  for (const ruim of ['a b', 'a/b', 'a\\b', 'a@b', '%USERPROFILE%', '', ':comeca']) assert.equal(REGEX_ID.test(ruim), false, ruim);
  for (const bom of ['claude:550e8400-e29b-41d4-a716-446655440000', 'omb:b1', 'sim:dia-normal:42:0:7', 's.abc_1']) assert.equal(REGEX_ID.test(bom), true, bom);
});
