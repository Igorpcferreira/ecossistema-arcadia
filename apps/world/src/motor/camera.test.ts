// Câmera do aquário: espera nova leva a câmera até ela na hora (em menos de 2 s), sem esperar a troca de plano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, type AlvosCamera } from './camera.ts';

function alvos(lista: { id: string; x: number; y: number }[]): AlvosCamera {
  return {
    alvoZona: () => [0, 0],
    alvoUrgente: () => (lista[0] ? [lista[0].x, lista[0].y] : null),
    urgentes: () => lista,
    alvoForcado: () => null,
    limites: () => ({ minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 }),
  };
}

test('espera nova: a câmera vai até ela em menos de 2 s, no meio de um plano, e fica nela o plano inteiro', () => {
  // uma espera antiga, que o aquário já mostrou
  const lista: { id: string; x: number; y: number }[] = [{ id: 'antiga', x: -500, y: 0 }];
  const cam = new Camera(alvos(lista), ['a', 'b'], 7);
  cam.vw = 300; cam.vh = 600;
  for (let k = 0; k < 90; k++) cam.dirigir(1 / 30);
  assert.ok(Math.hypot(cam.x + 500, cam.y) < 8);
  // a espera nova começa longe, no meio do plano (faltam uns 6 s para a troca)
  lista.push({ id: 'sessao', x: 800, y: -400 });
  let t = 0;
  while (t < 2 && Math.hypot(cam.x - 800, cam.y + 400) > 8) { cam.dirigir(1 / 30); t += 1 / 30; }
  assert.ok(t < 2, `a câmera levou ${t.toFixed(2)} s`);
  // fica nela, mesmo com a antiga na frente da fila (a que o alvo urgente devolve)
  for (let k = 0; k < 120; k++) cam.dirigir(1 / 30);
  assert.ok(Math.hypot(cam.x - 800, cam.y + 400) < 8, 'a câmera saiu da espera nova antes do fim do plano');
});

test('sem aquário (alguém mexendo na tela), a câmera não pula; ao voltar, vai até a espera que ainda não mostrou', () => {
  const lista = [{ id: 'sessao', x: 500, y: 500 }];
  const cam = new Camera(alvos([]), [], 7);
  cam.vw = 300; cam.vh = 600; cam.aquario = false; cam.ultimoToque = performance.now();
  cam.alvos = alvos(lista);
  for (let k = 0; k < 30; k++) cam.dirigir(1 / 30);
  assert.ok(Math.hypot(cam.x - 500, cam.y - 500) > 100);
  cam.ligarAquario(true);
  for (let k = 0; k < 60; k++) cam.dirigir(1 / 30);
  assert.ok(Math.hypot(cam.x - 500, cam.y - 500) < 8);
});
