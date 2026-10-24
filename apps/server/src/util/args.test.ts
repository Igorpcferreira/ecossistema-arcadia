// Testes da leitura de argumentos com falha fechada (a do servidor e a do doctor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarArgumentos, type EspecArgumentos } from './args.ts';

const SERVIDOR: EspecArgumentos = { valores: ['config', 'simulador', 'semente', 'velocidade', 'porta', 'porta-ingestao'], sinais: ['uma-vez'] };

const erro = (argv: string[]) => {
  const r = interpretarArgumentos(argv, SERVIDOR);
  assert.equal(r.tipo, 'erro', argv.join(' '));
  return r.tipo === 'erro' ? r.mensagem : '';
};

test('ajuda em qualquer posição e com qualquer apelido, antes de qualquer outra conferência', () => {
  for (const argv of [['--help'], ['--ajuda'], ['-h'], ['-H'], ['/?'], ['-?'], ['--HELP'], ['--help=1'], ['--simulador', 'estados', '--help'], ['--opcao-errada', '-h'], ['--config', 'x.yaml', '--ajuda']]) {
    assert.equal(interpretarArgumentos(argv, SERVIDOR).tipo, 'ajuda', argv.join(' '));
  }
});

test('opção desconhecida, opção sem valor, sinal com valor e argumento solto viram erro', () => {
  assert.equal(erro(['--porta-errada', '1']), 'Opção desconhecida: --porta-errada.');
  assert.equal(erro(['--hepl']), 'Opção desconhecida: --hepl.');
  assert.equal(erro(['--config']), 'Falta o valor de --config.');
  assert.equal(erro(['--config', '--simulador', 'estados']), 'Falta o valor de --config.');
  assert.equal(erro(['--uma-vez=sim']), '--uma-vez não leva valor.');
  assert.equal(erro(['estados']), 'Há um argumento solto, sem opção na frente.');
  assert.equal(erro(['--uma-vez', 'estados']), 'Há um argumento solto, sem opção na frente.');
  assert.equal(erro(['-x']), 'Há um argumento solto, sem opção na frente.');
});

test('a mensagem de erro nunca repete um valor nem um nome de opção esquisito', () => {
  const m1 = erro(['--token=C:/Users/fulano/segredo.txt']);
  assert.equal(m1, 'Opção desconhecida: --token.');
  const m2 = erro(['--C:/Users/fulano/segredo']);
  assert.equal(m2, 'Opção desconhecida: uma opção com nome estranho.');
  assert.ok(!m1.includes('fulano') && !m2.includes('fulano'));
  assert.equal(erro(['C:/Users/fulano/segredo.txt']), 'Há um argumento solto, sem opção na frente.');
});

test('argumentos certos passam, com valores e sinais', () => {
  const r = interpretarArgumentos(['--config', 'x.yaml', '--simulador=estados', '--uma-vez', '--porta', '4790'], SERVIDOR);
  assert.equal(r.tipo, 'ok');
  if (r.tipo === 'ok') {
    assert.deepEqual(r.args.valores, { config: 'x.yaml', simulador: 'estados', porta: '4790' });
    assert.deepEqual([...r.args.sinais], ['uma-vez']);
  }
  assert.equal(interpretarArgumentos([], SERVIDOR).tipo, 'ok');
  // O doctor tem o seu próprio conjunto: --json é dele, --simulador não.
  const doctor: EspecArgumentos = { valores: ['config'], sinais: ['json'] };
  assert.equal(interpretarArgumentos(['--json'], doctor).tipo, 'ok');
  assert.equal(interpretarArgumentos(['--simulador', 'estados'], doctor).tipo, 'erro');
});
