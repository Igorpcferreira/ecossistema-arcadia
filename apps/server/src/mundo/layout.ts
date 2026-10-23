// Layout lógico e estável do andar. As alas ocupam lotes de uma grade, na ordem em que nasceram (a Recepção é o
// lote 0); cada sala ocupa o próximo terreno livre da sua ala. Posições nunca são recalculadas: ficam gravadas.
// O cliente traduz lote e terreno para a tela isométrica.

/** Lotes por linha do andar. */
export const LARGURA_ANDAR = 4;
/** Terrenos por linha dentro de uma ala. */
export const LARGURA_ALA = 3;

export function loteDaOrdem(ordem: number): { col: number; lin: number } {
  return { col: ordem % LARGURA_ANDAR, lin: Math.floor(ordem / LARGURA_ANDAR) };
}

export function terrenoDoIndice(indice: number): { indice: number; col: number; lin: number } {
  return { indice, col: indice % LARGURA_ALA, lin: Math.floor(indice / LARGURA_ALA) };
}
