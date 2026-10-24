// Simulador determinístico com semente, equivalente ao da prancha: pedidos, delegações por
// drone, "esperando você", erros, entregas, treino, café, subagentes, visitantes pelo
// teletransporte e a sala nova em obra. Acrescenta os estados da seção 4.3 que a prancha não
// tinha: chegando, na fila, talvez esperando, sem sinal, limite de uso e dormindo.
// Alas em espera: o trabalho chega por turnos. Uma sessão nova entra pelo teletransporte e
// acorda a ala; quando o turno acaba, a sessão volta pelo teletransporte e os bots, sem tarefa
// depois de `ocio.pausaMinutos`, vão para a cápsula de recarga da própria ala; academia e lounge
// ficam para as pausas curtas entre tarefas. A sala dorme depois de `ocio.dormeMinutos` sem
// atividade (mundo.ts) e a ala volta para a espera.
// Os roteiros são geradores avançados a passo fixo: a mesma semente dá sempre a mesma
// sequência de eventos, em qualquer taxa de quadros.
import type { Estado, EventoAgenda, Personagem, Spot } from './formato.ts';
import { DESCANSO, Mundo, Pessoa, VEL_CHEGADA, VEL_PADRAO } from './mundo.ts';
import { CORES_ESTADO } from '../arte/estados.ts';

type Espera = { ate: number } | (() => boolean);
type Roteiro = Generator<Espera, void, unknown>;

export class Simulador {
  readonly m: Mundo;
  private agenda: { g: Roteiro; e: Espera }[] = [];
  private t = { espera: 1.2, dono: 9, fixo: 14, visita: 22, treinoDono: 40, vida: 1, turno: 0 };
  /** Até quando cada ala tem trabalho (segundos de simulação). */
  private turnos = new Map<string, number>();
  private iAgenda = 0;
  private readonly pausaS: number;
  private readonly dormeS: number;
  /** Ócio curto (?ocio=rapido): o ciclo inteiro de espera cabe em um ou dois minutos. */
  private readonly rapido: boolean;
  ligado = true;
  /**
   * Só a vida ambiente: o dono treina, a pessoa fixa toma café e os figurantes passeiam. Os
   * agentes, nesse modo, são do coreógrafo (dados do servidor), e nada daqui vai para a faixa de eventos.
   */
  soAmbiente = false;

  constructor(m: Mundo) {
    this.m = m;
    this.pausaS = m.cena.ocio.pausaMinutos * 60;
    this.dormeS = m.cena.ocio.dormeMinutos * 60;
    this.rapido = m.cena.ocio.dormeMinutos <= 2;
    this.t.turno = this.rapido ? 30 : 120;
    for (const f of m.pessoas.filter((p) => p.def.papel === 'figurante')) this.iniciar(this.figurante(f));
    const rec = m.pessoas.find((p) => p.def.papel === 'recepcionista');
    if (rec) rec.pose = 'parado';
    // as alas acordadas no começo já têm trabalho
    for (const z of m.zonas) if (z.tipo === 'ala' && !m.emEspera(z.id)) this.turnos.set(z.id, this.rapido ? this.entre(50, 80) : this.entre(12, 25) * 60);
  }

  /* ---------- utilidades ---------- */
  private r = () => this.m.rng();
  private entre = (a: number, b: number) => a + this.r() * (b - a);
  private escolha<T>(l: readonly T[]): T { return l[Math.floor(this.r() * l.length)]; }
  private get agora() { return this.m.relogio.agora; }
  private esperar(seg: number): Espera { return { ate: this.agora + seg }; }
  private duracaoTurno(): number { return this.rapido ? this.entre(40, 70) : this.entre(8, 20) * 60; }

  /** A zona tem trabalho agora (áreas comuns sempre têm). */
  turnoAtivo(zonaId: string): boolean {
    const z = this.m.zonaPorId.get(zonaId);
    if (!z || z.tipo !== 'ala') return true;
    return (this.turnos.get(zonaId) ?? -1) > this.agora;
  }
  private temTrabalho(p: Pessoa): boolean { return this.turnoAtivo(p.zonaTrabalho); }

  /** Botão "Projeto novo": começa a obra antes da hora. */
  construirAgora(): void {
    if (this.m.obra.fase === 'vazio' && this.m.cena.pontos.terreno) this.iniciar(this.construir());
  }

  /** Botão "Chegou trabalho": acorda uma ala em espera (sessão nova ou pedido a um bot). */
  chegarTrabalho(): void { this.novoTurno(true); }

  iniciar(g: Roteiro): void {
    const r = g.next();
    if (!r.done) this.agenda.push({ g, e: r.value });
  }

  private rodarAgenda(): void {
    for (let i = 0; i < this.agenda.length; i++) {
      const item = this.agenda[i];
      let guarda = 0;
      while (guarda++ < 8) {
        const pronto = typeof item.e === 'function' ? item.e() : this.agora >= item.e.ate;
        if (!pronto) break;
        const r = item.g.next();
        if (r.done) { this.agenda.splice(i, 1); i--; break; }
        item.e = r.value;
      }
    }
  }

  private get dono() { return this.m.pessoas.find((p) => p.def.papel === 'dono'); }
  private get fixo() { return this.m.pessoas.find((p) => p.def.papel === 'fixo'); }
  private get agentes() { return this.m.pessoas.filter((p) => p.def.tipo === 'agente' && p.def.papel !== 'visitante' && p.visivel); }

