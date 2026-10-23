// Página /prototipos: as cinco perguntas de gosto do portão G1, cada uma com duas respostas,
// todas no motor da Fase 1 e com o mesmo cenário simulado (mesma semente). Dá para combinar
// as respostas, comparar uma pergunta lado a lado e trocar o preset. Os links da URL
// (?escala=24&arte=mao&vista=corte&paleta=quente&densidade=cheio&comparar=escala) abrem
// direto numa combinação.
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import '@fontsource/vt323/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '../estilos/base.css';
import '../estilos/prototipos.css';
import { criarMundo, type InstanciaMundo, type OpcoesMundo } from '../app.ts';
import { carregarCena, aplicarPacote, type CargaLocal } from '../cena/carregar.ts';
import { lerOpcoes } from '../opcoes.ts';
import { ehCelular, type NomePreset } from '../qualidade/presets.ts';
import type { PasseMao } from '../arte/personagens.ts';
import { comVariante } from '../cena/roupa.ts';
import { montarElenco, type FichaElenco } from './elenco.ts';

type Chave = 'escala' | 'arte' | 'celular' | 'paleta' | 'densidade';
interface Escolhas { escala: '16' | '24'; arte: 'procedural' | 'humanos' | 'mao'; celular: 'iso' | 'corte'; paleta: 'fria' | 'quente'; densidade: 'prancha' | 'cheio' }

interface Opcao { valor: string; nome: string; frase: string }
/** A e B (a comparação lado a lado usa as duas primeiras); `g1` é a resposta escolhida no portão G1, hoje o padrão do mundo. */
interface Pergunta { chave: Chave; titulo: string; opcoes: Opcao[]; g1: string }

const PASSE: Record<Escolhas['arte'], PasseMao> = { procedural: 'nenhum', humanos: 'humanos', mao: 'todos' };

const PERGUNTAS: Pergunta[] = [
  { chave: 'escala', titulo: 'Escala dos personagens', g1: '24', opcoes: [
    { valor: '16', nome: '16 por 32', frase: 'Como na prancha: cabe mais gente na tela e o andar parece maior.' },
    { valor: '24', nome: '24 por 40', frase: 'Rosto, cabelo e roupa com mais detalhe; a mobília fica menor perto deles.' },
  ] },
  { chave: 'arte', titulo: 'Arte dos personagens', g1: 'humanos', opcoes: [
    { valor: 'procedural', nome: 'Só procedural', frase: 'Tudo sai do código: consistente e cresce sozinho com o mundo.' },
    { valor: 'humanos', nome: 'Passe à mão nos humanos', frase: 'Cabeça e tronco dos humanos desenhados pixel a pixel; os androides seguem procedurais.' },
    { valor: 'mao', nome: 'Passe à mão também nos androides', frase: 'Como no protótipo do G1: humanos e androides principais desenhados pixel a pixel.' },
  ] },
  { chave: 'celular', titulo: 'Celular em pé', g1: 'iso', opcoes: [
    { valor: 'iso', nome: 'Isométrico aquário', frase: 'O mesmo andar do PC, com a câmera passeando sozinha.' },
    { valor: 'corte', nome: 'Corte lateral', frase: 'O andar visto de frente, uma sala por faixa, como no Tiny Tower. No mundo, fica a um toque no botão Corte do HUD.' },
  ] },
  { chave: 'paleta', titulo: 'Paleta e luz', g1: 'fria', opcoes: [
    { valor: 'fria', nome: 'Noite neon fria', frase: 'Azul, ciano e magenta, como na prancha. De dia, céu claro.' },
    { valor: 'quente', nome: 'Noite quente', frase: 'Madeira, lampiões e luz âmbar. De dia, tons de fim de tarde.' },
  ] },
  { chave: 'densidade', titulo: 'Densidade do andar', g1: 'cheio', opcoes: [
    { valor: 'prancha', nome: 'Como a prancha', frase: 'Só a mobília da prancha, com mais piso livre: cada ala se reconhece de longe.' },
    { valor: 'cheio', nome: 'Andar cheio', frase: 'Mais mobília, figurantes, letreiros e detalhes de academia e games.' },
  ] },
];

