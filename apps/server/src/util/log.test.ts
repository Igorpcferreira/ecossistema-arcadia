// Testes do log: mensagem saneada (caminho e segredo somem), endereço do próprio PC inteiro, erro só pelo código.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarLog, descreverErro } from './log.ts';

test('o log saneia a mensagem, mas mantém o endereço local inteiro', () => {
  const linhas: string[] = [];
  const log = criarLog({ saida: (l) => linhas.push(l), agora: () => Date.UTC(2026, 9, 22, 15, 0, 0) });
  log.info('no ar: depuração em http://127.0.0.1:4780/depurar e doctor em http://127.0.0.1:47800/doctor?formato=texto');
  log.aviso('arquivo C:/Users/Joana Canario/Clientes/a.txt com password=segredo', { pasta: 'C:\\Users\\Joana Canario\\x', endereco: 'http://127.0.0.1:4780/x' });
  assert.match(linhas[0] ?? '', /no ar: depuração em http:\/\/127\.0\.0\.1:4780\/depurar e doctor em http:\/\/127\.0\.0\.1:47800\/doctor\?formato=texto$/);
  assert.ok(!linhas[1]?.includes('Joana') && !linhas[1]?.includes('Clientes') && !linhas[1]?.includes('segredo'), linhas[1]);
  assert.ok(!linhas[1]?.includes('4780/x'), 'nos dados, nem o endereço local passa inteiro');
  assert.equal(descreverErro(Object.assign(new Error('mensagem com C:/Users/x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(descreverErro(new RangeError('qualquer coisa')), 'RangeError');
});
