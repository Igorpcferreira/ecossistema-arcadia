// Uma instância do mundo: cena gerada da planta, simulação, renderizador, vista, câmera,
// laço e interface. A página do mundo cria uma; a página /prototipos cria uma ou duas.
import type { Renderer } from 'pixi.js';
import type { PacotePersonagens, Planta } from './cena/formato.ts';
import { gerarCena } from './cena/gerador.ts';
import { aplicarPacote } from './cena/carregar.ts';
import { Mundo } from './cena/mundo.ts';
import { Simulador, estadoInicial } from './cena/simulador.ts';
import { criarRenderizador, type InfoMotor } from './motor/renderizador.ts';
import { Camera } from './motor/camera.ts';
import { Laco } from './motor/laco.ts';
import { VistaIso, type Vista } from './motor/vistaIso.ts';
import { VistaCorte } from './motor/vistaCorte.ts';
import { PRESETS, ehCelular, escalaBase, type NomePreset, type Preset } from './qualidade/presets.ts';
import { InterfaceMundo, horaSaoPaulo, type ModoHud } from './ui/interface.ts';
import type { PasseMao, Tam } from './arte/personagens.ts';
import { vestirDoDia, type ModoRoupa } from './cena/roupa.ts';
import type { NomePaleta } from './arte/cor.ts';

export interface OpcoesMundo {
  planta: Planta;
  pacote: PacotePersonagens | null;
  tam: Tam;
  maoFeita: PasseMao;
  vista: 'iso' | 'corte';
  paleta: NomePaleta;
  densidade: 'prancha' | 'cheio';
  preset?: NomePreset | null;
  motor?: 'webgl' | 'canvas' | null;
  semente: number;
  hora?: number | null;
  noite?: boolean | null;
  teto?: number | null;
  aquario?: boolean;
  foco?: string | null;
  hud: ModoHud | 'auto';
  celular?: boolean;
  /** Expõe medidas em window.__arcadia (medição e capturas). */
  expor?: boolean;
  debug?: boolean;
  zoom?: number;
  pausado?: boolean;
  /** Escala fixa (pixels físicos por pixel de arte): as comparações de /prototipos põem as duas vistas na mesma. */
  escala?: number;
  /** Roupa alternativa dos humanos com variante: sorteio do dia (padrão), sempre a variante ou sempre a base. */
  roupa?: ModoRoupa;
  /** Troca entre o isométrico e o corte lateral (botão no HUD); sem ela, o botão não aparece. */
  trocarVista?: () => void;
  /** Palco numa página que rola (/prototipos no celular): o arrasto vertical rola a página. */
  rolagem?: boolean;
  /** Tempos de ócio: os do cenário (padrão 3 e 20 min, como no servidor) ou curtos, para ver o ciclo inteiro. */
  ocio?: 'real' | 'rapido';
  /** Movimento reduzido: a câmera corta em vez de deslizar e nada pisca. Padrão: a preferência do sistema. */
  movimento?: 'auto' | 'reduzido' | 'normal';
}

export interface InstanciaMundo {
  laco: Laco;
  sim: Simulador;
  info: InfoMotor;
  preset: Preset;
  mundo: Mundo;
  vista: Vista;
  camera: Camera;
  ui: InterfaceMundo;
  tempoCargaMs: number;
  interna(): [number, number, number];
  destruir(): void;
}

