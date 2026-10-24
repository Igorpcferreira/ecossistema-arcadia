// HUD, faixa de eventos, balões e cartões em DOM (como na prancha), mais a entrada por toque
// e mouse tratada no próprio DOM (os eventos do PixiJS ficam desligados).
import type { Mundo, Pessoa, Anuncio } from '../cena/mundo.ts';
import type { Camera } from '../motor/camera.ts';
import type { Vista } from '../motor/vistaIso.ts';
import { ROTULO_ESTADO } from '../arte/estados.ts';
import { desenharPersonagem, type PasseMao, type Tam } from '../arte/personagens.ts';
import { usarPaleta, paletaAtual } from '../arte/cor.ts';
import { ampliarCanvas } from './escalaDom.ts';

export type ModoHud = 'completo' | 'enxuto' | 'nenhum';

/** Retângulo em pixels CSS do palco. */
interface Ret { l: number; t: number; r: number; b: number }

export interface AcoesHud {
  aquario(v: boolean): void;
  noite(): boolean;
  pausar(): boolean;
  /** Só no simulador: sala nova em obra. Sem ela, o botão some. */
  obra?(): void;
  /** Só no simulador: trabalho novo numa ala em espera (ela acorda). Sem ela, o botão some. */
  trabalho?(): void;
  /** Troca entre o isométrico e o corte lateral; sem ela, o botão some. */
  vista?: () => void;
  zoom(delta: number, x?: number, y?: number): void;
  arrastar(dx: number, dy: number): void;
}

export interface ItemCartao { q?: string; texto: string; abrir?: { tipo: 'pessoa' | 'sala' | 'zona'; id: string } }
/** Conteúdo de um cartão: título, linhas de definição e listas (itens podem abrir outro cartão). */
export interface Cartao { titulo: string; sub: string; linhas: [string, string][]; listas: { titulo: string; itens: ItemCartao[] }[]; sprite?: boolean }

/** Cartões e fila "precisa de você" com os dados do servidor; sem ela, valem os do simulador. */
export interface FonteCartoes {
  versao(): number;
  precisa(): { p: Pessoa; texto: string }[];
  cartaoPrecisa(): Cartao;
  agente(p: Pessoa): Cartao | null;
  zona(id: string): Cartao | null;
  sala(chave: string): Cartao | null;
  /** Sala (cápsula) num ladrilho, para o toque abrir o cartão dela. */
  salaEm(i: number, j: number): string | null;
}

export type StatusFonte = 'conectando' | 'ao-vivo' | 'sem-conexao' | 'outra-aba' | 'simulado';

type AlvoCartao = { k: 'pessoa'; p: Pessoa } | { k: 'zona'; id: string } | { k: 'sala'; id: string } | { k: 'precisa' } | null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

export function horaSaoPaulo(d = new Date()): { h: number; m: number } {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const h = Number(partes.find((p) => p.type === 'hour')?.value ?? d.getHours());
    const m = Number(partes.find((p) => p.type === 'minute')?.value ?? d.getMinutes());
    return { h, m };
  } catch { return { h: d.getHours(), m: d.getMinutes() }; }
}

