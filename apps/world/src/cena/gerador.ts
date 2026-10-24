// Gerador de cena: expande uma Planta (lotes, alas com tema, personagens e textos) numa
// CenaDados completa (zonas, objetos, pontos, janelas, letreiros e linhas de dados).
// Determinístico: a mesma planta com as mesmas opções gera sempre a mesma cena.
import type {
  Aparencia, CenaDados, DecoParede, Janela, Letreiro, Linha, Objeto, Personagem, Planta, PostoCena, Sala, Spot, Tapete, Tema, Zona,
} from './formato.ts';
import { TEMAS, type Posto } from './temas.ts';
import { tom } from '../arte/cor.ts';

export interface OpcoesGerador {
  densidade: 'prancha' | 'cheio';
  paleta: 'fria' | 'quente';
}

/** Tamanho em ladrilhos (w, d) e se bloqueia a passagem: o gerador e a rota precisam saber. */
export const PEGADA: Record<string, { w: number; d: number; bloqueia?: boolean }> = {
  mesa: { w: 2, d: 1 }, cadeira: { w: 1, d: 1, bloqueia: false }, console: { w: 2, d: 1 }, rack: { w: 1, d: 1 },
  resfriador: { w: 2, d: 1 }, planta: { w: 1, d: 1 }, estante: { w: 2, d: 1 }, sofa: { w: 3, d: 1 }, puff: { w: 1, d: 1 },
  balcao: { w: 3, d: 1 }, vending: { w: 1, d: 1 }, arcade: { w: 1, d: 1 }, halteres: { w: 2, d: 1 }, supino: { w: 2, d: 1 },
  agachamento: { w: 2, d: 2 }, esteira: { w: 1, d: 2, bloqueia: false }, palco: { w: 3, d: 2, bloqueia: false },
  espelho: { w: 3, d: 1 }, refletor: { w: 1, d: 1 }, telaVerde: { w: 4, d: 1 }, camera: { w: 1, d: 1 }, ringlight: { w: 1, d: 1 },
  nucleo: { w: 4, d: 4 }, doca: { w: 2, d: 1, bloqueia: false }, terminal: { w: 1, d: 1 }, teleporte: { w: 2, d: 2, bloqueia: false },
  balcaoRecepcao: { w: 3, d: 1 }, cubiculo: { w: 2, d: 2, bloqueia: false }, aquario: { w: 2, d: 1 }, mesaComando: { w: 3, d: 1 },
  mesaNotebook: { w: 2, d: 1 }, luminaria: { w: 1, d: 1 }, pod: { w: 2, d: 2 }, saco: { w: 1, d: 1 }, bebedouro: { w: 1, d: 1 },
  impressora: { w: 1, d: 1 }, quadro: { w: 2, d: 1 }, geladeira: { w: 1, d: 1 }, haltereChao: { w: 1, d: 1, bloqueia: false },
  vitrine: { w: 2, d: 2 }, mural: { w: 4, d: 1, bloqueia: false }, lampiao: { w: 1, d: 1, bloqueia: false },
  painelEnergia: { w: 1, d: 1 }, caixas: { w: 1, d: 1 }, cafeteira: { w: 1, d: 1 }, caixaSom: { w: 1, d: 1 }, arquivo: { w: 1, d: 1 },
  holoPainel: { w: 1, d: 1 }, kettlebells: { w: 1, d: 1 }, bike: { w: 1, d: 1, bloqueia: false }, sacoPancada: { w: 1, d: 1 },
  colchonete: { w: 2, d: 1, bloqueia: false }, placaNeon: { w: 1, d: 1 }, pinball: { w: 1, d: 1 }, tvGame: { w: 1, d: 1 },
  totem: { w: 1, d: 1 }, banco: { w: 2, d: 1 }, impressora3d: { w: 1, d: 1 }, cadeiraGamer: { w: 1, d: 1, bloqueia: false },
  posterJogo: { w: 1, d: 1 }, mesaHolo: { w: 3, d: 3 }, recarga: { w: 1, d: 1 },
};

/** Tempos de ócio padrão, os mesmos do servidor (mundo.ocio). */
export const OCIO_PADRAO = { pausaMinutos: 3, dormeMinutos: 20 };

