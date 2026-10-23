// Testes do seguidor de JSONL: offset, linha incompleta, UTF-8 cortado, catch-up só do fim, arquivo novo e truncado,
// e a varredura assíncrona que não cresce com o histórico (arquivo frio fora da volta, pasta igual não relida).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { criarSeguidor, type Linha } from './seguidor.ts';
import { relogioFalso } from '../util/relogio.ts';
import { pastaTemporaria } from '../testes/apoio.ts';

function montar(raiz: string, opcoes: { catchUpMs?: number; bytesDoFim?: number; primeiraLinha?: boolean } = {}) {
  const relogio = relogioFalso(Date.now());
  const lidas: { rel: string; l: Linha; doComeco: boolean }[] = [];
  const removidos: string[] = [];
  const esfriados: string[] = [];
  const s = criarSeguidor({
    raiz,
    incluir: (rel) => rel.endsWith('.jsonl'),
    profundidade: 3,
    catchUpMs: opcoes.catchUpMs ?? 24 * 3600_000,
    bytesDoFim: opcoes.bytesDoFim ?? 1024,
    varreduraMs: 2_000,
    relogio,
    observar: false,
    ...(opcoes.primeiraLinha ? { primeiraLinha: true } : {}),
    aoLer: (linhas, a) => {
      for (const l of linhas) lidas.push({ rel: a.relativo, l, doComeco: a.doComeco });
    },
    aoRemover: (a) => removidos.push(a.relativo),
    aoEsfriar: (a) => esfriados.push(a.relativo),
  });
  /** Uma volta da varredura de segurança (o relógio dispara, e a volta termina). */
  const volta = async () => {
    relogio.avancar(2_000);
    await s.varrer();
  };
  return { s, relogio, lidas, removidos, esfriados, volta };
}

test('catch-up lê só o fim (a partir da primeira linha inteira) e depois só o que é novo', async () => {
  const p = pastaTemporaria();
  try {
    const arq = path.join(p.caminho, 'proj', 'a.jsonl');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const linhas = Array.from({ length: 100 }, (_, i) => JSON.stringify({ n: i, preenchimento: 'x'.repeat(20) }));
    fs.writeFileSync(arq, linhas.join('\n') + '\n');
    const { s, lidas, volta } = montar(p.caminho, { bytesDoFim: 500 });
    await s.iniciar();
    assert.ok(lidas.length > 0 && lidas.length < 100, `leu ${lidas.length}`);
    assert.ok(lidas.every((x) => x.l.catchUp));
    assert.equal(JSON.parse(lidas.at(-1)?.l.texto ?? '{}').n, 99);
    for (const x of lidas) JSON.parse(x.l.texto);
    const antes = lidas.length;
    fs.appendFileSync(arq, JSON.stringify({ n: 100 }) + '\n');
    await volta();
    assert.equal(lidas.length, antes + 1);
    assert.equal(lidas.at(-1)?.l.catchUp, false);
    await s.parar();
  } finally {
    p.remover();
  }
});

test('linha incompleta espera a quebra; UTF-8 cortado no meio não estraga', async () => {
  const p = pastaTemporaria();
  try {
    const arq = path.join(p.caminho, 'b.jsonl');
    fs.writeFileSync(arq, '');
    const { s, lidas } = montar(p.caminho);
    await s.iniciar();
    const linha = Buffer.from(JSON.stringify({ texto: 'ação três ões' }) + '\n', 'utf8');
    const corte = linha.indexOf(Buffer.from('çã')) + 1;
    fs.appendFileSync(arq, linha.subarray(0, corte));
    s.ler(arq);
    assert.equal(lidas.length, 0, 'sem quebra, nada sai');
    fs.appendFileSync(arq, linha.subarray(corte));
    s.ler(arq);
    assert.equal(lidas.length, 1);
    assert.equal(JSON.parse(lidas[0]?.l.texto ?? '{}').texto, 'ação três ões');
    assert.equal(lidas[0]?.l.inicio, 0);
    await s.parar();
  } finally {
    p.remover();
  }
});

test('arquivo velho fica de fora do catch-up; arquivo novo é lido do começo; truncado é relido', async () => {
  const p = pastaTemporaria();
  try {
    const velho = path.join(p.caminho, 'velho.jsonl');
    fs.writeFileSync(velho, '{"v":1}\n');
    const doisDias = new Date(Date.now() - 2 * 24 * 3600_000);
    fs.utimesSync(velho, doisDias, doisDias);
    const { s, lidas, removidos, volta } = montar(p.caminho);
    await s.iniciar();
    assert.equal(lidas.length, 0, 'mexido fora da janela: só o que chegar depois');
    assert.equal(s.estatisticas().frios, 1, 'o arquivo velho é frio');
    fs.appendFileSync(velho, '{"v":2}\n');
    const novo = path.join(p.caminho, 'sub', 'novo.jsonl');
    fs.mkdirSync(path.dirname(novo), { recursive: true });
    fs.writeFileSync(novo, '{"n":1}\n{"n":2}\n');
    await volta();
    const novas = lidas.filter((x) => x.rel === 'sub/novo.jsonl');
    assert.deepEqual(novas.map((x) => [x.l.texto, x.doComeco]), [['{"n":1}', true], ['{"n":2}', true]]);
    const doVelho = lidas.filter((x) => x.rel === 'velho.jsonl');
    assert.deepEqual(doVelho.map((x) => [x.l.texto, x.doComeco]), [['{"v":2}', false]], 'o frio que cresceu entra no rodízio e esquenta');
    fs.writeFileSync(novo, '{"n":9}\n');
    await volta();
    assert.equal(lidas.at(-1)?.l.texto, '{"n":9}', 'encolheu: relê do zero');
    fs.rmSync(novo);
    await volta();
    assert.deepEqual(removidos, ['sub/novo.jsonl']);
    await s.parar();
  } finally {
    p.remover();
  }
});