const qs = new URLSearchParams(location.search);
const opUrl = lerOpcoes(qs);
const escolhas: Escolhas = {
  escala: opUrl.tam === 16 ? '16' : '24', arte: opUrl.maoFeita === 'nenhum' ? 'procedural' : opUrl.maoFeita === 'todos' ? 'mao' : 'humanos', celular: opUrl.vista === 'corte' ? 'corte' : 'iso',
  paleta: opUrl.paleta, densidade: opUrl.densidade,
};
let comparar: Chave | null = (['escala', 'arte', 'celular', 'paleta', 'densidade'] as const).find((k) => qs.get('comparar') === k) ?? null;
let preset: NomePreset | null = opUrl.preset;
let horaForcada: number | null = opUrl.hora;
let ocio: 'real' | 'rapido' = opUrl.ocio;
// a aba A ou B da comparação no celular fica na URL (sobrevive a recarregar e vira link)
let lado: 'A' | 'B' = qs.get('lado') === 'B' ? 'B' : 'A';
const celularAparelho = ehCelular();
let carga: CargaLocal;
let instancias: InstanciaMundo[] = [];
let geracao = 0;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e;
};

function montarPagina(): { palcos: HTMLElement; perguntas: HTMLElement; barra: HTMLElement; elenco: HTMLElement; links: HTMLElement } {
  const raiz = document.getElementById('prototipos')!;
  raiz.className = 'pagina';
  const topo = el('header', 'topo');
  topo.append(el('span', 'selo', 'Ecossistema Arcadia · Fase 1 · portão G1'), el('h1', undefined, 'Protótipos do mundo'));
  const lead = el('p', 'lead', 'Cinco perguntas de gosto, cada uma com duas respostas, todas no motor da Fase 1 e com o mesmo cenário simulado. Combine as respostas, compare uma pergunta lado a lado e veja o fps de cada uma. As escolhas do G1 (23/10/2026) já são o padrão do mundo e estão marcadas em cada pergunta. Em todas, a ala sem trabalho fica em espera (meia-luz fria, telas e letreiro apagados e o ícone de stand-by na placa) e acorda quando o primeiro androide cruza a porta; o bot parado espera na cápsula de recarga da própria ala.');
  const links = el('p', 'links');
  topo.append(lead, links);
  const barra = el('div', 'barra');
  const perguntas = el('section', 'perguntas');
  perguntas.setAttribute('aria-label', 'Perguntas');
  const palcos = el('section', 'palcos');
  palcos.setAttribute('aria-label', 'Mundo');
  const secElenco = el('section', 'secao');
  secElenco.append(el('h2', undefined, 'Elenco nos dois tamanhos'), el('p', undefined, 'Cada personagem em 16 por 32 e 24 por 40, só procedural e com o passe à mão. No passe à mão, a cabeça e o tronco são mapas de pixels desenhados um a um; braços e pernas continuam procedurais.'));
  const elenco = el('div', 'elenco');
  secElenco.append(elenco);
  raiz.append(topo, barra, perguntas, palcos, secElenco);
  return { palcos, perguntas, barra, elenco, links };
}

const ui = montarPagina();

/** Parâmetros das escolhas, do preset, da hora e do ócio (os mesmos que a página do mundo entende). */
function parametrosEscolhas(): URLSearchParams {
  const p = new URLSearchParams();
  // só o que foge do padrão, que é a escolha do G1
  if (escolhas.escala === '16') p.set('escala', '16');
  if (escolhas.arte !== 'humanos') p.set('arte', escolhas.arte);
  if (escolhas.celular === 'corte') p.set('vista', 'corte');
  if (escolhas.paleta === 'quente') p.set('paleta', 'quente');
  if (escolhas.densidade === 'prancha') p.set('densidade', 'prancha');
  if (preset) p.set('q', preset);
  if (horaForcada !== null) p.set('hora', String(horaForcada));
  if (ocio === 'rapido') p.set('ocio', 'rapido');
  for (const k of ['semente', 'local', 'motor', 'fps', 'aquario', 'foco', 'debug', 'roupa', 'movimento']) { const v = qs.get(k); if (v !== null) p.set(k, v); }
  return p;
}

/** Link "Abrir o mundo em tela cheia": a página do mundo com a combinação escolhida. */
let linkMundo: HTMLAnchorElement | null = null;
const BASE_MUNDO = import.meta.env.DEV ? '/' : './';

