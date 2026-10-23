// Página do mundo: o andar inteiro em tela cheia, com HUD enxuto no celular.
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

async function iniciar(): Promise<void> {
  const op = lerOpcoes(lerParametros());
  const raiz = document.getElementById('app')!;
  const carga = await carregarCena(op.local);
  document.documentElement.dataset.cenario = carga.origem.cenario;
  const fontes = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  await fontes;
  // o botão Corte do HUD troca a vista: recria o mundo na outra e guarda a escolha na URL
  let vista = op.vista;
  let inst: InstanciaMundo | null = null;
  const abrir = async (): Promise<void> => {
    inst?.destruir();
    inst = await criarMundo(raiz, {
      planta: carga.planta, pacote: carga.pacote, tam: op.tam, maoFeita: op.maoFeita, vista, paleta: op.paleta, densidade: op.densidade,
      preset: op.preset, motor: op.motor, semente: op.semente, hora: op.hora, noite: op.noite, teto: op.teto, aquario: op.aquario, foco: op.foco,
      hud: op.hud, celular: op.celular ?? undefined, expor: true, debug: op.debug, zoom: op.zoom, pausado: op.pausado, ocio: op.ocio, movimento: op.movimento,
      roupa: op.roupa, trocarVista,
    });
  };
  const trocarVista = (): void => {
    vista = vista === 'corte' ? 'iso' : 'corte';
    const qs = new URLSearchParams(location.search);
    if (vista === 'corte') qs.set('vista', 'corte'); else qs.delete('vista');
    history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
    void abrir();
  };
  await abrir();
  // reload programado de madrugada (03:00 a 03:10), só depois de 6 h aberta: memória sempre limpa
  const aberto = Date.now();
  setInterval(() => {
    const d = new Date();
    const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(d));
    if (Date.now() - aberto > 6 * 3600e3 && h === 3 && d.getMinutes() < 10) location.reload();
  }, 5 * 60e3);
}

iniciar().catch((e: unknown) => {
  const msg = document.createElement('pre');
  msg.className = 'arc-erro';
  msg.textContent = `O Arcadia não conseguiu abrir: ${e instanceof Error ? e.message : String(e)}`;
  document.body.append(msg);
  console.error(e);
});
