// Cliente do OpenMausBot: só leitura. Só GET, só 127.0.0.1, só as rotas desta lista fixa, e sem os cabeçalhos
// que tiram a confiança de loopback (Origin, Sec-Fetch-*, X-Forwarded-*). Por isso usa node:http, e não fetch
// (o fetch do Node manda Sec-Fetch-Mode). Nunca POST, nunca /api/bots sem messages=0, nunca o SSE sem screens=off.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROTAS_PERMITIDAS: readonly RegExp[] = [
  /^\/\.well-known\/openmausbot\/environment$/,
  /^\/api\/health$/,
  /^\/api\/bots\?messages=0$/,
  /^\/api\/team-map$/,
  /^\/api\/today(?:\?since=\d{1,16})?$/,
  /^\/api\/routines(?:\?from=\d{1,16}&to=\d{1,16})?$/,
  /^\/api\/threads\/[A-Za-z0-9_-]{1,80}\/job(?:\?scope=job)?$/,
  /^\/api\/events\?screens=off$/,
];

/** Versão do OpenMausBot conferida no estudo e na Fase 0. */
export const VERSAO_CONFERIDA_OMB = '0.1.121';

export function rotaPermitida(rota: string): boolean {
  return ROTAS_PERMITIDAS.some((re) => re.test(rota));
}

export class RotaProibida extends Error {
  constructor() {
    super('rota fora da lista permitida do OpenMausBot');
    this.name = 'RotaProibida';
  }
}

/** GET em JSON numa rota permitida. Corpo limitado a 4 MB; nada é registrado em log. */
export function lerJson(porta: number, rota: string, timeoutMs = 1_500): Promise<{ status: number; corpo: unknown }> {
  if (!rotaPermitida(rota) || rota.startsWith('/api/events')) return Promise.reject(new RotaProibida());
  return new Promise((resolver, rejeitar) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, path: rota, method: 'GET', headers: { accept: 'application/json' }, timeout: timeoutMs },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on('data', (c: Buffer) => {
          tamanho += c.length;
          if (tamanho > 4 * 1024 * 1024) req.destroy(new Error('resposta grande demais'));
          else partes.push(c);
        });
        res.on('end', () => {
          let corpo: unknown;
          try {
            corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
          } catch {
            corpo = undefined;
          }
          resolver({ status: res.statusCode ?? 0, corpo });
        });
        res.on('error', rejeitar);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    req.on('error', rejeitar);
    req.end();
  });
}

export type Descoberta = {
  porta: number;
  versao?: string;
  /** O environmentId bate com o arquivo environment-id da pasta do app? (só a igualdade, nunca o valor) */
  confereComArquivo?: boolean;
};

/**
 * `encontrado`: o app instalado, com o environment-id conferido (igual ao do arquivo). `recusado`: algo respondeu
 * na rota pública, mas o environment-id não confere (ou não deu para conferir): o Arcadia não conecta nele.
 */
export type ResultadoDescoberta = { encontrado?: Descoberta; recusado?: Descoberta; tentativas: { porta: number; resultado: string }[] };

/**
 * Procura o OpenMausBot nas portas da configuração pelo /.well-known/openmausbot/environment (rota pública).
 * Só vale a porta cujo environmentId é igual ao do arquivo ~/.openmausbot/environment-id (só a igualdade é
 * conferida; o valor nunca sai daqui). Outro programa na porta, ou app sem o arquivo, fica recusado.
 */
export async function descobrirOmb(portas: number[], casa: string, timeoutMs = 800): Promise<ResultadoDescoberta> {
  const tentativas: { porta: number; resultado: string }[] = [];
  let recusado: Descoberta | undefined;
  let esperado: string | undefined;
  try {
    esperado = fs.readFileSync(path.join(casa, '.openmausbot', 'environment-id'), 'utf8').trim();
  } catch {
    esperado = undefined;
  }
  for (const porta of portas) {
    try {
      const r = await lerJson(porta, '/.well-known/openmausbot/environment', timeoutMs);
      if (r.status !== 200 || typeof r.corpo !== 'object' || r.corpo === null) {
        tentativas.push({ porta, resultado: `respondeu ${r.status}` });
        continue;
      }
      const corpo = r.corpo as { version?: unknown; environmentId?: unknown };
      const d: Descoberta = { porta };
      if (typeof corpo.version === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(corpo.version)) d.versao = corpo.version;
      if (typeof corpo.environmentId === 'string' && esperado !== undefined && esperado.length > 0) {
        d.confereComArquivo = esperado === corpo.environmentId;
      }
      if (d.confereComArquivo === true) {
        tentativas.push({ porta, resultado: 'encontrado' });
        return recusado ? { encontrado: d, recusado, tentativas } : { encontrado: d, tentativas };
      }
      tentativas.push({ porta, resultado: d.confereComArquivo === false ? 'respondeu, mas o environment-id não confere' : 'respondeu, mas não deu para conferir o environment-id' });
      recusado ??= d;
    } catch (e) {
      const codigo = (e as { code?: unknown }).code;
      tentativas.push({ porta, resultado: codigo === 'ECONNREFUSED' ? 'nada ouvindo' : codigo === 'ETIMEDOUT' ? 'sem resposta' : 'erro' });
    }
  }
  return recusado ? { recusado, tentativas } : { tentativas };
}