function sincronizarUrl(): void {
  const p = parametrosEscolhas();
  if (linkMundo) { const s = p.toString(); linkMundo.href = s ? `${BASE_MUNDO}?${s}` : BASE_MUNDO; }
  if (comparar) p.set('comparar', comparar);
  if (comparar && lado === 'B') p.set('lado', 'B');
  const s = p.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function montarPerguntas(): void {
  ui.perguntas.replaceChildren();
  PERGUNTAS.forEach((pq, n) => {
    const card = el('article', 'pergunta');
    card.dataset.chave = pq.chave;
    if (comparar === pq.chave) card.classList.add('em-comparacao');
    const h = el('h3'); h.append(el('span', 'num', String(n + 1)), ` ${pq.titulo}`);
    card.append(h);
    const ops = el('div', 'opcoes');
    pq.opcoes.forEach((o, k) => {
      const b = el('button', 'opcao');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(escolhas[pq.chave] === o.valor));
      b.append(el('b', undefined, `${'ABC'[k]}: ${o.nome}`), el('span', undefined, o.frase));
      if (o.valor === pq.g1) { b.dataset.g1 = '1'; b.append(el('em', 'g1', 'escolhida no G1')); }
      b.addEventListener('click', () => { (escolhas as unknown as Record<string, string>)[pq.chave] = o.valor; if (comparar === pq.chave) comparar = null; atualizar(); });
      ops.append(b);
    });
    card.append(ops);
    const cmp = el('button', 'comparar', comparar === pq.chave ? 'Sair da comparação' : 'Comparar A e B lado a lado');
    cmp.type = 'button';
    cmp.addEventListener('click', () => { comparar = comparar === pq.chave ? null : pq.chave; lado = 'A'; atualizar(); });
    card.append(cmp);
    if (pq.chave === 'celular') card.append(el('p', 'nota', 'Só para o celular: aqui o palco vira um celular em pé.'));
    if (pq.chave === 'arte') card.append(el('p', 'nota', 'A comparação lado a lado mostra A e B; a C fica pela opção ou por ?arte=mao.'));
    ui.perguntas.append(card);
  });
}

function montarBarra(): void {
  ui.barra.replaceChildren();
  const grupo = (rot: string, itens: [string, string, boolean, () => void][]) => {
    const g = el('div', 'grupo'); g.append(el('span', 'rotulo', rot));
    for (const [txt, titulo, ativo, fn] of itens) { const b = el('button', 'chip', txt); b.type = 'button'; b.title = titulo; b.setAttribute('aria-pressed', String(ativo)); b.addEventListener('click', fn); g.append(b); }
    ui.barra.append(g);
  };
  grupo('Preset', [
    ['auto', 'Preset automático: médio no celular, alto no PC', preset === null, () => { preset = null; atualizar(); }],
    ['baixo', 'Menos brilhos e partículas, pixel maior', preset === 'baixo', () => { preset = 'baixo'; atualizar(); }],
    ['médio', 'O preset do celular', preset === 'medio', () => { preset = 'medio'; atualizar(); }],
    ['alto', 'O preset do PC', preset === 'alto', () => { preset = 'alto'; atualizar(); }],
  ]);
  grupo('Hora', [
    ['relógio', 'Dia e noite pelo relógio de São Paulo', horaForcada === null, () => { horaForcada = null; atualizar(); }],
    ['dia', 'Força meio-dia', horaForcada === 12, () => { horaForcada = 12; atualizar(); }],
    ['noite', 'Força 22 h', horaForcada === 22, () => { horaForcada = 22; atualizar(); }],
  ]);
  grupo('Ócio', [
    ['real', 'Pausa em 3 min e sono em 20 min, como no servidor', ocio === 'real', () => { ocio = 'real'; atualizar(); }],
    ['rápido', 'Pausa em 15 s e sono em 45 s: dá para ver uma ala voltar à espera', ocio === 'rapido', () => { ocio = 'rapido'; atualizar(); }],
  ]);
  const trabalho = el('button', 'chip', 'chegou trabalho'); trabalho.type = 'button';
  trabalho.title = 'Acorda uma ala em espera: sessão nova pelo teletransporte ou pedido a um bot na cápsula';
  trabalho.addEventListener('click', () => { for (const i of instancias) i.sim.chegarTrabalho(); });
  const reiniciar = el('button', 'chip', 'reiniciar cenário'); reiniciar.type = 'button'; reiniciar.addEventListener('click', () => atualizar());
  ui.barra.append(trabalho, reiniciar);
}

