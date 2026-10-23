// Glob simples para as regras da configuração (alas, exclusões): `**` (zero ou mais pastas), `*` e `?`.
// O padrão passa pela mesma normalização dos caminhos; padrão relativo vale em qualquer profundidade.
import { expandir, type AmbienteCaminhos } from './caminhos.ts';

function escapar(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Normaliza o padrão sem resolver contra a pasta atual (senão `**` relativo ganharia um prefixo). */
export function normalizarPadrao(padrao: string, amb: AmbienteCaminhos): string {
  let p = expandir(padrao, amb).normalize('NFC').replace(/\\/g, '/');
  if (amb.windows) p = p.toLowerCase();
  p = p.replace(/\/{2,}/g, '/');
  if (/^[A-Za-z]:$/.test(p)) p += '/';
  if (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) p = p.slice(0, -1);
  const absoluto = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (!absoluto && !p.startsWith('**')) p = `**/${p}`;
  return p;
}

export function globParaRegex(padraoNormalizado: string): RegExp {
  const segs = padraoNormalizado.split('/');
  let saida = '';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] ?? '';
    const ultimo = i === segs.length - 1;
    if (s === '**') {
      if (ultimo) saida += i === 0 ? '.*' : '(?:/.*)?';
      else saida += i === 0 ? '(?:.*/)?' : '(?:/.*)?/';
      continue;
    }
    if (i > 0 && segs[i - 1] !== '**') saida += '/';
    for (const ch of s) saida += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : escapar(ch);
  }
  return new RegExp(`^${saida}$`);
}

export type Glob = { padrao: string; re: RegExp; testar(caminhoNormalizado: string): boolean };

/**
 * `descendentes`: o padrão vale também para tudo o que fica dentro do que ele casa (como se terminasse em `/**`).
 * É o modo das exclusões: excluir `~/Documentos/Diario` exclui também `~/Documentos/Diario/2026`.
 */
export function compilarGlob(padrao: string, amb: AmbienteCaminhos, opcoes: { descendentes?: boolean } = {}): Glob {
  const p = normalizarPadrao(padrao, amb);
  const base = globParaRegex(p);
  const re = opcoes.descendentes && !p.endsWith('/**') ? new RegExp(`${base.source.replace(/\/?\$$/, '')}(?:/.*)?$`) : base;
  return { padrao: p, re, testar: (c) => re.test(c) };
}

/**
 * Parte fixa do começo do padrão (antes do primeiro `*` ou `?`), já normalizada. Vazia quando o padrão começa
 * com curinga ou é relativo. Serve para saber em que pastas o resolvedor pode procurar `.git` no disco.
 */
export function raizDoPadrao(padrao: string, amb: AmbienteCaminhos): string | undefined {
  // Pasta de rede (\\servidor ou //servidor) nunca é raiz de busca no disco.
  if (/^[\\/]{2}/.test(expandir(padrao, amb).trim())) return undefined;
  const p = normalizarPadrao(padrao, amb);
  const fixos: string[] = [];
  for (const s of p.split('/')) {
    if (/[*?]/.test(s)) break;
    fixos.push(s);
  }
  const raiz = fixos.join('/');
  if (amb.windows) {
    if (/^[a-z]:$/i.test(raiz)) return `${raiz.toLowerCase()}/`;
    if (!/^[a-z]:\//i.test(raiz)) return undefined;
  } else if (!raiz.startsWith('/')) {
    return undefined;
  }
  return raiz.length > 1 && raiz.endsWith('/') && !/^[a-z]:\/$/i.test(raiz) ? raiz.slice(0, -1) : raiz;
}
