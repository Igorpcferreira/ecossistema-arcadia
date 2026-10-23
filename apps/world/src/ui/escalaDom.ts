// Miniaturas de pixel art no DOM (cartão e elenco): a ampliação física, em pixels da tela por
// pixel de arte, tem de ser inteira, senão as colunas de pixel saem com larguras diferentes.
// O tamanho CSS sai da densidade da tela: no Moto G14 (2,625), "3x" vira 8 pixels físicos.

/** Tamanho CSS de um lado de `arte` pixels, perto de `zoomCss` px por pixel e com ampliação física inteira. */
export function ladoCss(arte: number, zoomCss: number): number {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(zoomCss * dpr));
  return (arte * k) / dpr;
}

/** Aplica ao canvas o tamanho CSS com ampliação física inteira. */
export function ampliarCanvas(c: HTMLCanvasElement, zoomCss: number): void {
  c.style.width = `${ladoCss(c.width, zoomCss)}px`;
  c.style.height = `${ladoCss(c.height, zoomCss)}px`;
}