export class InterfaceMundo {
  readonly raiz: HTMLElement;
  readonly palco: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private baloes: HTMLElement;
  /** Áreas que os balões não cobrem (faixa de eventos, botão) e o fim do HUD de cima, medidos só quando mudam. */
  private evitar: Ret[] = [];
  private topoLivre = 44;
  private evitarSujo = true;
  /** Tamanho do palco em px CSS, medido junto com o que os balões evitam (nada de ler o layout a cada quadro). */
  private larguraPalco = 0;
  private alturaPalco = 0;
  /** Última posição escrita de cada balão: o estilo só muda quando o valor muda. */
  private posBalao = new Map<HTMLElement, { pos: string; bico: string }>();
  private ticker: HTMLOListElement;
  private precisa: HTMLButtonElement;
  private cartao: HTMLElement;
  private relogio: HTMLElement;
  private fps: HTMLElement;
  /** Selo da fonte dos dados (ao vivo, sem conexão, outra aba, simulado) e o aviso de conexão perdida. */
  private selo: HTMLElement;
  private aviso: HTMLElement;
  /** Aviso tocável de outra aba com a conexão: o toque traz esta aba de volta (nada volta sozinho). */
  private outraAba: HTMLButtonElement;
  private retomar: (() => void) | null = null;
  private fonteCartoes: FonteCartoes | null = null;
  private versaoPrecisa = -1;
  private listaPrecisa: Pessoa[] = [];
  private debug: HTMLElement;
  private carga: HTMLElement;
  private botoes = new Map<string, HTMLButtonElement>();
  private elBalao = new Map<Pessoa, HTMLElement>();
  private alvoCartao: AlvoCartao = null;
  private m: Mundo | null = null;
  private vista: Vista | null = null;
  private cam: Camera | null = null;
  private acoes: AcoesHud | null = null;
  private maxBaloes: number;
  private tam: Tam = 16;
  private maoFeita: PasseMao = 'humanos';
  private intervalo = 0;
  private desligarRolagem: () => void = () => {};
  horaFixa: number | null = null;

  constructor(raiz: HTMLElement, modo: ModoHud, celular: boolean) {
    this.raiz = raiz;
    this.maxBaloes = celular ? 3 : 7;
    this.palco = el('div', 'arc-palco');
    this.palco.dataset.celular = celular ? '1' : '0';
    this.palco.dataset.hud = modo;
    this.canvas = el('canvas', 'arc-mundo');
    this.baloes = el('div', 'arc-baloes'); this.baloes.setAttribute('aria-hidden', 'true');
    const hud = el('div', 'arc-hud');
    const topo = el('div', 'arc-hud-topo');
    const etiqueta = el('span', 'arc-etiqueta', 'ARCADIA ');
    this.relogio = el('span', 'num', '00:00'); this.fps = el('span', 'num', '-- fps');
    this.selo = el('span', 'arc-selo'); this.selo.hidden = true;
    etiqueta.append(this.relogio, this.fps, this.selo);
    const controles = el('div', 'arc-controles');
    const botao = (acao: string, txt: string, extra: { pressed?: boolean; label?: string; cls?: string } = {}) => {
      const b = el('button', 'arc-btn' + (extra.cls ? ' ' + extra.cls : ''), txt);
      b.type = 'button'; b.dataset.acao = acao;
      if (extra.pressed !== undefined) b.setAttribute('aria-pressed', String(extra.pressed));
      if (extra.label) b.setAttribute('aria-label', extra.label);
      controles.append(b); this.botoes.set(acao, b); return b;
    };
    botao('aquario', 'Aquário', { pressed: true });
    botao('noite', 'Noite', { pressed: false });
    botao('pausa', 'Pausar', { pressed: false, cls: 'so-pc' });
    botao('obra', 'Projeto novo', { cls: 'so-pc' });
    botao('trabalho', 'Chegou trabalho', { cls: 'so-pc', label: 'Acordar uma ala em espera com trabalho novo' });
    botao('vista', 'Corte', { pressed: false, label: 'Ver o andar em corte lateral' });
    botao('menos', '−', { label: 'Afastar', cls: 'quad' });
    botao('mais', '+', { label: 'Aproximar', cls: 'quad' });
    topo.append(etiqueta, controles);
    this.debug = el('div', 'arc-debug'); this.debug.hidden = true;
    this.aviso = el('div', 'arc-aviso', 'Sem conexão com o servidor. O mundo volta sozinho.'); this.aviso.hidden = true;
    this.aviso.setAttribute('role', 'status');
    // o aviso comum não recebe toque (pointer-events: none); este recebe (.arc-aviso-toque em base.css)
    this.outraAba = el('button', 'arc-aviso arc-aviso-toque', 'O Arcadia está aberto em outras abas deste aparelho. Toque aqui para voltar a esta.');
    this.outraAba.type = 'button'; this.outraAba.hidden = true;
    this.outraAba.addEventListener('click', () => this.retomar?.());
    const base = el('div', 'arc-hud-base');
    this.ticker = el('ol', 'arc-ticker'); this.ticker.setAttribute('aria-live', 'polite');
    this.precisa = el('button', 'arc-precisa', 'Precisa de você'); this.precisa.type = 'button'; this.precisa.hidden = true;
    base.append(this.ticker, this.precisa);
    hud.append(topo, this.debug, this.aviso, this.outraAba, base);
    this.cartao = el('div', 'arc-cartao'); this.cartao.setAttribute('role', 'dialog'); this.cartao.hidden = true;
    this.carga = el('div', 'arc-carga', 'Montando o andar...');
    this.palco.append(this.canvas, this.baloes, hud, this.cartao, this.carga);
    if (modo === 'nenhum') hud.hidden = true;
    raiz.append(this.palco);
  }

