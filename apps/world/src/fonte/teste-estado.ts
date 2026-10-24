// Estado do servidor montado à mão para os testes do mundo (planta e coreógrafo), com nomes genéricos.
import type { Ala, EstadoMundo, SalaServidor, Snapshot, TemaAla } from './tipos.ts';

export const AGORA = Date.UTC(2026, 9, 24, 15, 0, 0);

export interface AlaTeste { id: string; tema?: TemaAla; nome?: string; cor?: string; salas?: number; tipoSala?: SalaServidor['tipo'] }

export function salaTeste(alaId: string, k: number, tipo: SalaServidor['tipo'] = 'web'): SalaServidor {
  return {
    chave: `${alaId}-sala-${k}`, nome: `Sala ${k + 1}`, alaId, tipo, terreno: { indice: k, col: k % 3, lin: Math.floor(k / 3) }, andar: 0,
    criadaEm: AGORA - 1e6 + k, ultimaAtividade: AGORA, dormindo: false, entregas: 0, erros: 0, entregasHoje: 0, errosHoje: 0,
  };
}

/** Estado com a Recepção e as alas pedidas (na ordem), cada uma com o número de salas dela. */
export function estadoTeste(alas: AlaTeste[]): EstadoMundo {
  const e: EstadoMundo = {
    v: 1, agora: AGORA, alas: {}, salas: {}, agentes: {}, delegacoes: {}, precisaDeVoce: [],
    metricas: { dia: '24/10/2026', entregas: 0, erros: 0, ferramentas: 0, turnos: 0, pedidos: 0, delegacoes: 0, esperas: 0, tokens: { entrada: 0, saida: 0, cache: 0 }, custoUsd: 0, agentes: 0, salas: 0 },
    saude: { fontes: {} }, obras: [],
  };
  const rec: Ala = { id: 'recepcao', nome: 'Recepção', cor: '#ffe08a', ordem: 0, lote: { col: 0, lin: 0 }, tipo: 'recepcao', ativa: true, criadaEm: AGORA - 1e7 };
  e.alas[rec.id] = rec;
  alas.forEach((a, k) => {
    const ala: Ala = { id: a.id, nome: a.nome ?? `Ala ${k + 1}`, cor: a.cor ?? '#88aaff', ordem: k + 1, lote: { col: (k + 1) % 4, lin: Math.floor((k + 1) / 4) }, tipo: 'projetos', ativa: true, criadaEm: AGORA - 1e7 + k };
    if (a.tema) ala.tema = a.tema;
    e.alas[a.id] = ala;
    for (let s = 0; s < (a.salas ?? 0); s++) { const sl = salaTeste(a.id, s, a.tipoSala); e.salas[sl.chave] = sl; }
  });
  return e;
}

export function snapshotTeste(e: EstadoMundo): Snapshot {
  return { v: 1, seq: 1, buildId: 'teste', instancia: 'teste', geradoEm: AGORA, estado: structuredClone(e) };
}
