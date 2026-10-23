// Passe à mão: cabeças desenhadas pixel a pixel para os androides principais.
// Cada mapa é uma lista de linhas; cada letra é uma cor da paleta e '.' é transparente.
// Cores que começam com '$' vêm da aparência (papel, casco, visor), então o mesmo desenho
// serve para androides de cores diferentes. O visor fica na mesma posição do procedural,
// porque os olhos de LED são uma camada à parte por cima.
// Âncoras: 16 por 32, cabeça em (2, 0), 12 colunas; 24 por 40, cabeça em (2, 0), 20 colunas.
// Os humanos pessoais têm os mapas no pacote local; os genéricos, em config/personagens.exemplo.json.
import type { MapaMao } from '../cena/formato.ts';

const CASCO = { o: '#14182a', c: '$casco', C: '$cascoS', L: '$cascoL', v: '$visor', V: '#3a4766', g: '#566a9a', p: '$papel', P: '$papelL', q: '$papelS', a: '#8a93ad' };

/* ---------- 16 por 32 ---------- */
const BASE16 = [
  '.....oPo....',
  '......a.....',
  '...oooaooo..',
  '..oLLLLLLco.',
  '.oLLLccccCo.',
  '.oLccccccCo.',
  '.ovggvvvvvo.',
  'povvvvvvvvop',
  'PovvvvvvvvoP',
  'povvvvvvvvop',
  '.ovvvvvvvvo.',
  '.oCccccccCo.',
  '..oCCCCCCo..',
  '...oooooo...',
];
const BASE16_COSTAS = [
  '.....oPo....',
  '......a.....',
  '...oooaooo..',
  '..oLLLLLLco.',
  '.oLLcccccCo.',
  '.oLccccccCo.',
  '.oCCCCCCCCo.',
  'poccccccccop',
  'PoCCCCCCCCoP',
  'poccccccccop',
  '.oCCCCCCCCo.',
  '.occqqqqcCo.',
  '..oCCCCCCo..',
  '...oooooo...',
];
const BOINA16_TOPO = [
  '.....mmY....',
  '...mmMMmmm..',
  '..mmmmmmmmmm',
  '..onnnnnnno.',
];
const FONE16 = [
  '............',
  '..hhhhhhhh..',
  '.h.ooooooo.h',
  '.hoLLLLLLcoh',
  '.oLLLccccCo.',
  'hHLccccccCHh',
  'hHvggvvvvvHh',
  'hHvvvvvvvvHh',
  'hHvvvvvvvvHh',
  'hHvvvvvvvvHh',
  'hhvvvvvvvvhh',
  '.oCccccccCo.',
  '..oCCCCCCo..',
  '...oooooo...',
];