/** Área de arte do celular-alvo em pé (Moto G14, 412 por 915 px com DPR 2,625, em escala 4). */
const ARTE_CELULAR = { w: 271, h: 601 };

function opcoesPara(e: Escolhas, telefone: boolean): Omit<OpcoesMundo, 'planta' | 'pacote'> {
  return {
    tam: e.escala === '24' ? 24 : 16, maoFeita: PASSE[e.arte], vista: e.celular, paleta: e.paleta, densidade: e.densidade, roupa: opUrl.roupa,
    preset, motor: opUrl.motor, semente: opUrl.semente, hora: horaForcada, noite: null, teto: opUrl.teto, aquario: opUrl.aquario, foco: opUrl.foco,
    hud: 'enxuto', celular: celularAparelho || telefone ? true : undefined, expor: false, debug: opUrl.debug, ocio, rolagem: celularAparelho,
  };
}

async function atualizar(): Promise<void> {
  sincronizarUrl();
  montarPerguntas();
  montarBarra();
  const minha = ++geracao;
  for (const i of instancias) i.destruir();
  instancias = [];
  ui.palcos.replaceChildren();
  const variantes: { rotulo: string; frase: string; e: Escolhas }[] = [];
  if (comparar) {
    const pq = PERGUNTAS.find((p) => p.chave === comparar)!;
    for (const [k, o] of pq.opcoes.slice(0, 2).entries()) variantes.push({ rotulo: `${k === 0 ? 'A' : 'B'}: ${o.nome}`, frase: o.frase, e: { ...escolhas, [pq.chave]: o.valor } as Escolhas });
  } else variantes.push({ rotulo: 'Combinação escolhida', frase: PERGUNTAS.map((p) => p.opcoes.find((o) => o.valor === escolhas[p.chave])!.nome).join(' · '), e: escolhas });
  // no celular, a comparação alterna A e B (lado a lado ficaria pequeno demais)
  const mostrar = celularAparelho && variantes.length === 2 ? [variantes[lado === 'A' ? 0 : 1]] : variantes;
  ui.palcos.dataset.n = String(mostrar.length);
  if (celularAparelho && variantes.length === 2) {
    const abas = el('div', 'abas');
    for (const l of ['A', 'B'] as const) { const b = el('button', 'chip', variantes[l === 'A' ? 0 : 1].rotulo); b.type = 'button'; b.setAttribute('aria-pressed', String(lado === l)); b.addEventListener('click', () => { lado = l; atualizar(); }); abas.append(b); }
    ui.palcos.append(abas);
  }
  const dpr = window.devicePixelRatio || 1;
  const caixas = mostrar.map((v) => {
    const fig = el('figure', 'palco-proto');
    const telefone = v.e.celular === 'corte' || comparar === 'celular';
    fig.dataset.telefone = telefone ? '1' : '0';
    fig.dataset.comparar = comparar ? '1' : '0';
    const quadro = el('div', 'quadro');
    // no PC, o celular em pé mostra a área de arte do Moto G14 (271 por 601 px) numa escala
    // inteira: o corte lateral cabe inteiro e as duas vistas ficam do mesmo tamanho
    let escala: number | undefined;
    if (telefone && !celularAparelho) {
      escala = Math.max(2, Math.round(2 * dpr));
      // + 16 px: a moldura do celular tem 8 px de borda de cada lado
      Object.assign(quadro.style, { width: `${(ARTE_CELULAR.w * escala) / dpr + 16}px`, height: `${(ARTE_CELULAR.h * escala) / dpr + 16}px`, maxHeight: 'none', aspectRatio: 'auto' });
    }
    const leg = el('figcaption');
    const medida = el('span', 'medida', 'carregando...');
    leg.append(el('b', undefined, v.rotulo), el('span', undefined, v.frase), medida);
    if (celularAparelho) leg.append(el('span', 'dica', 'A página rola por cima do mundo. Para mexer nele, arraste na horizontal ou toque uma vez.'));
    fig.append(quadro, leg);
    ui.palcos.append(fig);
    return { v, quadro, medida, escala };
  });
  // comparação justa: A e B na mesma escala inteira (2 ou mais), no mesmo foco e com a câmera parada
  if (comparar) {
    const larg = Math.min(...caixas.map((c) => c.quadro.clientWidth || 1));
    const comum = Math.max(2, celularAparelho ? Math.floor((larg * dpr) / ARTE_CELULAR.w) : Math.round(2 * dpr));
    for (const c of caixas) c.escala ??= comum;
  }
  for (const c of caixas) {
    try {
      const telefone = c.v.e.celular === 'corte' || comparar === 'celular';
      const extra: Partial<OpcoesMundo> = { escala: c.escala };
      if (comparar) { extra.aquario = qs.has('aquario') ? opUrl.aquario : false; extra.foco = opUrl.foco ?? 'cockpit'; }
      const inst = await criarMundo(c.quadro, { planta: carga.planta, pacote: carga.pacote, ...opcoesPara(c.v.e, telefone), ...extra });
      if (minha !== geracao) { inst.destruir(); return; }
      instancias.push(inst);
      const atualizarMedida = () => {
        if (!instancias.includes(inst)) return;
        const [w, h, s] = inst.interna();
        c.medida.textContent = `${Math.round(inst.laco.medidas.fps)} fps · ${inst.laco.medidas.ms.toFixed(1)} ms/quadro · ${inst.info.nome} · preset ${inst.preset.nome} · ${w} por ${h} px de arte, pixel ${s}x · carga ${Math.round(inst.tempoCargaMs)} ms`;
        setTimeout(atualizarMedida, 1000);
      };
      atualizarMedida();
    } catch (e) {
      c.medida.textContent = `não abriu: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  (window as unknown as { __prototipos: unknown }).__prototipos = { instancias, escolhas: { ...escolhas }, comparar };
}

async function iniciar(): Promise<void> {
  carga = await carregarCena(opUrl.local);
  linkMundo = el('a', undefined, 'Abrir o mundo em tela cheia');
  linkMundo.href = BASE_MUNDO;
  ui.links.append(linkMundo);
  if (import.meta.env.DEV) {
    const temPrancha = await fetch('/local/prancha/arcadia-pixel.html', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (temPrancha) for (const [href, txt] of [['/local/prancha/arcadia-pixel.html', 'Prancha aprovada (local)'], ['/local/prova/arcadia-pixi.html', 'Prova do motor da Fase 0 (local)']]) { const a = el('a', undefined, txt); a.href = href; ui.links.append(a); }
  }
  ui.links.append(el('span', 'origem', carga.origem.cenario === 'local' ? 'Cenário e personagens locais' : 'Cenário genérico do repositório'));
  const plantaPessoas = aplicarPacote(carga.planta, carga.pacote);
  const fichas: FichaElenco[] = [];
  const vistos = new Set<string>();
  for (const p of plantaPessoas.personagens) {
    if (vistos.has(p.aparencia) || p.papel === 'visitante') continue;
    vistos.add(p.aparencia);
    const ap = plantaPessoas.aparencias[p.aparencia];
    if (ap) fichas.push({ nome: p.nome, texto: p.cargo, aparencia: ap });
    if (ap?.tipo === 'humano' && ap.variante) fichas.push({ nome: `${p.nome}, roupa alternativa`, texto: `Sai perto de um dia em ${ap.variante.umDiaEm ?? 3} (?roupa=variante força)`, aparencia: comVariante(ap) });
  }
  for (const k of ['npcTreinador', 'npcBarista', 'npcLimpeza', 'gato']) if (plantaPessoas.aparencias[k] && !vistos.has(k)) fichas.push({ nome: k === 'gato' ? 'Gato' : k === 'npcLimpeza' ? 'Robô de limpeza' : k === 'npcBarista' ? 'Barista' : 'Treinador', texto: 'Figurante do andar cheio', aparencia: plantaPessoas.aparencias[k] });
  const fontes = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  await fontes;
  montarElenco(ui.elenco, fichas);
  await atualizar();
}

iniciar().catch((e: unknown) => {
  const pre = el('pre', 'arc-erro', `Os protótipos não conseguiram abrir: ${e instanceof Error ? e.message : String(e)}`);
  document.body.append(pre);
  console.error(e);
});