  /** Um passo fixo da simulação. */
  passo(dt: number): void {
    const m = this.m;
    m.relogio.agora += dt; m.tAnim += dt;
    const ag = m.cena.agenda;
    while (this.iAgenda < ag.length && ag[this.iAgenda].t <= this.agora) this.executar(ag[this.iAgenda++]);
    this.rodarAgenda();
    if (this.ligado) this.dirigir(dt);
    for (const p of m.pessoas) p.atualizar(dt);
    m.atualizarEfeitos(dt);
    m.atualizarOcio(dt);
  }

  /** Um evento da agenda do cenário. */
  private executar(ev: EventoAgenda): void {
    const p = this.m.porId.get(ev.quem);
    if (!p) return;
    if (ev.acao === 'abrirSessao') this.iniciar(this.abrirSessao(p));
    else if (ev.acao === 'fecharSessao') { this.turnos.delete(p.zona); this.iniciar(this.fecharSessao(p)); }
    else if (ev.acao === 'delegar') this.iniciar(this.delegar(p));
    else if (ev.acao === 'pedir') { if (!p.visivel && p.tipoAgente === 'sessao') this.iniciar(this.abrirSessao(p)); else this.iniciar(this.pedidoDoDono(p)); }
  }

  /* ---------- o diretor de eventos (o mesmo ritmo da prancha, só onde há trabalho) ---------- */
  private dirigir(dt: number): void {
    const t = this.t;
    t.espera -= dt; t.dono -= dt; t.fixo -= dt; t.visita -= dt; t.treinoDono -= dt; t.vida -= dt;
    if (this.soAmbiente) {
      if (t.treinoDono <= 0) { t.treinoDono = this.entre(60, 90); this.iniciar(this.donoTreina()); }
      if (t.fixo <= 0) { t.fixo = this.entre(16, 26); this.iniciar(this.fixoRotina()); }
      return;
    }
    if (t.vida <= 0) { t.vida = 1; this.cicloVida(); }
    if (t.dono <= 0) { t.dono = this.entre(14, 22); this.iniciar(this.pedidoDoDono()); }
    if (t.treinoDono <= 0) { t.treinoDono = this.entre(60, 90); this.iniciar(this.donoTreina()); }
    if (t.fixo <= 0) { t.fixo = this.entre(16, 26); this.iniciar(this.fixoRotina()); }
    if (t.visita <= 0) { t.visita = this.entre(55, 80); this.iniciar(this.visita()); }
    if (this.m.obra.fase === 'vazio' && this.agora > 38 && this.m.cena.pontos.terreno) this.iniciar(this.construir());
    if (t.espera > 0) return;
    t.espera = this.entre(1.2, 2.4);
    const livres = this.agentes.filter((a) => !a.ocupado && a.emCasa && this.temTrabalho(a));
    if (!livres.length) return;
    const r = this.r();
    if (r < 0.1) { this.iniciar(this.delegar()); return; }
    const a = this.escolha(livres);
    if (r < 0.17) { this.iniciar(this.esperarVoce(a)); return; }
    if (r < 0.22) { this.iniciar(this.falhar(a)); return; }
    if (r < 0.3) { this.iniciar(this.entregar(a)); return; }
    // pausas curtas só entre tarefas: quem acabou de chegar ao posto trabalha antes
    const podePausa = this.agora - a.chegouEm > 45;
    if (r < 0.42) { const op = podePausa ? this.vagaLivre(this.m.cena.pontos.treinos) : null; if (op) this.iniciar(this.irE(a, op, 'treinando', this.entre(9, 14))); return; }
    if (r < 0.5) { const op = podePausa ? this.vagaLivre(this.m.cena.pontos.pausas) : null; if (op) this.iniciar(this.irE(a, op, 'pausa', this.entre(7, 11))); return; }
    if (r < 0.55) { this.iniciar(this.subagente(a)); return; }
    if (r < 0.58) { this.iniciar(this.talvez(a)); return; }
    if (r < 0.595) { this.iniciar(this.semSinal(a)); return; }
    if (r < 0.605) { this.iniciar(this.limite(a)); return; }
    if (this.m.noite && r < 0.66) { if (a.tipoAgente !== 'bot') this.iniciar(this.dormir(a)); return; }
    const tarefas = a.def.tarefas ?? [['pensando', 'Pensando']];
    const [e, txt] = this.escolha(tarefas);
    a.definir(e, txt);
    this.m.anunciar(a, minusc(txt));
    this.m.emitirPulso(a.zonaTrabalho, CORES_ESTADO[e], 1);
  }

