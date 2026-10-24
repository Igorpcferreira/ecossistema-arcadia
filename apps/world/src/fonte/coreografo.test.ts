// Coreógrafo sem navegador: a obra de toda sala nova aparece (no terreno livre ou, numa ala cheia, no anexo
// depois da remontagem), quem senta na cápsula é o dono dela, e a assinatura das alas pega nome, cor e tema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTA_EXEMPLO } from '../cena/exemplo.ts';
import { gerarCena } from '../cena/gerador.ts';
import { Mundo } from '../cena/mundo.ts';
import { Simulador } from '../cena/simulador.ts';
import { Coreografo } from './coreografo.ts';
import { Espelho, assinaturaAlas } from './espelho.ts';
import { STATUS_DELEGACAO, semDelegacaoRepetida, textoAcao } from './cartoes.ts';
import { plantaDoServidor } from './planta.ts';
import type { Acao, Agente, EstadoMundo, Obra, Quadro } from './tipos.ts';
import { AGORA, estadoTeste, salaTeste, snapshotTeste } from './teste-estado.ts';

/** Monta o mundo como a página faz (planta, cena, mundo, coreógrafo) e conta as remontagens pedidas. */
function montar(e: EstadoMundo, densidade: 'cheio' | 'prancha' = 'cheio') {
  const espelho = new Espelho(snapshotTeste(e));
  const mapa = plantaDoServidor(PLANTA_EXEMPLO, espelho.estado);
  const m = new Mundo(gerarCena(mapa.planta, { densidade, paleta: 'fria' }), 7);
  const cor = new Coreografo(m, espelho, mapa, new Simulador(m));
  const r = { espelho, mapa, m, cor, remontagens: 0 };
  cor.aoRemontar = () => { r.remontagens++; };
  cor.montar();
  return r;
}

function quadroSalaNova(e: EstadoMundo, alaId: string, k: number): { quadro: Quadro; obra: Obra } {
  const sala = salaTeste(alaId, k);
  const obra: Obra = { salaChave: sala.chave, alaId, inicio: AGORA, fim: AGORA + 60_000 };
  return { quadro: { seq: 2, ts: AGORA, mudancas: [{ k: 'sala', sala }, { k: 'obra', obra }] } as Quadro, obra };
}

test('sala nova com terreno livre: a obra aparece no mesmo mundo, sem remontar', () => {
  const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: 2 }]);
  const a = montar(e);
  const { quadro, obra } = quadroSalaNova(e, 'time', 2);
  a.espelho.aplicar(quadro);
  a.cor.passo(1 / 60);
  assert.equal(a.remontagens, 0);
  assert.equal(a.m.obras.length, 1);
  assert.equal(a.m.obras[0].chave, obra.salaChave);
  assert.equal(a.m.obras[0].zona, a.mapa.zonaDaAla.get('time'));
});

test('sala nova numa ala cheia: o andar remonta com um anexo e a obra continua visível lá', () => {
  // enche a ala de equipe até o último terreno do lote dela
  const base = montar(estadoTeste([{ id: 'time', tema: 'equipe', salas: 0 }]));
  const cabe = base.m.cena.vagasPod[base.mapa.zonaDaAla.get('time')!].length;
  const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: cabe }]);
  const a = montar(e);
  assert.equal(a.remontagens, 0);
  assert.equal(a.mapa.zonasDaAla.get('time')!.length, 1, 'a ala cheia ainda cabe no lote dela');
  const { quadro, obra } = quadroSalaNova(e, 'time', cabe);
  a.espelho.aplicar(quadro);
  a.cor.passo(1 / 60);
  assert.equal(a.remontagens, 1, 'sem terreno, o coreógrafo pede o andar maior (nunca sai calado)');
  // a página remonta com o estado do espelho: o anexo nasce e a obra está nele, com a câmera indo até lá
  const b = montar(a.espelho.estado);
  assert.equal(b.remontagens, 0, 'a remontagem não pede outra');
  const zonas = b.mapa.zonasDaAla.get('time')!;
  assert.equal(zonas.length, 2);
  assert.equal(b.m.obras.length, 1);
  assert.equal(b.m.obras[0].chave, obra.salaChave);
  assert.equal(b.m.obras[0].zona, zonas[1]);
  assert.ok(b.m.focoForcado, 'obra recente leva a câmera');
});

