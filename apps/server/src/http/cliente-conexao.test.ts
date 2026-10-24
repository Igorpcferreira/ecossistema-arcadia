// Testes do lado do cliente do protocolo (apps/world/src/fonte/conexao.ts, o módulo que o mundo usa): o adeus do
// servidor, a aba escondida que solta o SSE e a recarga só com a página respondendo. O módulo do mundo roda aqui com
// um EventSource e um document falsos e com o relógio do node:test (o vigia lê performance.now, que segue o relógio).
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Caminho montado em tempo de execução: o typecheck do servidor não entra no código do mundo (ele tem o dele).
const MODULO = new URL('../../../world/src/fonte/conexao.ts', import.meta.url).href;

type Status = 'conectando' | 'ao-vivo' | 'sem-conexao' | 'outra-aba';
type ConexaoCliente = {
  status: Status;
  motivoAdeus: string | null;
  contagem: Record<string, number>;
  iniciar(s: unknown): void;
  parar(): void;
  retomar(): void;
};
type RecarregadorCliente = { esperando: boolean; contagem: Record<string, number>; pedir(): Promise<void> };
type Modulo = {
  Conexao: new (base: string, ouvir: unknown) => ConexaoCliente;
  Recarregador: new (op: unknown) => RecarregadorCliente;
  ESCONDIDA_SOLTA_MS: number;
  VIGIA_MS: number;
};
const m = (await import(MODULO)) as Modulo;

/** EventSource falso: guarda todas as conexões abertas, na ordem. */
class EventSourceFalso extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static todas: EventSourceFalso[] = [];
  readyState = 1;
  readonly url: string;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    super();
    this.url = url;
    EventSourceFalso.todas.push(this);
  }
  close(): void {
    this.readyState = 2;
  }
  emitir(tipo: string, dados: unknown): void {
    this.dispatchEvent(new MessageEvent(tipo, { data: JSON.stringify(dados) }));
  }
  /** O fluxo caiu (fechado de vez, como depois de um adeus, ou só o navegador tentando de novo). */
  cair(deVez: boolean): void {
    if (deVez) this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
}

const documento = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
function visibilidade(v: 'visible' | 'hidden'): void {
  documento.visibilityState = v;
  documento.dispatchEvent(new Event('visibilitychange'));
}

const globais = globalThis as unknown as Record<string, unknown>;
const originais = new Map<string, PropertyDescriptor | undefined>();
function trocarGlobal(nome: string, valor: unknown): void {
  if (!originais.has(nome)) originais.set(nome, Object.getOwnPropertyDescriptor(globalThis, nome));
  Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 });
  EventSourceFalso.todas = [];
  documento.visibilityState = 'visible';
  trocarGlobal('window', globalThis);
  trocarGlobal('document', documento);
  trocarGlobal('EventSource', EventSourceFalso);
  trocarGlobal('performance', { now: () => Date.now() });
});

afterEach(() => {
  mock.timers.reset();
  for (const [nome, d] of originais) {
    if (d) Object.defineProperty(globalThis, nome, d);
    else delete globais[nome];
  }
  originais.clear();
});

function conectar(): { c: ConexaoCliente; status: Status[]; recargas: () => number } {
  const status: Status[] = [];
  let recargas = 0;
  const c = new m.Conexao('/api', {
    snapshot: () => {},
    quadro: () => {},
    status: (s: Status) => status.push(s),
    recarregar: () => recargas++,
  });
  c.iniciar({ v: 1, seq: 10, buildId: 'b1', instancia: 'i1', geradoEm: 0, estado: {} });
  EventSourceFalso.todas.at(-1)?.emitir('ola', { seq: 10, buildId: 'b1', instancia: 'i1', versaoEsquema: 1 });
  assert.equal(c.status, 'ao-vivo');
  return { c, status, recargas: () => recargas };
}

const abertas = () => EventSourceFalso.todas.filter((e) => e.readyState !== 2).length;

