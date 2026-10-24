// Formato de cena do Arcadia: tudo o que o mundo desenha vem destes dados.
// Dois níveis:
//   Planta: o que o servidor (Fase 3) ou um arquivo de configuração sabe dizer: lotes do andar,
//           alas com tema, salas, personagens e textos. É curta e cabe num JSON.
//   CenaDados: a cena expandida pelo gerador (cena/gerador.ts): zonas com retângulo, objetos
//           com posição, pontos de interesse, linhas de dados, janelas e letreiros.
// Nenhum nome de projeto, equipe ou pessoa fica no código: eles chegam por aqui.

export type Estado =
  | 'ocioso' | 'pensando' | 'lendo' | 'editando' | 'comando' | 'esperando' | 'talvez' | 'erro'
  | 'entregou' | 'delegando' | 'treinando' | 'pausa' | 'chegando' | 'fila' | 'semSinal' | 'limite' | 'dormindo';

export const ESTADOS: readonly Estado[] = [
  'ocioso', 'pensando', 'lendo', 'editando', 'comando', 'esperando', 'talvez', 'erro',
  'entregou', 'delegando', 'treinando', 'pausa', 'chegando', 'fila', 'semSinal', 'limite', 'dormindo',
];

export type Pose = 'parado' | 'andar' | 'digitando' | 'operando' | 'levantar' | 'pose' | 'correr' | 'beber' | 'jogar' | 'acenar' | 'dormir';

export type EstiloPiso =
  | 'corredor' | 'servidor' | 'madeira' | 'azulejo' | 'estudio' | 'carpete' | 'nucleo' | 'academia'
  | 'lounge' | 'recepcao' | 'produtos' | 'cockpit' | 'laboratorio' | 'deposito';

/** Tema de uma zona: decide a mobília, os postos de trabalho e os pontos de interesse. */
export type Tema =
  | 'servidores' | 'equipe' | 'agencia' | 'estudio' | 'corporativo' | 'nucleo' | 'academia'
  | 'lounge' | 'recepcao' | 'produtos' | 'cockpit' | 'laboratorio' | 'pessoal' | 'bastidores' | 'livre';

/* ---------- Aparências ---------- */
export type Acessorio = 'headset' | 'boina' | 'fone' | 'lupa' | 'monoculo' | 'gravata' | 'gravatinha' | 'brilho' | 'capacete' | 'chave' | 'nenhum';

export interface AparenciaAndroide {
  tipo: 'androide';
  /** Cor do papel (corpo). */
  papel: string;
  casco?: string;
  visor?: string;
  olho?: string;
  acessorio?: Acessorio;
  /** Nome de um conjunto feito à mão (arte/maoFeita.ts) para o passe à mão. */
  maoFeita?: string;
  /** Corpo do mascote no OpenMausBot (cursor, circle, shield...): vira o emblema do peito. */
  corpo?: string;
}

export interface MapaMao {
  /** Letra para cor. '.' é transparente. */
  paleta: Record<string, string>;
  /** Linhas de pixels da cabeça (com cabelo) de frente e de costas. */
  cabeca: string[];
  cabecaCostas?: string[];
  /** Tronco de frente e de costas (sem braços). */
  tronco?: string[];
  troncoCostas?: string[];
}

export interface AparenciaHumano {
  tipo: 'humano';
  pele: string;
  peleSombra: string;
  cabelo: { estilo: string; cor: string; luz: string; sombra: string };
  barba?: { estilo: 'cavanhaque' | 'cheia' | 'bigode'; cor: string };
  /** Camisa ou blusa. */
  roupa: string;
  roupaSombra: string;
  detalhe?: string;
  mangas: 'curtas' | 'longas' | 'nenhuma';
  calca: string;
  sapato: string;
  sola?: string;
  corrente?: string;
  relogio?: string;
  /**
   * Tatuagem: sem `manga`, marcas soltas nos antebraços. Com `manga`, o braço daquele lado (do
   * personagem) fica tatuado do ombro ao pulso, e `ombro` é a cor de um desenho redondo no alto dele.
   */
  tatuagem?: { cores: string[]; manga?: 'esquerda' | 'direita'; ombro?: string };
  batom?: string;
  bochecha?: string;
  olhos?: string;
  /** Número na camisa (estilo futebol americano) ou outra estampa curta. */
  estampa?: { texto: string; cor: string };
  /** Mapas feitos à mão por tamanho de personagem ('16' e '24'). */
  maoFeita?: Partial<Record<'16' | '24', MapaMao>>;
  /** Boné (cor), por cima do cabelo, com a aba para a frente. */
  bone?: string;
  /** Jaqueta aberta por cima da camisa: cor do corpo, das mangas e do friso da barra. */
  jaqueta?: { cor: string; manga: string; friso?: string };
  /**
   * Roupa alternativa: só os campos que mudam. Sai num sorteio por dia (data de São Paulo, semente do
   * mundo e chave da aparência), perto de um dia em `umDiaEm` (padrão 3). Ver `cena/roupa.ts`.
   */
  variante?: Partial<Omit<AparenciaHumano, 'tipo' | 'variante'>> & { umDiaEm?: number };
}

