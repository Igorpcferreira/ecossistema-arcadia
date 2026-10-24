// Planta do andar a partir das alas do servidor (ADR 0004). A base é o cenário local (só no próprio
// PC) ou o andar de exemplo do repositório; as áreas comuns (Núcleo, academia, lounge, Recepção,
// Cockpit, servidores) ficam onde estão e cada ala do servidor ocupa um lote:
//   1. o tema da ala é o da configuração (campo `tema`); sem ele, o id da ala quando é nome de
//      tema; sem os dois, o conteúdo (bots e tipo das salas);
//   2. a Recepção do servidor vai para a área da recepção;
//   3. ala com o mesmo id de um lote de ala da base fica nele (o tema da configuração troca o do lote);
//   4. as outras ocupam os lotes de ala que sobraram: primeiro o de mesmo tema, depois qualquer um;
//   5. o lote de academia só recebe ala de tema academia. Sem ela, continua a academia comum, com os
//      pontos de treino: é área comum e nunca vira lote livre nem baias;
//   6. ala sem lote ganha um lote novo, em linhas no fim do andar;
//   7. toda sala do servidor tem cápsula: as que não cabem nos terrenos do lote da ala vão para um
//      anexo de cápsulas da ala, num lote livre do andar ou, sem ele, num lote novo no fim. Os lotes
//      novos entram na ordem das alas e depois os anexos; o último de uma linha incompleta, quando é
//      de ala, ocupa as colunas que sobram;
//   8. lote de ala da base sem ala no servidor vira "lote livre".
// Os agentes não entram na planta: o coreógrafo põe cada um no lugar.
import type { LotePlanta, Planta, Tema } from '../cena/formato.ts';
import { gerarCena } from '../cena/gerador.ts';
import type { Ala, EstadoMundo, SalaServidor, TemaAla } from './tipos.ts';

export interface MapaPlanta {
  planta: Planta;
  /** Zona principal de cada ala do servidor. */
  zonaDaAla: Map<string, string>;
  /** Zonas de cada ala: a principal e depois os anexos. */
  zonasDaAla: Map<string, string[]>;
  /** Ala dona de cada zona de ala (principal ou anexo). */
  alaDaZona: Map<string, string>;
  /** Zona e terreno (posição na lista de vagas de cápsula da zona) de cada sala que a planta conhece. */
  salas: Map<string, { zona: string; vaga: number }>;
  /** Salas que já existiam quando a planta foi feita (sala fora daqui nasceu depois e pode pedir um anexo). */
  conhecidas: Set<string>;
  /** Zona da Recepção: salas sem ala e agentes sem sala ficam nela. */
  zonaRecepcao: string;
  /** Lotes livres (sem ala no servidor). */
  livres: Set<string>;
  /** Anexos de cápsulas. */
  anexos: Set<string>;
}

/** Temas que uma ala pode ter: os mesmos de TEMAS_ALA do pacote compartilhado (o Record obriga a lista inteira). */
const TEMAS_DE_ALA: Record<TemaAla, true> = {
  equipe: true, agencia: true, estudio: true, corporativo: true, laboratorio: true, pessoal: true, bastidores: true, produtos: true, academia: true,
};
const NOMES_TEMA: ReadonlySet<string> = new Set(Object.keys(TEMAS_DE_ALA));
const ehTemaDeAla = (t: string | undefined): t is TemaAla => !!t && NOMES_TEMA.has(t);
const TEMA_DO_TIPO: Record<string, Tema> = { video: 'estudio', web: 'agencia', app: 'laboratorio', backend: 'bastidores', pesquisa: 'laboratorio', outro: 'corporativo' };
/** Tema dos anexos: o salão de cápsulas. */
const TEMA_ANEXO: Tema = 'produtos';

