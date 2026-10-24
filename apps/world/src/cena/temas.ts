// Temas de zona: cada um mobilia o retângulo da zona e devolve os postos de trabalho e os
// pontos de interesse. As coordenadas daqui são relativas ao canto (i0, j0) da zona e foram
// tiradas da prancha aprovada (um lote padrão tem 10 por 11 ladrilhos). Em densidade "cheio"
// os temas acrescentam mobília, letreiros e figurantes.
import type { DecoParede, EstiloPiso, Objeto, Pose, Spot, Tapete, Tema, ValorProp, PersonagemPlanta } from './formato.ts';

export interface RetZona { i0: number; i1: number; j0: number; j1: number }
export interface OpcoesTema {
  cheio: boolean;
  quente: boolean;
  extras: Record<string, ValorProp>;
  salas: string[];
  /** A zona encosta na parede do fundo J (j0 = 0) ou I (i0 = 0). */
  paredeJ: boolean;
  paredeI: boolean;
}
export interface Posto { casa: [number, number]; pose: Pose; mesa?: number; costas?: boolean; papel?: 'coordenador' }
export interface ResultadoTema {
  objetos: Objeto[];
  postos: Posto[];
  piso: EstiloPiso;
  parede?: string;
  treinos?: Spot[];
  pausas?: Spot[];
  nucleo?: [number, number];
  teletransporte?: [number, number];
  recepcao?: [number, number];
  fila?: [number, number][];
  terreno?: { i: number; j: number; w: number; d: number };
  tapetes?: Tapete[];
  decoracoes?: DecoParede[];
  figurantes?: Figurante[];
  passeio?: [number, number][];
  salas?: { nome: string; i: number; j: number }[];
  /** Lugares preferidos das cápsulas de recarga dos bots (em ordem); sem eles, o gerador procura. */
  recargas?: [number, number][];
  /** Terrenos de 2 por 2 para as cápsulas das salas (em ordem); sem eles, o gerador procura. */
  vagas?: [number, number][];
}

export type Figurante = Omit<PersonagemPlanta, 'zona'> & { casa?: [number, number] };
type Fab = (z: RetZona, o: OpcoesTema) => ResultadoTema;

function montador(z: RetZona) {
  const objetos: Objeto[] = [];
  const poe = (tipo: string, di: number, dj: number, props?: Record<string, ValorProp>): number => {
    objetos.push(props ? { tipo, i: z.i0 + di, j: z.j0 + dj, props } : { tipo, i: z.i0 + di, j: z.j0 + dj });
    return objetos.length - 1;
  };
  const p = (di: number, dj: number): [number, number] => [z.i0 + di, z.j0 + dj];
  const tap = (a: number, b: number, c: number, d: number, cor: string, borda?: string, listras?: string): Tapete => ({ i0: z.i0 + a, j0: z.j0 + b, i1: z.i0 + c, j1: z.j0 + d, cor, borda, listras });
  const u = (di: number) => (z.i0 + di) * 16;
  return { objetos, poe, p, tap, u };
}

const servidores: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  for (let i = 1; i <= 8; i++) poe('rack', i, 1);
  for (let j = 3; j <= 9; j++) poe('rack', 1, j);
  for (let i = 4; i <= 8; i++) poe('rack', i, 5);
  poe('resfriador', 6, 8);
  if (o.cheio) {
    poe('resfriador', 3, 8);
    poe('painelEnergia', 9, 3);
    poe('caixas', 9, 8);
    poe('terminal', 4, 7);
  }
  return { objetos, postos: [], piso: 'servidor', parede: '#242a40', passeio: [p(3, 3), p(6, 3), p(5, 7)] };
};

