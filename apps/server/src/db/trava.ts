// Trava de instância única da pasta de dados: um arquivo com o PID de quem usa a pasta, pego antes de abrir o banco.
// Dois servidores na mesma pasta brigariam pelo banco (alas, snapshots, sequência). O segundo é recusado, e o recado
// diz qual processo segura a pasta. Trava velha (o processo morreu sem desligar, ou o PC reiniciou) é retomada com
// aviso no log. O arquivo só tem PID, portas e horário: nada pessoal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ARQUIVO_TRAVA = 'arcadia.trava';
/** Trava ilegível mais nova que isso pode ser de um servidor pegando a trava agora: não é retomada. */
const TRAVA_NOVA_MS = 10_000;
/** Folga na comparação com a hora em que o sistema ligou (o relógio anda um pouco entre uma leitura e outra). */
const FOLGA_INICIO_MS = 60_000;

export type DonoTrava = { pid: number; desde?: number; portas?: { ingestao: number; visualizacao: number } };

export class ErroTrava extends Error {
  dono: DonoTrava | undefined;
  constructor(mensagem: string, dono?: DonoTrava) {
    super(mensagem);
    this.name = 'ErroTrava';
    this.dono = dono;
  }
}

export type Trava = {
  arquivo: string;
  /** Quem tinha a trava antes, quando ela era velha e foi retomada (vazio se o arquivo estava ilegível). */
  retomada?: Partial<DonoTrava>;
  /** Solta a trava, só se o arquivo ainda for desta trava. */
  liberar(): void;
};

export type OpcoesTrava = {
  pid?: number;
  portas?: { ingestao: number; visualizacao: number };
  /** Como a pasta aparece nas mensagens (sem caminho pessoal). */
  descricao?: string;
  fuso?: string;
  agora?: () => number;
  vivo?: (pid: number) => boolean;
  /** Quando o sistema ligou: trava de antes disso é velha, mesmo que o PID tenha sido reaproveitado por outro processo. */
  inicioDoSistema?: () => number;
};

/** O processo existe? Sem permissão para olhar (EPERM), conta como vivo: na dúvida, a pasta fica com ele. */
export function processoVivo(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lerDono(texto: string): DonoTrava | undefined {
  try {
    const v = JSON.parse(texto) as { pid?: unknown; desde?: unknown; portas?: { ingestao?: unknown; visualizacao?: unknown } };
    if (typeof v.pid !== 'number' || !Number.isSafeInteger(v.pid) || v.pid <= 0) return undefined;
    const dono: DonoTrava = { pid: v.pid };
    if (typeof v.desde === 'number' && Number.isFinite(v.desde)) dono.desde = v.desde;
    const p = v.portas;
    if (p && Number.isInteger(p.ingestao) && Number.isInteger(p.visualizacao)) dono.portas = { ingestao: Number(p.ingestao), visualizacao: Number(p.visualizacao) };
    return dono;
  } catch {
    return undefined;
  }
}

function quando(ms: number, fuso: string | undefined): string {
  try {
    const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso ?? 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return fmt.format(new Date(ms)).replace(',', '');
  } catch {
    return 'hora desconhecida';
  }
}

/** "processo 123, portas 4780 e 47800, desde 23/10/2026 20:37" */
export function descreverDono(dono: Partial<DonoTrava>, fuso?: string): string {
  const partes: string[] = [];
  if (dono.pid !== undefined) partes.push(`processo ${dono.pid}`);
  if (dono.portas) partes.push(`portas ${dono.portas.visualizacao} e ${dono.portas.ingestao}`);
  if (dono.desde !== undefined) partes.push(`desde ${quando(dono.desde, fuso)}`);
  return partes.length > 0 ? partes.join(', ') : 'dono desconhecido (arquivo ilegível)';
}

export function adquirirTrava(dir: string, op: OpcoesTrava = {}): Trava {
  const arquivo = path.join(dir, ARQUIVO_TRAVA);
  const agora = op.agora ?? (() => Date.now());
  const vivo = op.vivo ?? processoVivo;
  const inicioDoSistema = op.inicioDoSistema ?? (() => Date.now() - os.uptime() * 1000);
  const pasta = op.descricao !== undefined ? `a pasta de dados (${op.descricao})` : 'a pasta de dados';
  const meu = `${JSON.stringify({ pid: op.pid ?? process.pid, desde: agora(), ...(op.portas ? { portas: op.portas } : {}) })}\n`;
  let retomada: Partial<DonoTrava> | undefined;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      // 'wx': cria só se não existir (atômico). Quem chegar depois cai no EEXIST.
      fs.writeFileSync(arquivo, meu, { flag: 'wx' });
      return { arquivo, ...(retomada ? { retomada } : {}), liberar: () => liberar(arquivo, meu) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let texto: string;
    let modificadoEm: number;
    try {
      texto = fs.readFileSync(arquivo, 'utf8');
      modificadoEm = fs.statSync(arquivo).mtimeMs;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; // o dono acabou de soltar: tenta de novo
      throw e;
    }
    const dono = lerDono(texto);
    if (dono) {
      // Trava de antes do sistema ligar é velha, mesmo com o PID vivo (o Windows reaproveita PIDs depois de reiniciar).
      const antesDeLigar = dono.desde !== undefined && dono.desde < inicioDoSistema() - FOLGA_INICIO_MS;
      if (!antesDeLigar && vivo(dono.pid)) {
        throw new ErroTrava(
          `${maiuscula(pasta)} já está em uso por outro servidor do Arcadia (${descreverDono(dono, op.fuso)}). Feche esse servidor antes de abrir outro nesta pasta. Se esse processo não for um servidor do Arcadia, apague o arquivo ${ARQUIVO_TRAVA} dessa pasta.`,
          dono,
        );
      }
    } else if (agora() - modificadoEm < TRAVA_NOVA_MS) {
      throw new ErroTrava(`${maiuscula(pasta)} está sendo aberta por outro servidor do Arcadia neste momento. Espere alguns segundos e tente de novo.`);
    }
    // Trava velha: sai só se ninguém mexeu nela desde a leitura.
    try {
      if (fs.readFileSync(arquivo, 'utf8') === texto) fs.rmSync(arquivo, { force: true });
    } catch {
      // outro processo mexeu nela: a próxima volta decide
    }
    retomada = dono ?? {};
  }
  throw new ErroTrava(`Não consegui pegar a trava de ${pasta}: outro processo mexe nela ao mesmo tempo. Tente de novo.`);
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function liberar(arquivo: string, meu: string): void {
  try {
    if (fs.readFileSync(arquivo, 'utf8') === meu) fs.rmSync(arquivo, { force: true });
  } catch {
    // já não existe
  }
}
