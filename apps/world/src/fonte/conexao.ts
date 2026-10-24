// Conexão com o servidor do Arcadia (ADR 0002): GET /api/snapshot e o SSE de /api/events.
// - Primeiro o snapshot; depois o SSE com ?desde=<seq do snapshot>, e o servidor manda os quadros
//   que faltam (ou um resync). Quadro repetido é ignorado; buraco no seq refaz o snapshot.
// - `ola` com outro buildId: a página recarrega (atualização sem tocar no celular), mas só quando a
//   página responde (recarregarQuandoResponder). Outra instância do servidor (ele reiniciou): refaz o snapshot.
// - Vigia: sem nada (nem o ping de 15 s) por 45 s, a conexão é dada como morta e reabre.
// - Caiu: o EventSource tenta sozinho; se ele desistir, a reabertura é nossa, de 1 a 10 s.
//   Enquanto isso o mundo fica na tela, com o aviso "sem conexão", e volta sozinho.
// - `adeus` (o servidor abriu vaga para outra aba deste aparelho): fecha o EventSource, para o vigia e
//   NÃO reconecta sozinho, senão cada volta derrubaria outra aba num rodízio sem fim. Volta com um toque.
// - Aba escondida por mais de 60 s solta o SSE (bateria do celular e vaga para as abas à vista) e
//   volta sozinha quando aparece de novo.
import type { Adeus, MotivoAdeus } from '@arcadia/shared';
import type { Ola, Quadro, Resync, Snapshot } from './tipos.ts';

export type StatusConexao = 'conectando' | 'ao-vivo' | 'sem-conexao' | 'outra-aba';

export interface OuvintesConexao {
  /** Estado inteiro de novo (resync, servidor reiniciado, volta depois de muito tempo fora). */
  snapshot(s: Snapshot): void;
  /** Um quadro de mudanças, sempre em ordem de seq. */
  quadro(q: Quadro): void;
  status(s: StatusConexao): void;
  /** O servidor mudou de versão: a página recarrega (quando responder). */
  recarregar(): void;
}

/** Sem nada do servidor por este tempo, a conexão é dada como morta. */
export const VIGIA_MS = 45_000;
/** Aba escondida por mais que isso solta o SSE; volta quando a aba aparece. */
export const ESCONDIDA_SOLTA_MS = 60_000;
const ESPERA_MIN_MS = 1_000, ESPERA_MAX_MS = 10_000;

/** Busca o snapshot (o navegador descompacta o gzip sozinho). */
export async function buscarSnapshot(base = '/api', sinal?: AbortSignal): Promise<Snapshot> {
  const r = await fetch(`${base}/snapshot`, { cache: 'no-store', signal: sinal });
  if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
  const s = (await r.json()) as Snapshot;
  if (!s || s.v !== 1 || typeof s.seq !== 'number' || !s.estado) throw new Error('snapshot em formato desconhecido');
  return s;
}

export class Conexao {
  private es: EventSource | null = null;
  private ultimoSeq = -1;
  private buildId = '';
  private instancia = '';
  private ultimoSinal = 0;
  private vigia = 0;
  private reabrir = 0;
  private tentativas = 0;
  private buscando = false;
  private emEspera: Quadro[] = [];
  private parado = false;
  private graca = 0;
  private esconder = 0;
  /** Conexão solta de propósito, sem reconexão automática: pelo adeus do servidor ou pela aba escondida. */
  private solta: 'adeus' | 'escondida' | null = null;
  status: StatusConexao = 'conectando';
  /** Motivo do último adeus do servidor (para a depuração e as provas). */
  motivoAdeus: MotivoAdeus | null = null;
  /** Contadores para a depuração e as provas. */
  readonly contagem = { quadros: 0, repetidos: 0, buracos: 0, resyncs: 0, snapshots: 0, reaberturas: 0, pings: 0, adeus: 0, soltas: 0, retomadas: 0, conexoes: 0 };

  private readonly base: string;
  private readonly ouvir: OuvintesConexao;

  constructor(base: string, ouvir: OuvintesConexao) { this.base = base; this.ouvir = ouvir; }

  get seq(): number { return this.ultimoSeq; }

  /** Começa a partir de um snapshot já aplicado (o da carga). */
  iniciar(s: Snapshot): void {
    this.ultimoSeq = s.seq; this.buildId = s.buildId; this.instancia = s.instancia;
    this.abrir();
    this.ligarVigia();
    document.addEventListener('visibilitychange', this.aoVisibilidade);
    if (document.visibilityState === 'hidden') this.aoVisibilidade();
  }

  parar(): void {
    this.parado = true;
    clearInterval(this.vigia); clearTimeout(this.reabrir); clearTimeout(this.graca); clearTimeout(this.esconder);
    document.removeEventListener('visibilitychange', this.aoVisibilidade);
    this.es?.close(); this.es = null;
  }

