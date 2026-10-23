// Testes de integração: servidor de verdade em portas livres, banco numa pasta temporária, relógio real.
// O ambiente é inventado (casa e LOCALAPPDATA dentro da pasta do teste): nada da pasta real de quem roda é listado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { EsquemaQuadro, EsquemaSnapshot, MASCARA, type ArcadiaEvent, type Snapshot } from '@arcadia/shared';
import { criarGuardaDoProcesso, iniciarServidor, type GuardaDoProcesso, type Servidor } from './servidor.ts';
import type { Adaptador } from './adaptadores/comum.ts';
import { relogioFalso } from './util/relogio.ts';
import { validarConfig } from './config/carregar.ts';
import type { Config } from './config/esquema.ts';
import { abrirBanco } from './db/banco.ts';
import { reconstruirEstado } from './nucleo.ts';
import { aplicar } from './mundo/motor.ts';
import type { AmbienteCaminhos } from './util/caminhos.ts';
import { ambienteFalso } from './testes/casa.ts';
import { criarLog } from './util/log.ts';
import { json, pastaTemporaria } from './testes/apoio.ts';
import { abrirSse, esperar, esperarQue, lerSse, obter, type ConexaoSse } from './testes/http.ts';

type Contexto = { pasta: ReturnType<typeof pastaTemporaria>; linhas: string[]; projetos: string; config: Config };

function configDeTeste(projetos: string, amb: AmbienteCaminhos, extra: Record<string, unknown> = {}): Config {
  const barra = (p: string) => p.replace(/\\/g, '/');
  return validarConfig(
    {
      versao: 1,
      alas: [{ id: 'produtos', nome: 'Produtos', cor: '#c9a7ff', regras: [`${barra(projetos)}/produto-*/**`] }],
      salas: { pastasAgregadoras: [barra(projetos)], excluir: ['**/segredos/**'] },
      ...extra,
    },
    amb,
  ).config;
}

type OpcoesTeste = {
  pasta?: ReturnType<typeof pastaTemporaria>;
  manterPasta?: boolean;
  extra?: Record<string, unknown>;
  simulador?: Parameters<typeof iniciarServidor>[0]['simulador'];
  guarda?: GuardaDoProcesso;
};

async function comServidor(fn: (s: Servidor, ctx: Contexto) => Promise<void>, opcoes: OpcoesTeste = {}): Promise<void> {
  const pasta = opcoes.pasta ?? pastaTemporaria();
  const linhas: string[] = [];
  const projetos = path.join(pasta.caminho, 'projetos');
  fs.mkdirSync(path.join(projetos, 'produto-alfa', '.git'), { recursive: true });
  const amb = ambienteFalso(path.join(pasta.caminho, 'casa'));
  const config = configDeTeste(projetos, amb, opcoes.extra);
  const s = await iniciarServidor({
    carregada: { config, arquivo: 'teste.yaml', descricao: 'configuração de teste', origem: 'argumento', avisos: [] },
    amb,
    log: criarLog({ saida: (l) => linhas.push(l) }),
    dirDados: pasta.caminho,
    portas: { ingestao: 0, visualizacao: 0 },
    semSondarOmb: true,
    buildId: 'teste-1',
    ...(opcoes.simulador ? { simulador: opcoes.simulador } : {}),
    ...(opcoes.guarda ? { guarda: opcoes.guarda } : {}),
  });
  try {
    await fn(s, { pasta, linhas, projetos, config });
  } finally {
    await s.parar();
    if (!opcoes.manterPasta) pasta.remover();
  }
}

let n = 0;
function evento(tipo: ArcadiaEvent['tipo'], extra: Partial<ArcadiaEvent> = {}): ArcadiaEvent {
  n++;
  const agora = Date.now();
  return { v: 1, id: `int:${n}:${agora}`, ts: agora, recebidoEm: agora, origem: 'sim', motor: 'claude', agente: { chave: 'sim:int', tipo: 'sessao' }, local: {}, tipo, ...extra };
}