  /** Uma vez por segundo: turnos que acabam, ócio dos agentes e trabalho novo. */
  private cicloVida(): void {
    const agora = this.agora;
    for (const p of this.m.pessoas) {
      if (p.def.tipo !== 'agente' || !p.visivel || p.ocupado || p.def.papel === 'visitante') continue;
      const ocioso = agora - p.ultimaTarefa;
      if (p.tipoAgente === 'sessao') {
        // turno acabado: a sessão se despede e volta pelo teletransporte
        if (p.emCasa && !this.temTrabalho(p)) { this.iniciar(this.fecharSessao(p)); continue; }
        if (p.emCasa && DESCANSO.has(p.estado) && p.estado !== 'pausa' && p.estado !== 'dormindo' && ocioso >= this.pausaS) p.definir('pausa', 'Em pausa', false);
      } else if (p.tipoAgente === 'bot') {
        // sem tarefa depois da pausa: cápsula de recarga; depois do sono, em espera
        if (!p.naRecarga && p.emCasa && !this.temTrabalho(p) && ocioso >= this.pausaS) this.iniciar(this.irRecarregar(p));
        else if (p.naRecarga && p.estado !== 'dormindo' && ocioso >= this.dormeS) { p.estado = 'dormindo'; p.tarefa = 'Em espera na cápsula'; }
      }
    }
    this.t.turno -= 1;
    if (this.t.turno <= 0) { this.t.turno = this.rapido ? this.entre(25, 40) : this.entre(150, 300); this.novoTurno(false); }
  }

  /** Trabalho novo numa ala sem turno: abre a sessão dela ou acorda um bot com um pedido. */
  private novoTurno(forcar: boolean): void {
    const opcoes = this.m.zonas.filter((z) => z.tipo === 'ala' && !this.turnoAtivo(z.id)).map((z) => ({
      z,
      sessao: this.m.pessoas.find((p) => p.zona === z.id && p.tipoAgente === 'sessao' && p.def.papel !== 'visitante' && !p.visivel && !p.ocupado),
      bots: this.m.pessoas.filter((p) => p.zona === z.id && p.tipoAgente === 'bot' && p.visivel && !p.ocupado),
    })).filter((o) => o.sessao || o.bots.length);
    // de preferência uma ala em espera (é o que mais se vê acordar)
    const emEspera = opcoes.filter((o) => this.m.emEspera(o.z.id));
    const lista = emEspera.length && (forcar || this.r() < 0.8) ? emEspera : opcoes;
    if (!lista.length) return;
    const o = this.escolha(lista);
    if (o.sessao) { this.iniciar(this.abrirSessao(o.sessao)); return; }
    this.turnos.set(o.z.id, this.agora + this.duracaoTurno());
    this.iniciar(this.pedidoDoDono(this.escolha(o.bots)));
  }

  private vagaLivre(spots: Spot[]): Spot | null {
    const livres = spots.filter((s) => !this.m.vagas.has(s.t.join(',')));
    return livres.length ? this.escolha(livres) : null;
  }

  /* ---------- roteiros ---------- */
  private *andar(p: Pessoa, alvo: [number, number]): Roteiro { p.irPara(alvo); yield () => !p.andando; }
  private *voltarParaCasa(p: Pessoa): Roteiro {
    yield* this.andar(p, p.casa);
    p.pose = p.poseCasa; p.z = 0; p.costas = false; p.espelho = false; p.emCasa = true;
  }
  private *drone(...args: Parameters<Mundo['lancarDrone']>): Roteiro { const d = this.m.lancarDrone(...args); yield () => d.feito; }

  private *irE(a: Pessoa, op: Spot, estado: Estado, dur: number): Roteiro {
    const chave = op.t.join(',');
    if (this.m.vagas.has(chave)) return;
    this.m.vagas.add(chave); a.ocupado = true;
    a.definir(estado, op.txt);
    if (!this.soAmbiente) this.m.anunciar(a, minusc(op.txt));
    yield* this.andar(a, op.t);
    a.pose = op.pose; a.z = op.z ?? 0; a.costas = !!op.costas; a.espelho = false;
    yield this.esperar(dur);
    a.z = 0; this.m.vagas.delete(chave);
    if (a.def.papel !== 'dono') a.definir('ocioso', undefined, false);
    yield* this.voltarParaCasa(a);
    a.ocupado = false;
  }

  /** Sessão nova: o androide chega pelo teletransporte, a ala acorda e o aquário vai junto. */
  private *abrirSessao(a: Pessoa): Roteiro {
    if (a.visivel || a.ocupado) return;
    const [ti, tj] = this.m.cena.pontos.teletransporte;
    const z = this.m.zonaPorId.get(a.zona);
    a.ocupado = true; a.visivel = true; a.alpha = 1; a.emCasa = false; a.naRecarga = false;
    a.pi = ti + 0.5; a.pj = tj + 0.5; a.z = 0; a.pose = 'parado'; a.caminho = [];
    this.turnos.set(a.zona, this.agora + this.duracaoTurno());
    this.m.global.teleAte = this.agora + 1.2;
    this.feixe(ti, tj);
    a.definir('chegando', `Sessão nova em ${z?.titulo ?? a.zona}`);
    this.m.anunciar(a, `abriu uma sessão em ${z?.titulo ?? a.zona}`);
    // o aquário segue o androide do teletransporte até a mesa (a ala acorda quando ele cruza a
    // porta); a duração sai do caminho, com um teto de segurança, e a câmera fica 2,5 s na mesa
    const foco = { x: 0, y: 0, ate: this.agora + 90, pessoa: a };
    this.m.focoForcado = foco;
    const rec = this.m.pessoas.find((p) => p.def.papel === 'recepcionista');
    if (rec) { rec.pose = 'acenar'; rec.falar('Bem-vindo!', 1, '', 2); }
    yield this.esperar(0.9);
    if (rec) rec.pose = 'parado';
    a.vel = VEL_CHEGADA;
    yield* this.voltarParaCasa(a);
    a.vel = VEL_PADRAO; a.chegouEm = this.agora;
    if (this.m.focoForcado === foco) foco.ate = this.agora + 2.5;
    const padrao: [Estado, string][] = [['pensando', 'Lendo o projeto']];
    const [e, txt] = this.escolha(a.def.tarefas ?? padrao);
    a.definir(e, txt);
    this.m.emitirPulso(a.zona, CORES_ESTADO[e], 2);
    a.ocupado = false;
  }