/** Figurantes que não são humanoides: gato do Cockpit e robô de limpeza. */
export interface AparenciaCriatura {
  tipo: 'gato' | 'robo';
  cor: string;
  detalhe?: string;
}

export type Aparencia = AparenciaAndroide | AparenciaHumano | AparenciaCriatura;

/* ---------- Personagens ---------- */
/** Papel na simulação: muda o comportamento, nunca o nome. */
export type PapelSim = 'agente' | 'coordenador' | 'dono' | 'fixo' | 'visitante' | 'recepcionista' | 'figurante';

/**
 * Tipo de agente, com os mesmos valores do campo `tipo` do agente no servidor (packages/shared):
 * 'bot' nunca vai embora e, parado, fica na cápsula de recarga da própria ala; 'sessao' chega e
 * sai pelo teletransporte; 'subagente' some quando para.
 */
export type TipoAgente = 'bot' | 'sessao' | 'subagente';

export interface Falas {
  saudacao?: string;
  aprovar?: string;        // aceita {curto}
  bomTreino?: string;
  volta?: string;          // aceita {dono}
  cafe?: string;
  status?: string[];
  inicio?: string;
}

export interface Personagem {
  id: string;
  nome: string;
  curto: string;
  cargo: string;
  tipo: 'agente' | 'humano' | 'npc';
  papel: PapelSim;
  aparencia: string;
  zona: string;
  casa: [number, number];
  poseCasa: Pose;
  /** Mesa ou console ligado ao personagem (índice em objetos): acende o holograma. */
  mesa?: number;
  equipe?: string;
  motor?: 'claude' | 'codex' | 'outro';
  tarefas?: [Estado, string][];
  tarefaInicial?: string;
  visivel?: boolean;
  falas?: Falas;
  /** Só agentes: bot, sessão ou subagente (padrão: bot quando tem equipe, senão sessão). */
  tipoAgente?: TipoAgente;
  /** Ladrilho da cápsula de recarga do bot na própria ala (o gerador escolhe). */
  recarga?: [number, number];
  /** Começa parado: o bot na cápsula, a sessão fora do andar. */
  dormindo?: boolean;
}

/* ---------- Cena expandida ---------- */
export interface Zona {
  id: string;
  /** Rótulo curto em maiúsculas (letreiro). */
  nome: string;
  titulo: string;
  texto: string;
  tipo: 'ala' | 'area';
  tema: Tema;
  i0: number; i1: number; j0: number; j1: number;
  cor: string;
  piso: EstiloPiso;
  /** Cor da parede quando a zona encosta numa parede do fundo. */
  parede?: string;
  /** Placa flutuante com o nome (zonas sem parede). */
  placa?: boolean;
}

/**
 * Sala de projeto dentro de uma ala. `dormindo` e `ultimaAtividade` têm o mesmo nome e o mesmo
 * sentido dos campos da sala no servidor (packages/shared/src/estado.ts): a sala dorme depois de
 * `ocio.dormeMinutos` sem atividade, e a ala fica em espera (stand-by) quando todas as salas
 * dela dormem e nenhum agente trabalha nela.
 */
export interface Sala {
  id: string;
  nome: string;
  zona: string;
  i: number; j: number; w: number; d: number;
  estilo: 'pod' | 'sala';
  dormindo: boolean;
  /** Milissegundos desde 1970, como no servidor. */
  ultimaAtividade: number;
}

export type ValorProp = string | number | boolean | string[];

export interface Objeto {
  tipo: string;
  i: number;
  j: number;
  props?: Record<string, ValorProp>;
}

export interface Janela { parede: 'I' | 'J'; u0: number; u1: number; lua?: number }
export interface Letreiro { parede: 'I' | 'J'; texto: string; u: number; cor: string; zona?: string }

/** Tempos de ócio, com os nomes da configuração do servidor (mundo.ocio). */
export interface Ocio { pausaMinutos: number; dormeMinutos: number }

/**
 * Roteiro do cenário simulado (segundos desde o início): abrir ou fechar a sessão de um agente,
 * o coordenador delegar a um bot (que acorda se estiver na cápsula) ou o dono pedir algo a alguém.
 */
export interface EventoAgenda { t: number; acao: 'abrirSessao' | 'fecharSessao' | 'delegar' | 'pedir'; quem: string }
export interface DecoParede { parede: 'I' | 'J'; tipo: 'sites' | 'onAir' | 'xadrez' | 'neon' | 'poster' | 'quadroAvisos'; u0: number; u1: number; cor?: string; texto?: string }
export interface Linha { zona: string; pontos: [number, number][] }
export interface Tapete { i0: number; j0: number; i1: number; j1: number; cor: string; borda?: string; listras?: string }
export interface Spot { t: [number, number]; pose: Pose; txt: string; z?: number; costas?: boolean }

