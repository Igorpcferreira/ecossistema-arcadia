// Peças comuns dos adaptadores: interface, categoria de ferramenta pelo nome e leitura tolerante de campos.
import path from 'node:path';
import type { CategoriaFerramenta, EstadoFonte } from '@arcadia/shared';
import type { EntradaBruta } from '../nucleo.ts';

export type Emissor = (entrada: EntradaBruta) => void;

export type DiagnosticoAdaptador = {
  /** Estado para a saúde do mundo. */
  estado: EstadoFonte;
  /** Frase curta em português para o doctor. */
  resumo: string;
  linhas: string[];
  contadores: Record<string, number>;
  /** Tipos de linha ou de quadro que o adaptador não conhece (formato novo): nome e contagem. */
  desconhecidos: Record<string, number>;
  ultimoEvento?: number;
  versao?: string;
};

export type Adaptador = {
  /** Id da fonte na saúde do mundo e no doctor. */
  readonly id: string;
  readonly nome: string;
  iniciar(): Promise<void>;
  parar(): Promise<void>;
  diagnostico(): DiagnosticoAdaptador;
};

const LER = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'read_file', 'list_dir', 'grep_files', 'view_image', 'ToolSearch']);
const EDITAR = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const COMANDO = new Set([
  'Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'shell', 'exec_command', 'write_stdin',
  'local_shell', 'unified_exec', 'exec', 'js',
]);
const WEB = new Set(['WebFetch', 'WebSearch', 'web_search', 'run']);
const DELEGAR = new Set([
  'Task', 'Agent', 'SendMessage', 'Workflow', 'spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'list_agents',
  'coordinate_bots',
]);

/** Categoria pelo nome da ferramenta. Nome de MCP vira integração (ou navegador, se for de navegador). */
export function categoriaDaFerramenta(nome: string): CategoriaFerramenta {
  const n = nome.trim();
  const curto = n.replace(/^mcp__(?:(?!__).)+__/, '');
  for (const candidato of [n, curto]) {
    if (LER.has(candidato)) return 'ler';
    if (EDITAR.has(candidato)) return 'editar';
    if (COMANDO.has(candidato)) return 'comando';
    if (WEB.has(candidato)) return 'web';
    if (DELEGAR.has(candidato)) return 'delegar';
  }
  if (/^mcp__/i.test(n) || n.includes('__')) return /browser|chrome|playwright|puppeteer|navegador/i.test(n) ? 'navegador' : 'integracao';
  return 'outro';
}

export function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function numero(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Instante de uma linha: ISO ou milissegundos. Sem data válida, devolve o padrão. */
export function instante(v: unknown, padrao: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return padrao;
}

/** Nome de tipo para o doctor: só letras, números e separadores simples (nunca conteúdo). */
export function nomeDeTipo(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,48}$/.test(v) ? v : '(sem tipo)';
}

/** Caminho absoluto de um arquivo citado por uma ferramenta (relativo ao cwd da sessão, se preciso). */
export function absoluto(caminho: string, cwd: string | undefined): string | undefined {
  if (path.win32.isAbsolute(caminho) || path.posix.isAbsolute(caminho)) return caminho;
  return cwd ? path.resolve(cwd, caminho) : undefined;
}

/** Pasta privada de tarefa do OpenMausBot (o projeto de verdade vem da tarefa ou do QG da equipe). */
export function ehPastaPrivadaOmb(cwd: string | undefined): boolean {
  return typeof cwd === 'string' && /[\\/]\.openmausbot[\\/]task-workspaces[\\/]/i.test(cwd);
}

/**
 * Soma num contador cuja chave pode vir de fora (tipo de linha, kind de quadro, activity): `constructor`,
 * `toString` ou `__proto__` viram uma chave comum, sem mexer no protótipo nem herdar função do Object.
 */
export function somar(contadores: Record<string, number>, chave: string, n = 1): void {
  const atual = Object.hasOwn(contadores, chave) ? contadores[chave] : 0;
  Object.defineProperty(contadores, chave, { value: (typeof atual === 'number' ? atual : 0) + n, enumerable: true, writable: true, configurable: true });
}

/** Valor próprio de um mapa vindo da configuração ou de fora, só se for texto. */
export function textoDoMapa(mapa: Record<string, unknown> | Map<string, string>, chave: string | undefined): string | undefined {
  if (chave === undefined) return undefined;
  if (mapa instanceof Map) return mapa.get(chave);
  if (!Object.hasOwn(mapa, chave)) return undefined;
  const v = mapa[chave];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

export function descreverDesconhecidos(d: Record<string, number>): string | undefined {
  const lista = Object.entries(d).sort((a, b) => b[1] - a[1]);
  if (lista.length === 0) return undefined;
  return `Tipos que este adaptador ainda não conhece (ignorados): ${lista.slice(0, 12).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}.`;
}

export { fmt };