  /** Sessão encerrada: o androide volta pelo teletransporte. */
  private *fecharSessao(a: Pessoa): Roteiro {
    if (!a.visivel || a.ocupado) return;
    a.ocupado = true;
    // a despedida não é trabalho: não acorda a sala (ela dorme no tempo dela)
    a.definir('ocioso', 'Sessão encerrada');
    this.m.anunciar(a, 'encerrou a sessão');
    yield this.esperar(2);
    a.emCasa = false;
    const [ti, tj] = this.m.cena.pontos.teletransporte;
    yield* this.andar(a, [ti, tj]);
    this.m.global.teleAte = this.agora + 1.2;
    this.feixe(ti, tj);
    yield this.esperar(0.4);
    a.visivel = false; a.ocupado = false;
    a.pi = a.casa[0] + 0.5; a.pj = a.casa[1] + 0.5;
  }

  /** Bot sem trabalho vai para a cápsula de recarga da própria ala. */
  private *irRecarregar(a: Pessoa): Roteiro {
    const rc = a.def.recarga;
    if (!rc || a.naRecarga) return;
    a.ocupado = true; a.emCasa = false;
    a.definir('pausa', 'Indo para a cápsula', false);
    yield* this.andar(a, rc);
    a.naRecarga = true; a.pose = 'parado'; a.costas = false; a.espelho = false; a.z = 0;
    a.definir('pausa', 'Recarregando na cápsula', false);
    a.ocupado = false;
  }

  /** Bot recebe trabalho na cápsula: sai e volta para o posto. */
  private *acordarBot(a: Pessoa, motivo: string): Roteiro {
    if (!a.naRecarga) return;
    a.naRecarga = false;
    a.definir('chegando', motivo);
    yield this.esperar(0.7);
    yield* this.voltarParaCasa(a);
    a.chegouEm = this.agora;
  }

  private *delegar(alvoForcado?: Pessoa): Roteiro {
    const livre = (p: Pessoa) => p.def.papel === 'coordenador' && p.visivel && !p.ocupado && p.emCasa && (!alvoForcado || p.def.equipe === alvoForcado.def.equipe);
    // pela agenda, espera o coordenador ficar livre (até 20 s)
    if (alvoForcado) { const limite = this.agora + 40; yield () => this.agora > limite || this.m.pessoas.some(livre); }
    const coord = this.m.pessoas.find(livre);
    // coordenador ocupado demais: o pedido vem do dono
    if (!coord) { if (alvoForcado) yield* this.pedidoDoDono(alvoForcado); return; }
    let alvo: Pessoa;
    if (alvoForcado) { if (alvoForcado.ocupado || alvoForcado === coord) return; alvo = alvoForcado; }
    else {
      const equipe = this.agentes.filter((p) => p !== coord && p.def.equipe === coord.def.equipe && !p.ocupado && (p.emCasa || (p.naRecarga && this.turnoAtivo(p.zona))));
      if (!equipe.length) return;
      alvo = this.escolha(equipe);
    }
    const txt = this.escolha(this.m.cena.textos.delegacoes);
    coord.ocupado = true; alvo.ocupado = true;
    if (!this.turnoAtivo(coord.zona)) this.turnos.set(coord.zona, this.agora + this.duracaoTurno());
    coord.definir('delegando', `Delegou ao ${alvo.curto}: ${txt}`);
    this.m.anunciar(coord, `delegou ao ${alvo.curto}: ${txt}`);
    yield* this.drone(() => this.m.topo(coord), () => this.m.topo(alvo), { cor: corDe(coord), carga: 'envelope', dur: 1.6, alt: 26 });
    if (alvo.naRecarga) yield* this.acordarBot(alvo, `Acordou com um pedido do ${coord.curto}`);
    alvo.definir('lendo', `Recebeu do ${coord.curto}: ${txt}`);
    this.m.anunciar(alvo, `recebeu: ${txt}`);
    this.m.emitirPulso(coord.zona, '#ffb347');
    coord.definir('pensando', 'Acompanhando as delegações', false);
    coord.ocupado = false; alvo.ocupado = false;
  }

  private *esperarVoce(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('esperando', this.m.cena.textos.esperando);
    this.m.anunciar(a, 'espera você: aprovar para seguir');
    yield this.esperar(this.entre(6, 9));
    const dono = this.dono;
    if (dono && dono.emCasa && !dono.ocupado) {
      dono.falar((dono.def.falas?.aprovar ?? 'Aprovado, {curto}!').replace('{curto}', a.curto), 3, 'dono', 3);
      yield* this.drone(() => this.m.topo(dono), () => this.m.topo(a), { cor: '#7dffa8', carga: 'check', dur: 2.4 });
    } else yield this.esperar(3);
    a.definir('pensando', 'Seguindo depois da aprovação');
    this.m.emitirPulso(a.zona, '#7dffa8');
    a.ocupado = false;
  }

