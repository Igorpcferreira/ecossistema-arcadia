// Estado do mundo (o que o snapshot e o SSE levam aos clientes) e o protocolo de transmissão.
// Os esquemas são estritos: campo a mais é erro. Servem de contrato com o cliente e de allowlist da saída nos testes.
import { z } from 'zod';
import {
  CATEGORIAS_FERRAMENTA, MOTORES, ORIGENS, REGEX_ID, REGEX_ID_ALA, TIPOS_AGENTE, TIPOS_ESPERA, TIPOS_EVENTO,
  TIPOS_SALA, EsquemaArcadiaEvent,
} from './evento.ts';
import { LIMITES } from './saneamento.ts';

export const ESTADOS_AGENTE = [
  'chegando', 'pensando', 'lendo', 'editando', 'comando', 'trabalhando', 'delegando',
  'esperando', 'talvez-esperando', 'erro', 'entregou', 'ocioso', 'pausa', 'dormindo',
  'na-fila', 'sem-sinal', 'limite', 'saindo',
] as const;
export type EstadoAgente = (typeof ESTADOS_AGENTE)[number];

export const ESTADOS_FONTE = ['ligada', 'desligada', 'aguardando', 'erro', 'simulada'] as const;
export type EstadoFonte = (typeof ESTADOS_FONTE)[number];

const Id = z.string().regex(REGEX_ID);
const IdAla = z.string().regex(REGEX_ID_ALA);
const Num = z.number().nonnegative();
const Int = z.number().int().nonnegative();

export const EsquemaAla = z.strictObject({
  id: IdAla,
  nome: z.string().max(LIMITES.sala),
  cor: z.string().max(16),
  /** Ordem de criação: define o lote no andar e nunca muda. */
  ordem: Int,
  lote: z.strictObject({ col: Int, lin: Int }),
  tipo: z.enum(['projetos', 'recepcao']),
  /** Falso quando a ala saiu da configuração: ela continua no andar, porque salas nunca somem. */
  ativa: z.boolean(),
  criadaEm: Num,
});

export const EsquemaSala = z.strictObject({
  chave: Id,
  nome: z.string().max(LIMITES.sala),
  alaId: IdAla,
  tipo: z.enum(TIPOS_SALA),
  /** Terreno dentro da ala, gravado: a sala fica sempre no mesmo lugar. */
  terreno: z.strictObject({ indice: Int, col: Int, lin: Int }),
  andar: Int,
  criadaEm: Num,
  ultimaAtividade: Num,
  dormindo: z.boolean(),
  entregas: Int,
  erros: Int,
  entregasHoje: Int,
  errosHoje: Int,
});

export const EsquemaAcao = z.strictObject({
  ts: Num,
  tipo: z.enum(TIPOS_EVENTO),
  categoria: z.enum(CATEGORIAS_FERRAMENTA).optional(),
  nome: z.string().max(64).optional(),
  alvo: z.string().max(LIMITES.alvo).optional(),
  ok: z.boolean().optional(),
});

export const EsquemaAgente = z.strictObject({
  chave: Id,
  tipo: z.enum(TIPOS_AGENTE),
  motor: z.enum(MOTORES),
  origem: z.enum(ORIGENS),
  nome: z.string().max(LIMITES.nome).optional(),
  cargo: z.string().max(LIMITES.cargo).optional(),
  cor: z.string().max(16).optional(),
  corpo: z.string().max(24).optional(),
  paiChave: Id.optional(),
  equipe: z.string().max(LIMITES.equipe).optional(),
  estado: z.enum(ESTADOS_AGENTE),
  /** Desde quando o estado visível é este (ms). */
  desde: Num,
  salaChave: Id.optional(),
  /** Título saneado da tarefa, só quando a configuração permite. */
  tarefa: z.string().max(LIMITES.titulo).optional(),
  ferramenta: z
    .strictObject({ nome: z.string().max(64), categoria: z.enum(CATEGORIAS_FERRAMENTA), alvo: z.string().max(LIMITES.alvo).optional() })
    .optional(),
  espera: z.strictObject({ tipo: z.enum(TIPOS_ESPERA), desde: Num }).optional(),
  ultimasAcoes: z.array(EsquemaAcao).max(10),
  uso: z.strictObject({ entrada: Num, saida: Num, cache: Num, custoUsd: Num }),
  chegouEm: Num,
  ultimaAtividade: Num,
  entregasHoje: Int,
  errosHoje: Int,
});

export const EsquemaDelegacao = z.strictObject({
  chave: Id,
  de: Id,
  para: Id,
  jobId: Id.optional(),
  titulo: z.string().max(LIMITES.titulo).optional(),
  status: z.string().max(LIMITES.status).optional(),
  desde: Num,
  atualizadaEm: Num,
});

export const EsquemaItemPrecisaDeVoce = z.strictObject({
  agenteChave: Id,
  tipo: z.enum(['permissao', 'pergunta', 'aprovacao']),
  desde: Num,
  salaChave: Id.optional(),
});

