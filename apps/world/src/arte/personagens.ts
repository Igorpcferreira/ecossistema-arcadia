// Personagens em pixel art: androides, humanos e criaturas, em dois tamanhos (16 por 32,
// como na prancha, e 24 por 40, com mais detalhe de rosto e roupa). O corpo é procedural;
// o "passe à mão" troca cabeça e tronco por mapas de pixels desenhados um a um.
// Os olhos de LED e a luz do peito dos androides ficam numa camada à parte (rosto), para
// o atlas não multiplicar cada quadro por cada estado.
import type { Aparencia, AparenciaAndroide, AparenciaCriatura, AparenciaHumano, Estado, MapaMao, Pose } from '../cena/formato.ts';
import { tom } from './cor.ts';
import { CORES_ESTADO } from './estados.ts';
import { estilo, mapaPixels, pixelsTexto, type G } from './primitivas.ts';
import { MAO_ANDROIDES } from './maoFeita.ts';

export type Tam = 16 | 24;
export const DIM: Record<Tam, { w: number; h: number }> = { 16: { w: 16, h: 32 }, 24: { w: 24, h: 40 } };

/** Poses e quantos quadros cada uma tem no atlas. */
export const POSES: readonly { pose: Pose; n: number }[] = [
  { pose: 'parado', n: 2 }, { pose: 'andar', n: 4 }, { pose: 'digitando', n: 2 }, { pose: 'operando', n: 2 }, { pose: 'jogar', n: 2 },
  { pose: 'levantar', n: 2 }, { pose: 'pose', n: 2 }, { pose: 'correr', n: 4 }, { pose: 'beber', n: 1 }, { pose: 'acenar', n: 2 }, { pose: 'dormir', n: 2 },
];
export const INDICE_POSE: Record<Pose, number> = Object.fromEntries(POSES.map((p, k) => [p.pose, k])) as Record<Pose, number>;

/** Deslocamento vertical da cabeça e do tronco na pose (sentado, balanço do passo, cochilo). */
export function dyPose(pose: Pose, q: number, tam: Tam): number {
  const andando = pose === 'andar' || pose === 'correr';
  const k = andando ? q % 4 : 0;
  const bob = andando && (k === 1 || k === 3) ? -1 : 0;
  const sentado = pose === 'digitando' || pose === 'dormir';
  const desce = tam === 16 ? 3 : 4;
  return (sentado ? desce : 0) + bob + (pose === 'dormir' ? (q % 2 ? 2 : 1) : 0);
}

type Ret = (x: number, y: number, w: number, h: number, c: string | undefined) => void;
function retDe(g: G): Ret {
  return (x, y, w, h, c) => { if (!c) return; estilo(g, c); g.fillRect(x, y, w, h); };
}

/** Cores derivadas de um androide. */
function coresAndroide(ap: AparenciaAndroide) {
  const casco = ap.casco ?? '#e6eaf2';
  return {
    casco, cascoS: tom(casco, -0.24), cascoL: tom(casco, 0.4),
    metal: ap.casco ? tom(ap.casco, 0.25) : '#9aa3b8', mao: ap.casco ? tom(ap.casco, 0.45) : '#c8cedb',
    perna: ap.casco ? tom(ap.casco, -0.15) : '#3a4054', pe: '#262b3a',
    papel: ap.papel, papelS: tom(ap.papel, -0.25), papelL: tom(ap.papel, 0.25), visor: ap.visor ?? '#141a2b', olho: ap.olho ?? '#7ef3ff',
  };
}

/** Resolve as cores de um mapa feito à mão ('$papel', '$pele' etc. vêm da aparência). */
function paletaMapa(m: MapaMao, ap: Aparencia): Record<string, string> {
  const out: Record<string, string> = {};
  let ref: Record<string, string> = {};
  if (ap.tipo === 'androide') {
    const c = coresAndroide(ap);
    ref = { papel: c.papel, papelS: c.papelS, papelL: c.papelL, casco: c.casco, cascoS: c.cascoS, cascoL: c.cascoL, visor: c.visor, metal: c.metal, olho: c.olho };
  } else if (ap.tipo === 'humano') {
    ref = { pele: ap.pele, peleS: ap.peleSombra, cabelo: ap.cabelo.cor, cabeloL: ap.cabelo.luz, cabeloS: ap.cabelo.sombra, roupa: ap.roupa, roupaS: ap.roupaSombra, detalhe: ap.detalhe ?? ap.roupa, barba: ap.barba?.cor ?? ap.cabelo.sombra };
  }
  for (const [k, v] of Object.entries(m.paleta)) out[k] = v.startsWith('$') ? (ref[v.slice(1)] ?? '#ff00ff') : v;
  return out;
}

/** Passe à mão: em ninguém, só nos humanos (o padrão, escolhido no G1) ou também nos androides principais. */
export type PasseMao = 'nenhum' | 'humanos' | 'todos';

function mapaDe(ap: Aparencia, tam: Tam, passe: PasseMao): MapaMao | null {
  if (passe === 'nenhum') return null;
  if (ap.tipo === 'humano') return ap.maoFeita?.[String(tam) as '16' | '24'] ?? null;
  if (ap.tipo === 'androide' && ap.maoFeita && passe === 'todos') return MAO_ANDROIDES[ap.maoFeita]?.[tam] ?? null;
  return null;
}

/** Âncoras dos mapas feitos à mão em cada tamanho. */
const ANCORA: Record<Tam, { cabeca: [number, number]; tronco: [number, number] }> = {
  16: { cabeca: [2, 0], tronco: [4, 14] },
  24: { cabeca: [2, 0], tronco: [7, 18] },
};

/**
 * Desenha um quadro do personagem (sem os olhos de LED e a luz do peito dos androides).
 * O sprite tem DIM[tam] e os pés tocam a penúltima linha.
 */
export function desenharPersonagem(g: G, ap: Aparencia, pose: Pose, q: number, costas: boolean, tam: Tam, passe: PasseMao): void {
  if (ap.tipo !== 'androide' && ap.tipo !== 'humano') { desenharCriatura(g, ap, pose, q, tam); return; }
  const mapa = mapaDe(ap, tam, passe);
  if (tam === 16) corpo16(g, ap, pose, q, costas, mapa);
  else corpo24(g, ap, pose, q, costas, mapa);
}

