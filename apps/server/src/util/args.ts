// Argumentos de linha de comando: `--chave valor`, `--chave=valor` e `--sinal`.

export type Argumentos = { valores: Record<string, string>; sinais: Set<string>; soltos: string[] };

export function lerArgumentos(argv: string[], sinaisConhecidos: string[] = []): Argumentos {
  const valores: Record<string, string> = {};
  const sinais = new Set<string>();
  const soltos: string[] = [];
  const conhecidos = new Set(sinaisConhecidos);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) {
      soltos.push(a);
      continue;
    }
    const igual = a.indexOf('=');
    if (igual > 0) {
      valores[a.slice(2, igual)] = a.slice(igual + 1);
      continue;
    }
    const nome = a.slice(2);
    const proximo = argv[i + 1];
    if (!conhecidos.has(nome) && proximo !== undefined && !proximo.startsWith('--')) {
      valores[nome] = proximo;
      i++;
    } else {
      sinais.add(nome);
    }
  }
  return { valores, sinais, soltos };
}

/** Pedidos de ajuda, em qualquer posição. A ajuda sai antes de tudo: nem a configuração é lida. */
const AJUDA = new Set(['--ajuda', '--help', '-h', '-?', '/?', '/h']);

export type EspecArgumentos = { valores: readonly string[]; sinais: readonly string[] };
export type Interpretacao = { tipo: 'ajuda' } | { tipo: 'erro'; mensagem: string } | { tipo: 'ok'; args: Argumentos };

/** Nome de opção que pode aparecer numa mensagem: só nome simples (valor nenhum se repete). */
function rotulo(nome: string): string {
  return /^[a-z][a-z0-9-]{0,31}$/i.test(nome) ? `--${nome}` : 'uma opção com nome estranho';
}

/**
 * Lê os argumentos de um programa de linha de comando com falha fechada: opção desconhecida, opção sem valor e
 * argumento solto viram erro antes de qualquer outra coisa (um `--help` não reconhecido já subiu o servidor inteiro).
 */
export function interpretarArgumentos(argv: string[], espec: EspecArgumentos): Interpretacao {
  if (argv.some((a) => AJUDA.has(a.toLowerCase().replace(/=.*$/s, '')))) return { tipo: 'ajuda' };
  const args = lerArgumentos(argv, [...espec.sinais]);
  const valores = new Set(espec.valores);
  const sinais = new Set(espec.sinais);
  for (const s of args.sinais) {
    if (sinais.has(s)) continue;
    return { tipo: 'erro', mensagem: valores.has(s) ? `Falta o valor de ${rotulo(s)}.` : `Opção desconhecida: ${rotulo(s)}.` };
  }
  for (const k of Object.keys(args.valores)) {
    if (valores.has(k)) continue;
    return { tipo: 'erro', mensagem: sinais.has(k) ? `${rotulo(k)} não leva valor.` : `Opção desconhecida: ${rotulo(k)}.` };
  }
  if (args.soltos.length > 0) return { tipo: 'erro', mensagem: 'Há um argumento solto, sem opção na frente.' };
  return { tipo: 'ok', args };
}
