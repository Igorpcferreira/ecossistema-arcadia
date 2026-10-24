// Carrega e valida a configuração. Ordem: --config <arquivo>, variável ARCADIA_CONFIG e
// %USERPROFILE%\.arcadia\arcadia.config.yaml. Sem nenhuma delas, recusa: o exemplo do repositório nunca vale como
// configuração de execução (ele aponta para a pasta de dados de verdade; em 23/10/2026 um `--help` não reconhecido
// subiu o servidor com ele e mexeu no banco real).
// Mensagens em português e sem a pasta pessoal por extenso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as lerYaml } from 'js-yaml';
import { NOMES_RESERVADOS } from '@arcadia/shared';
import { criarEsquemaConfig, type Config } from './esquema.ts';
import { ambienteAtual, dentroDe, descreverCaminho, expandir, normalizar, type AmbienteCaminhos } from '../util/caminhos.ts';

export const RAIZ_REPO = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const CONFIG_EXEMPLO = path.join(RAIZ_REPO, 'config', 'arcadia.config.exemplo.yaml');

export type OrigemConfig = 'argumento' | 'variavel' | 'usuario';

export const DESCRICAO_ORIGEM: Record<OrigemConfig, string> = {
  argumento: 'indicada em --config',
  variavel: 'indicada na variável ARCADIA_CONFIG',
  usuario: 'configuração do usuário',
};

const COMO_CRIAR =
  'Crie a sua em %USERPROFILE%\\.arcadia\\arcadia.config.yaml (copie config/arcadia.config.exemplo.yaml e ajuste) ou indique um arquivo com --config.';

export type ConfigCarregada = {
  config: Config;
  /** Caminho do arquivo: só em memória. */
  arquivo: string;
  /** Como mostrar o arquivo numa mensagem. */
  descricao: string;
  origem: OrigemConfig;
  avisos: string[];
};

export class ErroConfig extends Error {
  problemas: string[];
  constructor(mensagem: string, problemas: string[] = []) {
    super(mensagem);
    this.name = 'ErroConfig';
    this.problemas = problemas;
  }
}

export type OpcoesConfig = {
  argumento?: string;
  amb?: AmbienteCaminhos;
  existe?: (p: string) => boolean;
  ler?: (p: string) => string;
  raizRepo?: string;
};

function variavel(amb: AmbienteCaminhos, nome: string): string | undefined {
  for (const [k, v] of Object.entries(amb.variaveis)) if (k.toUpperCase() === nome.toUpperCase() && v) return v;
  return undefined;
}

export function localizarConfig(opcoes: OpcoesConfig = {}): { arquivo: string; origem: OrigemConfig } {
  const amb = opcoes.amb ?? ambienteAtual();
  const existe = opcoes.existe ?? ((p: string) => fs.existsSync(p));
  const raizRepo = opcoes.raizRepo ?? RAIZ_REPO;
  const exemplo = normalizar(path.join(raizRepo, 'config', 'arcadia.config.exemplo.yaml'), amb);
  const conferido = (arquivo: string, origem: OrigemConfig) => {
    // O exemplo do repositório nunca vale para rodar, nem indicado de propósito: ele aponta para a pasta de dados real.
    if (normalizar(arquivo, amb) === exemplo) {
      throw new ErroConfig(
        `O exemplo do repositório (config/arcadia.config.exemplo.yaml) não vale como configuração de execução: ele aponta para a pasta de dados de verdade. ${COMO_CRIAR} Para testar, use uma configuração própria de teste.`,
      );
    }
    return { arquivo, origem };
  };
  const indicado = (valor: string, origem: OrigemConfig) => {
    const arquivo = path.resolve(amb.cwd, expandir(valor, amb));
    if (!existe(arquivo)) {
      throw new ErroConfig(`A configuração ${DESCRICAO_ORIGEM[origem]} não existe: ${descreverCaminho(arquivo, amb, raizRepo)}.`);
    }
    return conferido(arquivo, origem);
  };
  if (opcoes.argumento) return indicado(opcoes.argumento, 'argumento');
  const daVariavel = variavel(amb, 'ARCADIA_CONFIG');
  if (daVariavel) return indicado(daVariavel, 'variavel');
  const doUsuario = path.join(amb.casa, '.arcadia', 'arcadia.config.yaml');
  if (existe(doUsuario)) return conferido(doUsuario, 'usuario');
  throw new ErroConfig(`Nenhuma configuração encontrada, e o exemplo do repositório não serve para rodar (ele aponta para a pasta de dados de verdade). ${COMO_CRIAR}`);
}