/* =============================== 16 por 32 =============================== */
function corpo16(g: G, ap: AparenciaAndroide | AparenciaHumano, pose: Pose, q: number, costas: boolean, mapa: MapaMao | null): void {
  const R = retDe(g);
  const andando = pose === 'andar' || pose === 'correr';
  const sentado = pose === 'digitando' || pose === 'dormir';
  const k = andando ? q % 4 : 0;
  const dy = dyPose(pose, q, 16);
  const Y = (y: number) => y + dy;
  const humano = ap.tipo === 'humano';
  const A = ap.tipo === 'androide' ? coresAndroide(ap) : null;
  const H = ap.tipo === 'humano' ? ap : null;
  if (!sentado) R(3, 30, 10, 2, 'rgba(6,8,20,0.34)');
  // cabelo comprido, de frente: o que passa da linha dos ombros fica atrás do corpo (a cabeça entra
  // uma vez antes do corpo e outra depois, só até os ombros)
  const [cx, cy] = ANCORA[16].cabeca;
  const mapaCab = mapa && (costas ? (mapa.cabecaCostas ?? null) : mapa.cabeca);
  const cabeloAtras = !!H && !costas && (mapaCab ? mapaCab.length + cy > 14 : H.cabelo.estilo === 'longoFranja');
  const piscando = pose === 'parado' && q === 1;
  if (cabeloAtras) { if (mapaCab) mapaPixels(g, mapaCab, paletaMapa(mapa!, ap), cx, Y(cy)); else cabecaHumano16(R, g, H!, false, Y, piscando); }
  // pernas
  if (!sentado) {
    const corP = H ? H.calca : A!.perna;
    const corS = H ? H.sapato : A!.pe;
    const passo = pose === 'correr' ? 2 : 1;
    const le = k === 1 ? passo : 0, ri = k === 3 ? passo : 0;
    R(5, Y(22), 2, 6 - le, corP); R(9, Y(22), 2, 6 - ri, corP);
    R(6, Y(22), 1, 6 - le, tom(corP, -0.18)); R(10, Y(22), 1, 6 - ri, tom(corP, -0.18));
    R(4, Y(28 - le), 3, 2, corS); R(9, Y(28 - ri), 3, 2, corS);
    if (H?.sola) { R(4, Y(29 - le), 3, 1, H.sola); R(9, Y(29 - ri), 3, 1, H.sola); }
  }
  // braços
  // de jaqueta, a manga é a dela e vai até o pulso
  const jaq = H?.jaqueta, mangas = jaq ? 'longas' : H?.mangas;
  const corManga = H ? (jaq ? jaq.manga : mangas === 'nenhuma' ? H.pele : H.roupa) : A!.metal;
  const corAnte = H ? (jaq ? jaq.manga : mangas === 'longas' ? H.roupa : H.pele) : A!.metal;
  const mao = H ? H.pele : A!.mao;
  const tat = H?.tatuagem?.cores;
  const ladoManga = ladoDaManga(H, costas);
  // trecho de braço na manga de tatuagem; true quando o braço é o da manga (as marcas soltas não entram nele)
  const tatuar = (lado: 'e' | 'd', x: number, y: number, w: number, h: number, superior: boolean): boolean => {
    if (!H || lado !== ladoManga) return false;
    if (superior ? mangas === 'nenhuma' : mangas !== 'longas') desenharManga(R, x, y, w, h, H.tatuagem!, H.pele, superior);
    return true;
  };
  const bracoPadrao = (x: number, lado: 'e' | 'd', d = 0) => {
    R(x, Y(14 + d), 2, 3, corManga); R(x, Y(17 + d), 2, 3, corAnte); R(x, Y(20 + d), 2, 2, mao);
    if (jaq) R(x, Y(19 + d), 2, 1, jaq.cor); // punho
    const comManga = tatuar(lado, x, Y(14 + d), 2, 3, true); tatuar(lado, x, Y(17 + d), 2, 3, false);
    if (tat && !comManga) { if (lado === 'e') { R(x, Y(18 + d), 1, 1, tat[0]); R(x + 1, Y(19 + d), 1, 1, tat[1]); R(x, Y(20 + d), 1, 1, tat[2] ?? tat[0]); } else { R(x + 1, Y(17 + d), 1, 1, tat[1]); R(x, Y(18 + d), 1, 1, tat[0]); R(x + 1, Y(19 + d), 1, 1, tat[0]); } }
  };
  const balanco = andando ? (k === 1 ? 1 : (k === 3 ? -1 : 0)) : 0;
  if (pose === 'digitando' || pose === 'operando' || pose === 'jogar' || pose === 'dormir') {
    const alt = pose === 'dormir' ? 0 : q % 2;
    R(2, Y(14), 2, 4, corManga); R(12, Y(14), 2, 4, corManga);
    R(3, Y(18), 3, 2, corAnte); R(10, Y(18), 3, 2, corAnte);
    const me = tatuar('e', 2, Y(14), 2, 4, true); tatuar('e', 3, Y(18), 3, 2, false);
    const md = tatuar('d', 12, Y(14), 2, 4, true); tatuar('d', 10, Y(18), 3, 2, false);
    R(5, Y(18 - alt), 2, 2, mao); R(9, Y(18 - (1 - alt)), 2, 2, mao);
    if (tat) { if (!me) R(3, Y(18), 1, 1, tat[0]); if (!md) { R(12, Y(19), 1, 1, tat[1]); R(11, Y(18), 1, 1, tat[0]); } }
  } else if (pose === 'levantar') {
    const cima = q % 2 === 1;
    if (cima) {
      R(2, Y(14), 2, 3, corManga); R(2, Y(11), 2, 3, corAnte); tatuar('e', 2, Y(14), 2, 3, true); tatuar('e', 2, Y(11), 2, 3, false); R(2, Y(10), 2, 1, mao); R(0, Y(9), 6, 2, '#2a2e3a');
      R(12, Y(14), 2, 3, corManga); R(12, Y(11), 2, 3, corAnte); tatuar('d', 12, Y(14), 2, 3, true); tatuar('d', 12, Y(11), 2, 3, false); R(12, Y(10), 2, 1, mao); R(10, Y(9), 6, 2, '#2a2e3a');
    }
    else { bracoPadrao(2, 'e'); bracoPadrao(12, 'd'); R(0, Y(21), 6, 2, '#2a2e3a'); R(10, Y(21), 6, 2, '#2a2e3a'); }
  } else if (pose === 'pose') {
    const flex = q % 2 === 1;
    R(0, Y(14), 4, 2, corManga); R(12, Y(14), 4, 2, corManga);
    R(0, Y(10), 2, 4, corAnte); R(14, Y(10), 2, 4, corAnte);
    tatuar('e', 0, Y(14), 4, 2, true); tatuar('e', 0, Y(10), 2, 4, false); tatuar('d', 12, Y(14), 4, 2, true); tatuar('d', 14, Y(10), 2, 4, false);
    R(0, Y(9), 2, 1, mao); R(14, Y(9), 2, 1, mao);
    if (flex) { if (ladoManga !== 'e') R(1, Y(12), 2, 2, tom(corAnte, 0.2)); if (ladoManga !== 'd') R(13, Y(12), 2, 2, tom(corAnte, 0.2)); }
  } else if (pose === 'beber') {
    bracoPadrao(2, 'e');
    R(12, Y(14), 2, 3, corManga); tatuar('d', 12, Y(14), 2, 3, true); R(11, Y(13), 2, 2, corAnte); tatuar('d', 11, Y(13), 2, 2, false); R(10, Y(11), 2, 2, '#f3f3f7'); R(10, Y(11), 1, 1, '#5a3a22');
  } else if (pose === 'acenar') {
    bracoPadrao(2, 'e');
    R(12, Y(14), 2, 2, corManga); tatuar('d', 12, Y(14), 2, 2, true); R(12 + (q % 2), Y(9), 2, 5, corAnte); tatuar('d', 12 + (q % 2), Y(9), 2, 5, false); R(12 + (q % 2), Y(7), 2, 2, mao);
  } else {
    const amp = pose === 'correr' ? 2 : 1;
    bracoPadrao(2, 'e', balanco > 0 ? amp : 0); bracoPadrao(12, 'd', balanco < 0 ? amp : 0);
  }
  // tronco
  const [tx, ty] = ANCORA[16].tronco;
  const mapaTronco = mapa && (costas ? mapa.troncoCostas : mapa.tronco);
  if (mapaTronco) mapaPixels(g, mapaTronco, paletaMapa(mapa!, ap), tx, Y(ty));
  else if (H) {
    R(4, Y(14), 8, 8, H.roupa); R(11, Y(14), 1, 8, H.roupaSombra); R(4, Y(21), 8, 1, H.roupaSombra);
    const det = H.detalhe ?? tom(H.roupa, 0.4);
    if (!costas) {
      if (H.mangas === 'nenhuma') { R(6, Y(14), 4, 1, H.pele); R(7, Y(15), 2, 1, det); }
      else if (H.estampa) {
        R(7, Y(14), 2, 1, H.pele); R(6, Y(14), 1, 1, det); R(9, Y(14), 1, 1, det); R(7, Y(15), 2, 1, det);
        R(5, Y(18), 2, 2, H.estampa.cor); R(9, Y(18), 2, 2, H.estampa.cor); R(5, Y(19), 1, 1, H.roupa); R(10, Y(19), 1, 1, H.roupa);
      } else { R(7, Y(14), 2, 1, H.pele); R(6, Y(14), 1, 1, det); R(9, Y(14), 1, 1, det); }
      if (H.corrente) { R(6, Y(15), 1, 1, H.corrente); R(9, Y(15), 1, 1, H.corrente); R(7, Y(16), 2, 1, H.corrente); }
    } else if (H.estampa) { R(6, Y(16), 4, 3, H.estampa.cor); R(7, Y(17), 2, 1, H.roupa); }
    if (H.relogio && pose !== 'pose' && pose !== 'acenar') R(12, Y(20), 1, 1, H.relogio);
  } else {
    const a = A!;
    R(4, Y(14), 8, 8, a.papel); R(11, Y(14), 1, 8, a.papelS); R(4, Y(18), 8, 1, tom(a.papel, -0.18)); R(4, Y(14), 8, 1, a.papelL);
    const acc = (ap as AparenciaAndroide).acessorio;
    if (!costas) {
      if (acc === 'gravata') { R(7, Y(14), 2, 1, '#18213a'); R(7, Y(15), 2, 5, '#24304f'); }
      if (acc === 'gravatinha') R(6, Y(14), 4, 1, '#c0304a');
      if (acc === 'brilho') { R(5, Y(19), 1, 1, '#ffd9c7'); R(4, Y(20), 3, 1, '#ffd9c7'); R(5, Y(21), 1, 1, '#ffd9c7'); }
      if ((ap as AparenciaAndroide).casco) R(4, Y(19), 8, 1, '#14161f');
    }
  }
  if (jaq) jaqueta16(R, jaq, costas, Y);
  // cabeça (com o cabelo comprido já atrás do corpo, só até a linha dos ombros)
  if (mapaCab) { mapaPixels(g, cabeloAtras ? mapaCab.slice(0, 14 - cy) : mapaCab, paletaMapa(mapa!, ap), cx, Y(cy)); acessorio16(R, ap, pose, costas, Y, true); return; }
  if (humano) cabecaHumano16(cabeloAtras ? ateLinha(R, Y(14)) : R, g, H!, costas, Y, piscando);
  else {
    const a = A!;
    if ((ap as AparenciaAndroide).acessorio !== 'boina' && (ap as AparenciaAndroide).acessorio !== 'fone') { R(8, Y(0), 1, 3, '#8a93ad'); R(7, Y(0), 3, 1, pose === 'parado' && q === 1 ? tom(a.papel, 0.5) : a.papel); }
    R(4, Y(3), 8, 1, a.casco); R(3, Y(4), 10, 9, a.casco); R(4, Y(13), 8, 1, a.cascoS); R(12, Y(4), 1, 9, a.cascoS); R(4, Y(4), 6, 1, a.cascoL);
    R(2, Y(7), 1, 3, a.papel); R(13, Y(7), 1, 3, a.papel);
    if (costas) { R(5, Y(6), 6, 1, a.cascoS); R(5, Y(8), 6, 1, a.cascoS); R(5, Y(10), 6, 1, a.cascoS); }
    else { R(4, Y(6), 8, 5, a.visor); R(5, Y(6), 2, 1, '#3a4766'); }
  }
  acessorio16(R, ap, pose, costas, Y, false);
}