/* ---------- 24 por 40 ---------- */
const BASE24 = [
  '........oPPo........',
  '.........aa.........',
  '.........aa.........',
  '.....ooooooooooo....',
  '...ooLLLLLLLcccoo...',
  '..oLLLLccccccccCCo..',
  '..oLccccccccccccCo..',
  '..oLCCCCCCCCCCCCCo..',
  '.poCvVVvvvvvvvvvCop.',
  'qpoCvVvvvvvvvvvvCopq',
  'qPoCvvvvvvvvvvvvCoPq',
  'qpoCvvvvvvvvvvvvCopq',
  '.poCvvvvvvvvvvvvCop.',
  '..oCvvvvvvvvvvvvCo..',
  '..oCvvvvvvvvvvvgCo..',
  '..oCCCCCCCCCCCCCCo..',
  '...oCCCCqqqqCCCCo...',
  '.....oooooooooo.....',
];
const BASE24_COSTAS = [
  '........oPPo........',
  '.........aa.........',
  '.........aa.........',
  '.....ooooooooooo....',
  '...ooLLLLLLLcccoo...',
  '..oLLLLccccccccCCo..',
  '..oLccccccccccccCo..',
  '..oLCCCCCCCCCCCCCo..',
  '.poLccccccccccccCop.',
  'qpoLCCCCCCCCCCCCCopq',
  'qPoLccccccccccccCoPq',
  'qpoLCCCCCCCCCCCCCopq',
  '.poLccccccccccccCop.',
  '..oLCCCCCCCCCCCCCo..',
  '..oCccccqqqqccccCo..',
  '..oCCCCCCCCCCCCCCo..',
  '...oCCCCCCCCCCCCo...',
  '.....oooooooooo.....',
];
const BOINA24_TOPO = [
  '..........mY........',
  '.......mmmMMmm......',
  '.....mmMMMMmmmmm....',
  '....mmmmmmmmmmmmmm..',
  '...onnnnnnnnnnnnoo..',
];
const FONE24_TOPO = [
  '....................',
  '.......hhhhhh.......',
  '.....hhHHHHHHhh.....',
  '....hh.ooooooo.hh...',
  '...hooLLLLLLLcccooh.',
  '.hoLLLLccccccccCCoh.',
  '.hoLccccccccccccCoh.',
  'hHoLCCCCCCCCCCCCCoHh',
  'hHoCvVVvvvvvvvvvCoHh',
  'hHoCvVvvvvvvvvvvCoHh',
  'hHoCvvvvvvvvvvvvCoHh',
  'hHoCvvvvvvvvvvvvCoHh',
  'hHoCvvvvvvvvvvvvCoHh',
  'hhoCvvvvvvvvvvvvCohh',
];
const CODEX24_TOPO = [
  '........oPPo........',
  '.........aa.........',
  '.........aa.........',
  '..oooooooooooooooo..',
  '..oLLLLLLLLLLLccCo..',
  '..oLccccccccccccCo..',
  '..oLqqqqqqqqqqqqCo..',
  '..oLCCCCCCCCCCCCCo..',
];
const CODEX24_BASE = [
  '..oCCCCCCCCCCCCCCo..',
  '..oCCCCqqqqCCCCCCo..',
  '..oooooooooooooooo..',
];

const boina = { m: '#c2185b', M: '#e0337a', n: '#8a1040', Y: '#ffd35c' };
const fone = { h: '#2a2e40', H: '#6a7290' };

export const MAO_ANDROIDES: Record<string, Partial<Record<16 | 24, MapaMao>>> = {
  coordenador: {
    16: { paleta: CASCO, cabeca: BASE16, cabecaCostas: BASE16_COSTAS },
    24: { paleta: CASCO, cabeca: BASE24, cabecaCostas: BASE24_COSTAS },
  },
  claude: {
    16: { paleta: CASCO, cabeca: BASE16, cabecaCostas: BASE16_COSTAS },
    24: { paleta: CASCO, cabeca: BASE24, cabecaCostas: BASE24_COSTAS },
  },
  design: {
    16: { paleta: { ...CASCO, ...boina }, cabeca: [...BOINA16_TOPO, ...BASE16.slice(4)], cabecaCostas: [...BOINA16_TOPO, ...BASE16_COSTAS.slice(4)] },
    24: { paleta: { ...CASCO, ...boina }, cabeca: [...BOINA24_TOPO, ...BASE24.slice(5)], cabecaCostas: [...BOINA24_TOPO, ...BASE24_COSTAS.slice(5)] },
  },
  dev: {
    16: { paleta: { ...CASCO, ...fone }, cabeca: FONE16, cabecaCostas: [...FONE16.slice(0, 6), ...BASE16_COSTAS.slice(6).map((l, k) => (k < 5 ? 'hH' + l.slice(2, 10) + 'Hh' : l))] },
    24: { paleta: { ...CASCO, ...fone }, cabeca: [...FONE24_TOPO, ...BASE24.slice(14)], cabecaCostas: [...FONE24_TOPO.slice(0, 7), ...BASE24_COSTAS.slice(7, 14).map((l) => 'hH' + l.slice(2, 18) + 'Hh'), ...BASE24_COSTAS.slice(14)] },
  },
  codex: {
    16: { paleta: CASCO, cabeca: BASE16, cabecaCostas: BASE16_COSTAS },
    24: { paleta: CASCO, cabeca: [...CODEX24_TOPO, ...BASE24.slice(8, 15), ...CODEX24_BASE], cabecaCostas: [...CODEX24_TOPO, ...BASE24_COSTAS.slice(8, 15), ...CODEX24_BASE] },
  },
};
