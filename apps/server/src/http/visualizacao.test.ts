// Testes do mundo servido pela visualização (build estático) e do pacote local de personagens. Build e pacote
// inventados numa pasta temporária; o endereço de quem pede vem do socket, como no servidor de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Hono } from 'hono';
import { CSP_MUNDO, criarAppVisualizacao } from './visualizacao.ts';
import { ouvir } from './servir.ts';
import { criarNucleo } from '../nucleo.ts';
import { validarConfig } from '../config/carregar.ts';
import { relogioReal } from '../util/relogio.ts';
import { criarLog } from '../util/log.ts';
import { ambienteFalso } from '../testes/casa.ts';
import { pastaTemporaria } from '../testes/apoio.ts';
import { obter } from '../testes/http.ts';

const SEGREDO = 'SEGREDO-FORA-DA-PASTA-qz7';
const JS_COM_HASH = `console.log("mundo-ok");\n${'// enchimento para o gzip valer a pena\n'.repeat(200)}`;
const PACOTE = JSON.stringify({ versao: 1, personagens: [{ papel: 'humano', nome: 'Canario Pacote Zq', curto: 'CPZ', aparencia: 'androide', falas: ['frase canario zq'] }] });

type Montagem = { pasta: ReturnType<typeof pastaTemporaria>; dist: string; pacote: string; app: Hono; parar(): void };