function cabecaHumano16(R: Ret, g: G, H: AparenciaHumano, costas: boolean, Y: (y: number) => number, piscando: boolean): void {
  const pele = H.pele;
  R(4, Y(5), 8, 9, pele);
  g.clearRect(4, Y(13), 1, 1); g.clearRect(11, Y(13), 1, 1);
  R(11, Y(6), 1, 6, H.peleSombra);
  R(3, Y(9), 1, 2, pele); R(12, Y(9), 1, 2, H.peleSombra);
  const C = H.cabelo.cor, L = H.cabelo.luz, D = H.cabelo.sombra;
  const olhos = H.olhos ?? '#1d1b2a';
  const rosto = () => {
    if (piscando) { R(6, Y(10), 1, 1, olhos); R(9, Y(10), 1, 1, olhos); }
    else { R(6, Y(9), 1, 2, olhos); R(9, Y(9), 1, 2, olhos); }
    if (H.batom) { if (!piscando) { R(5, Y(9), 1, 1, olhos); R(10, Y(9), 1, 1, olhos); } R(5, Y(11), 1, 1, H.bochecha ?? '#f09a8a'); R(10, Y(11), 1, 1, H.bochecha ?? '#f09a8a'); R(7, Y(12), 2, 1, H.batom); }
    // barba: uma linha de pele (com o nariz) entre os olhos e o bigode, senão olhos, bigode e cavanhaque viram um V escuro
    else if (H.barba) { R(8, Y(11), 1, 1, H.peleSombra); R(6, Y(12), 4, 1, H.barba.cor); R(7, Y(13), 2, 1, H.barba.cor); R(5, Y(12), 1, 1, H.peleSombra); R(10, Y(12), 1, 1, H.peleSombra); }
    else R(7, Y(12), 2, 1, tom(pele, -0.32));
  };
  switch (H.cabelo.estilo) {
    case 'topete':
      R(5, Y(2), 6, 1, D); R(4, Y(3), 8, 1, C); R(6, Y(3), 3, 1, L);
      R(3, Y(4), 10, 1, C); R(5, Y(4), 4, 1, L); R(3, Y(5), 10, 1, C); R(4, Y(5), 2, 1, L);
      if (costas) { R(3, Y(6), 10, 6, C); R(4, Y(8), 1, 1, L); R(9, Y(7), 2, 1, L); R(4, Y(12), 8, 1, D); return; }
      R(3, Y(6), 6, 1, C); R(10, Y(6), 3, 1, C); R(3, Y(7), 3, 1, C); R(12, Y(7), 1, 1, C); R(3, Y(8), 1, 2, D); R(12, Y(8), 1, 2, D);
      R(5, Y(8), 2, 1, D); R(9, Y(8), 2, 1, D);
      rosto(); return;
    case 'longoFranja':
      R(5, Y(2), 6, 1, D); R(4, Y(3), 8, 1, C); R(6, Y(3), 2, 1, L); R(3, Y(4), 10, 1, C); R(5, Y(4), 1, 1, L); R(9, Y(4), 1, 1, L); R(3, Y(5), 10, 1, C);
      if (costas) { R(2, Y(6), 12, 14, C); for (let yy = 7; yy < 20; yy += 3) { R(4, Y(yy), 1, 2, L); R(9, Y(yy + 1), 1, 2, L); R(6, Y(yy + 1), 1, 1, D); R(12, Y(yy), 1, 1, D); } R(3, Y(20), 10, 1, D); return; }
      R(3, Y(6), 10, 2, C); R(7, Y(6), 1, 2, L); R(4, Y(7), 1, 1, D); R(11, Y(7), 1, 1, D);
      R(2, Y(5), 2, 13, C); R(12, Y(5), 2, 13, C);
      R(2, Y(9), 1, 1, L); R(3, Y(12), 1, 1, L); R(2, Y(15), 1, 1, L); R(3, Y(10), 1, 1, D); R(2, Y(13), 1, 1, D); R(3, Y(16), 1, 1, D);
      R(13, Y(9), 1, 1, L); R(12, Y(12), 1, 1, L); R(13, Y(15), 1, 1, L); R(12, Y(10), 1, 1, D); R(13, Y(13), 1, 1, D); R(12, Y(16), 1, 1, D);
      R(2, Y(18), 1, 1, D); R(13, Y(18), 1, 1, D);
      rosto(); return;
    case 'coque':
      R(6, Y(0), 4, 2, C); R(7, Y(0), 2, 1, L); R(6, Y(2), 4, 1, D);
      R(4, Y(3), 8, 1, C); R(3, Y(4), 10, 2, C); R(5, Y(4), 3, 1, L);
      if (costas) { R(3, Y(6), 10, 6, C); R(5, Y(7), 1, 3, L); R(4, Y(12), 8, 1, D); return; }
      R(3, Y(6), 1, 3, C); R(12, Y(6), 1, 3, C); R(4, Y(6), 3, 1, C); R(9, Y(6), 3, 1, C); R(4, Y(7), 1, 1, D); R(11, Y(7), 1, 1, D);
      rosto(); return;
    default: // curto
      R(4, Y(3), 8, 1, C); R(3, Y(4), 10, 2, C); R(4, Y(4), 3, 1, L); R(5, Y(2), 6, 1, D);
      if (costas) { R(3, Y(6), 10, 6, C); R(4, Y(7), 1, 2, L); R(4, Y(12), 8, 1, D); return; }
      R(3, Y(6), 2, 2, C); R(11, Y(6), 2, 2, C); R(5, Y(6), 6, 1, C); R(6, Y(6), 2, 1, L); R(3, Y(8), 1, 1, D); R(12, Y(8), 1, 1, D);
      rosto();
  }
}

function acessorio16(R: Ret, ap: AparenciaAndroide | AparenciaHumano, pose: Pose, costas: boolean, Y: (y: number) => number, mapa: boolean): void {
  if (ap.tipo !== 'androide') { if (ap.bone) bone16(R, ap.bone, costas, Y); return; }
  const acc = ap.acessorio;
  if (acc === 'headset') { R(3, Y(2), 10, 1, '#2a2e40'); R(2, Y(3), 1, 5, '#2a2e40'); if (!costas) { R(3, Y(10), 1, 2, '#2a2e40'); R(4, Y(11), 2, 1, '#2a2e40'); } }
  if (acc === 'boina' && !mapa) { R(4, Y(1), 8, 2, '#c2185b'); R(3, Y(2), 3, 1, '#c2185b'); R(8, Y(0), 1, 1, '#ffd35c'); }
  if (acc === 'fone' && !mapa) { R(3, Y(2), 10, 1, '#4a5068'); R(3, Y(1), 10, 1, '#2a2e40'); R(2, Y(5), 2, 5, '#2a2e40'); R(12, Y(5), 2, 5, '#2a2e40'); R(2, Y(6), 1, 3, '#6a7290'); R(13, Y(6), 1, 3, '#6a7290'); }
  if (acc === 'capacete') { R(3, Y(4), 10, 2, '#ff7ab8'); R(3, Y(4), 10, 1, '#ffb3d6'); }
  if (acc === 'monoculo' && !costas) { const c = '#e8c14e'; R(8, Y(6), 4, 1, c); R(8, Y(10), 4, 1, c); R(8, Y(7), 1, 3, c); R(11, Y(7), 1, 3, c); R(11, Y(11), 1, 3, c); }
  if (acc === 'lupa' && !costas && (pose === 'parado' || pose === 'andar')) { const c = '#e8c14e'; R(13, Y(16), 3, 1, c); R(13, Y(19), 3, 1, c); R(13, Y(17), 1, 2, c); R(15, Y(17), 1, 2, c); R(14, Y(17), 1, 2, '#bfe8ff'); R(14, Y(20), 1, 2, '#6b4a32'); }
  if (acc === 'chave' && !costas && (pose === 'parado' || pose === 'andar')) { R(13, Y(19), 1, 4, '#c5cad6'); R(12, Y(18), 3, 1, '#c5cad6'); }
}

