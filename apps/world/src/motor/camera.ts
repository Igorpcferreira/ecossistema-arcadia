// Câmera: centro (x, y) em pixels de arte, escala inteira (pixels físicos por pixel de arte),
// origem da tela sempre arredondada (sem tremer) e o diretor do modo aquário, que passeia
// sozinho pelas zonas e dá prioridade a quem espera você: espera nova leva a câmera até ela
// na hora (em menos de 2 s), sem esperar a troca de plano. Depois de 25 s sem toque, o
// aquário volta sozinho.
import { semeado } from '../cena/mundo.ts';

export interface AlvosCamera {
  /** Centro de uma zona para o passeio. */
  alvoZona(id: string): [number, number] | null;
  /** Alguém que precisa de atenção (esperando você), se houver. */
  alvoUrgente(): [number, number] | null;
  /** Todos que esperam você agora (id e ponto), do pedido mais antigo para o mais novo. */
  urgentes?(): { id: string; x: number; y: number }[];
  /** Foco forçado (obra, sessão que chega e acorda uma ala), se houver. */
  alvoForcado(): [number, number] | null;
  /** Ala em espera: o passeio passa menos por ela. */
  emEspera?(id: string): boolean;
  /** Borda de baixo do chão na coluna x da tela (o enquadramento da carga no celular não mostra o vazio). */
  fundoEm?(x: number): number;
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
  /** Esperas que o aquário já mostrou; a que não está aqui é nova. */
  private esperasVistas = new Set<string>();
  /** Espera nova que a câmera segue até o fim do plano. */
  private esperaSeguida: string | null = null;
  /** Segundos de movimento rápido (a ida até uma espera nova). */
  private depressa = 0;
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
      // espera nova: a câmera vai até ela já e fica nela o plano inteiro (antes de chegada ou obra)
      const lista = this.alvos.urgentes?.() ?? [];
      for (const id of this.esperasVistas) if (!lista.some((u) => u.id === id)) this.esperasVistas.delete(id);
      const novas = lista.filter((u) => !this.esperasVistas.has(u.id));
      if (novas.length) {
        for (const u of novas) this.esperasVistas.add(u.id);
        this.esperaSeguida = novas[novas.length - 1].id; this.proximoPlano = Math.max(this.proximoPlano, 9); this.depressa = 2;
      }
      const seguida = this.esperaSeguida ? lista.find((u) => u.id === this.esperaSeguida) : undefined;
      if (!seguida || this.proximoPlano <= 0) this.esperaSeguida = null;
      // quem espera você vem antes de qualquer chegada ou obra
      const urgente = this.alvos.alvoUrgente();
      const forcado = this.alvos.alvoForcado();
      seguindo = !!forcado && !urgente;
      if (seguida && this.esperaSeguida) { this.ax = seguida.x; this.ay = seguida.y; }
      else if (forcado && urgente) { this.ax = urgente[0]; this.ay = urgente[1]; this.proximoPlano = Math.max(this.proximoPlano, 2); }
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
    this.depressa = Math.max(0, this.depressa - dt);
    const k = this.cortes ? 1 : Math.min(1, dt * (this.aquario ? (seguindo || this.depressa > 0 ? 3 : 1.1) : 8));
    this.x += (this.ax - this.x) * k; this.y += (this.ay - this.y) * k;
    this.limitar();
  }

  aguardarPlano(seg: number): void { this.proximoPlano = seg; }
}
