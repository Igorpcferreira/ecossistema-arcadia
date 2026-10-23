// Evento canônico do Arcadia (prompt, seção 5.3). Todo adaptador traduz a sua fonte para este formato.
// O esquema é a allowlist: campo que não está aqui é descartado na entrada. Não existe campo de conteúdo bruto.
//
// Extensões opcionais em relação ao ponto de partida da seção 5.3 (os nomes originais ficaram iguais):
//   local.sala      dados para a sala nascer (apelido, ala e tipo), decididos pelo servidor a partir do caminho;
//   ferramenta.id   identificador da chamada, para casar início e fim da mesma ferramenta;
//   tarefa          tarefa saneada do agente (chave e título, o título só quando a configuração permitir);
//   turno           chave do turno, o sinal "saída só de texto" usado pelo timer de 5 s e o fim por interrupção;
//   presenca        tipo novo: estado de presença que a fonte informa sem ser um turno (bot na fila, sem sinal,
//                   ativo, ocioso ou esperando você, vindo do snapshot do OpenMausBot). Não mexe nas métricas;
//   local.excluida  o servidor marcou o agente por pasta excluída: na sessão, nome e tarefa somem de vez; no bot,
//                   a tarefa e os nomes de arquivo somem até o próximo turno (o nome fica).
import { z } from 'zod';

export const VERSAO_ESQUEMA = 1;

export const ORIGENS = ['omb', 'claude-transcricao', 'claude-hook', 'codex-rollout', 'codex-hook', 'dominio', 'git', 'sim'] as const;
export const MOTORES = ['claude', 'codex', 'outro'] as const;
export const TIPOS_AGENTE = ['bot', 'sessao', 'subagente', 'humano'] as const;
export const TIPOS_EVENTO = [
  'sessao.inicio', 'sessao.fim', 'pedido.humano',
  'turno.inicio', 'turno.fim', 'pensando',
  'ferramenta.inicio', 'ferramenta.fim', 'ferramenta.erro',
  'espera.inicio', 'espera.fim',
  'delegacao.enviada', 'delegacao.recebida', 'delegacao.concluida',
  'subagente.inicio', 'subagente.fim',
  'compactacao', 'erro', 'limite', 'uso', 'entrega', 'dominio', 'presenca',
] as const;
export const CATEGORIAS_FERRAMENTA = ['ler', 'editar', 'comando', 'web', 'navegador', 'delegar', 'integracao', 'outro'] as const;
export const TIPOS_ESPERA = ['permissao', 'pergunta', 'aprovacao', 'talvez'] as const;
export const TIPOS_SALA = ['web', 'app', 'video', 'backend', 'pesquisa', 'outro'] as const;
export const ESTADOS_PRESENCA = ['ativo', 'ocioso', 'esperando', 'na-fila', 'sem-sinal'] as const;

export type Origem = (typeof ORIGENS)[number];
export type Motor = (typeof MOTORES)[number];
export type TipoAgente = (typeof TIPOS_AGENTE)[number];
export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export type CategoriaFerramenta = (typeof CATEGORIAS_FERRAMENTA)[number];
export type TipoEspera = (typeof TIPOS_ESPERA)[number];
export type TipoSala = (typeof TIPOS_SALA)[number];
export type EstadoPresenca = (typeof ESTADOS_PRESENCA)[number];

/** Identificadores: letras, números e `: . _ -`. Nada de espaço, barra ou caminho. */
export const REGEX_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
/** Ids de ala vêm da configuração: minúsculas, números e hífen. */
export const REGEX_ID_ALA = /^[a-z0-9][a-z0-9-]{0,31}$/;

const Id = z.string().regex(REGEX_ID);
const IdAla = z.string().regex(REGEX_ID_ALA);
const Numero = z.number().nonnegative();

export const EsquemaAgenteRef = z.object({
  chave: Id,
  tipo: z.enum(TIPOS_AGENTE),
  nome: z.string().optional(),
  cargo: z.string().optional(),
  cor: z.string().optional(),
  corpo: z.string().optional(),
  paiChave: Id.optional(),
});

export const EsquemaSalaNascendo = z.object({
  nome: z.string(),
  ala: IdAla.optional(),
  tipo: z.enum(TIPOS_SALA).optional(),
});