/** Desenho que para numa linha: o que cair dali para baixo não entra. */
function ateLinha(R: Ret, lim: number): Ret {
  return (x, y, w, h, c) => { const y1 = Math.min(y + h, lim); if (y1 > y) R(x, y, w, y1 - y, c); };
}

/** Lado da tela do braço com a manga de tatuagem: de frente, o braço esquerdo do personagem fica à direita. */
function ladoDaManga(H: AparenciaHumano | null, costas: boolean): 'e' | 'd' | null {
  const m = H?.tatuagem?.manga;
  if (!m) return null;
  return (m === 'esquerda') !== costas ? 'd' : 'e';
}

/** Manga de tatuagem num trecho de braço: as cores em trama, com um pouco de pele, e o desenho do ombro no alto do braço. */
function desenharManga(R: Ret, x: number, y: number, w: number, h: number, t: NonNullable<AparenciaHumano['tatuagem']>, pele: string, superior: boolean): void {
  const c = t.cores, trama = [c[1] ?? c[0], c[0], pele, c[2] ?? c[0], c[0], pele];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) R(x + i, y + j, 1, 1, trama[(i * 2 + j) % 6]);
  if (!superior || !t.ombro) return;
  const s = Math.min(w, h, 3), m = s === 3 ? 1 : s - 1;
  R(x, y, s, s, t.ombro); R(x + m, y + m, 1, 1, c[1] ?? pele);
}

type Jaqueta = NonNullable<AparenciaHumano['jaqueta']>;

/** Jaqueta aberta no 16 por 32: bordas e gola por cima da camisa, que segue à mostra no meio. De costas, cobre tudo. */
function jaqueta16(R: Ret, j: Jaqueta, costas: boolean, Y: (y: number) => number): void {
  const friso = j.friso ?? tom(j.cor, 0.5);
  if (costas) { R(4, Y(14), 8, 8, j.cor); R(4, Y(14), 8, 1, tom(j.cor, 0.15)); R(4, Y(20), 8, 1, friso); R(4, Y(21), 8, 1, tom(j.cor, -0.2)); return; }
  R(4, Y(14), 1, 8, j.cor); R(11, Y(14), 1, 8, tom(j.cor, -0.15)); R(5, Y(14), 1, 1, j.cor); R(10, Y(14), 1, 1, j.cor);
  R(4, Y(20), 1, 1, friso); R(11, Y(20), 1, 1, friso);
}

/** Boné no 16 por 32: copa por cima do cabelo e aba escura na testa; de costas, o fecho regulável. */
function bone16(R: Ret, cor: string, costas: boolean, Y: (y: number) => number): void {
  const luz = tom(cor, 0.35);
  R(4, Y(1), 8, 1, cor); R(3, Y(2), 10, costas ? 4 : 3, cor); R(5, Y(2), 3, 1, luz);
  if (costas) { R(6, Y(5), 4, 1, luz); return; }
  R(3, Y(5), 10, 1, tom(cor, -0.3));
}

