// Testes do motor do mundo: redutores puros, timers com relógio controlado, salas, delegações e métricas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EsquemaEstadoMundo, EsquemaMudanca, type Mudanca } from '@arcadia/shared';
import { aplicar, configMotorPadrao, criarEstadoInicial, type Entrada, type EstadoMotor } from './motor.ts';
import { congelar, ev, json } from '../testes/apoio.ts';

const cfg = configMotorPadrao();
const RECEP = { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a' };
const ALAS = [
  { id: 'produtos', nome: 'Produtos', cor: '#c9a7ff' },
  { id: 'estudio', nome: 'Estúdio', cor: '#ffb347' },
];
// 22/10/2026 12:00 em São Paulo.
const T0 = Date.UTC(2026, 9, 22, 15, 0, 0);

class Mundo {
  estado: EstadoMotor;
  mudancas: Mudanca[] = [];
  todas: Mudanca[] = [];
  dias: { dia: string }[] = [];
  constructor(t0 = T0) {
    this.estado = criarEstadoInicial(t0, cfg, RECEP);
    this.aplicar({ k: 'alas', agora: t0, alas: ALAS, recepcao: RECEP });
  }
  aplicar(entrada: Entrada): this {
    const antes = JSON.stringify(this.estado);
    congelar(this.estado);
    const r = aplicar(this.estado, entrada, cfg);
    assert.equal(JSON.stringify(this.estado), antes, 'o redutor mudou o estado de entrada');
    this.estado = r.estado;
    this.mudancas = r.mudancas;
    this.todas.push(...r.mudancas);
    this.dias.push(...r.diasFechados);
    for (const m of r.mudancas) {
      const v = EsquemaMudanca.safeParse(m);
      assert.ok(v.success, `mudança inválida: ${JSON.stringify(v.success ? '' : v.error.issues)}`);
    }
    return this;
  }
  e(...lista: Parameters<typeof ev>[]): this {
    for (const args of lista) this.aplicar({ k: 'evento', evento: ev(...args) });
    return this;
  }
  tick(t: number): this {
    return this.aplicar({ k: 'tick', agora: t });
  }
  agente(k = 'sim:a') {
    return this.estado.mundo.agentes[k];
  }
  valido(): void {
    const r = EsquemaEstadoMundo.safeParse(json(this.estado.mundo));
    assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues));
  }
}

const sala = (chave: string, nome: string, ala?: string) => ({ projetoChave: chave, sala: ala ? { nome, ala } : { nome } });

test('agente novo chega, fica ocioso, pausa em 3 min, dorme em 20 min e o visitante vai embora', () => {
  const m = new Mundo().e(['sessao.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }]);
  assert.equal(m.agente()?.estado, 'chegando');
  assert.equal(m.agente()?.salaChave, 's-alfa');
  m.tick(T0 + 9_999);
  assert.equal(m.agente()?.estado, 'chegando');
  m.tick(T0 + 10_000);
  assert.equal(m.agente()?.estado, 'ocioso');
  m.tick(T0 + 3 * 60_000 - 1);
  assert.equal(m.agente()?.estado, 'ocioso');
  m.tick(T0 + 3 * 60_000);
  assert.equal(m.agente()?.estado, 'pausa');
  assert.equal(m.agente()?.desde, T0 + 3 * 60_000);
  m.tick(T0 + 20 * 60_000);
  assert.equal(m.agente()?.estado, 'dormindo');
  m.tick(T0 + 20 * 60_000 + 4 * 3600_000);
  assert.equal(m.agente()?.estado, 'saindo');
  m.tick(T0 + 20 * 60_000 + 4 * 3600_000 + 10_000);
  assert.equal(m.agente(), undefined);
  assert.ok(m.mudancas.some((x) => x.k === 'agente.saiu' && x.chave === 'sim:a'));
  assert.ok(m.estado.mundo.salas['s-alfa'], 'sala nunca é apagada');
  assert.equal(m.estado.mundo.salas['s-alfa']?.dormindo, true);
  m.valido();
});

test('tick a cada segundo ou um tick só no fim dão o mesmo estado', () => {
  const eventos: Parameters<typeof ev>[] = [
    ['sessao.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['turno.inicio', T0 + 1_000],
    ['ferramenta.inicio', T0 + 1_500, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'f1' } }],
    ['ferramenta.fim', T0 + 1_600, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'f1', ok: true } }],
    ['pensando', T0 + 2_000, { turno: { texto: true } }],
  ];
  const fino = new Mundo().e(...eventos);
  for (let t = T0 + 2_000; t <= T0 + 30 * 60_000; t += 1_000) fino.tick(t);
  const grosso = new Mundo().e(...eventos).tick(T0 + 30 * 60_000);
  assert.deepEqual(json(grosso.estado), json(fino.estado));
});

