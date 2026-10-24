// Espelho do estado do servidor no navegador: o snapshot inteiro e, por cima, cada quadro do SSE
// (as entidades chegam inteiras e substituem as anteriores). Junto, uma fila de sinais com o que
// mudou, para o coreógrafo animar: agente que mudou de estado, delegação nova, obra, evento.
// Regras de negócio ficam no servidor: aqui só se guarda e se compara antes e depois.
import type { Agente, Ala, ArcadiaEvent, Delegacao, EstadoMundo, Obra, Quadro, SalaServidor, Snapshot } from './tipos.ts';

export type Sinal =
  | { k: 'agente'; ts: number; antes: Agente | undefined; depois: Agente }
  | { k: 'saiu'; ts: number; antes: Agente | undefined; chave: string }
  | { k: 'sala'; ts: number; antes: SalaServidor | undefined; depois: SalaServidor }
  | { k: 'ala'; ts: number; antes: Ala | undefined; depois: Ala }
  | { k: 'delegacao'; ts: number; antes: Delegacao | undefined; depois: Delegacao }
  | { k: 'delegacao.fim'; ts: number; antes: Delegacao | undefined; chave: string }
  | { k: 'precisa'; ts: number }
  | { k: 'metricas'; ts: number }
  | { k: 'obra'; ts: number; antes: Obra | undefined; obra: Obra }
  | { k: 'obra.fim'; ts: number; salaChave: string }
  | { k: 'evento'; ts: number; evento: ArcadiaEvent };

export class Espelho {
  estado: EstadoMundo;
  seq: number;
  buildId: string;
  instancia: string;
  /** Diferença entre o relógio do servidor e o daqui (ms), medida a cada quadro. */
  desvio = 0;
  /** Sobe a cada mudança (os cartões e o HUD redesenham quando muda). */
  versao = 0;
  private sinais: Sinal[] = [];

  constructor(s: Snapshot) {
    this.estado = s.estado; this.seq = s.seq; this.buildId = s.buildId; this.instancia = s.instancia;
    this.desvio = s.geradoEm - Date.now();
  }

  /** Agora no relógio do servidor (ms). */
  agora(): number { return Date.now() + this.desvio; }

  /** Estado inteiro de novo (resync): os sinais pendentes perdem o sentido. */
  substituir(s: Snapshot): void {
    this.estado = s.estado; this.seq = s.seq; this.buildId = s.buildId; this.instancia = s.instancia;
    this.desvio = s.geradoEm - Date.now();
    this.sinais = [];
    this.versao++;
  }

  aplicar(q: Quadro): void {
    const e = this.estado, ts = q.ts;
    this.seq = q.seq;
    // o desvio anda devagar: um quadro atrasado na rede não puxa o relógio
    const d = q.ts - Date.now();
    this.desvio = Math.abs(d - this.desvio) > 60_000 ? d : this.desvio + (d - this.desvio) * 0.2;
    for (const m of q.mudancas) {
      switch (m.k) {
        case 'agente': { const antes = e.agentes[m.agente.chave]; e.agentes[m.agente.chave] = m.agente; this.sinais.push({ k: 'agente', ts, antes, depois: m.agente }); break; }
        case 'agente.saiu': { const antes = e.agentes[m.chave]; delete e.agentes[m.chave]; this.sinais.push({ k: 'saiu', ts, antes, chave: m.chave }); break; }
        case 'sala': { const antes = e.salas[m.sala.chave]; e.salas[m.sala.chave] = m.sala; this.sinais.push({ k: 'sala', ts, antes, depois: m.sala }); break; }
        case 'ala': { const antes = e.alas[m.ala.id]; e.alas[m.ala.id] = m.ala; this.sinais.push({ k: 'ala', ts, antes, depois: m.ala }); break; }
        case 'delegacao': { const antes = e.delegacoes[m.delegacao.chave]; e.delegacoes[m.delegacao.chave] = m.delegacao; this.sinais.push({ k: 'delegacao', ts, antes, depois: m.delegacao }); break; }
        case 'delegacao.fim': { const antes = e.delegacoes[m.chave]; delete e.delegacoes[m.chave]; this.sinais.push({ k: 'delegacao.fim', ts, antes, chave: m.chave }); break; }
        case 'precisaDeVoce': e.precisaDeVoce = m.itens; this.sinais.push({ k: 'precisa', ts }); break;
        case 'metricas': e.metricas = m.metricas; this.sinais.push({ k: 'metricas', ts }); break;
        case 'saude': e.saude = m.saude; break;
        case 'obra': {
          const i = e.obras.findIndex((o) => o.salaChave === m.obra.salaChave);
          const antes = i >= 0 ? e.obras[i] : undefined;
          if (i >= 0) e.obras[i] = m.obra; else e.obras.push(m.obra);
          this.sinais.push({ k: 'obra', ts, antes, obra: m.obra });
          break;
        }
        case 'obra.fim': e.obras = e.obras.filter((o) => o.salaChave !== m.salaChave); this.sinais.push({ k: 'obra.fim', ts, salaChave: m.salaChave }); break;
        case 'evento': this.sinais.push({ k: 'evento', ts, evento: m.evento }); break;
      }
    }
    this.versao++;
  }

  /** Entrega e esvazia a fila de sinais. */
  tirarSinais(): Sinal[] { const s = this.sinais; this.sinais = []; return s; }
}

/**
 * Assinatura das alas que mudam o desenho do andar: id, ordem, tipo, nome, cor e o tema da configuração.
 * Mudou (ala nova, renomeada, de outra cor ou de outro tema), o mundo é remontado com a planta nova.
 */
export function assinaturaAlas(e: EstadoMundo): string {
  return Object.values(e.alas)
    .sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id))
    .map((a) => JSON.stringify([a.id, a.tipo, a.nome, a.cor, a.tema ?? '']))
    .join('|');
}
