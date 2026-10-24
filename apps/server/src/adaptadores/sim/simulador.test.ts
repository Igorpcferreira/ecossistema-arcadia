// Testes do simulador e do replay determinístico (mesma semente e mesmos eventos dão o mesmo estado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaEstadoMundo, sanearEvento, type ArcadiaEvent } from '@arcadia/shared';
import { AGENTES_ESTADOS, CENARIOS, DURACAO_PADRAO_MS, ROTEIRO_ESTADOS, gerarCenario, iniciarSimulacao, type Cenario } from './simulador.ts';
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

/** Roda duas rodadas seguidas do cenário "estados" e confere cada passo do roteiro documentado, meio segundo depois. */
function conferirRoteiroEstados(cfgE: ReturnType<typeof configMotorPadrao>, semente: number) {
  const DURACAO = DURACAO_PADRAO_MS.estados;
  const rodadas = [0, 1].map((rodada) => ({ rodada, inicio: T0 + rodada * DURACAO }));
  const eventos = rodadas.flatMap(({ rodada, inicio }) => gerarCenario('estados', { semente, inicio, alas: IDS_ALAS, rodada }));
  const passos = ROTEIRO_ESTADOS.filter((p) => !p.ocioCurto || cfgE.pausaMs === 15_000);
  const checagens = rodadas
    .flatMap(({ rodada, inicio }) => passos.map((p) => ({ rodada, inicio, p, quando: inicio + Math.round((p.t + 0.5) * 1000) })))
    .sort((a, b) => a.quando - b.quando);
  let e = criarEstadoInicial(T0, cfgE, RECEP);
  e = aplicar(e, { k: 'alas', agora: T0, alas: ALAS, recepcao: RECEP }, cfgE).estado;
  const emitidos: { quando: number; ev: ArcadiaEvent }[] = [];
  const guardar = (r: ReturnType<typeof aplicar>, quando: number) => {
    for (const m of r.mudancas) if (m.k === 'evento') emitidos.push({ quando, ev: m.evento });
    return r.estado;
  };
  const erros: string[] = [];
  const fotos = new Map<string, EstadoMotor>();
  let i = 0;
  for (const c of checagens) {
    while (i < eventos.length && (eventos[i] as ArcadiaEvent).recebidoEm <= c.quando) {
      const ev = eventos[i++] as ArcadiaEvent;
      e = guardar(aplicar(e, { k: 'evento', evento: ev }, cfgE), ev.recebidoEm);
    }
    e = guardar(aplicar(e, { k: 'tick', agora: c.quando }, cfgE), c.quando);
    const visto = e.mundo.agentes[c.p.agente]?.estado ?? 'fora';
    if (visto !== c.p.estado) erros.push(`rodada ${c.rodada}, ${c.p.t} s, ${c.p.agente}: esperava ${c.p.estado}, veio ${visto}`);
    fotos.set(`${c.rodada}:${c.p.t}:${c.p.agente}`, e);
  }
  return { erros, fotos, emitidos, rodadas, passos };
}

test('estados: cada passo do roteiro documentado acontece na hora, nas duas rodadas, com o ócio curto e com o padrão', () => {
  for (const cfgE of [configMotorPadrao({ pausaMs: 15_000, dormeMs: 30_000 }), configMotorPadrao()]) {
    for (const semente of [1, 42]) {
      const { erros, passos } = conferirRoteiroEstados(cfgE, semente);
      assert.deepEqual(erros, [], `pausa ${cfgE.pausaMs / 1000} s, semente ${semente}:\n${erros.join('\n')}`);
      assert.ok(passos.length >= 30);
    }
  }
});

test('estados: o roteiro cobre a tabela 4.3 inteira, mais talvez esperando, saindo, pausa e sono', () => {
  const estados = new Set(ROTEIRO_ESTADOS.map((p) => p.estado));
  const tabela = ['chegando', 'pensando', 'lendo', 'editando', 'comando', 'delegando', 'esperando', 'erro', 'entregou', 'ocioso', 'na-fila', 'sem-sinal', 'limite'];
  for (const s of [...tabela, 'talvez-esperando', 'saindo', 'pausa', 'dormindo']) assert.ok(estados.has(s as never), `falta ${s}`);
  // Um estado de cada vez: o mesmo agente nunca tem dois passos a menos de 1 s, e o roteiro está em ordem.
  for (let i = 1; i < ROTEIRO_ESTADOS.length; i++) assert.ok((ROTEIRO_ESTADOS[i] as { t: number }).t >= (ROTEIRO_ESTADOS[i - 1] as { t: number }).t, 'em ordem');
  const porAgente = new Map<string, number[]>();
  for (const p of ROTEIRO_ESTADOS) porAgente.set(p.agente, [...(porAgente.get(p.agente) ?? []), p.t]);
  for (const [agente, ts] of porAgente) for (let i = 1; i < ts.length; i++) assert.ok((ts[i] as number) - (ts[i - 1] as number) >= 1, `${agente}: passos colados em ${ts[i]} s`);
});

