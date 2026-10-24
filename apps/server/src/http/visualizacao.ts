// Listener da visualização (por enquanto 127.0.0.1:4780): o mundo (build estático de apps/world/dist), snapshot com
// gzip, SSE (com teto por endereço e total), a página de depuração e o pacote local de personagens (só para o PC).
// Só dados saneados no snapshot e no SSE. Host conferido (contra DNS rebinding) e nada de CORS: outra origem não lê
// as respostas.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Hono, type Context } from 'hono';
import { protegerSaida, type Adeus, type Contador, type MotivoAdeus, type Snapshot } from '@arcadia/shared';
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
/**
 * CSP do mundo, sem 'unsafe-eval': o mundo importa o módulo pixi.js/unsafe-eval, e o PixiJS 8 não precisa mais gerar
 * funções na partida.
 */
export const CSP_MUNDO =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Tipos que o build do mundo usa (Vite: JS, CSS e fontes; PNG, WebP e JSON para arte e dados). Outro tipo não sai. */
const TIPOS_DO_MUNDO: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const TIPOS_HTML: Readonly<Record<string, string>> = { '.html': 'text/html; charset=utf-8' };
const COMPRIMIVEIS = new Set(['.js', '.css', '.json']);
/** Nome de arquivo do build: um pedaço só, sem barra nem contrabarra, sem começar com ponto. */
const NOME_DO_BUILD = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Nome com o hash do Vite (nome-XXXXXXXX.ext): o conteúdo daquele nome nunca muda, então o cache pode ser longo. */
const COM_HASH = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const CACHE_LONGO = 'public, max-age=31536000, immutable';
const LIMITE_ARQUIVO_DO_MUNDO = 16 * 1024 * 1024;
/** Versões com gzip guardadas (JS e CSS do build); a mais antiga sai quando passa disso. */
const LIMITE_GZIPS = 64;

const HTML_SEM_BUILD =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Arcadia: falta o build do mundo</title></head>' +
  '<body style="font-family: system-ui, sans-serif; background: #0d1117; color: #d6deeb; padding: 16px; line-height: 1.5">' +
  '<h1>Arcadia</h1><p>O servidor de dados está no ar, mas o mundo ainda não foi gerado.</p>' +
  '<p>Na raiz do repositório, rode <code>npm run build:mundo</code> e recarregue esta página.</p>' +
  '<p><a style="color: #6fd3ff" href="/depurar">Página de depuração</a> (alas, salas e agentes ao vivo, só dados saneados).</p>' +
  '</body></html>';

/** Endereços do próprio PC, como o socket os informa (os mesmos do plugin do Vite). */
const DO_PROPRIO_PC = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LIMITE_PACOTE = 8 * 1024 * 1024;

export type OpcoesVisualizacao = {
  nucleo: Nucleo;
  relogio: Relogio;
  hostsExtras?: ReadonlySet<string>;
  limiteSse?: number;
  limiteSsePorIp?: number;
  /** Pasta do build do mundo (apps/world/dist). Sem build, a raiz explica como gerar. */
  dirMundo?: string;
  /** Arquivo do pacote local de personagens (já resolvido; nunca caminho de rede). Servido só para o próprio PC. */
  pacoteLocal?: string;
};

/** Endereço de quem conectou (o socket de verdade; cabeçalho nenhum é confiável para isso). */
function enderecoDe(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const ip = env?.incoming?.socket?.remoteAddress;
  return typeof ip === 'string' && ip.length > 0 ? ip.replace(/^::ffff:/i, '') : 'desconhecido';
}

/** O pedido veio do próprio PC? Só o endereço do socket conta; sem socket, não. */
function doProprioPc(c: Context): boolean {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const ip = env?.incoming?.socket?.remoteAddress;
  return typeof ip === 'string' && DO_PROPRIO_PC.has(ip.toLowerCase());
}

export function lerDesde(valor: string | undefined | null): number | undefined {
  if (valor === undefined || valor === null || !/^\d{1,16}$/.test(valor.trim())) return undefined;
  return Number(valor.trim());
}

type ArquivoDoBuild = { caminho: string; tamanho: number; modificadoEm: number };

