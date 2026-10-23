// Roupa alternativa: um humano com `variante` (no pacote de personagens) troca de roupa em alguns
// dias. A regra é um sorteio por dia: a data de São Paulo, a semente do mundo e a chave da aparência
// passam por um hash, e a variante aparece quando o resto da divisão por `umDiaEm` (padrão 3) dá
// zero, perto de um dia em três. O mesmo dia dá sempre a mesma roupa; `?roupa=variante|base` força.
import type { AparenciaHumano, Planta } from './formato.ts';

export type ModoRoupa = 'auto' | 'variante' | 'base';

/** Data de hoje em São Paulo, no formato aaaa-mm-dd. */
export function dataSaoPaulo(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** FNV-1a de 32 bits: o mesmo número em qualquer navegador. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A variante dessa aparência sai nesse dia? */
export function varianteNoDia(chave: string, umDiaEm: number, semente: number, data: string): boolean {
  return hash(`${data}|${semente}|${chave}`) % Math.max(1, Math.round(umDiaEm)) === 0;
}

/** A aparência com a roupa alternativa por cima (só os campos que a variante traz). */
export function comVariante(ap: AparenciaHumano): AparenciaHumano {
  const { variante, ...base } = ap;
  if (!variante) return ap;
  const { umDiaEm: _umDiaEm, ...troca } = variante;
  return { ...base, ...troca };
}

/** Veste cada humano com variante: pelo sorteio do dia, sempre com a variante ou sempre com a roupa de base. */
export function vestirDoDia(planta: Planta, semente: number, modo: ModoRoupa, data = dataSaoPaulo()): Planta {
  let aparencias: Planta['aparencias'] | null = null;
  for (const [chave, ap] of Object.entries(planta.aparencias)) {
    if (ap.tipo !== 'humano' || !ap.variante) continue;
    const usar = modo === 'variante' || (modo === 'auto' && varianteNoDia(chave, ap.variante.umDiaEm ?? 3, semente, data));
    aparencias ??= { ...planta.aparencias };
    const { variante: _variante, ...base } = ap;
    aparencias[chave] = usar ? comVariante(ap) : base;
  }
  return aparencias ? { ...planta, aparencias } : planta;
}