/**
 * Anda o relógio em passos de 500 ms (o que um passo agenda roda no passo seguinte). Com `pings`, o servidor falso
 * manda o ping de 15 s na conexão aberta, como o de verdade.
 */
function andar(ms: number, pings = false): void {
  for (let feito = 0; feito < ms; feito += 500) {
    mock.timers.tick(500);
    if (pings && (feito + 500) % 15_000 === 0) EventSourceFalso.todas.filter((e) => e.readyState !== 2).at(-1)?.emitir('ping', {});
  }
}

test('adeus: fecha o EventSource, para o vigia, mostra outra aba e não reconecta sozinho; o toque retoma', () => {
  const { c, status } = conectar();
  const es = EventSourceFalso.todas[0] as EventSourceFalso;
  es.emitir('adeus', { motivo: 'outra-aba' });
  assert.equal(c.status, 'outra-aba');
  assert.equal(c.motivoAdeus, 'outra-aba');
  assert.equal(es.readyState, 2, 'o EventSource foi fechado (senão o navegador reconectaria em 3 s)');
  // O fim do fluxo chega depois do adeus: não pode virar reabertura.
  es.cair(true);
  andar(30 * 60_000);
  assert.equal(EventSourceFalso.todas.length, 1, 'meia hora depois, nenhuma conexão nova: nada de laço');
  assert.equal(c.status, 'outra-aba', 'o vigia parou (sem ele, a falta de ping viraria sem conexão e reabertura)');
  assert.deepEqual(status, ['ao-vivo', 'outra-aba']);
  // Aba escondida e de volta não traz a conexão: só o toque.
  visibilidade('hidden');
  andar(2 * 60_000);
  visibilidade('visible');
  assert.equal(EventSourceFalso.todas.length, 1);
  c.retomar();
  assert.equal(EventSourceFalso.todas.length, 2, 'o toque abre uma conexão');
  assert.match((EventSourceFalso.todas[1] as EventSourceFalso).url, /\/api\/events\?desde=10$/);
  assert.equal(c.status, 'conectando');
  (EventSourceFalso.todas[1] as EventSourceFalso).emitir('ola', { seq: 10, buildId: 'b1', instancia: 'i1', versaoEsquema: 1 });
  assert.equal(c.status, 'ao-vivo');
  assert.deepEqual([c.contagem['adeus'], c.contagem['retomadas'], c.contagem['conexoes']], [1, 1, 2]);
  c.parar();
});

test('o motivo muitas-conexoes também solta sem voltar sozinho; adeus de uma conexão velha não conta', () => {
  const { c } = conectar();
  const velha = EventSourceFalso.todas[0] as EventSourceFalso;
  velha.cair(true);
  andar(1_500);
  assert.equal(EventSourceFalso.todas.length, 2, 'queda comum: reabre sozinha, como antes');
  velha.emitir('adeus', { motivo: 'outra-aba' });
  assert.notEqual(c.status, 'outra-aba', 'o adeus de uma conexão que já não é a atual não solta a nova');
  (EventSourceFalso.todas[1] as EventSourceFalso).emitir('adeus', { motivo: 'muitas-conexoes' });
  assert.equal(c.status, 'outra-aba');
  assert.equal(c.motivoAdeus, 'muitas-conexoes');
  andar(10 * 60_000);
  assert.equal(EventSourceFalso.todas.length, 2);
  assert.equal(abertas(), 0);
  c.parar();
});

