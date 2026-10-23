// Carga da cena: a planta de exemplo do repositório, o pacote de personagens de exemplo
// (config/personagens.exemplo.json) e, só em desenvolvimento, os arquivos locais servidos pelo
// Vite a partir de docs/local (cenário real e personagens pessoais). Sem os locais, tudo cai no
// genérico. Nada local entra no build.
import type { Aparencia, PacotePersonagens, Planta } from './formato.ts';
import { PLANTA_EXEMPLO } from './exemplo.ts';
import pacoteExemplo from '../../../../config/personagens.exemplo.json';

export const PACOTE_EXEMPLO = pacoteExemplo as unknown as PacotePersonagens;

async function buscarJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export interface CargaLocal { planta: Planta; pacote: PacotePersonagens; origem: { cenario: 'local' | 'exemplo'; personagens: 'local' | 'exemplo' } }

/** Carrega a planta e o pacote. ?local=0 força o genérico mesmo em desenvolvimento. */
export async function carregarCena(usarLocal: boolean): Promise<CargaLocal> {
  let planta: Planta | null = null, pacote: PacotePersonagens | null = null;
  if (usarLocal && import.meta.env.DEV) {
    [planta, pacote] = await Promise.all([buscarJson<Planta>('/local/cenario-local.json'), buscarJson<PacotePersonagens>('/local/personagens.json')]);
    if (planta && (!Array.isArray(planta.lotes) || !Array.isArray(planta.personagens))) planta = null;
    if (pacote && !Array.isArray(pacote.personagens)) pacote = null;
  }
  return {
    planta: planta ?? PLANTA_EXEMPLO,
    pacote: pacote ?? PACOTE_EXEMPLO,
    origem: { cenario: planta ? 'local' : 'exemplo', personagens: pacote ? 'local' : 'exemplo' },
  };
}

/** Põe os personagens do pacote nos papéis da planta (dono, fixo ou o id de um personagem). */
export function aplicarPacote(planta: Planta, pacote: PacotePersonagens): Planta {
  const p: Planta = { ...planta, personagens: planta.personagens.map((x) => ({ ...x })), aparencias: { ...planta.aparencias } };
  for (const pp of pacote.personagens) {
    const alvo = p.personagens.find((x) => x.papel === pp.papel || x.id === pp.papel);
    if (!alvo) continue;
    const chave = `pacote-${pp.papel}`;
    p.aparencias[chave] = pp.aparencia as Aparencia;
    alvo.aparencia = chave;
    alvo.nome = pp.nome; alvo.curto = pp.curto;
    if (pp.cargo) alvo.cargo = pp.cargo;
    if (pp.tarefaInicial) alvo.tarefaInicial = pp.tarefaInicial;
    if (pp.falas) alvo.falas = { ...alvo.falas, ...pp.falas };
  }
  return p;
}