const equipe: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  poe('mural', 1, 1, { colunas: (o.extras.colunas as string[] | undefined) ?? ['G0', 'G1', 'G2', 'G3', 'G4'] });
  poe('vitrine', 7, 1, { forma: (o.extras.vitrine as string | undefined) ?? 'carro' });
  const m1 = poe('mesa', 1, 5), m2 = poe('mesa', 4, 5), m3 = poe('mesa', 1, 8), m4 = poe('mesa', 4, 8);
  const con = poe('console', 7, 5, { colunas: (o.extras.colunas as string[] | undefined) ?? ['G0', 'G1', 'G2', 'G3', 'G4'] });
  poe('cadeira', 1, 4); poe('cadeira', 4, 4); poe('cadeira', 1, 7); poe('cadeira', 4, 7);
  poe('planta', 0, 10); poe('planta', 9, 9, { s: 1.2 }); poe('estante', 7, 9); poe('impressora', 9, 4);
  if (o.cheio) {
    poe('cafeteira', 9, 6);
    poe('planta', 0, 3, { s: 0.8 });
    poe('quadro', 7, 7, { estilo: 'kanban' });
  }
  const postos: Posto[] = [
    { casa: p(7, 4), pose: 'operando', mesa: con, papel: 'coordenador' },
    { casa: p(1, 4), pose: 'digitando', mesa: m1 },
    { casa: p(4, 4), pose: 'digitando', mesa: m2 },
    { casa: p(1, 7), pose: 'digitando', mesa: m3 },
    { casa: p(4, 7), pose: 'digitando', mesa: m4 },
  ];
  const decoracoes: DecoParede[] = o.cheio && o.paredeJ ? [{ parede: 'J', tipo: 'poster', u0: (z.i0 + 5.2) * 16, u1: (z.i0 + 6.6) * 16, cor: '#ff6b5a' }] : [];
  // cápsulas de recarga em fila na borda esquerda, ao lado das mesas
  const recargas: [number, number][] = [p(0, 4), p(0, 5), p(0, 6), p(0, 7), p(0, 8), p(0, 9)];
  return { objetos, postos, piso: 'madeira', parede: '#3a3452', decoracoes, passeio: [p(3, 3), p(6, 7)], recargas };
};

const agencia: Fab = (z, o) => {
  const { objetos, poe, p, u } = montador(z);
  const m1 = poe('mesa', 2, 5), m2 = poe('mesa', 5, 5);
  poe('cadeira', 2, 4); poe('cadeira', 5, 4);
  poe('quadro', 7, 8); poe('rack', 9, 2); poe('planta', 0, 9); poe('planta', 9, 9, { vaso: '#4f8cff' });
  const postos: Posto[] = [{ casa: p(2, 4), pose: 'digitando', mesa: m1 }, { casa: p(5, 4), pose: 'digitando', mesa: m2 }];
  if (o.cheio) {
    const m3 = poe('mesa', 2, 8); poe('cadeira', 2, 7);
    postos.push({ casa: p(2, 7), pose: 'digitando', mesa: m3 });
    poe('impressora', 0, 5); poe('cafeteira', 9, 6);
  }
  const decoracoes: DecoParede[] = o.paredeJ ? [
    { parede: 'J', tipo: 'sites', u0: u(0.4), u1: u(2.4) }, { parede: 'J', tipo: 'sites', u0: u(2.6), u1: u(4.6) },
    { parede: 'J', tipo: 'sites', u0: u(4.8), u1: u(6.8) }, { parede: 'J', tipo: 'sites', u0: u(7), u1: u(9) },
  ] : [];
  return { objetos, postos, piso: 'azulejo', parede: '#2d3858', decoracoes, passeio: [p(4, 2), p(6, 7)] };
};