  progresso(f: number, texto = 'Montando o andar'): void { this.carga.textContent = `${texto}... ${Math.round(f * 100)}%`; }

  /**
   * Selo da fonte dos dados; sem conexão, o aviso aparece e o mundo continua na tela. Em outra aba (o servidor deu a
   * conexão a outra aba deste aparelho), o aviso é um botão: `retomar` traz esta aba de volta.
   */
  mostrarConexao(s: StatusFonte, retomar?: () => void): void {
    if (retomar) this.retomar = retomar;
    const txt = s === 'ao-vivo' ? 'AO VIVO' : s === 'sem-conexao' ? 'SEM CONEXÃO' : s === 'conectando' ? 'CONECTANDO' : s === 'outra-aba' ? 'OUTRA ABA' : 'SIMULADO';
    this.selo.hidden = false;
    if (this.selo.textContent !== txt) this.selo.textContent = txt;
    this.selo.dataset.s = s;
    const semConexao = s === 'sem-conexao';
    if (this.aviso.hidden === semConexao) { this.aviso.hidden = !semConexao; this.evitarSujo = true; }
    const outra = s === 'outra-aba';
    if (this.outraAba.hidden === outra) { this.outraAba.hidden = !outra; this.evitarSujo = true; }
  }
  pronto(): void { this.carga.hidden = true; }
  mostrarDebug(txt: string): void { this.debug.hidden = false; this.debug.textContent = txt; }

  ligar(m: Mundo, vista: Vista, cam: Camera, acoes: AcoesHud, tam: Tam, maoFeita: PasseMao, fonte: FonteCartoes | null = null): void {
    this.m = m; this.vista = vista; this.cam = cam; this.acoes = acoes; this.tam = tam; this.maoFeita = maoFeita; this.fonteCartoes = fonte;
    m.ouvintes.anuncio = (a) => this.anunciar(a);
    for (const a of m.anuncios) this.anunciar(a);
    this.botoes.get('aquario')!.addEventListener('click', () => { const v = !cam.aquario; acoes.aquario(v); this.marcar('aquario', v); });
    this.botoes.get('noite')!.addEventListener('click', () => this.marcar('noite', acoes.noite()));
    this.botoes.get('pausa')!.addEventListener('click', () => this.marcar('pausa', acoes.pausar()));
    const bObra = this.botoes.get('obra')!, bTrabalho = this.botoes.get('trabalho')!;
    if (acoes.obra) { const f = acoes.obra; bObra.addEventListener('click', () => f()); } else bObra.hidden = true;
    if (acoes.trabalho) { const f = acoes.trabalho; bTrabalho.addEventListener('click', () => f()); } else bTrabalho.hidden = true;
    const bVista = this.botoes.get('vista')!;
    if (acoes.vista) { const trocar = acoes.vista; bVista.addEventListener('click', () => trocar()); } else bVista.hidden = true;
    this.botoes.get('mais')!.addEventListener('click', () => acoes.zoom(1));
    this.botoes.get('menos')!.addEventListener('click', () => acoes.zoom(-1));
    this.precisa.addEventListener('click', () => {
      // com o servidor: o cartão da fila inteira, e a câmera no pedido mais antigo
      const a = fonte ? fonte.precisa().map((x) => x.p).find((x) => x.visivel) : m.pessoas.find((x) => x.estado === 'esperando' && x.visivel);
      if (a) { const p = vista.pontoBalao(a); if (p) { cam.explorar(); cam.irPara(p[0], p[1] + 20); this.marcar('aquario', false); } }
      if (fonte) this.abrirPrecisa(); else if (a) this.abrirPessoa(a);
    });
    this.ligarEntrada();
    this.intervalo = window.setInterval(() => this.segundo(), 1000);
    this.segundo();
  }

