// Câmera: centro (x, y) em pixels de arte, escala inteira (pixels físicos por pixel de arte),
// origem da tela sempre arredondada (sem tremer) e o diretor do modo aquário, que passeia
// sozinho pelas zonas e dá prioridade a quem espera você. Depois de 25 s sem toque, o
// aquário volta sozinho.
import { semeado } from '../cena/mundo.ts';

export interface AlvosCamera {
  /** Centro de uma zona para o passeio. */
  alvoZona(id: string): [number, number] | null;
  /** Alguém que precisa de atenção (esperando você), se houver. */
  alvoUrgente(): [number, number] | null;
  /** Foco forçado (obra, sessão que chega e acorda uma ala), se houver. */
  alvoForcado(): [number, number] | null;
  /** Ala em espera: o passeio passa menos por ela. */
  emEspera?(id: string): boolean;
  limites(vw: number, vh: number): { minX: number; maxX: number; minY: number; maxY: number };
}

export class Camera {
  x = 0; y = 0; ax = 0; ay = 0;
  escala = 2;
  escalaMin = 1;
  escalaMax = 10;
  vw = 1; vh = 1;
  aquario = true;
  /** Câmera parada (capturas e ?aquario=0): não volta sozinha para o aquário. */
  travada = false;
  /** Movimento reduzido: troca de plano em corte seco, sem deslizar. */
  cortes = false;
  ultimoToque = -1e9;
  private proximoPlano = 7;
  private indice = 0;
  private rng: () => number;
  roteiro: string[];
  alvos: AlvosCamera;

  constructor(alvos: AlvosCamera, roteiro: string[], semente: number) {
    this.alvos = alvos; this.roteiro = roteiro; this.rng = semeado(semente * 13 + 5);
  }

  origem(): [number, number] { return [Math.round(this.x - this.vw / 2), Math.round(this.y - this.vh / 2)]; }

  limitar(): void {
    const l = this.alvos.limites(this.vw, this.vh);
    this.x = Math.max(Math.min(l.minX, l.maxX), Math.min(Math.max(l.minX, l.maxX), this.x));
    this.y = Math.max(Math.min(l.minY, l.maxY), Math.min(Math.max(l.minY, l.maxY), this.y));
  }

  irPara(x: number, y: number, imediato = false): void {
    this.ax = x; this.ay = y;
    if (imediato) { this.x = x; this.y = y; this.limitar(); }
  }

  explorar(): void { this.aquario = false; this.ultimoToque = performance.now(); }
  ligarAquario(v: boolean): void { this.aquario = v; this.travada = false; this.ultimoToque = performance.now(); this.proximoPlano = 0; }

  /** Move a câmera um passo (dt em segundos). */
  dirigir(dt: number): void {
    // seguindo alguém (sessão que chega), a câmera anda mais firme, sem ficar para trás
    let seguindo = false;
    if (!this.aquario) {
      if (!this.travada && performance.now() - this.ultimoToque > 25000) { this.aquario = true; this.proximoPlano = 0; }
    } else {
      this.proximoPlano -= dt;
      // quem espera você vem antes de qualquer chegada ou obra
      const urgente = this.alvos.alvoUrgente();
      const forcado = this.alvos.alvoForcado();
      seguindo = !!forcado && !urgente;
      if (forcado && urgente) { this.ax = urgente[0]; this.ay = urgente[1]; this.proximoPlano = Math.max(this.proximoPlano, 2); }
      else if (forcado) { this.ax = forcado[0]; this.ay = forcado[1]; }
      else if (this.proximoPlano <= 0) {
        this.proximoPlano = 8 + this.rng() * 4;
        if (urgente && this.rng() < 0.7) { this.ax = urgente[0]; this.ay = urgente[1]; }
        else if (this.roteiro.length) {
          // alas em espera entram no passeio só de vez em quando: o aquário mostra onde há trabalho
          let id = this.roteiro[this.indice++ % this.roteiro.length];
          for (let k = 0; k < this.roteiro.length && this.alvos.emEspera?.(id) && this.rng() < 0.75; k++) id = this.roteiro[this.indice++ % this.roteiro.length];
          const alvo = this.alvos.alvoZona(id);
          if (alvo) { this.ax = alvo[0]; this.ay = alvo[1]; }
        }
      }
    }
    const k = this.cortes ? 1 : Math.min(1, dt * (this.aquario ? (seguindo ? 3 : 1.1) : 8));
    this.x += (this.ax - this.x) * k; this.y += (this.ay - this.y) * k;
    this.limitar();
  }

  aguardarPlano(seg: number): void { this.proximoPlano = seg; }
}
