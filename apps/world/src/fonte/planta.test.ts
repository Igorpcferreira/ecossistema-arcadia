// Planta do andar a partir das alas do servidor (ADR 0004): academia, tema da configuração, lotes novos
// e anexos. Roda no Node, sem navegador: node --test "apps/world/src/**/*.test.ts".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANTA_EXEMPLO } from '../cena/exemplo.ts';
import { gerarCena } from '../cena/gerador.ts';
import type { CenaDados, LotePlanta } from '../cena/formato.ts';
import { plantaDoServidor, type MapaPlanta } from './planta.ts';
import { estadoTeste, salaTeste, type AlaTeste } from './teste-estado.ts';

const DENSIDADES = ['cheio', 'prancha'] as const;
const cenas = (mp: MapaPlanta): CenaDados[] => DENSIDADES.map((densidade) => gerarCena(mp.planta, { densidade, paleta: 'fria' }));
const lote = (mp: MapaPlanta, zona: string): LotePlanta => { const l = mp.planta.lotes.find((x) => x.zona === zona); assert.ok(l, `sem o lote ${zona}`); return l; };
const loteDaAla = (mp: MapaPlanta, ala: string): LotePlanta => lote(mp, mp.zonaDaAla.get(ala)!);

/** Toda sala do estado tem um terreno só dela, que existe nas duas densidades. */
function confereTerrenos(mp: MapaPlanta, chaves: string[]): void {
  const usados = new Set<string>();
  for (const k of chaves) {
    const t = mp.salas.get(k);
    assert.ok(t, `a sala ${k} ficou sem terreno`);
    const chave = `${t.zona}|${t.vaga}`;
    assert.ok(!usados.has(chave), `terreno repetido: ${chave}`);
    usados.add(chave);
    for (const c of cenas(mp)) assert.ok(t.vaga < (c.vagasPod[t.zona]?.length ?? 0), `o terreno ${chave} não existe na cena`);
  }
}

test('academia comum fica no andar quando nenhuma ala é de academia', () => {
  const e = estadoTeste([{ id: 'loja', tema: 'agencia', salas: 2 }, { id: 'oficina', salas: 1, tipoSala: 'backend' }]);
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  const ac = mp.planta.lotes.filter((l) => l.tema === 'academia');
  assert.equal(ac.length, 1);
  assert.equal(ac[0].tipo, 'area', 'a academia sem ala vira área comum');
  assert.equal(ac[0].nome, 'ACADEMIA');
  assert.ok(!mp.livres.has(ac[0].zona), 'academia nunca vira lote livre');
  for (const c of cenas(mp)) { assert.ok(c.pontos.treinos.length > 0, 'sem pontos de treino'); assert.ok(c.pontos.pausas.length > 0, 'sem lounge'); }
});

test('academia continua quando há mais alas do que lotes, e nenhuma ala de outro tema a toma', () => {
  const alas: AlaTeste[] = ['equipe', 'agencia', 'estudio', 'corporativo', 'produtos', 'pessoal', 'laboratorio', 'bastidores']
    .map((tema, k) => ({ id: `ala${k}`, tema: tema as AlaTeste['tema'], salas: 1 }));
  alas.push({ id: 'sem-tema-1', salas: 2 }, { id: 'sem-tema-2', salas: 1, tipoSala: 'video' });
  const mp = plantaDoServidor(PLANTA_EXEMPLO, estadoTeste(alas));
  const ac = mp.planta.lotes.filter((l) => l.tema === 'academia');
  assert.equal(ac.length, 1);
  assert.equal(ac[0].tipo, 'area');
  for (const a of alas) assert.notEqual(loteDaAla(mp, a.id).tema, 'academia', `a ala ${a.id} tomou a academia`);
  for (const c of cenas(mp)) assert.ok(c.pontos.treinos.length > 0);
});

test('ala de tema academia fica com o lote da academia e mantém os treinos', () => {
  const e = estadoTeste([{ id: 'alfa', tema: 'equipe', salas: 2 }, { id: 'treino', tema: 'academia', nome: 'Saúde e academia', salas: 1 }]);
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  const l = loteDaAla(mp, 'treino');
  assert.equal(l.tema, 'academia');
  assert.equal(l.tipo, 'ala');
  assert.equal(l.nome, 'SAÚDE E ACADEMIA');
  assert.deepEqual([l.col, l.lin], [2, 1], 'o lote da academia do exemplo');
  for (const c of cenas(mp)) assert.ok(c.pontos.treinos.length > 0);
  // o id da academia, sem campo tema, também vale
  const mp2 = plantaDoServidor(PLANTA_EXEMPLO, estadoTeste([{ id: 'academia', salas: 1 }]));
  assert.equal(loteDaAla(mp2, 'academia').tema, 'academia');
});

test('o tema da configuração vem antes do id e do conteúdo da ala', () => {
  // id de tema (estudio), salas de vídeo e tema corporativo na configuração: vale o corporativo
  const e = estadoTeste([{ id: 'estudio', tema: 'corporativo', salas: 2, tipoSala: 'video' }, { id: 'web', salas: 2 }]);
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  const l = loteDaAla(mp, 'estudio');
  assert.equal(l.tema, 'corporativo');
  assert.deepEqual([l.col, l.lin], [0, 1], 'o lote corporativo do exemplo');
  // sem tema: o conteúdo decide (salas de site viram agência)
  assert.equal(loteDaAla(mp, 'web').tema, 'agencia');
  // ala com o id de um lote da base e outro tema na configuração: fica no lote, com o tema da configuração
  const mp2 = plantaDoServidor(PLANTA_EXEMPLO, estadoTeste([{ id: 'alfa', tema: 'laboratorio', salas: 1 }]));
  const l2 = loteDaAla(mp2, 'alfa');
  assert.deepEqual([l2.col, l2.lin, l2.tema], [1, 0, 'laboratorio']);
});

