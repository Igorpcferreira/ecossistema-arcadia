// Transmissão para os clientes (SSE). Mudanças chegando no mesmo intervalo de 250 ms viram um quadro só; a mesma
// entidade aparece uma vez por quadro (vale a última versão). Cada quadro ganha um `seq` (o `id:` do SSE) e fica
// num buffer de cerca de 1.000 quadros para a retomada com Last-Event-ID. Faltou quadro: `event: resync`.
import { protegerSaida, VERSAO_ESQUEMA, type Contador, type Mudanca, type Ola, type Quadro, type Resync } from '@arcadia/shared';
import type { Agendamento, Relogio } from '../util/relogio.ts';

export type Assinante = (texto: string) => void;

export type Transmissor = {
  /** Enfileira mudanças; o quadro sai quando a janela de 250 ms fecha. */
  publicar(mudancas: Mudanca[]): void;
  /** Fecha o quadro pendente agora (usado antes do snapshot) e devolve o seq atual. */
  descarregar(): number;
  seqAtual(): number;
  /** Conecta um cliente. `desde` é o último seq que ele tem (Last-Event-ID ou ?desde=). */
  conectar(desde: number | undefined, assinante: Assinante): { inicial: string[]; cancelar(): void };
  conexoes(): number;
  bloqueados(): number;
  parar(): void;
};

export type OpcoesTransmissor = {
  relogio: Relogio;
  buildId: string;
  instancia: string;
  /** Primeiro seq. Usar o relógio (ms) faz o seq crescer entre reinícios: id velho nunca parece válido. */
  seqInicial: number;
  janelaMs?: number;
  bufferMax?: number;
  pingMs?: number;
  retryMs?: number;
};

export function formatarSSE(campos: { event?: string; id?: number; retry?: number; data?: string }): string {
  let s = '';
  if (campos.event !== undefined) s += `event: ${campos.event}\n`;
  if (campos.id !== undefined) s += `id: ${campos.id}\n`;
  if (campos.retry !== undefined) s += `retry: ${campos.retry}\n`;
  if (campos.data !== undefined) for (const linha of campos.data.split('\n')) s += `data: ${linha}\n`;
  return `${s}\n`;
}

function chaveDe(m: Mudanca): string | undefined {
  switch (m.k) {
    case 'agente':
      return `a:${m.agente.chave}`;
    case 'agente.saiu':
      return `a:${m.chave}`;
    case 'sala':
      return `s:${m.sala.chave}`;
    case 'ala':
      return `al:${m.ala.id}`;
    case 'delegacao':
      return `d:${m.delegacao.chave}`;
    case 'delegacao.fim':
      return `d:${m.chave}`;
    case 'obra':
      return `o:${m.obra.salaChave}`;
    case 'obra.fim':
      return `o:${m.salaChave}`;
    case 'precisaDeVoce':
      return 'fila';
    case 'metricas':
      return 'metricas';
    case 'saude':
      return 'saude';
    case 'evento':
      return undefined;
  }
}

/** A mesma entidade uma vez só, na posição em que apareceu primeiro, com o valor mais recente. */
export function coalescer(mudancas: Mudanca[]): Mudanca[] {
  const saida: Mudanca[] = [];
  const posicao = new Map<string, number>();
  for (const m of mudancas) {
    const chave = chaveDe(m);
    if (chave === undefined) {
      saida.push(m);
      continue;
    }
    const i = posicao.get(chave);
    if (i === undefined) {
      posicao.set(chave, saida.length);
      saida.push(m);
    } else {
      saida[i] = m;
    }
  }
  return saida;
}

export function criarTransmissor(op: OpcoesTransmissor): Transmissor {
  const janela = op.janelaMs ?? 250;
  const bufferMax = op.bufferMax ?? 1_000;
  const retry = op.retryMs ?? 3_000;
  let seq = op.seqInicial;
  let pendentes: Mudanca[] = [];
  let agendado: Agendamento | undefined;
  const buffer: { seq: number; texto: string }[] = [];
  const assinantes = new Set<Assinante>();
  const contador: Contador = { mascarados: 0 };

  function enviar(texto: string): void {
    for (const a of [...assinantes]) {
      try {
        a(texto);
      } catch {
        assinantes.delete(a);
      }
    }
  }

  function descarregar(): number {
    agendado?.cancelar();
    agendado = undefined;
    if (pendentes.length === 0) return seq;
    seq++;
    const quadro: Quadro = protegerSaida({ seq, ts: op.relogio.agora(), mudancas: coalescer(pendentes) }, contador);
    pendentes = [];
    const texto = formatarSSE({ event: 'mundo', id: seq, data: JSON.stringify(quadro) });
    buffer.push({ seq, texto });
    if (buffer.length > bufferMax) buffer.splice(0, buffer.length - bufferMax);
    enviar(texto);
    return seq;
  }

  const ping = op.relogio.repetir(op.pingMs ?? 15_000, () => {
    if (assinantes.size > 0) enviar(formatarSSE({ event: 'ping', data: JSON.stringify({ ts: op.relogio.agora() }) }));
  });

  return {
    publicar(mudancas) {
      if (mudancas.length === 0) return;
      // Sem espalhar o vetor nos argumentos: uma lista enorme estouraria a pilha.
      for (const m of mudancas) pendentes.push(m);
      if (!agendado) agendado = op.relogio.agendar(janela, descarregar);
    },
    descarregar,
    seqAtual: () => seq,
    conectar(desde, assinante) {
      const ola: Ola = { seq, buildId: op.buildId, instancia: op.instancia, versaoEsquema: VERSAO_ESQUEMA };
      const inicial = [formatarSSE({ retry }), formatarSSE({ event: 'ola', data: JSON.stringify(ola) })];
      if (desde !== undefined && desde !== seq) {
        const primeiro = buffer[0]?.seq;
        if (desde > seq) {
          const r: Resync = { motivo: 'seq-futuro', seq };
          inicial.push(formatarSSE({ event: 'resync', data: JSON.stringify(r) }));
        } else if (primeiro !== undefined && primeiro <= desde + 1) {
          for (const q of buffer) if (q.seq > desde) inicial.push(q.texto);
        } else {
          const r: Resync = { motivo: 'seq-ausente', seq };
          inicial.push(formatarSSE({ event: 'resync', data: JSON.stringify(r) }));
        }
      }
      assinantes.add(assinante);
      return { inicial, cancelar: () => assinantes.delete(assinante) };
    },
    conexoes: () => assinantes.size,
    bloqueados: () => contador.mascarados,
    parar() {
      agendado?.cancelar();
      ping.cancelar();
      assinantes.clear();
    },
  };
}