/**
 * Lugar de trabalho numa zona, para quem chega depois da carga (os agentes do servidor): a mesa
 * do tema (com o índice do objeto, que acende o holograma), a cápsula de uma sala (pod) ou um
 * lugar em pé. `ocupadoPor` é quem a planta já pôs ali.
 */
export interface PostoCena { casa: [number, number]; pose: Pose; tipo: 'mesa' | 'pod' | 'pe'; mesa?: number; papel?: 'coordenador'; ocupadoPor?: string }

export interface CenaDados {
  versao: 1;
  nome: string;
  andar: { ni: number; nj: number; parede: number };
  zonas: Zona[];
  salas: Sala[];
  objetos: Objeto[];
  personagens: Personagem[];
  aparencias: Record<string, Aparencia>;
  janelas: Janela[];
  letreiros: Letreiro[];
  decoracoes: DecoParede[];
  linhas: Linha[];
  tapetes: Tapete[];
  pontos: {
    nucleo: [number, number];
    teletransporte: [number, number];
    recepcao: [number, number];
    fila: [number, number][];
    terreno?: { i: number; j: number; w: number; d: number; zona: string };
    treinos: Spot[];
    pausas: Spot[];
    passeio: [number, number][];
  };
  textos: TextosSim;
  /** Ordem das zonas no passeio da câmera (modo aquário). */
  roteiro: string[];
  ocio: Ocio;
  agenda: EventoAgenda[];
  /** Postos de trabalho de cada zona (mesas do tema e lugares em pé). */
  postos: Record<string, PostoCena[]>;
  /** Terrenos de 2 por 2 de cada zona onde cabe a cápsula de uma sala, na ordem em que são usados. */
  vagasPod: Record<string, [number, number][]>;
  /** Lugares livres de cada zona para a cápsula de recarga de um bot que chega depois. */
  vagasRecarga: Record<string, [number, number][]>;
}

export interface TextosSim {
  pedidos: string[];
  delegacoes: string[];
  erro: string;
  erroTicker: string;
  entrega: string;
  esperando: string;
  subagente: string;
  visitante: { chegada: string; tarefas: [Estado, string][] };
  obra: { nome: string; salaNome: string; agente: { nome: string; curto: string; cargo: string; aparencia: string; tarefas: [Estado, string][] } };
}

/* ---------- Planta (entrada curta do gerador) ---------- */
export interface LotePlanta {
  zona: string;
  nome: string;
  titulo?: string;
  texto?: string;
  tipo: 'ala' | 'area';
  tema: Tema;
  cor: string;
  col: number;
  lin: number;
  /** Quantas colunas e linhas de lote a zona ocupa (os corredores entre elas viram piso da zona). */
  cols?: number;
  lins?: number;
  piso?: EstiloPiso;
  /** Nomes das salas (pods) quando o tema é de produtos. */
  salas?: string[];
  /** Propriedades extras do tema (vitrine, colunas do quadro etc.). */
  extras?: Record<string, ValorProp>;
  /** Estado inicial das salas da ala (o servidor manda sala por sala). Padrão: acordada. */
  dormindo?: boolean;
  /** Última atividade das salas, em ms desde 1970. Sem ela, o mundo estima pela semente. */
  ultimaAtividade?: number;
}

export interface PersonagemPlanta {
  id: string;
  nome: string;
  curto: string;
  cargo: string;
  tipo: 'agente' | 'humano' | 'npc';
  papel: PapelSim;
  aparencia: string;
  zona: string;
  equipe?: string;
  motor?: 'claude' | 'codex' | 'outro';
  tarefas?: [Estado, string][];
  tarefaInicial?: string;
  visivel?: boolean;
  falas?: Falas;
  /** Posto preferido dentro da zona (índice); sem ele, o próximo livre. */
  posto?: number;
  tipoAgente?: TipoAgente;
  dormindo?: boolean;
}

export interface Planta {
  versao: 1;
  nome: string;
  colunas: number[];
  linhas: number[];
  corredor: number;
  parede: number;
  lotes: LotePlanta[];
  personagens: PersonagemPlanta[];
  aparencias: Record<string, Aparencia>;
  textos: TextosSim;
  roteiro?: string[];
  ocio?: Ocio;
  agenda?: EventoAgenda[];
}

/* ---------- Pacote de personagens (local, fora do Git) ---------- */
export interface PersonagemPacote {
  /** Papel que o personagem ocupa na cena: 'dono' ou 'fixo' (ou o id de um personagem da planta). */
  papel: string;
  nome: string;
  curto: string;
  cargo?: string;
  tarefaInicial?: string;
  aparencia: AparenciaHumano | AparenciaAndroide;
  falas?: Falas;
}

export interface PacotePersonagens {
  versao: 1;
  descricao?: string;
  personagens: PersonagemPacote[];
}