for (const densidade of ['cheio', 'prancha'] as const) {
  test(`obra de toda sala nova, uma depois da outra, até passar do anexo (${densidade})`, () => {
    let a = montar(estadoTeste([{ id: 'time', tema: 'bastidores', salas: 0 }]), densidade);
    let remontagens = 0;
    for (let k = 0; k < 14; k++) {
      const { quadro, obra } = quadroSalaNova(a.espelho.estado, 'time', k);
      a.espelho.aplicar(quadro);
      a.cor.passo(1 / 60);
      if (a.remontagens) { remontagens++; a = montar(a.espelho.estado, densidade); assert.equal(a.remontagens, 0); }
      assert.ok(a.m.obras.some((o) => o.chave === obra.salaChave), `a obra da sala ${k + 1} não apareceu`);
      // a obra termina: a cápsula fica no terreno dela
      a.espelho.aplicar({ seq: 3 + k, ts: AGORA, mudancas: [{ k: 'obra.fim', salaChave: obra.salaChave }] } as Quadro);
      a.cor.passo(1 / 60);
      assert.ok(a.m.objetos.some((o) => o.tipo === 'pod' && o.props.sala === obra.salaChave), `sem cápsula para a sala ${k + 1}`);
    }
    assert.ok(remontagens >= 2 && a.mapa.zonasDaAla.get('time')!.length >= 3, 'catorze salas pedem dois anexos');
  });
}

test('quem senta na cápsula da sala é o dono dela (holograma e tela seguem o estado dele)', () => {
  const e = estadoTeste([{ id: 'time', tema: 'agencia', salas: 1 }]);
  const ag: Agente = {
    chave: 'sim:sessao', tipo: 'sessao', motor: 'claude', origem: 'simulador', estado: 'lendo', desde: AGORA, salaChave: 'time-sala-0',
    ultimasAcoes: [], uso: { entrada: 0, saida: 0, cache: 0 }, entregasHoje: 0, errosHoje: 0, chegouEm: AGORA - 5000, visto: AGORA,
  } as unknown as Agente;
  e.agentes[ag.chave] = ag;
  const a = montar(e);
  const pod = a.m.objetos.find((o) => o.tipo === 'pod' && o.props.sala === 'time-sala-0');
  assert.ok(pod);
  assert.equal(pod.dono, 'sim:sessao');
});

test('assinatura das alas muda com nome, cor e tema (remonta o andar), e não com o resto', () => {
  const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: 1 }]);
  const antes = assinaturaAlas(e);
  const mudar = (f: (x: EstadoMundo) => void) => { const c = structuredClone(e); f(c); return assinaturaAlas(c); };
  assert.notEqual(mudar((c) => { c.alas.time.nome = 'Outro nome'; }), antes);
  assert.notEqual(mudar((c) => { c.alas.time.cor = '#123456'; }), antes);
  assert.notEqual(mudar((c) => { c.alas.time.tema = 'agencia'; }), antes);
  assert.notEqual(mudar((c) => { delete c.alas.time.tema; }), antes);
  assert.equal(mudar((c) => { c.alas.time.ativa = false; c.salas['time-sala-0'].dormindo = true; }), antes);
});

test('ala renomeada no SSE: o coreógrafo pede a remontagem', () => {
  const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: 1 }]);
  const a = montar(e);
  a.espelho.aplicar({ seq: 2, ts: AGORA, mudancas: [{ k: 'ala', ala: { ...e.alas.time, nome: 'Time novo' } }] } as Quadro);
  a.cor.passo(1 / 60);
  assert.equal(a.remontagens, 1);
});

test('status da delegação em português no cartão', () => {
  assert.equal(STATUS_DELEGACAO.running, 'em andamento');
  assert.equal(STATUS_DELEGACAO.queued, 'na fila');
  assert.equal(STATUS_DELEGACAO.completed, 'concluída');
  assert.equal(STATUS_DELEGACAO.failed, 'falhou');
});

test('delegação no cartão: a ferramenta de delegar sai quando o evento da mesma delegação está junto', () => {
  const acoes: Acao[] = [
    { ts: AGORA, tipo: 'ferramenta.inicio', categoria: 'delegar', nome: 'coordinate_bots' },
    { ts: AGORA + 200, tipo: 'delegacao.enviada', categoria: 'delegar' },
    { ts: AGORA + 9_000, tipo: 'ferramenta.inicio', categoria: 'delegar', nome: 'Task' },
    { ts: AGORA + 9_500, tipo: 'ferramenta.inicio', categoria: 'ler', alvo: 'a.ts' },
  ];
  assert.deepEqual(semDelegacaoRepetida(acoes).map(textoAcao), ['delegou uma tarefa', 'delegou', 'leu a.ts']);
});