const estudio: Fab = (z, o) => {
  const { objetos, poe, p, u } = montador(z);
  poe('telaVerde', 1, 1); const cam = poe('camera', 3, 5); poe('ringlight', 5, 3); poe('refletor', 0, 3);
  const m = poe('mesa', 1, 8, { modo: 'linhatempo', neon: '#ffb347' }); poe('cadeira', 1, 7); poe('planta', 7, 9);
  if (o.cheio) { poe('refletor', 6, 6); poe('caixaSom', 7, 4); poe('caixaSom', 0, 6); poe('estante', 4, 9, { cor: '#2c2836' }); }
  const decoracoes: DecoParede[] = o.paredeJ ? [{ parede: 'J', tipo: 'xadrez', u0: z.i0 * 16, u1: (z.i1 + 1) * 16 }, { parede: 'J', tipo: 'onAir', u0: u(6.3) - 14, u1: u(6.3) + 14 }] : [];
  // a câmera grava quando o agente do posto 0 roda um comando (renderização)
  objetos[cam].props = { ...(objetos[cam].props ?? {}), postoCamera: 0 };
  return { objetos, postos: [{ casa: p(1, 7), pose: 'digitando', mesa: m }], piso: 'estudio', parede: '#2a2633', decoracoes, passeio: [p(4, 7)] };
};

const corporativo: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  const postos: Posto[] = [];
  for (const [i, j] of [[1, 1], [4, 1], [1, 5], [4, 5]] as const) {
    poe('cubiculo', i, j);
    const m = poe('mesa', i, j + 1, { cor: '#c9ced9', neon: '#a9b3d6' });
    poe('cadeira', i, j, { cor: '#4a5068' });
    postos.push({ casa: p(i, j), pose: 'digitando', mesa: m });
  }
  poe('bebedouro', 8, 1); poe('impressora', 8, 7); poe('planta', 9, 9); poe('planta', 7, 0);
  if (o.cheio) { poe('arquivo', 8, 4); poe('arquivo', 9, 4); poe('planta', 0, 9, { s: 0.8 }); poe('cafeteira', 9, 6); }
  return { objetos, postos, piso: 'carpete', parede: '#383d52', passeio: [p(7, 3), p(7, 8)] };
};

const nucleo: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  poe('nucleo', 3, 3); poe('doca', 0, 1); poe('terminal', 8, 1); poe('terminal', 0, 8); poe('terminal', 8, 8);
  if (o.cheio) { poe('holoPainel', 1, 4); poe('holoPainel', 8, 4); poe('planta', 9, 9, { s: 0.8 }); }
  return { objetos, postos: [], piso: 'nucleo', nucleo: p(5, 5), passeio: [p(2, 2), p(7, 7)] };
};

const academia: Fab = (z, o) => {
  const { objetos, poe, p, tap } = montador(z);
  poe('espelho', 1, 0); poe('palco', 1, 1); poe('refletor', 0, 1); poe('refletor', 4, 1);
  poe('halteres', 5, 0); poe('agachamento', 8, 0); poe('esteira', 1, 5); poe('esteira', 3, 5); poe('supino', 5, 4);
  const m = poe('mesa', 6, 7); poe('cadeira', 6, 6); poe('bebedouro', 9, 8); poe('planta', 0, 9);
  const treinos: Spot[] = [
    { t: p(5, 1), pose: 'levantar', txt: 'Série de bíceps' }, { t: p(6, 1), pose: 'levantar', txt: 'Treino de ombro' },
    { t: p(2, 2), pose: 'pose', txt: 'Pose: duplo bíceps', z: 5 }, { t: p(1, 6), pose: 'correr', txt: 'Cardio na esteira', z: 3 },
    { t: p(3, 6), pose: 'correr', txt: 'Cardio na esteira', z: 3 }, { t: p(8, 2), pose: 'levantar', txt: 'Agachamento livre' },
  ];
  const figurantes: Figurante[] = [];
  if (o.cheio) {
    poe('kettlebells', 7, 4); poe('bike', 0, 7); poe('bike', 1, 8); poe('sacoPancada', 9, 4); poe('colchonete', 3, 8);
    poe('placaNeon', 9, 6, { texto: 'FOCO', cor: '#ff4fd8' });
    treinos.push({ t: p(1, 8), pose: 'correr', txt: 'Bike ergométrica', z: 4 }, { t: p(8, 4), pose: 'levantar', txt: 'Kettlebell swing' });
    figurantes.push({ id: 'treinador', nome: 'Treinador', curto: 'Treinador', cargo: 'Androide da academia', tipo: 'npc', papel: 'figurante', aparencia: 'npcTreinador', tarefaInicial: 'Contando as séries', casa: p(4, 3) });
  }
  return { objetos, postos: [{ casa: p(6, 6), pose: 'digitando', mesa: m }], piso: 'academia', treinos, tapetes: [tap(8, 0, 10, 2, '#9a6a3c')], figurantes, passeio: [p(4, 3), p(7, 5)] };
};

