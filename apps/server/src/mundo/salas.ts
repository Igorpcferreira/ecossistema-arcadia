// Resolução de sala: de um caminho (cwd da sessão ou arquivo mexido) para a sala do mundo.
// O caminho só vive aqui, em memória. Para fora saem a chave (hash com sal), o apelido e a ala.
//
// Regras (prompt, seção 5.4, com as travas das revisões dos marcos 3 a 5):
//   1. lista de exclusão (cada padrão vale também para tudo dentro dele): nunca vira sala e nunca é lida;
//   2. pasta de rede, de dispositivo ou do WSL (\\servidor, //servidor, \\?\UNC, \\.\, \\wsl$, \\wsl.localhost):
//      sala fixa "Pasta de rede", sem nenhum acesso ao disco e sem nome vindo do caminho. Perguntar ao disco por
//      um caminho desses abre uma conexão SMB e pode entregar o hash NTLM do usuário a quem controla o servidor;
//   3. pasta privada de tarefa do OpenMausBot: quem decide a sala é o adaptador do OMB (tarefa ou QG da equipe);
//   4. pastas dos próprios agentes (~/.claude, ~/.codex, ~/.openmausbot e as pastas das fontes) viram a sala fixa
//      "Arquivos dos agentes"; %LOCALAPPDATA%/Arcadia e ~/.arcadia, a sala fixa "Dados do Arcadia". Nenhum pedaço
//      de caminho de dentro delas vira nome (a pasta do Claude guarda o cwd codificado no nome);
//   5. raiz git do caminho, procurada no disco só dentro de raízes conhecidas (pasta pessoal, pastas das regras de
//      ala, agregadoras e apelidos), de forma assíncrona e com cache. Nunca vale a pasta pessoal, a raiz do disco,
//      uma agregadora ou uma pasta acima de uma agregadora. A sonda tem prazo (2 s) e no máximo 2 perguntas ao disco
//      por vez; sem resposta no prazo, a sonda fica desconhecida (nunca "não existe"), o caminho fica sem sala por
//      enquanto e a raiz que demorou fica alguns minutos sem sonda;
//   6. sem git: dentro de uma pasta agregadora, a subpasta de primeiro nível (ou a própria agregadora). Subpasta
//      de primeiro nível com nome de pasta de apoio (docs, tmp, scripts...) conta para a sala da própria agregadora;
//   7. sem git e sem agregadora: a raiz de apelido que contém o caminho; senão, a própria pasta. Fora das raízes
//      conhecidas a sala sai marcada (`foraDasRaizes`);
//   8. ala pela primeira regra de glob que casar com a raiz da sala; sem regra, Recepção. As salas fixas ficam na
//      ala da pasta pessoal (no exemplo de configuração, Bastidores).
// Cada sala sai com a origem (git, filha de agregadora, apelido, apoio, raiz da agregadora, pasta comum, casa, disco
// ou fixa). Quem decide se um arquivo pode levar o agente para ela é o núcleo: só sala de projeto (git, filha de
// agregadora ou apelido); o resto vira sala só pelo cwd da sessão. Pasta de rascunho (`ehRascunho`) nem é resolvida
// para arquivo.
import fs from 'node:fs';
import { sanearTexto, LIMITES, type TipoSala } from '@arcadia/shared';
import { dentroDe, ehRaizDeDisco, expandir, juntar, normalizar, pai, pedacos, type AmbienteCaminhos } from '../util/caminhos.ts';
import { compilarGlob, raizDoPadrao, type Glob } from '../util/glob.ts';
import { hashCurto } from '../util/hash.ts';

export type RegraAla = { id: string; regras: string[]; tipo?: TipoSala | undefined };