/* =============================== 24 por 40 =============================== */
function corpo24(g: G, ap: AparenciaAndroide | AparenciaHumano, pose: Pose, q: number, costas: boolean, mapa: MapaMao | null): void {
  const R = retDe(g);
  const andando = pose === 'andar' || pose === 'correr';
  const sentado = pose === 'digitando' || pose === 'dormir';
  const k = andando ? q % 4 : 0;
  const dy = dyPose(pose, q, 24);
  const Y = (y: number) => y + dy;
  const A = ap.tipo === 'androide' ? coresAndroide(ap) : null;
  const H = ap.tipo === 'humano' ? ap : null;
  if (!sentado) { R(5, 38, 14, 2, 'rgba(6,8,20,0.32)'); R(7, 37, 10, 1, 'rgba(6,8,20,0.2)'); }
  // cabelo comprido, de frente: atrás do corpo da linha dos ombros para baixo (como no 16 por 32)
  const [cx, cy] = ANCORA[24].cabeca;
  const mapaCab = mapa && (costas ? (mapa.cabecaCostas ?? null) : mapa.cabeca);
  const cabeloAtras = !!H && !costas && (mapaCab ? mapaCab.length + cy > 18 : H.cabelo.estilo === 'longoFranja');
  const piscando = pose === 'parado' && q === 1;
  if (cabeloAtras) { if (mapaCab) mapaPixels(g, mapaCab, paletaMapa(mapa!, ap), cx, Y(cy)); else cabecaHumano24(R, g, H!, false, Y, piscando); }
  // pernas e pés
  if (!sentado) {
    const corP = H ? H.calca : A!.perna;
    const corS = H ? H.sapato : A!.pe;
    const passo = pose === 'correr' ? 2 : 1;
    const le = k === 1 ? passo : 0, ri = k === 3 ? passo : 0;
    R(8, Y(28), 3, 7 - le, corP); R(13, Y(28), 3, 7 - ri, corP);
    R(10, Y(28), 1, 7 - le, tom(corP, -0.2)); R(15, Y(28), 1, 7 - ri, tom(corP, -0.2));
    if (A) { R(8, Y(31 - le), 3, 1, tom(corP, 0.25)); R(13, Y(31 - ri), 3, 1, tom(corP, 0.25)); }
    else { R(8, Y(28), 8, 1, tom(corP, -0.1)); }
    R(7, Y(35 - le), 4, 2, corS); R(13, Y(35 - ri), 4, 2, corS);
    R(7, Y(35 - le), 4, 1, tom(corS, 0.18)); R(13, Y(35 - ri), 4, 1, tom(corS, 0.18));
    if (H?.sola) { R(7, Y(37 - le), 4, 1, H.sola); R(13, Y(37 - ri), 4, 1, H.sola); }
    else { R(7, Y(37 - le), 4, 1, tom(corS, -0.3)); R(13, Y(37 - ri), 4, 1, tom(corS, -0.3)); }
  }
  // braços
  const jaq = H?.jaqueta, mangas = jaq ? 'longas' : H?.mangas;
  const corManga = H ? (jaq ? jaq.manga : mangas === 'nenhuma' ? H.pele : H.roupa) : A!.metal;
  const corAnte = H ? (jaq ? jaq.manga : mangas === 'longas' ? H.roupa : H.pele) : A!.metal;
  const sombraBraco = (c: string) => tom(c, -0.2);
  const mao = H ? H.pele : A!.mao;
  const tat = H?.tatuagem?.cores;
  const ladoManga = ladoDaManga(H, costas);
  const tatuar = (lado: 'e' | 'd', x: number, y: number, w: number, h: number, superior: boolean): boolean => {
    if (!H || lado !== ladoManga) return false;
    if (superior ? mangas === 'nenhuma' : mangas !== 'longas') desenharManga(R, x, y, w, h, H.tatuagem!, H.pele, superior);
    return true;
  };
  const listra = jaq ? undefined : H?.estampa ? (H.detalhe ?? H.estampa.cor) : undefined;
  const bracoPadrao = (x: number, lado: 'e' | 'd', d = 0) => {
    const ext = lado === 'e' ? x : x + 2;
    R(x, Y(18 + d), 3, 4, corManga); R(ext, Y(18 + d), 1, 4, sombraBraco(corManga));
    if (listra && H?.mangas !== 'nenhuma') R(x, Y(20 + d), 3, 1, listra);
    R(x, Y(22 + d), 3, 4, corAnte); R(ext, Y(22 + d), 1, 4, sombraBraco(corAnte));
    if (A) R(x, Y(22 + d), 3, 1, tom(A.metal, -0.3));
    const comManga = tatuar(lado, x, Y(18 + d), 3, 4, true); tatuar(lado, x, Y(22 + d), 3, 4, false);
    R(x, Y(26 + d), 3, 2, mao);
    if (tat && !comManga) {
      if (lado === 'e') { R(x + 1, Y(22 + d), 1, 1, tat[0]); R(x, Y(23 + d), 2, 1, tat[0]); R(x + 1, Y(24 + d), 1, 1, tat[2] ?? tat[1]); R(x + 2, Y(19 + d), 1, 1, tat[1]); R(x + 1, Y(20 + d), 1, 1, tat[0]); }
      else { R(x + 1, Y(22 + d), 1, 1, tat[1]); R(x + 1, Y(23 + d), 2, 1, tat[0]); R(x, Y(24 + d), 1, 1, tat[2] ?? tat[1]); R(x, Y(19 + d), 1, 1, tat[0]); }
    }
    if (H?.relogio && lado === 'd' && pose !== 'pose') R(x, Y(25 + d), 3, 1, H.relogio);
    if (jaq) R(x, Y(25 + d), 3, 1, jaq.cor); // punho por cima do relógio
  };
  const balanco = andando ? (k === 1 ? 1 : (k === 3 ? -1 : 0)) : 0;
  if (pose === 'digitando' || pose === 'operando' || pose === 'jogar' || pose === 'dormir') {
    const alt = pose === 'dormir' ? 0 : q % 2;
    R(4, Y(18), 3, 5, corManga); R(17, Y(18), 3, 5, corManga);
    R(4, Y(18), 1, 5, sombraBraco(corManga)); R(19, Y(18), 1, 5, sombraBraco(corManga));
    R(5, Y(23), 4, 2, corAnte); R(15, Y(23), 4, 2, corAnte);
    const me = tatuar('e', 4, Y(18), 3, 5, true); tatuar('e', 5, Y(23), 4, 2, false);
    const md = tatuar('d', 17, Y(18), 3, 5, true); tatuar('d', 15, Y(23), 4, 2, false);
    R(8, Y(23 - alt), 3, 2, mao); R(13, Y(23 - (1 - alt)), 3, 2, mao);
    if (tat) { if (!me) { R(5, Y(23), 1, 1, tat[0]); R(6, Y(24), 1, 1, tat[1]); } if (!md) { R(17, Y(23), 1, 1, tat[0]); R(16, Y(24), 1, 1, tat[2] ?? tat[1]); } }
  } else if (pose === 'levantar') {
    const cima = q % 2 === 1;
    if (cima) {
      for (const [x, b0] of [[4, 0], [17, 13]] as const) {
        R(x, Y(18), 3, 3, corManga); R(x, Y(13), 3, 5, corAnte);
        tatuar(x === 4 ? 'e' : 'd', x, Y(18), 3, 3, true); tatuar(x === 4 ? 'e' : 'd', x, Y(13), 3, 5, false);
        R(x, Y(12), 3, 1, mao);
        R(b0 + 1, Y(11), 9, 1, '#c5cad6'); R(b0 + 1, Y(9), 2, 5, '#2a2e3a'); R(b0 + 8, Y(9), 2, 5, '#2a2e3a');
      }
    } else {
      bracoPadrao(4, 'e'); bracoPadrao(17, 'd');
      R(1, Y(28), 9, 1, '#c5cad6'); R(1, Y(26), 2, 5, '#2a2e3a'); R(8, Y(26), 2, 5, '#2a2e3a');
      R(14, Y(28), 9, 1, '#c5cad6'); R(14, Y(26), 2, 5, '#2a2e3a'); R(21, Y(26), 2, 5, '#2a2e3a');
    }
  } else if (pose === 'pose') {
    const flex = q % 2 === 1;
    R(1, Y(18), 6, 3, corManga); R(17, Y(18), 6, 3, corManga);
    R(1, Y(12), 3, 6, corAnte); R(20, Y(12), 3, 6, corAnte);
    tatuar('e', 1, Y(18), 6, 3, true); tatuar('e', 1, Y(12), 3, 6, false); tatuar('d', 17, Y(18), 6, 3, true); tatuar('d', 20, Y(12), 3, 6, false);
    R(1, Y(10), 3, 2, mao); R(20, Y(10), 3, 2, mao);
    if (flex) { if (ladoManga !== 'e') R(2, Y(15), 3, 3, tom(corAnte, 0.22)); if (ladoManga !== 'd') R(19, Y(15), 3, 3, tom(corAnte, 0.22)); }
  } else if (pose === 'beber') {
    bracoPadrao(4, 'e');
    R(17, Y(18), 3, 4, corManga); tatuar('d', 17, Y(18), 3, 4, true); R(15, Y(16), 3, 4, corAnte); tatuar('d', 15, Y(16), 3, 4, false); R(13, Y(13), 3, 4, '#f3f3f7'); R(13, Y(13), 3, 1, '#5a3a22'); R(16, Y(14), 1, 2, '#f3f3f7');
  } else if (pose === 'acenar') {
    bracoPadrao(4, 'e');
    R(17, Y(18), 3, 3, corManga); tatuar('d', 17, Y(18), 3, 3, true); R(18 + (q % 2), Y(11), 3, 7, corAnte); tatuar('d', 18 + (q % 2), Y(11), 3, 7, false); R(18 + (q % 2), Y(8), 3, 3, mao);
  } else {
    const amp = pose === 'correr' ? 2 : 1;
    bracoPadrao(4, 'e', balanco > 0 ? amp : 0); bracoPadrao(17, 'd', balanco < 0 ? amp : 0);
  }
  // tronco
  const [tx, ty] = ANCORA[24].tronco;
  const mapaTronco = mapa && (costas ? mapa.troncoCostas : mapa.tronco);
  if (mapaTronco) mapaPixels(g, mapaTronco, paletaMapa(mapa!, ap), tx, Y(ty));
  else if (H) tronco24Humano(R, H, costas, Y);
  else tronco24Androide(R, ap as AparenciaAndroide, A!, costas, Y);
  if (jaq) jaqueta24(R, jaq, costas, Y);
  // cabeça (com o cabelo comprido já atrás do corpo, só até a linha dos ombros)
  if (mapaCab) { mapaPixels(g, cabeloAtras ? mapaCab.slice(0, 18 - cy) : mapaCab, paletaMapa(mapa!, ap), cx, Y(cy)); acessorio24(R, ap, pose, costas, Y, true); return; }
  if (H) cabecaHumano24(cabeloAtras ? ateLinha(R, Y(18)) : R, g, H, costas, Y, piscando);
  else {
    const a = A!, acc = (ap as AparenciaAndroide).acessorio;
    if (acc !== 'boina' && acc !== 'fone') { R(11, Y(0), 2, 4, '#8a93ad'); R(10, Y(0), 4, 1, pose === 'parado' && q === 1 ? tom(a.papel, 0.5) : a.papel); R(11, Y(0), 1, 1, tom(a.papel, 0.6)); }
    R(7, Y(3), 10, 1, a.casco); R(5, Y(4), 14, 1, a.casco); R(4, Y(5), 16, 11, a.casco); R(5, Y(16), 14, 1, a.cascoS); R(7, Y(17), 10, 1, a.cascoS);
    R(19, Y(5), 1, 11, a.cascoS); R(18, Y(4), 1, 1, a.cascoS);
    R(6, Y(4), 6, 1, a.cascoL); R(5, Y(5), 3, 1, a.cascoL); R(5, Y(6), 1, 2, a.cascoL);
    R(3, Y(8), 1, 5, a.papel); R(20, Y(8), 1, 5, a.papel); R(2, Y(9), 1, 3, a.papelS); R(21, Y(9), 1, 3, a.papelS);
    if (costas) { for (const yy of [7, 9, 11, 13]) R(7, Y(yy), 10, 1, a.cascoS); R(10, Y(15), 4, 1, a.papelS); }
    else {
      R(6, Y(7), 12, 1, a.cascoS);
      R(6, Y(8), 12, 7, a.visor); R(7, Y(8), 3, 1, '#3a4766'); R(7, Y(9), 1, 1, '#2c3754'); R(17, Y(14), 1, 1, '#2c3754');
      R(10, Y(16), 4, 1, a.papelS);
    }
  }
  acessorio24(R, ap, pose, costas, Y, false);
}