const lounge: Fab = (z, o) => {
  const { objetos, poe, p, tap } = montador(z);
  poe('balcao', 1, 0); poe('vending', 4, 0); poe('arcade', 6, 0, { cor: '#4a2d8a' }); poe('arcade', 7, 0, { cor: '#2d6a8a' });
  poe('sofa', 1, 8, { cor: '#3a6f7a', almofada: '#ff8fd0' }); poe('puff', 2, 5, { cor: '#ff6fae' }); poe('puff', 4, 5, { cor: '#ffcf4d' });
  poe('luminaria', 6, 8); poe('planta', 0, 9); poe('planta', 7, 6, { s: 1.2 });
  const pausas: Spot[] = [
    { t: p(1, 1), pose: 'beber', txt: 'Pausa para o café' }, { t: p(2, 1), pose: 'beber', txt: 'Um espresso' },
    { t: p(3, 1), pose: 'beber', txt: 'Shake de whey' }, { t: p(6, 1), pose: 'jogar', txt: 'Uma partida no fliperama', costas: true },
    { t: p(7, 1), pose: 'jogar', txt: 'Recorde no fliperama', costas: true },
  ];
  const figurantes: Figurante[] = [];
  if (o.cheio) {
    poe('pinball', 7, 3); poe('tvGame', 5, 8); poe('puff', 3, 7, { cor: '#7dffa8' });
    poe('placaNeon', 0, 4, { texto: 'JOGOS', cor: '#3ee0ff' });
    pausas.push({ t: p(7, 4), pose: 'jogar', txt: 'Uma bola no pinball', costas: true }, { t: p(5, 7), pose: 'jogar', txt: 'Partida no videogame', costas: true });
    figurantes.push({ id: 'barista', nome: 'Barista', curto: 'Barista', cargo: 'Androide do café', tipo: 'npc', papel: 'figurante', aparencia: 'npcBarista', tarefaInicial: 'Tirando um espresso', casa: p(0, 0) });
  }
  return { objetos, postos: [], piso: 'lounge', pausas, tapetes: [tap(1, 5, 5, 9, '#2b6f73', '#3a8e8f')], figurantes, passeio: [p(5, 3), p(2, 3)] };
};

const recepcao: Fab = (z, o) => {
  const { objetos, poe, p, tap } = montador(z);
  poe('teleporte', 3, 3); poe('balcaoRecepcao', 6, 1); poe('sofa', 5, 8, { cor: '#6b5a8a' });
  poe('planta', 1, 1); poe('planta', 9, 9); poe('terminal', 8, 5);
  const figurantes: Figurante[] = [];
  if (o.cheio) {
    poe('totem', 1, 6); poe('planta', 0, 9, { s: 0.8 }); poe('banco', 7, 7);
    figurantes.push({ id: 'limpeza', nome: 'Robô de limpeza', curto: 'Limpeza', cargo: 'Mantém o andar brilhando', tipo: 'npc', papel: 'figurante', aparencia: 'npcLimpeza', tarefaInicial: 'Limpando o corredor', casa: p(2, 6) });
  }
  return {
    objetos, postos: [], piso: 'recepcao', parede: '#3a3a52',
    teletransporte: p(4, 4), recepcao: p(7, 0), fila: [p(6, 3), p(7, 3), p(8, 3), p(6, 4)],
    tapetes: [tap(3, 7, 6, 9, '#8c3b3b')], figurantes, passeio: [p(2, 7), p(8, 8)],
  };
};

