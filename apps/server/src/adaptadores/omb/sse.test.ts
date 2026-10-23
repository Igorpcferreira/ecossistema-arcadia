// Cliente do SSE do OpenMausBot: um quadro que quebra quem o trata não sobe até o evento de dados do socket (o que
// derrubaria o processo); o fluxo segue com os próximos quadros. Servidor local de teste, porta livre, dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { abrirSseOmb, type QuadroSse } from './sse.ts';
import { relogioReal } from '../../util/relogio.ts';

test('quadro que quebra quem o trata: o cliente avisa e segue com o próximo', { timeout: 10_000 }, async () => {
  const servidor = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('id: 1\ndata: {"n":1}\n\n');
    setTimeout(() => res.write('id: 2\ndata: {"n":2}\n\n'), 50);
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', () => pronto()));
  const porta = (servidor.address() as AddressInfo).port;
  const recebidos: QuadroSse[] = [];
  let falhas = 0;
  let conexao: { fechar(): void } | undefined;
  try {
    await new Promise<void>((pronto, falhou) => {
      conexao = abrirSseOmb({
        porta,
        relogio: relogioReal(),
        aoQuadro: (q) => {
          recebidos.push(q);
          if (recebidos.length === 1) throw new Error('defeito inventado no tratamento do quadro');
          pronto();
        },
        aoFalhaNoQuadro: () => falhas++,
        aoFim: (motivo) => falhou(new Error(`o fluxo acabou antes do segundo quadro: ${motivo}`)),
      });
    });
    assert.equal(falhas, 1, 'a falha do primeiro quadro foi contada');
    assert.deepEqual(recebidos.map((q) => q.id), ['1', '2'], 'o segundo quadro chegou pelo mesmo fluxo');
  } finally {
    conexao?.fechar();
    servidor.closeAllConnections();
    await new Promise<void>((pronto) => servidor.close(() => pronto()));
  }
});