  private *falhar(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('erro', this.m.cena.textos.erro);
    this.m.anunciar(a, this.m.cena.textos.erroTicker);
    this.m.global.erroAte = this.agora + 2;
    const fx = this.m.rngFx;
    for (let k = 0; k < 10; k++) { const [x, y] = this.m.topo(a); this.m.particulaDe(a, x - 3 + fx() * 6, y + 4, { cor: ['#5a5f70', '#7a7f90', '#ff6b5a'][Math.floor(fx() * 3)], vy: -14 + fx() * 8, vida: 0.8 + fx() * 0.6 }); }
    this.m.emitirPulso(a.zona, '#ff6b5a', 1);
    yield this.esperar(3.5);
    a.definir('pensando', 'Investigando a falha', false);
    a.ocupado = false;
  }

  private *entregar(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('entregou', this.m.cena.textos.entrega);
    this.m.anunciar(a, minusc(this.m.cena.textos.entrega));
    const fx = this.m.rngFx;
    for (let k = 0; k < 14; k++) { const [x, y] = this.m.topo(a); this.m.particulaDe(a, x, y, { cor: ['#7dffa8', '#ffcf4d', '#ff4fd8', '#3ee0ff'][Math.floor(fx() * 4)], vx: -20 + fx() * 40, vy: -30 + fx() * 20, g: 40, vida: 0.7 + fx() * 0.5 }); }
    const [ni, nj] = this.m.cena.pontos.nucleo;
    const alvo = this.m.geo.iso(ni, nj, 50);
    yield* this.drone(() => this.m.topo(a), () => alvo, { cor: '#7dffa8', carga: 'cubo', dur: 2.6, alt: 30 });
    this.m.global.entregas += 1;
    this.m.emitirPulso(a.zona, '#7dffa8', 3);
    a.definir('pensando', 'Próxima etapa', false);
    a.ocupado = false;
  }

  private *subagente(a: Pessoa): Roteiro {
    a.ocupado = true;
    const [x, y] = this.m.topo(a);
    const ap = a.ap;
    this.m.minis.push({ x: x + 14, y: y - 4, cor: ap?.tipo === 'androide' ? ap.papel : '#e0704f', ate: this.agora + 7, pai: a });
    a.definir('delegando', this.m.cena.textos.subagente);
    this.m.anunciar(a, minusc(this.m.cena.textos.subagente));
    yield this.esperar(7);
    a.definir('lendo', 'Lendo o resultado do subagente', false);
    a.ocupado = false;
  }

  /** Ferramenta sem resultado por mais de 7 s sem hook: "talvez esperando" (âmbar tracejado). */
  private *talvez(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('comando', 'Rodando um comando longo');
    yield this.esperar(3);
    a.definir('talvez', 'Talvez esperando você');
    this.m.anunciar(a, 'talvez esteja esperando você');
    yield this.esperar(this.entre(5, 7));
    a.definir('comando', 'O comando voltou', false);
    a.ocupado = false;
  }

  /** Sessão sem sinal: congela e fica translúcida. */
  private *semSinal(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('semSinal', 'Sem sinal da sessão');
    this.m.anunciar(a, 'ficou sem sinal');
    a.alpha = 0.45;
    yield this.esperar(this.entre(5, 8));
    a.alpha = 1;
    a.definir('pensando', 'Sinal de volta', false);
    a.ocupado = false;
  }

  /** Limite de uso de um motor: apagão nas alas dos agentes daquele motor. */
  private *limite(a: Pessoa): Roteiro {
    const motor = a.def.motor ?? 'claude';
    const afetados = this.agentes.filter((p) => (p.def.motor ?? 'claude') === motor && !p.ocupado && p.emCasa);
    if (!afetados.length) return;
    const ate = this.agora + 8;
    for (const p of afetados) { p.ocupado = true; p.definir('limite', `Limite de uso do ${motor === 'codex' ? 'Codex' : 'Claude'}`, p === a); this.m.global.apagao.set(p.zona, ate); }
    this.m.anunciar(a, `bateu o limite de uso do ${motor === 'codex' ? 'Codex' : 'Claude'}`);
    yield this.esperar(8);
    for (const p of afetados) { p.definir('pensando', 'Limite liberado', false); p.ocupado = false; }
  }

  /** À noite, sessão ociosa cochila no posto (bot dorme na cápsula, não na mesa). */
  private *dormir(a: Pessoa): Roteiro {
    a.ocupado = true;
    a.definir('dormindo', 'Dormindo até o próximo pedido');
    const pose = a.pose;
    a.pose = 'dormir';
    const fim = this.agora + this.entre(15, 25);
    while (this.agora < fim) {
      const [x, y] = this.m.topo(a, 34);
      this.m.particulaDe(a, x + 6, y, { tipo: 'z', cor: '#b9b0dc', vx: 4, vy: -8, vida: 1.6 });
      yield this.esperar(1.4);
    }
    a.pose = pose;
    a.definir('ocioso', undefined, false);
    a.ocupado = false;
  }

