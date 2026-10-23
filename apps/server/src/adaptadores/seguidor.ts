// Seguidor de arquivos JSONL que outros programas vão escrevendo (transcrições do Claude, rollouts do Codex).
// Só leitura: abre, lê o pedaço novo e fecha (o Windows abre com compartilhamento de leitura, escrita e remoção).
//   offset por arquivo e buffer da linha incompleta (corte em bytes, então UTF-8 nunca quebra no meio);
//   catch-up na partida: só o fim (até `bytesDoFim`) dos arquivos mexidos dentro da janela;
//   observador (chokidar) para baixa latência e varredura de segurança a cada `varreduraMs`;
//   a varredura é assíncrona e não cresce com o histórico: pasta com a mesma data de modificação não é relida
//   (a lista dela fica guardada; uma volta em cada 15 relê tudo), arquivo quente (mexido dentro da janela) é
//   conferido em toda volta e arquivo frio só numa fatia por volta (cada um mais ou menos a cada minuto; o
//   observador pega a mudança dele na hora);
//   arquivo novo depois da partida é lido do começo; arquivo que encolheu é relido do zero.
import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Agendamento, Relogio } from '../util/relogio.ts';
import { descreverErro, type Log } from '../util/log.ts';

export type Linha = {
  texto: string;
  /** Posição (em bytes) do começo da linha no arquivo. */
  inicio: number;
  /** Lida no catch-up da partida (história recente), e não ao vivo. */
  catchUp: boolean;
};

export type ArquivoSeguido = {
  arquivo: string;
  /** Caminho relativo à raiz, com barras normais. */
  relativo: string;
  offset: number;
  resto: Buffer;
  /** Foi lido desde o byte 0 (arquivo novo): a primeira linha é o começo da sessão. */
  doComeco: boolean;
  /** Data de modificação vista na última conferência (ms). */
  mtimeMs: number;
  /** Fora da janela e parado: conferido só no rodízio (e pelo observador). */
  frio: boolean;
};

export type OpcoesSeguidor = {
  raiz: string;
  /** Recebe o caminho relativo (barras normais) e diz se o arquivo interessa. */
  incluir: (relativo: string) => boolean;
  profundidade: number;
  catchUpMs: number;
  bytesDoFim: number;
  varreduraMs: number;
  relogio: Relogio;
  aoLer: (linhas: Linha[], arquivo: ArquivoSeguido) => void;
  aoRemover?: (arquivo: ArquivoSeguido) => void;
  /** O arquivo esfriou (fora da janela e parado): o adaptador poda o que guarda dele. */
  aoEsfriar?: (arquivo: ArquivoSeguido) => void;
  /** No catch-up, lê também a primeira linha (o Codex guarda o `session_meta` nela). */
  primeiraLinha?: boolean;
  /** Liga o observador do chokidar (padrão: sim). Os testes desligam para controlar o tempo. */
  observar?: boolean;
  maxBytesPorLeitura?: number;
  /** Cada arquivo frio é conferido mais ou menos a cada este tempo (padrão: 60 s). */
  rodizioFrioMs?: number;
  log?: Log;
  agora?: () => number;
};

export type EstatisticasSeguidor = {
  arquivos: number;
  frios: number;
  pastas: number;
  linhas: number;
  bytes: number;
  leituras: number;
  erros: number;
  descartadas: number;
  raizExiste: boolean;
  observador: 'ligado' | 'desligado' | 'falhou';
  ultimaVarredura?: number;
  /** Quanto a última varredura levou, do começo ao fim (assíncrona: o servidor segue atendendo nesse meio-tempo). */
  duracaoUltimaVarreduraMs?: number;
};

export type Seguidor = {
  iniciar(): Promise<void>;
  parar(): Promise<void>;
  /** Varredura de segurança. Devolve quando terminar uma varredura que começou depois da chamada. */
  varrer(): Promise<void>;
  ler(arquivo: string): void;
  estatisticas(): EstatisticasSeguidor;
};

const NOVA_LINHA = 0x0a;
/** Linha maior que isso sem quebra é descartada (proteção de memória). */
const MAX_RESTO = 16 * 1024 * 1024;
/** Uma volta em cada tantas relê todas as pastas, mesmo as de data igual. */
const VOLTAS_ENTRE_RELEITURAS = 15;

type Pasta = { mtimeMs: number; arquivos: string[]; subpastas: string[] };

