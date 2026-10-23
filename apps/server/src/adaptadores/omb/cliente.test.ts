// Testes do cliente do OpenMausBot contra um servidor falso local: lista fixa de rotas, só GET, sem cabeçalhos
// que tiram a confiança de loopback. Nenhuma chamada ao app de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { descobrirOmb, lerJson, rotaPermitida, RotaProibida } from './cliente.ts';
import { pastaTemporaria } from '../../testes/apoio.ts';

test('lista fixa de rotas', () => {
  for (const ok of ['/.well-known/openmausbot/environment', '/api/health', '/api/bots?messages=0', '/api/team-map', '/api/today', '/api/today?since=1792000000000', '/api/routines?from=1&to=2', '/api/threads/abc-123/job', '/api/threads/abc/job?scope=job', '/api/events?screens=off']) {
    assert.equal(rotaPermitida(ok), true, ok);
  }
  for (const nao of ['/api/bots', '/api/bots?messages=1', '/api/bots?messages=0&x=1', '/api/usage', '/api/plan-usage', '/api/threads/abc/messages', '/api/events', '/api/events?screens=on', '/api/auth/pair', '/api/instances', '/api/threads/../job']) {
    assert.equal(rotaPermitida(nao), false, nao);
  }
});

test('lerJson recusa rota fora da lista e o SSE (que tem caminho próprio)', async () => {
  await assert.rejects(lerJson(1, '/api/bots'), RotaProibida);
  await assert.rejects(lerJson(1, '/api/events?screens=off'), RotaProibida);
});

test('descoberta: só GET, sem Origin nem Sec-Fetch, e confere o environment-id sem expor o valor', async () => {
  const pedidos: { metodo?: string; url?: string; cabecalhos: http.IncomingHttpHeaders }[] = [];
  const falso = http.createServer((req, res) => {
    pedidos.push({ metodo: req.method, url: req.url, cabecalhos: req.headers });
    if (req.url === '/.well-known/openmausbot/environment') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ environmentId: 'env-inventado-1', version: '0.1.999', label: 'x', platform: 'win32', capabilities: [] }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => falso.listen(0, '127.0.0.1', () => r()));
  const porta = (falso.address() as AddressInfo).port;
  const pasta = pastaTemporaria();
  try {
    fs.mkdirSync(path.join(pasta.caminho, '.openmausbot'), { recursive: true });
    fs.writeFileSync(path.join(pasta.caminho, '.openmausbot', 'environment-id'), 'env-inventado-1\n');
    const r = await descobrirOmb([1, porta], pasta.caminho, 500);
    assert.deepEqual(r.encontrado, { porta, versao: '0.1.999', confereComArquivo: true });
    assert.equal(r.tentativas[0]?.resultado, 'nada ouvindo');
    assert.equal(pedidos.length, 1);
    const p = pedidos[0];
    assert.equal(p?.metodo, 'GET');
    for (const proibido of ['origin', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'x-forwarded-for', 'x-forwarded-host', 'authorization', 'cookie']) {
      assert.equal(p?.cabecalhos[proibido], undefined, proibido);
    }
    assert.ok(!JSON.stringify(r).includes('env-inventado-1'), 'o id não sai, só a igualdade');
  } finally {
    falso.close();
    pasta.remover();
  }
});
