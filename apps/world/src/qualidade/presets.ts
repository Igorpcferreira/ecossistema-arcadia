// Presets de qualidade (baixo, medio, alto) e escolha da escala de pixel.
// O orçamento vem da 04-stack-e-celular.md, seção 1.3: no celular até uns 300 por 600 px de
// arte, 40 brilhos e 120 partículas a 30 fps; no PC até uns 700 por 480, 120 brilhos e 400
// partículas a 60 fps. ?q= força o preset; ?fps= força o teto (0 tira o teto).

export type NomePreset = 'baixo' | 'medio' | 'alto';

export interface Preset {
  nome: NomePreset;
  /** Lado curto e lado longo máximos da resolução interna (pixels de arte). */
  ladoCurto: number;
  ladoLongo: number;
  maxBrilhos: number;
  maxParticulas: number;
  /** Camadas animadas trocam de quadro só em quadros alternados. */
  animMeiaTaxa: boolean;
  estrelas: number;
  nuvens: boolean;
  carrosJanela: number;
}

export const PRESETS: Record<NomePreset, Preset> = {
  baixo: { nome: 'baixo', ladoCurto: 240, ladoLongo: 480, maxBrilhos: 24, maxParticulas: 60, animMeiaTaxa: true, estrelas: 60, nuvens: false, carrosJanela: 3 },
  medio: { nome: 'medio', ladoCurto: 320, ladoLongo: 640, maxBrilhos: 40, maxParticulas: 120, animMeiaTaxa: false, estrelas: 120, nuvens: true, carrosJanela: 6 },
  alto: { nome: 'alto', ladoCurto: 480, ladoLongo: 760, maxBrilhos: 120, maxParticulas: 400, animMeiaTaxa: false, estrelas: 160, nuvens: true, carrosJanela: 6 },
};

/** Celular: ponteiro grosso (toque) como na prancha. */
export function ehCelular(): boolean {
  try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** Menor escala inteira que deixa a resolução interna dentro do orçamento do preset. */
export function escalaBase(cssW: number, cssH: number, dpr: number, p: Preset): number {
  const fw = cssW * dpr, fh = cssH * dpr;
  for (let s = 1; s <= 12; s++) {
    const w = Math.ceil(fw / s), h = Math.ceil(fh / s);
    if (Math.min(w, h) <= p.ladoCurto && Math.max(w, h) <= p.ladoLongo) return s;
  }
  return 12;
}

export function lerParametros(): URLSearchParams {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}