const TEMAS_COM_JANELA: ReadonlySet<Tema> = new Set<Tema>(['equipe', 'corporativo', 'recepcao', 'pessoal', 'laboratorio', 'lounge', 'cockpit', 'produtos']);

export function gerarCena(planta: Planta, op: OpcoesGerador): CenaDados {
  const corr = planta.corredor;
  const colI: number[] = [], linJ: number[] = [];
  { let a = 0; for (const w of planta.colunas) { colI.push(a); a += w + corr; } }
  { let a = 0; for (const h of planta.linhas) { linJ.push(a); a += h + corr; } }
  const ni = colI[colI.length - 1] + planta.colunas[planta.colunas.length - 1];
  const nj = linJ[linJ.length - 1] + planta.linhas[planta.linhas.length - 1];

  const zonas: Zona[] = [];
  const objetos: Objeto[] = [];
  const salas: Sala[] = [];
  const tapetes: Tapete[] = [];
  const decoracoes: DecoParede[] = [];
  const postosPorZona = new Map<string, { posto: Posto; global?: number; ocupado: boolean }[]>();
  const recargasPorZona = new Map<string, [number, number][]>();
  const vagasDoTema = new Map<string, [number, number][]>();
  const pontos: CenaDados['pontos'] = { nucleo: [0, 0], teletransporte: [0, 0], recepcao: [0, 0], fila: [], treinos: [], pausas: [], passeio: [] };
  const figurantes: Personagem[] = [];
  let temNucleo = false, temTele = false, temRecepcao = false;

  for (const lote of planta.lotes) {
    const cols = lote.cols ?? 1, lins = lote.lins ?? 1;
    const i0 = colI[lote.col], j0 = linJ[lote.lin];
    const i1 = colI[lote.col + cols - 1] + planta.colunas[lote.col + cols - 1] - 1;
    const j1 = linJ[lote.lin + lins - 1] + planta.linhas[lote.lin + lins - 1] - 1;
    const fab = TEMAS[lote.tema];
    const r = fab({ i0, i1, j0, j1 }, {
      cheio: op.densidade === 'cheio', quente: op.paleta === 'quente', extras: lote.extras ?? {}, salas: lote.salas ?? [],
      paredeJ: j0 === 0, paredeI: i0 === 0,
    });
    const z: Zona = {
      id: lote.zona, nome: lote.nome, titulo: lote.titulo ?? lote.nome, texto: lote.texto ?? '', tipo: lote.tipo, tema: lote.tema,
      i0, i1, j0, j1, cor: lote.cor, piso: lote.piso ?? r.piso, parede: r.parede, placa: i0 > 0 && j0 > 0,
    };
    zonas.push(z);
    // objetos do tema que cabem na zona
    const mapa = new Map<number, number>();
    r.objetos.forEach((o, k) => {
      const pg = PEGADA[o.tipo] ?? { w: 1, d: 1 };
      if (o.i < i0 || o.j < j0 || o.i + pg.w - 1 > i1 || o.j + pg.d - 1 > j1) return;
      if (o.tipo === 'mural' && !(o.props && 'cor' in o.props)) o.props = { ...(o.props ?? {}), cor: lote.cor };
      mapa.set(k, objetos.length);
      objetos.push(o);
    });
    // salas: toda ala tem a sala principal (o retângulo da zona) e, no tema de produtos, as
    // cápsulas de cada produto; áreas comuns (Núcleo, lounge, recepção, Cockpit) não dormem
    const dormindo = lote.tipo === 'ala' && lote.dormindo === true;
    const ultimaAtividade = lote.ultimaAtividade ?? 0;
    if (lote.tipo === 'ala') salas.push({ id: z.id, nome: z.titulo, zona: z.id, i: i0, j: j0, w: i1 - i0 + 1, d: j1 - j0 + 1, estilo: 'sala', dormindo, ultimaAtividade });
    for (const s of r.salas ?? []) {
      const id = `${z.id}-${s.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      salas.push({ id, nome: s.nome, zona: z.id, i: s.i, j: s.j, w: 2, d: 2, estilo: 'pod', dormindo, ultimaAtividade });
      objetos.push({ tipo: 'pod', i: s.i, j: s.j, props: { nome: s.nome, sala: id } });
    }
    if (r.recargas) recargasPorZona.set(z.id, r.recargas);
    if (r.vagas) vagasDoTema.set(z.id, r.vagas);
    postosPorZona.set(z.id, r.postos.map((posto) => ({ posto, global: posto.mesa !== undefined ? mapa.get(posto.mesa) : undefined, ocupado: false })));
    if (r.nucleo) { pontos.nucleo = r.nucleo; temNucleo = true; }
    if (r.teletransporte) { pontos.teletransporte = r.teletransporte; temTele = true; }
    if (r.recepcao) { pontos.recepcao = r.recepcao; temRecepcao = true; }
    if (r.fila) pontos.fila.push(...r.fila);
    if (r.terreno && !pontos.terreno) pontos.terreno = { ...r.terreno, zona: z.id };
    if (r.treinos) pontos.treinos.push(...r.treinos);
    if (r.pausas) pontos.pausas.push(...r.pausas);
    if (r.passeio) pontos.passeio.push(...r.passeio);
    if (r.tapetes) tapetes.push(...r.tapetes);
    if (r.decoracoes) decoracoes.push(...r.decoracoes);
    for (const f of r.figurantes ?? []) {
      const { casa: casaF, ...resto } = f;
      const casa = casaF ?? r.passeio?.[0] ?? [Math.floor((i0 + i1) / 2), Math.floor((j0 + j1) / 2)];
      figurantes.push({ ...resto, zona: z.id, casa, poseCasa: 'parado' });
    }
  }
  const zonaPorId = new Map(zonas.map((z) => [z.id, z]));

  /* ---------- personagens: cada um ganha um posto na sua zona ---------- */
  const personagens: Personagem[] = [];
  for (const pp of planta.personagens) {
    const z = zonaPorId.get(pp.zona);
    if (!z) continue;
    const lista = postosPorZona.get(z.id) ?? [];
    let escolhido: { posto: Posto; global?: number; ocupado: boolean } | undefined;
    if (pp.papel === 'dono') escolhido = lista[0];
    else if (pp.papel === 'fixo') escolhido = lista[1];
    else if (pp.papel === 'coordenador') escolhido = lista.find((x) => x.posto.papel === 'coordenador' && !x.ocupado);
    else if (pp.posto !== undefined) escolhido = lista[pp.posto];
    if (!escolhido && pp.papel !== 'visitante' && pp.papel !== 'recepcionista') escolhido = lista.find((x) => !x.ocupado && x.posto.papel !== 'coordenador') ?? lista.find((x) => !x.ocupado);
    let casa: [number, number];
    let poseCasa = escolhido?.posto.pose ?? 'parado';
    let mesa: number | undefined;
    if (pp.papel === 'visitante') { casa = [pontos.teletransporte[0], pontos.teletransporte[1]]; poseCasa = 'parado'; escolhido = undefined; }
    else if (pp.papel === 'recepcionista') { casa = [pontos.recepcao[0], pontos.recepcao[1]]; poseCasa = 'parado'; escolhido = undefined; }
    else if (escolhido) { escolhido.ocupado = true; casa = escolhido.posto.casa; mesa = escolhido.global; }
    else casa = [Math.floor((z.i0 + z.i1) / 2), Math.floor((z.j0 + z.j1) / 2)];
    const tipoAgente = pp.tipo !== 'agente' ? undefined : pp.tipoAgente ?? (pp.papel === 'visitante' ? 'sessao' : pp.equipe || pp.papel === 'coordenador' ? 'bot' : 'sessao');
    const p: Personagem = {
      id: pp.id, nome: pp.nome, curto: pp.curto, cargo: pp.cargo, tipo: pp.tipo, papel: pp.papel, aparencia: pp.aparencia,
      zona: z.id, casa, poseCasa, mesa, equipe: pp.equipe, motor: pp.motor, tarefas: pp.tarefas, tarefaInicial: pp.tarefaInicial,
      visivel: pp.visivel, falas: pp.falas, tipoAgente, dormindo: pp.dormindo,
    };
    personagens.push(p);
    if (mesa !== undefined) ligarMesa(objetos[mesa], p, planta.aparencias[pp.aparencia]);
    // cadeira do posto na cor do personagem
    const cadeira = objetos.find((o) => o.tipo === 'cadeira' && o.i === casa[0] && o.j === casa[1]);
    if (cadeira && !(cadeira.props && 'cor' in cadeira.props)) {
      const ap = planta.aparencias[pp.aparencia];
      const base = ap?.tipo === 'androide' ? tom(ap.papel, -0.3) : ap?.tipo === 'humano' ? ap.roupa : '#3a3f5c';
      cadeira.props = { ...(cadeira.props ?? {}), cor: base, detalhe: ap?.tipo === 'humano' ? (ap.detalhe ?? tom(base, 0.5)) : tom(base, 0.35) };
    }
  }
  personagens.push(...figurantes);

  /* ---------- cápsulas de recarga: cada bot ganha uma na própria ala ---------- */
  const ocupado = new Set<string>();
  const marcar = (i: number, j: number, w = 1, d = 1) => { for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) ocupado.add(`${i + a},${j + b}`); };
  for (const o of objetos) { const pg = PEGADA[o.tipo] ?? { w: 1, d: 1 }; marcar(o.i, o.j, pg.w, pg.d); }
  for (const p of personagens) marcar(p.casa[0], p.casa[1]);
  for (const s of [...pontos.treinos, ...pontos.pausas]) marcar(s.t[0], s.t[1]);
  for (const f of pontos.fila) marcar(f[0], f[1]);
  // sem recepção no andar (a sonda de um lote só, por exemplo), os pontos dela ficam em (0, 0) e não ocupam nada
  if (temTele) marcar(pontos.teletransporte[0] - 1, pontos.teletransporte[1] - 1, 2, 2);
  for (const p of personagens) {
    if (p.tipoAgente !== 'bot') continue;
    const z = zonaPorId.get(p.zona)!;
    const livre = (i: number, j: number) => i >= z.i0 && i <= z.i1 && j >= z.j0 && j <= z.j1 && !ocupado.has(`${i},${j}`);
    // primeiro os lugares do tema; depois a borda esquerda, a borda do fundo e o resto da zona,
    // sempre com um vizinho livre para o bot entrar
    const cands: [number, number][] = [...(recargasPorZona.get(z.id) ?? [])];
    for (let j = z.j0 + 2; j < z.j1; j++) cands.push([z.i0, j]);
    for (let i = z.i0 + 2; i < z.i1; i++) cands.push([i, z.j0]);
    for (let j = z.j0 + 1; j < z.j1; j++) for (let i = z.i0 + 1; i < z.i1; i++) cands.push([i, j]);
    const lugar = cands.find(([i, j]) => livre(i, j) && (livre(i + 1, j) || livre(i, j + 1)));
    if (!lugar) continue;
    p.recarga = lugar;
    marcar(lugar[0], lugar[1]);
    const ap = planta.aparencias[p.aparencia];
    objetos.push({ tipo: 'recarga', i: lugar[0], j: lugar[1], props: { dono: p.id, cor: ap?.tipo === 'androide' ? ap.papel : '#3ee0ff' } });
  }

  /* ---------- vagas para quem nasce depois (os dados do servidor) ---------- */
  const { postos, vagasPod, vagasRecarga } = vagasDasZonas(zonas, postosPorZona, personagens, recargasPorZona, vagasDoTema, ocupado, marcar, pontos, temRecepcao);

  /* ---------- paredes: janelas, letreiros e decorações ---------- */
  const janelas: Janela[] = [];
  const letreiros: Letreiro[] = [];
  let luaPosta = false;
  for (const z of zonas) {
    if (z.j0 === 0) {
      if (TEMAS_COM_JANELA.has(z.tema)) {
        const jan: Janela = { parede: 'J', u0: (z.i0 + 1) * 16 + 2, u1: z.i1 * 16 - 2 };
        if (!luaPosta) { jan.lua = (z.i0 + 3.5) * 16; luaPosta = true; }
        janelas.push(jan);
      }
      const desloc = z.tema === 'estudio' ? -1.4 : 0;
      letreiros.push({ parede: 'J', texto: z.nome, u: ((z.i0 + z.i1 + 1) / 2 + desloc) * 16, cor: z.cor, zona: z.id });
    } else if (z.i0 === 0) {
      if (TEMAS_COM_JANELA.has(z.tema)) janelas.push({ parede: 'I', u0: (z.j0 + 1) * 16 + 2, u1: z.j1 * 16 - 2 });
      letreiros.push({ parede: 'I', texto: z.nome, u: ((z.j0 + z.j1 + 1) / 2) * 16, cor: z.tema === 'corporativo' ? tom(z.cor, 0.12) : z.cor, zona: z.id });
    }
  }

  /* ---------- noite quente: lampiões nos cruzamentos dos corredores ---------- */
  if (op.paleta === 'quente') {
    const ocupado = (i: number, j: number) => zonas.some((z) => i >= z.i0 && i <= z.i1 && j >= z.j0 && j <= z.j1);
    for (let c = 0; c < planta.colunas.length - 1; c++) {
      const i = colI[c] + planta.colunas[c];
      for (let l = 0; l < planta.linhas.length; l++) {
        for (const j of [linJ[l] + 1, linJ[l] + Math.floor(planta.linhas[l] / 2) + 1]) {
          if (!ocupado(i, j) && !ocupado(i + 1, j)) objetos.push({ tipo: 'lampiao', i, j });
        }
      }
    }
  }

  const linhas = temNucleo ? rotearLinhas(zonas, objetos, ni, nj, colI, linJ, planta) : [];
  const roteiro = planta.roteiro ?? zonas.map((z) => z.id);

  return {
    versao: 1, nome: planta.nome, andar: { ni, nj, parede: planta.parede },
    zonas, salas, objetos, personagens, aparencias: { ...planta.aparencias }, janelas, letreiros, decoracoes, linhas, tapetes,
    pontos, textos: planta.textos, roteiro, ocio: { ...(planta.ocio ?? OCIO_PADRAO) }, agenda: [...(planta.agenda ?? [])].sort((a, b) => a.t - b.t),
    postos, vagasPod, vagasRecarga,
  };
}

/**
 * Vagas de cada zona para o que chega depois da carga: os postos do tema (mesas), as cápsulas
 * das salas (terrenos de 2 por 2 com passagem), lugares em pé para quem não tiver mesa e as
 * cápsulas de recarga dos bots. Tudo em ordem fixa: a mesma planta dá sempre as mesmas vagas.
 */
function vagasDasZonas(
  zonas: Zona[], postosPorZona: Map<string, { posto: Posto; global?: number; ocupado: boolean }[]>, personagens: Personagem[],
  recargasPorZona: Map<string, [number, number][]>, vagasDoTema: Map<string, [number, number][]>, ocupado: Set<string>,
  marcar: (i: number, j: number, w?: number, d?: number) => void, pontos: CenaDados['pontos'], temRecepcao: boolean,
): Pick<CenaDados, 'postos' | 'vagasPod' | 'vagasRecarga'> {
  const postos: CenaDados['postos'] = {}, vagasPod: CenaDados['vagasPod'] = {}, vagasRecarga: CenaDados['vagasRecarga'] = {};
  const chave = (i: number, j: number) => `${i},${j}`;
  // os postos do tema e o balcão da recepção não recebem nada por cima
  const casaDe = new Map(personagens.map((p) => [chave(p.casa[0], p.casa[1]), p.id]));
  for (const lista of postosPorZona.values()) for (const x of lista) marcar(x.posto.casa[0], x.posto.casa[1]);
  if (temRecepcao) marcar(pontos.recepcao[0], pontos.recepcao[1]);
  // perto de um posto ou de um ponto de treino, pausa e fila, nada de cápsula (fica a passagem)
  const perto = new Set<string>();
  const cercar = (i: number, j: number) => { for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) perto.add(chave(i + a, j + b)); };
  for (const lista of postosPorZona.values()) for (const x of lista) cercar(x.posto.casa[0], x.posto.casa[1]);
  for (const s of [...pontos.treinos, ...pontos.pausas]) cercar(s.t[0], s.t[1]);
  for (const f of pontos.fila) cercar(f[0], f[1]);
  for (const z of zonas) {
    const dentro = (i: number, j: number) => i >= z.i0 && i <= z.i1 && j >= z.j0 && j <= z.j1;
    const livre = (i: number, j: number) => dentro(i, j) && !ocupado.has(chave(i, j));
    postos[z.id] = (postosPorZona.get(z.id) ?? []).map((x) => {
      const p: PostoCena = { casa: [x.posto.casa[0], x.posto.casa[1]], pose: x.posto.pose, tipo: 'mesa', mesa: x.global, papel: x.posto.papel };
      const quem = casaDe.get(chave(x.posto.casa[0], x.posto.casa[1]));
      if (quem) p.ocupadoPor = quem;
      return p;
    });
    // cápsulas de sala: as do tema primeiro; depois, terrenos livres de 2 por 2 com um vizinho livre,
    // do fundo para a frente, com um ladrilho de folga entre elas
    const pods: [number, number][] = [];
    const doTema = vagasDoTema.get(z.id);
    if (doTema) for (const [i, j] of doTema) { if ([0, 1].every((a) => [0, 1].every((b) => livre(i + a, j + b)))) { pods.push([i, j]); marcar(i, j, 2, 2); } }
    else if (z.tipo === 'ala' || z.tema === 'recepcao') {
      const folga = new Set<string>();
      for (let j = z.j0; j < z.j1 && pods.length < 6; j++) for (let i = z.i0; i < z.i1 && pods.length < 6; i++) {
        const area = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [i + a, j + b] as const);
        if (!area.every(([a, b]) => livre(a, b) && !perto.has(chave(a, b)) && !folga.has(chave(a, b)))) continue;
        const vizinhos = [[i - 1, j], [i - 1, j + 1], [i + 2, j], [i + 2, j + 1], [i, j - 1], [i + 1, j - 1], [i, j + 2], [i + 1, j + 2]];
        if (!vizinhos.some(([a, b]) => livre(a, b))) continue;
        pods.push([i, j]); marcar(i, j, 2, 2);
        for (let a = -1; a <= 2; a++) for (let b = -1; b <= 2; b++) folga.add(chave(i + a, j + b));
      }
    }
    // perto da placa flutuante da zona, a placa da cápsula bateria nela: esses terrenos ficam por último
    const pertoDaPlaca = ([i, j]: [number, number]) => !!z.placa && i <= z.i0 + 2 && j <= z.j0 + 1;
    vagasPod[z.id] = [...pods.filter((v) => !pertoDaPlaca(v)), ...pods.filter(pertoDaPlaca)];
    // lugares em pé: ladrilhos livres com os quatro vizinhos livres, a partir do meio da zona
    const pe: [number, number][] = [];
    const ci = (z.i0 + z.i1) / 2, cj = (z.j0 + z.j1) / 2;
    const cands: [number, number][] = [];
    for (let j = z.j0 + 1; j < z.j1; j++) for (let i = z.i0 + 1; i < z.i1; i++) cands.push([i, j]);
    cands.sort((a, b) => (Math.abs(a[0] - ci) + Math.abs(a[1] - cj)) - (Math.abs(b[0] - ci) + Math.abs(b[1] - cj)) || a[1] - b[1] || a[0] - b[0]);
    for (const [i, j] of cands) {
      if (pe.length >= 6) break;
      if (!livre(i, j) || perto.has(chave(i, j)) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => livre(i + a, j + b))) continue;
      if (pe.some(([a, b]) => Math.max(Math.abs(a - i), Math.abs(b - j)) < 2)) continue;
      pe.push([i, j]);
    }
    for (const [i, j] of pe) { marcar(i, j); postos[z.id].push({ casa: [i, j], pose: 'parado', tipo: 'pe' }); }
    // cápsulas de recarga: os lugares do tema, a borda esquerda, a borda do fundo e o resto
    const rec: [number, number][] = [];
    if (z.tipo === 'ala' || z.tema === 'recepcao') {
      const cr: [number, number][] = [...(recargasPorZona.get(z.id) ?? [])];
      for (let j = z.j0 + 2; j < z.j1; j++) cr.push([z.i0, j]);
      for (let i = z.i0 + 2; i < z.i1; i++) cr.push([i, z.j0]);
      for (let j = z.j0 + 1; j < z.j1; j++) for (let i = z.i0 + 1; i < z.i1; i++) cr.push([i, j]);
      for (const [i, j] of cr) {
        if (rec.length >= 8) break;
        if (!livre(i, j) || perto.has(chave(i, j)) || rec.some(([a, b]) => a === i && b === j)) continue;
        if (!(livre(i + 1, j) || livre(i, j + 1))) continue;
        rec.push([i, j]); marcar(i, j);
      }
    }
    vagasRecarga[z.id] = rec;
  }
  return { postos, vagasPod, vagasRecarga };
}

/** Liga a mesa (ou console) ao personagem e escolhe os itens dela pelo acessório. */
function ligarMesa(o: Objeto, p: Personagem, ap: Aparencia | undefined): void {
  const props = { ...(o.props ?? {}) };
  props.dono = p.id;
  if (ap?.tipo === 'androide') {
    if (ap.acessorio === 'boina') props.itens ??= 'paleta';
    if (ap.acessorio === 'lupa') props.itens ??= 'celulares';
    if (ap.acessorio === 'monoculo') props.itens ??= 'carimbo';
    if (!props.caneca && ap.acessorio !== 'lupa' && ap.acessorio !== 'monoculo') props.caneca = tom(ap.papel, 0.15);
  }
  o.props = props;
}

/* ---------- linhas de dados: de cada zona até o Núcleo, pelos corredores ---------- */
function rotearLinhas(zonas: Zona[], objetos: Objeto[], ni: number, nj: number, colI: number[], linJ: number[], planta: Planta): Linha[] {
  const nucleoZ = zonas.find((z) => z.tema === 'nucleo');
  const core = objetos.find((o) => o.tipo === 'nucleo');
  if (!nucleoZ || !core) return [];
  const cI0 = core.i, cI1 = core.i + 4, cJ0 = core.j, cJ1 = core.j + 4; // caixa do holograma
  const zonaDe = new Int16Array(ni * nj).fill(-1);
  zonas.forEach((z, k) => { for (let j = z.j0; j <= z.j1; j++) for (let i = z.i0; i <= z.i1; i++) zonaDe[j * ni + i] = k; });
  const livre = (i: number, j: number) => i >= 0 && j >= 0 && i < ni && j < nj && zonaDe[j * ni + i] === -1;
  // centro das faixas de corredor (para as linhas correrem no meio do corredor)
  const faixaI = new Map<number, number>(), faixaJ = new Map<number, number>();
  for (let c = 0; c < colI.length - 1; c++) { const a = colI[c] + planta.colunas[c]; for (let i = a; i < colI[c + 1]; i++) faixaI.set(i, a + planta.corredor / 2); }
  for (let l = 0; l < linJ.length - 1; l++) { const a = linJ[l] + planta.linhas[l]; for (let j = a; j < linJ[l + 1]; j++) faixaJ.set(j, a + planta.corredor / 2); }
  const linhas: Linha[] = [];
  const cx = (cI0 + cI1) / 2, cy = (cJ0 + cJ1) / 2;
  let faixa = 0;
  for (const z of zonas) {
    if (z === nucleoZ) continue;
    const off = ((faixa++ % 5) - 2) * 0.2;
    // saída da zona: o lado cujo corredor fica mais perto do Núcleo
    const mi = Math.floor((z.i0 + z.i1 + 1) / 2), mj = Math.floor((z.j0 + z.j1 + 1) / 2);
    type Lado = { t: [number, number]; borda: [number, number] };
    const lados: Lado[] = ([
      { t: [mi, z.j1 + 1], borda: [(z.i0 + z.i1 + 1) / 2, z.j1 + 1] },
      { t: [mi, z.j0 - 1], borda: [(z.i0 + z.i1 + 1) / 2, z.j0] },
      { t: [z.i1 + 1, mj], borda: [z.i1 + 1, (z.j0 + z.j1 + 1) / 2] },
      { t: [z.i0 - 1, mj], borda: [z.i0, (z.j0 + z.j1 + 1) / 2] },
    ] as Lado[]).filter((l) => livre(l.t[0], l.t[1]));
    if (!lados.length) continue;
    lados.sort((a, b) => (Math.abs(a.t[0] - cx) + Math.abs(a.t[1] - cy)) - (Math.abs(b.t[0] - cx) + Math.abs(b.t[1] - cy)));
    const saida = lados[0];
    // chegada: corredor colado no Núcleo cuja reta acerta o holograma
    const chegada = (i: number, j: number): 'e' | 'd' | 'c' | 'b' | null => {
      if (i === nucleoZ.i0 - 1 && j >= cJ0 && j < cJ1) return 'e';
      if (i === nucleoZ.i1 + 1 && j >= cJ0 && j < cJ1) return 'd';
      if (j === nucleoZ.j0 - 1 && i >= cI0 && i < cI1) return 'c';
      if (j === nucleoZ.j1 + 1 && i >= cI0 && i < cI1) return 'b';
      return null;
    };
    const caminho = rotaComCurvas(saida.t, livre, chegada, ni, nj);
    if (!caminho) continue;
    const pts: [number, number][] = [saida.borda];
    const snap = (i: number, j: number): [number, number] => [(faixaI.get(i) ?? i + 0.5) + off, (faixaJ.get(j) ?? j + 0.5) + off];
    // a primeira perna sai da borda da zona até o meio do corredor
    const [ti, tj] = caminho[0];
    const s0 = snap(ti, tj);
    if (saida.t[1] > z.j1 || saida.t[1] < z.j0) { pts[0] = [saida.borda[0] + off, saida.borda[1]]; pts.push([saida.borda[0] + off, s0[1]]); }
    else { pts[0] = [saida.borda[0], saida.borda[1] + off]; pts.push([s0[0], saida.borda[1] + off]); }
    for (let k = 1; k < caminho.length; k++) {
      const a = caminho[k - 1], b = caminho[k], c = caminho[k + 1];
      if (!c) { pts.push(snap(b[0], b[1])); break; }
      const curva = (b[0] - a[0]) !== (c[0] - b[0]) || (b[1] - a[1]) !== (c[1] - b[1]);
      if (curva) pts.push(snap(b[0], b[1]));
    }
    // ajusta os cantos para manter as pernas retas depois do encaixe no meio do corredor
    for (let k = 2; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (Math.abs(a[0] - b[0]) < Math.abs(a[1] - b[1])) b[0] = a[0]; else b[1] = a[1];
    }
    const fim = caminho[caminho.length - 1];
    const lado = chegada(fim[0], fim[1]);
    const ult = pts[pts.length - 1];
    if (lado === 'e') pts.push([cI0, ult[1]]);
    else if (lado === 'd') pts.push([cI1, ult[1]]);
    else if (lado === 'c') pts.push([ult[0], cJ0]);
    else if (lado === 'b') pts.push([ult[0], cJ1]);
    linhas.push({ zona: z.id, pontos: pts.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]) });
  }
  return linhas;
}

/** Dijkstra pelos corredores com custo extra por curva (linhas com poucas dobras). */
function rotaComCurvas(ini: [number, number], livre: (i: number, j: number) => boolean, fim: (i: number, j: number) => unknown, ni: number, nj: number): [number, number][] | null {
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const N = ni * nj * 4;
  const custo = new Float32Array(N).fill(Infinity), veio = new Int32Array(N).fill(-1);
  const fila: number[] = [];
  for (let d = 0; d < 4; d++) { const s = (ini[1] * ni + ini[0]) * 4 + d; custo[s] = 0; fila.push(s); }
  let achou = -1, guarda = 0;
  while (fila.length && guarda++ < 200000) {
    let mi = 0;
    for (let x = 1; x < fila.length; x++) if (custo[fila[x]] < custo[fila[mi]]) mi = x;
    const s = fila.splice(mi, 1)[0];
    const t = s >> 2, d = s & 3, i = t % ni, j = Math.floor(t / ni);
    if (fim(i, j)) { achou = s; break; }
    for (let nd = 0; nd < 4; nd++) {
      const a = i + D[nd][0], b = j + D[nd][1];
      if (!livre(a, b)) continue;
      const ns = (b * ni + a) * 4 + nd;
      const c = custo[s] + 1 + (nd !== d ? 3 : 0);
      if (c < custo[ns]) { if (custo[ns] === Infinity) fila.push(ns); custo[ns] = c; veio[ns] = s; }
    }
  }
  if (achou < 0) return null;
  const out: [number, number][] = [];
  for (let s = achou; s >= 0; s = veio[s]) { const t = s >> 2; out.push([t % ni, Math.floor(t / ni)]); if (veio[s] < 0) break; }
  out.reverse();
  // remove repetidos (os quatro estados iniciais apontam para o mesmo ladrilho)
  return out.filter((p, k) => k === 0 || p[0] !== out[k - 1][0] || p[1] !== out[k - 1][1]);
}

/** Pontos de treino e pausa como lista simples (para a simulação). */
export function spots(c: CenaDados): { treinos: Spot[]; pausas: Spot[] } {
  return { treinos: c.pontos.treinos, pausas: c.pontos.pausas };
}
