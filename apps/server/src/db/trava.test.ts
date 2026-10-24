// Testes da trava de instância única da pasta de dados. Pastas temporárias; o "processo morto" é um filho que já saiu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARQUIVO_TRAVA, ErroTrava, adquirirTrava, processoVivo } from './trava.ts';
import { pastaTemporaria } from '../testes/apoio.ts';

/** PID de um processo que já terminou. */
function pidMorto(): number {
  const r = spawnSync(process.execPath, ['-e', '']);
  assert.equal(r.status, 0);
  assert.ok(r.pid && !processoVivo(r.pid), 'o filho já saiu');
  return r.pid;
}

function erroDe(f: () => unknown): ErroTrava {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof ErroTrava, `esperava ErroTrava, veio ${String(e)}`);
    return e;
  }
  assert.fail('esperava a trava recusada');
}

test('a trava guarda PID, portas e horário; a segunda tentativa é recusada dizendo qual processo segura a pasta', () => {
  const pasta = pastaTemporaria();
  try {
    const t = adquirirTrava(pasta.caminho, { portas: { ingestao: 47800, visualizacao: 4780 }, descricao: '%LOCALAPPDATA%\\Arcadia\\dados', fuso: 'America/Sao_Paulo' });
    assert.equal(t.retomada, undefined);
    const dono = JSON.parse(fs.readFileSync(path.join(pasta.caminho, ARQUIVO_TRAVA), 'utf8'));
    assert.deepEqual(Object.keys(dono).sort(), ['desde', 'pid', 'portas'], 'só PID, horário e portas: nada pessoal');
    assert.equal(dono.pid, process.pid);
    // Mesmo processo, mesma pasta: o dono está vivo (somos nós), então a segunda é recusada.
    const e = erroDe(() => adquirirTrava(pasta.caminho, { descricao: '%LOCALAPPDATA%\\Arcadia\\dados' }));
    assert.match(e.message, new RegExp(`^A pasta de dados \\(%LOCALAPPDATA%\\\\Arcadia\\\\dados\\) já está em uso por outro servidor do Arcadia \\(processo ${process.pid}, portas 4780 e 47800, desde \\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}\\)\\.`));
    assert.equal(e.dono?.pid, process.pid);
    t.liberar();
    assert.ok(!fs.existsSync(path.join(pasta.caminho, ARQUIVO_TRAVA)), 'liberar apaga a trava');
    t.liberar();
    const outra = adquirirTrava(pasta.caminho);
    outra.liberar();
  } finally {
    pasta.remover();
  }
});

test('liberar só apaga a própria trava (não a de outro servidor que pegou a pasta depois)', () => {
  const pasta = pastaTemporaria();
  try {
    const t = adquirirTrava(pasta.caminho);
    const arquivo = path.join(pasta.caminho, ARQUIVO_TRAVA);
    fs.writeFileSync(arquivo, JSON.stringify({ pid: 4242, desde: Date.now() }));
    t.liberar();
    assert.ok(fs.existsSync(arquivo), 'a trava de outro fica');
  } finally {
    pasta.remover();
  }
});

test('trava velha de processo morto é retomada, e a retomada diz de quem era', () => {
  const pasta = pastaTemporaria();
  try {
    const morto = pidMorto();
    const arquivo = path.join(pasta.caminho, ARQUIVO_TRAVA);
    fs.writeFileSync(arquivo, JSON.stringify({ pid: morto, desde: Date.now() - 60_000, portas: { ingestao: 47800, visualizacao: 4780 } }));
    const t = adquirirTrava(pasta.caminho);
    assert.equal(t.retomada?.pid, morto);
    assert.deepEqual(t.retomada?.portas, { ingestao: 47800, visualizacao: 4780 });
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).pid, process.pid, 'a trava agora é deste processo');
    t.liberar();
  } finally {
    pasta.remover();
  }
});

test('trava de antes do sistema ligar é velha mesmo com o PID vivo (PID reaproveitado depois de reiniciar)', () => {
  const pasta = pastaTemporaria();
  try {
    const arquivo = path.join(pasta.caminho, ARQUIVO_TRAVA);
    const ligouHa1h = () => Date.now() - 3_600_000;
    // PID vivo (o deste processo), mas a trava é de 2 h atrás: de antes de ligar.
    fs.writeFileSync(arquivo, JSON.stringify({ pid: process.pid, desde: Date.now() - 7_200_000 }));
    const t = adquirirTrava(pasta.caminho, { inicioDoSistema: ligouHa1h });
    assert.equal(t.retomada?.pid, process.pid);
    t.liberar();
    // A mesma trava, de depois de ligar: o dono está vivo, então é recusada.
    fs.writeFileSync(arquivo, JSON.stringify({ pid: process.pid, desde: Date.now() - 600_000 }));
    erroDe(() => adquirirTrava(pasta.caminho, { inicioDoSistema: ligouHa1h }));
  } finally {
    pasta.remover();
  }
});

test('trava ilegível: recém-criada é respeitada (alguém está subindo); velha é retomada', () => {
  const pasta = pastaTemporaria();
  try {
    const arquivo = path.join(pasta.caminho, ARQUIVO_TRAVA);
    fs.writeFileSync(arquivo, '');
    assert.match(erroDe(() => adquirirTrava(pasta.caminho)).message, /está sendo aberta por outro servidor do Arcadia neste momento/);
    const ha1min = new Date(Date.now() - 60_000);
    fs.utimesSync(arquivo, ha1min, ha1min);
    const t = adquirirTrava(pasta.caminho);
    assert.deepEqual(t.retomada, {}, 'retomada sem dono conhecido');
    t.liberar();
  } finally {
    pasta.remover();
  }
});

test('processo vivo: o próprio sim, o que já saiu não, e sem permissão para olhar conta como vivo', () => {
  assert.equal(processoVivo(process.pid), true);
  assert.equal(processoVivo(pidMorto()), false);
  for (const invalido of [0, -1, 1.5, Number.NaN]) assert.equal(processoVivo(invalido), false, String(invalido));
  // PID 4 é o processo System do Windows (1 é o init no Linux): existe, mas não deixa abrir (EPERM).
  assert.equal(processoVivo(process.platform === 'win32' ? 4 : 1), true);
});