const produtos: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  const lugares: [number, number][] = [[0, 1], [3, 1], [6, 1], [0, 5], [3, 5]];
  const salas = o.salas.slice(0, lugares.length).map((nome, k) => ({ nome, i: z.i0 + lugares[k][0], j: z.j0 + lugares[k][1] }));
  poe('planta', 9, 9); poe('planta', 0, 9);
  if (o.cheio) { poe('caixas', 9, 1); poe('impressora3d', 3, 9); poe('holoPainel', 9, 4); }
  // vagas das salas que chegarem depois (servidor): os lugares das cápsulas que sobraram e o terreno
  const vagas = [...lugares.slice(salas.length), [6, 5] as [number, number]].map(([a, b]) => p(a, b));
  return { objetos, postos: [], piso: 'produtos', salas, terreno: { i: z.i0 + 6, j: z.j0 + 5, w: 3, d: 3 }, passeio: [p(2, 4), p(5, 9)], vagas };
};

/** Lote sem ala (a configuração ainda não tem frente para ele): piso de depósito, caixas e plantas. */
const livre: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  poe('caixas', 1, 1); poe('caixas', 2, 1); poe('planta', 9, 9, { s: 0.8 });
  if (o.cheio) { poe('caixas', 1, 2); poe('luminaria', 0, 9); }
  return { objetos, postos: [], piso: 'deposito', parede: '#2a2e40', passeio: [p(5, 5)] };
};

const cockpit: Fab = (z, o) => {
  const { objetos, poe, p, tap } = montador(z);
  const mesaDono = poe('mesaComando', 6, 3); poe('cadeira', 7, 2, { corDe: 'dono' });
  const mesaFixo = poe('mesaNotebook', 10, 3); poe('cadeira', 10, 2, { cor: '#f0e6ea', detalhe: '#ff8fb8' });
  poe('haltereChao', 9, 3); poe('estante', 2, 1, { trofeus: true, cor: '#3a2a22' }); poe('aquario', 15, 1);
  poe('sofa', 11, 8, { cor: '#2d3a6a', almofada: '#f2b45a' }); poe('saco', 3, 6); poe('luminaria', 13, 2); poe('geladeira', 18, 3);
  poe('planta', 0, 9); poe('planta', 19, 9, { s: 1.2 }); poe('planta', 5, 9); poe('estante', 17, 7, { cor: '#4a3326' });
  if (o.cheio) {
    poe('tvGame', 16, 5); poe('cadeiraGamer', 15, 6); poe('posterJogo', 1, 4, { cor: '#ff6b5a' }); poe('posterJogo', 1, 7, { cor: '#4f8cff' });
    poe('planta', 9, 8, { s: 0.8 }); poe('kettlebells', 4, 3);
  }
  const figurantes: Figurante[] = o.cheio
    ? [{ id: 'gato', nome: 'Gato', curto: 'Gato', cargo: 'Mascote do Cockpit', tipo: 'npc', papel: 'figurante', aparencia: 'gato', tarefaInicial: 'Cochilando no tapete', casa: p(8, 4) }]
    : [];
  return {
    objetos, piso: 'cockpit',
    postos: [{ casa: p(7, 2), pose: 'digitando', mesa: mesaDono }, { casa: p(10, 2), pose: 'digitando', mesa: mesaFixo }],
    tapetes: [tap(5, 1, 13, 6, '#5a1f2c', '#7a2a3a', '#8f3a49')], figurantes, passeio: [p(8, 7), p(14, 4)],
  };
};

