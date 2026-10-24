// OpenMausBot falso para testes: environment, /api/bots?messages=0, /api/threads/{id}/job e o SSE, com dados
// inventados. Registra cada pedido (método, rota e cabeçalhos) para os testes conferirem o que o Arcadia pediu.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type PedidoRegistrado = { metodo: string; rota: string; cabecalhos: http.IncomingHttpHeaders };

export type OmbFalso = {
  porta: number;
  pedidos: PedidoRegistrado[];
  enviar(dados: Record<string, unknown>): void;
  derrubarSse(): void;
  /** Simula o app reiniciado: novo id de fluxo, então a retomada volta com resumed:false. */
  reiniciarFluxo(): void;
  definirBots(bots: unknown[]): void;
  definirJob(threadId: string, corpo: unknown): void;
  conexoesSse(): number;
  fechar(): Promise<void>;
};

export async function iniciarOmbFalso(op: { environmentId: string; versao: string; bots: unknown[] }): Promise<OmbFalso> {
  const pedidos: PedidoRegistrado[] = [];
  let bots = op.bots;
  const jobs = new Map<string, unknown>();
  let fluxo = 'S1';
  let seq = 0;
  const buffer: { seq: number; texto: string }[] = [];
  const clientes = new Set<http.ServerResponse>();

  const servidor = http.createServer((req, res) => {
    const rota = req.url ?? '';
    pedidos.push({ metodo: req.method ?? '', rota, cabecalhos: req.headers });
    const json = (status: number, corpo: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (req.method !== 'GET') return json(405, { erro: 'só GET neste falso' });
    if (rota === '/.well-known/openmausbot/environment') return json(200, { environmentId: op.environmentId, version: op.versao, label: 'x', platform: 'win32', capabilities: [] });
    if (rota === '/api/bots?messages=0') return json(200, { bots, groups: [], sections: ['Equipe Teste'], botQueuedMessages: {}, computerControl: {} });
    const job = /^\/api\/threads\/([^/]+)\/job\?scope=job$/.exec(rota);
    if (job) return json(200, jobs.get(job[1] ?? '') ?? { nodes: [] });
    if (rota === '/api/events?screens=off') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const ultimo = String(req.headers['last-event-id'] ?? '');
      const [s, n] = ultimo.split(':');
      const desde = Number(n);
      const resumed = s === fluxo && Number.isInteger(desde) && desde <= seq;
      res.write(`data: ${JSON.stringify({ kind: 'hello', cursor: `${fluxo}:${seq}`, resumed })}\n\n`);
      if (resumed) for (const b of buffer) if (b.seq > desde) res.write(b.texto);
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  const porta = (servidor.address() as AddressInfo).port;

  return {
    porta,
    pedidos,
    enviar(dados) {
      seq++;
      const texto = `id: ${fluxo}:${seq}\ndata: ${JSON.stringify({ ...dados, seq })}\n\n`;
      buffer.push({ seq, texto });
      for (const c of clientes) c.write(texto);
    },
    derrubarSse() {
      for (const c of clientes) c.destroy();
      clientes.clear();
    },
    reiniciarFluxo() {
      fluxo = `S${Number(fluxo.slice(1)) + 1}`;
      seq = 0;
      buffer.length = 0;
    },
    definirBots(b) {
      bots = b;
    },
    definirJob(threadId, corpo) {
      jobs.set(threadId, corpo);
    },
    conexoesSse: () => clientes.size,
    fechar: () =>
      new Promise<void>((r) => {
        for (const c of clientes) c.destroy();
        servidor.closeAllConnections();
        servidor.close(() => r());
      }),
  };
}

/** Espera a condição. O limite é folgado: a suíte roda os arquivos em paralelo, e sob carga a conexão demora mais. */
export async function esperarAte(condicao: () => boolean, limiteMs = 10_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('a condição não aconteceu a tempo');
}