export type ConfigSalas = {
  alas: RegraAla[];
  recepcaoId: string;
  pastasAgregadoras: string[];
  excluir: string[];
  apelidos: Record<string, string>;
  /** Pastas das fontes (transcrições, sessões vivas, rollouts), além de ~/.claude, ~/.codex e ~/.openmausbot. */
  pastasDosAgentes?: string[];
  /** Nomes de pasta de apoio: filha direta de agregadora com um deles conta para a sala da agregadora. */
  pastasDeApoio?: string[];
  /** Pastas de rascunho (arquivo ali não cria sala nem move o agente; o núcleo pergunta com `ehRascunho`). */
  rascunho?: string[];
};

export type SistemaArquivos = {
  /**
   * Existe arquivo ou pasta neste caminho? Só existência: o Arcadia nunca lê conteúdo de projeto. Pode responder
   * na hora (testes) ou com uma promessa (o real, assíncrono, para não travar o servidor). Promessa recusada quer
   * dizer "não deu para saber" (erro do disco, sem permissão): a sonda fica desconhecida, nunca vira "não existe".
   */
  existe(caminho: string): boolean | Promise<boolean>;
};

/** Caminho de rede, de dispositivo ou do WSL: começa com duas barras (\\servidor, //servidor, \\?\, \\.\). */
export function ehCaminhoRemoto(caminho: string): boolean {
  return /^[\\/]{2}/.test(caminho.trim());
}

/** Erros que respondem "não existe"; qualquer outro (sem permissão, disco ocupado, rede) é "não deu para saber". */
const ERROS_DE_NAO_EXISTE = new Set(['ENOENT', 'ENOTDIR', 'EINVAL', 'ENAMETOOLONG']);

/**
 * Sonda real: assíncrona e nunca em caminho de rede (defesa extra além do resolvedor). O prazo é do resolvedor:
 * aqui nenhum tempo esgotado vira "não existe".
 */
export const sistemaArquivosReal: SistemaArquivos = {
  existe: (p) => {
    if (ehCaminhoRemoto(p)) return false;
    return fs.promises.access(p).then(
      () => true,
      (e: unknown) => {
        const codigo = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
        if (typeof codigo === 'string' && ERROS_DE_NAO_EXISTE.has(codigo)) return false;
        throw e;
      },
    );
  },
};

/**
 * De onde a sala veio. Só `git`, `projeto` (filha de agregadora) e `apelido` são sala de projeto: as únicas para
 * onde um arquivo pode levar o agente. `apoio` é pasta de apoio na raiz de uma agregadora e `agregadora`, a própria
 * agregadora (as duas dão a sala da agregadora); `pasta` é pasta comum sem git; `fixa`, as salas de nome fixo.
 */
export type OrigemSala = 'git' | 'projeto' | 'apelido' | 'apoio' | 'agregadora' | 'pasta' | 'casa' | 'disco' | 'fixa';

/** Origens de sala de projeto: só para elas um arquivo pode mover o agente. */
export const ORIGENS_DE_PROJETO: ReadonlySet<OrigemSala> = new Set<OrigemSala>(['git', 'projeto', 'apelido']);

export type SalaResolvida = {
  tipo: 'sala';
  chave: string;
  nome: string;
  ala: string;
  tipoSala: TipoSala;
  /** Raiz normalizada da sala (ou `fixa:<id>`). Só em memória: nunca vai para evento, banco, log ou cliente. */
  raiz: string;
  origem: OrigemSala;
  /** A pasta fica fora das raízes conhecidas (nenhuma regra de ala, agregadora, apelido ou a casa por cima dela). */
  foraDasRaizes?: true;
};

export type ResultadoSala =
  | SalaResolvida
  | { tipo: 'excluida' }
  | { tipo: 'omb-privada'; botId: string; threadId?: string }
  /** Falta sondar o disco. Quando `pronto` resolver, pergunte de novo (a resposta estará no cache). */
  | { tipo: 'pendente'; pronto: Promise<void> }
  /** O disco não respondeu no prazo (ou a raiz está marcada como lenta): sem sala agora; pergunte de novo depois. */
  | { tipo: 'desconhecida' };

