// Caminhos: expansão de ~ e %VARIAVEL%, normalização (barras normais; no Windows, sem diferenciar maiúsculas)
// e descrição segura para mensagens. Caminho completo só vive em memória: nunca vai para log, banco ou cliente.
import os from 'node:os';
import path from 'node:path';

export type AmbienteCaminhos = {
  /** Pasta do usuário (o que ~ significa). */
  casa: string;
  /** Variáveis de ambiente usadas em %VARIAVEL% (no Windows, sem diferenciar maiúsculas). */
  variaveis: Record<string, string | undefined>;
  windows: boolean;
  /** Pasta atual, para resolver caminho relativo. */
  cwd: string;
};

export function ambienteAtual(): AmbienteCaminhos {
  return { casa: os.homedir(), variaveis: { ...process.env }, windows: process.platform === 'win32', cwd: process.cwd() };
}

function variavel(amb: AmbienteCaminhos, nome: string): string | undefined {
  if (!amb.windows) return amb.variaveis[nome];
  const alvo = nome.toUpperCase();
  for (const [k, v] of Object.entries(amb.variaveis)) if (k.toUpperCase() === alvo) return v;
  return undefined;
}

/** Troca ~ e %VARIAVEL% pelo valor. Variável desconhecida fica como está. */
export function expandir(caminho: string, amb: AmbienteCaminhos): string {
  let p = caminho.trim();
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = amb.casa + p.slice(1);
  p = p.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, nome: string) => variavel(amb, nome) ?? m);
  return p;
}

/**
 * Caminho absoluto com barras normais, sem barra no fim (menos na raiz, como `c:/`), em NFC.
 * No Windows tudo vira minúsculo: é a chave para comparar. `manterCaixa` devolve a mesma forma com a caixa original.
 */
export function normalizar(caminho: string, amb: AmbienteCaminhos, manterCaixa = false): string {
  let p = expandir(caminho, amb).normalize('NFC');
  if (amb.windows) {
    if (/^[A-Za-z]:$/.test(p)) p += '/';
    p = path.win32.resolve(amb.cwd, p).replace(/\\/g, '/');
    if (!manterCaixa) p = p.toLowerCase();
  } else {
    p = path.posix.resolve(amb.cwd, p);
  }
  if (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) p = p.slice(0, -1);
  return p;
}

/** Pedaços do caminho normalizado (a raiz `c:` ou vazio conta como o primeiro). */
export function pedacos(normalizado: string): string[] {
  if (normalizado === '/') return [''];
  return normalizado.replace(/\/$/, '').split('/');
}

export function juntar(partes: string[]): string {
  if (partes.length === 1 && /^[A-Za-z]:$/.test(partes[0] ?? '')) return `${partes[0]}/`;
  if (partes.length === 1 && partes[0] === '') return '/';
  return partes.join('/');
}

/** `filho` é igual a `pai` ou fica dentro dele (os dois normalizados). */
export function dentroDe(filho: string, pai: string): boolean {
  if (filho === pai) return true;
  const base = pai.endsWith('/') ? pai : pai + '/';
  return filho.startsWith(base);
}

export function pai(normalizado: string): string | undefined {
  const partes = pedacos(normalizado);
  if (partes.length <= 1) return undefined;
  return juntar(partes.slice(0, -1));
}

export function ehRaizDeDisco(normalizado: string): boolean {
  return /^[A-Za-z]:\/$/.test(normalizado) || normalizado === '/';
}

/**
 * Descreve um caminho para uma mensagem ao dono da máquina, sem expor a pasta pessoal: relativo ao repositório,
 * ou com %USERPROFILE% e %LOCALAPPDATA% no lugar do começo, ou só o nome do arquivo.
 */
export function descreverCaminho(caminho: string, amb: AmbienteCaminhos, raizRepo?: string): string {
  const n = normalizar(caminho, amb);
  const original = normalizar(caminho, amb, true);
  const corte = (base: string) => original.slice(normalizar(base, amb).length).replace(/^\//, '');
  const sep = amb.windows ? '\\' : '/';
  const comSep = (s: string) => (amb.windows ? s.replace(/\//g, '\\') : s);
  if (raizRepo && dentroDe(n, normalizar(raizRepo, amb))) return corte(raizRepo) || '.';
  const local = variavel(amb, 'LOCALAPPDATA');
  if (local && dentroDe(n, normalizar(local, amb))) return `%LOCALAPPDATA%${sep}${comSep(corte(local))}`;
  if (dentroDe(n, normalizar(amb.casa, amb))) return `%USERPROFILE%${sep}${comSep(corte(amb.casa))}`;
  return pedacos(original).at(-1) ?? '';
}