export const EsquemaLocalEvento = z.object({
  projetoChave: Id.optional(),
  equipe: z.string().optional(),
  sala: EsquemaSalaNascendo.optional(),
  /**
   * O agente está marcado por pasta da lista de exclusão: o mundo apaga o nome e a tarefa da sessão e não mostra mais;
   * do bot, apaga a tarefa e os nomes de arquivo até o próximo turno (o nome do bot fica).
   */
  excluida: z.literal(true).optional(),
});

export const EsquemaFerramentaEvento = z.object({
  nome: z.string(),
  categoria: z.enum(CATEGORIAS_FERRAMENTA),
  alvo: z.string().optional(),
  ok: z.boolean().optional(),
  duracaoMs: Numero.optional(),
  id: Id.optional(),
});

export const EsquemaEsperaEvento = z.object({ tipo: z.enum(TIPOS_ESPERA) });

export const EsquemaDelegacaoEvento = z.object({
  de: Id,
  para: Id,
  jobId: Id.optional(),
  titulo: z.string().optional(),
  status: z.string().optional(),
});

export const EsquemaUsoEvento = z.object({
  entrada: Numero.optional(),
  saida: Numero.optional(),
  cache: Numero.optional(),
  custoUsd: Numero.optional(),
});

export const EsquemaTarefaEvento = z.object({
  chave: Id.optional(),
  titulo: z.string().optional(),
});

export const EsquemaTurnoEvento = z.object({
  chave: Id.optional(),
  /** O assistente escreveu texto sem ferramenta pendente: se nada mais chegar em 5 s, o turno acabou. */
  texto: z.boolean().optional(),
  /** Num turno.fim: o turno acabou porque alguém interrompeu (não conta como entrega). */
  interrompido: z.boolean().optional(),
});

export const EsquemaPresencaEvento = z.object({ estado: z.enum(ESTADOS_PRESENCA) });

export const EsquemaArcadiaEvent = z
  .object({
    v: z.literal(1),
    id: Id,
    ts: Numero,
    recebidoEm: Numero,
    origem: z.enum(ORIGENS),
    motor: z.enum(MOTORES),
    agente: EsquemaAgenteRef,
    local: EsquemaLocalEvento,
    tipo: z.enum(TIPOS_EVENTO),
    ferramenta: EsquemaFerramentaEvento.optional(),
    espera: EsquemaEsperaEvento.optional(),
    delegacao: EsquemaDelegacaoEvento.optional(),
    uso: EsquemaUsoEvento.optional(),
    tarefa: EsquemaTarefaEvento.optional(),
    turno: EsquemaTurnoEvento.optional(),
    presenca: EsquemaPresencaEvento.optional(),
  })
  .superRefine((ev, ctx) => {
    const exige = (campo: 'ferramenta' | 'espera' | 'delegacao' | 'uso' | 'presenca') => {
      if (ev[campo] === undefined) ctx.addIssue({ code: 'custom', path: [campo], message: `o tipo ${ev.tipo} exige o campo ${campo}` });
    };
    if (ev.tipo.startsWith('ferramenta.')) exige('ferramenta');
    if (ev.tipo === 'espera.inicio') exige('espera');
    if (ev.tipo.startsWith('delegacao.')) exige('delegacao');
    if (ev.tipo === 'uso') exige('uso');
    if (ev.tipo === 'presenca') exige('presenca');
  });

export type ArcadiaEvent = z.infer<typeof EsquemaArcadiaEvent>;
export type AgenteRef = z.infer<typeof EsquemaAgenteRef>;
export type LocalEvento = z.infer<typeof EsquemaLocalEvento>;
export type FerramentaEvento = z.infer<typeof EsquemaFerramentaEvento>;
export type DelegacaoEvento = z.infer<typeof EsquemaDelegacaoEvento>;
export type UsoEvento = z.infer<typeof EsquemaUsoEvento>;

/** Origens que trazem sinal exato de espera e de fim de turno (não precisam dos timers de heurística). */
export const ORIGENS_EXATAS: ReadonlySet<Origem> = new Set<Origem>(['omb', 'claude-hook', 'codex-hook']);