  /**
   * Volta depois de solta (o toque no aviso de outra aba, ou a aba que aparece de novo): abre o SSE desde o último seq
   * (o servidor manda o que falta ou um resync) e liga o vigia. Pode derrubar a aba mais antiga deste aparelho, que
   * recebe o adeus e espera o toque dela: nada volta sozinho, então não há laço.
   */
  retomar(): void {
    if (this.parado || this.solta === null) return;
    this.solta = null;
    this.tentativas = 0;
    this.contagem.retomadas++;
    this.emitir('conectando');
    this.abrir();
    this.ligarVigia();
  }

  private ligarVigia(): void {
    clearInterval(this.vigia);
    this.vigia = window.setInterval(() => this.vigiar(), 5_000);
  }

  /** Solta a conexão de propósito: fecha o EventSource e para o vigia, a carência e as reaberturas. */
  private soltar(por: 'adeus' | 'escondida'): void {
    this.solta = por;
    this.contagem.soltas++;
    clearInterval(this.vigia); this.vigia = 0;
    clearTimeout(this.reabrir); this.reabrir = 0;
    clearTimeout(this.graca); this.graca = 0;
    this.es?.close(); this.es = null;
  }

  private readonly aoVisibilidade = (): void => {
    if (this.parado) return;
    if (document.visibilityState === 'hidden') {
      clearTimeout(this.esconder);
      if (this.solta === null) {
        this.esconder = window.setTimeout(() => {
          this.esconder = 0;
          if (!this.parado && this.solta === null && document.visibilityState === 'hidden') this.soltar('escondida');
        }, ESCONDIDA_SOLTA_MS);
      }
      return;
    }
    clearTimeout(this.esconder); this.esconder = 0;
    // Solta pelo adeus fica solta: só o toque traz de volta.
    if (this.solta === 'escondida') this.retomar();
  };

  /**
   * Queda curta (o EventSource reconecta em 3 s) não acende o aviso: 4 s de carência, com o selo em
   * "conectando"; só depois disso vale "sem conexão".
   */
  private mudarStatus(s: StatusConexao): void {
    if (this.solta === 'adeus') return;
    if (s === 'sem-conexao') {
      if (this.status === 'sem-conexao' || this.graca) return;
      this.emitir('conectando');
      this.graca = window.setTimeout(() => { this.graca = 0; this.emitir('sem-conexao'); }, 4_000);
      return;
    }
    if (this.graca) { clearTimeout(this.graca); this.graca = 0; }
    this.emitir(s);
  }

  private emitir(s: StatusConexao): void {
    if (this.status === s) return;
    this.status = s;
    this.ouvir.status(s);
  }

  private sinal(): void { this.ultimoSinal = performance.now(); }

  private abrir(): void {
    if (this.parado || this.solta !== null) return;
    this.es?.close();
    this.sinal();
    this.contagem.conexoes++;
    const es = new EventSource(`${this.base}/events?desde=${this.ultimoSeq}`);
    this.es = es;
    es.addEventListener('ola', (e) => this.aoOla(e as MessageEvent<string>));
    es.addEventListener('mundo', (e) => this.aoQuadro(e as MessageEvent<string>));
    es.addEventListener('resync', (e) => this.aoResync(e as MessageEvent<string>));
    es.addEventListener('adeus', (e) => { if (es === this.es) this.aoAdeus(e as MessageEvent<string>); });
    es.addEventListener('ping', () => { this.sinal(); this.contagem.pings++; });
    es.onerror = () => {
      if (es !== this.es) return;
      this.mudarStatus('sem-conexao');
      // fechado de vez (resposta de erro, proxy sem servidor): a reabertura é nossa
      if (es.readyState === EventSource.CLOSED) this.agendarReabertura();
    };
  }

  private agendarReabertura(): void {
    if (this.parado || this.solta !== null) return;
    clearTimeout(this.reabrir);
    const espera = Math.min(ESPERA_MAX_MS, ESPERA_MIN_MS * 2 ** Math.min(4, this.tentativas++));
    this.reabrir = window.setTimeout(() => { this.contagem.reaberturas++; this.abrir(); }, espera);
  }

  private vigiar(): void {
    if (this.parado || this.buscando || this.solta !== null) return;
    if (performance.now() - this.ultimoSinal > VIGIA_MS) {
      // nem o ping chegou: a conexão está morta mesmo que o navegador não tenha percebido
      this.mudarStatus('sem-conexao');
      this.es?.close(); this.es = null;
      this.agendarReabertura();
    }
  }

  /** O servidor fechou esta conexão para abrir vaga a outra aba deste aparelho: fica solta até o toque. */
  private aoAdeus(e: MessageEvent<string>): void {
    let motivo: MotivoAdeus = 'outra-aba';
    try { motivo = (JSON.parse(e.data) as Adeus).motivo ?? motivo; } catch { /* o motivo é só informativo */ }
    this.motivoAdeus = motivo;
    this.contagem.adeus++;
    this.soltar('adeus');
    this.emitir('outra-aba');
  }

  private aoOla(e: MessageEvent<string>): void {
    this.sinal();
    let ola: Ola;
    try { ola = JSON.parse(e.data) as Ola; } catch { return; }
    if (this.buildId && ola.buildId !== this.buildId) { this.ouvir.recarregar(); return; }
    this.tentativas = 0;
    if (ola.instancia !== this.instancia) { void this.refazer(); return; }
    if (!this.buscando) this.mudarStatus('ao-vivo');
  }

