// Página do mundo: o andar inteiro em tela cheia, com HUD enxuto no celular.
// Fonte padrão: o servidor do Arcadia (snapshot e SSE em /api). ?fonte=simulador usa o simulador
// do navegador, como no /prototipos.
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import '@fontsource/vt323/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './estilos/base.css';
import './estilos/mundo.css';
import { criarMundo, type InstanciaMundo } from './app.ts';
import { carregarCena } from './cena/carregar.ts';
import { lerOpcoes } from './opcoes.ts';
import { lerParametros } from './qualidade/presets.ts';
import { Conexao, buscarSnapshot, recarregadorPadrao, recarregarQuandoResponder } from './fonte/conexao.ts';
import { Espelho } from './fonte/espelho.ts';
import { plantaDoServidor } from './fonte/planta.ts';
import type { Snapshot } from './fonte/tipos.ts';
import type { StatusFonte } from './ui/interface.ts';

const API = '/api';

/** Primeiro snapshot: sem servidor, a tela diz e tenta de novo sozinha (2, 4, 8 e depois 10 s). */
async function snapshotComEspera(raiz: HTMLElement): Promise<Snapshot> {
  const aviso = document.createElement('div');
  aviso.className = 'arc-carga';
  aviso.textContent = 'Conectando ao servidor do Arcadia...';
  raiz.append(aviso);
  for (let tentativa = 0; ; tentativa++) {
    try {
      const s = await buscarSnapshot(API);
      aviso.remove();
      return s;
    } catch {
      const seg = Math.min(10, 2 ** Math.min(3, tentativa + 1));
      aviso.textContent = `Sem conexão com o servidor do Arcadia. Tentando de novo em ${seg} s.`;
      await new Promise((r) => setTimeout(r, seg * 1000));
      aviso.textContent = 'Conectando ao servidor do Arcadia...';
    }
  }
}

async function iniciar(): Promise<void> {
  const op = lerOpcoes(lerParametros());
  const raiz = document.getElementById('app')!;
  const servidor = op.fonte === 'servidor';
  const carga = await carregarCena(op.local, servidor);
  document.documentElement.dataset.cenario = carga.origem.cenario;
  const fontes = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  await fontes;
  // com o servidor: o snapshot antes de tudo (as alas dele decidem a planta do andar)
  const primeiro = servidor ? await snapshotComEspera(raiz) : null;
  const espelho = primeiro ? new Espelho(primeiro) : null;
  let status: StatusFonte = espelho ? 'conectando' : 'simulado';
  let conexao: Conexao | null = null;
  // o botão Corte do HUD troca a vista: recria o mundo na outra e guarda a escolha na URL;
  // com o servidor, uma ala nova (ou renomeada) também recria o mundo, com a planta nova
  let vista = op.vista;
  let inst: InstanciaMundo | null = null;
  let fila = Promise.resolve();
  const abrir = async (): Promise<void> => {
    inst?.destruir();
    inst = null;
    const mapa = espelho ? plantaDoServidor(carga.planta, espelho.estado) : null;
    inst = await criarMundo(raiz, {
      planta: mapa ? mapa.planta : carga.planta, pacote: carga.pacote, tam: op.tam, maoFeita: op.maoFeita, vista, paleta: op.paleta, densidade: op.densidade,
      preset: op.preset, motor: op.motor, semente: op.semente, hora: op.hora, noite: op.noite, teto: op.teto, aquario: op.aquario, foco: op.foco,
      hud: op.hud, celular: op.celular ?? undefined, expor: true, debug: op.debug, zoom: op.zoom, pausado: op.pausado, ocio: op.ocio, movimento: op.movimento,
      roupa: op.roupa, trocarVista,
      servidor: espelho && mapa ? { espelho, mapa, aoRemontar: remontar } : undefined,
    });
    inst.ui.mostrarConexao(status, retomar);
    // ganchos de depuração e das provas: a recarga pelo mesmo caminho da das 03:00 e o estado dela
    Object.assign((window as unknown as { __arcadia: Record<string, unknown> }).__arcadia, {
      espelho, conexao: () => conexao, fonte: op.fonte, recarregar: madrugada, recarga: () => recarregadorPadrao(),
    });
  };
  const remontar = (): void => { fila = fila.then(abrir, abrir); };
  // outra aba deste aparelho ficou com a conexão: o toque no aviso traz esta de volta
  const retomar = (): void => conexao?.retomar();
  // recarga programada: espera a página responder (com o servidor fora, ela fica pendente e sai quando ele voltar)
  const madrugada = (): void => { void recarregarQuandoResponder(); };
  const trocarVista = (): void => {
    vista = vista === 'corte' ? 'iso' : 'corte';
    const qs = new URLSearchParams(location.search);
    if (vista === 'corte') qs.set('vista', 'corte'); else qs.delete('vista');
    history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
    remontar();
  };
  await abrir();
  if (espelho && primeiro) {
    conexao = new Conexao(API, {
      snapshot: (s) => { espelho.substituir(s); inst?.coreografo?.ressincronizar(); },
      quadro: (q) => espelho.aplicar(q),
      status: (s) => { status = s; inst?.ui.mostrarConexao(s, retomar); },
      recarregar: () => { void recarregarQuandoResponder(); },
    });
    conexao.iniciar(primeiro);
  }
  // recarga programada de madrugada (03:00 a 03:10), só depois de 6 h aberta: memória sempre limpa. Ela fica
  // pendente até a página responder: com o servidor fora na janela, acontece assim que ele voltar.
  const aberto = Date.now();
  setInterval(() => {
    const d = new Date();
    const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(d));
    if (Date.now() - aberto > 6 * 3600e3 && h === 3 && d.getMinutes() < 10) madrugada();
  }, 5 * 60e3);
}

iniciar().catch((e: unknown) => {
  const msg = document.createElement('pre');
  msg.className = 'arc-erro';
  msg.textContent = `O Arcadia não conseguiu abrir: ${e instanceof Error ? e.message : String(e)}`;
  document.body.append(msg);
  console.error(e);
});