export const EsquemaMetricas = z.strictObject({
  /** Dia no fuso da configuração, em dd/mm/aaaa. */
  dia: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  entregas: Int,
  erros: Int,
  ferramentas: Int,
  turnos: Int,
  pedidos: Int,
  delegacoes: Int,
  esperas: Int,
  tokens: z.strictObject({ entrada: Int, saida: Int, cache: Int }),
  custoUsd: Num,
  agentes: Int,
  salas: Int,
});

export const EsquemaSaudeFonte = z.strictObject({
  estado: z.enum(ESTADOS_FONTE),
  mensagem: z.string().max(160).optional(),
  ultimoEvento: Num.optional(),
  eventos: Int,
  ignoradas: Int,
  versao: z.string().max(32).optional(),
});

export const EsquemaSaude = z.strictObject({
  fontes: z.record(z.string().regex(/^[a-z][a-z-]{1,31}$/), EsquemaSaudeFonte),
});

export const EsquemaObra = z.strictObject({
  salaChave: Id,
  alaId: IdAla,
  inicio: Num,
  fim: Num,
});

export const EsquemaEstadoMundo = z.strictObject({
  v: z.literal(1),
  agora: Num,
  alas: z.record(IdAla, EsquemaAla),
  salas: z.record(Id, EsquemaSala),
  agentes: z.record(Id, EsquemaAgente),
  delegacoes: z.record(Id, EsquemaDelegacao),
  precisaDeVoce: z.array(EsquemaItemPrecisaDeVoce),
  metricas: EsquemaMetricas,
  saude: EsquemaSaude,
  obras: z.array(EsquemaObra),
});

export type Ala = z.infer<typeof EsquemaAla>;
export type Sala = z.infer<typeof EsquemaSala>;
export type Acao = z.infer<typeof EsquemaAcao>;
export type Agente = z.infer<typeof EsquemaAgente>;
export type Delegacao = z.infer<typeof EsquemaDelegacao>;
export type ItemPrecisaDeVoce = z.infer<typeof EsquemaItemPrecisaDeVoce>;
export type Metricas = z.infer<typeof EsquemaMetricas>;
export type SaudeFonte = z.infer<typeof EsquemaSaudeFonte>;
export type Saude = z.infer<typeof EsquemaSaude>;
export type Obra = z.infer<typeof EsquemaObra>;
export type EstadoMundo = z.infer<typeof EsquemaEstadoMundo>;

// Transmissão: GET /api/snapshot e GET /api/events (SSE).

/** Corpo do `GET /api/snapshot`. O `seq` é o do último quadro já incluído no estado. */
export const EsquemaSnapshot = z.strictObject({
  v: z.literal(1),
  seq: Int,
  buildId: z.string().max(64),
  instancia: z.string().max(64),
  geradoEm: Num,
  estado: EsquemaEstadoMundo,
});

export type Snapshot = z.infer<typeof EsquemaSnapshot>;

/** Uma mudança dentro de um quadro. Entidades vão inteiras (o cliente substitui); `evento` é semântico (animação). */
export const EsquemaMudanca = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('agente'), agente: EsquemaAgente }),
  z.strictObject({ k: z.literal('agente.saiu'), chave: Id }),
  z.strictObject({ k: z.literal('sala'), sala: EsquemaSala }),
  z.strictObject({ k: z.literal('ala'), ala: EsquemaAla }),
  z.strictObject({ k: z.literal('delegacao'), delegacao: EsquemaDelegacao }),
  z.strictObject({ k: z.literal('delegacao.fim'), chave: Id }),
  z.strictObject({ k: z.literal('precisaDeVoce'), itens: z.array(EsquemaItemPrecisaDeVoce) }),
  z.strictObject({ k: z.literal('metricas'), metricas: EsquemaMetricas }),
  z.strictObject({ k: z.literal('saude'), saude: EsquemaSaude }),
  z.strictObject({ k: z.literal('obra'), obra: EsquemaObra }),
  z.strictObject({ k: z.literal('obra.fim'), salaChave: Id }),
  z.strictObject({ k: z.literal('evento'), evento: EsquemaArcadiaEvent }),
]);
export type Mudanca = z.infer<typeof EsquemaMudanca>;

/** `event: mundo`: um quadro com as mudanças agrupadas em até 250 ms. O `id:` do SSE é o `seq`. */
export const EsquemaQuadro = z.strictObject({
  seq: Int,
  ts: Num,
  mudancas: z.array(EsquemaMudanca),
});
export type Quadro = z.infer<typeof EsquemaQuadro>;

/** `event: ola`: primeira mensagem da conexão. Se o `buildId` mudou, o cliente recarrega a página. */
export const EsquemaOla = z.strictObject({
  seq: Int,
  buildId: z.string().max(64),
  instancia: z.string().max(64),
  versaoEsquema: z.literal(1),
});
export type Ola = z.infer<typeof EsquemaOla>;

/** `event: resync`: faltam quadros (buffer estourado ou servidor reiniciado). O cliente refaz o snapshot. */
export const EsquemaResync = z.strictObject({
  motivo: z.enum(['seq-ausente', 'seq-futuro']),
  seq: Int,
});
export type Resync = z.infer<typeof EsquemaResync>;

/** Tipos de evento do SSE. `ping` vem a cada 15 s, sem `id`. */
export const EVENTOS_SSE = ['ola', 'mundo', 'resync', 'ping'] as const;
