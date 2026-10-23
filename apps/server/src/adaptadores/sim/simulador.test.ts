// Testes do simulador e do replay determinístico (mesma semente e mesmos eventos dão o mesmo estado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaEstadoMundo, sanearEvento, type ArcadiaEvent } from '@arcadia/shared';
import { CENARIOS, DURACAO_PADRAO_MS, gerarCenario, iniciarSimulacao, type Cenario } from './simulador.ts';
import { aplicar, configMotorPadrao, criarEstadoInicial, type EstadoMotor } from '../../mundo/motor.ts';
import { relogioFalso } from '../../util/relogio.ts';
import { json } from '../../testes/apoio.ts';

const cfg = configMotorPadrao();
const RECEP = { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' };
const ALAS = [
  { id: 'produtos', nome: 'Produtos', cor: '#c9a7ff' },
  { id: 'estudio', nome: 'Estúdio', cor: '#ffb347' },
  { id: 'trabalho', nome: 'Trabalho', cor: '#a9b3d6' },
];
const T0 = Date.UTC(2026, 9, 22, 13, 0, 0);
const IDS_ALAS = ALAS.map((a) => a.id);

function rodar(eventos: ArcadiaEvent[], ate: number, tickMs?: number, observar?: (e: EstadoMotor, t: number) => void): EstadoMotor {
  let e = criarEstadoInicial(T0, cfg, RECEP);
  e = aplicar(e, { k: 'alas', agora: T0, alas: ALAS, recepcao: RECEP }, cfg).estado;
  let proximoTick = tickMs !== undefined ? T0 + tickMs : Infinity;
  for (const ev of eventos) {
    while (proximoTick <= ev.recebidoEm) {
      e = aplicar(e, { k: 'tick', agora: proximoTick }, cfg).estado;
      observar?.(e, proximoTick);
      proximoTick += tickMs ?? Infinity;
    }
    e = aplicar(e, { k: 'evento', evento: ev }, cfg).estado;
    observar?.(e, ev.recebidoEm);
  }
  while (proximoTick <= ate) {
    e = aplicar(e, { k: 'tick', agora: proximoTick }, cfg).estado;
    observar?.(e, proximoTick);
    proximoTick += tickMs ?? Infinity;
  }
  return aplicar(e, { k: 'tick', agora: ate }, cfg).estado;
}

for (const cenario of CENARIOS) {
  test(`cenário ${cenario}: eventos válidos, em ordem, no intervalo e determinísticos`, () => {
    const a = gerarCenario(cenario, { semente: 42, inicio: T0, alas: IDS_ALAS });
    const b = gerarCenario(cenario, { semente: 42, inicio: T0, alas: IDS_ALAS });
    assert.deepEqual(a, b, 'mesma semente, mesmos eventos');
    assert.ok(a.length > 10, `poucos eventos: ${a.length}`);
    const fim = T0 + DURACAO_PADRAO_MS[cenario];
    const ids = new Set<string>();
    let anterior = 0;
    for (const ev of a) {
      const r = sanearEvento(ev, { permitirAlvo: true });
      assert.ok(r.ok, `evento inválido: ${JSON.stringify(r.ok ? '' : r.problemas)}`);
      if (r.ok) assert.equal(r.descartados, 0);
      assert.ok(ev.ts >= T0 && ev.ts <= fim, 'fora do intervalo');
      assert.ok(ev.ts >= anterior, 'fora de ordem');
      anterior = ev.ts;
      assert.ok(!ids.has(ev.id), 'id repetido');
      ids.add(ev.id);
    }
    const outra = gerarCenario(cenario, { semente: 43, inicio: T0, alas: IDS_ALAS });
    assert.notDeepEqual(outra, a, 'semente diferente, eventos diferentes');
  });

  test(`replay de ${cenario}: tick a cada segundo e tick só no fim chegam ao mesmo estado`, () => {
    const eventos = gerarCenario(cenario, { semente: 7, inicio: T0, alas: IDS_ALAS });
    const ate = T0 + DURACAO_PADRAO_MS[cenario] + 60_000;
    const fino = rodar(eventos, ate, 1_000);
    const grosso = rodar(eventos, ate);
    assert.deepEqual(json(grosso), json(fino));
    assert.deepEqual(json(rodar(eventos, ate)), json(grosso), 'rodar de novo dá o mesmo');
    const v = EsquemaEstadoMundo.safeParse(json(grosso.mundo));
    assert.ok(v.success, v.success ? '' : JSON.stringify(v.error.issues.slice(0, 3)));
  });
}

function observarCenario(cenario: Cenario, semente = 3) {
  const eventos = gerarCenario(cenario, { semente, inicio: T0, alas: IDS_ALAS });
  const estados = new Map<string, Set<string>>();
  let maxAgentes = 0;
  let maxFila = 0;
  const final = rodar(eventos, T0 + DURACAO_PADRAO_MS[cenario] + 120_000, 1_000, (e) => {
    maxAgentes = Math.max(maxAgentes, Object.keys(e.mundo.agentes).length);
    maxFila = Math.max(maxFila, e.mundo.precisaDeVoce.length);
    for (const a of Object.values(e.mundo.agentes)) {
      let s = estados.get(a.chave);
      if (!s) estados.set(a.chave, (s = new Set()));
      s.add(a.estado);
    }
  });
  return { eventos, final, estados, maxAgentes, maxFila };
}

test('dia normal: delegação, entregas, pausa e uma pergunta para você', () => {
  const { final, estados, maxFila } = observarCenario('dia-normal');
  assert.ok(final.mundo.metricas.delegacoes >= 1);
  assert.ok(final.mundo.metricas.entregas >= 5);
  assert.ok([...estados.values()].some((s) => s.has('pausa')), 'alguém foi para a pausa');
  assert.ok([...estados.values()].some((s) => s.has('delegando')));
  assert.equal(maxFila, 1);
});

test('30 agentes: trinta androides ao mesmo tempo', () => {
  const { eventos, maxAgentes } = observarCenario('30-agentes');
  assert.equal(new Set(eventos.map((e) => e.agente.chave)).size, 30);
  assert.equal(maxAgentes, 30);
});

test('pico: rajada de eventos', () => {
  const { eventos } = observarCenario('pico');
  assert.ok(eventos.length >= 500, `eventos: ${eventos.length}`);
});

test('falhas: erros, limite e ferramenta travada que vira talvez esperando', () => {
  const { final, estados } = observarCenario('falhas');
  assert.ok(final.mundo.metricas.erros >= 3);
  assert.ok([...estados.values()].some((s) => s.has('limite')));
  assert.ok(estados.get('sim:claude-travada')?.has('talvez-esperando'));
});

test('esperando você: fila com três pedidos e um talvez', () => {
  const { maxFila, estados, final } = observarCenario('esperando-voce');
  assert.ok(maxFila >= 2, `fila: ${maxFila}`);
  assert.ok([...estados.values()].some((s) => s.has('esperando')));
  assert.ok(estados.get('sim:claude-2')?.has('talvez-esperando'));
  assert.equal(final.mundo.precisaDeVoce.length, 0, 'todos foram atendidos no fim');
  assert.ok(final.mundo.metricas.esperas >= 3);
});

test('sala nova: obra na ala, Recepção e depois classificação', () => {
  const eventos = gerarCenario('sala-nova', { semente: 3, inicio: T0, alas: IDS_ALAS });
  const aos90s = rodar(eventos.filter((e) => e.recebidoEm <= T0 + 90_000), T0 + 90_000);
  const obra = aos90s.mundo.salas['sim-obra-nova'];
  assert.equal(obra?.alaId, 'produtos');
  assert.ok(aos90s.mundo.obras.some((o) => o.salaChave === 'sim-obra-nova'));
  const aos3min = rodar(eventos.filter((e) => e.recebidoEm <= T0 + 180_000), T0 + 180_000);
  assert.equal(aos3min.mundo.salas['sim-sem-regra']?.alaId, 'recepcao');
  const final = rodar(eventos, T0 + 11 * 60_000);
  assert.equal(final.mundo.salas['sim-sem-regra']?.alaId, 'trabalho');
});

test('visitante: chega, trabalha com subagente e vai embora', () => {
  const { final, estados } = observarCenario('visitante');
  assert.ok(estados.get('sim:visitante-claude')?.has('chegando'));
  assert.ok(estados.get('sim:visitante-claude')?.has('saindo'));
  assert.ok(estados.has('sim:visitante-claude:sub-1'));
  assert.ok(estados.get('sim:visitante-codex')?.has('saindo'));
  assert.equal(final.mundo.agentes['sim:visitante-claude'], undefined);
  assert.equal(final.mundo.agentes['sim:visitante-codex'], undefined);
  assert.equal(Object.keys(final.mundo.salas).length, 2, 'as salas ficam');
});

test('simulação ao vivo emite os eventos do cenário no relógio e repete', () => {
  const relogio = relogioFalso(T0);
  const emitidos: ArcadiaEvent[] = [];
  const sim = iniciarSimulacao({ cenario: 'visitante', semente: 5, relogio, emitir: (e) => emitidos.push(e), alas: IDS_ALAS, repetir: true });
  relogio.avancar(DURACAO_PADRAO_MS.visitante - 1);
  const esperados = gerarCenario('visitante', { semente: 5, inicio: T0, alas: IDS_ALAS });
  assert.deepEqual(emitidos.map((e) => e.id), esperados.map((e) => e.id));
  assert.equal(sim.info().rodada, 0);
  relogio.avancar(2);
  assert.equal(sim.info().rodada, 1);
  relogio.avancar(DURACAO_PADRAO_MS.visitante);
  assert.ok(emitidos.length > esperados.length);
  sim.parar();
  const antes = emitidos.length;
  relogio.avancar(60 * 60_000);
  assert.equal(emitidos.length, antes, 'parada, não emite mais');
});

test('velocidade 10 comprime o tempo', () => {
  const relogio = relogioFalso(T0);
  const emitidos: ArcadiaEvent[] = [];
  iniciarSimulacao({ cenario: 'pico', semente: 1, relogio, emitir: (e) => emitidos.push(e), velocidade: 10 });
  relogio.avancar(DURACAO_PADRAO_MS.pico / 10);
  assert.equal(emitidos.length, gerarCenario('pico', { semente: 1, inicio: T0 }).length);
  assert.ok((emitidos.at(-1)?.ts ?? 0) <= T0 + DURACAO_PADRAO_MS.pico / 10);
});
