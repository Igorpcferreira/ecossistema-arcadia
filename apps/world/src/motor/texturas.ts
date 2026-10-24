// Gerenciador de texturas: tudo o que é desenhado por código (objetos, quadros de animação,
// personagens, brilhos, ícones) vira um retângulo num atlas de 2048 px, com chave numérica.
// Os desenhos são feitos em lotes num rascunho grande, aparados (só os pixels visíveis vão
// para o atlas) e guardados com o deslocamento até a âncora. Ler os pixels do rascunho uma vez
// por lote (e não uma vez por desenho) deixou a carga bem mais rápida no celular.
// Quase tudo é assado na carga. Depois dela, o que nasce com os dados (a placa de uma sala nova,
// um bot novo) é assado uma vez, no próprio quadro em que aparece, direto na folha (assarTarde);
// nada é redesenhado pixel a pixel a cada quadro.
import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import { esquecerEstilo } from '../arte/primitivas.ts';

export interface Quadro {
  tex: Texture;
  /** Deslocamento do canto do quadro até a âncora do desenho. */
  dx: number;
  dy: number;
  w: number;
  h: number;
}

interface Item { folha: number; x: number; y: number; w: number; h: number; dx: number; dy: number }
interface Prateleira { y: number; h: number; x: number }
interface Folha { c: HTMLCanvasElement; g: CanvasRenderingContext2D; prateleiras: Prateleira[]; yLivre: number; usados: number }
interface Pendente { id: number; x: number; y: number; w: number; h: number; ox: number; oy: number }

const PAD = 2;
const RASC = 1024;

export class Atlas {
  readonly lado: number;
  readonly maxFolhas: number;
  private folhas: Folha[] = [];
  private itens: Item[] = [];
  private quadros: Quadro[] = [];
  private rasc: HTMLCanvasElement;
  private gr: CanvasRenderingContext2D;
  private chaves = new Map<string, number>();
  private pendentes: Pendente[] = [];
  private rascPrat: Prateleira[] = [];
  private rascY = 0;
  private rascAltUsada = 0;
  private rascLargUsada = 0;
  private pronto = false;
  /** Fontes do PixiJS de cada folha (existem depois de finalizar). */
  private fontes: TextureSource[] = [];
  /** Folhas que mudaram depois da carga: sobem para a placa de vídeo uma vez por quadro (publicar). */
  private sujas = new Set<number>();
  /** Rascunho pequeno dos desenhos feitos depois da carga. */
  private rascTarde: HTMLCanvasElement | null = null;
  /** Desenhos assados depois da carga (medição) e os que não couberam no atlas. */
  tarde = { assados: 0, semLugar: 0 };
  /** Quantos desenhos já foram assados (para a barra de carga). */
  assados = 0;
  /** Tempo gasto na carga: desenhar, aparar (ler os pixels) e copiar para a folha. */
  tempos = { desenho: 0, aparar: 0, copia: 0 };

  constructor(lado = 2048, maxFolhas = 1) {
    this.lado = lado;
    this.maxFolhas = maxFolhas;
    this.rasc = document.createElement('canvas');
    this.rasc.width = RASC; this.rasc.height = RASC;
    this.gr = this.rasc.getContext('2d', { willReadFrequently: true })!;
  }

  /** Id já assado para uma chave de texto (só na montagem; no jogo os ids são números). */
  idDe(chave: string): number | undefined { return this.chaves.get(chave); }

  /**
   * Desenha num quadro de w por h, com a âncora em (ox, oy), e guarda no atlas (aparado).
   * Devolve o id numérico do quadro (repetir a mesma chave devolve o mesmo id).
   */
  assar(chave: string, w: number, h: number, ox: number, oy: number, desenhar: (g: CanvasRenderingContext2D) => void): number {
    const ja = this.chaves.get(chave);
    if (ja !== undefined) return ja;
    if (this.pronto) return this.assarTarde(chave, w, h, ox, oy, desenhar);
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    if (w > RASC || h > RASC) throw new Error(`desenho grande demais para o rascunho: ${w} por ${h}`);
    let lugar = this.lugarNoRascunho(w, h);
    if (!lugar) { this.descarregar(); lugar = this.lugarNoRascunho(w, h)!; }
    const g = this.gr;
    const t0 = performance.now();
    g.save();
    g.setTransform(1, 0, 0, 1, lugar.x, lugar.y);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    esquecerEstilo(g);
    desenhar(g);
    g.restore();
    esquecerEstilo(g);
    this.tempos.desenho += performance.now() - t0;
    const id = this.itens.length;
    this.itens.push({ folha: -1, x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 });
    this.pendentes.push({ id, x: lugar.x, y: lugar.y, w, h, ox, oy });
    this.chaves.set(chave, id);
    this.assados++;
    return id;
  }

