// Servidor do Arcadia: coleta, normaliza, guarda e transmite o estado do mundo.
// Uso: node apps/server/src/main.ts [--config <arquivo>] [--simulador <cenário>] [--semente <n>] [--velocidade <x>] [--uma-vez]
//      [--porta <n>] [--porta-ingestao <n>] [--mundo <pasta>]
// Falha fechada: --help (ou --ajuda, -h) só mostra o uso; opção desconhecida é recusada antes de ler a configuração;
// sem configuração real, nada sobe (o exemplo do repositório não vale para rodar).
import path from 'node:path';
import { ehHostLocal, carregarConfig, ErroConfig, explicarErroConfig } from './config/carregar.ts';
import { CENARIOS, ehCenario } from './adaptadores/sim/simulador.ts';
import { iniciarServidor, instalarGuardaDoProcesso } from './servidor.ts';
import { ErroPorta } from './http/servir.ts';
import { ErroTrava } from './db/trava.ts';
import { ambienteAtual } from './util/caminhos.ts';
import { interpretarArgumentos } from './util/args.ts';
import { criarLog, descreverErro } from './util/log.ts';

const USO = [
  'Arcadia: servidor de dados.',
  'Uso: node apps/server/src/main.ts [opções]',
  '  --config <arquivo>      configuração (senão ARCADIA_CONFIG ou %USERPROFILE%\\.arcadia\\arcadia.config.yaml;',
  '                          o exemplo do repositório não vale para rodar)',
  `  --simulador <cenário>   ${CENARIOS.join(', ')}`,
  '  --semente <n>           semente do simulador (padrão 42)',
  '  --velocidade <x>        2 = duas vezes mais rápido',
  '  --uma-vez               o simulador não repete o cenário',
  '  --porta <n>             porta da visualização (no lugar da configuração)',
  '  --porta-ingestao <n>    porta da ingestão, da saúde e do doctor',
  '  --mundo <pasta>         build do mundo servido na visualização (padrão: apps/world/dist)',
  '  --ajuda, --help, -h     mostra este uso e sai (sem ler configuração nem dados)',
].join('\n');

async function principal(): Promise<number> {
  const lido = interpretarArgumentos(process.argv.slice(2), {
    valores: ['config', 'simulador', 'semente', 'velocidade', 'porta', 'porta-ingestao', 'mundo'],
    sinais: ['uma-vez'],
  });
  if (lido.tipo === 'ajuda') {
    console.log(USO);
    return 0;
  }
  if (lido.tipo === 'erro') {
    console.error(`${lido.mensagem} Nada foi aberto. Use --ajuda para ver as opções.`);
    return 1;
  }
  const args = lido.args;

  // Tudo o que vem da linha de comando é conferido antes de ler a configuração.
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
  } else if (args.valores['semente'] !== undefined || args.valores['velocidade'] !== undefined || args.sinais.has('uma-vez')) {
    console.error('--semente, --velocidade e --uma-vez só valem com --simulador. Nada foi aberto.');
    return 1;
  }

  // Portas pela linha de comando (no lugar das da configuração).
  const portas: { ingestao?: number; visualizacao?: number } = {};
  for (const [nome, chave] of [['porta', 'visualizacao'], ['porta-ingestao', 'ingestao']] as const) {
    const valor = args.valores[nome];
    if (valor === undefined) continue;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      console.error(`Use --${nome} com um número inteiro entre 1 e 65535.`);
      return 1;
    }
    portas[chave] = n;
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
  const portaIngestao = portas.ingestao ?? carregada.config.servidor.ingestao.porta;
  const portaVisualizacao = portas.visualizacao ?? carregada.config.servidor.visualizacao.porta;
  if (portaIngestao === portaVisualizacao) {
    console.error('A porta da ingestão e a da visualização precisam ser diferentes.');
    return 1;
  }
  const log = criarLog({ fuso: carregada.config.mundo.fuso });
  instalarGuardaDoProcesso(log);
  log.info(`configuração: ${carregada.descricao}`);

  let servidor;
  try {
    servidor = await iniciarServidor({
      carregada, amb, log, fontesReais: !simulador, ...(simulador ? { simulador } : {}), ...(Object.keys(portas).length > 0 ? { portas } : {}),
      ...(args.valores['mundo'] !== undefined ? { dirMundo: path.resolve(amb.cwd, args.valores['mundo']) } : {}),
    });
  } catch (e) {
    // Porta ocupada e pasta de dados em uso são recusas esperadas: nada de dado foi tocado (ou a pasta é de outro).
    if (e instanceof ErroPorta || e instanceof ErroTrava) {
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
  log.info(`no ar: mundo em http://${vis.host}:${vis.porta}/ (depuração em /depurar) e doctor em http://${ing.host}:${ing.porta}/doctor?formato=texto`);
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
