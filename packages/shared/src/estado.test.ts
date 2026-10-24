// Testes do esquema do estado e do protocolo de transmissão. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaEstadoMundo, EsquemaMudanca, EsquemaQuadro, EsquemaSnapshot, TEMAS_ALA, type EstadoMundo } from './estado.ts';

export function estadoExemplo(): EstadoMundo {
  return {
    v: 1,
    agora: 5000,
    alas: {
      recepcao: { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a', ordem: 0, lote: { col: 0, lin: 0 }, tipo: 'recepcao', ativa: true, criadaEm: 0 },
      produtos: { id: 'produtos', nome: 'Produtos', cor: '#c9a7ff', ordem: 1, lote: { col: 1, lin: 0 }, tipo: 'projetos', ativa: true, criadaEm: 0 },
    },
    salas: {
      'sala-alfa': {
        chave: 'sala-alfa', nome: 'Portal Alfa', alaId: 'produtos', tipo: 'web', terreno: { indice: 0, col: 0, lin: 0 }, andar: 1,
        criadaEm: 100, ultimaAtividade: 4000, dormindo: false, entregas: 3, erros: 1, entregasHoje: 3, errosHoje: 1,
      },
    },
    agentes: {
      'sim:a1': {
        chave: 'sim:a1', tipo: 'bot', motor: 'claude', origem: 'sim', nome: 'Unidade A1', cor: 'purple', estado: 'editando', desde: 4000,
        salaChave: 'sala-alfa', ferramenta: { nome: 'Edit', categoria: 'editar' },
        ultimasAcoes: [{ ts: 4000, tipo: 'ferramenta.inicio', categoria: 'editar', nome: 'Edit' }],
        uso: { entrada: 10, saida: 20, cache: 0, custoUsd: 0.01 }, chegouEm: 100, ultimaAtividade: 4000, entregasHoje: 3, errosHoje: 1,
      },
    },
    delegacoes: {},
    precisaDeVoce: [],
    metricas: {
      dia: '22/10/2026', entregas: 3, erros: 1, ferramentas: 9, turnos: 4, pedidos: 2, delegacoes: 0, esperas: 0,
      tokens: { entrada: 10, saida: 20, cache: 0 }, custoUsd: 0.01, agentes: 1, salas: 1,
    },
    saude: { fontes: { sim: { estado: 'simulada', eventos: 12, ignoradas: 0, ultimoEvento: 4000 } } },
    obras: [],
  };
}

test('o estado de exemplo é válido', () => {
  const r = EsquemaEstadoMundo.safeParse(estadoExemplo());
  assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues));
});

test('campo a mais no estado é recusado (allowlist da saída)', () => {
  const e = estadoExemplo() as unknown as { agentes: Record<string, Record<string, unknown>> };
  const agente = e.agentes['sim:a1'];
  assert.ok(agente);
  agente['prompt'] = 'texto';
  assert.equal(EsquemaEstadoMundo.safeParse(e).success, false);
});

test('data do dia só em dd/mm/aaaa', () => {
  const e = estadoExemplo();
  e.metricas.dia = '2026-10-22';
  assert.equal(EsquemaEstadoMundo.safeParse(e).success, false);
});

test('snapshot, quadro e mudanças', () => {
  assert.ok(EsquemaSnapshot.safeParse({ v: 1, seq: 7, buildId: 'dev', instancia: 'i1', geradoEm: 1, estado: estadoExemplo() }).success);
  assert.ok(EsquemaMudanca.safeParse({ k: 'agente.saiu', chave: 'sim:a1' }).success);
  assert.equal(EsquemaMudanca.safeParse({ k: 'desconhecida' }).success, false);
  assert.ok(EsquemaQuadro.safeParse({ seq: 8, ts: 2, mudancas: [{ k: 'obra.fim', salaChave: 'sala-alfa' }] }).success);
});

test('tema da ala: opcional, só da lista (a mesma da configuração e do mundo)', () => {
  assert.deepEqual([...TEMAS_ALA], ['equipe', 'agencia', 'estudio', 'corporativo', 'laboratorio', 'pessoal', 'bastidores', 'produtos', 'academia']);
  const e = estadoExemplo();
  for (const tema of TEMAS_ALA) {
    const com = { ...e, alas: { ...e.alas, produtos: { ...(e.alas['produtos'] as NonNullable<EstadoMundo['alas'][string]>), tema } } };
    assert.ok(EsquemaEstadoMundo.safeParse(com).success, tema);
  }
  const fora = { ...e, alas: { ...e.alas, produtos: { ...(e.alas['produtos'] as object), tema: 'castelo' } } };
  assert.equal(EsquemaEstadoMundo.safeParse(fora).success, false, 'tema fora da lista é recusado');
  assert.ok(EsquemaEstadoMundo.safeParse(e).success, 'sem tema continua valendo');
});