function tronco24Humano(R: Ret, H: AparenciaHumano, costas: boolean, Y: (y: number) => number): void {
  R(7, Y(18), 10, 9, H.roupa); R(16, Y(18), 1, 9, H.roupaSombra); R(7, Y(26), 10, 1, H.roupaSombra);
  R(7, Y(27), 10, 1, H.calca);
  R(8, Y(18), 2, 1, tom(H.roupa, 0.15));
  const det = H.detalhe ?? tom(H.roupa, 0.4);
  if (costas) {
    R(10, Y(17), 4, 1, H.peleSombra);
    if (H.estampa) desenharNumero(R, H.estampa.texto, 12, Y(20), H.estampa.cor);
    return;
  }
  R(10, Y(17), 4, 1, H.pele);
  if (H.mangas === 'nenhuma') {
    R(9, Y(18), 6, 1, H.pele); R(10, Y(19), 4, 1, H.pele); R(8, Y(18), 1, 2, H.roupa); R(15, Y(18), 1, 2, H.roupa);
    R(11, Y(20), 2, 1, det);
  } else if (H.estampa) {
    R(10, Y(18), 4, 1, H.pele); R(11, Y(19), 2, 1, H.pele);
    R(9, Y(18), 1, 1, det); R(14, Y(18), 1, 1, det); R(10, Y(19), 1, 1, det); R(13, Y(19), 1, 1, det); R(11, Y(20), 2, 1, det);
    desenharNumero(R, H.estampa.texto, 12, Y(21), H.estampa.cor);
  } else {
    R(10, Y(18), 4, 1, H.pele); R(9, Y(18), 1, 1, det); R(14, Y(18), 1, 1, det); R(11, Y(19), 2, 1, H.pele);
    R(12, Y(21), 1, 4, H.roupaSombra);
  }
  if (H.corrente) { R(9, Y(19), 1, 1, H.corrente); R(14, Y(19), 1, 1, H.corrente); R(10, Y(20), 1, 1, H.corrente); R(13, Y(20), 1, 1, H.corrente); R(11, Y(21), 2, 1, H.corrente); }
}

/** Número da camisa com a fonte 3 por 5, centrado em cx. */
function desenharNumero(R: Ret, texto: string, cx: number, y: number, cor: string): void {
  const { pts, largura } = pixelsTexto(texto.slice(0, 2));
  const x0 = Math.round(cx - (largura + 1) / 2);
  for (const [px, py] of pts) R(x0 + px, y + py, 1, 1, cor);
}

function tronco24Androide(R: Ret, ap: AparenciaAndroide, a: ReturnType<typeof coresAndroide>, costas: boolean, Y: (y: number) => number): void {
  R(7, Y(18), 10, 10, a.papel); R(16, Y(18), 1, 10, a.papelS); R(7, Y(18), 10, 1, a.papelL); R(7, Y(23), 10, 1, tom(a.papel, -0.18));
  R(7, Y(27), 10, 1, tom(a.papel, -0.35));
  if (costas) { R(9, Y(20), 6, 2, a.papelS); return; }
  R(9, Y(19), 6, 3, tom(a.papel, 0.1)); R(9, Y(19), 6, 1, a.papelL);
  const acc = ap.acessorio;
  if (acc === 'gravata') { R(11, Y(18), 2, 1, '#18213a'); R(11, Y(19), 2, 6, '#24304f'); R(11, Y(25), 1, 1, '#24304f'); }
  if (acc === 'gravatinha') { R(9, Y(18), 2, 2, '#c0304a'); R(13, Y(18), 2, 2, '#c0304a'); R(11, Y(18), 2, 1, '#8a1f34'); }
  if (acc === 'brilho') { R(8, Y(23), 1, 1, '#ffd9c7'); R(7, Y(24), 3, 1, '#ffd9c7'); R(8, Y(25), 1, 1, '#ffd9c7'); R(8, Y(24), 1, 1, '#ffffff'); }
  if (ap.casco) R(7, Y(25), 10, 1, '#14161f');
  // corpo do mascote (bots do OpenMausBot): emblema de 3 por 3 na barriga, num tom claro da cor do bot
  if (ap.corpo) { const b = EMBLEMA_CORPO[ap.corpo] ?? EMBLEMA_CORPO.cursor; for (let k = 0; k < 9; k++) if (b[k] === '1') R(13 + (k % 3), Y(24 + Math.floor(k / 3)), 1, 1, tom(ap.papel, 0.55)); }
}

/** Emblema de cada corpo de mascote (3 por 3, linha a linha). */
const EMBLEMA_CORPO: Record<string, string> = {
  cursor: '100110111', blob: '011111110', circle: '111101111', squircle: '111111111', capsule: '010010010',
  drop: '010111111', shield: '111111010', hexagon: '010101010', diamond: '010111010', star: '101010101',
};

function cabecaHumano24(R: Ret, g: G, H: AparenciaHumano, costas: boolean, Y: (y: number) => number, piscando: boolean): void {
  const pele = H.pele, ps = H.peleSombra;
  R(7, Y(5), 10, 1, pele); R(6, Y(6), 12, 9, pele); R(7, Y(15), 10, 1, pele); R(8, Y(16), 8, 1, pele);
  R(17, Y(6), 1, 9, ps); R(16, Y(15), 1, 1, ps); R(15, Y(16), 1, 1, ps);
  R(5, Y(10), 1, 3, pele); R(18, Y(10), 1, 3, ps); R(5, Y(11), 1, 1, ps);
  const C = H.cabelo.cor, L = H.cabelo.luz, D = H.cabelo.sombra;
  const olhos = H.olhos ?? '#1d1b2a';
  const rosto = () => {
    // sobrancelhas, olhos com brilho, nariz e boca
    R(8, Y(9), 2, 1, D); R(14, Y(9), 2, 1, D);
    if (piscando) { R(8, Y(11), 2, 1, olhos); R(14, Y(11), 2, 1, olhos); }
    else {
      R(8, Y(10), 2, 2, olhos); R(14, Y(10), 2, 2, olhos);
      R(8, Y(10), 1, 1, '#ffffff'); R(14, Y(10), 1, 1, '#ffffff');
    }
    R(12, Y(12), 1, 1, ps); R(11, Y(13), 2, 1, tom(ps, -0.05));
    if (H.batom) {
      if (!piscando) { R(7, Y(10), 1, 1, olhos); R(16, Y(10), 1, 1, olhos); }
      R(7, Y(13), 2, 1, H.bochecha ?? '#f09a8a'); R(15, Y(13), 2, 1, H.bochecha ?? '#f09a8a');
      R(10, Y(14), 4, 1, H.batom); R(11, Y(15), 2, 1, tom(H.batom, -0.25));
    } else if (H.barba) {
      R(9, Y(14), 6, 1, H.barba.cor); R(10, Y(15), 4, 1, tom(pele, -0.3)); R(10, Y(16), 4, 1, H.barba.cor); R(11, Y(17), 2, 1, H.barba.cor);
      R(8, Y(15), 1, 1, ps); R(15, Y(15), 1, 1, ps);
    } else { R(10, Y(14), 4, 1, tom(pele, -0.32)); R(10, Y(13), 1, 1, tom(pele, -0.15)); R(13, Y(13), 1, 1, tom(pele, -0.15)); }
  };
  switch (H.cabelo.estilo) {
    case 'topete':
      R(9, Y(1), 6, 1, D); R(7, Y(2), 10, 1, C); R(9, Y(2), 4, 1, L);
      R(5, Y(3), 14, 1, C); R(7, Y(3), 5, 1, L); R(5, Y(4), 14, 1, C); R(6, Y(4), 4, 1, L); R(5, Y(5), 14, 1, C);
      if (costas) { R(5, Y(6), 14, 9, C); R(6, Y(8), 1, 2, L); R(13, Y(7), 3, 1, L); R(9, Y(11), 2, 1, L); R(6, Y(15), 12, 1, D); R(5, Y(14), 1, 1, D); R(18, Y(14), 1, 1, D); return; }
      R(5, Y(6), 7, 1, C); R(7, Y(6), 3, 1, L); R(15, Y(6), 4, 1, C); R(5, Y(7), 4, 1, C); R(17, Y(7), 2, 1, C); R(12, Y(6), 2, 1, D);
      R(5, Y(8), 1, 3, D); R(18, Y(8), 1, 3, D); R(6, Y(8), 1, 1, D);
      rosto(); return;
    case 'longoFranja':
      R(8, Y(1), 8, 1, D); R(6, Y(2), 12, 1, C); R(8, Y(2), 2, 1, L); R(5, Y(3), 14, 1, C); R(14, Y(3), 2, 1, L); R(4, Y(4), 16, 1, C);
      if (costas) {
        R(3, Y(5), 18, 20, C);
        for (let yy = 6; yy < 24; yy += 3) { R(5, Y(yy), 1, 2, L); R(10, Y(yy + 1), 1, 2, L); R(15, Y(yy), 1, 2, L); R(8, Y(yy + 2), 1, 1, D); R(13, Y(yy + 1), 1, 1, D); R(19, Y(yy), 1, 1, D); }
        R(4, Y(25), 16, 1, D); return;
      }
      // franja por cima da testa, com mechas
      R(4, Y(5), 16, 2, C); R(6, Y(7), 12, 1, C); R(7, Y(8), 2, 1, C); R(15, Y(8), 2, 1, C);
      R(8, Y(5), 1, 2, L); R(12, Y(5), 1, 3, L); R(15, Y(6), 1, 1, L); R(10, Y(7), 1, 1, D); R(14, Y(7), 1, 1, D);
      // cabelo longo e ondulado dos lados, até o peito
      R(3, Y(6), 3, 18, C); R(18, Y(6), 3, 18, C); R(5, Y(6), 1, 3, C); R(18, Y(6), 1, 3, C);
      for (let yy = 8; yy < 24; yy += 3) { R(3, Y(yy), 1, 1, L); R(4, Y(yy + 1), 1, 1, D); R(20, Y(yy), 1, 1, L); R(19, Y(yy + 1), 1, 1, D); }
      R(3, Y(24), 2, 1, D); R(19, Y(24), 2, 1, D); R(2, Y(14), 1, 6, C); R(21, Y(14), 1, 6, C);
      rosto(); return;
    case 'coque':
      R(10, Y(0), 4, 1, C); R(9, Y(1), 6, 2, C); R(10, Y(1), 2, 1, L); R(10, Y(3), 4, 1, D);
      R(6, Y(3), 4, 1, C); R(14, Y(3), 4, 1, C); R(5, Y(4), 14, 2, C); R(7, Y(4), 4, 1, L);
      if (costas) { R(5, Y(6), 14, 9, C); R(7, Y(7), 1, 4, L); R(12, Y(8), 1, 3, L); R(6, Y(15), 12, 1, D); return; }
      R(5, Y(6), 3, 1, C); R(16, Y(6), 3, 1, C); R(5, Y(7), 2, 3, C); R(17, Y(7), 2, 3, C); R(8, Y(6), 2, 1, D); R(14, Y(6), 2, 1, D);
      rosto(); return;
    default: // curto
      R(8, Y(2), 8, 1, D); R(6, Y(3), 12, 1, C); R(8, Y(3), 3, 1, L); R(5, Y(4), 14, 2, C); R(6, Y(4), 4, 1, L);
      if (costas) { R(5, Y(6), 14, 9, C); R(6, Y(7), 1, 3, L); R(6, Y(15), 12, 1, D); return; }
      R(5, Y(6), 14, 1, C); R(7, Y(6), 3, 1, L); R(5, Y(7), 2, 2, C); R(17, Y(7), 2, 2, C); R(5, Y(9), 1, 2, D); R(18, Y(9), 1, 2, D);
      rosto();
  }
}

