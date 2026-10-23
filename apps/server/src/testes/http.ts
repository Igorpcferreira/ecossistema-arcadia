// Apoio aos testes de HTTP: GET cru (sem descompactar sozinho) e leitor de SSE. Tudo tem prazo: um fluxo que não
// termina (SSE sem teto, por exemplo) faz o teste falhar, em vez de deixar a suíte parada.
import http from 'node:http';

export type Resposta = { status: number; headers: http.IncomingHttpHeaders; corpo: Buffer };

/** GET (ou outro método) com a resposta inteira. Passou de `limiteMs` sem terminar: a conexão cai e a promessa falha. */
export function obter(porta: number, caminho: string, cabecalhos: Record<string, string> = {}, metodo = 'GET', limiteMs = 15_000): Promise<Resposta> {
  return new Promise((resolver, rejeitar) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        clearTimeout(prazo);
        resolver({ status: res.statusCode ?? 0, headers: res.headers, corpo: Buffer.concat(partes) });
      });
      res.on('error', rejeitar);
    });
    const prazo = setTimeout(() => {
      req.destroy();
      rejeitar(new Error(`${caminho}: a resposta não terminou em ${limiteMs} ms`));
    }, limiteMs);
    req.on('error', (e) => {
      clearTimeout(prazo);
      rejeitar(e);
    });
    req.end();
  });
}

export type MensagemSse = { event?: string; id?: number; retry?: number; data?: string };

export function lerSse(texto: string): MensagemSse[] {
  return texto
    .split('\n\n')
    .filter((b) => b.trim().length > 0)
    .map((bloco) => {
      const m: MensagemSse = {};
      for (const linha of bloco.split('\n')) {
        const i = linha.indexOf(': ');
        if (i < 0) continue;
        const campo = linha.slice(0, i);
        const valor = linha.slice(i + 2);
        if (campo === 'event') m.event = valor;
        else if (campo === 'id') m.id = Number(valor);
        else if (campo === 'retry') m.retry = Number(valor);
        else if (campo === 'data') m.data = (m.data !== undefined ? `${m.data}\n` : '') + valor;
      }
      return m;
    });
}

export type ConexaoSse = {
  texto(): string;
  status: number;
  headers: http.IncomingHttpHeaders;
  /** O servidor encerrou o fluxo (conexão derrubada pelo teto, por exemplo). */
  encerrada(): boolean;
  fechar(): void;
};

/** Abre um SSE e resolve quando os cabeçalhos chegam (o corpo segue chegando em `texto()`). */
export function abrirSse(porta: number, caminho = '/api/events', cabecalhos: Record<string, string> = {}, limiteMs = 10_000): Promise<ConexaoSse> {
  return new Promise((resolver, rejeitar) => {
    let acumulado = '';
    let fim = false;
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: 'GET', headers: { accept: 'text/event-stream', ...cabecalhos } }, (res) => {
      clearTimeout(prazo);
      res.setEncoding('utf8');
      res.on('data', (c: string) => (acumulado += c));
      res.on('end', () => (fim = true));
      res.on('close', () => (fim = true));
      res.on('error', () => {});
      resolver({ texto: () => acumulado, status: res.statusCode ?? 0, headers: res.headers, encerrada: () => fim, fechar: () => req.destroy() });
    });
    const prazo = setTimeout(() => {
      req.destroy();
      rejeitar(new Error(`${caminho}: sem cabeçalhos em ${limiteMs} ms`));
    }, limiteMs);
    req.on('error', (e) => {
      clearTimeout(prazo);
      if ((e as { code?: string }).code !== 'ECONNRESET') rejeitar(e);
    });
    req.end();
  });
}

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera a condição valer (conferida a cada 10 ms), no máximo `limiteMs`. Devolve se valeu. */
export async function esperarQue(condicao: () => boolean, limiteMs = 3_000): Promise<boolean> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await esperar(10);
  }
  return condicao();
}
