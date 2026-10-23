// Cliente do SSE do OpenMausBot: GET /api/events?screens=off (sempre sem telas), a partir de 127.0.0.1, sem Origin
// nem Sec-Fetch. Retoma com Last-Event-ID. Se nada chegar em 45 s (o app manda batimento a cada 15 s), reconecta.
import http from 'node:http';
import { rotaPermitida } from './cliente.ts';
import type { Agendamento, Relogio } from '../../util/relogio.ts';

export const ROTA_SSE = '/api/events?screens=off';

export type QuadroSse = { id?: string; dados: unknown };

export type OpcoesSse = {
  porta: number;
  ultimoId?: string;
  relogio: Relogio;
  aoQuadro: (q: QuadroSse) => void;
  /** Chamado quando `aoQuadro` lançou erro (o fluxo segue com os próximos quadros). */
  aoFalhaNoQuadro?: () => void;
  aoAbrir?: () => void;
  aoFim: (motivo: 'fim' | 'erro' | 'status' | 'silencio') => void;
  silencioMs?: number;
};

export type ConexaoSse = { fechar(): void };

/** Lê os blocos de um texto SSE: devolve os quadros completos e o que sobrou. Comentário (`:`) é batimento. */
export function lerBlocosSse(texto: string): { quadros: { id?: string; data?: string; comentario: boolean }[]; resto: string } {
  const quadros: { id?: string; data?: string; comentario: boolean }[] = [];
  const partes = texto.split(/\r?\n\r?\n/);
  const resto = partes.pop() ?? '';
  for (const bloco of partes) {
    let id: string | undefined;
    const dados: string[] = [];
    let comentario = false;
    for (const linha of bloco.split(/\r?\n/)) {
      if (linha.startsWith(':')) comentario = true;
      else if (linha.startsWith('id:')) id = linha.slice(3).trim();
      else if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
    }
    const q: { id?: string; data?: string; comentario: boolean } = { comentario };
    if (id !== undefined) q.id = id;
    if (dados.length) q.data = dados.join('\n');
    quadros.push(q);
  }
  return { quadros, resto };
}

export function abrirSseOmb(op: OpcoesSse): ConexaoSse {
  if (!rotaPermitida(ROTA_SSE)) throw new Error('rota do SSE fora da lista permitida');
  let encerrado = false;
  let vigia: Agendamento | undefined;
  const silencio = op.silencioMs ?? 45_000;
  const cabecalhos: Record<string, string> = { accept: 'text/event-stream' };
  if (op.ultimoId && /^[A-Za-z0-9:_-]{1,80}$/.test(op.ultimoId)) cabecalhos['last-event-id'] = op.ultimoId;

  const terminar = (motivo: 'fim' | 'erro' | 'status' | 'silencio') => {
    if (encerrado) return;
    encerrado = true;
    vigia?.cancelar();
    req.destroy();
    op.aoFim(motivo);
  };
  const armarVigia = () => {
    vigia?.cancelar();
    vigia = op.relogio.agendar(silencio, () => terminar('silencio'));
  };

  const req = http.request({ host: '127.0.0.1', port: op.porta, path: ROTA_SSE, method: 'GET', headers: cabecalhos }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      terminar('status');
      return;
    }
    op.aoAbrir?.();
    armarVigia();
    res.setEncoding('utf8');
    let acumulado = '';
    res.on('data', (pedaco: string) => {
      armarVigia();
      acumulado += pedaco;
      if (acumulado.length > 16 * 1024 * 1024) {
        terminar('erro');
        return;
      }
      const { quadros, resto } = lerBlocosSse(acumulado);
      acumulado = resto;
      for (const q of quadros) {
        if (q.data === undefined) continue;
        let dados: unknown;
        try {
          dados = JSON.parse(q.data);
        } catch {
          continue;
        }
        // Um quadro que quebre quem o trata não pode subir até o evento de dados do socket (derrubaria o processo).
        try {
          op.aoQuadro(q.id !== undefined ? { id: q.id, dados } : { dados });
        } catch {
          op.aoFalhaNoQuadro?.();
        }
      }
    });
    res.on('end', () => terminar('fim'));
    res.on('error', () => terminar('erro'));
  });
  req.on('error', () => terminar('erro'));
  req.end();
  return { fechar: () => terminar('fim') };
}