export type Resolvedor = {
  resolver(caminho: string): ResultadoSala;
  /** Diz se um caminho cai na lista de exclusão (para não mostrar nem o nome curto do arquivo). */
  excluido(caminho: string): boolean;
  /** Diz se um caminho fica numa pasta de rascunho (arquivo ali não cria sala nem move o agente). */
  ehRascunho(caminho: string): boolean;
  limparCache(): void;
  /** Tamanho dos caches (resultados, sondas e tipos), para os testes e o doctor. */
  tamanhoDosCaches(): { resultados: number; sondas: number; tipos: number };
  /** Sondas de disco agora: no disco, esperando vaga e raízes marcadas como lentas (para o doctor). */
  sondasAgora(): { emVoo: number; esperando: number; lentas: number };
};

export type OpcoesResolvedor = {
  sal: string;
  amb: AmbienteCaminhos;
  fs?: SistemaArquivos;
  agora?: () => number;
  /** Validade do cache de cada caminho (padrão: 5 min). Um `git init` novo aparece depois disso. */
  validadeCacheMs?: number;
  /** Teto de cada cache (padrão: 5.000 resultados e 20.000 sondas). */
  limiteCache?: number;
  /**
   * Prazo de cada pergunta dentro do disco (padrão: 2 s). Sem resposta, ela fica desconhecida (nunca "não existe") e a
   * raiz fica lenta. Esperando vaga, o prazo é quatro vezes maior e não marca a raiz.
   */
  tempoMaxSondaMs?: number;
  /** Perguntas ao disco ao mesmo tempo (padrão: 2), para não tomar o pool de threads do Node (4 por padrão). */
  sondasEmVoo?: number;
  /** Raiz cuja pergunta passou do prazo dentro do disco fica este tempo sem sonda nenhuma (padrão: 5 min). */
  lentaPorMs?: number;
  /** Validade da resposta desconhecida (padrão: 1 min): depois disso, o disco é consultado de novo. */
  validadeDesconhecidaMs?: number;
  /** Relógio de verdade dos prazos da sonda (padrão: performance.now). O disco não segue o relógio do mundo. */
  agoraReal?: () => number;
};