const NOMES_TIPO: Record<string, string> = {
  string: 'texto',
  number: 'número',
  int: 'número inteiro',
  boolean: 'true ou false',
  array: 'lista',
  object: 'bloco de chaves',
};

function valorEm(bruto: unknown, caminho: PropertyKey[]): unknown {
  let atual: unknown = bruto;
  for (const passo of caminho) {
    if (typeof atual !== 'object' || atual === null) return undefined;
    atual = (atual as Record<PropertyKey, unknown>)[passo];
  }
  return atual;
}

/** Chave que pode aparecer numa mensagem: nome simples. Chave com caminho, espaço ou outro texto não se repete. */
const CHAVE_SIMPLES = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

function formatarCaminho(caminho: PropertyKey[]): string {
  let s = '';
  for (const p of caminho) {
    if (typeof p === 'number') {
      s += `[${p}]`;
      continue;
    }
    const nome = typeof p === 'string' && CHAVE_SIMPLES.test(p) ? p : '[chave]';
    s += s ? `.${nome}` : nome;
  }
  return s || '(raiz)';
}

type Problema = { code: string; path: PropertyKey[]; message: string; [k: string]: unknown };

function traduzir(p: Problema, bruto: unknown): string {
  const onde = formatarCaminho(p.path);
  const origem = typeof p['origin'] === 'string' ? (p['origin'] as string) : '';
  switch (p.code) {
    case 'invalid_type':
      if (valorEm(bruto, p.path) === undefined) return `${onde}: campo obrigatório`;
      return `${onde}: esperava ${NOMES_TIPO[String(p['expected'])] ?? String(p['expected'])}`;
    case 'too_small': {
      const min = String(p['minimum']);
      if (origem === 'string') return `${onde}: precisa ter pelo menos ${min} caractere(s)`;
      if (origem === 'array') return `${onde}: precisa ter pelo menos ${min} item(ns)`;
      return `${onde}: precisa ser no mínimo ${min}`;
    }
    case 'too_big': {
      const max = String(p['maximum']);
      if (origem === 'string') return `${onde}: pode ter no máximo ${max} caractere(s)`;
      if (origem === 'array') return `${onde}: pode ter no máximo ${max} item(ns)`;
      return `${onde}: pode ser no máximo ${max}`;
    }
    case 'invalid_format':
      return `${onde}: formato inválido${p.message && !p.message.startsWith('Invalid') ? ` (${p.message})` : ''}`;
    case 'invalid_value': {
      const valores = Array.isArray(p['values']) ? (p['values'] as unknown[]).map(String).join(', ') : '';
      if (valorEm(bruto, p.path) === undefined) return `${onde}: campo obrigatório${valores ? ` (use: ${valores})` : ''}`;
      if (p.path.at(-1) === 'tema') return `${onde}: tema desconhecido${valores ? `; use um destes: ${valores}` : ''}`;
      return `${onde}: valor inválido${valores ? `; use: ${valores}` : ''}`;
    }
    case 'unrecognized_keys': {
      const chaves = Array.isArray(p['keys']) ? (p['keys'] as unknown[]).map(String) : [];
      const simples = chaves.filter((k) => CHAVE_SIMPLES.test(k));
      const outras = chaves.length - simples.length;
      const lista = [...simples, ...(outras > 0 ? [`${outras} com nome que não é simples, que não repito aqui`] : [])].join(', ');
      return `${onde}: chave desconhecida ignorada (${lista})`;
    }
    case 'custom':
      return `${onde}: ${p.message}`;
    default:
      return `${onde}: valor inválido`;
  }
}

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function ehHostLocal(host: string): boolean {
  return HOSTS_LOCAIS.has(host.trim().toLowerCase());
}

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Valida um objeto já lido do YAML. Lança ErroConfig com a lista de problemas em português. */
export function validarConfig(bruto: unknown, amb: AmbienteCaminhos = ambienteAtual()): { config: Config; avisos: string[] } {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    throw new ErroConfig('A configuração precisa ser um bloco de chaves (por exemplo, começar com "versao: 1").');
  }
  const avisos: string[] = [];
  const estrito = criarEsquemaConfig(true).safeParse(bruto);
  if (!estrito.success) {
    for (const p of estrito.error.issues) if (p.code === 'unrecognized_keys') avisos.push(traduzir(p as unknown as Problema, bruto));
  }
  const r = criarEsquemaConfig(false).safeParse(bruto);
  if (!r.success) {
    const problemas = r.error.issues.map((p) => traduzir(p as unknown as Problema, bruto));
    throw new ErroConfig('A configuração tem problemas.', problemas);
  }
  const config = r.data;
  const problemas: string[] = [];

  const ids = new Set<string>();
  config.alas.forEach((ala, i) => {
    if (ids.has(ala.id)) problemas.push(`alas[${i}].id: o id "${ala.id}" se repete`);
    if (ala.id === config.recepcao.id) problemas.push(`alas[${i}].id: "${ala.id}" é o id da recepção`);
    if (NOMES_RESERVADOS.has(ala.id)) problemas.push(`alas[${i}].id: "${ala.id}" é um nome reservado; escolha outro`);
    ids.add(ala.id);
    for (const regra of ala.regras) {
      if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(expandir(regra, amb))) avisos.push(`alas[${i}].regras: uma regra usa variável de ambiente desconhecida`);
    }
  });
  for (const pasta of config.salas.rascunho) {
    if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(expandir(pasta, amb))) avisos.push('salas.rascunho: uma pasta usa variável de ambiente desconhecida (fica de fora)');
  }
  const pacote = config.personagens.pacoteLocal?.trim();
  if (pacote) {
    const expandido = expandir(pacote, amb);
    if (/^[\\/]{2}/.test(expandido)) avisos.push('personagens.pacoteLocal: caminho de rede não é lido; o mundo fica com os personagens genéricos');
    else if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(expandido)) avisos.push('personagens.pacoteLocal: usa variável de ambiente desconhecida; o mundo fica com os personagens genéricos');
  }
  if (!fusoValido(config.mundo.fuso)) problemas.push(`mundo.fuso: fuso desconhecido (use, por exemplo, America/Sao_Paulo)`);
  if (config.mundo.ocio.dormeMinutos <= config.mundo.ocio.pausaMinutos) {
    problemas.push('mundo.ocio.dormeMinutos: precisa ser maior que pausaMinutos');
  }
  if (!ehHostLocal(config.servidor.ingestao.host)) {
    problemas.push('servidor.ingestao.host: a ingestão, a saúde e o doctor só ouvem na própria máquina (use 127.0.0.1)');
  }
  if (!ehHostLocal(config.servidor.visualizacao.host)) {
    avisos.push(
      `servidor.visualizacao.host: o pareamento por QR só chega na Fase 4; até lá a visualização fica em 127.0.0.1 (pedido: ${config.servidor.visualizacao.host})`,
    );
  }
  if (config.servidor.ingestao.porta === config.servidor.visualizacao.porta) {
    problemas.push('servidor: a porta da ingestão e a da visualização precisam ser diferentes');
  }
  if (NOMES_RESERVADOS.has(config.recepcao.id)) problemas.push(`recepcao.id: "${config.recepcao.id}" é um nome reservado; escolha outro`);
  // Pasta de dados: falha fechada. Sem LOCALAPPDATA não há onde gravar; nunca dentro das pastas dos agentes. Para
  // teste e desenvolvimento, vale também uma subpasta da pasta temporária do sistema (%TEMP%), nunca na rede.
  const local = variavel(amb, 'LOCALAPPDATA');
  if (!local || /^[\\/]{2}/.test(local.trim())) {
    problemas.push('servidor.dados: os dados do Arcadia ficam só em %LOCALAPPDATA%/Arcadia, e a variável LOCALAPPDATA não existe nesta máquina (ou aponta para a rede)');
  } else {
    const dados = normalizar(config.servidor.dados, amb);
    const temp = variavel(amb, 'TEMP') ?? variavel(amb, 'TMP');
    const tempLocal = temp !== undefined && !/^[\\/]{2}/.test(temp.trim()) ? normalizar(temp, amb) : undefined;
    const naTemp = tempLocal !== undefined && dados !== tempLocal && dentroDe(dados, tempLocal);
    if (/^[\\/]{2}/.test(expandir(config.servidor.dados, amb).trim()) || (!dentroDe(dados, normalizar(path.join(local, 'Arcadia'), amb)) && !naTemp)) {
      problemas.push('servidor.dados: os dados do Arcadia ficam só dentro de %LOCALAPPDATA%/Arcadia (por exemplo, %LOCALAPPDATA%/Arcadia/dados) ou, para teste, numa subpasta de %TEMP%');
    }
    const dosAgentes = ['~/.claude', '~/.codex', '~/.openmausbot', config.fontes.claudeTranscricoes.pasta, config.fontes.claudeSessoesVivas.pasta, config.fontes.codexRollouts.pasta]
      .map((p) => normalizar(p, amb));
    if (dosAgentes.some((p) => dentroDe(dados, p) || dentroDe(p, dados))) {
      problemas.push('servidor.dados: a pasta de dados não pode ficar dentro das pastas dos agentes (~/.claude, ~/.codex, ~/.openmausbot) nem das fontes, e nem conter uma delas');
    }
  }
  if (problemas.length) throw new ErroConfig('A configuração tem problemas.', problemas);
  return { config, avisos };
}