  private lugarNoRascunho(w: number, h: number): { x: number; y: number } | null {
    const hc = Math.ceil((h + 1) / 8) * 8;
    for (const p of this.rascPrat) if (p.h >= hc && p.h <= hc + 8 && p.x + w + 1 <= RASC) { const x = p.x; p.x += w + 1; this.rascLargUsada = Math.max(this.rascLargUsada, p.x); return { x, y: p.y }; }
    if (this.rascY + hc > RASC) return null;
    const p: Prateleira = { y: this.rascY, h: hc, x: w + 1 };
    this.rascPrat.push(p); this.rascY += hc;
    this.rascAltUsada = this.rascY; this.rascLargUsada = Math.max(this.rascLargUsada, p.x);
    return { x: 0, y: p.y };
  }

  /** Lê os pixels do lote uma vez, apara cada desenho e copia para as folhas do atlas. */
  private descarregar(): void {
    if (!this.pendentes.length) return;
    const t0 = performance.now();
    const W = Math.min(RASC, this.rascLargUsada), H = Math.min(RASC, this.rascAltUsada);
    const img = this.gr.getImageData(0, 0, W, H);
    const px = new Uint32Array(img.data.buffer);
    this.tempos.aparar += performance.now() - t0;
    for (const p of this.pendentes) {
      const t1 = performance.now();
      let x0 = p.w, y0 = p.h, x1 = -1, y1 = -1;
      for (let y = 0; y < p.h; y++) {
        const base = (p.y + y) * W + p.x;
        let algum = false;
        for (let x = 0; x < p.w; x++) {
          if (px[base + x] !== 0) { algum = true; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        if (algum) { if (y < y0) y0 = y; y1 = y; }
      }
      const t2 = performance.now();
      this.tempos.aparar += t2 - t1;
      if (x1 < 0) continue;
      const tw = x1 - x0 + 1, th = y1 - y0 + 1;
      const lugar = this.reservar(tw, th);
      const f = this.folhas[lugar.folha];
      f.g.drawImage(this.rasc, p.x + x0, p.y + y0, tw, th, lugar.x, lugar.y, tw, th);
      f.usados += tw * th;
      this.itens[p.id] = { folha: lugar.folha, x: lugar.x, y: lugar.y, w: tw, h: th, dx: x0 - p.ox, dy: y0 - p.oy };
      this.tempos.copia += performance.now() - t2;
    }
    this.pendentes = [];
    this.gr.clearRect(0, 0, RASC, RASC);
    this.rascPrat = []; this.rascY = 0; this.rascAltUsada = 0; this.rascLargUsada = 0;
  }

  private reservar(w: number, h: number): { folha: number; x: number; y: number } {
    if (w + PAD > this.lado || h + PAD > this.lado) throw new Error(`desenho grande demais para o atlas: ${w} por ${h}`);
    const hc = Math.ceil((h + PAD) / 4) * 4;
    for (let k = 0; k < this.folhas.length; k++) {
      const f = this.folhas[k];
      for (const p of f.prateleiras) {
        if (p.h >= hc && p.h <= hc + 4 && p.x + w + PAD <= this.lado) { const x = p.x; p.x += w + PAD; return { folha: k, x, y: p.y }; }
      }
      if (f.yLivre + hc <= this.lado) { const p: Prateleira = { y: f.yLivre, h: hc, x: w + PAD }; f.prateleiras.push(p); f.yLivre += hc; return { folha: k, x: 0, y: p.y }; }
    }
    if (this.folhas.length >= this.maxFolhas) throw new Error(`o atlas encheu (${this.maxFolhas} folha(s) de ${this.lado} px)`);
    const c = document.createElement('canvas');
    c.width = this.lado; c.height = this.lado;
    const g = c.getContext('2d')!;
    this.folhas.push({ c, g, prateleiras: [{ y: 0, h: hc, x: w + PAD }], yLivre: hc, usados: 0 });
    return { folha: this.folhas.length - 1, x: 0, y: 0 };
  }

  /**
   * Depois da carga: desenha num rascunho do tamanho do quadro, apara, copia para um lugar livre
   * de uma folha e marca a folha para subir de novo à placa de vídeo. Sem lugar no atlas, o
   * quadro fica vazio (o objeto aparece sem aquele desenho) e a falta é contada.
   */
  private assarTarde(chave: string, w: number, h: number, ox: number, oy: number, desenhar: (g: CanvasRenderingContext2D) => void): number {
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    const c = this.rascTarde ?? (this.rascTarde = document.createElement('canvas'));
    if (c.width < w) c.width = w;
    if (c.height < h) c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    esquecerEstilo(g); desenhar(g); g.restore(); esquecerEstilo(g);
    const px = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] !== 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const id = this.itens.length;
    this.chaves.set(chave, id);
    this.assados++; this.tarde.assados++;
    const vazio = () => { this.itens.push({ folha: -1, x: 0, y: 0, w: 0, h: 0, dx: 0, dy: 0 }); this.quadros.push({ tex: Texture.EMPTY, dx: 0, dy: 0, w: 0, h: 0 }); return id; };
    if (x1 < 0) return vazio();
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    let lugar: { folha: number; x: number; y: number };
    try { lugar = this.reservar(tw, th); } catch { this.tarde.semLugar++; return vazio(); }
    const f = this.folhas[lugar.folha];
    f.g.drawImage(c, x0, y0, tw, th, lugar.x, lugar.y, tw, th);
    f.usados += tw * th;
    let fonte = this.fontes[lugar.folha];
    if (!fonte) { fonte = Texture.from(f.c).source; fonte.scaleMode = 'nearest'; this.fontes[lugar.folha] = fonte; }
    else this.sujas.add(lugar.folha);
    const it: Item = { folha: lugar.folha, x: lugar.x, y: lugar.y, w: tw, h: th, dx: x0 - ox, dy: y0 - oy };
    this.itens.push(it);
    this.quadros.push({ tex: new Texture({ source: fonte, frame: new Rectangle(it.x, it.y, it.w, it.h) }), dx: it.dx, dy: it.dy, w: it.w, h: it.h });
    return id;
  }

  /** Sobe para a placa de vídeo as folhas que ganharam desenhos depois da carga (uma vez por lote). */
  publicar(): void {
    if (!this.sujas.size) return;
    for (const k of this.sujas) this.fontes[k]?.update();
    this.sujas.clear();
  }

  /** Cria as texturas do PixiJS (uma fonte por folha, um recorte por quadro). */
  finalizar(): void {
    if (this.pronto) return;
    this.descarregar();
    const fontes = this.folhas.map((f) => Texture.from(f.c).source);
    for (const fo of fontes) fo.scaleMode = 'nearest';
    this.fontes = fontes;
    this.quadros = this.itens.map((it) => {
      if (it.folha < 0) return { tex: Texture.EMPTY, dx: 0, dy: 0, w: 0, h: 0 };
      const tex = new Texture({ source: fontes[it.folha], frame: new Rectangle(it.x, it.y, it.w, it.h) });
      return { tex, dx: it.dx, dy: it.dy, w: it.w, h: it.h };
    });
    // o rascunho não é mais necessário
    this.rasc.width = 1; this.rasc.height = 1;
    this.pronto = true;
  }

  quadro(id: number): Quadro { return this.quadros[id]; }
  get total(): number { return this.itens.length; }

  uso(): { folhas: number; lado: number; ocupacao: number; mb: number; quadros: number } {
    const area = this.lado * this.lado;
    const usados = this.folhas.reduce((s, f) => s + f.usados, 0);
    return { folhas: this.folhas.length, lado: this.lado, ocupacao: this.folhas.length ? usados / (area * this.folhas.length) : 0, mb: (this.folhas.length * area * 4) / 1048576, quadros: this.itens.length };
  }

  /** Canvas das folhas (para inspeção e capturas do atlas). */
  canvases(): HTMLCanvasElement[] { return this.folhas.map((f) => f.c); }

  destruir(): void {
    const fontes = new Set(this.quadros.filter((q) => q.tex !== Texture.EMPTY).map((q) => q.tex.source));
    for (const q of this.quadros) if (q.tex !== Texture.EMPTY) q.tex.destroy(false);
    for (const fo of fontes) fo.destroy();
    for (const f of this.folhas) { f.c.width = 1; f.c.height = 1; }
    this.folhas = []; this.itens = []; this.quadros = []; this.chaves.clear(); this.fontes = []; this.sujas.clear();
    if (this.rascTarde) { this.rascTarde.width = 1; this.rascTarde.height = 1; this.rascTarde = null; }
  }
}
