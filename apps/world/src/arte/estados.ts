// Cores, rótulos e ícones dos estados (seção 4.3 do prompt e 05-direcoes-de-arte.md, seção 3).
// Estado aparece por forma, cor, lugar e gesto: aqui ficam a cor e o ícone.
import type { Estado } from '../cena/formato.ts';

export const CORES_ESTADO: Record<Estado, string> = {
  ocioso: '#6b7090', pensando: '#f0e9da', lendo: '#c9b8ff', editando: '#4ea8ff', comando: '#92e08c', esperando: '#ffcf4d',
  talvez: '#d9b45a', erro: '#ff6b5a', entregou: '#7dffa8', delegando: '#ffb347', treinando: '#ff7ab8', pausa: '#9fe3ff',
  chegando: '#9ff3ff', fila: '#a9b3d6', semSinal: '#56607a', limite: '#8a6bd6', dormindo: '#5a6290',
};

export const ROTULO_ESTADO: Record<Estado, string> = {
  ocioso: 'ocioso', pensando: 'pensando', lendo: 'lendo', editando: 'editando', comando: 'rodando comando', esperando: 'esperando você',
  talvez: 'talvez esperando', erro: 'erro', entregou: 'entregou', delegando: 'delegando', treinando: 'treinando', pausa: 'em pausa',
  chegando: 'chegando', fila: 'na fila', semSinal: 'sem sinal', limite: 'limite de uso', dormindo: 'dormindo',
};

/** Ícones 5 por 5 sobre a cabeça (1 = pixel escuro sobre o fundo na cor do estado). */
export const ICONES: Partial<Record<Estado, string>> = {
  pensando: '0000000000101010000000000', lendo: '1111100000111110000011100', editando: '0001100111011100110001000',
  comando: '1000001000100000000001111', esperando: '0010000100001000000000100', talvez: '0111000001001100000000100',
  erro: '1000101010001000101010001', entregou: '0000000001000101010001000', delegando: '1111111011101011000111111',
  treinando: '0000010001111110000000000', pausa: '0101000000100010111000000', chegando: '0010001110101010010000100',
  fila: '0000011111000001111100000', semSinal: '0101011111011100000000100', limite: '0111010001100011000101110',
  dormindo: '1111000010001000100011110',
};

/**
 * Fundo do ícone: a cor do estado, clareada onde ela ficava escura demais contra o desenho
 * (#14162b), para o contraste passar de 3 para 1 (sem sinal e dormindo). "Sem sinal" tem desenho
 * próprio, uma tomada desligada, e não o X do erro.
 */
export const COR_ICONE: Record<Estado, string> = { ...CORES_ESTADO, semSinal: '#b8c0dc', dormindo: '#9aa6d6' };

/** Estados que acendem o holograma da mesa quando o dono está no posto. */
export const ESTADOS_HOLO: readonly Estado[] = ['pensando', 'lendo', 'editando', 'comando', 'esperando', 'talvez', 'erro', 'entregou', 'delegando'];
export function indiceHolo(e: Estado | null): number {
  if (!e) return -1;
  return ESTADOS_HOLO.indexOf(e);
}

/** Prioridade do balão: quem espera você e erros primeiro. */
export const PRIORIDADE: Partial<Record<Estado, number>> = { esperando: 5, erro: 4, talvez: 3, entregou: 3, limite: 3, delegando: 2, chegando: 2 };