test('debounce de 300 ms: troca rápida não pisca e o estado visível segue depois da janela', () => {
  const m = new Mundo().e(
    ['turno.inicio', T0],
    ['ferramenta.inicio', T0 + 1_000, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'f1' } }],
  );
  assert.equal(m.agente()?.estado, 'lendo');
  assert.equal(m.agente()?.ferramenta?.nome, 'Read');
  m.e(['ferramenta.fim', T0 + 1_100, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'f1', ok: true } }]);
  assert.equal(m.agente()?.estado, 'lendo', 'ainda dentro da janela de 300 ms');
  m.tick(T0 + 1_299);
  assert.equal(m.agente()?.estado, 'lendo');
  m.tick(T0 + 1_300);
  assert.equal(m.agente()?.estado, 'pensando');
  assert.equal(m.agente()?.desde, T0 + 1_100, 'desde marca quando o estado lógico mudou');
  assert.equal(m.agente()?.ferramenta, undefined);
  // Ida e volta dentro da janela: o visível nem muda.
  m.e(
    ['ferramenta.inicio', T0 + 5_000, { ferramenta: { nome: 'Grep', categoria: 'ler', id: 'f2' } }],
    ['ferramenta.fim', T0 + 5_100, { ferramenta: { nome: 'Grep', categoria: 'ler', id: 'f2', ok: true } }],
  );
  assert.equal(m.agente()?.estado, 'lendo');
  m.tick(T0 + 5_300);
  assert.equal(m.agente()?.estado, 'pensando');
});

test('turno só de texto sem dados por 5 s vira concluído', () => {
  const m = new Mundo().e(['turno.inicio', T0], ['pensando', T0 + 1_000, { turno: { texto: true } }]);
  m.tick(T0 + 5_999);
  assert.equal(m.agente()?.estado, 'pensando');
  m.tick(T0 + 6_000);
  assert.equal(m.agente()?.estado, 'entregou');
  assert.equal(m.estado.mundo.metricas.entregas, 1);
  assert.ok(m.mudancas.some((x) => x.k === 'evento' && x.evento.tipo === 'turno.fim' && x.evento.id.startsWith('sint.')));
  // Raciocínio depois do texto desarma o timer.
  const n = new Mundo().e(['turno.inicio', T0], ['pensando', T0 + 1_000, { turno: { texto: true } }], ['pensando', T0 + 2_000]);
  n.tick(T0 + 60_000);
  assert.equal(n.agente()?.estado, 'pensando');
});

