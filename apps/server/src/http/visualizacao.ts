// Listener da visualização (por enquanto 127.0.0.1:4780): snapshot com gzip, SSE (com teto por endereço e total) e a
// página de depuração.
// Só dados saneados. Host conferido (contra DNS rebinding) e nada de CORS: outra origem não lê as respostas.
import { gzipSync } from 'node:zlib';
import { Hono, type Context } from 'hono';
import { protegerSaida, type Contador, type Snapshot } from '@arcadia/shared';
import type { Nucleo } from '../nucleo.ts';
import type { Relogio } from '../util/relogio.ts';
import { HTML_DEPURAR, JS_DEPURAR } from './depurar.ts';

/** Cliente com mais que isso parado na fila é desconectado (ele reconecta e pede resync). */
const LIMITE_FILA_SSE = 4 * 1024 * 1024;
/**
 * Teto de conexões SSE ao mesmo tempo (celular, PC e páginas de depuração cabem com folga). Cheio, a conexão nova
 * entra e cai a mais antiga do endereço com mais conexões: um processo local com muitas abas nunca tranca o celular.
 */
const LIMITE_CONEXOES_SSE = 32;
/** Teto de conexões SSE de um mesmo endereço: a nova derruba a mais antiga dele. */
const LIMITE_SSE_POR_IP = 4;

const CABECALHOS_SSE = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-accel-buffering': 'no',
} as const;

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function hostPermitido(cabecalho: string | undefined, extras: ReadonlySet<string> = new Set()): boolean {
  if (!cabecalho) return false;
  const host = cabecalho.trim().toLowerCase().replace(/:\d{1,5}$/, '');
  return HOSTS_LOCAIS.has(host) || extras.has(host);
}

const CSP_PAGINA = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export type OpcoesVisualizacao = { nucleo: Nucleo; relogio: Relogio; hostsExtras?: ReadonlySet<string>; limiteSse?: number; limiteSsePorIp?: number };

/** Endereço de quem conectou (o socket de verdade; cabeçalho nenhum é confiável para isso). */
function enderecoDe(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const ip = env?.incoming?.socket?.remoteAddress;
  return typeof ip === 'string' && ip.length > 0 ? ip.replace(/^::ffff:/i, '') : 'desconhecido';
}

export function lerDesde(valor: string | undefined | null): number | undefined {
  if (valor === undefined || valor === null || !/^\d{1,16}$/.test(valor.trim())) return undefined;
  return Number(valor.trim());
}

export type AppVisualizacao = { app: Hono; bloqueados(): number };

export function criarAppVisualizacao(op: OpcoesVisualizacao): AppVisualizacao {
  const { nucleo, relogio } = op;
  const app = new Hono();
  const guarda: Contador = { mascarados: 0 };
  const limiteTotal = Math.max(1, op.limiteSse ?? LIMITE_CONEXOES_SSE);
  const limitePorIp = Math.max(1, op.limiteSsePorIp ?? LIMITE_SSE_POR_IP);
  /** Conexões SSE abertas, na ordem de chegada. */
  const conexoesSse: { ip: string; derrubar(): void }[] = [];

  /**
   * Vaga para uma conexão nova deste endereço: com o teto dele cheio, cai a mais antiga dele; com o teto total cheio,
   * cai a mais antiga do endereço com mais conexões. A conexão derrubada reconecta sozinha (EventSource) mais tarde.
   */
  function abrirVaga(ip: string): void {
    for (let doIp = conexoesSse.filter((x) => x.ip === ip); doIp.length >= limitePorIp; doIp = conexoesSse.filter((x) => x.ip === ip)) {
      doIp[0]?.derrubar();
    }
    while (conexoesSse.length >= limiteTotal) {
      const porIp = new Map<string, number>();
      for (const x of conexoesSse) porIp.set(x.ip, (porIp.get(x.ip) ?? 0) + 1);
      const maior = Math.max(...porIp.values());
      const alvo = conexoesSse.find((x) => porIp.get(x.ip) === maior);
      if (!alvo) break;
      alvo.derrubar();
    }
  }

  app.use('*', async (c, next) => {
    if (!hostPermitido(c.req.header('host'), op.hostsExtras)) return c.text('Host não permitido.', 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Só leitura: use GET.', 405);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
  });

  app.get('/api/snapshot', (c) => {
    if (c.req.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const seq = nucleo.transmissor.descarregar();
    const corpo: Snapshot = {
      v: 1,
      seq,
      buildId: nucleo.buildId,
      instancia: nucleo.instancia,
      geradoEm: relogio.agora(),
      estado: protegerSaida(nucleo.mundo(), guarda),
    };
    const json = JSON.stringify(corpo);
    const cabecalhos: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'accept-encoding',
    };
    if (/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) {
      cabecalhos['content-encoding'] = 'gzip';
      return new Response(gzipSync(json), { headers: cabecalhos });
    }
    return new Response(json, { headers: cabecalhos });
  });

  app.get('/api/events', (c) => {
    // HEAD responde só os cabeçalhos: nenhum fluxo é criado (um fluxo sem leitor ficaria assinado para sempre).
    if (c.req.method === 'HEAD') return new Response(null, { headers: CABECALHOS_SSE });
    const ip = enderecoDe(c);
    abrirVaga(ip);
    const desde = lerDesde(c.req.header('last-event-id')) ?? lerDesde(c.req.query('desde'));
    const codificador = new TextEncoder();
    let assinatura: { cancelar(): void } | undefined;
    let sair: () => void = () => {};
    const fluxo = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          const conexao = {
            ip,
            derrubar() {
              sair();
              try {
                controller.close();
              } catch {
                // já fechado
              }
            },
          };
          conexoesSse.push(conexao);
          sair = () => {
            const i = conexoesSse.indexOf(conexao);
            if (i >= 0) conexoesSse.splice(i, 1);
            assinatura?.cancelar();
          };
          const enviar = (texto: string) => {
            if ((controller.desiredSize ?? 0) < -LIMITE_FILA_SSE) {
              conexao.derrubar();
              return;
            }
            controller.enqueue(codificador.encode(texto));
          };
          const r = nucleo.transmissor.conectar(desde, enviar);
          assinatura = r;
          for (const t of r.inicial) controller.enqueue(codificador.encode(t));
        },
        cancel() {
          sair();
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }),
    );
    return new Response(fluxo, { headers: CABECALHOS_SSE });
  });

  app.get('/depurar', (c) => {
    c.header('content-security-policy', CSP_PAGINA);
    c.header('cache-control', 'no-store');
    return c.html(HTML_DEPURAR);
  });

  app.get('/depurar.js', (c) => {
    c.header('content-type', 'text/javascript; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(JS_DEPURAR);
  });

  app.get('/', (c) => {
    c.header('content-security-policy', CSP_PAGINA);
    return c.html(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Arcadia</title></head><body style="font-family: system-ui, sans-serif; background: #0d1117; color: #d6deeb; padding: 16px">' +
        '<h1>Arcadia</h1><p>Servidor de dados no ar. O mundo em pixel art roda pelo Vite durante o desenvolvimento.</p>' +
        '<p><a style="color: #6fd3ff" href="/depurar">Página de depuração</a> (alas, salas e agentes ao vivo, só dados saneados).</p>' +
        '</body></html>',
    );
  });

  app.notFound((c) => c.text('Não encontrado.', 404));
  return { app, bloqueados: () => guarda.mascarados + nucleo.transmissor.bloqueados() };
}