test('nove alas com tema: o andar sai como o cenário local aprovado', () => {
  const temas = ['equipe', 'agencia', 'estudio', 'corporativo', 'academia', 'produtos', 'pessoal', 'laboratorio', 'bastidores'] as const;
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'produtos', 'a7', 'a8', 'a9'];
  const mp = plantaDoServidor(PLANTA_EXEMPLO, estadoTeste(temas.map((tema, k) => ({ id: ids[k], tema, salas: 1 }))));
  const pos = (id: string) => { const l = loteDaAla(mp, id); return [l.col, l.lin, l.cols ?? 1, l.tema]; };
  assert.deepEqual(pos('a1'), [1, 0, 1, 'equipe']);
  assert.deepEqual(pos('a2'), [2, 0, 1, 'agencia']);
  assert.deepEqual(pos('a3'), [3, 0, 1, 'estudio']);
  assert.deepEqual(pos('a4'), [0, 1, 1, 'corporativo']);
  assert.deepEqual(pos('a5'), [2, 1, 1, 'academia']);
  assert.deepEqual(pos('produtos'), [1, 2, 1, 'produtos']);
  assert.deepEqual(pos('a7'), [0, 3, 1, 'pessoal']);
  assert.deepEqual(pos('a8'), [1, 3, 1, 'laboratorio']);
  assert.deepEqual(pos('a9'), [2, 3, 2, 'bastidores']);
  assert.deepEqual(mp.planta.linhas, [11, 10, 11, 10]);
  assert.equal(mp.livres.size, 0);
  assert.equal(mp.anexos.size, 0);
});

test('toda sala tem cápsula numa ala com 6 ou mais salas: o que não cabe vai para anexos', () => {
  for (const n of [6, 9, 13, 20]) {
    const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: n }, { id: 'loja', tema: 'agencia', salas: 2 }]);
    const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
    confereTerrenos(mp, Object.keys(e.salas));
    const zonas = mp.zonasDaAla.get('time')!;
    assert.ok(zonas.length >= 2, `com ${n} salas a ala de equipe precisa de anexo`);
    for (const z of zonas.slice(1)) {
      assert.ok(mp.anexos.has(z));
      assert.equal(mp.alaDaZona.get(z), 'time');
      const l = lote(mp, z);
      assert.match(l.nome, /ANEXO/);
      assert.equal(l.cor, '#88aaff', 'o anexo tem a cor da ala');
    }
    // as primeiras salas (pelo terreno do servidor) ficam no lote da própria ala
    assert.equal(mp.salas.get('time-sala-0')?.zona, mp.zonaDaAla.get('time'));
  }
});

test('anexo usa um lote livre do andar antes de abrir uma linha nova, e nunca a academia', () => {
  const e = estadoTeste([{ id: 'time', tema: 'equipe', salas: 8 }]);
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  const anexo = mp.zonasDaAla.get('time')![1];
  const l = lote(mp, anexo);
  assert.ok(l.lin <= 2, 'o anexo ficou num lote da base');
  assert.notEqual(l.zona, 'saude');
  assert.deepEqual(mp.planta.linhas, PLANTA_EXEMPLO.linhas, 'sem linha nova');
  confereTerrenos(mp, Object.keys(e.salas));
  for (const c of cenas(mp)) assert.ok(c.pontos.treinos.length > 0);
});

test('sem lote livre, o anexo entra no fim do andar e o andar das nove alas só ganha esse lote', () => {
  const temas = ['equipe', 'agencia', 'estudio', 'corporativo', 'academia', 'produtos', 'pessoal', 'laboratorio', 'bastidores'] as const;
  const alas: AlaTeste[] = temas.map((tema, k) => ({ id: `b${k}`, tema, salas: k === 0 ? 6 : 1 }));
  const e = estadoTeste(alas);
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  confereTerrenos(mp, Object.keys(e.salas));
  const anexo = lote(mp, mp.zonasDaAla.get('b0')![1]);
  assert.deepEqual([anexo.col, anexo.lin, anexo.cols ?? 1], [3, 3, 1]);
  const ultima = loteDaAla(mp, 'b8');
  assert.deepEqual([ultima.col, ultima.lin, ultima.cols ?? 1], [2, 3, 1], 'com o anexo, a última ala fica com uma coluna');
});

test('salas sem ala conhecida ficam na Recepção, que também cresce', () => {
  const e = estadoTeste([]);
  for (let k = 0; k < 9; k++) { const s = salaTeste(k % 2 ? 'recepcao' : 'ala-que-saiu', k); e.salas[s.chave] = s; }
  const mp = plantaDoServidor(PLANTA_EXEMPLO, e);
  confereTerrenos(mp, Object.keys(e.salas));
  assert.equal(mp.salas.get('ala-que-saiu-sala-0')?.zona, mp.zonaRecepcao);
  assert.ok(mp.zonasDaAla.get('recepcao')!.length >= 2, 'nove salas pedem um anexo da Recepção');
});