  /** Pedido do dono a um agente acordado ou a um bot na cápsula (que acorda com o drone). */
  private *pedidoDoDono(alvoForcado?: Pessoa): Roteiro {
    const dono = this.dono;
    if (!dono || dono.ocupado || !dono.emCasa) return;
    let alvo: Pessoa;
    if (alvoForcado) { if (alvoForcado.ocupado || !alvoForcado.visivel) return; alvo = alvoForcado; }
    else {
      const livres = this.agentes.filter((a) => !a.ocupado && a.emCasa && this.temTrabalho(a));
      if (!livres.length) return;
      alvo = this.escolha(livres);
    }
    const pedido = this.escolha(this.m.cena.textos.pedidos);
    dono.ocupado = true; alvo.ocupado = true;
    if (!this.turnoAtivo(alvo.zona)) this.turnos.set(alvo.zona, this.agora + this.duracaoTurno());
    dono.definir('delegando', `Pedido para ${alvo.curto}: ${pedido}`, false);
    dono.falar(`${alvo.curto}, ${pedido}`, 3, 'dono', 4);
    this.m.anunciar(dono, `pediu ao ${alvo.curto}: ${pedido}`);
    yield* this.drone(() => this.m.topo(dono), () => this.m.topo(alvo), { cor: '#f2b45a', carga: 'envelope', dur: 3.2, alt: 46 });
    if (alvo.naRecarga) yield* this.acordarBot(alvo, `Acordou com um pedido de ${dono.curto}`);
    alvo.definir('pensando', `Pedido de ${dono.curto}: ${pedido}`);
    this.m.emitirPulso(alvo.zona, '#f2b45a');
    dono.estado = 'ocioso';
    dono.ocupado = false; alvo.ocupado = false;
  }

  private *donoTreina(): Roteiro {
    const dono = this.dono, fixo = this.fixo;
    if (!dono || dono.ocupado) return;
    const op = this.vagaLivre(this.m.cena.pontos.treinos);
    if (!op) return;
    fixo?.falar(fixo.def.falas?.bomTreino ?? 'Bom treino!', 2, 'fixo', 3);
    yield* this.irE(dono, op, 'treinando', this.entre(10, 14));
    dono.estado = 'ocioso';
    if (fixo) {
      fixo.falar((fixo.def.falas?.volta ?? 'Oi, {dono}!').replace('{dono}', dono.curto), 2, 'fixo', 3);
      const fx = this.m.rngFx;
      for (let k = 0; k < 6; k++) { const [x, y] = this.m.topo(fixo); this.m.particulaDe(fixo, x - 4 + fx() * 8, y - 2, { cor: '#ff5f8f', vy: -16 + fx() * 8, vx: -3 + fx() * 6, vida: 1.2, tipo: 'coracao' }); }
    }
  }

  private *fixoRotina(): Roteiro {
    const fixo = this.fixo;
    if (!fixo || fixo.ocupado) return;
    const f = fixo.def.falas ?? {};
    if (this.r() < 0.55) {
      fixo.pose = 'beber'; fixo.falar(f.cafe ?? 'Pausa pro café', 1, 'fixo', 3);
      yield this.esperar(3.5);
      fixo.pose = 'digitando';
    } else fixo.falar(this.escolha(f.status ?? ['Focada', 'Quase terminando', 'Organizando o dia']), 1, 'fixo', 3);
  }

  private *visita(): Roteiro {
    const v = this.m.pessoas.find((p) => p.def.papel === 'visitante' && !p.visivel && !p.ocupado);
    if (!v) return;
    const [ti, tj] = this.m.cena.pontos.teletransporte;
    v.ocupado = true;
    v.pi = ti + 0.5; v.pj = tj + 0.5; v.visivel = true;
    v.definir('chegando', this.m.cena.textos.visitante.chegada);
    this.m.global.teleAte = this.agora + 1.2;
    this.feixe(ti, tj);
    this.m.anunciar(v, 'chegou pelo teletransporte');
    const rec = this.m.pessoas.find((p) => p.def.papel === 'recepcionista');
    if (rec) { rec.pose = 'acenar'; rec.falar('Bem-vindo!', 1, '', 2); }
    yield this.esperar(1.1);
    if (rec) rec.pose = 'parado';
    // às vezes a sala ainda não existe: espera na fila da recepção
    const fila = this.m.cena.pontos.fila;
    if (fila.length && this.r() < 0.5) {
      v.definir('fila', 'Na fila da recepção');
      yield* this.andar(v, fila[0]);
      v.costas = true;
      yield this.esperar(this.entre(3, 5));
    }
    const mesa = this.mesaLivre();
    if (!mesa) { v.emCasa = false; yield* this.andar(v, [ti, tj]); this.feixe(ti, tj); v.visivel = false; v.ocupado = false; return; }
    yield* this.andar(v, mesa.casa);
    v.pose = 'digitando'; v.costas = false; v.espelho = false; v.emCasa = true;
    mesa.obj.dono = v.id;
    const tarefas = this.m.cena.textos.visitante.tarefas;
    for (let n = 0; n < 4; n++) {
      const [e, txt] = this.escolha(tarefas);
      v.definir(e, txt);
      this.m.emitirPulso(mesa.obj.zona ?? v.zona, CORES_ESTADO[e], 1);
      yield this.esperar(this.entre(6, 9));
    }
    v.definir('entregou', 'Sessão encerrada');
    this.m.anunciar(v, 'encerrou a sessão');
    yield this.esperar(2);
    mesa.obj.dono = null;
    v.estado = 'ocioso'; v.emCasa = false;
    yield* this.andar(v, [ti, tj]);
    this.m.global.teleAte = this.agora + 1.2;
    this.feixe(ti, tj);
    yield this.esperar(0.4);
    v.visivel = false; v.ocupado = false;
  }