test('aba escondida por mais de 60 s solta o SSE e volta sozinha quando aparece; por menos, fica', () => {
  const { c } = conectar();
  visibilidade('hidden');
  andar(m.ESCONDIDA_SOLTA_MS - 1_000, true);
  visibilidade('visible');
  assert.equal(abertas(), 1, 'escondida por menos de 60 s: a conexão fica');
  assert.equal(EventSourceFalso.todas.length, 1, 'e é a mesma');
  visibilidade('hidden');
  andar(m.ESCONDIDA_SOLTA_MS + 1_000, true);
  assert.equal(abertas(), 0, 'escondida por mais de 60 s: solta');
  andar(30 * 60_000);
  assert.equal(EventSourceFalso.todas.length, 1, 'escondida, não reconecta (nem pelo vigia)');
  visibilidade('visible');
  assert.equal(EventSourceFalso.todas.length, 2, 'apareceu: volta sozinha');
  assert.equal(c.status, 'conectando');
  (EventSourceFalso.todas[1] as EventSourceFalso).emitir('ola', { seq: 10, buildId: 'b1', instancia: 'i1', versaoEsquema: 1 });
  assert.equal(c.status, 'ao-vivo');
  c.parar();
});

test('vigia e queda continuam como antes: 45 s sem nada reabre, e o fluxo fechado de vez reabre de 1 a 10 s', () => {
  const { c } = conectar();
  andar(m.VIGIA_MS - 5_000);
  assert.equal(EventSourceFalso.todas.length, 1);
  andar(12_000);
  assert.equal(EventSourceFalso.todas.length, 2, 'sem ping por 45 s, reabre');
  const atual = EventSourceFalso.todas.at(-1) as EventSourceFalso;
  atual.cair(true);
  andar(10_000);
  assert.equal(EventSourceFalso.todas.length, 3, 'o fluxo fechado de vez reabre sozinho');
  c.parar();
});

type Resposta = 'fora' | 'erro-http' | 'pendura' | 'ok';

/** Ajudante de recarga com busca e espera falsas: cada conferência leva a próxima resposta da lista (a última repete). */
function recarregador(respostas: Resposta[], limiteMs = 5_000) {
  const esperas: number[] = [];
  const pedidos: { url: string; init: RequestInit }[] = [];
  let recargas = 0;
  let n = 0;
  const r = new m.Recarregador({
    url: () => 'http://127.0.0.1:4792/?vista=corte',
    recarregar: () => recargas++,
    buscar: (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      const resposta = respostas[Math.min(n++, respostas.length - 1)];
      if (resposta === 'pendura') return new Promise((_, falha) => init.signal?.addEventListener('abort', () => falha(new Error('abortado'))));
      if (resposta === 'fora') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: resposta === 'ok' });
    },
    esperar: (ms: number) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    intervaloMs: 10_000,
    limiteMs,
  });
  return { r, esperas, pedidos, recargas: () => recargas };
}

test('recarga só com a página respondendo: fora do ar, confere a cada 10 s; de volta, uma recarga só', async () => {
  mock.timers.reset();
  const x = recarregador(['fora', 'fora', 'fora', 'ok']);
  const a = x.r.pedir();
  const b = x.r.pedir();
  assert.equal(a, b, 'pedido repetido enquanto espera vira o mesmo');
  assert.equal(x.r.esperando, true);
  await a;
  assert.equal(x.recargas(), 1, 'uma recarga só, quando a página respondeu');
  assert.deepEqual(x.esperas, [10_000, 10_000, 10_000], 'três conferências sem resposta, 10 s entre elas');
  assert.equal(x.pedidos.length, 4);
  for (const p of x.pedidos) {
    assert.equal(p.init.method, 'HEAD');
    assert.equal(p.init.cache, 'no-store');
    assert.equal(p.url, 'http://127.0.0.1:4792/?vista=corte', 'confere a própria página');
  }
  assert.deepEqual({ ...x.r.contagem }, { pedidos: 2, conferencias: 4, semResposta: 3, recargas: 1 });
});

test('recarga: resposta de erro (a página de falta de build, 503) não recarrega; conferência pendurada cai no tempo-limite', async () => {
  mock.timers.reset();
  const x = recarregador(['pendura', 'erro-http', 'ok'], 30);
  await x.r.pedir();
  assert.equal(x.recargas(), 1);
  assert.equal(x.r.contagem['semResposta'], 2, 'a pendurada e a de erro não recarregaram');
  assert.equal(x.pedidos.length, 3);
});