test('primeira linha no catch-up (cabeçalho do Codex) vem antes do fim', async () => {
  const p = pastaTemporaria();
  try {
    const arq = path.join(p.caminho, 'r.jsonl');
    const linhas = [JSON.stringify({ type: 'session_meta' }), ...Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, x: 'y'.repeat(30) }))];
    fs.writeFileSync(arq, linhas.join('\n') + '\n');
    const { s, lidas } = montar(p.caminho, { bytesDoFim: 300, primeiraLinha: true });
    await s.iniciar();
    assert.equal(JSON.parse(lidas[0]?.l.texto ?? '{}').type, 'session_meta');
    assert.ok(lidas.length < 51);
    await s.parar();
  } finally {
    p.remover();
  }
});

test('pasta que ainda não existe: espera e começa a ler quando aparecer', async () => {
  const p = pastaTemporaria();
  try {
    const raiz = path.join(p.caminho, 'ainda-nao');
    const { s, lidas, volta } = montar(raiz);
    await s.iniciar();
    assert.equal(s.estatisticas().raizExiste, false);
    fs.mkdirSync(raiz, { recursive: true });
    fs.writeFileSync(path.join(raiz, 'x.jsonl'), '{"a":1}\n');
    await volta();
    assert.equal(lidas.length, 1);
    await s.parar();
  } finally {
    p.remover();
  }
});

test('varredura assíncrona: histórico frio não entra em toda volta e pasta igual não é relida', async () => {
  const p = pastaTemporaria();
  const promessas = fs.promises as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const originais = { stat: promessas['stat'], readdir: promessas['readdir'] } as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const chamadas: Record<string, number> = { stat: 0, readdir: 0 };
  try {
    // 20 pastas com 20 arquivos velhos cada (400 sessões paradas há dois dias) e uma sessão ativa.
    const doisDias = new Date(Date.now() - 2 * 24 * 3600_000);
    for (let d = 0; d < 20; d++) {
      const dir = path.join(p.caminho, `C--proj-${d}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 20; i++) {
        const arq = path.join(dir, `velha-${i}.jsonl`);
        fs.writeFileSync(arq, '{"velha":true}\n');
        fs.utimesSync(arq, doisDias, doisDias);
      }
      fs.utimesSync(dir, doisDias, doisDias);
    }
    const ativa = path.join(p.caminho, 'C--proj-0', 'ativa.jsonl');
    fs.writeFileSync(ativa, '{"n":0}\n');
    const { s, lidas, esfriados, volta } = montar(p.caminho);
    await s.iniciar();
    assert.equal(s.estatisticas().arquivos, 401);
    assert.equal(s.estatisticas().frios, 400);
    for (const nome of Object.keys(originais)) {
      promessas[nome] = (...args: unknown[]) => {
        chamadas[nome] = (chamadas[nome] ?? 0) + 1;
        return (originais[nome] as (...a: unknown[]) => Promise<unknown>)(...args);
      };
    }
    // A chamada em si não trava o servidor: o trabalho acontece depois, em passos assíncronos.
    const t0 = performance.now();
    const promessa = s.varrer();
    const sincrono = performance.now() - t0;
    await promessa;
    assert.ok(sincrono < 5, `a parte síncrona levou ${sincrono.toFixed(2)} ms`);
    chamadas['stat'] = 0;
    chamadas['readdir'] = 0;
    await volta();
    // Por volta: um stat por pasta (21), o arquivo quente e a fatia do rodízio dos frios (400 * 2 s / 60 s = 14).
    assert.ok((chamadas['stat'] ?? 0) <= 21 + 1 + 14 + 2, `stat por volta: ${chamadas['stat']}`);
    assert.equal(chamadas['readdir'], 0, 'nenhuma pasta mudou: nenhuma releitura');
    // Linha nova na sessão ativa chega na volta seguinte.
    fs.appendFileSync(ativa, '{"n":1}\n');
    await volta();
    assert.equal(lidas.at(-1)?.l.texto, '{"n":1}');
    assert.deepEqual(esfriados, [], 'nada esfriou ainda (a ativa é recente)');
  } finally {
    for (const [nome, f] of Object.entries(originais)) promessas[nome] = f;
    p.remover();
  }
});

test('arquivo que sai da janela esfria e o adaptador é avisado', async () => {
  const p = pastaTemporaria();
  try {
    const arq = path.join(p.caminho, 'c.jsonl');
    fs.writeFileSync(arq, '{"n":0}\n');
    const { s, relogio, esfriados } = montar(p.caminho, { catchUpMs: 60_000 });
    await s.iniciar();
    // Doze minutos depois (janela quente mínima de 10 min), sem mudança: frio.
    relogio.avancar(12 * 60_000);
    for (let i = 0; i < 40 && esfriados.length === 0; i++) await s.varrer();
    assert.deepEqual(esfriados, ['c.jsonl']);
    await s.parar();
  } finally {
    p.remover();
  }
});