/** Build inventado (com armadilhas dentro e fora da pasta) e o app da visualização apontado para ele. */
function montar(opcoes: { semBuild?: boolean; pacoteLocal?: string | null } = {}): Montagem {
  const pasta = pastaTemporaria();
  const dist = path.join(pasta.caminho, 'dist');
  const assets = path.join(dist, 'assets');
  if (!opcoes.semBuild) {
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>MUNDO-OK</title><script type="module" src="/assets/app-AbCdEf12.js"></script>');
    fs.writeFileSync(path.join(dist, 'prototipos.html'), '<!doctype html><title>PROTOTIPOS-OK</title>');
    fs.writeFileSync(path.join(assets, 'app-AbCdEf12.js'), JS_COM_HASH);
    fs.writeFileSync(path.join(assets, 'fonte-Zz9_x8Yq.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]));
    fs.writeFileSync(path.join(assets, 'semhash.js'), 'console.log("sem hash");');
    // Armadilhas: arquivo oculto com extensão aceita, extensão fora da lista, pasta com nome de arquivo, arquivo do
    // build fora de assets e arquivo fora do build.
    fs.writeFileSync(path.join(assets, '.oculto.js'), SEGREDO);
    fs.writeFileSync(path.join(assets, 'segredo.txt'), SEGREDO);
    fs.mkdirSync(path.join(assets, 'pasta-AbCdEf12.js'));
    fs.writeFileSync(path.join(dist, 'segredo-raiz.js'), SEGREDO);
  }
  fs.writeFileSync(path.join(pasta.caminho, 'segredo.js'), SEGREDO);
  const pacote = path.join(pasta.caminho, 'pacote', 'personagens.json');
  fs.mkdirSync(path.dirname(pacote), { recursive: true });
  fs.writeFileSync(pacote, PACOTE);
  const amb = ambienteFalso(path.join(pasta.caminho, 'casa'));
  const nucleo = criarNucleo({ config: validarConfig({ versao: 1 }, amb).config, relogio: relogioReal(), amb, buildId: 't', instancia: 't', log: criarLog({ silencioso: true }) });
  const pacoteLocal = opcoes.pacoteLocal === null ? undefined : (opcoes.pacoteLocal ?? pacote);
  const vis = criarAppVisualizacao({ nucleo, relogio: relogioReal(), dirMundo: dist, ...(pacoteLocal !== undefined ? { pacoteLocal } : {}) });
  return {
    pasta,
    dist,
    pacote,
    app: vis.app,
    parar() {
      nucleo.parar();
      pasta.remover();
    },
  };
}

/** Pedido direto no app. `ip` é o endereço do socket (null = sem socket). */
async function pedir(app: Hono, caminho: string, op: { ip?: string | null; host?: string; cabecalhos?: Record<string, string> } = {}) {
  const env = op.ip === null ? {} : { incoming: { socket: { remoteAddress: op.ip ?? '127.0.0.1' } } };
  const res = await app.fetch(new Request(`http://127.0.0.1:4790${caminho}`, { headers: { host: op.host ?? '127.0.0.1:4790', ...op.cabecalhos } }), env);
  const corpo = Buffer.from(await res.arrayBuffer());
  return { status: res.status, h: res.headers, corpo, texto: corpo.toString('utf8') };
}

test('mundo: / e /prototipos servem o build sem cache e com a CSP do mundo; asset com hash tem cache longo e gzip', async () => {
  const m = montar();
  try {
    for (const [rota, marca] of [['/', 'MUNDO-OK'], ['/index.html', 'MUNDO-OK'], ['/prototipos', 'PROTOTIPOS-OK'], ['/prototipos.html', 'PROTOTIPOS-OK']] as const) {
      const r = await pedir(m.app, rota);
      assert.equal(r.status, 200, rota);
      assert.ok(r.texto.includes(marca), rota);
      assert.equal(r.h.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(r.h.get('cache-control'), 'no-store', `${rota}: o HTML vai sem cache`);
      assert.equal(r.h.get('content-security-policy'), CSP_MUNDO);
      assert.equal(r.h.get('x-content-type-options'), 'nosniff');
      assert.equal(r.h.get('x-frame-options'), 'DENY');
    }
    assert.match(CSP_MUNDO, /default-src 'self'.*frame-ancestors 'none'/);
    assert.doesNotMatch(CSP_MUNDO, /unsafe-eval/, 'o mundo roda sem gerar funções');
    const js = await pedir(m.app, '/assets/app-AbCdEf12.js');
    assert.equal(js.status, 200);
    assert.equal(js.texto, JS_COM_HASH);
    assert.equal(js.h.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(js.h.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(js.h.get('vary'), 'accept-encoding');
    const gz = await pedir(m.app, '/assets/app-AbCdEf12.js', { cabecalhos: { 'accept-encoding': 'gzip, deflate' } });
    assert.equal(gz.h.get('content-encoding'), 'gzip');
    assert.ok(gz.corpo.length < JS_COM_HASH.length / 4, `gzip: ${gz.corpo.length} bytes`);
    assert.equal(gunzipSync(gz.corpo).toString('utf8'), JS_COM_HASH);
    const fonte = await pedir(m.app, '/assets/fonte-Zz9_x8Yq.woff2', { cabecalhos: { 'accept-encoding': 'gzip' } });
    assert.equal(fonte.h.get('content-type'), 'font/woff2');
    assert.equal(fonte.h.get('content-encoding'), null, 'fonte já vem comprimida');
    assert.equal(fonte.h.get('cache-control'), 'public, max-age=31536000, immutable');
    const semHash = await pedir(m.app, '/assets/semhash.js');
    assert.equal(semHash.status, 200);
    assert.equal(semHash.h.get('cache-control'), 'no-cache', 'sem hash no nome, o navegador confere de novo');
    // Build novo (mesmo nome, conteúdo outro): o gzip guardado não serve conteúdo velho.
    fs.writeFileSync(path.join(m.dist, 'assets', 'app-AbCdEf12.js'), `${JS_COM_HASH}// novo\n`);
    const novo = await pedir(m.app, '/assets/app-AbCdEf12.js', { cabecalhos: { 'accept-encoding': 'gzip' } });
    assert.ok(gunzipSync(novo.corpo).toString('utf8').endsWith('// novo\n'));
  } finally {
    m.parar();
  }
});

test('mundo: guarda do estático, nada fora de assets, nada oculto, nada fora da lista, nem pasta', async () => {
  const m = montar();
  try {
    const tentativas = [
      '/assets/..%2Fsegredo-raiz.js', '/assets/..%2F..%2Fsegredo.js', '/assets/..%5Csegredo-raiz.js', '/assets/..%5C..%5Csegredo.js',
      '/assets/%2e%2e%2fsegredo-raiz.js', '/assets/.oculto.js', '/assets/segredo.txt', '/assets/pasta-AbCdEf12.js', '/assets/segredo-raiz.js',
      '/assets/app-AbCdEf12.js%00.png', '/assets/app-AbCdEf12.js%2F', '/assets/sub/app-AbCdEf12.js', '/segredo-raiz.js', '/assets/../segredo.js',
      '/assets/%2e%2e/%2e%2e/segredo.js', '/index.html/..%2F..%2Fsegredo.js', '/assets/', '/assets',
    ];
    for (const rota of tentativas) {
      const r = await pedir(m.app, rota);
      assert.equal(r.status, 404, `${rota} devolveu ${r.status}`);
      assert.ok(!r.texto.includes(SEGREDO), `${rota} vazou o conteúdo`);
      assert.equal(r.h.get('cache-control'), 'no-store', `${rota}: 404 sem cache`);
    }
    // Pelo HTTP de verdade, com o caminho cru na linha do pedido (o cliente não normaliza nada).
    const ouvinte = await ouvir(m.app, '127.0.0.1', 0, 'teste');
    try {
      for (const rota of ['/assets/../segredo-raiz.js', '/assets/../../segredo.js', '/assets/..\\..\\segredo.js', '/assets/..%2F..%2Fsegredo.js', '/assets/.oculto.js', '//segredo.js']) {
        const r = await obter(ouvinte.porta, rota);
        assert.ok(r.status === 404 || r.status === 400, `${rota} devolveu ${r.status}`);
        assert.ok(!r.corpo.toString('utf8').includes(SEGREDO), `${rota} vazou o conteúdo`);
      }
      assert.equal((await obter(ouvinte.porta, '/assets/app-AbCdEf12.js')).status, 200, 'o caminho certo continua servindo');
    } finally {
      await ouvinte.fechar();
    }
    // Host de fora (DNS rebinding) não lê o mundo nem o pacote.
    for (const rota of ['/', '/assets/app-AbCdEf12.js', '/local/personagens.json']) {
      assert.equal((await pedir(m.app, rota, { host: 'exemplo.com:4790' })).status, 403, rota);
    }
  } finally {
    m.parar();
  }
});

test('mundo: link simbólico em assets que aponta para fora da pasta não é servido', async (t) => {
  const m = montar();
  try {
    try {
      fs.symlinkSync(path.join(m.pasta.caminho, 'segredo.js'), path.join(m.dist, 'assets', 'atalho-AbCdEf12.js'), 'file');
    } catch (e) {
      t.skip(`criar link simbólico de arquivo não é permitido aqui (${(e as NodeJS.ErrnoException).code})`);
      return;
    }
    const r = await pedir(m.app, '/assets/atalho-AbCdEf12.js');
    assert.equal(r.status, 404);
    assert.ok(!r.texto.includes(SEGREDO));
  } finally {
    m.parar();
  }
});

test('mundo: sem build, / e /prototipos explicam como gerar (503, sem cache) e os assets são 404', async () => {
  const m = montar({ semBuild: true });
  try {
    for (const rota of ['/', '/prototipos']) {
      const r = await pedir(m.app, rota);
      assert.equal(r.status, 503, rota);
      assert.match(r.texto, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
      assert.ok(r.texto.includes('npm run build:mundo'), rota);
      assert.ok(r.texto.includes('/depurar'));
      assert.equal(r.h.get('cache-control'), 'no-store');
      assert.match(String(r.h.get('content-security-policy')), /script-src 'self';/, 'a página de aviso não roda script nenhum');
    }
    assert.equal((await pedir(m.app, '/assets/app-AbCdEf12.js')).status, 404);
  } finally {
    m.parar();
  }
});

test('pacote local: só para o próprio PC; outro endereço e socket ausente recebem 403, sem o conteúdo', async () => {
  const m = montar();
  try {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const r = await pedir(m.app, '/local/personagens.json', { ip });
      assert.equal(r.status, 200, ip);
      assert.equal(r.texto, PACOTE);
      assert.equal(r.h.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(r.h.get('cache-control'), 'no-store');
      assert.equal(r.h.get('x-content-type-options'), 'nosniff');
    }
    for (const ip of ['192.168.0.50', '10.0.0.2', '::ffff:192.168.0.50', 'fe80::1', '127.0.0.2', '0.0.0.0', '', null]) {
      for (const rota of ['/local/personagens.json', '/local/cenario-local.json', '/local/prancha/arcadia-pixel.html']) {
        const r = await pedir(m.app, rota, { ip });
        assert.equal(r.status, 403, `${rota} para ${String(ip)}`);
        assert.equal(r.texto, 'Só no próprio PC.');
        assert.equal(r.h.get('cache-control'), 'no-store');
      }
    }
  } finally {
    m.parar();
  }
});

test('pacote local: só /local/personagens.json existe; sem pacote, caminho de rede ou JSON quebrado é 404', async () => {
  const m = montar();
  try {
    for (const rota of ['/local/cenario-local.json', '/local/prancha/x.html', '/local/prova/x.js', '/local/', '/local/personagens.json/x', '/local/PERSONAGENS.JSON']) {
      const r = await pedir(m.app, rota);
      assert.equal(r.status, 404, rota);
      assert.ok(!r.texto.includes('Canario'));
    }
    fs.writeFileSync(m.pacote, '{ quebrado');
    assert.equal((await pedir(m.app, '/local/personagens.json')).status, 404, 'JSON quebrado não sai');
    fs.writeFileSync(m.pacote, `${String.fromCharCode(0xfeff)}${PACOTE}`);
    const comBom = await pedir(m.app, '/local/personagens.json');
    assert.equal(comBom.status, 200, 'arquivo salvo com BOM vale');
    assert.equal(comBom.texto, PACOTE);
  } finally {
    m.parar();
  }
  // Host com o domínio reservado .invalid: mesmo que a guarda falhasse, nenhum nome resolveria na rede.
  for (const pacoteLocal of [null, '\\\\servidor.invalid\\pacotes\\personagens.json', '//servidor.invalid/pacotes/personagens.json']) {
    const n = montar({ pacoteLocal });
    try {
      assert.equal((await pedir(n.app, '/local/personagens.json')).status, 404, String(pacoteLocal));
    } finally {
      n.parar();
    }
  }
});