/**
 * Arquivo do build do mundo, ou nada. Guardas, nesta ordem: nome simples (um pedaço, sem ".."); extensão da lista;
 * caminho real (seguindo atalhos) direto dentro da pasta; arquivo comum (nem pasta, nem dispositivo), de tamanho razoável.
 */
export async function arquivoDoBuild(pasta: string, nome: string, tipos: Readonly<Record<string, string>>): Promise<ArquivoDoBuild | undefined> {
  if (!NOME_DO_BUILD.test(nome) || nome.includes('..')) return undefined;
  if (!Object.hasOwn(tipos, path.extname(nome).toLowerCase())) return undefined;
  try {
    const raiz = await fs.promises.realpath(pasta);
    const real = await fs.promises.realpath(path.join(raiz, nome));
    if (path.dirname(real) !== raiz) return undefined;
    const st = await fs.promises.stat(real);
    if (!st.isFile() || st.size > LIMITE_ARQUIVO_DO_MUNDO) return undefined;
    return { caminho: real, tamanho: st.size, modificadoEm: st.mtimeMs };
  } catch {
    return undefined;
  }
}

/** Lê o pacote local: arquivo comum, até 8 MB, JSON válido. Caminho de rede nunca é lido. O conteúdo não vai a log nenhum. */
async function lerPacoteLocal(arquivo: string): Promise<string | undefined> {
  if (/^[\\/]{2}/.test(arquivo)) return undefined;
  try {
    const st = await fs.promises.stat(arquivo);
    if (!st.isFile() || st.size > LIMITE_PACOTE) return undefined;
    let texto = await fs.promises.readFile(arquivo, 'utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    JSON.parse(texto);
    return texto;
  } catch {
    return undefined;
  }
}

export type AppVisualizacao = { app: Hono; bloqueados(): number };

export function criarAppVisualizacao(op: OpcoesVisualizacao): AppVisualizacao {
  const { nucleo, relogio } = op;
  const app = new Hono();
  const guarda: Contador = { mascarados: 0 };
  const limiteTotal = Math.max(1, op.limiteSse ?? LIMITE_CONEXOES_SSE);
  const limitePorIp = Math.max(1, op.limiteSsePorIp ?? LIMITE_SSE_POR_IP);
  /** Conexões SSE abertas, na ordem de chegada. */
  const conexoesSse: { ip: string; derrubar(motivo?: MotivoAdeus): void }[] = [];
  const gzips = new Map<string, { chave: string; dados: Buffer }>();

  /**
   * Vaga para uma conexão nova deste endereço (a mais nova sempre ganha): com o teto dele cheio, cai a mais antiga
   * dele; com o teto total cheio, cai a mais antiga do endereço com mais conexões. A derrubada recebe antes um
   * `event: adeus` com o motivo e não reconecta sozinha (senão cada volta derrubaria outra, num rodízio sem fim):
   * a aba diz que o Arcadia está aberto em outras abas e volta com um toque.
   */
  function abrirVaga(ip: string): void {
    for (let doIp = conexoesSse.filter((x) => x.ip === ip); doIp.length >= limitePorIp; doIp = conexoesSse.filter((x) => x.ip === ip)) {
      doIp[0]?.derrubar('outra-aba');
    }
    while (conexoesSse.length >= limiteTotal) {
      const porIp = new Map<string, number>();
      for (const x of conexoesSse) porIp.set(x.ip, (porIp.get(x.ip) ?? 0) + 1);
      const maior = Math.max(...porIp.values());
      const alvo = conexoesSse.find((x) => porIp.get(x.ip) === maior);
      if (!alvo) break;
      alvo.derrubar('muitas-conexoes');
    }
  }

  /** Versão com gzip, guardada por caminho, tamanho e data (um build novo troca o nome ou a data). */
  function comGzip(arq: ArquivoDoBuild, dados: Buffer): Buffer {
    const chave = `${arq.tamanho}:${arq.modificadoEm}`;
    const guardado = gzips.get(arq.caminho);
    if (guardado?.chave === chave) return guardado.dados;
    const comprimido = gzipSync(dados);
    gzips.delete(arq.caminho);
    gzips.set(arq.caminho, { chave, dados: comprimido });
    if (gzips.size > LIMITE_GZIPS) gzips.delete(gzips.keys().next().value as string);
    return comprimido;
  }

  /** Um arquivo do build (já passado pelas guardas), com gzip para quem aceita. */
  async function servirDoBuild(c: Context, pasta: string, nome: string, tipos: Readonly<Record<string, string>>, cabecalhos: Record<string, string>): Promise<Response | undefined> {
    const arq = await arquivoDoBuild(pasta, nome, tipos);
    if (!arq) return undefined;
    const ext = path.extname(arq.caminho).toLowerCase();
    let dados: Buffer;
    try {
      dados = await fs.promises.readFile(arq.caminho);
    } catch {
      return undefined;
    }
    const h: Record<string, string> = { 'content-type': tipos[ext] ?? 'application/octet-stream', ...cabecalhos };
    if (COMPRIMIVEIS.has(ext)) {
      h['vary'] = 'accept-encoding';
      if (/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) {
        dados = comGzip(arq, dados);
        h['content-encoding'] = 'gzip';
      }
    }
    return new Response(dados, { headers: h });
  }

  /** Página do mundo (o HTML vai sem cache: é ele que aponta para os arquivos com hash do build da vez). */
  async function paginaDoMundo(c: Context, nome: 'index.html' | 'prototipos.html'): Promise<Response> {
    const r = op.dirMundo
      ? await servirDoBuild(c, op.dirMundo, nome, TIPOS_HTML, { 'cache-control': 'no-store', 'content-security-policy': CSP_MUNDO })
      : undefined;
    if (r) return r;
    c.header('content-security-policy', CSP_PAGINA);
    c.header('cache-control', 'no-store');
    return c.html(HTML_SEM_BUILD, 503);
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
            /** Com motivo, a conexão leva o adeus antes de fechar; sem (cliente lento), só fecha e o cliente reconecta. */
            derrubar(motivo?: MotivoAdeus) {
              if (motivo !== undefined) {
                const adeus: Adeus = { motivo };
                try {
                  controller.enqueue(codificador.encode(`event: adeus\ndata: ${JSON.stringify(adeus)}\n\n`));
                } catch {
                  // já fechado
                }
              }
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

  // O mundo: as duas páginas do build (/ e /prototipos) e os arquivos dele. Lidos do disco a cada pedido, então um
  // build novo vale sem reiniciar o servidor.
  app.get('/', (c) => paginaDoMundo(c, 'index.html'));
  app.get('/index.html', (c) => paginaDoMundo(c, 'index.html'));
  app.get('/prototipos', (c) => paginaDoMundo(c, 'prototipos.html'));
  app.get('/prototipos.html', (c) => paginaDoMundo(c, 'prototipos.html'));
  app.get('/assets/:arquivo', async (c) => {
    const nome = c.req.param('arquivo');
    const r = op.dirMundo
      ? await servirDoBuild(c, path.join(op.dirMundo, 'assets'), nome, TIPOS_DO_MUNDO, { 'cache-control': COM_HASH.test(nome) ? CACHE_LONGO : 'no-cache' })
      : undefined;
    return r ?? c.text('Não encontrado.', 404, { 'cache-control': 'no-store' });
  });

  // Pacote local de personagens, nos mesmos caminhos do plugin do Vite (/local/...): só para o próprio PC até o
  // pareamento da Fase 4. Outro endereço recebe 403, tenha o arquivo ou não. Só /local/personagens.json existe aqui.
  app.get('/local/*', async (c) => {
    c.header('cache-control', 'no-store');
    if (!doProprioPc(c)) return c.text('Só no próprio PC.', 403);
    if (c.req.path !== '/local/personagens.json' || op.pacoteLocal === undefined) return c.text('Não existe.', 404);
    const conteudo = await lerPacoteLocal(op.pacoteLocal);
    if (conteudo === undefined) return c.text('Não existe.', 404);
    return c.body(conteudo, 200, { 'content-type': 'application/json; charset=utf-8' });
  });

  app.notFound((c) => c.text('Não encontrado.', 404, { 'cache-control': 'no-store' }));
  return { app, bloqueados: () => guarda.mascarados + nucleo.transmissor.bloqueados() };
}