function acessorio24(R: Ret, ap: AparenciaAndroide | AparenciaHumano, pose: Pose, costas: boolean, Y: (y: number) => number, mapa: boolean): void {
  if (ap.tipo !== 'androide') { if (ap.bone) bone24(R, ap.bone, costas, Y); return; }
  const acc = ap.acessorio;
  if (acc === 'headset') {
    R(5, Y(2), 14, 1, '#2a2e40'); R(4, Y(3), 1, 2, '#2a2e40'); R(19, Y(3), 1, 2, '#2a2e40'); R(2, Y(7), 2, 6, '#2a2e40'); R(2, Y(8), 1, 4, '#4a5068');
    if (!costas) { R(3, Y(13), 1, 2, '#2a2e40'); R(4, Y(15), 3, 1, '#2a2e40'); R(7, Y(15), 1, 1, '#ff4fd8'); }
  }
  if (acc === 'boina' && !mapa) { R(6, Y(1), 12, 3, '#c2185b'); R(4, Y(3), 5, 1, '#c2185b'); R(7, Y(1), 4, 1, '#e0337a'); R(11, Y(0), 2, 1, '#ffd35c'); R(6, Y(4), 12, 1, '#8a1040'); }
  if (acc === 'fone' && !mapa) { R(5, Y(1), 14, 1, '#2a2e40'); R(5, Y(2), 14, 1, '#4a5068'); R(4, Y(3), 2, 1, '#2a2e40'); R(18, Y(3), 2, 1, '#2a2e40'); R(1, Y(7), 3, 7, '#2a2e40'); R(20, Y(7), 3, 7, '#2a2e40'); R(1, Y(8), 1, 5, '#6a7290'); R(22, Y(8), 1, 5, '#6a7290'); R(2, Y(9), 1, 3, '#ff4fd8'); R(21, Y(9), 1, 3, '#ff4fd8'); }
  if (acc === 'capacete') { R(4, Y(4), 16, 3, '#ff7ab8'); R(4, Y(4), 16, 1, '#ffb3d6'); R(11, Y(5), 2, 1, '#ffffff'); }
  if (acc === 'monoculo' && !costas) { const c = '#e8c14e'; R(12, Y(8), 6, 1, c); R(12, Y(14), 6, 1, c); R(12, Y(9), 1, 5, c); R(17, Y(9), 1, 5, c); R(17, Y(15), 1, 4, c); R(16, Y(19), 1, 2, c); }
  if (acc === 'lupa' && !costas && (pose === 'parado' || pose === 'andar')) { const c = '#e8c14e'; R(19, Y(21), 4, 1, c); R(19, Y(25), 4, 1, c); R(19, Y(22), 1, 3, c); R(22, Y(22), 1, 3, c); R(20, Y(22), 2, 3, '#bfe8ff'); R(20, Y(23), 1, 1, '#ffffff'); R(20, Y(26), 1, 3, '#6b4a32'); }
  if (acc === 'chave' && !costas && (pose === 'parado' || pose === 'andar')) { R(19, Y(24), 2, 5, '#c5cad6'); R(18, Y(23), 4, 1, '#c5cad6'); }
}

/** Jaqueta aberta no 24 por 40 (como no 16 por 32). */
function jaqueta24(R: Ret, j: Jaqueta, costas: boolean, Y: (y: number) => number): void {
  const friso = j.friso ?? tom(j.cor, 0.5);
  if (costas) { R(7, Y(18), 10, 9, j.cor); R(7, Y(18), 10, 1, tom(j.cor, 0.15)); R(7, Y(25), 10, 1, friso); R(7, Y(26), 10, 1, tom(j.cor, -0.2)); return; }
  R(7, Y(18), 1, 9, j.cor); R(16, Y(18), 1, 9, tom(j.cor, -0.15)); R(8, Y(18), 2, 1, j.cor); R(14, Y(18), 2, 1, j.cor);
  R(7, Y(25), 1, 1, friso); R(16, Y(25), 1, 1, friso);
}

/** Boné no 24 por 40. */
function bone24(R: Ret, cor: string, costas: boolean, Y: (y: number) => number): void {
  const luz = tom(cor, 0.35);
  R(7, Y(1), 10, 1, cor); R(5, Y(2), 14, costas ? 6 : 4, cor); R(7, Y(2), 4, 1, luz); R(11, Y(1), 2, 1, luz);
  if (costas) { R(9, Y(7), 6, 1, luz); return; }
  R(4, Y(6), 16, 1, tom(cor, -0.3)); R(5, Y(7), 14, 1, tom(cor, -0.45));
}

/* =============================== Rosto (olhos e peito) =============================== */
/** Variantes de rosto: o estado e, para o ocioso, a piscada. */
export const ROSTOS: readonly string[] = ['ocioso', 'piscar', 'pensando', 'lendo', 'editando', 'comando', 'esperando', 'talvez', 'erro', 'entregou', 'delegando', 'treinando', 'pausa', 'chegando', 'fila', 'semSinal', 'limite', 'dormindo', 'recarga', 'recargaLuz'];
export const INDICE_ROSTO: Record<string, number> = Object.fromEntries(ROSTOS.map((r, k) => [r, k]));