  marcar(acao: string, v: boolean): void { this.botoes.get(acao)?.setAttribute('aria-pressed', String(v)); }

  private segundo(): void {
    const { h, m } = horaSaoPaulo();
    this.relogio.textContent = this.horaFixa !== null ? `${String(this.horaFixa).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (!this.m) return;
    for (const li of Array.from(this.ticker.children) as HTMLElement[]) { const q = li.querySelector('.quando'); if (q) q.textContent = this.quandoFoi(Number(li.dataset.t)); }
    // balões de quem saiu do mundo
    for (const [p, e] of this.elBalao) if (this.m.porId.get(p.id) !== p) { e.remove(); this.elBalao.delete(p); this.posBalao.delete(e); }
    this.renovarCartao();
  }

  /** Redesenha o cartão aberto (os tempos andam e os dados mudam). */
  private renovarCartao(): void {
    const a = this.alvoCartao;
    if (!a) return;
    if (a.k === 'pessoa') { if (this.m && this.m.porId.get(a.p.id) !== a.p) { this.fecharCartao(); return; } this.preencherPessoa(a.p); }
    else if (a.k === 'zona') this.abrirZona(a.id);
    else if (a.k === 'sala') this.abrirSala(a.id);
    else this.abrirPrecisa();
  }

  /** O palco mudou de tamanho: mede de novo o que os balões evitam. */
  redimensionou(): void { this.evitarSujo = true; }

  mostrarFps(fps: number): void { this.fps.textContent = `${Math.round(fps)} fps`; }

  private quandoFoi(t: number): string {
    const s = Math.round((this.m?.relogio.agora ?? 0) - t);
    if (s < 3) return 'agora';
    if (s < 60) return `há ${s} s`;
    return `há ${Math.round(s / 60)} min`;
  }

  /** Tempo desde a última atividade de uma ala (ms), por extenso e curto. */
  private haQuanto(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 10) return 'agora';
    if (s < 60) return `há ${s} s`;
    const min = Math.floor(s / 60);
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60), r = min % 60;
    return r ? `há ${h} h ${r} min` : `há ${h} h`;
  }

  private anunciar(a: Anuncio): void {
    const li = el('li'); li.dataset.t = String(a.quando);
    const ponto = el('span', 'ponto'); ponto.style.background = a.cor;
    const txt = el('span', 'txt'); const b = el('b', undefined, a.quem); txt.append(b, ' ' + a.texto);
    const q = el('span', 'quando', 'agora');
    li.append(ponto, txt, q);
    this.ticker.append(li);
    while (this.ticker.children.length > 3) this.ticker.firstElementChild?.remove();
    this.evitarSujo = true;
  }

  /** Retângulos (no palco) que os balões evitam: a faixa de eventos e o botão "Precisa de você". */
  private medirEvitar(): void {
    const p = this.palco.getBoundingClientRect();
    const rel = (e: HTMLElement): Ret | null => {
      if (e.hidden || !e.isConnected) return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { l: r.left - p.left - 4, t: r.top - p.top - 4, r: r.right - p.left + 4, b: r.bottom - p.top + 4 } : null;
    };
    this.larguraPalco = p.width; this.alturaPalco = p.height;
    const topo = this.raiz.querySelector('.arc-hud-topo') as HTMLElement | null;
    this.evitar = [rel(this.ticker), rel(this.precisa), rel(this.outraAba)].filter((x): x is Ret => !!x);
    this.topoLivre = topo ? Math.max(8, topo.getBoundingClientRect().bottom - p.top + 6) : 44;
    this.evitarSujo = false;
  }

  /**
   * Balões: no máximo 3 no celular e 7 no PC, por prioridade. Cada caixa fica entre 8 px e a
   * largura menos 8 px, com o bico ainda apontando para o personagem; foge da faixa de eventos;
   * quando bate em outro balão, sobe uma fileira (sem bico) e, se ainda bater, o de menor
   * prioridade some.
   */
  atualizarBaloes(): void {
    const m = this.m, vista = this.vista, cam = this.cam;
    if (!m || !vista || !cam) return;
    const dpr = window.devicePixelRatio || 1;
    const [x0, y0] = cam.origem();
    const agora = m.relogio.agora;
    const ativos = m.pessoas.filter((a) => a.visivel && a.bolha.ate > agora).sort((a, b) => b.bolha.prio - a.bolha.prio || b.bolha.ate - a.bolha.ate);
    const set = new Set(ativos);
    // só escreve no DOM o que mudou: cada escrita de atributo ou estilo custa um recálculo de estilo
    for (const [p, e] of this.elBalao) if (!set.has(p) && !e.hidden) e.hidden = true;
    if (this.evitarSujo) this.medirEvitar();
    const W = this.larguraPalco, H = this.alturaPalco, M = 8;
    const postos: Ret[] = [];
    const bate = (a: Ret, b: Ret) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    let mostrados = 0;
    for (const a of ativos) {
      let e = this.elBalao.get(a);
      if (!e) { e = el('div', 'arc-balao'); e.hidden = true; this.baloes.append(e); this.elBalao.set(a, e); }
      const pt = mostrados < this.maxBaloes ? vista.pontoBalao(a) : null;
      if (!pt) { if (!e.hidden) e.hidden = true; continue; }
      const sx = ((pt[0] - x0) * cam.escala) / dpr, sy = ((pt[1] - y0) * cam.escala) / dpr;
      if (sx < 0 || sx > W || sy < this.topoLivre + 12 || sy > H - 8) { if (!e.hidden) e.hidden = true; continue; }
      const tipo = a.bolha.tipo || (['esperando', 'erro', 'entregou', 'treinando', 'talvez', 'limite'].includes(a.estado) ? a.estado : '');
      if (e.dataset.e !== tipo) e.dataset.e = tipo;
      if (e.dataset.texto !== a.bolha.texto || !e.dataset.w) {
        // mede uma vez por texto (fora disso, nada de ler o layout a cada quadro)
        e.dataset.texto = a.bolha.texto; e.textContent = a.bolha.texto;
        e.style.visibility = 'hidden'; e.hidden = false;
        e.dataset.w = String(e.offsetWidth); e.dataset.h = String(e.offsetHeight);
        e.style.visibility = '';
      }
      const w = Number(e.dataset.w), h = Number(e.dataset.h);
      const l = Math.round(Math.max(M, Math.min(W - M - w, sx - w / 2)));
      let t = Math.round(sy - h - 7);
      let solto = false;
      const caixa = (): Ret => ({ l, t, r: l + w, b: t + h });
      // a faixa de eventos e o botão ficam livres: o balão sobe para cima deles
      for (const ev of this.evitar) if (bate(caixa(), ev)) { t = Math.round(ev.t - h - 4); solto = true; }
      // outro balão no caminho: sobe uma fileira; se ainda bater, este (de menor prioridade) some
      const outro = postos.find((p) => bate(caixa(), p));
      if (outro) { t = outro.t - h - 4; solto = true; }
      if (t < this.topoLivre || postos.some((p) => bate(caixa(), p)) || this.evitar.some((ev) => bate(caixa(), ev))) { if (!e.hidden) e.hidden = true; continue; }
      const pos = `translate(${l}px, ${t}px)`, bico = `${Math.round(Math.max(8, Math.min(w - 8, sx - l)))}px`;
      let ult = this.posBalao.get(e);
      if (!ult) { ult = { pos: '', bico: '' }; this.posBalao.set(e, ult); }
      if (ult.pos !== pos) { e.style.transform = pos; ult.pos = pos; }
      if (ult.bico !== bico) { e.style.setProperty('--bico', bico); ult.bico = bico; }
      if ((e.dataset.solto === '1') !== solto) e.dataset.solto = solto ? '1' : '0';
      if (e.hidden) e.hidden = false;
      postos.push(caixa());
      mostrados++;
    }
    // "Precisa de você": com o servidor, a fila dele (o botão só aparece com alguém esperando)
    const fonte = this.fonteCartoes;
    if (fonte) { if (fonte.versao() !== this.versaoPrecisa) { this.versaoPrecisa = fonte.versao(); this.listaPrecisa = fonte.precisa().map((x) => x.p); } }
    else this.listaPrecisa = m.pessoas.filter((a) => a.visivel && a.estado === 'esperando');
    const esperando = this.listaPrecisa;
    if (this.precisa.hidden !== (esperando.length === 0)) { this.precisa.hidden = esperando.length === 0; this.evitarSujo = true; }
    if (esperando.length) { const t = `Precisa de você: ${[...new Set(esperando.map((a) => a.curto))].join(', ')}`; if (this.precisa.textContent !== t) { this.precisa.textContent = t; this.evitarSujo = true; } }
  }

  /* ---------- cartões ---------- */
  abrirPessoa(p: Pessoa): void { this.alvoCartao = { k: 'pessoa', p }; this.preencherPessoa(p); this.cartao.hidden = false; }
  fecharCartao(): void { this.alvoCartao = null; this.cartao.hidden = true; }

  abrirSala(id: string): void {
    const c = this.fonteCartoes?.sala(id);
    if (!c) { this.fecharCartao(); return; }
    this.alvoCartao = { k: 'sala', id }; this.cartao.hidden = false;
    this.desenharCartao(c, null);
  }

  abrirPrecisa(): void {
    const f = this.fonteCartoes;
    if (!f) return;
    this.alvoCartao = { k: 'precisa' }; this.cartao.hidden = false;
    this.desenharCartao(f.cartaoPrecisa(), null);
  }

  /** Abre o cartão pedido por um item de lista (pessoa, sala ou zona). */
  private abrirItem(a: NonNullable<ItemCartao['abrir']>): void {
    if (a.tipo === 'sala') { this.abrirSala(a.id); return; }
    if (a.tipo === 'zona') { this.abrirZona(a.id); return; }
    const p = this.m?.porId.get(a.id);
    if (!p) return;
    const pt = p.visivel ? this.vista?.pontoBalao(p) : null;
    if (pt && this.cam) { this.cam.explorar(); this.cam.irPara(pt[0], pt[1] + 20); this.marcar('aquario', false); }
    this.abrirPessoa(p);
  }

  /** Cartão a partir dos dados (servidor): título, linhas e listas com itens que abrem outro cartão. */
  private desenharCartao(c: Cartao, p: Pessoa | null): void {
    const dl = el('dl');
    for (const [k, v] of c.linhas) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    const partes: HTMLElement[] = [this.topoCartao(c.titulo, c.sub, c.sprite && p ? this.miniatura(p) : null), dl];
    for (const lista of c.listas) {
      partes.push(el('span', 'sub', lista.titulo));
      const ol = el('ol');
      for (const it of lista.itens.slice(0, 10)) {
        const li = el('li');
        if (it.q !== undefined) li.append(el('span', 'q', it.q));
        if (it.abrir) { const b = el('button', 'arc-link', it.texto); b.type = 'button'; const alvo = it.abrir; b.addEventListener('click', () => this.abrirItem(alvo)); li.append(b); }
        else li.append(el('span', undefined, it.texto));
        ol.append(li);
      }
      partes.push(ol);
    }
    this.cartao.replaceChildren(...partes);
  }

  private miniatura(p: Pessoa): HTMLCanvasElement | null {
    const ap = p.ap;
    if (!ap) return null;
    const cv = el('canvas'); cv.width = this.tam; cv.height = this.tam === 24 ? 40 : 32;
    ampliarCanvas(cv, 2);
    const ant = paletaAtual(); usarPaleta('fria');
    desenharPersonagem(cv.getContext('2d')!, ap, 'parado', 0, false, this.tam, this.maoFeita);
    usarPaleta(ant);
    return cv;
  }

  private topoCartao(titulo: string, sub: string, sprite: HTMLCanvasElement | null): HTMLElement {
    const topo = el('div', 'arc-cartao-topo');
    if (sprite) topo.append(sprite);
    const nome = el('strong', undefined, titulo); nome.append(el('span', 'cargo', sub));
    const fechar = el('button', undefined, 'X'); fechar.type = 'button'; fechar.setAttribute('aria-label', 'Fechar o cartão');
    fechar.addEventListener('click', () => this.fecharCartao());
    topo.append(nome, fechar);
    return topo;
  }

  private preencherPessoa(p: Pessoa): void {
    const m = this.m!;
    const dados = this.fonteCartoes?.agente(p);
    if (dados) { this.desenharCartao(dados, p); return; }
    const ap = p.ap;
    let cv: HTMLCanvasElement | null = null;
    if (ap) {
      cv = el('canvas'); cv.width = this.tam; cv.height = this.tam === 24 ? 40 : 32;
      ampliarCanvas(cv, 2);
      const ant = paletaAtual(); usarPaleta('fria');
      desenharPersonagem(cv.getContext('2d')!, ap, 'parado', 0, false, this.tam, this.maoFeita);
      usarPaleta(ant);
    }
    const zona = m.zonaEm(Math.floor(p.pi), Math.floor(p.pj));
    const dl = el('dl');
    const agora = p.naRecarga ? `em espera na cápsula (${p.estado === 'dormindo' ? 'dormindo' : 'recarregando'})` : (ROTULO_ESTADO[p.estado] ?? p.estado);
    for (const [k, v] of [['Onde', zona ? zona.titulo : 'Corredor'], ['Agora', agora], ['Tarefa', p.tarefa]] as const) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    const sub = el('span', 'sub', 'Últimas ações');
    const ol = el('ol');
    for (const h of p.historico) { const li = el('li'); li.append(el('span', 'q', this.quandoFoi(h.t)), el('span', undefined, h.texto)); ol.append(li); }
    this.cartao.replaceChildren(this.topoCartao(p.nome, p.cargo, cv), dl, sub, ol);
  }

  abrirZona(id: string): void {
    const m = this.m!;
    const z = m.zonaPorId.get(id); if (!z) return;
    this.alvoCartao = { k: 'zona', id }; this.cartao.hidden = false;
    const dados = this.fonteCartoes?.zona(id);
    if (dados) { this.desenharCartao(dados, null); return; }
    const presentes = m.pessoas.filter((a) => a.visivel && m.zonaEm(Math.floor(a.pi), Math.floor(a.pj)) === z);
    const ativos = presentes.filter((a) => !a.naRecarga && a.estado !== 'ocioso' && a.estado !== 'dormindo').length;
    const dl = el('dl');
    const salasZona = m.salasPorZona.get(id) ?? [];
    const pods = salasZona.filter((s) => s.estilo === 'pod').map((s) => `${s.nome}${s.dormindo ? ' (dormindo)' : ''}`).join(', ');
    const ez = m.estadoZona.get(id);
    const estado = ez?.espera ? 'em espera' : ez && ez.nivel < 1 ? 'acordando' : presentes.length ? (ativos ? 'ativa' : 'calma') : 'vazia';
    const linhas: [string, string][] = [['Estado', estado], ['Gente', String(presentes.length)]];
    if (salasZona.length) linhas.push(['Última atividade', this.haQuanto(m.agoraEpoch() - m.ultimaAtividadeZona(id))]);
    if (pods) linhas.push(['Salas', pods]);
    linhas.push(['Sobre', z.texto]);
    for (const [k, v] of linhas) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    const sub = el('span', 'sub', presentes.length ? 'Quem está aqui' : 'Ninguém agora');
    const ol = el('ol');
    for (const a of presentes) { const li = el('li'); li.append(el('span', 'q', a.curto), el('span', undefined, `${ROTULO_ESTADO[a.estado]}: ${a.tarefa}`)); ol.append(li); }
    this.cartao.replaceChildren(this.topoCartao(z.titulo, z.tipo === 'ala' ? 'Ala do andar' : 'Área do andar', null), dl, sub, ol);
  }

  /* ---------- entrada: arrastar, pinça, roda e toque ---------- */
  private ligarEntrada(): void {
    const palco = this.palco, cam = this.cam!, acoes = this.acoes!;
    const ponteiros = new Map<number, { x: number; y: number }>();
    // direcao: numa página que rola, o primeiro trecho do arrasto decide se ele é da página (vertical) ou do mundo
    let arrasto: { x: number; y: number; t: number; mov: number; direcao?: 'h' | 'v' } | null = null;
    let pinca: { d: number } | null = null;
    palco.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, .arc-cartao')) return;
      palco.setPointerCapture(e.pointerId);
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ponteiros.size === 1) arrasto = { x: e.clientX, y: e.clientY, t: performance.now(), mov: 0 };
      if (ponteiros.size === 2) { const [a, b] = [...ponteiros.values()]; pinca = { d: Math.hypot(a.x - b.x, a.y - b.y) }; arrasto = null; }
    });
    palco.addEventListener('pointermove', (e) => {
      const p = ponteiros.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pinca && ponteiros.size === 2) {
        const [a, b] = [...ponteiros.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d / pinca.d > 1.18) { acoes.zoom(1); pinca.d = d; this.marcar('aquario', false); }
        else if (d / pinca.d < 0.85) { acoes.zoom(-1); pinca.d = d; this.marcar('aquario', false); }
        return;
      }
      if (arrasto) {
        arrasto.mov += Math.abs(dx) + Math.abs(dy);
        if (palco.dataset.rolagem === '1' && palco.dataset.interagindo !== '1' && !arrasto.direcao) {
          // página que rola: o mundo só anda se o gesto começar na horizontal
          const tx = Math.abs(e.clientX - arrasto.x), ty = Math.abs(e.clientY - arrasto.y);
          if (tx + ty < 4) return;
          arrasto.direcao = ty > tx ? 'v' : 'h';
        }
        if (arrasto.direcao === 'v') return;
        if (arrasto.mov > 6) { acoes.arrastar(dx, dy); this.marcar('aquario', false); }
      }
    });
    const soltar = (e: PointerEvent) => {
      if (!ponteiros.has(e.pointerId)) return;
      ponteiros.delete(e.pointerId);
      // cancelado (o navegador assumiu o gesto para rolar a página) não conta como toque
      if (e.type === 'pointerup' && arrasto && arrasto.mov <= 6 && performance.now() - arrasto.t < 450) {
        if (palco.dataset.rolagem === '1') palco.dataset.interagindo = '1';
        this.tocar(e.clientX, e.clientY);
      }
      if (ponteiros.size < 2) pinca = null;
      if (!ponteiros.size) arrasto = null;
    };
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);
    palco.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = palco.getBoundingClientRect();
      acoes.zoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      this.marcar('aquario', false);
    }, { passive: false });
    void cam;
  }

  private tocar(cx: number, cy: number): void {
    const cam = this.cam!, vista = this.vista!;
    const r = this.palco.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const [x0, y0] = cam.origem();
    const wx = x0 + ((cx - r.left) * dpr) / cam.escala, wy = y0 + ((cy - r.top) * dpr) / cam.escala;
    const alvo = vista.tocar(wx, wy);
    const sala = !alvo?.pessoa && alvo?.ladrilho && this.fonteCartoes ? this.fonteCartoes.salaEm(alvo.ladrilho[0], alvo.ladrilho[1]) : null;
    if (alvo?.pessoa) this.abrirPessoa(alvo.pessoa);
    else if (sala) this.abrirSala(sala);
    else if (alvo?.zona) this.abrirZona(alvo.zona);
    else this.fecharCartao();
  }

  /**
   * Palco dentro de uma página que rola (/prototipos no celular): o arrasto vertical rola a página;
   * o mundo anda com arrasto horizontal e, depois de um toque nele, com qualquer gesto. Um toque
   * fora do palco devolve a rolagem.
   */
  permitirRolagem(): void {
    this.palco.dataset.rolagem = '1';
    const fora = (e: PointerEvent) => { if (!this.palco.contains(e.target as Node)) delete this.palco.dataset.interagindo; };
    document.addEventListener('pointerdown', fora);
    this.desligarRolagem = () => document.removeEventListener('pointerdown', fora);
  }

  destruir(): void {
    clearInterval(this.intervalo);
    this.desligarRolagem();
    this.palco.remove();
  }
}