  /** Mesa sem dono numa ala acordada e com trabalho (o visitante senta ali). */
  private mesaLivre(): { obj: Mundo['objetos'][number]; casa: [number, number] } | null {
    const ocupadas = new Set(this.m.pessoas.filter((p) => p.visivel).map((p) => `${p.casa[0]},${p.casa[1]}`));
    const cands = this.m.objetos.filter((o) => o.tipo === 'mesa' && !o.dono && o.zona && this.m.zonaPorId.get(o.zona)?.tipo === 'ala' && !this.m.emEspera(o.zona) && this.turnoAtivo(o.zona) && !ocupadas.has(`${o.i},${o.j - 1}`) && !this.m.bloqueado[(o.j - 1) * this.m.geo.ni + o.i]);
    if (!cands.length) return null;
    const obj = cands[Math.floor(this.r() * cands.length)];
    return { obj, casa: [obj.i, obj.j - 1] };
  }

  private feixe(ti: number, tj: number): void {
    const fx = this.m.rngFx;
    const [x, y] = this.m.geo.iso(ti, tj);
    for (let k = 0; k < 20; k++) this.m.particulaNoChao(ti, tj, x - 10 + fx() * 20, y, { cor: '#9ff3ff', vy: -40 + fx() * 20, vx: 0, vida: 0.5 + fx() * 0.5 });
  }

  private *construir(): Roteiro {
    const m = this.m, tr = m.cena.pontos.terreno;
    if (!tr || m.obra.fase !== 'vazio') return;
    m.obra.fase = 'obra'; m.obra.inicio = this.agora;
    const obraRT = { chave: 'obra-simulada', i: tr.i, j: tr.j, zona: tr.zona, inicio: this.agora, dur: 7.5 };
    m.obras.push(obraRT);
    // a obra é trabalho na ala: ela acorda
    m.atividade(tr.zona);
    this.turnos.set(tr.zona, this.agora + this.duracaoTurno());
    const tx = m.cena.textos.obra;
    m.anunciar({ nome: tx.nome, cor: '#ffcf4d' }, `sala nova em obra: ${tx.salaNome.toLowerCase()}`);
    const [cx, cy] = m.geo.iso(tr.i + 1.5, tr.j + 1.5);
    m.focoForcado = { x: cx, y: cy - 20, ate: this.agora + 9 };
    const fx = m.rngFx;
    const fim = this.agora + 7.5;
    while (this.agora < fim) {
      const prog = Math.min(1, (this.agora - m.obra.inicio) / 7.5);
      if (fx() < 0.5) { const p = m.geo.iso(tr.i + fx() * 2, tr.j + fx() * 2, 40 * prog); m.particulaNoChao(tr.i + 1, tr.j + 2, p[0], p[1], { cor: ['#ffcf4d', '#ffffff', '#ff9a3c'][Math.floor(fx() * 3)], vx: -20 + fx() * 40, vy: -20 + fx() * 20, g: 60, vida: 0.5 }); }
      yield this.esperar(1 / 30);
    }
    const sala = `${tr.zona}-${tx.salaNome.toLowerCase()}`;
    m.adicionarSala({ id: sala, nome: tx.salaNome, zona: tr.zona, i: tr.i, j: tr.j, w: 2, d: 2, estilo: 'pod', dormindo: false, ultimaAtividade: m.agoraEpoch() });
    const pod = m.adicionarObjeto('pod', tr.i, tr.j, { nome: tx.salaNome, sala });
    m.adicionarObjeto('planta', tr.i + 2, tr.j + 2, {});
    m.montarLuzes();
    m.obra.fase = 'pronta';
    m.obras = m.obras.filter((o) => o !== obraRT);
    for (let k = 0; k < 30; k++) { const [x, y] = m.geo.iso(tr.i + 1, tr.j + 1, 20); m.particulaNoChao(tr.i + 1, tr.j + 2, x - 20 + fx() * 40, y - 10 + fx() * 20, { cor: ['#ffcf4d', '#c9a7ff', '#ffffff'][Math.floor(fx() * 3)], vx: -30 + fx() * 60, vy: -40 + fx() * 30, g: 50, vida: 0.8 + fx() * 0.6 }); }
    const ag = tx.agente;
    // o posto fica dentro da cápsula nova, atrás da bancada (como na prancha)
    const def: Personagem = {
      id: 'agenteSalaNova', nome: ag.nome, curto: ag.curto, cargo: ag.cargo, tipo: 'agente', papel: 'agente', aparencia: ag.aparencia,
      zona: tr.zona, casa: [tr.i + 1, tr.j], poseCasa: 'digitando', motor: 'claude', tarefas: ag.tarefas, tipoAgente: 'sessao',
    };
    const [ti, tj] = m.cena.pontos.teletransporte;
    const novo = m.adicionarPessoa(def, 0);
    pod.dono = novo.id;
    novo.pi = ti + 0.5; novo.pj = tj + 0.5; novo.emCasa = false; novo.ocupado = true;
    m.global.teleAte = this.agora + 1.2;
    this.feixe(ti, tj);
    m.anunciar(novo, 'chegou para a sala nova');
    yield this.esperar(1);
    novo.definir('chegando', 'Indo para a sala nova', false);
    yield* this.andar(novo, def.casa);
    novo.pose = 'digitando'; novo.costas = false; novo.espelho = false; novo.emCasa = true; novo.ocupado = false;
    novo.definir('editando', ag.tarefas[0]?.[1] ?? 'Trabalhando');
  }

