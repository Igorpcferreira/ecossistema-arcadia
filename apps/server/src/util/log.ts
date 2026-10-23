// Log do servidor. Só mensagens escritas no código e números: nada de conteúdo das fontes, caminho completo ou
// texto de erro vindo de dados (a mensagem de erro do JSON.parse, por exemplo, traz um trecho da entrada).
import { sanearTexto } from '@arcadia/shared';

export type NivelLog = 'info' | 'aviso' | 'erro';
export type DadosLog = Record<string, string | number | boolean | undefined>;

export type Log = {
  info(mensagem: string, dados?: DadosLog): void;
  aviso(mensagem: string, dados?: DadosLog): void;
  erro(mensagem: string, dados?: DadosLog): void;
};

export type OpcoesLog = {
  /** Para onde vai cada linha. Padrão: stdout (info) e stderr (aviso e erro). */
  saida?: (linha: string, nivel: NivelLog) => void;
  agora?: () => number;
  fuso?: string;
  silencioso?: boolean;
};

function dois(n: number): string {
  return String(n).padStart(2, '0');
}

/** Endereço do próprio PC (montado no código, com host e porta da configuração): fica inteiro na mensagem. */
const URL_LOCAL = /\bhttps?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/[A-Za-z0-9._~?=&/-]*)?/g;

/** Saneia a mensagem, mas preserva os endereços locais (o saneamento reduziria cada um ao último pedaço). */
function sanearMensagem(mensagem: string): string {
  const urls = mensagem.match(URL_LOCAL) ?? [];
  const partes = mensagem.split(URL_LOCAL).map((p) => (p.trim().length > 0 ? sanearTexto(p, 300) : p.trim()));
  let saida = partes[0] ?? '';
  for (let i = 0; i < urls.length; i++) saida += ` ${urls[i]} ${partes[i + 1] ?? ''}`;
  return saida.replace(/\s+/g, ' ').trim().slice(0, 600);
}

export function criarLog(opcoes: OpcoesLog = {}): Log {
  const agora = opcoes.agora ?? (() => Date.now());
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: opcoes.fuso ?? 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const saida =
    opcoes.saida ??
    ((linha: string, nivel: NivelLog) => {
      if (nivel === 'info') process.stdout.write(linha + '\n');
      else process.stderr.write(linha + '\n');
    });

  function escrever(nivel: NivelLog, mensagem: string, dados?: DadosLog): void {
    if (opcoes.silencioso) return;
    const partes: string[] = [];
    for (const [k, v] of Object.entries(dados ?? {})) {
      if (v === undefined) continue;
      partes.push(`${k}=${typeof v === 'string' ? sanearTexto(v, 80) : String(v)}`);
    }
    const quando = fmt.format(new Date(agora())).replace(',', '');
    const extra = partes.length ? ` (${partes.join(', ')})` : '';
    saida(`[${quando}] ${nivel}: ${sanearMensagem(mensagem)}${extra}`, nivel);
  }

  return {
    info: (m, d) => escrever('info', m, d),
    aviso: (m, d) => escrever('aviso', m, d),
    erro: (m, d) => escrever('erro', m, d),
  };
}

/** Descreve um erro sem a mensagem (que pode carregar dados): só o código ou o tipo. */
export function descreverErro(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const codigo = (e as { code?: unknown }).code;
    if (typeof codigo === 'string' && /^[A-Z0-9_]{2,40}$/.test(codigo)) return codigo;
    const nome = (e as { name?: unknown }).name;
    if (typeof nome === 'string' && /^[A-Za-z]{2,40}$/.test(nome)) return nome;
  }
  return 'erro desconhecido';
}

export { dois };