test('estados: sala nova a cada rodada, subagente filho da sessão, fila, espera resolvida e delegação entre bots', () => {
  const { fotos, emitidos, rodadas } = conferirRoteiroEstados(configMotorPadrao({ pausaMs: 15_000, dormeMs: 30_000 }), 42);
  const foto = (rodada: number, t: number, agente: string) => {
    const f = fotos.get(`${rodada}:${t}:${agente}`);
    assert.ok(f, `sem foto em ${t} s`);
    return f.mundo;
  };
  const S = AGENTES_ESTADOS.sessao;
  for (const { rodada, inicio } of rodadas) {
    // Sala nova: uma por rodada, com obra de 60 s na ala.
    const chaveObra = `sim-estados-obra-${inicio.toString(36)}`;
    const m155 = foto(rodada, 155, AGENTES_ESTADOS.pioneira);
    assert.equal(m155.salas[chaveObra]?.alaId, 'trabalho');
    assert.ok(m155.obras.some((o) => o.salaChave === chaveObra && o.fim === o.inicio + 60_000), 'a sala nova está em obra');
    assert.equal(m155.agentes[AGENTES_ESTADOS.pioneira]?.salaChave, chaveObra);
    // Subagente nasce na sala da sessão, filho dela.
    const m44 = foto(rodada, 44, AGENTES_ESTADOS.subagente);
    assert.equal(m44.agentes[AGENTES_ESTADOS.subagente]?.paiChave, S);
    assert.equal(m44.agentes[AGENTES_ESTADOS.subagente]?.salaChave, 'sim-estados-sala');
    // Talvez esperando é o sintético (espera.inicio do tipo talvez), não a fila.
    assert.ok(emitidos.some((x) => x.ev.agente.chave === S && x.ev.tipo === 'espera.inicio' && x.ev.espera?.tipo === 'talvez' && x.ev.ts === inicio + 62_000));
    assert.equal(foto(rodada, 62, S).precisaDeVoce.length, 0);
    // Esperando você: na fila, com o tipo; resolvida: a fila esvazia e o espera.fim sai para o mundo (check verde).
    assert.deepEqual(foto(rodada, 71, S).precisaDeVoce.map((x) => [x.agenteChave, x.tipo]), [[S, 'permissao']]);
    assert.equal(foto(rodada, 79, S).precisaDeVoce.length, 0);
    assert.ok(emitidos.some((x) => x.ev.agente.chave === S && x.ev.tipo === 'espera.fim' && x.ev.ts === inicio + 79_000));
    // Delegação entre bots, com título; some quando o colega conclui.
    const d = Object.values(foto(rodada, 102, AGENTES_ESTADOS.coordenacao).delegacoes);
    assert.equal(d.length, 1);
    assert.equal(d[0]?.de, AGENTES_ESTADOS.coordenacao);
    assert.equal(d[0]?.para, AGENTES_ESTADOS.colega);
    assert.ok(d[0]?.titulo);
    assert.equal(Object.keys(foto(rodada, 115.2, AGENTES_ESTADOS.colega).delegacoes).length, 0);
  }
  // Entregas e erros entram nas métricas (a rodada 1 soma de novo).
  const m = foto(1, 205, AGENTES_ESTADOS.pioneira).metricas;
  assert.equal(m.entregas, 6, 'por rodada: sessão, colega e coordenação');
  assert.equal(m.erros, 2);
  // As salas fixas nascem uma vez só; a sala nova é outra a cada rodada.
  const salas = Object.keys(foto(1, 205, AGENTES_ESTADOS.pioneira).salas).filter((k) => k.startsWith('sim-estados-'));
  assert.equal(salas.length, 4);
});
