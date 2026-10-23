// Servidor do Arcadia: coleta, normaliza, guarda e transmite o estado do mundo.
// Uso: node apps/server/src/main.ts [--config <arquivo>] [--simulador <cenário>] [--semente <n>] [--velocidade <x>] [--uma-vez]
import { ehHostLocal, carregarConfig, ErroConfig, explicarErroConfig } from './config/carregar.ts';
import { CENARIOS, ehCenario } from './adaptadores/sim/simulador.ts';
import { iniciarServidor, instalarGuardaDoProcesso } from './servidor.ts';
import { ErroPorta } from './http/servir.ts';
import { ambienteAtual } from './util/caminhos.ts';
import { lerArgumentos } from './util/args.ts';
import { criarLog, descreverErro } from './util/log.ts';

async function principal(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), ['uma-vez', 'ajuda']);
  if (args.sinais.has('ajuda')) {
    console.log(
      [
        'Arcadia: servidor de dados.',
        '  --config <arquivo>      configuração (senão ARCADIA_CONFIG, %USERPROFILE%\\.arcadia\\arcadia.config.yaml ou o exemplo)',
        `  --simulador <cenário>   ${CENARIOS.join(', ')}`,
        '  --semente <n>           semente do simulador (padrão 42)',
        '  --velocidade <x>        2 = duas vezes mais rápido',
        '  --uma-vez               o simulador não repete o cenário',
      ].join('\n'),
    );
    return 0;
  }
  const amb = ambienteAtual();
  let carregada;
  try {
    carregada = carregarConfig({ amb, ...(args.valores['config'] !== undefined ? { argumento: args.valores['config'] } : {}) });
  } catch (e) {
    if (e instanceof ErroConfig) {
      console.error(explicarErroConfig(e));
      return 1;
    }
    throw e;
  }
  const log = criarLog({ fuso: carregada.config.mundo.fuso });
  instalarGuardaDoProcesso(log);
  log.info(`configuração: ${carregada.descricao}`);

  let simulador: { cenario: (typeof CENARIOS)[number]; semente: number; velocidade?: number; repetir: boolean } | undefined;
  const cenario = args.valores['simulador'];
  if (cenario !== undefined) {
    if (!ehCenario(cenario)) {
      console.error(`Cenário desconhecido. Use um destes: ${CENARIOS.join(', ')}.`);
      return 1;
    }
    const semente = Number(args.valores['semente'] ?? 42);
    const velocidade = args.valores['velocidade'] !== undefined ? Number(args.valores['velocidade']) : undefined;
    if (!Number.isInteger(semente) || (velocidade !== undefined && !(velocidade > 0 && velocidade <= 1000))) {
      console.error('Use --semente com um número inteiro e --velocidade com um número entre 0 e 1000.');
      return 1;
    }
    simulador = { cenario, semente, repetir: !args.sinais.has('uma-vez'), ...(velocidade !== undefined ? { velocidade } : {}) };
  }

  let servidor;
  try {
    servidor = await iniciarServidor({ carregada, amb, log, fontesReais: !simulador, ...(simulador ? { simulador } : {}) });
  } catch (e) {
    if (e instanceof ErroPorta) {
      console.error(e.message);
      return 1;
    }
    log.erro('o servidor não subiu', { erro: descreverErro(e) });
    return 1;
  }
  const vis = servidor.visualizacao;
  const ing = servidor.ingestao;
  if (!ehHostLocal(carregada.config.servidor.visualizacao.host)) {
    log.aviso('visualização só no PC até o pareamento (Fase 4)', { pedido: carregada.config.servidor.visualizacao.host });
  }
  log.info(`no ar: depuração em http://${vis.host}:${vis.porta}/depurar e doctor em http://${ing.host}:${ing.porta}/doctor?formato=texto`);
  if (simulador) log.info(`simulador ligado: ${simulador.cenario}, semente ${simulador.semente}`);

  return await new Promise<number>((resolver) => {
    let parando = false;
    const parar = () => {
      if (parando) return;
      parando = true;
      log.info('desligando: gravando o último snapshot');
      servidor
        .parar()
        .then(() => resolver(0))
        .catch((e: unknown) => {
          log.erro('falha ao desligar', { erro: descreverErro(e) });
          resolver(1);
        });
    };
    process.on('SIGINT', parar);
    process.on('SIGTERM', parar);
    process.on('SIGBREAK', parar);
  });
}

principal().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(`Erro inesperado: ${descreverErro(e)}`);
    process.exit(1);
  },
);