/** Arquivos que denunciam o tipo de projeto. Só a existência é conferida, e só na raiz da sala. */
const MARCADORES: [TipoSala, string[]][] = [
  ['video', ['remotion.config.ts', 'remotion.config.js', 'remotion.config.mjs']],
  ['app', ['app.json', 'pubspec.yaml', 'android', 'ios', 'capacitor.config.ts', 'capacitor.config.json']],
  ['web', ['next.config.js', 'next.config.mjs', 'next.config.ts', 'vite.config.ts', 'vite.config.js', 'astro.config.mjs', 'nuxt.config.ts', 'angular.json', 'svelte.config.js', 'index.html']],
  ['backend', ['pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'composer.json', 'manage.py']],
];

/** Salas fixas: nome fixo, sem pedaço de caminho. */
export const SALAS_FIXAS = {
  rede: 'Pasta de rede',
  agentes: 'Arquivos dos agentes',
  arcadia: 'Dados do Arcadia',
} as const;

/** Pedidos de sonda esperando vaga, no máximo (acima disso, o caminho fica desconhecido na hora). */
const LIMITE_FILA_SONDAS = 2_000;
const DESCONHECIDA = 'desconhecida';

type IdFixa = keyof typeof SALAS_FIXAS;
type Sonda = {
  /** Quando a última resposta chegou (relógio do mundo, para a validade do cache). */
  quando: number;
  existe?: boolean;
  /** Até quando (relógio de verdade) a sonda fica desconhecida, sem pergunta nova ao disco. */
  desconhecidaAte?: number;
  /** Pergunta em andamento: resolve quando o disco responder ou o prazo vencer. */
  emAndamento?: Promise<void>;
};
type Pedido = { p: string; raiz: string; sonda: Sonda; responder: () => void; feito: boolean; prazo?: ReturnType<typeof setTimeout> };
/** true ou false (o disco respondeu), undefined (falta a resposta) ou desconhecida (o disco não respondeu no prazo). */
type Resposta = boolean | undefined | typeof DESCONHECIDA;

function podar<V>(m: Map<string, V>, limite: number): void {
  if (m.size <= limite) return;
  const alvo = Math.floor(limite * 0.8);
  for (const k of m.keys()) {
    m.delete(k);
    if (m.size <= alvo) break;
  }
}

export function criarResolvedor(cfg: ConfigSalas, opcoes: OpcoesResolvedor): Resolvedor {
  const { amb, sal } = opcoes;
  const sfs = opcoes.fs ?? sistemaArquivosReal;
  const agora = opcoes.agora ?? (() => Date.now());
  const validade = opcoes.validadeCacheMs ?? 5 * 60_000;
  const limiteResultados = opcoes.limiteCache ?? 5_000;
  const limiteSondas = (opcoes.limiteCache ?? 5_000) * 4;
  const tempoMax = opcoes.tempoMaxSondaMs ?? 2_000;
  const maxEmVoo = Math.max(1, Math.floor(opcoes.sondasEmVoo ?? 2));
  const lentaPor = opcoes.lentaPorMs ?? 5 * 60_000;
  const validadeDesconhecida = opcoes.validadeDesconhecidaMs ?? 60_000;
  const agoraReal = opcoes.agoraReal ?? (() => performance.now());

  const local = (p: string) => !ehCaminhoRemoto(expandir(p, amb));
  const excluir: Glob[] = cfg.excluir.map((p) => compilarGlob(p, amb, { descendentes: true }));
  const agregadoras = cfg.pastasAgregadoras.filter(local).map((p) => normalizar(p, amb)).sort((a, b) => b.length - a.length);
  const alas = cfg.alas.map((a) => ({ id: a.id, tipo: a.tipo, globs: a.regras.map((r) => compilarGlob(r, amb)) }));
  const apelidos = new Map<string, string>();
  for (const [p, nome] of Object.entries(cfg.apelidos)) if (local(p)) apelidos.set(normalizar(p, amb), nome);
  const casa = normalizar(amb.casa, amb);
  const tarefasOmb = normalizar(`${amb.casa}/.openmausbot/task-workspaces`, amb);
  const pastasAgentes = ['~/.claude', '~/.codex', '~/.openmausbot', ...(cfg.pastasDosAgentes ?? [])].filter(local).map((p) => normalizar(p, amb));
  const apoio = new Set((cfg.pastasDeApoio ?? []).map((nome) => nome.normalize('NFC').toLowerCase()));
  // Rascunho com variável que não existe nesta máquina fica de fora (nunca vira uma pasta relativa por engano).
  const rascunhos = (cfg.rascunho ?? [])
    .map((p) => expandir(p, amb))
    .filter((p) => p.trim().length > 0 && !/%[A-Za-z_][A-Za-z0-9_]*%/.test(p) && !ehCaminhoRemoto(p))
    .map((p) => normalizar(p, amb));
  const raizesDeApelido = [...apelidos.keys()].sort((a, b) => b.length - a.length);
  const localAppData = expandir('%LOCALAPPDATA%', amb);
  const pastasArcadia = ['~/.arcadia', ...(localAppData !== '%LOCALAPPDATA%' ? [`${localAppData}/Arcadia`] : [])].filter(local).map((p) => normalizar(p, amb));
  // Raízes conhecidas: só dentro delas o disco é consultado.
  const raizes = [...new Set([casa, ...agregadoras, ...apelidos.keys(), ...cfg.alas.flatMap((a) => a.regras.map((r) => raizDoPadrao(r, amb)))])]
    .filter((r): r is string => typeof r === 'string' && r.length > 0 && !ehCaminhoRemoto(r));
  const alaDaCasa = alas.find((a) => a.globs.some((g) => g.testar(casa)))?.id ?? cfg.recepcaoId;

  const cache = new Map<string, { quando: number; r: ResultadoSala }>();
  const sondas = new Map<string, Sonda>();
  const cacheTipo = new Map<string, TipoSala>();
  /** Pedidos esperando vaga para perguntar ao disco (no máximo `maxEmVoo` perguntas ao mesmo tempo). */
  const fila: Pedido[] = [];
  let emVoo = 0;
  /** Raízes que passaram do prazo dentro do disco: até quando (relógio de verdade) ficam sem sonda. */
  const lentas = new Map<string, number>();

  function guardarSonda(p: string, s: Sonda): void {
    sondas.delete(p);
    sondas.set(p, s);
    podar(sondas, limiteSondas);
  }

  /** A raiz conhecida mais alta que contém o caminho (a busca por .git sobe até ela, e não além). */
  function raizConhecida(n: string): string | undefined {
    let melhor: string | undefined;
    for (const r of raizes) if (dentroDe(n, r) && (melhor === undefined || r.length < melhor.length)) melhor = r;
    return melhor;
  }

  /** O que marca lentidão: a raiz conhecida da sonda (ou a unidade, se ela estiver fora de todas). */
  function raizDaSonda(p: string): string {
    return raizConhecida(p) ?? pedacos(p)[0] ?? p;
  }

  function raizLenta(raiz: string): boolean {
    const ate = lentas.get(raiz);
    if (ate === undefined) return false;
    if (agoraReal() < ate) return true;
    lentas.delete(raiz);
    return false;
  }

  /** Resposta de um pedido. A primeira acorda quem espera; resposta de verdade que chega atrasada ainda vai ao cache. */
  function concluir(pedido: Pedido, valor: boolean | typeof DESCONHECIDA): void {
    if (valor === DESCONHECIDA) {
      if (pedido.feito) return;
      // Sem resposta: nunca vira "não existe". Fica a resposta velha (se havia) e uma pausa antes de perguntar de novo.
      const s: Sonda = { quando: pedido.sonda.quando, desconhecidaAte: agoraReal() + validadeDesconhecida };
      if (pedido.sonda.existe !== undefined) s.existe = pedido.sonda.existe;
      guardarSonda(pedido.p, s);
    } else {
      guardarSonda(pedido.p, { quando: agora(), existe: valor });
    }
    if (!pedido.feito) {
      pedido.feito = true;
      if (pedido.prazo !== undefined) clearTimeout(pedido.prazo);
      pedido.responder();
    }
  }

  function iniciar(pedido: Pedido): void {
    if (pedido.prazo !== undefined) clearTimeout(pedido.prazo);
    let r: boolean | Promise<boolean>;
    try {
      r = ehCaminhoRemoto(pedido.p) ? false : sfs.existe(pedido.p);
    } catch {
      concluir(pedido, DESCONHECIDA);
      return;
    }
    if (typeof r === 'boolean') {
      concluir(pedido, r);
      return;
    }
    emVoo++;
    // Mais que o prazo dentro do disco: a pergunta fica desconhecida (nunca "não existe") e a raiz fica marcada como
    // lenta, sem sonda por alguns minutos. A vaga só volta quando o disco responde de fato (a pergunta ainda ocupa uma
    // thread do Node até lá); a resposta que chegar atrasada ainda vai para o cache.
    pedido.prazo = setTimeout(() => {
      lentas.set(pedido.raiz, agoraReal() + lentaPor);
      concluir(pedido, DESCONHECIDA);
    }, tempoMax);
    pedido.prazo.unref?.();
    Promise.resolve(r)
      .then(
        (v) => concluir(pedido, v === true),
        () => concluir(pedido, DESCONHECIDA),
      )
      .finally(() => {
        emVoo--;
        proximos();
      })
      .catch(() => {
        // nada a fazer: o pedido já foi respondido
      });
  }

  function proximos(): void {
    while (emVoo < maxEmVoo && fila.length > 0) {
      const pedido = fila.shift();
      if (!pedido || pedido.feito) continue;
      if (raizLenta(pedido.raiz)) concluir(pedido, DESCONHECIDA);
      else iniciar(pedido);
    }
  }

  function pedir(p: string, anterior: Sonda | undefined): Pedido {
    const sonda: Sonda = { quando: anterior?.quando ?? agora() };
    if (anterior?.existe !== undefined) sonda.existe = anterior.existe;
    let responder: () => void = () => {};
    sonda.emAndamento = new Promise<void>((ok) => (responder = ok));
    guardarSonda(p, sonda);
    const pedido: Pedido = { p, raiz: raizDaSonda(p), sonda, responder: () => responder(), feito: false };
    if (emVoo < maxEmVoo && fila.length === 0) {
      iniciar(pedido);
    } else if (fila.length >= LIMITE_FILA_SONDAS) {
      concluir(pedido, DESCONHECIDA);
    } else {
      fila.push(pedido);
      // Esperando vaga tempo demais (o disco preso em outras perguntas): fica desconhecida, sem marcar a raiz.
      pedido.prazo = setTimeout(() => {
        const i = fila.indexOf(pedido);
        if (i >= 0) fila.splice(i, 1);
        concluir(pedido, DESCONHECIDA);
      }, tempoMax * 4);
      pedido.prazo.unref?.();
    }
    return pedido;
  }

  /** Existe? true/false do cache (mesmo vencido, enquanto confere de novo), undefined quando falta a resposta ou desconhecida. */
  function consultar(p: string, pendentes: Promise<void>[]): Resposta {
    const s = sondas.get(p);
    if (s?.emAndamento) {
      if (s.existe !== undefined) return s.existe;
      pendentes.push(s.emAndamento);
      return undefined;
    }
    if (s && s.existe !== undefined && agora() - s.quando < validade) return s.existe;
    if (s?.desconhecidaAte !== undefined && agoraReal() < s.desconhecidaAte) return s.existe ?? DESCONHECIDA;
    if (raizLenta(raizDaSonda(p))) return s?.existe ?? DESCONHECIDA;
    const pedido = pedir(p, s);
    if (pedido.feito) return sondas.get(p)?.existe ?? DESCONHECIDA;
    if (s?.existe !== undefined) return s.existe;
    if (pedido.sonda.emAndamento) pendentes.push(pedido.sonda.emAndamento);
    return undefined;
  }

  const dentro = (d: string, nome: string) => (d.endsWith('/') ? `${d}${nome}` : `${d}/${nome}`);

  function estaExcluido(n: string): boolean {
    return excluir.some((g) => g.testar(n));
  }

  function agregadoraDe(n: string): string | undefined {
    return agregadoras.find((a) => dentroDe(n, a));
  }

  /** Raiz git: string (achou), undefined (não tem), null (falta sondar) ou desconhecida (o disco não respondeu). */
  function raizGit(n: string, limite: string, pendentes: Promise<void>[]): string | undefined | null | typeof DESCONHECIDA {
    let falta = false;
    let desconhecido = false;
    for (let d: string | undefined = n; d !== undefined && dentroDe(d, limite); d = pai(d)) {
      const e = consultar(dentro(d, '.git'), pendentes);
      if (e === undefined) {
        falta = true;
        continue;
      }
      if (e === DESCONHECIDA) {
        desconhecido = true;
        continue;
      }
      if (e) return falta ? null : desconhecido ? DESCONHECIDA : d;
    }
    return falta ? null : desconhecido ? DESCONHECIDA : undefined;
  }

  function gitValido(g: string, n: string): boolean {
    if (g === casa || ehRaizDeDisco(g)) return false;
    for (const a of agregadoras) {
      if (g === a) return false;
      // Repositório acima de uma agregadora que contém o caminho: a agregadora manda.
      if (dentroDe(a, g) && dentroDe(n, a)) return false;
    }
    return true;
  }

  function nomeDaSala(raiz: string, original: string[]): string {
    const apelido = apelidos.get(raiz);
    if (apelido) return sanearTexto(apelido, LIMITES.sala) || 'Sala';
    if (raiz === casa) return 'Pasta pessoal';
    if (ehRaizDeDisco(raiz)) return `Disco ${(raiz[0] ?? '').toUpperCase()}`;
    const qtd = pedacos(raiz).length;
    const base = original[qtd - 1] ?? pedacos(raiz).at(-1) ?? '';
    return sanearTexto(base, LIMITES.sala) || 'Sala';
  }

  /** Tipo pela ala ou pelos marcadores na raiz (só dentro de raiz conhecida). null = falta sondar. */
  function tipoDaSala(raiz: string, tipoDaAla: TipoSala | undefined, pendentes: Promise<void>[]): TipoSala | null | typeof DESCONHECIDA {
    if (tipoDaAla) return tipoDaAla;
    const c = cacheTipo.get(raiz);
    if (c) return c;
    if (raiz === casa || ehRaizDeDisco(raiz) || raizConhecida(raiz) === undefined) return 'outro';
    let falta = false;
    let desconhecido = false;
    for (const [t, arquivos] of MARCADORES) {
      const r = arquivos.map((a) => consultar(dentro(raiz, a), pendentes));
      // Vale o primeiro tipo da lista com marcador, quando todos os de cima já responderam que não têm.
      if (r.some((x) => x === true) && !falta && !desconhecido) {
        cacheTipo.set(raiz, t);
        podar(cacheTipo, limiteResultados);
        return t;
      }
      if (r.some((x) => x === undefined)) falta = true;
      if (r.some((x) => x === DESCONHECIDA)) desconhecido = true;
    }
    if (falta) return null;
    if (desconhecido) return DESCONHECIDA;
    cacheTipo.set(raiz, 'outro');
    podar(cacheTipo, limiteResultados);
    return 'outro';
  }

  function salaFixa(id: IdFixa): ResultadoSala {
    return { tipo: 'sala', chave: `s${hashCurto(`${sal}\u0000fixa:${id}`, 15)}`, nome: SALAS_FIXAS[id], ala: alaDaCasa, tipoSala: 'outro', raiz: `fixa:${id}`, origem: 'fixa' };
  }

  const esperar = (pendentes: Promise<void>[]): ResultadoSala => ({ tipo: 'pendente', pronto: Promise.all(pendentes).then(() => undefined) });

  function resolverSemCache(caminho: string): ResultadoSala {
    if (typeof caminho !== 'string' || caminho.trim().length === 0 || caminho.length > 4_096) return { tipo: 'excluida' };
    const n = normalizar(caminho, amb);
    if (estaExcluido(n)) return { tipo: 'excluida' };
    if (ehCaminhoRemoto(caminho) || ehCaminhoRemoto(n)) return salaFixa('rede');
    if (dentroDe(n, tarefasOmb) && n !== tarefasOmb) {
      const resto = pedacos(n).slice(pedacos(tarefasOmb).length);
      const botId = resto[0] ?? '';
      const threadId = resto[1];
      return threadId ? { tipo: 'omb-privada', botId, threadId } : { tipo: 'omb-privada', botId };
    }
    if (pastasArcadia.some((p) => dentroDe(n, p))) return salaFixa('arcadia');
    if (pastasAgentes.some((p) => dentroDe(n, p))) return salaFixa('agentes');
    const original = pedacos(normalizar(caminho, amb, true));
    const pendentes: Promise<void>[] = [];
    const limite = raizConhecida(n);
    const g = limite !== undefined ? raizGit(n, limite, pendentes) : undefined;
    if (g === null) return esperar(pendentes);
    // Sem resposta do disco não há sala: com a raiz git errada, ela ficaria para sempre no mundo.
    if (g === DESCONHECIDA) return { tipo: 'desconhecida' };
    const agregadora = agregadoraDe(n);
    let raiz: string;
    let origem: OrigemSala;
    if (g !== undefined && gitValido(g, n)) {
      raiz = g;
      origem = 'git';
    } else if (agregadora !== undefined) {
      const filha = n === agregadora ? undefined : juntar(pedacos(n).slice(0, pedacos(agregadora).length + 1));
      if (filha === undefined) {
        raiz = agregadora;
        origem = 'agregadora';
      } else if (apoio.has(pedacos(filha).at(-1)?.normalize('NFC').toLowerCase() ?? '')) {
        // Pasta de apoio na raiz da agregadora (docs, tmp, scripts...): não é projeto; conta para a agregadora.
        raiz = agregadora;
        origem = 'apoio';
      } else {
        raiz = filha;
        origem = 'projeto';
      }
    } else {
      const apelido = raizesDeApelido.find((a) => dentroDe(n, a));
      if (apelido !== undefined) {
        raiz = apelido;
        origem = 'apelido';
      } else {
        raiz = n;
        origem = n === casa ? 'casa' : ehRaizDeDisco(n) ? 'disco' : 'pasta';
      }
    }
    if (estaExcluido(raiz)) return { tipo: 'excluida' };
    const ala = alas.find((a) => a.globs.some((gl) => gl.testar(raiz)));
    const tipoSala = tipoDaSala(raiz, ala?.tipo, pendentes);
    if (tipoSala === null) return esperar(pendentes);
    if (tipoSala === DESCONHECIDA) return { tipo: 'desconhecida' };
    const sala: SalaResolvida = {
      tipo: 'sala',
      chave: `s${hashCurto(`${sal}\u0000${raiz}`, 15)}`,
      nome: nomeDaSala(raiz, original),
      ala: ala?.id ?? cfg.recepcaoId,
      tipoSala,
      raiz,
      origem,
    };
    if (limite === undefined) sala.foraDasRaizes = true;
    return sala;
  }

  return {
    resolver(caminho: string): ResultadoSala {
      const t = agora();
      const c = cache.get(caminho);
      if (c && t - c.quando < validade) return c.r;
      let r: ResultadoSala;
      try {
        r = resolverSemCache(caminho);
      } catch {
        // Defeito ou caminho estranho: falha fechada (sem sala, sem nome).
        r = { tipo: 'excluida' };
      }
      if (r.tipo !== 'pendente' && r.tipo !== 'desconhecida') {
        cache.delete(caminho);
        cache.set(caminho, { quando: t, r });
        podar(cache, limiteResultados);
      }
      return r;
    },
    excluido(caminho: string): boolean {
      if (typeof caminho !== 'string') return true;
      try {
        return estaExcluido(normalizar(caminho, amb));
      } catch {
        return true;
      }
    },
    ehRascunho(caminho: string): boolean {
      if (typeof caminho !== 'string' || rascunhos.length === 0 || ehCaminhoRemoto(caminho)) return false;
      try {
        const n = normalizar(caminho, amb);
        return rascunhos.some((r) => dentroDe(n, r));
      } catch {
        return false;
      }
    },
    limparCache(): void {
      cache.clear();
      sondas.clear();
      cacheTipo.clear();
    },
    tamanhoDosCaches: () => ({ resultados: cache.size, sondas: sondas.size, tipos: cacheTipo.size }),
    sondasAgora() {
      let n = 0;
      for (const r of [...lentas.keys()]) if (raizLenta(r)) n++;
      return { emVoo, esperando: fila.length, lentas: n };
    },
  };
}