export function criarSeguidor(op: OpcoesSeguidor): Seguidor {
  const maxLeitura = op.maxBytesPorLeitura ?? 4 * 1024 * 1024;
  const agora = op.agora ?? (() => op.relogio.agora());
  const janelaQuente = Math.max(op.catchUpMs, 10 * 60_000);
  const rodizio = Math.max(op.varreduraMs, op.rodizioFrioMs ?? 60_000);
  const arquivos = new Map<string, ArquivoSeguido>();
  const pastas = new Map<string, Pasta>();
  const est: EstatisticasSeguidor = {
    arquivos: 0, frios: 0, pastas: 0, linhas: 0, bytes: 0, leituras: 0, erros: 0, descartadas: 0, raizExiste: false, observador: 'desligado',
  };
  let observador: FSWatcher | undefined;
  let varredura: Agendamento | undefined;
  let parado = false;
  let voltas = 0;
  let cursorFrio = 0;
  let emCurso: Promise<void> | undefined;
  let proxima: Promise<void> | undefined;
  const pendentesDeLeitura = new Set<string>();

  const relativo = (arquivo: string) => path.relative(op.raiz, arquivo).split(path.sep).join('/');

  async function existeRaiz(): Promise<boolean> {
    try {
      return (await fs.promises.stat(op.raiz)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Lista os arquivos que interessam, assíncrono. Pasta com a mesma data de antes usa a lista guardada. */
  async function listarPasta(dir: string, nivel: number, forcar: boolean, visitadas: Set<string>): Promise<string[]> {
    if (parado) return [];
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(dir);
    } catch {
      return [];
    }
    if (!st.isDirectory()) return [];
    visitadas.add(dir);
    let p = pastas.get(dir);
    if (!p || forcar || p.mtimeMs !== st.mtimeMs) {
      let entradas: fs.Dirent[];
      try {
        entradas = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const daPasta: string[] = [];
      const subpastas: string[] = [];
      for (const e of entradas) {
        const caminho = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (nivel < op.profundidade) subpastas.push(caminho);
        } else if (e.isFile() && op.incluir(relativo(caminho))) {
          daPasta.push(caminho);
        }
      }
      p = { mtimeMs: st.mtimeMs, arquivos: daPasta, subpastas };
      pastas.set(dir, p);
    }
    const filhos = await Promise.all(p.subpastas.map((s) => listarPasta(s, nivel + 1, forcar, visitadas)));
    return [...p.arquivos, ...filhos.flat()];
  }

  async function listar(forcar: boolean): Promise<string[]> {
    const visitadas = new Set<string>();
    const lista = await listarPasta(op.raiz, 0, forcar, visitadas);
    for (const d of [...pastas.keys()]) if (!visitadas.has(d)) pastas.delete(d);
    est.pastas = pastas.size;
    return lista;
  }

  function lerTrecho(arquivo: string, inicio: number, tamanho: number): Buffer {
    const fd = fs.openSync(arquivo, 'r');
    try {
      const buf = Buffer.alloc(tamanho);
      let lidos = 0;
      while (lidos < tamanho) {
        const n = fs.readSync(fd, buf, lidos, tamanho - lidos, inicio + lidos);
        if (n === 0) break;
        lidos += n;
      }
      return lidos === tamanho ? buf : buf.subarray(0, lidos);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Quebra o buffer em linhas completas; o que sobra sem quebra volta como resto. */
  function quebrar(dados: Buffer, posicaoInicial: number, catchUp: boolean): { linhas: Linha[]; resto: Buffer } {
    const linhas: Linha[] = [];
    let comeco = 0;
    for (let i = 0; i < dados.length; i++) {
      if (dados[i] !== NOVA_LINHA) continue;
      let fim = i;
      if (fim > comeco && dados[fim - 1] === 0x0d) fim--;
      if (fim > comeco) linhas.push({ texto: dados.toString('utf8', comeco, fim), inicio: posicaoInicial + comeco, catchUp });
      comeco = i + 1;
    }
    let resto = dados.subarray(comeco);
    if (resto.length > MAX_RESTO) {
      est.descartadas++;
      resto = Buffer.alloc(0);
    }
    return { linhas, resto: Buffer.from(resto) };
  }

  function entregar(linhas: Linha[], a: ArquivoSeguido): void {
    if (linhas.length === 0) return;
    est.linhas += linhas.length;
    try {
      op.aoLer(linhas, a);
    } catch (e) {
      est.erros++;
      op.log?.erro('falha ao processar linhas de um arquivo seguido', { erro: descreverErro(e) });
    }
  }

  function registrar(arquivo: string, offset: number, doComeco: boolean, mtimeMs: number): ArquivoSeguido {
    const a: ArquivoSeguido = { arquivo, relativo: relativo(arquivo), offset, resto: Buffer.alloc(0), doComeco, mtimeMs, frio: false };
    arquivos.set(arquivo, a);
    est.arquivos = arquivos.size;
    return a;
  }

  /** Catch-up: só o fim do arquivo (e, se pedido, a primeira linha). */
  function lerCauda(arquivo: string, tamanho: number, mtimeMs: number): void {
    const inicio = Math.max(0, tamanho - op.bytesDoFim);
    const a = registrar(arquivo, tamanho, inicio === 0, mtimeMs);
    try {
      if (op.primeiraLinha && inicio > 0) {
        const cabeca = lerTrecho(arquivo, 0, Math.min(tamanho, 1024 * 1024));
        const quebra = cabeca.indexOf(NOVA_LINHA);
        if (quebra > 0) entregar([{ texto: cabeca.toString('utf8', 0, cabeca[quebra - 1] === 0x0d ? quebra - 1 : quebra), inicio: 0, catchUp: true }], a);
      }
      let dados = lerTrecho(arquivo, inicio, tamanho - inicio);
      est.bytes += dados.length;
      est.leituras++;
      let posicao = inicio;
      if (inicio > 0) {
        // O começo do trecho cai no meio de uma linha: descarta até a primeira quebra.
        const quebra = dados.indexOf(NOVA_LINHA);
        if (quebra < 0) {
          a.resto = Buffer.alloc(0);
          return;
        }
        dados = dados.subarray(quebra + 1);
        posicao = inicio + quebra + 1;
      }
      const r = quebrar(dados, posicao, true);
      a.resto = r.resto;
      entregar(r.linhas, a);
    } catch (e) {
      est.erros++;
      op.log?.aviso('não consegui ler o fim de um arquivo no catch-up', { erro: descreverErro(e) });
    }
  }

  function ler(arquivo: string): void {
    if (parado) return;
    let a = arquivos.get(arquivo);
    let st: fs.Stats;
    try {
      st = fs.statSync(arquivo);
    } catch {
      if (a) esquecer(arquivo);
      return;
    }
    if (!a) {
      if (!op.incluir(relativo(arquivo))) return;
      a = registrar(arquivo, 0, true, st.mtimeMs);
    }
    a.mtimeMs = st.mtimeMs;
    const tamanho = st.size;
    if (tamanho < a.offset) {
      // Arquivo encolheu (recriado ou truncado): relê do zero; a deduplicação por id evita evento repetido.
      a.offset = 0;
      a.resto = Buffer.alloc(0);
      a.doComeco = true;
    }
    if (tamanho === a.offset) return;
    a.frio = false;
    const quanto = Math.min(tamanho - a.offset, maxLeitura);
    try {
      const dados = lerTrecho(arquivo, a.offset, quanto);
      est.bytes += dados.length;
      est.leituras++;
      const base = a.offset - a.resto.length;
      const r = quebrar(a.resto.length ? Buffer.concat([a.resto, dados]) : dados, base, false);
      a.offset += dados.length;
      a.resto = r.resto;
      entregar(r.linhas, a);
    } catch (e) {
      est.erros++;
      op.log?.aviso('não consegui ler um arquivo seguido', { erro: descreverErro(e) });
      return;
    }
    if (a.offset < tamanho && !pendentesDeLeitura.has(arquivo)) {
      // Ainda tem mais: continua na próxima volta do laço, sem travar o servidor.
      pendentesDeLeitura.add(arquivo);
      op.relogio.agendar(0, () => {
        pendentesDeLeitura.delete(arquivo);
        ler(arquivo);
      });
    }
  }

  function esquecer(arquivo: string): void {
    const a = arquivos.get(arquivo);
    if (!a) return;
    arquivos.delete(arquivo);
    est.arquivos = arquivos.size;
    try {
      op.aoRemover?.(a);
    } catch {
      est.erros++;
    }
  }

  function esfriar(a: ArquivoSeguido): void {
    a.frio = true;
    // A linha incompleta grande de um arquivo parado não fica ocupando memória: se ele voltar a crescer, o resto
    // dela vira uma linha de JSON inválido (contada como ignorada) e a seguinte entra normal.
    if (a.resto.length > 64 * 1024) a.resto = Buffer.alloc(0);
    try {
      op.aoEsfriar?.(a);
    } catch {
      est.erros++;
    }
  }

  async function varrerAgora(): Promise<void> {
    if (parado) return;
    const inicio = Date.now();
    est.ultimaVarredura = agora();
    est.raizExiste = await existeRaiz();
    if (!est.raizExiste || parado) return;
    const forcar = voltas % VOLTAS_ENTRE_RELEITURAS === 0;
    voltas++;
    const listados = await listar(forcar);
    if (parado) return;
    const vistos = new Set(listados);
    // Arquivo novo: lido do começo.
    for (const arquivo of listados) if (!arquivos.has(arquivo)) ler(arquivo);
    // Quentes em toda volta; frios numa fatia que roda.
    const quentes: ArquivoSeguido[] = [];
    const frios: ArquivoSeguido[] = [];
    for (const a of arquivos.values()) if (vistos.has(a.arquivo)) (a.frio ? frios : quentes).push(a);
    const fatia = frios.length === 0 ? 0 : Math.min(frios.length, Math.ceil((frios.length * op.varreduraMs) / rodizio));
    const conferir = [...quentes];
    for (let i = 0; i < fatia; i++) {
      const f = frios[(cursorFrio + i) % frios.length];
      if (f) conferir.push(f);
    }
    cursorFrio = frios.length > 0 ? (cursorFrio + fatia) % frios.length : 0;
    const limite = agora() - janelaQuente;
    await Promise.all(
      conferir.map(async (a) => {
        let st: fs.Stats;
        try {
          st = await fs.promises.stat(a.arquivo);
        } catch {
          return;
        }
        if (parado || arquivos.get(a.arquivo) !== a) return;
        if (st.size !== a.offset || st.mtimeMs !== a.mtimeMs) ler(a.arquivo);
        const frio = st.mtimeMs < limite && st.size === a.offset;
        if (frio && !a.frio) esfriar(a);
        else if (!frio && a.frio) a.frio = false;
      }),
    );
    if (parado) return;
    for (const arquivo of [...arquivos.keys()]) if (!vistos.has(arquivo)) esquecer(arquivo);
    est.frios = [...arquivos.values()].filter((a) => a.frio).length;
    est.duracaoUltimaVarreduraMs = Date.now() - inicio;
  }

  function varrer(): Promise<void> {
    if (parado) return Promise.resolve();
    if (proxima) return proxima;
    const anterior = emCurso ?? Promise.resolve();
    const p: Promise<void> = anterior.then(async () => {
      proxima = undefined;
      emCurso = p;
      try {
        await varrerAgora();
      } catch (e) {
        est.erros++;
        op.log?.aviso('a varredura de segurança falhou nesta volta', { erro: descreverErro(e) });
      } finally {
        if (emCurso === p) emCurso = undefined;
      }
    });
    proxima = p;
    return p;
  }

  return {
    async iniciar() {
      est.raizExiste = await existeRaiz();
      if (est.raizExiste) {
        const limite = agora() - op.catchUpMs;
        const quente = agora() - janelaQuente;
        voltas = 1;
        const listados = await listar(true);
        const vistos = await Promise.all(
          listados.map(async (arquivo) => {
            try {
              const s = await fs.promises.stat(arquivo);
              return { arquivo, tamanho: s.size, mtime: s.mtimeMs };
            } catch {
              return undefined;
            }
          }),
        );
        const lista = vistos.filter((x): x is { arquivo: string; tamanho: number; mtime: number } => x !== undefined).sort((a, b) => a.mtime - b.mtime);
        for (const x of lista) {
          if (parado) break;
          if (x.mtime >= limite) lerCauda(x.arquivo, x.tamanho, x.mtime);
          else registrar(x.arquivo, x.tamanho, false, x.mtime).frio = x.mtime < quente;
        }
        est.frios = [...arquivos.values()].filter((a) => a.frio).length;
        est.ultimaVarredura = agora();
      }
      if (op.observar !== false && est.raizExiste && !parado) {
        try {
          observador = watch(op.raiz, {
            ignoreInitial: true,
            persistent: true,
            depth: op.profundidade,
            ignored: (p: string, st?: fs.Stats) => (st?.isFile() ? !op.incluir(relativo(p)) : false),
          });
          observador.on('add', (p: string) => ler(p));
          observador.on('change', (p: string) => ler(p));
          observador.on('unlink', (p: string) => esquecer(p));
          observador.on('error', () => {
            est.erros++;
          });
          est.observador = 'ligado';
        } catch (e) {
          est.observador = 'falhou';
          op.log?.aviso('o observador de arquivos não ligou; sigo só com a varredura', { erro: descreverErro(e) });
        }
      }
      varredura = op.relogio.repetir(op.varreduraMs, () => {
        void varrer();
      });
    },
    async parar() {
      parado = true;
      varredura?.cancelar();
      if (observador) await observador.close();
      observador = undefined;
      await Promise.allSettled([emCurso, proxima].filter((x): x is Promise<void> => x !== undefined));
    },
    varrer,
    ler,
    estatisticas: () => ({ ...est }),
  };
}