export function carregarConfig(opcoes: OpcoesConfig = {}): ConfigCarregada {
  const amb = opcoes.amb ?? ambienteAtual();
  const raizRepo = opcoes.raizRepo ?? RAIZ_REPO;
  const { arquivo, origem } = localizarConfig({ ...opcoes, amb, raizRepo });
  const descricao = descreverCaminho(arquivo, amb, raizRepo);
  const ler = opcoes.ler ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  let texto: string;
  try {
    texto = ler(arquivo);
  } catch {
    throw new ErroConfig(`Não consegui ler a configuração (${descricao}).`);
  }
  if (texto.trim().length === 0) throw new ErroConfig(`A configuração está vazia (${descricao}).`);
  let bruto: unknown;
  try {
    bruto = lerYaml(texto);
  } catch (e) {
    const marca = (e as { mark?: { line?: number; column?: number } }).mark;
    const motivo = (e as { reason?: unknown }).reason;
    const onde = marca && typeof marca.line === 'number' ? ` (linha ${marca.line + 1}, coluna ${(marca.column ?? 0) + 1})` : '';
    const detalhe = typeof motivo === 'string' ? `; detalhe do leitor de YAML: ${motivo}` : '';
    throw new ErroConfig(`A configuração não é um YAML válido${onde} (${descricao})${detalhe}.`);
  }
  try {
    const { config, avisos } = validarConfig(bruto, amb);
    return { config, arquivo, descricao, origem, avisos };
  } catch (e) {
    if (e instanceof ErroConfig) throw new ErroConfig(`${e.message.replace(/\.$/, '')} (${descricao}).`, e.problemas);
    throw e;
  }
}