  private aoQuadro(e: MessageEvent<string>): void {
    this.sinal();
    let q: Quadro;
    try { q = JSON.parse(e.data) as Quadro; } catch { return; }
    if (this.buscando) { this.emEspera.push(q); return; }
    this.aplicar(q);
  }

  private aplicar(q: Quadro): void {
    if (q.seq <= this.ultimoSeq) { this.contagem.repetidos++; return; }
    if (q.seq !== this.ultimoSeq + 1) { this.contagem.buracos++; void this.refazer(); return; }
    this.ultimoSeq = q.seq;
    this.contagem.quadros++;
    this.ouvir.quadro(q);
  }

  private aoResync(e: MessageEvent<string>): void {
    this.sinal();
    try { JSON.parse(e.data) as Resync; } catch { /* o motivo é só informativo */ }
    this.contagem.resyncs++;
    void this.refazer();
  }

  /** Refaz o snapshot; os quadros que chegarem enquanto isso esperam e entram depois, em ordem. */
  private async refazer(): Promise<void> {
    if (this.buscando || this.parado) return;
    this.buscando = true;
    try {
      const s = await buscarSnapshot(this.base);
      if (this.parado) return;
      if (this.buildId && s.buildId !== this.buildId) { this.ouvir.recarregar(); return; }
      this.ultimoSeq = s.seq; this.instancia = s.instancia;
      this.contagem.snapshots++;
      this.ouvir.snapshot(s);
      this.buscando = false;
      const fila = this.emEspera.sort((a, b) => a.seq - b.seq); this.emEspera = [];
      for (const q of fila) this.aplicar(q);
      if (this.solta === null) this.mudarStatus('ao-vivo');
    } catch {
      this.buscando = false;
      this.mudarStatus('sem-conexao');
      // sem snapshot, o SSE de agora não serve: fecha e tenta tudo de novo mais tarde
      if (this.solta === null) {
        this.es?.close(); this.es = null;
        this.agendarReabertura();
      }
    }
  }
}

/** Opções do ajudante de recarga (injetáveis nos testes). */
export interface OpcoesRecarga {
  /** Endereço conferido antes de recarregar (padrão: a própria página). */
  url: () => string;
  recarregar: () => void;
  buscar: (url: string, init: RequestInit) => Promise<{ ok: boolean }>;
  esperar: (ms: number) => Promise<void>;
  /** Entre uma conferência e outra, com o servidor fora. */
  intervaloMs: number;
  /** Tempo-limite de cada conferência. */
  limiteMs: number;
}

/**
 * Recarga só com o servidor respondendo. O HTML vem do próprio servidor: recarregar com ele fora deixaria a página de
 * erro do navegador, e ela nunca voltaria (as tentativas da carga são código da página). Confere a página (HEAD sem
 * cache, com tempo-limite) e só recarrega quando ela responde com sucesso; senão confere de novo a cada 10 s,
 * enquanto o mundo segue na tela com o selo da conexão. Pedidos repetidos enquanto espera viram um só.
 */
export class Recarregador {
  private pendente: Promise<void> | null = null;
  private readonly op: OpcoesRecarga;
  /** Contadores para a depuração e as provas. */
  readonly contagem = { pedidos: 0, conferencias: 0, semResposta: 0, recargas: 0 };

  constructor(op: OpcoesRecarga) { this.op = op; }

  /** Há uma recarga esperando a página responder. */
  get esperando(): boolean { return this.pendente !== null; }

  pedir(): Promise<void> {
    this.contagem.pedidos++;
    if (this.pendente) return this.pendente;
    this.pendente = (async () => {
      for (;;) {
        if (await this.responde()) {
          this.contagem.recargas++;
          this.op.recarregar();
          return;
        }
        this.contagem.semResposta++;
        await this.op.esperar(this.op.intervaloMs);
      }
    })();
    return this.pendente;
  }

  private async responde(): Promise<boolean> {
    this.contagem.conferencias++;
    const ctl = new AbortController();
    const limite = setTimeout(() => ctl.abort(), this.op.limiteMs);
    try {
      const r = await this.op.buscar(this.op.url(), { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
      return r.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(limite);
    }
  }
}

let recarregadorDaPagina: Recarregador | null = null;

/** O ajudante da página (um só, para a recarga das 03:00, a do buildId e a da perda de contexto do WebGL). */
export function recarregadorPadrao(): Recarregador {
  recarregadorDaPagina ??= new Recarregador({
    url: () => location.href,
    recarregar: () => location.reload(),
    buscar: (url, init) => fetch(url, init),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    intervaloMs: 10_000,
    limiteMs: 5_000,
  });
  return recarregadorDaPagina;
}

/** Recarrega a página quando ela responder (ver Recarregador). */
export function recarregarQuandoResponder(): Promise<void> {
  return recarregadorPadrao().pedir();
}
