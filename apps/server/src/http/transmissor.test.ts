// Testes do transmissor SSE: rajada em 250 ms, coalescência, seq, buffer, resync e ping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaOla, EsquemaQuadro, EsquemaResync, type Mudanca } from '@arcadia/shared';
import { coalescer, criarTransmissor, formatarSSE } from './transmissor.ts';
import { relogioFalso } from '../util/relogio.ts';

const T0 = 1_792_000_000_000;

type Mensagem = { event?: string; id?: number; retry?: number; data?: string };

function ler(texto: string): Mensagem[] {
  return texto
    .split('\n\n')
    .filter((b) => b.length > 0)
    .map((bloco) => {
      const m: Mensagem = {};
      for (const linha of bloco.split('\n')) {
        const i = linha.indexOf(': ');
        const campo = linha.slice(0, i);
        const valor = linha.slice(i + 2);
        if (campo === 'event') m.event = valor;
        else if (campo === 'id') m.id = Number(valor);
        else if (campo === 'retry') m.retry = Number(valor);
        else if (campo === 'data') m.data = (m.data ? m.data + '\n' : '') + valor;
      }
      return m;
    });
}

const agente = (chave: string, estado: 'pensando' | 'lendo' = 'pensando'): Mudanca => ({
  k: 'agente',
  agente: {
    chave, tipo: 'sessao', motor: 'claude', origem: 'sim', estado, desde: T0, ultimasAcoes: [],
    uso: { entrada: 0, saida: 0, cache: 0, custoUsd: 0 }, chegouEm: T0, ultimaAtividade: T0, entregasHoje: 0, errosHoje: 0,
  },
});

test('formato SSE', () => {
  assert.equal(formatarSSE({ event: 'mundo', id: 7, data: '{"a":1}' }), 'event: mundo\nid: 7\ndata: {"a":1}\n\n');
  assert.equal(formatarSSE({ retry: 3000 }), 'retry: 3000\n\n');
});

test('coalescer: a mesma entidade uma vez, na primeira posição, com o valor mais novo; eventos ficam todos', () => {
  const ev1: Mudanca = { k: 'obra.fim', salaChave: 's1' };
  const r = coalescer([agente('a', 'lendo'), ev1, agente('b'), agente('a', 'pensando'), { k: 'agente.saiu', chave: 'b' }]);
  assert.equal(r.length, 3);
  assert.equal(r[0]?.k === 'agente' && r[0].agente.estado, 'pensando');
  assert.deepEqual(r[2], { k: 'agente.saiu', chave: 'b' });
});

test('rajada de 250 ms vira um quadro só, com seq crescente', () => {
  const relogio = relogioFalso(T0);
  const t = criarTransmissor({ relogio, buildId: 'b1', instancia: 'i1', seqInicial: T0 });
  let recebido = '';
  const c = t.conectar(undefined, (x) => (recebido += x));
  const inicial = ler(c.inicial.join(''));
  assert.equal(inicial[0]?.retry, 3000);
  assert.equal(inicial[1]?.event, 'ola');
  assert.ok(EsquemaOla.safeParse(JSON.parse(inicial[1]?.data ?? '')).success);
  t.publicar([agente('a')]);
  relogio.avancar(100);
  t.publicar([agente('a', 'lendo'), agente('b')]);
  relogio.avancar(149);
  assert.equal(recebido, '', 'ainda dentro da janela');
  relogio.avancar(1);
  const quadros = ler(recebido);
  assert.equal(quadros.length, 1);
  assert.equal(quadros[0]?.event, 'mundo');
  assert.equal(quadros[0]?.id, T0 + 1);
  const q = EsquemaQuadro.parse(JSON.parse(quadros[0]?.data ?? ''));
  assert.equal(q.mudancas.length, 2);
  assert.equal(t.seqAtual(), T0 + 1);
  t.parar();
});

test('retomada: buffer devolve o que faltou; buraco ou seq do futuro pedem resync', () => {
  const relogio = relogioFalso(T0);
  const t = criarTransmissor({ relogio, buildId: 'b1', instancia: 'i1', seqInicial: T0, bufferMax: 3 });
  for (let i = 0; i < 5; i++) {
    t.publicar([agente(`a${i}`)]);
    relogio.avancar(250);
  }
  assert.equal(t.seqAtual(), T0 + 5);
  const retomar = (desde: number) => ler(t.conectar(desde, () => {}).inicial.join('')).slice(2);
  assert.deepEqual(retomar(T0 + 3).map((m) => m.id), [T0 + 4, T0 + 5]);
  assert.deepEqual(retomar(T0 + 2).map((m) => m.id), [T0 + 3, T0 + 4, T0 + 5]);
  assert.deepEqual(retomar(T0 + 5), [], 'em dia: nada a mandar');
  const buraco = retomar(T0 + 1);
  assert.equal(buraco[0]?.event, 'resync');
  assert.deepEqual(EsquemaResync.parse(JSON.parse(buraco[0]?.data ?? '')), { motivo: 'seq-ausente', seq: T0 + 5 });
  const futuro = retomar(T0 + 99);
  assert.equal(EsquemaResync.parse(JSON.parse(futuro[0]?.data ?? '')).motivo, 'seq-futuro');
  t.parar();
});

test('descarregar fecha o quadro na hora (antes do snapshot)', () => {
  const relogio = relogioFalso(T0);
  const t = criarTransmissor({ relogio, buildId: 'b1', instancia: 'i1', seqInicial: T0 });
  t.publicar([agente('a')]);
  assert.equal(t.descarregar(), T0 + 1);
  assert.equal(t.descarregar(), T0 + 1, 'sem pendência, o seq não anda');
  t.parar();
});

test('ping a cada 15 s, sem id', () => {
  const relogio = relogioFalso(T0);
  const t = criarTransmissor({ relogio, buildId: 'b1', instancia: 'i1', seqInicial: T0 });
  let recebido = '';
  t.conectar(undefined, (x) => (recebido += x));
  relogio.avancar(14_999);
  assert.equal(recebido, '');
  relogio.avancar(1);
  const [ping] = ler(recebido);
  assert.equal(ping?.event, 'ping');
  assert.equal(ping?.id, undefined);
  t.parar();
});

test('a guarda da saída mascara texto proibido que escapar', () => {
  const relogio = relogioFalso(T0);
  const t = criarTransmissor({ relogio, buildId: 'b1', instancia: 'i1', seqInicial: T0 });
  let recebido = '';
  t.conectar(undefined, (x) => (recebido += x));
  const m = agente('a');
  if (m.k === 'agente') m.agente.nome = 'C:\\Users\\fulano';
  t.publicar([m]);
  t.descarregar();
  assert.ok(!recebido.includes('fulano'));
  assert.equal(t.bloqueados(), 1);
  t.parar();
});