/**
 * Pasta de dados do servidor. O simulador nunca grava na área dos dados reais (%LOCALAPPDATA%/Arcadia): com a
 * configuração apontando para lá, ele usa uma pasta própria na pasta temporária do sistema (arcadia-simulador).
 * Configuração de teste com os dados numa subpasta de %TEMP% fica como está.
 */
export function pastaDeDados(config: Config, amb: AmbienteCaminhos, simulador: boolean): string {
  const dados = path.resolve(amb.cwd, expandir(config.servidor.dados, amb));
  if (!simulador) return dados;
  const local = expandir('%LOCALAPPDATA%', amb);
  const real = local !== '%LOCALAPPDATA%' && dentroDe(normalizar(dados, amb), normalizar(path.join(local, 'Arcadia'), amb));
  if (!real) return dados;
  const temp = expandir('%TEMP%', amb);
  return path.join(temp !== '%TEMP%' ? temp : os.tmpdir(), 'arcadia-simulador');
}

/**
 * Arquivo do pacote local de personagens (personagens.json dentro de personagens.pacoteLocal, ou o próprio arquivo
 * se terminar em .json), ou nada. Caminho relativo vale a partir da raiz do repositório. Caminho de rede e variável
 * de ambiente desconhecida ficam de fora: nunca são lidos.
 */
export function arquivoDoPacoteLocal(config: Config, amb: AmbienteCaminhos, raizRepo: string = RAIZ_REPO): string | undefined {
  const bruto = config.personagens.pacoteLocal?.trim();
  if (!bruto) return undefined;
  const expandido = expandir(bruto, amb);
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(expandido) || /^[\\/]{2}/.test(expandido)) return undefined;
  const p = amb.windows ? path.win32 : path.posix;
  const alvo = p.resolve(raizRepo, expandido);
  return /\.json$/i.test(alvo) ? alvo : p.join(alvo, 'personagens.json');
}

/** Texto de erro de configuração para o terminal. */
export function explicarErroConfig(e: ErroConfig): string {
  return [e.message, ...e.problemas.map((p) => `  ${p}`)].join('\n');
}