export async function criarMundo(raiz: HTMLElement, op: OpcoesMundo): Promise<InstanciaMundo> {
  const t0 = performance.now();
  const celular = op.celular ?? ehCelular();
  const modoHud: ModoHud = op.hud === 'auto' ? (celular ? 'enxuto' : 'completo') : op.hud;
  const ui = new InterfaceMundo(raiz, modoHud, celular);
  if (op.rolagem) ui.permitirRolagem();
  if (op.hora !== null && op.hora !== undefined) ui.horaFixa = op.hora;
  ui.progresso(0);
  // cena e simulação
  const planta = vestirDoDia(op.pacote ? aplicarPacote(op.planta, op.pacote) : op.planta, op.semente, op.roupa ?? 'auto');
  const cena = gerarCena(planta, { densidade: op.densidade, paleta: op.paleta });
  if (op.ocio === 'rapido') cena.ocio = { pausaMinutos: 0.25, dormeMinutos: 0.75 };
  const mundo = new Mundo(cena, op.semente);
  const horaAgora = () => (op.hora ?? horaSaoPaulo().h);
  const noitePeloRelogio = () => { const h = horaAgora(); return h >= 18 || h < 6; };
  let noiteForcada: boolean | null = op.noite ?? null;
  const ehNoite = () => (noiteForcada ?? noitePeloRelogio());
  mundo.noite = ehNoite();
  // renderizador e vista
  const { r, info, desligar } = await criarRenderizador(ui.canvas, op.motor ?? null, mundo.noite ? 0x05060f : 0x9fd3ef);
  // sem placa de vídeo (WebGL por software), o renderizador Canvas vem junto com o preset baixo
  const preset = PRESETS[op.preset ?? (info.nome === 'canvas' && !op.motor ? 'baixo' : celular ? 'medio' : 'alto')];
  mundo.maxParticulas = preset.maxParticulas;
  const opVista = { tam: op.tam, maoFeita: op.maoFeita, paleta: op.paleta, preset };
  const vista: Vista = op.vista === 'corte' ? new VistaCorte(mundo, r, opVista) : new VistaIso(mundo, r, opVista);
  await vista.preparar(async (f) => { ui.progresso(f); await new Promise((res) => setTimeout(res, 0)); });
  vista.definirNoite(mundo.noite);
  // câmera e tela
  const cam = new Camera(vista.alvos, cena.roteiro, op.semente);
  let deltaZoom = op.zoom ?? 0;
  const palco = ui.palco;
  const ajustarTela = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, palco.clientWidth), h = Math.max(1, palco.clientHeight);
    let base = op.escala ? Math.max(1, Math.round(op.escala)) : escalaBase(w, h, dpr, preset);
    // o corte lateral quer o prédio inteiro na largura da tela (com escala fixa, quem chama garante)
    if (vista.larguraIdeal && !op.escala) base = Math.max(1, Math.min(base, Math.floor((w * dpr) / vista.larguraIdeal)));
    cam.escalaMin = Math.max(1, base - 2); cam.escalaMax = base + 4;
    cam.escala = Math.max(cam.escalaMin, Math.min(cam.escalaMax, base + deltaZoom));
    const iw = Math.ceil((w * dpr) / cam.escala), ih = Math.ceil((h * dpr) / cam.escala);
    if (cam.vw !== iw || cam.vh !== ih) { (r as Renderer).resize(iw, ih); cam.vw = iw; cam.vh = ih; }
    ui.canvas.style.width = `${(iw * cam.escala) / dpr}px`;
    ui.canvas.style.height = `${(ih * cam.escala) / dpr}px`;
    cam.limitar();
  };
  ajustarTela();
  const inicial = (op.foco && vista.alvos.alvoZona(op.foco)) || vista.alvos.alvoZona(cena.zonas.find((z) => z.tema === 'cockpit')?.id ?? cena.zonas[0].id);
  if (inicial) cam.irPara(inicial[0] - (op.foco ? 0 : 40), inicial[1] - (op.foco ? 0 : 4), true);
  cam.aquario = op.aquario ?? true;
  cam.travada = op.aquario === false;
  cam.aguardarPlano(7);
  // prefers-reduced-motion (ou ?movimento=): vale para a câmera e para as piscadas da vista, e muda ao vivo
  const mqReduzir = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const aplicarMovimento = () => {
    const reduzido = op.movimento === 'reduzido' || (op.movimento !== 'normal' && !!mqReduzir?.matches);
    cam.cortes = reduzido; vista.movimentoReduzido = reduzido;
  };
  aplicarMovimento();
  mqReduzir?.addEventListener?.('change', aplicarMovimento);
  // simulação
  const sim = new Simulador(mundo);
  estadoInicial(mundo);
  // laço
  const teto = op.teto ?? (celular ? 30 : 60);
  let ultimoFps = 0;
  const laco = new Laco({
    teto, passoSim: 1 / 60,
    simular: (dt) => sim.passo(dt),
    quadro: (dt) => {
      cam.dirigir(dt);
      const a = performance.now();
      vista.desenhar(cam, dt);
      laco.marcarDesenho(performance.now() - a);
      ui.atualizarBaloes();
      if (laco.medidas.quadros - ultimoFps >= 15) {
        ultimoFps = laco.medidas.quadros;
        ui.mostrarFps(laco.medidas.fps);
        if (op.debug) ui.mostrarDebug(`${info.nome} · ${preset.nome} · ${laco.medidas.ms.toFixed(1)} ms · ${vista.medidas.sprites} sprites · ${cam.vw}x${cam.vh} x${cam.escala} · atlas ${vista.medidas.atlasMb.toFixed(0)} MB ${(vista.medidas.atlasOcupacao * 100).toFixed(0)}%`);
      }
    },
  });
  // checagem de dia e noite a cada minuto
  const relogioNoite = window.setInterval(() => { const n = ehNoite(); if (n !== mundo.noite) { mundo.noite = n; vista.definirNoite(n); ui.marcar('noite', n); } }, 60000);
  ui.marcar('noite', mundo.noite);
  ui.marcar('aquario', cam.aquario);
  ui.marcar('vista', op.vista === 'corte');
  ui.ligar(mundo, vista, cam, {
    aquario: (v) => cam.ligarAquario(v),
    noite: () => { noiteForcada = !mundo.noite; mundo.noite = noiteForcada; vista.definirNoite(mundo.noite); return mundo.noite; },
    pausar: () => { laco.pausado = !laco.pausado; return laco.pausado; },
    obra: () => {
      if (mundo.obra.fase === 'vazio') sim.construirAgora();
      else { const tr = cena.pontos.terreno; if (tr) { const p = vista.alvos.alvoZona(tr.zona); if (p) { cam.explorar(); cam.irPara(p[0], p[1]); } } }
    },
    trabalho: () => { sim.chegarTrabalho(); if (!cam.aquario) { cam.ligarAquario(true); ui.marcar('aquario', true); } },
    vista: op.trocarVista,
    zoom: (delta, px, py) => {
      const antes = cam.escala;
      const dpr = window.devicePixelRatio || 1;
      const rect = palco.getBoundingClientRect();
      const cx = px ?? rect.width / 2, cy = py ?? rect.height / 2;
      const wx = cam.x + ((cx - rect.width / 2) * dpr) / antes, wy = cam.y + ((cy - rect.height / 2) * dpr) / antes;
      deltaZoom += delta;
      ajustarTela();
      if (cam.escala === antes) { deltaZoom -= delta; return; }
      cam.x = wx - ((cx - rect.width / 2) * dpr) / cam.escala; cam.y = wy - ((cy - rect.height / 2) * dpr) / cam.escala;
      cam.ax = cam.x; cam.ay = cam.y; cam.limitar(); cam.explorar();
    },
    arrastar: (dx, dy) => { const dpr = window.devicePixelRatio || 1; cam.x -= (dx * dpr) / cam.escala; cam.y -= (dy * dpr) / cam.escala; cam.ax = cam.x; cam.ay = cam.y; cam.limitar(); cam.explorar(); },
  }, op.tam, op.maoFeita);
  const ro = new ResizeObserver(() => { ajustarTela(); ui.redimensionou(); });
  ro.observe(palco);
  ui.pronto();
  laco.pausado = !!op.pausado;
  laco.iniciar();
  const tempoCargaMs = performance.now() - t0;
  const inst: InstanciaMundo = {
    laco, sim, info, preset, mundo, vista, camera: cam, ui, tempoCargaMs,
    interna: () => [cam.vw, cam.vh, cam.escala],
    destruir: () => {
      laco.destruir(); ro.disconnect(); clearInterval(relogioNoite);
      mqReduzir?.removeEventListener?.('change', aplicarMovimento);
      // sem o ouvinte de perda de contexto: o destroy do PixiJS perde o contexto de propósito
      desligar();
      vista.destruir(); (r as Renderer).destroy(); ui.destruir();
    },
  };
  if (op.expor) (window as unknown as { __arcadia: unknown }).__arcadia = { inst, laco, medidas: laco.medidas, registro: laco.registro, info, preset: preset.nome, tempoCargaMs, interna: inst.interna, vista: vista.medidas };
  return inst;
}