test('ferramenta sem resultado por mais de 7 s, sem sinal exato, vira talvez esperando', () => {
  const m = new Mundo().e(['turno.inicio', T0], ['ferramenta.inicio', T0 + 1_000, { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f1' } }]);
  m.tick(T0 + 7_999);
  assert.equal(m.agente()?.estado, 'comando');
  m.tick(T0 + 8_000);
  assert.equal(m.agente()?.estado, 'talvez-esperando');
  assert.equal(m.agente()?.espera?.tipo, 'talvez');
  assert.equal(m.estado.mundo.precisaDeVoce.length, 0, 'talvez não entra na fila exata');
  m.e(['ferramenta.fim', T0 + 9_000, { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f1', ok: true } }]);
  assert.equal(m.agente()?.estado, 'pensando');
  // Bot (sinal exato do OMB): sem heurística.
  const b = new Mundo().e(
    ['turno.inicio', T0, { agente: { chave: 'omb:b1', tipo: 'bot' } }],
    ['ferramenta.inicio', T0 + 1_000, { agente: { chave: 'omb:b1', tipo: 'bot' }, ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f1' } }],
  );
  b.tick(T0 + 5 * 60_000);
  assert.equal(b.agente('omb:b1')?.estado, 'comando');
  // Delegação não conta: subagente demora mesmo.
  const d = new Mundo().e(['turno.inicio', T0], ['ferramenta.inicio', T0 + 1_000, { ferramenta: { nome: 'Task', categoria: 'delegar', id: 'f9' } }]);
  d.tick(T0 + 60_000);
  assert.equal(d.agente()?.estado, 'delegando');
});

test('espera exata entra na fila, não pausa e sai com espera.fim', () => {
  const m = new Mundo().e(
    ['turno.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['ferramenta.inicio', T0 + 500, { ferramenta: { nome: 'Edit', categoria: 'editar', id: 'f1' } }],
    ['espera.inicio', T0 + 1_000, { espera: { tipo: 'permissao' } }],
  );
  assert.equal(m.agente()?.estado, 'esperando');
  assert.deepEqual(m.estado.mundo.precisaDeVoce.map((i) => [i.agenteChave, i.tipo, i.salaChave]), [['sim:a', 'permissao', 's-alfa']]);
  m.tick(T0 + 2 * 3600_000);
  assert.equal(m.agente()?.estado, 'esperando', 'espera exata nunca vira pausa nem sono');
  m.e(['espera.fim', T0 + 2 * 3600_000 + 1]);
  assert.equal(m.estado.mundo.precisaDeVoce.length, 0);
  assert.equal(m.agente()?.estado, 'editando');
  assert.equal(m.estado.mundo.metricas.esperas, 1);
});

test('salas nascem com obra, ocupam terrenos estáveis e a sem regra vai para a Recepção', () => {
  const m = new Mundo().e(
    ['sessao.inicio', T0, { agente: { chave: 'sim:a', tipo: 'sessao' }, local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['sessao.inicio', T0 + 1, { agente: { chave: 'sim:b', tipo: 'sessao' }, local: sala('s-beta', 'App Beta', 'produtos') }],
    ['sessao.inicio', T0 + 2, { agente: { chave: 'sim:c', tipo: 'sessao' }, local: sala('s-gama', 'Sem Regra') }],
    ['sessao.inicio', T0 + 3, { agente: { chave: 'sim:d', tipo: 'sessao' }, local: sala('s-delta', 'Ala Fantasma', 'nao-existe') }],
  );
  const s = m.estado.mundo.salas;
  assert.deepEqual([s['s-alfa']?.alaId, s['s-alfa']?.terreno], ['produtos', { indice: 0, col: 0, lin: 0 }]);
  assert.deepEqual([s['s-beta']?.alaId, s['s-beta']?.terreno], ['produtos', { indice: 1, col: 1, lin: 0 }]);
  assert.equal(s['s-gama']?.alaId, 'recepcao');
  assert.equal(s['s-delta']?.alaId, 'recepcao');
  assert.equal(m.estado.mundo.obras.length, 4);
  m.tick(T0 + 60_003);
  assert.equal(m.estado.mundo.obras.length, 0);
  assert.equal(m.mudancas.filter((x) => x.k === 'obra.fim').length, 4);
  // A Recepção classificada depois: a sala muda de ala, ganha terreno novo e obra.
  m.e(['turno.inicio', T0 + 70_000, { agente: { chave: 'sim:c', tipo: 'sessao' }, local: sala('s-gama', 'Sem Regra', 'estudio') }]);
  assert.equal(m.estado.mundo.salas['s-gama']?.alaId, 'estudio');
  assert.deepEqual(m.estado.mundo.salas['s-gama']?.terreno, { indice: 0, col: 0, lin: 0 });
  assert.equal(m.estado.mundo.obras.length, 1);
  // Terreno antigo da Alfa não muda com o tempo.
  m.tick(T0 + 30 * 24 * 3600_000);
  assert.deepEqual(m.estado.mundo.salas['s-alfa']?.terreno, { indice: 0, col: 0, lin: 0 });
  assert.equal(Object.keys(m.estado.mundo.salas).length, 4);
  m.valido();
});

test('histerese de 20 s para trocar de sala', () => {
  const m = new Mundo().e(['sessao.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }]);
  m.e(['ferramenta.inicio', T0 + 5_000, { ferramenta: { nome: 'Edit', categoria: 'editar', id: 'f1' }, local: sala('s-beta', 'App Beta', 'produtos') }]);
  assert.equal(m.agente()?.salaChave, 's-alfa');
  m.tick(T0 + 19_999);
  assert.equal(m.agente()?.salaChave, 's-alfa');
  m.tick(T0 + 20_000);
  assert.equal(m.agente()?.salaChave, 's-beta');
  // Voto que volta para a sala atual cancela a troca pendente.
  m.e(['ferramenta.inicio', T0 + 25_000, { ferramenta: { nome: 'Edit', categoria: 'editar', id: 'f2' }, local: sala('s-alfa', 'Portal Alfa', 'produtos') }]);
  m.e(['ferramenta.inicio', T0 + 26_000, { ferramenta: { nome: 'Edit', categoria: 'editar', id: 'f3' }, local: sala('s-beta', 'App Beta', 'produtos') }]);
  m.tick(T0 + 60_000);
  assert.equal(m.agente()?.salaChave, 's-beta');
});

test('delegação: envelope em voo, colega recebe a tarefa, conclusão devolve o remetente', () => {
  const bot = (chave: string) => ({ chave, tipo: 'bot' as const, nome: chave === 'omb:b1' ? 'Coordenação' : 'Código' });
  const m = new Mundo().e(
    ['turno.inicio', T0, { agente: bot('omb:b1'), local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['delegacao.enviada', T0 + 1_000, { agente: bot('omb:b1'), delegacao: { de: 'omb:b1', para: 'omb:b2', jobId: 'job-1', titulo: 'Revisar a tela' } }],
  );
  assert.equal(m.agente('omb:b1')?.estado, 'delegando');
  assert.equal(m.estado.mundo.delegacoes['job-1']?.status, 'enviada');
  m.e(['delegacao.recebida', T0 + 2_000, { agente: bot('omb:b2'), delegacao: { de: 'omb:b1', para: 'omb:b2', jobId: 'job-1', titulo: 'Revisar a tela' } }]);
  assert.equal(m.agente('omb:b2')?.estado, 'pensando');
  assert.equal(m.agente('omb:b2')?.tarefa, 'Revisar a tela');
  assert.equal(m.estado.mundo.delegacoes['job-1']?.status, 'recebida');
  m.e(['delegacao.concluida', T0 + 60_000, { agente: bot('omb:b2'), delegacao: { de: 'omb:b1', para: 'omb:b2', jobId: 'job-1' } }]);
  assert.equal(m.estado.mundo.delegacoes['job-1'], undefined);
  assert.ok(m.mudancas.some((x) => x.k === 'delegacao.fim' && x.chave === 'job-1'));
  assert.equal(m.agente('omb:b1')?.estado, 'pensando');
  assert.equal(m.estado.mundo.metricas.delegacoes, 1);
  // Delegação esquecida expira em 2 h.
  m.e(['delegacao.enviada', T0 + 70_000, { agente: bot('omb:b1'), delegacao: { de: 'omb:b1', para: 'omb:b2', jobId: 'job-2' } }]);
  m.tick(T0 + 70_000 + 2 * 3600_000);
  assert.equal(m.estado.mundo.delegacoes['job-2'], undefined);
});

test('erro, limite, uso e entrega mexem no estado e nas métricas', () => {
  const m = new Mundo().e(
    ['turno.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['ferramenta.inicio', T0 + 100, { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f1' } }],
    ['ferramenta.erro', T0 + 900, { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f1', ok: false } }],
  );
  assert.equal(m.agente()?.estado, 'erro');
  assert.equal(m.estado.mundo.salas['s-alfa']?.errosHoje, 1);
  m.e(['uso', T0 + 1_000, { uso: { entrada: 100, saida: 50, cache: 10, custoUsd: 0.0123 } }]);
  m.e(['uso', T0 + 1_100, { uso: { entrada: 1, saida: 2 } }]);
  assert.deepEqual(m.agente()?.uso, { entrada: 101, saida: 52, cache: 10, custoUsd: 0.0123 });
  assert.deepEqual(m.estado.mundo.metricas.tokens, { entrada: 101, saida: 52, cache: 10 });
  m.e(['entrega', T0 + 2_000]);
  assert.equal(m.estado.mundo.metricas.entregas, 1);
  m.e(['erro', T0 + 3_000]);
  assert.equal(m.estado.mundo.metricas.erros, 2);
  m.e(['limite', T0 + 4_000]);
  assert.equal(m.agente()?.estado, 'limite');
  m.tick(T0 + 2 * 3600_000);
  assert.equal(m.agente()?.estado, 'limite', 'limite só muda com atividade nova');
  assert.ok((m.agente()?.ultimasAcoes.length ?? 0) <= cfg.maxUltimasAcoes);
  m.valido();
});

test('subagente nasce na sala do pai, mantém o pai acordado e some ao terminar', () => {
  const m = new Mundo().e(
    ['turno.inicio', T0, { local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['ferramenta.inicio', T0 + 100, { ferramenta: { nome: 'Task', categoria: 'delegar', id: 'f1' } }],
    ['subagente.inicio', T0 + 200, { agente: { chave: 'sim:a:sub1', tipo: 'subagente', paiChave: 'sim:a' } }],
  );
  const sub = m.agente('sim:a:sub1');
  assert.equal(sub?.salaChave, 's-alfa');
  assert.equal(sub?.estado, 'pensando');
  m.e(['ferramenta.inicio', T0 + 170_000, { agente: { chave: 'sim:a:sub1', tipo: 'subagente', paiChave: 'sim:a' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 's1' } }]);
  m.e(['ferramenta.fim', T0 + 170_100, { agente: { chave: 'sim:a:sub1', tipo: 'subagente', paiChave: 'sim:a' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 's1' } }]);
  m.tick(T0 + 25 * 60_000);
  assert.equal(m.agente()?.ultimaAtividade, T0 + 170_100, 'atividade do subagente conta para o pai');
  m.e(['subagente.fim', T0 + 25 * 60_000 + 1, { agente: { chave: 'sim:a:sub1', tipo: 'subagente', paiChave: 'sim:a' } }]);
  assert.equal(m.agente('sim:a:sub1')?.estado, 'saindo');
  m.tick(T0 + 25 * 60_000 + 10_001);
  assert.equal(m.agente('sim:a:sub1'), undefined);
});

test('bot não vai embora: fim de sessão deixa ocioso', () => {
  const m = new Mundo().e(
    ['turno.inicio', T0, { agente: { chave: 'omb:b1', tipo: 'bot' } }],
    ['sessao.fim', T0 + 1_000, { agente: { chave: 'omb:b1', tipo: 'bot' } }],
  );
  assert.equal(m.agente('omb:b1')?.estado, 'ocioso');
  m.tick(T0 + 10 * 3600_000);
  assert.equal(m.agente('omb:b1')?.estado, 'dormindo');
});

test('virada do dia fecha as métricas e zera os contadores de hoje', () => {
  const bot = { chave: 'sim:a', tipo: 'bot' as const };
  const m = new Mundo().e(
    ['turno.inicio', T0, { agente: bot, local: sala('s-alfa', 'Portal Alfa', 'produtos') }],
    ['turno.fim', T0 + 1_000, { agente: bot }],
  );
  assert.equal(m.estado.mundo.metricas.dia, '22/10/2026');
  assert.equal(m.estado.mundo.metricas.entregas, 1);
  // Meia-noite em São Paulo: 03:00 UTC do dia 23.
  m.tick(Date.UTC(2026, 9, 23, 2, 59, 59));
  assert.equal(m.dias.length, 0);
  m.tick(Date.UTC(2026, 9, 23, 3, 0, 0));
  assert.equal(m.dias.length, 1);
  assert.equal(m.dias[0]?.dia, '2026-10-22');
  assert.equal(m.estado.mundo.metricas.dia, '23/10/2026');
  assert.equal(m.estado.mundo.metricas.entregas, 0);
  assert.equal(m.agente()?.entregasHoje, 0);
  assert.equal(m.estado.mundo.salas['s-alfa']?.entregasHoje, 0);
  assert.equal(m.estado.mundo.salas['s-alfa']?.entregas, 1, 'o total da sala continua');
});

test('alas da configuração: ordem e lote estáveis, ala removida fica inativa', () => {
  const m = new Mundo();
  const alas = m.estado.mundo.alas;
  assert.deepEqual(Object.values(alas).map((a) => [a.id, a.ordem, a.lote.col, a.lote.lin]), [
    ['recepcao', 0, 0, 0],
    ['produtos', 1, 1, 0],
    ['estudio', 2, 2, 0],
  ]);
  m.aplicar({ k: 'alas', agora: T0 + 1, alas: [{ id: 'estudio', nome: 'Estúdio de vídeo', cor: '#ffb347' }, { id: 'nova', nome: 'Nova', cor: '#123456' }], recepcao: RECEP });
  const depois = m.estado.mundo.alas;
  assert.equal(depois['produtos']?.ativa, false);
  assert.equal(depois['estudio']?.nome, 'Estúdio de vídeo');
  assert.equal(depois['estudio']?.ordem, 2);
  assert.equal(depois['nova']?.ordem, 3);
  assert.deepEqual(depois['nova']?.lote, { col: 3, lin: 0 });
});

test('saúde das fontes: contagem por origem e estado informado pelo servidor', () => {
  const m = new Mundo().e(['turno.inicio', T0]);
  assert.equal(m.estado.mundo.saude.fontes['sim']?.eventos, 1);
  assert.equal(m.estado.mundo.saude.fontes['sim']?.estado, 'simulada');
  m.aplicar({ k: 'saude', agora: T0 + 1, fonte: 'omb', saude: { estado: 'desligada', mensagem: 'OpenMausBot desligado' } });
  assert.equal(m.estado.mundo.saude.fontes['omb']?.estado, 'desligada');
  assert.ok(m.mudancas.some((x) => x.k === 'saude'));
  m.aplicar({ k: 'saude', agora: T0 + 2, fonte: 'omb', saude: { estado: 'desligada', mensagem: 'OpenMausBot desligado' } });
  assert.ok(!m.mudancas.some((x) => x.k === 'saude'), 'sem mudança, sem retransmissão');
});

test('presença do OpenMausBot: fila, sem sinal, ativo, esperando e ocioso, sem mexer nas métricas', () => {
  const bot = { chave: 'omb:b1', tipo: 'bot' as const };
  const p = (estado: 'ativo' | 'ocioso' | 'esperando' | 'na-fila' | 'sem-sinal') => ({ agente: bot, presenca: { estado } });
  const m = new Mundo().e(['presenca', T0, p('na-fila')]);
  assert.equal(m.agente('omb:b1')?.estado, 'na-fila');
  m.e(['presenca', T0 + 1_000, p('sem-sinal')]);
  assert.equal(m.agente('omb:b1')?.estado, 'sem-sinal');
  m.e(['presenca', T0 + 2_000, p('ativo')]);
  assert.equal(m.agente('omb:b1')?.estado, 'pensando');
  m.e(['presenca', T0 + 3_000, p('esperando')]);
  assert.equal(m.agente('omb:b1')?.estado, 'esperando');
  assert.equal(m.estado.mundo.precisaDeVoce.length, 1);
  m.e(['presenca', T0 + 4_000, p('esperando')]);
  assert.ok(!m.mudancas.some((x) => x.k === 'agente'), 'presença repetida não muda nada');
  m.e(['presenca', T0 + 5_000, p('ocioso')]);
  assert.equal(m.agente('omb:b1')?.estado, 'ocioso');
  assert.equal(m.estado.mundo.precisaDeVoce.length, 0);
  const met = m.estado.mundo.metricas;
  assert.deepEqual([met.turnos, met.esperas, met.entregas], [0, 0, 0], 'presença não conta métrica');
  assert.ok(!m.todas.some((x) => x.k === 'evento' && x.evento.tipo === 'presenca'), 'presença não vira animação');
  // Ocioso não reinicia o relógio do sono.
  m.tick(T0 + 25 * 60_000);
  assert.equal(m.agente('omb:b1')?.estado, 'dormindo');
  m.e(['presenca', T0 + 26 * 60_000, p('ocioso')]);
  assert.equal(m.agente('omb:b1')?.estado, 'dormindo');
});

test('turno fechado por duas fontes conta uma entrega; interrompido não conta', () => {
  const m = new Mundo().e(['turno.inicio', T0], ['turno.fim', T0 + 1_000], ['turno.fim', T0 + 1_200]);
  assert.equal(m.estado.mundo.metricas.entregas, 1);
  m.e(['turno.inicio', T0 + 5_000], ['turno.fim', T0 + 6_000, { turno: { interrompido: true } }]);
  assert.equal(m.estado.mundo.metricas.entregas, 1);
  m.tick(T0 + 6_400);
  assert.equal(m.agente()?.estado, 'ocioso');
});

test('evento velho (catch-up) muda o estado, mas não vira animação', () => {
  const m = new Mundo();
  m.aplicar({ k: 'evento', evento: ev('ferramenta.inicio', T0 - 10 * 60_000, { recebidoEm: T0, ferramenta: { nome: 'Read', categoria: 'ler', id: 'v1' } }) });
  assert.ok(m.agente(), 'o agente aparece');
  assert.ok(!m.mudancas.some((x) => x.k === 'evento'), 'sem evento semântico');
  m.aplicar({ k: 'evento', evento: ev('ferramenta.fim', T0 + 1_000, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'v1' } }) });
  assert.ok(m.mudancas.some((x) => x.k === 'evento'), 'evento recente anima');
});

test('subagente parado some em vez de ir para a academia', () => {
  const sub = { chave: 'sim:a:s1', tipo: 'subagente' as const, paiChave: 'sim:a' };
  const m = new Mundo().e(['turno.inicio', T0], ['subagente.inicio', T0 + 100, { agente: sub }]);
  m.tick(T0 + 100 + 3 * 60_000);
  assert.equal(m.agente('sim:a:s1')?.estado, 'saindo');
  m.tick(T0 + 100 + 3 * 60_000 + 10_000);
  assert.equal(m.agente('sim:a:s1'), undefined);
});

test('pasta excluída: o motor apaga nome e tarefa do agente e a marca segue no estado interno', () => {
  const m = new Mundo().e(['pedido.humano', T0, { agente: { chave: 'sim:a', tipo: 'sessao', nome: 'Ajudante' }, tarefa: { titulo: 'Tarefa visível' } }]);
  assert.equal(m.agente()?.tarefa, 'Tarefa visível');
  m.e(['ferramenta.inicio', T0 + 1_000, { local: { excluida: true }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'x1' } }]);
  assert.equal(m.agente()?.tarefa, undefined);
  assert.equal(m.agente()?.nome, undefined);
  assert.equal(m.estado.interno.agentes['sim:a']?.privado, true);
  // Evento seguinte, sem a marca, com nome e título de volta (fonte velha, replay): não reaparecem.
  m.e(['pensando', T0 + 2_000, { agente: { chave: 'sim:a', tipo: 'sessao', nome: 'Ajudante' }, tarefa: { titulo: 'Tarefa visível' } }]);
  assert.equal(m.agente()?.tarefa, undefined);
  assert.equal(m.agente()?.nome, undefined);
});

test('título e nome de arquivo desligados: o motor ignora e a limpeza apaga o que estava gravado', async () => {
  const { limparPorPrivacidade } = await import('./motor.ts');
  const m = new Mundo().e(
    ['pedido.humano', T0, { tarefa: { titulo: 'Título' } }],
    ['ferramenta.inicio', T0 + 100, { ferramenta: { nome: 'Edit', categoria: 'editar', id: 'f1', alvo: 'a.ts' } }],
    ['delegacao.enviada', T0 + 200, { delegacao: { de: 'sim:a', para: 'sim:b', jobId: 'j1', titulo: 'Delegar' } }],
  );
  assert.equal(m.agente()?.tarefa, 'Título');
  assert.equal(m.agente()?.ultimasAcoes.find((x) => x.tipo === 'ferramenta.inicio')?.alvo, 'a.ts');
  const desligado = configMotorPadrao({ mostrarTitulo: false, mostrarAlvo: false });
  const limpo = limparPorPrivacidade(m.estado, desligado);
  assert.notEqual(limpo, m.estado);
  const texto = JSON.stringify(limpo);
  for (const x of ['Título', 'a.ts', 'Delegar']) assert.ok(!texto.includes(x), x);
  assert.equal(limparPorPrivacidade(limpo, desligado), limpo, 'nada mais a limpar: o mesmo objeto');
  assert.equal(limparPorPrivacidade(m.estado, cfg), m.estado, 'com as opções ligadas, nada muda');
  // E o motor desligado nem guarda o que chegar.
  let e = aplicar(limpo, { k: 'evento', evento: ev('pedido.humano', T0 + 300, { tarefa: { titulo: 'Outro título' } }) }, desligado).estado;
  e = aplicar(e, { k: 'evento', evento: ev('ferramenta.inicio', T0 + 400, { ferramenta: { nome: 'Read', categoria: 'ler', id: 'f2', alvo: 'b.ts' } }) }, desligado).estado;
  assert.ok(!JSON.stringify(e).includes('Outro título') && !JSON.stringify(e).includes('b.ts'));
});

test('chave igual a nome de propriedade do Object não acha função herdada no estado', () => {
  const m = new Mundo();
  m.aplicar({ k: 'evento', evento: ev('pedido.humano', T0, { agente: { chave: 'constructor', tipo: 'sessao' } }) });
  assert.ok(Object.hasOwn(m.estado.mundo.agentes, 'constructor'), 'vira um agente comum, e não a função do Object');
  assert.equal(m.estado.mundo.agentes['constructor']?.estado, 'pensando');
  m.aplicar({ k: 'evento', evento: ev('ferramenta.fim', T0 + 100, { agente: { chave: 'sim:z', tipo: 'sessao' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'toString' } }) });
  assert.ok(m.agente('sim:z'));
});

test('ferramenta pendente e 25 min parado: dorme uma vez, sem "talvez" e "dorme" se alternando sem fim', () => {
  const sub = { chave: 'sim:a:s9', tipo: 'subagente' as const, paiChave: 'sim:a' };
  const m = new Mundo().e(
    ['turno.inicio', T0],
    ['subagente.inicio', T0 + 100, { agente: sub }],
    ['ferramenta.inicio', T0 + 200, { agente: sub, ferramenta: { nome: 'Bash', categoria: 'comando', id: 'b9' } }],
  );
  const inicio = performance.now();
  m.tick(T0 + 25 * 60_000);
  const ms = performance.now() - inicio;
  const sinteticos = m.todas.filter((x) => x.k === 'evento' && x.evento.agente.chave === 'sim:a:s9' && x.evento.id.startsWith('sint.'));
  assert.ok(sinteticos.length <= 2, `eventos sintéticos: ${sinteticos.length}`);
  assert.equal(m.agente('sim:a:s9')?.estado, 'dormindo');
  assert.ok(ms < 1_000, `o tick levou ${ms.toFixed(0)} ms`);
  // A mesma coisa com uma sessão comum.
  const s = new Mundo().e(['turno.inicio', T0], ['ferramenta.inicio', T0 + 200, { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'b8' } }]);
  s.tick(T0 + 25 * 60_000);
  assert.equal(s.agente()?.estado, 'dormindo');
  assert.ok(s.todas.filter((x) => x.k === 'evento').length < 10);
});

test('bot com pasta excluída: o nome fica; tarefa e nome de arquivo somem só até o próximo turno', () => {
  const bot = { chave: 'omb:b', tipo: 'bot' as const, nome: 'Unidade' };
  const m = new Mundo().e(
    ['turno.inicio', T0, { agente: bot, tarefa: { titulo: 'Tarefa 1' } }],
    ['ferramenta.inicio', T0 + 100, { agente: bot, ferramenta: { nome: 'Read', categoria: 'ler', id: 'r1', alvo: 'a.ts' } }],
  );
  assert.equal(m.agente('omb:b')?.tarefa, 'Tarefa 1');
  m.e(['ferramenta.inicio', T0 + 200, { agente: bot, local: { excluida: true }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'r2' } }]);
  let a = m.agente('omb:b');
  assert.equal(a?.nome, 'Unidade', 'o nome do bot vem do OpenMausBot e fica');
  assert.equal(a?.tarefa, undefined);
  assert.ok(a?.ultimasAcoes.every((x) => x.alvo === undefined), 'nem o nome de arquivo de antes, no mesmo turno');
  assert.deepEqual([m.estado.interno.agentes['omb:b']?.privadoTurno, m.estado.interno.agentes['omb:b']?.privado], [true, undefined]);
  // Ainda no mesmo turno: nome de arquivo e tarefa novos não entram.
  m.e(['ferramenta.inicio', T0 + 300, { agente: bot, tarefa: { titulo: 'Outra' }, ferramenta: { nome: 'Edit', categoria: 'editar', id: 'r3', alvo: 'b.ts' } }]);
  a = m.agente('omb:b');
  assert.ok(a?.ultimasAcoes.every((x) => x.alvo === undefined) && a?.tarefa === undefined);
  // Turno novo: a marca cai.
  m.e(
    ['turno.inicio', T0 + 400, { agente: bot, tarefa: { titulo: 'Tarefa 2' } }],
    ['ferramenta.inicio', T0 + 500, { agente: bot, ferramenta: { nome: 'Read', categoria: 'ler', id: 'r4', alvo: 'c.ts' } }],
  );
  a = m.agente('omb:b');
  assert.equal(a?.tarefa, 'Tarefa 2');
  assert.ok(a?.ultimasAcoes.some((x) => x.alvo === 'c.ts'));
  assert.equal(m.estado.interno.agentes['omb:b']?.privadoTurno, undefined);
});

test('pasta excluída: subagente marca de vez a sessão-mãe; bot marca o turno de quem delegou e a delegação perde o título', () => {
  const m = new Mundo().e(['pedido.humano', T0, { agente: { chave: 'sim:a', tipo: 'sessao', nome: 'Mãe' }, tarefa: { titulo: 'Tarefa da mãe' } }]);
  m.e(['ferramenta.inicio', T0 + 100, { agente: { chave: 'sim:a:s', tipo: 'subagente', paiChave: 'sim:a' }, local: { excluida: true }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'x' } }]);
  assert.deepEqual([m.agente()?.nome, m.agente()?.tarefa, m.estado.interno.agentes['sim:a']?.privado], [undefined, undefined, true]);
  const coord = { chave: 'omb:c', tipo: 'bot' as const, nome: 'Coordenação' };
  const bot = { chave: 'omb:b', tipo: 'bot' as const, nome: 'Unidade' };
  const delegacao = { de: 'omb:c', para: 'omb:b', jobId: 'j9', titulo: 'Título do drone' };
  m.e(
    ['turno.inicio', T0 + 200, { agente: coord, tarefa: { titulo: 'Tarefa da coordenação' } }],
    ['delegacao.enviada', T0 + 300, { agente: coord, delegacao }],
    ['delegacao.recebida', T0 + 400, { agente: bot, delegacao, tarefa: { titulo: 'Título do drone' } }],
    ['ferramenta.inicio', T0 + 500, { agente: bot, local: { excluida: true }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'y' } }],
  );
  assert.deepEqual([m.agente('omb:c')?.nome, m.agente('omb:c')?.tarefa], ['Coordenação', undefined]);
  assert.equal(m.estado.interno.agentes['omb:c']?.privadoTurno, true);
  assert.equal(m.estado.mundo.delegacoes['j9']?.titulo, undefined);
});

test('estado gravado com marca de vez num bot (antes da marca de turno): a limpeza tira a marca, e o nome volta no próximo evento', async () => {
  const { limparPorPrivacidade } = await import('./motor.ts');
  const bot = { chave: 'omb:b', tipo: 'bot' as const, nome: 'Unidade' };
  const m = new Mundo().e(['turno.inicio', T0, { agente: bot }]);
  const velho: EstadoMotor = json(m.estado);
  const ia = velho.interno.agentes['omb:b'];
  const ag = velho.mundo.agentes['omb:b'];
  assert.ok(ia && ag);
  ia.privado = true;
  delete ag.nome;
  const limpo = limparPorPrivacidade(velho, cfg);
  assert.equal(limpo.interno.agentes['omb:b']?.privado, undefined);
  const depois = aplicar(limpo, { k: 'evento', evento: ev('pensando', T0 + 100, { agente: bot }) }, cfg).estado;
  assert.equal(depois.mundo.agentes['omb:b']?.nome, 'Unidade');
});
