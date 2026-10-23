// Identificadores estáveis. O alfabeto só tem letras (a até p): assim um hash nunca forma um "CPF" de 11 dígitos
// por acaso e a guarda da saída não confunde chave com dado pessoal.
import { createHash, randomBytes } from 'node:crypto';

const LETRAS = 'abcdefghijklmnop';

export function hashCurto(texto: string, tamanho = 16): string {
  const hex = createHash('sha256').update(texto, 'utf8').digest('hex');
  let saida = '';
  for (let i = 0; i < tamanho && i < hex.length; i++) saida += LETRAS[parseInt(hex[i] ?? '0', 16)];
  return saida;
}

/** Id estável de um evento: origem mais o hash da chave natural (deduplicação entre leituras). */
export function idDeEvento(origem: string, ...partes: (string | number)[]): string {
  return `${origem}:${hashCurto(partes.join('\u0000'), 24)}`;
}

/** Sal aleatório da instalação: entra no hash das chaves de sala, para ninguém adivinhar caminhos pelo hash. */
export function novoSal(): string {
  return randomBytes(16).toString('hex');
}

export function idAleatorio(tamanho = 12): string {
  return hashCurto(randomBytes(16).toString('hex') + String(Date.now()), tamanho);
}