const laboratorio: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  poe('mesaHolo', 3, 3);
  const m1 = poe('mesa', 1, 7, { neon: '#3ee0ff' }), m2 = poe('mesa', 5, 7, { neon: '#3ee0ff' });
  poe('cadeira', 1, 6); poe('cadeira', 5, 6); poe('rack', 9, 1); poe('rack', 9, 2); poe('planta', 0, 0); poe('quadro', 7, 9);
  if (o.cheio) {
    poe('holoPainel', 8, 5); poe('impressora3d', 0, 3);
    // o andar cheio chega à linha de baixo: mais racks, bancada e a placa do laboratório
    poe('rack', 9, 3); poe('terminal', 9, 4); poe('arquivo', 0, 5); poe('impressora', 8, 7); poe('caixas', 9, 9);
    poe('cafeteira', 9, 6); poe('planta', 6, 0, { s: 0.8 }); poe('placaNeon', 0, 1, { texto: 'LAB', cor: '#3ee0ff' });
  }
  return { objetos, postos: [{ casa: p(1, 6), pose: 'digitando', mesa: m1 }, { casa: p(5, 6), pose: 'digitando', mesa: m2 }], piso: 'laboratorio', parede: '#24324a', passeio: [p(7, 4)] };
};

const pessoal: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  const m1 = poe('mesa', 2, 4, { neon: '#9fe3ff', caneca: '#f2b45a' }); poe('cadeira', 2, 3);
  const m2 = poe('mesa', 6, 4, { neon: '#9fe3ff' }); poe('cadeira', 6, 3);
  poe('estante', 0, 8); poe('sofa', 5, 8, { cor: '#4a5a8a' }); poe('planta', 9, 9); poe('quadro', 8, 1, { estilo: 'mural' });
  if (o.cheio) {
    poe('posterJogo', 0, 2, { cor: '#c9a7ff' }); poe('luminaria', 9, 6);
    // canto de jogo, halteres, som e a placa de casa
    poe('tvGame', 9, 7); poe('cadeiraGamer', 8, 7); poe('kettlebells', 0, 5); poe('puff', 4, 9, { cor: '#c9a7ff' });
    poe('caixaSom', 8, 9); poe('planta', 0, 0, { s: 0.9 }); poe('placaNeon', 9, 3, { texto: 'CASA', cor: '#9fe3ff' });
  }
  return { objetos, postos: [{ casa: p(2, 3), pose: 'digitando', mesa: m1 }, { casa: p(6, 3), pose: 'digitando', mesa: m2 }], piso: 'madeira', parede: '#2f3a52', passeio: [p(4, 6)] };
};

const bastidores: Fab = (z, o) => {
  const { objetos, poe, p } = montador(z);
  poe('caixas', 0, 1); poe('caixas', 1, 1); poe('estante', 3, 1, { cor: '#4a4f62' }); poe('rack', 8, 1); poe('rack', 9, 1);
  const m = poe('mesa', 3, 6, { cor: '#b7bcc8', neon: '#6fd3ff' }); poe('cadeira', 3, 5); poe('terminal', 8, 6);
  if (o.cheio) {
    poe('caixas', 0, 4); poe('painelEnergia', 9, 4); poe('arquivo', 6, 1);
    poe('caixas', 1, 4); poe('refletor', 0, 8); poe('caixaSom', 1, 9); poe('planta', 9, 9, { s: 0.8 });
    // zona de duas colunas: o depósito continua na metade da direita, que ficava vazia
    if (z.i1 - z.i0 >= 15) {
      for (const i of [12, 13, 14]) poe('rack', i, 1);
      poe('estante', 16, 1, { cor: '#4a4f62' }); poe('caixas', 11, 4); poe('caixas', 11, 5); poe('caixas', 12, 4);
      poe('terminal', 15, 4); poe('painelEnergia', 17, 4); poe('banco', 14, 7); poe('luminaria', 17, 8);
      poe('impressora3d', 11, 8); poe('refletor', 13, 6); poe('caixaSom', 12, 6); poe('planta', 17, 9);
    }
  }
  return { objetos, postos: [{ casa: p(3, 5), pose: 'digitando', mesa: m }], piso: 'deposito', parede: '#30344a', passeio: [p(6, 8)] };
};

export const TEMAS: Record<Tema, Fab> = {
  servidores, equipe, agencia, estudio, corporativo, nucleo, academia, lounge, recepcao, produtos, cockpit, laboratorio, pessoal, bastidores, livre,
};