/** Tema de uma ala: o da configuração, o id dela (quando é nome de tema) ou o conteúdo (bots, tipo das salas). */
export function temaDaAla(a: Ala, e: EstadoMundo): Tema {
  if (ehTemaDeAla(a.tema)) return a.tema;
  if (ehTemaDeAla(a.id)) return a.id;
  const salas = Object.values(e.salas).filter((s) => s.alaId === a.id);
  const chaves = new Set(salas.map((s) => s.chave));
  if (Object.values(e.agentes).some((g) => g.tipo === 'bot' && g.salaChave && chaves.has(g.salaChave))) return 'equipe';
  const conta = new Map<string, number>();
  for (const s of salas) conta.set(s.tipo, (conta.get(s.tipo) ?? 0) + 1);
  const maior = [...conta].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
  return maior ? (TEMA_DO_TIPO[maior[0]] ?? 'corporativo') : 'corporativo';
}

const CAPACIDADE = new Map<string, number>();

/**
 * Quantas cápsulas de sala cabem num lote: o gerador mobilia só esse lote, no mesmo tamanho e
 * encostado nas mesmas paredes, e conta os terrenos. Vale o menor número entre as densidades
 * "cheio" e "prancha", para caber nas duas. As vagas de um lote só dependem dele.
 */
export function capacidadeDoLote(base: Planta, linhas: number[], l: LotePlanta): number {
  const cols = l.cols ?? 1, lins = l.lins ?? 1;
  const soma = (v: number[], de: number, n: number) => v.slice(de, de + n).reduce((x, y) => x + y, 0) + base.corredor * (n - 1);
  const chave = [l.tema, l.tipo, soma(base.colunas, l.col, cols), soma(linhas, l.lin, lins), l.col === 0, l.lin === 0, JSON.stringify(l.extras ?? {}), (l.salas ?? []).join(',')].join('|');
  const ja = CAPACIDADE.get(chave);
  if (ja !== undefined) return ja;
  const sonda: Planta = { ...base, linhas, lotes: [{ ...l, zona: 'sonda' }], personagens: [], roteiro: undefined, agenda: [] };
  const n = Math.min(...(['cheio', 'prancha'] as const).map((densidade) => gerarCena(sonda, { densidade, paleta: 'fria' }).vagasPod.sonda?.length ?? 0));
  CAPACIDADE.set(chave, n);
  return n;
}