export function desenharRosto(g: G, ap: AparenciaAndroide, rosto: string, tam: Tam): void {
  const R = retDe(g);
  const c = coresAndroide(ap);
  const olho = c.olho;
  // na cápsula de recarga: olhos apagados e só a luz do peito, que pulsa devagar (dois quadros)
  if (rosto === 'recarga' || rosto === 'recargaLuz') {
    const luz = rosto === 'recargaLuz' ? '#52ffa8' : '#1f5a40';
    if (tam === 16) R(7, 15, 2, 2, luz);
    else { R(11, 20, 2, 2, luz); R(11, 20, 1, 1, tom(luz, 0.3)); }
    return;
  }
  const e = (rosto === 'piscar' ? 'ocioso' : rosto) as Estado;
  const corPeito = rosto === 'semSinal' ? '#2a2e3a' : rosto === 'dormindo' ? '#3a4266' : CORES_ESTADO[e] ?? '#7ef3ff';
  if (tam === 16) {
    R(7, 15, 2, 2, corPeito);
    const par = (f: (x: number) => void) => { f(4); f(9); };
    switch (rosto) {
      case 'erro': par((x) => { const r = '#ff5050'; R(x, 7, 1, 1, r); R(x + 2, 7, 1, 1, r); R(x + 1, 8, 1, 1, r); R(x, 9, 1, 1, r); R(x + 2, 9, 1, 1, r); }); break;
      case 'esperando': R(5, 7, 1, 2, '#ffcf4d'); R(5, 10, 1, 1, '#ffcf4d'); R(10, 7, 1, 2, '#ffcf4d'); R(10, 10, 1, 1, '#ffcf4d'); break;
      case 'talvez': for (const x of [5, 10]) { R(x - 1, 7, 2, 1, '#d9b45a'); R(x, 8, 1, 1, '#d9b45a'); R(x - 1, 10, 1, 1, '#d9b45a'); } break;
      case 'entregou': case 'pausa': { const cc = rosto === 'entregou' ? '#7dffa8' : olho; par((x) => { R(x, 9, 1, 1, cc); R(x + 1, 8, 1, 1, cc); R(x + 2, 9, 1, 1, cc); }); break; }
      case 'pensando': R(5, 7, 2, 1, olho); R(9, 7, 2, 1, olho); break;
      case 'lendo': R(5, 9, 2, 1, olho); R(9, 9, 2, 1, olho); break;
      case 'piscar': case 'dormindo': R(5, 9, 2, 1, tom(olho, -0.55)); R(9, 9, 2, 1, tom(olho, -0.55)); break;
      case 'semSinal': R(5, 8, 1, 1, '#626c8a'); R(10, 9, 1, 1, '#626c8a'); break;
      case 'limite': R(5, 8, 2, 1, '#8a6bd6'); R(9, 8, 2, 1, '#8a6bd6'); break;
      default: { const cc = (['editando', 'comando', 'treinando', 'delegando'] as string[]).includes(rosto) ? CORES_ESTADO[e] : olho; R(5, 8, 2, 1, cc); R(9, 8, 2, 1, cc); }
    }
    return;
  }
  // 24 por 40
  R(11, 20, 2, 2, corPeito); R(11, 20, 1, 1, tom(corPeito, 0.4));
  const par = (f: (x: number) => void) => { f(7); f(14); };
  switch (rosto) {
    case 'erro': par((x) => { const r = '#ff5050'; R(x, 9, 1, 1, r); R(x + 2, 9, 1, 1, r); R(x + 1, 10, 1, 1, r); R(x, 11, 1, 1, r); R(x + 2, 11, 1, 1, r); R(x + 1, 12, 1, 1, '#a02020'); }); break;
    case 'esperando': for (const x of [8, 14]) { R(x, 9, 2, 3, '#ffcf4d'); R(x, 13, 2, 1, '#ffcf4d'); } break;
    case 'talvez': for (const x of [8, 14]) { R(x, 9, 2, 1, '#d9b45a'); R(x + 1, 10, 1, 1, '#d9b45a'); R(x, 11, 1, 1, '#d9b45a'); R(x, 13, 1, 1, '#d9b45a'); } break;
    case 'entregou': case 'pausa': { const cc = rosto === 'entregou' ? '#7dffa8' : olho; par((x) => { R(x, 11, 1, 1, cc); R(x + 1, 10, 1, 1, cc); R(x + 2, 11, 1, 1, cc); }); break; }
    case 'pensando': R(8, 9, 2, 2, olho); R(14, 9, 2, 2, olho); break;
    case 'lendo': R(8, 12, 2, 2, olho); R(14, 12, 2, 2, olho); break;
    case 'piscar': case 'dormindo': R(8, 12, 2, 1, tom(olho, -0.55)); R(14, 12, 2, 1, tom(olho, -0.55)); break;
    case 'semSinal': R(8, 10, 1, 1, '#626c8a'); R(15, 12, 1, 1, '#626c8a'); R(11, 11, 1, 1, '#626c8a'); break;
    case 'limite': R(8, 11, 2, 1, '#8a6bd6'); R(14, 11, 2, 1, '#8a6bd6'); break;
    default: {
      const cc = (['editando', 'comando', 'treinando', 'delegando'] as string[]).includes(rosto) ? CORES_ESTADO[e] : olho;
      R(8, 10, 2, 2, cc); R(14, 10, 2, 2, cc); R(8, 10, 1, 1, tom(cc, 0.5)); R(14, 10, 1, 1, tom(cc, 0.5));
    }
  }
}

/* =============================== Criaturas =============================== */
function desenharCriatura(g: G, ap: AparenciaCriatura, pose: Pose, q: number, tam: Tam): void {
  const R = retDe(g);
  const { w, h } = DIM[tam];
  const base = h - 3; // linha do chão
  const s = tam === 24 ? 1.4 : 1;
  const x0 = Math.round(w / 2 - 6 * s);
  const S = (v: number) => Math.round(v * s);
  if (ap.tipo === 'gato') {
    const c = ap.cor, cl = ap.detalhe ?? tom(c, 0.5), cs = tom(c, -0.3);
    R(x0 + S(1), base + 1, S(11), 1, 'rgba(6,8,20,0.3)');
    if (pose === 'dormir') {
      R(x0 + S(2), base - S(4), S(9), S(4), c); R(x0 + S(3), base - S(5), S(6), 1, c); R(x0 + S(2), base - S(1), S(9), 1, cs);
      R(x0 + S(8), base - S(5), S(3), S(2), c); R(x0 + S(8), base - S(6), 1, 1, c); R(x0 + S(10), base - S(6), 1, 1, c);
      R(x0 + S(3), base - S(2), S(5), 1, cl); if (q % 2) R(x0 + S(4), base - S(5), S(3), 1, tom(c, 0.15));
      return;
    }
    const andando = pose === 'andar';
    const p = andando ? q % 4 : 0;
    // corpo, cabeça, orelhas, rabo
    R(x0 + S(2), base - S(5), S(7), S(3), c); R(x0 + S(2), base - S(3), S(7), 1, cs);
    R(x0 + S(3), base - S(3), S(4), 1, cl);
    const pernas = andando ? [[2, p % 2], [4, (p + 1) % 2], [6, p % 2], [8, (p + 1) % 2]] : [[2, 0], [4, 0], [6, 0], [8, 0]];
    for (const [px, up] of pernas) R(x0 + S(px), base - S(2) - up, S(1) || 1, S(2), cs);
    R(x0 + S(8), base - S(8), S(4), S(4), c); R(x0 + S(8), base - S(9), 1, 1, c); R(x0 + S(11), base - S(9), 1, 1, c);
    R(x0 + S(9), base - S(7), 1, 1, '#1d1b2a'); R(x0 + S(11), base - S(7), 1, 1, '#1d1b2a'); R(x0 + S(10), base - S(6), 1, 1, '#ff9ab0');
    const rabo = q % 2 ? -1 : 0;
    R(x0, base - S(7) + rabo, 1, S(3), c); R(x0 + 1, base - S(5), S(2), 1, c);
    return;
  }
  // robô de limpeza: disco com cúpula e luz piscando
  const c = ap.cor, cs = tom(c, -0.3), luz = ap.detalhe ?? '#3ee0ff';
  R(x0 + S(1), base + 1, S(11), 1, 'rgba(6,8,20,0.3)');
  R(x0 + S(1), base - S(3), S(11), S(3), c); R(x0, base - S(2), S(13), S(2), c); R(x0, base - 1, S(13), 1, cs);
  R(x0 + S(4), base - S(6), S(5), S(3), tom(c, 0.15)); R(x0 + S(5), base - S(7), S(3), 1, tom(c, 0.3));
  R(x0 + S(6), base - S(5), 1, 1, q % 2 ? luz : tom(luz, -0.5));
  R(x0 + S(2), base - S(2), S(9), 1, '#3a3f50');
  if (pose === 'andar' && q % 2) { R(x0 - 1, base - 1, 2, 1, '#9fe3ff'); R(x0 + S(12), base - 1, 2, 1, '#9fe3ff'); }
}

/** Quadro de pose para o instante (a piscada dos humanos e a antena dos androides usam o quadro 1 de vez em quando). */
export function quadroPose(pose: Pose, t: number, andando: boolean): number {
  if (andando) return Math.floor(t * (pose === 'correr' ? 10 : 9)) % 4;
  switch (pose) {
    case 'parado': return (t % 3.2) > 3.02 ? 1 : 0;
    case 'digitando': case 'operando': case 'jogar': return Math.floor(t * 6) % 2;
    case 'levantar': case 'pose': return Math.floor(t * 1.2) % 2;
    case 'correr': return Math.floor(t * 10) % 4;
    case 'acenar': return Math.floor(t * 4) % 2;
    case 'dormir': return Math.floor(t * 0.8) % 2;
    default: return 0;
  }
}
