// Abre um listener HTTP para um app Hono (ou para quem atende no lugar dele), com mensagem em português quando a
// porta já está ocupada.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import type { Hono } from 'hono';

export class ErroPorta extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPorta';
  }
}

/** Quem atende os pedidos de um listener: o fetch de um app Hono ou um despacho que repassa para ele. */
export type Atendimento = Parameters<typeof createAdaptorServer>[0]['fetch'];

export type Ouvinte = { host: string; porta: number; fechar(): Promise<void> };

export function ouvir(app: Hono | Atendimento, host: string, porta: number, nome: string): Promise<Ouvinte> {
  const servidor = createAdaptorServer({ fetch: typeof app === 'function' ? app : app.fetch }) as Server;
  return new Promise((resolver, rejeitar) => {
    const falhou = (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') rejeitar(new ErroPorta(`A porta ${porta} (${nome}) já está em uso por outro programa. Feche esse programa ou mude a porta na configuração.`));
      else if (e.code === 'EACCES') rejeitar(new ErroPorta(`Sem permissão para abrir a porta ${porta} (${nome}).`));
      else rejeitar(new ErroPorta(`Não consegui abrir a porta ${porta} (${nome}): ${e.code ?? 'erro desconhecido'}.`));
    };
    servidor.once('error', falhou);
    servidor.listen(porta, host, () => {
      servidor.off('error', falhou);
      const endereco = servidor.address() as AddressInfo;
      resolver({
        host,
        porta: endereco.port,
        fechar: () =>
          new Promise<void>((pronto) => {
            servidor.closeAllConnections();
            servidor.close(() => pronto());
          }),
      });
    });
  });
}