  /** Figurantes do andar cheio: passeiam pela própria zona com um gerador de números à parte. */
  private *figurante(p: Pessoa): Roteiro {
    const r = this.m.rngExtra;
    const z = this.m.zonaPorId.get(p.zona);
    const ap = p.ap;
    const livre = (i: number, j: number) => !this.m.bloqueado[j * this.m.geo.ni + i];
    const sortear = (): [number, number] => {
      for (let k = 0; k < 20; k++) {
        const i = z ? z.i0 + Math.floor(r() * (z.i1 - z.i0 + 1)) : Math.floor(r() * this.m.geo.ni);
        const j = z ? z.j0 + Math.floor(r() * (z.j1 - z.j0 + 1)) : Math.floor(r() * this.m.geo.nj);
        if (livre(i, j)) return [i, j];
      }
      return p.casa;
    };
    if (ap?.tipo === 'robo') {
      // robô de limpeza: anda devagar pelos corredores perto da zona
      p.vel = 1.2;
      for (;;) {
        const [i0, j0] = sortear();
        const alvo: [number, number] = [Math.max(0, Math.min(this.m.geo.ni - 1, i0 + Math.floor(r() * 6) - 3)), Math.max(0, Math.min(this.m.geo.nj - 1, j0 + 3))];
        if (!livre(alvo[0], alvo[1])) { yield this.esperar(1); continue; }
        yield* this.andar(p, alvo);
        p.pose = 'parado';
        yield this.esperar(2 + r() * 3);
      }
    }
    if (ap?.tipo === 'gato') {
      p.vel = 1.4;
      for (;;) {
        p.pose = 'dormir'; p.definir('dormindo', 'Cochilando no tapete', false);
        yield this.esperar(12 + r() * 14);
        p.definir('ocioso', 'Passeando', false);
        yield* this.andar(p, sortear());
        p.pose = 'parado';
        yield this.esperar(3 + r() * 4);
        yield* this.andar(p, p.casa);
      }
    }
    // androides de cenário: ficam no posto e às vezes dão uma volta curta (com a ala em espera,
    // ficam parados no posto)
    p.pose = p.id.startsWith('barista') ? 'operando' : 'parado';
    for (;;) {
      yield this.esperar(8 + r() * 10);
      if (this.m.emEspera(p.zona)) continue;
      if (p.id.startsWith('treinador')) { p.pose = 'acenar'; p.falar('Mais uma série!', 1, '', 2.5); yield this.esperar(2.5); }
      yield* this.andar(p, sortear());
      p.pose = 'parado';
      yield this.esperar(2 + r() * 3);
      yield* this.andar(p, p.casa);
      p.pose = p.id.startsWith('barista') ? 'operando' : 'parado';
      p.costas = false; p.espelho = false;
    }
  }
}

function minusc(t: string): string { return t.charAt(0).toLowerCase() + t.slice(1); }
function corDe(p: Pessoa): string { const ap = p.ap; return ap?.tipo === 'androide' ? ap.papel : '#ffb347'; }

/**
 * Estado inicial igual ao da prancha (cada agente com a primeira tarefa, falas de boas-vindas),
 * agora com as alas em espera: nelas, os bots começam na cápsula de recarga e as sessões fora
 * do andar. Quem tem `dormindo` nos dados também começa parado.
 */
export function estadoInicial(m: Mundo): void {
  for (const a of m.pessoas) {
    if (a.def.tipo !== 'agente' || a.def.papel === 'visitante') continue;
    const parado = m.emEspera(a.zona) || !!a.def.dormindo;
    if (parado && a.tipoAgente === 'bot' && a.def.recarga) {
      a.pi = a.def.recarga[0] + 0.5; a.pj = a.def.recarga[1] + 0.5;
      a.naRecarga = true; a.emCasa = false; a.pose = 'parado'; a.costas = false; a.espelho = false;
      a.estado = 'dormindo'; a.tarefa = 'Em espera na cápsula';
      continue;
    }
    if (parado && a.tipoAgente === 'sessao') { a.visivel = false; continue; }
    if (a.def.tarefas?.length) { const [e, txt] = a.def.tarefas[0]; a.definir(e, txt, false); }
  }
  const dono = m.pessoas.find((p) => p.def.papel === 'dono');
  const fixo = m.pessoas.find((p) => p.def.papel === 'fixo');
  if (dono) { dono.estado = 'ocioso'; dono.falar(dono.def.falas?.saudacao ?? 'Bem-vindo ao Arcadia', 2, 'dono', 6); }
  if (fixo) { fixo.estado = 'ocioso'; fixo.falar(fixo.def.falas?.inicio ?? 'Trabalhando', 1, 'fixo', 6); }
  const ags = m.pessoas.filter((p) => p.def.tipo === 'agente' && p.def.papel !== 'visitante' && p.visivel && !p.naRecarga);
  const a1 = ags.find((p) => p.estado === 'editando'), a2 = ags.find((p) => p.def.papel === 'coordenador');
  if (a1) m.anunciar(a1, a1.tarefa.charAt(0).toLowerCase() + a1.tarefa.slice(1));
  if (a2) m.anunciar(a2, a2.tarefa.charAt(0).toLowerCase() + a2.tarefa.slice(1));
}
