// O laço do Arcadia: requestAnimationFrame próprio, com teto de quadros (30 no celular, 60 no
// PC), simulação a passo fixo, pausa total quando a aba some e contadores de quadro desenhado.
// A medição de fps conta o contador deste laço (nunca a duração de um quadro).

export interface Medidas {
  /** Quadros desenhados desde o início. */
  quadros: number;
  fps: number;
  /** Média de ms de CPU por quadro desenhado no último segundo. */
  ms: number;
  msDesenho: number;
}

export interface OpcoesLaco {
  teto: number;               // 0 = sem teto
  passoSim: number;           // segundos (fixo)
  simular: (dt: number) => void;
  quadro: (dtReal: number) => void;   // câmera, desenho, balões
}

export class Laco {
  readonly medidas: Medidas = { quadros: 0, fps: 0, ms: 0, msDesenho: 0 };
  /** Registro opcional para a medição externa (tempo de início e custo de cada quadro desenhado). */
  registro: { on: boolean; ts: number[]; custo: number[]; desenho: number[] } = { on: false, ts: [], custo: [], desenho: [] };
  pausado = false;
  private op: OpcoesLaco;
  private id = 0;
  private anterior = -1;
  private ultimoDesenho = -1;
  private acumTeto = 0;
  private acumSim = 0;
  private nJanela = 0;
  private tJanela = 0;
  private msJanela = 0;
  private msDesJanela = 0;
  private vivo = false;
  private aoMudarVisibilidade = () => {
    if (document.hidden) this.parar();
    else this.iniciar();
  };

  constructor(op: OpcoesLaco) { this.op = op; }

  iniciar(): void {
    if (this.vivo) return;
    this.vivo = true;
    this.anterior = -1;
    this.acumTeto = 0;
    document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
    if (!document.hidden) this.id = requestAnimationFrame(this.tique);
  }

  parar(): void {
    this.vivo = false;
    cancelAnimationFrame(this.id);
    // ao voltar, recomeça sem um salto de tempo
    this.anterior = -1;
  }

  destruir(): void {
    this.parar();
    document.removeEventListener('visibilitychange', this.aoMudarVisibilidade);
  }

  set teto(v: number) { this.op.teto = v; }
  get teto(): number { return this.op.teto; }

  /** Marca o tempo gasto só no desenho (para separar do resto do quadro). */
  marcarDesenho(ms: number): void { this.msDesJanela += ms; if (this.registro.on) this.registro.desenho.push(ms); }

  private tique = (agora: number) => {
    if (!this.vivo) return;
    this.id = requestAnimationFrame(this.tique);
    if (document.hidden) { this.parar(); return; }
    if (this.anterior < 0) { this.anterior = agora; this.ultimoDesenho = agora; return; }
    const dtMs = Math.min(100, agora - this.anterior);
    this.anterior = agora;
    this.acumTeto += dtMs;
    const intervalo = this.op.teto > 0 ? 1000 / this.op.teto : 0;
    if (intervalo && this.acumTeto < intervalo - 2) return;
    // a sobra fica limitada a meio intervalo: um tranco não desloca o ritmo para sempre
    this.acumTeto = intervalo ? Math.max(0, Math.min(this.acumTeto - intervalo, intervalo / 2)) : 0;
    // o passo é o tempo real desde o último quadro desenhado
    const dt = Math.min(0.1, (agora - this.ultimoDesenho) / 1000);
    this.ultimoDesenho = agora;
    const ini = performance.now();
    if (!this.pausado) {
      this.acumSim += dt;
      const passo = this.op.passoSim;
      let n = 0;
      while (this.acumSim >= passo && n < 8) { this.op.simular(passo); this.acumSim -= passo; n++; }
      if (n === 8) this.acumSim = 0;
    }
    this.op.quadro(dt);
    const custo = performance.now() - ini;
    this.medidas.quadros++;
    if (this.registro.on) { this.registro.ts.push(ini); this.registro.custo.push(custo); }
    this.nJanela++; this.tJanela += dt; this.msJanela += custo;
    if (this.tJanela >= 1) {
      this.medidas.fps = this.nJanela / this.tJanela;
      this.medidas.ms = this.msJanela / this.nJanela;
      this.medidas.msDesenho = this.msDesJanela / this.nJanela;
      this.nJanela = 0; this.tJanela = 0; this.msJanela = 0; this.msDesJanela = 0;
    }
  };
}
