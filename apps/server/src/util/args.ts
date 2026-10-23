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
