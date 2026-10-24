// Esquema da configuração (arcadia.config.yaml). Os nomes seguem config/arcadia.config.exemplo.yaml.
// Tudo que falta ganha o padrão; chave desconhecida vira aviso (o modo estrito só serve para achá-las).
import { REGEX_ID_ALA, TEMAS_ALA, TIPOS_SALA, z } from '@arcadia/shared';

const QUALIDADES = ['baixo', 'medio', 'alto'] as const;

/** Pastas de apoio padrão: nomes genéricos que não são projeto quando ficam na raiz de uma pasta agregadora. */
export const PASTAS_DE_APOIO_PADRAO = [
  'docs', 'doc', 'tmp', 'temp', 'scripts', 'assets', 'public', 'static', 'dist', 'build', 'out', 'logs', 'data', 'test', 'tests',
  'tools', '.github', '.vscode', '.cache', 'node_modules',
] as const;

export function criarEsquemaConfig(estrito: boolean) {
  const obj = estrito ? z.strictObject : z.object;
  const Porta = z.number().int().min(1).max(65535);
  const Host = z.string().min(1);
  const Ligado = (padrao: boolean) => z.boolean().default(padrao);
  const Cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'cor no formato #rrggbb' });
  const IdAla = z.string().regex(REGEX_ID_ALA, { message: 'id com letras minúsculas, números e hífen' });

  return obj({
    versao: z.literal(1),
    servidor: obj({
      ingestao: obj({ host: Host.default('127.0.0.1'), porta: Porta.default(47800) }).prefault({}),
      visualizacao: obj({ host: Host.default('127.0.0.1'), porta: Porta.default(4780) }).prefault({}),
      pareamento: obj({ validadeCodigoMinutos: z.number().int().min(1).max(60).default(5) }).prefault({}),
      dados: z.string().min(1).default('%LOCALAPPDATA%/Arcadia/dados'),
      retencaoDias: z.number().int().min(1).max(3650).default(180),
    }).prefault({}),
    fontes: obj({
      openmausbot: obj({
        ligado: Ligado(true),
        portas: z.array(Porta).min(1).max(10).default([8799, 18799, 28799]),
        qgPorEquipe: z.record(z.string(), z.string().min(1)).default({}),
      }).prefault({}),
      claudeTranscricoes: obj({
        ligado: Ligado(true),
        pasta: z.string().min(1).default('~/.claude/projects'),
        catchUpHoras: z.number().min(0).max(168).default(24),
      }).prefault({}),
      claudeSessoesVivas: obj({ ligado: Ligado(true), pasta: z.string().min(1).default('~/.claude/sessions') }).prefault({}),
      codexRollouts: obj({ ligado: Ligado(true), pasta: z.string().min(1).default('~/.codex/sessions') }).prefault({}),
      claudeHooks: obj({ ligado: Ligado(false) }).prefault({}),
      codexHooks: obj({ ligado: Ligado(false) }).prefault({}),
      git: obj({ ligado: Ligado(false) }).prefault({}),
      otel: obj({ ligado: Ligado(false) }).prefault({}),
    }).prefault({}),
    privacidade: obj({
      mostrarNomeCurtoDoArquivo: z.boolean().default(false),
      mostrarTituloDaTarefa: z.boolean().default(true),
    }).prefault({}),
    mundo: obj({
      fuso: z.string().min(1).default('America/Sao_Paulo'),
      fps: obj({ pc: z.number().int().min(10).max(240).default(60), celular: z.number().int().min(10).max(120).default(30) }).prefault({}),
      qualidade: obj({ pc: z.enum(QUALIDADES).default('alto'), celular: z.enum(QUALIDADES).default('medio') }).prefault({}),
      ocio: obj({
        pausaMinutos: z.number().min(0.1).max(600).default(3),
        dormeMinutos: z.number().min(0.2).max(1440).default(20),
      }).prefault({}),
    }).prefault({}),
    alas: z
      .array(
        obj({
          id: IdAla,
          nome: z.string().min(1).max(48),
          cor: Cor,
          regras: z.array(z.string().min(1)).default([]),
          /** Opcional: tipo de sala padrão desta ala (web, app, video, backend, pesquisa, outro). */
          tipo: z.enum(TIPOS_SALA).optional(),
          /** Opcional: tema do lote no mundo (equipe, agencia, estudio...). Sem ele, o mundo escolhe pelo conteúdo. */
          tema: z.enum(TEMAS_ALA).optional(),
        }),
      )
      .default([]),
    recepcao: obj({
      id: IdAla.default('recepcao'),
      nome: z.string().min(1).max(48).default('Recepção'),
      cor: Cor.default('#ffe08a'),
    }).prefault({}),
    salas: obj({
      pastasAgregadoras: z.array(z.string().min(1)).default([]),
      excluir: z.array(z.string().min(1)).default([]),
      apelidos: z.record(z.string().min(1), z.string().min(1).max(48)).default({}),
      /** Pastas de apoio (só o nome): filha direta de agregadora com um destes nomes conta para a sala da agregadora. */
      pastasDeApoio: z.array(z.string().min(1).max(64).regex(/^[^\\/]+$/, { message: 'só o nome da pasta, sem barra' })).default([...PASTAS_DE_APOIO_PADRAO]),
      /** Pastas de rascunho: arquivo ali nunca cria sala nem move o agente; o cwd ali continua criando sala. */
      rascunho: z.array(z.string().min(1)).default(['%TEMP%']),
    }).prefault({}),
    personagens: obj({
      pacoteLocal: z.string().optional(),
      humanos: z.array(z.unknown()).default([]),
    }).prefault({}),
  });
}

export type Config = z.infer<ReturnType<typeof criarEsquemaConfig>>;