export function plantaDoServidor(base: Planta, e: EstadoMundo): MapaPlanta {
  const lotes: LotePlanta[] = base.lotes.map((l) => ({ ...l, salas: [], dormindo: l.tipo === 'ala' ? true : undefined, ultimaAtividade: undefined }));
  const alas = Object.values(e.alas).sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  const tema = new Map(alas.map((a) => [a.id, temaDaAla(a, e)]));
  const usados = new Set<LotePlanta>();
  const zonaDaAla = new Map<string, string>();
  const renomear = new Map<string, string>();
  const ids = new Set(lotes.map((l) => l.zona));
  const idLivre = (quer: string) => {
    let id = quer;
    for (let k = 1; ids.has(id); k++) id = k === 1 ? `ala-${quer}` : `ala-${quer}-${k}`;
    ids.add(id);
    return id;
  };
  const trocarId = (l: LotePlanta, id: string) => { renomear.set(l.zona, id); ids.delete(l.zona); l.zona = id; };
  const vestir = (l: LotePlanta, a: Ala) => {
    l.nome = a.nome.toUpperCase(); l.titulo = a.nome; l.cor = a.cor;
    l.texto = a.tipo === 'recepcao' ? 'Teletransporte por onde as sessões chegam e saem. Sala sem regra de ala espera aqui.' : 'Ala da configuração do Arcadia.';
    usados.add(l); zonaDaAla.set(a.id, l.zona);
  };
  // ala num lote de outro id: a zona passa a ter o id da ala, e o lote, o tema dela
  const ocupar = (l: LotePlanta, a: Ala) => {
    if (a.id !== l.zona) trocarId(l, idLivre(a.id));
    const t = tema.get(a.id)!;
    if (l.tema !== t) { l.tema = t; l.extras = {}; }
    vestir(l, a);
  };
  const livresDeAla = () => lotes.filter((x) => x.tipo === 'ala' && !usados.has(x));
  const recepcao = lotes.find((l) => l.tema === 'recepcao');
  // a Recepção e as alas com o id de um lote da base
  for (const a of alas) {
    if (a.tipo === 'recepcao') { if (recepcao && !usados.has(recepcao)) vestir(recepcao, a); continue; }
    const l = lotes.find((x) => x.tipo === 'ala' && x.zona === a.id && !usados.has(x));
    if (!l) continue;
    // a academia nunca some: ala que a configuração põe noutro tema não fica no lote dela
    if (l.tema === 'academia' && ehTemaDeAla(a.tema) && a.tema !== 'academia') continue;
    if (ehTemaDeAla(a.tema) && a.tema !== l.tema) { l.tema = a.tema; l.extras = {}; }
    vestir(l, a);
  }
  // depois, o lote livre de mesmo tema e, sem ele, qualquer lote livre que não seja a academia
  const semLote = () => alas.filter((a) => a.tipo !== 'recepcao' && !zonaDaAla.has(a.id));
  for (const a of semLote()) { const l = livresDeAla().find((x) => x.tema === tema.get(a.id)); if (l) ocupar(l, a); }
  for (const a of semLote()) { const l = livresDeAla().find((x) => x.tema !== 'academia'); if (l) ocupar(l, a); }
  // sem lote nenhum: lote novo no fim do andar (a posição sai depois, junto com a dos anexos)
  const novos: LotePlanta[] = [];
  for (const a of semLote()) {
    const l: LotePlanta = { zona: idLivre(a.id), nome: '', tipo: 'ala', tema: tema.get(a.id)!, cor: a.cor, col: 0, lin: 0, salas: [], dormindo: true };
    lotes.push(l); novos.push(l);
    vestir(l, a);
  }
  const zonaRecepcao = recepcao?.zona ?? lotes.find((l) => l.tipo === 'area')?.zona ?? lotes[0].zona;
  for (const a of alas) if (!zonaDaAla.has(a.id)) zonaDaAla.set(a.id, zonaRecepcao);

  // salas por zona principal, na ordem do terreno que o servidor deu (sala de ala desconhecida fica na Recepção)
  const porZona = new Map<string, SalaServidor[]>();
  for (const s of Object.values(e.salas)) {
    const z = zonaDaAla.get(s.alaId) ?? zonaRecepcao;
    (porZona.get(z) ?? porZona.set(z, []).get(z)!).push(s);
  }
  for (const lista of porZona.values()) lista.sort((a, b) => a.terreno.indice - b.terreno.indice || a.criadaEm - b.criadaEm || a.chave.localeCompare(b.chave));

  // posição dos lotes novos: linhas de N lotes no fim do andar, com a altura alternada da base
  const ncol = base.colunas.length;
  const linhas = [...base.linhas];
  const anexos = new Map<string, LotePlanta[]>();
  const ehAnexo = new Set<LotePlanta>();
  const dispor = () => {
    linhas.length = base.linhas.length;
    novos.forEach((l, k) => {
      const c = k % ncol;
      if (c === 0) linhas.push(linhas.length % 2 === 0 ? 11 : 10);
      l.col = c; l.lin = linhas.length - 1; l.cols = undefined;
    });
    const ult = novos[novos.length - 1];
    if (ult && !ehAnexo.has(ult) && ult.col < ncol - 1) ult.cols = ncol - ult.col;
  };
  const loteDe = (zona: string) => lotes.find((l) => l.zona === zona)!;
  const criarAnexo = (zona: string) => {
    const dono = loteDe(zona), lista = anexos.get(zona) ?? [];
    anexos.set(zona, lista);
    const n = lista.length + 1;
    const id = idLivre(n === 1 ? `${zona}-anexo` : `${zona}-anexo-${n}`);
    let l = livresDeAla().find((x) => x.tema !== 'academia');
    if (l) trocarId(l, id);
    else { l = { zona: id, nome: '', tipo: 'ala', tema: TEMA_ANEXO, cor: dono.cor, col: 0, lin: 0 }; lotes.push(l); novos.push(l); }
    l.tipo = 'ala'; l.tema = TEMA_ANEXO; l.extras = {}; l.salas = []; l.dormindo = true;
    l.nome = `${dono.nome} · ANEXO${n > 1 ? ` ${n}` : ''}`; l.titulo = `${dono.titulo ?? dono.nome}: anexo${n > 1 ? ` ${n}` : ''}`; l.cor = dono.cor;
    l.texto = 'Anexo de cápsulas da ala: as salas que não couberam no lote dela.';
    usados.add(l); ehAnexo.add(l); lista.push(l);
  };
  const capacidade = (l: LotePlanta) => capacidadeDoLote(base, linhas, l);
  // anexo por anexo, até toda sala ter terreno (cada volta confere tudo de novo: um lote que
  // deixa de ocupar as colunas que sobravam pode perder terrenos)
  const limite = Object.keys(e.salas).length + 4;
  for (let volta = 0; volta <= limite; volta++) {
    dispor();
    const falta = [...porZona].find(([z, lista]) => [loteDe(z), ...(anexos.get(z) ?? [])].reduce((n, l) => n + capacidade(l), 0) < lista.length);
    if (!falta) break;
    if (volta === limite) { console.warn(`[arcadia] a zona ${falta[0]} ficou sem terreno para ${falta[1].length} salas`); break; }
    criarAnexo(falta[0]);
  }
  // cada sala no seu terreno: o lote da ala primeiro, depois os anexos
  const salas = new Map<string, { zona: string; vaga: number }>();
  for (const [z, lista] of porZona) {
    let k = 0;
    for (const l of [loteDe(z), ...(anexos.get(z) ?? [])]) {
      const cap = capacidade(l);
      for (let v = 0; v < cap && k < lista.length; v++, k++) salas.set(lista[k].chave, { zona: l.zona, vaga: v });
    }
  }
  const zonasDaAla = new Map<string, string[]>(), alaDaZona = new Map<string, string>();
  for (const a of alas) {
    const z = zonaDaAla.get(a.id)!;
    zonasDaAla.set(a.id, [z, ...(anexos.get(z) ?? []).map((l) => l.zona)]);
    if (!alaDaZona.has(z) || a.tipo === 'recepcao') alaDaZona.set(z, a.id);
    for (const l of anexos.get(z) ?? []) if (!alaDaZona.has(l.zona) || a.tipo === 'recepcao') alaDaZona.set(l.zona, a.id);
  }

  // lotes de ala da base que sobraram: a academia continua academia comum; os outros ficam livres
  const livres = new Set<string>();
  for (const l of lotes) {
    if (l.tipo !== 'ala' || usados.has(l)) continue;
    if (l.tema === 'academia') {
      l.tipo = 'area'; l.dormindo = undefined; l.nome = 'ACADEMIA'; l.titulo = 'Academia';
      l.texto = 'Academia comum do andar: os agentes vêm aqui nas pausas curtas entre tarefas, e você também.';
      continue;
    }
    l.tema = 'livre'; l.nome = 'LOTE LIVRE'; l.titulo = 'Lote livre'; l.cor = '#7d86a8'; l.extras = {};
    l.texto = 'Terreno vago: a próxima ala nova da configuração nasce aqui.';
    livres.add(l.zona);
  }
  const roteiro = (base.roteiro ?? base.lotes.map((l) => l.zona)).map((z) => renomear.get(z) ?? z);
  for (const l of lotes) if (!roteiro.includes(l.zona)) roteiro.push(l.zona);
  const planta: Planta = {
    ...base,
    linhas,
    lotes,
    // só as pessoas e figurantes do cenário (dono, pessoa fixa, recepção): os agentes vêm do servidor
    personagens: base.personagens.filter((p) => p.tipo !== 'agente'),
    roteiro,
    agenda: [],
  };
  return { planta, zonaDaAla, zonasDaAla, alaDaZona, salas, conhecidas: new Set(Object.keys(e.salas)), zonaRecepcao, livres, anexos: new Set([...ehAnexo].map((l) => l.zona)) };
}