async function snapshot(porta: number): Promise<Snapshot> {
  const r = await obter(porta, '/api/snapshot', { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  return EsquemaSnapshot.parse(JSON.parse(gunzipSync(r.corpo).toString('utf8')));
}

test('snapshot com gzip, seq e buildId; sem gzip também responde', async () => {
  await comServidor(async (s) => {
    const snap = await snapshot(s.visualizacao.porta);
    assert.equal(snap.buildId, 'teste-1');
    assert.ok(snap.seq >= s.nucleo.iniciadoEm);
    assert.deepEqual(Object.keys(snap.estado.alas), ['recepcao', 'produtos']);
    const cru = await obter(s.visualizacao.porta, '/api/snapshot');
    assert.equal(cru.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(cru.corpo.toString('utf8')).v, 1);
  });
});

test('SSE: retry, ola, quadro com id e retomada pelo Last-Event-ID', { timeout: 30_000 }, async () => {
  await comServidor(async (s, ctx) => {
    const porta = s.visualizacao.porta;
    const c = await abrirSse(porta);
    assert.equal(c.status, 200);
    assert.match(String(c.headers['content-type']), /text\/event-stream/);
    await esperar(50);
    s.nucleo.ingerir({ evento: evento('sessao.inicio'), caminhos: { cwd: path.join(ctx.projetos, 'produto-alfa', 'src') } });
    await esperar(450);
    const msgs = lerSse(c.texto());
    assert.equal(msgs[0]?.retry, 3000);
    assert.equal(msgs[1]?.event, 'ola');
    const quadros = msgs.filter((m) => m.event === 'mundo');
    assert.equal(quadros.length, 1, 'um evento, um quadro');
    const q = EsquemaQuadro.parse(JSON.parse(quadros[0]?.data ?? ''));
    assert.equal(quadros[0]?.id, q.seq);
    const tipos = q.mudancas.map((m) => m.k);
    for (const k of ['sala', 'obra', 'agente', 'evento']) assert.ok(tipos.includes(k as never), `faltou ${k}: ${tipos.join(', ')}`);
    const sala = q.mudancas.find((m) => m.k === 'sala');
    assert.ok(sala && sala.k === 'sala');
    if (sala?.k === 'sala') {
      assert.equal(sala.sala.nome, 'produto-alfa');
      assert.equal(sala.sala.alaId, 'produtos');
    }
    c.fechar();
    const emDia = await abrirSse(porta, '/api/events', { 'last-event-id': String(q.seq) });
    await esperar(100);
    assert.ok(!emDia.texto().includes('event: resync') && !emDia.texto().includes('event: mundo'));
    emDia.fechar();
    const anterior = await abrirSse(porta, '/api/events', { 'last-event-id': String(q.seq - 1) });
    await esperar(100);
    assert.equal(lerSse(anterior.texto()).filter((m) => m.event === 'mundo').length, 1, 'o buffer devolve o quadro perdido');
    anterior.fechar();
    const velho = await abrirSse(porta, `/api/events?desde=${q.seq - 500}`);
    await esperar(100);
    assert.ok(velho.texto().includes('event: resync'));
    velho.fechar();
  });
});

test('Host estranho é recusado, escrita é recusada, página de depuração tem viewport', async () => {
  await comServidor(async (s) => {
    assert.equal((await obter(s.visualizacao.porta, '/api/snapshot', { host: 'exemplo.com' })).status, 403);
    assert.equal((await obter(s.ingestao.porta, '/saude', { host: 'exemplo.com:47800' })).status, 403);
    assert.equal((await obter(s.visualizacao.porta, '/api/snapshot', {}, 'POST')).status, 405);
    assert.equal((await obter(s.ingestao.porta, '/saude', { origin: 'https://exemplo.com' })).status, 403);
    const pagina = await obter(s.visualizacao.porta, '/depurar');
    const html = pagina.corpo.toString('utf8');
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(String(pagina.headers['content-security-policy']), /default-src 'self'/);
    const js = await obter(s.visualizacao.porta, '/depurar.js');
    assert.equal(js.status, 200);
    assert.match(js.corpo.toString('utf8'), /textContent/);
    assert.ok(!js.corpo.toString('utf8').includes('innerHTML'));
  });
});

test('HEAD no SSE não deixa assinante pendurado', { timeout: 30_000 }, async () => {
  await comServidor(async (s) => {
    const porta = s.visualizacao.porta;
    for (let i = 0; i < 20; i++) {
      const r = await obter(porta, '/api/events', {}, 'HEAD');
      assert.equal(r.status, 200);
      assert.match(String(r.headers['content-type']), /text\/event-stream/);
    }
    await esperar(100);
    assert.equal(s.nucleo.transmissor.conexoes(), 0, 'HEAD respondido não cria fluxo');
    const c = await abrirSse(porta);
    await esperar(50);
    assert.equal(s.nucleo.transmissor.conexoes(), 1);
    c.fechar();
    await esperar(100);
    assert.equal(s.nucleo.transmissor.conexoes(), 0, 'GET que desconecta sai da lista');
  });
});

/** Visualização sozinha numa porta livre (para os testes do teto do SSE). */
async function visualizacaoAvulsa(opcoes: { limiteSse?: number; limiteSsePorIp?: number } = {}) {
  const { criarAppVisualizacao } = await import('./http/visualizacao.ts');
  const { ouvir } = await import('./http/servir.ts');
  const { criarNucleo } = await import('./nucleo.ts');
  const { relogioReal } = await import('./util/relogio.ts');
  const p = pastaTemporaria();
  const amb = ambienteFalso(path.join(p.caminho, 'casa'));
  const nucleo = criarNucleo({ config: configDeTeste(path.join(p.caminho, 'projetos'), amb), relogio: relogioReal(), amb, buildId: 't', instancia: 't', log: criarLog({ silencioso: true }) });
  const vis = criarAppVisualizacao({ nucleo, relogio: relogioReal(), ...opcoes });
  const ouvinte = await ouvir(vis.app, '127.0.0.1', 0, 'teste');
  return {
    nucleo,
    vis,
    porta: ouvinte.porta,
    async fechar() {
      nucleo.parar();
      await ouvinte.fechar();
      p.remover();
    },
  };
}

/**
 * SSE aberto por outro endereço da rede (o celular), direto no app: o endereço vem do socket, como no servidor de
 * verdade. Devolve o status e quem diz se o servidor encerrou o fluxo.
 */
async function sseDe(app: { fetch: (r: Request, env: unknown) => Response | Promise<Response> }, ip: string) {
  const res = await app.fetch(new Request('http://127.0.0.1/api/events', { headers: { host: '127.0.0.1:4780', accept: 'text/event-stream' } }), { incoming: { socket: { remoteAddress: ip } } });
  let encerrado = false;
  const leitor = res.body?.getReader();
  void (async () => {
    try {
      for (;;) {
        const r = await leitor?.read();
        if (!r || r.done) break;
      }
    } catch {
      // cancelado pelo teste
    }
    encerrado = true;
  })();
  return { status: res.status, encerrado: () => encerrado, fechar: () => void leitor?.cancel().catch(() => {}) };
}

test('SSE: 32 conexões do próprio PC deixam só as 4 mais novas, e o celular ainda conecta', { timeout: 30_000 }, async () => {
  const v = await visualizacaoAvulsa();
  const abertas: ConexaoSse[] = [];
  let celular: Awaited<ReturnType<typeof sseDe>> | undefined;
  try {
    for (let i = 0; i < 32; i++) abertas.push(await abrirSse(v.porta));
    assert.ok(abertas.every((c) => c.status === 200), 'nenhuma recusada: a nova entra e a mais antiga do mesmo endereço cai');
    assert.ok(await esperarQue(() => v.nucleo.transmissor.conexoes() === 4), `conexões contadas: ${v.nucleo.transmissor.conexoes()}`);
    assert.ok(await esperarQue(() => abertas.slice(0, 28).every((c) => c.encerrada())), 'as 28 mais antigas foram encerradas pelo servidor');
    assert.ok(abertas.slice(28).every((c) => !c.encerrada()), 'as 4 mais novas seguem abertas');
    celular = await sseDe(v.vis.app, '192.168.0.50');
    assert.equal(celular.status, 200, 'o celular conecta');
    assert.equal(v.nucleo.transmissor.conexoes(), 5);
  } finally {
    celular?.fechar();
    for (const c of abertas) c.fechar();
    await v.fechar();
  }
});

test('SSE no teto total: a nova entra e cai a mais antiga do endereço com mais conexões', { timeout: 30_000 }, async () => {
  const v = await visualizacaoAvulsa({ limiteSse: 6, limiteSsePorIp: 4 });
  const abertas: (Awaited<ReturnType<typeof sseDe>> & { ip: string })[] = [];
  try {
    for (const ip of ['10.0.0.1', '10.0.0.1', '10.0.0.2', '10.0.0.1', '10.0.0.2', '10.0.0.1']) abertas.push({ ...(await sseDe(v.vis.app, ip)), ip });
    assert.equal(v.nucleo.transmissor.conexoes(), 6);
    const nova = await sseDe(v.vis.app, '10.0.0.3');
    abertas.push({ ...nova, ip: '10.0.0.3' });
    assert.equal(nova.status, 200);
    assert.ok(await esperarQue(() => abertas[0]?.encerrado() === true), 'caiu a mais antiga do 10.0.0.1 (o endereço com mais conexões)');
    assert.ok(abertas.slice(1).every((c) => !c.encerrado()), 'as outras seguem abertas');
    assert.equal(v.nucleo.transmissor.conexoes(), 6);
  } finally {
    for (const c of abertas) c.fechar();
    await v.fechar();
  }
});

test('saúde e doctor em português na porta local', { timeout: 30_000 }, async () => {
  await comServidor(async (s) => {
    const saude = JSON.parse((await obter(s.ingestao.porta, '/saude')).corpo.toString('utf8'));
    assert.equal(saude.ok, true);
    assert.equal(saude.buildId, 'teste-1');
    const texto = (await obter(s.ingestao.porta, '/doctor?formato=texto')).corpo.toString('utf8');
    assert.match(texto.split('\n')[0] ?? '', /^Atenção: este relatório mostra nomes de pastas desta máquina\. .*não cole em arquivo do repositório\.$/, 'o aviso vem na primeira linha');
    for (const trecho of ['Arcadia doctor', 'Servidor', 'Configuração', 'Dados', 'Portas', 'Fontes', 'Mundo', 'Saneamento', 'Simulador: desligado', 'OpenMausBot: não sondado', 'Banco arcadia.sqlite']) {
      assert.ok(texto.includes(trecho), `faltou "${trecho}" no doctor:\n${texto}`);
    }
    const d = JSON.parse((await obter(s.ingestao.porta, '/doctor')).corpo.toString('utf8'));
    assert.equal(d.servidor.rodando, true);
    assert.equal(d.dados.banco.modo, 'wal');
  });
});

test('guarda do processo: exceção nos últimos 10 min deixa a saúde em ok falso, o doctor mostra e o log fala uma vez por minuto', { timeout: 30_000 }, async () => {
  const relogio = relogioFalso(Date.UTC(2026, 9, 22, 15, 0, 0));
  const linhas: string[] = [];
  const guarda = criarGuardaDoProcesso(criarLog({ saida: (l) => linhas.push(l), agora: () => relogio.agora() }), relogio);
  const doLog = () => linhas.filter((l) => l.includes('exceção não tratada'));
  await comServidor(
    async (s) => {
      const saude = async () => JSON.parse((await obter(s.ingestao.porta, '/saude')).corpo.toString('utf8'));
      assert.equal((await saude()).ok, true, 'sem exceção, tudo certo');
      for (let i = 0; i < 50; i++) guarda.registrar('exceção', new TypeError('falha com C:/Users/joana canario/segredo.txt'));
      guarda.registrar('promessa', new RangeError('recusa'));
      const s1 = await saude();
      assert.equal(s1.ok, false, 'a saúde avisa');
      assert.deepEqual(s1.excecoes, { ultimos10min: 51, total: 51 });
      const d = JSON.parse((await obter(s.ingestao.porta, '/doctor')).corpo.toString('utf8'));
      assert.deepEqual([d.servidor.excecoes, d.servidor.excecoesRecentes], [51, 51]);
      const texto = (await obter(s.ingestao.porta, '/doctor?formato=texto')).corpo.toString('utf8');
      assert.match(texto, /Exceções não tratadas: 51 nos últimos 10 min, 51 desde a partida\. O servidor segue no ar\./);
      assert.equal(doLog().length, 2, 'uma linha por tipo de erro, não uma por exceção');
      relogio.avancar(60_000);
      assert.equal(doLog().length, 3, 'no fim do minuto, uma linha com as repetidas');
      assert.match(doLog()[2] ?? '', /erro=TypeError, vezes=49/);
      for (let i = 0; i < 10; i++) guarda.registrar('exceção', new TypeError('de novo'));
      assert.equal(doLog().length, 3, 'dentro do minuto, nada novo no log');
      relogio.avancar(10 * 60_000);
      assert.match(doLog()[3] ?? '', /vezes=10/);
      const s2 = await saude();
      assert.equal(s2.ok, true, 'dez minutos sem exceção: ok de novo');
      assert.deepEqual(s2.excecoes, { ultimos10min: 0, total: 61 });
      assert.ok(!linhas.join('\n').includes('canario') && !linhas.join('\n').includes('segredo'), 'a mensagem do erro nunca vai para o log');
    },
    { guarda },
  );
});

test('guardas do doctor de ponta a ponta: canário na configuração e num adaptador falso não sai pela saúde nem pelo doctor', { timeout: 30_000 }, async () => {
  const pasta = pastaTemporaria();
  const casa = path.join(pasta.caminho, 'casa canario qz');
  const amb = ambienteFalso(casa);
  const caminho = path.join(casa, 'Clientes Canario Qz', 'arcadia.config.yaml');
  const email = 'fulano.canario.qz@exemplo.com';
  const token = 'ghp_CANARIOqzGUARDA1abcdefghijklmnop';
  // Adaptador com defeito: o resumo e as linhas do diagnóstico levam caminho absoluto, e-mail e token.
  const falso: Adaptador = {
    id: 'claude-transcricao',
    nome: 'Transcrições do Claude Code',
    iniciar: async () => {},
    parar: async () => {},
    diagnostico: () => ({ estado: 'erro', resumo: `falhou ao abrir ${caminho}: ${token}`, linhas: [`Pasta lida: ${caminho}`, `Contato: ${email}`, 'Linha sem nada a esconder.'], contadores: {}, desconhecidos: {} }),
  };
  const s = await iniciarServidor({
    carregada: { config: configDeTeste(path.join(pasta.caminho, 'projetos'), amb), arquivo: caminho, descricao: caminho, origem: 'argumento', avisos: [`chave desconhecida perto de ${email} e ${token}`] },
    amb,
    log: criarLog({ silencioso: true }),
    dirDados: path.join(pasta.caminho, 'dados'),
    portas: { ingestao: 0, visualizacao: 0 },
    semSondarOmb: true,
    buildId: 'teste-guardas',
    adaptadoresExtras: [falso],
  });
  try {
    const saidas: Record<string, string> = {
      saúde: (await obter(s.ingestao.porta, '/saude')).corpo.toString('utf8'),
      'doctor em JSON': (await obter(s.ingestao.porta, '/doctor')).corpo.toString('utf8'),
      'doctor em texto': (await obter(s.ingestao.porta, '/doctor?formato=texto')).corpo.toString('utf8'),
    };
    const proibidos = [casa, casa.replace(/\\/g, '/'), casa.replace(/\\/g, '\\\\'), 'Clientes Canario Qz', 'fulano.canario', 'CANARIOqzGUARDA1'];
    for (const [nome, texto] of Object.entries(saidas)) {
      for (const p of proibidos) assert.ok(!texto.toLowerCase().includes(p.toLowerCase()), `${nome} deixou passar ${p}`);
    }
    // O teste não é vazio: o diagnóstico do adaptador chegou ao doctor e a guarda trabalhou nele.
    assert.match(saidas['doctor em texto'] ?? '', /Linha sem nada a esconder\./);
    assert.match(saidas['doctor em texto'] ?? '', /linha omitida pela guarda do doctor/);
    assert.ok((saidas['doctor em JSON'] ?? '').includes('Linha sem nada a esconder.') && (saidas['doctor em JSON'] ?? '').includes(MASCARA));
  } finally {
    await s.parar();
    pasta.remover();
  }
});

test('sala decidida pelo caminho, pasta excluída fica de fora, duplicado é ignorado', async () => {
  await comServidor(async (s, ctx) => {
    const e1 = evento('sessao.inicio');
    assert.equal(s.nucleo.ingerir({ evento: e1, caminhos: { cwd: path.join(ctx.projetos, 'produto-alfa') } }).ok, true);
    assert.deepEqual(s.nucleo.ingerir({ evento: e1 }), { ok: false, motivo: 'duplicado' });
    const fora = evento('sessao.inicio', { agente: { chave: 'sim:fora', tipo: 'sessao' } });
    s.nucleo.ingerir({ evento: fora, caminhos: { cwd: path.join(ctx.projetos, 'produto-alfa', 'segredos', 'cofre') } });
    await s.nucleo.ocioso();
    const m = s.nucleo.mundo();
    assert.equal(Object.keys(m.salas).length, 1);
    assert.equal(m.agentes['sim:fora']?.salaChave, undefined);
    assert.equal(s.nucleo.contadores().excluidos, 1);
    assert.equal(s.nucleo.contadores().foraDaSala, 0);
    assert.deepEqual(s.nucleo.ingerir({ evento: { tipo: 'invalido' } }), { ok: false, motivo: 'esquema' });
    assert.equal(s.nucleo.contadores().recusados, 1);
  });
});

test('reiniciar o servidor mantém salas, posições e história; replay do banco dá o mesmo estado', async () => {
  const pasta = pastaTemporaria();
  let salasAntes: unknown;
  let alasAntes: unknown;
  let estadoAntes: ReturnType<Servidor['nucleo']['estado']> | undefined;
  let config: Config | undefined;
  try {
    await comServidor(
      async (s, ctx) => {
        config = ctx.config;
        fs.mkdirSync(path.join(ctx.projetos, 'produto-beta', '.git'), { recursive: true });
        s.nucleo.ingerir({ evento: evento('sessao.inicio', { agente: { chave: 'sim:a', tipo: 'sessao' } }), caminhos: { cwd: path.join(ctx.projetos, 'produto-alfa') } });
        s.nucleo.ingerir({ evento: evento('sessao.inicio', { agente: { chave: 'sim:b', tipo: 'bot' } }), caminhos: { cwd: path.join(ctx.projetos, 'produto-beta') } });
        s.nucleo.ingerir({ evento: evento('turno.inicio', { agente: { chave: 'sim:b', tipo: 'bot' } }) });
        s.nucleo.ingerir({ evento: evento('ferramenta.inicio', { agente: { chave: 'sim:b', tipo: 'bot' }, ferramenta: { nome: 'Edit', categoria: 'editar', id: 'x1' } }) });
        s.nucleo.ingerir({ evento: evento('sessao.inicio', { agente: { chave: 'sim:c', tipo: 'sessao' } }), caminhos: { cwd: path.join(ctx.projetos, 'avulsa') } });
        await s.nucleo.ocioso();
        salasAntes = json(s.nucleo.mundo().salas);
        alasAntes = json(s.nucleo.mundo().alas);
        estadoAntes = json(s.nucleo.estado());
      },
      { pasta, manterPasta: true },
    );
    assert.ok(estadoAntes && config);
    // Replay: último snapshot (gravado no desligamento) e os eventos, avançados ao mesmo instante.
    const banco = abrirBanco(path.join(pasta.caminho, 'arcadia.sqlite'));
    const cfgMotor = (await import('./mundo/motor.ts')).configMotorPadrao({ fuso: config.mundo.fuso });
    const doBanco = reconstruirEstado(banco, cfgMotor, config, 0).estado;
    banco.fechar();
    const ate = estadoAntes.mundo.agora + 1;
    const a = aplicar(estadoAntes, { k: 'tick', agora: ate }, cfgMotor).estado;
    const b = aplicar(doBanco, { k: 'tick', agora: ate }, cfgMotor).estado;
    assert.deepEqual(json(b), json(a));
    // Replay sem snapshot nenhum (só eventos e layout) também chega lá.
    const banco2 = abrirBanco(path.join(pasta.caminho, 'arcadia.sqlite'));
    const soEventos = (await import('./mundo/motor.ts')).criarEstadoInicial;
    let e = soEventos(estadoAntes.mundo.alas['recepcao']?.criadaEm ?? 0, cfgMotor, { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' });
    e = aplicar(e, { k: 'alas', agora: e.mundo.agora, alas: config.alas.map((x) => ({ id: x.id, nome: x.nome, cor: x.cor })), recepcao: { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' } }, cfgMotor).estado;
    for (const { evento: ev } of banco2.eventosDepois(0)) e = aplicar(e, { k: 'evento', evento: ev }, cfgMotor).estado;
    banco2.fechar();
    e = aplicar(e, { k: 'tick', agora: ate }, cfgMotor).estado;
    assert.deepEqual(json(e.mundo.salas), json(a.mundo.salas));
    assert.deepEqual(json(e.mundo.agentes), json(a.mundo.agentes));
    // Servidor novo na mesma pasta: mesmo andar.
    await comServidor(
      async (s) => {
        assert.deepEqual(json(s.nucleo.mundo().alas), alasAntes);
        const salas = s.nucleo.mundo().salas;
        for (const [k, v] of Object.entries(salasAntes as Record<string, { terreno: unknown; alaId: string; nome: string }>)) {
          assert.deepEqual(salas[k]?.terreno, v.terreno);
          assert.equal(salas[k]?.alaId, v.alaId);
          assert.equal(salas[k]?.nome, v.nome);
        }
        assert.ok(s.nucleo.mundo().agentes['sim:b'], 'o bot continua no mundo');
      },
      { pasta, manterPasta: true },
    );
  } finally {
    pasta.remover();
  }
});

test('queda antes do primeiro snapshot: o replay só dos eventos dá o mesmo estado que o servidor tinha', async () => {
  await comServidor(
    async (s, ctx) => {
      await esperar(2_000);
      const vivo = json(s.nucleo.estado());
      const banco = abrirBanco(s.arquivoBanco);
      try {
        assert.equal(banco.contarSnapshots(), 0, 'ainda sem snapshot: é o caminho da queda');
        assert.ok(banco.contarEventos() > 50, `poucos eventos: ${banco.contarEventos()}`);
        const cfgMotor = s.nucleo.configMotor;
        const refeito = reconstruirEstado(banco, cfgMotor, ctx.config, Date.now() + 60_000).estado;
        const ate = Math.max(vivo.mundo.agora, refeito.mundo.agora) + 1;
        const a = json(aplicar(vivo, { k: 'tick', agora: ate }, cfgMotor).estado) as { mundo: Record<string, unknown> };
        const b = json(aplicar(refeito, { k: 'tick', agora: ate }, cfgMotor).estado) as { mundo: Record<string, unknown> };
        // A saúde é operacional (vem do servidor, não do banco).
        delete a.mundo['saude'];
        delete b.mundo['saude'];
        assert.deepEqual(b, a);
      } finally {
        banco.fechar();
      }
    },
    { simulador: { cenario: 'pico', semente: 3, velocidade: 20 } },
  );
});

test('simulador ligado no servidor: agentes aparecem e a fonte é marcada como simulada', async () => {
  await comServidor(
    async (s) => {
      await esperar(1_500);
      const snap = await snapshot(s.visualizacao.porta);
      assert.ok(Object.keys(snap.estado.agentes).length >= 1);
      assert.equal(snap.estado.saude.fontes['sim']?.estado, 'simulada');
      assert.ok(path.basename(s.arquivoBanco) === 'arcadia-sim.sqlite', 'simulação não mistura com os dados reais');
    },
    { simulador: { cenario: 'visitante', semente: 1, velocidade: 60 } },
  );
});
