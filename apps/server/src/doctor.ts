// Doctor pelo terminal. Se o servidor estiver no ar, pergunta a ele (127.0.0.1, rota /doctor); senão, confere
// sozinho: configuração, pasta de dados, banco, portas e fontes (só contagens e datas, nunca conteúdo).
// Uso: node apps/server/src/doctor.ts [--config <arquivo>] [--json]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSAO_ESQUEMA } from '@arcadia/shared';
import { carregarConfig, ErroConfig, explicarErroConfig, type ConfigCarregada } from './config/carregar.ts';
import {
  coletarFontes, descreverConfig, descreverDados, formatarDiagnostico, infoDoBanco, protegerDiagnostico, protegerTextoDoctor, sondarPorta,
  versaoNode, type Diagnostico,
} from './doctor/diagnostico.ts';
import { ambienteAtual, expandir, type AmbienteCaminhos } from './util/caminhos.ts';
import { lerArgumentos } from './util/args.ts';

function perguntarAoServidor(porta: number, json: boolean): Promise<string | undefined> {
  return new Promise((resolver) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, path: json ? '/doctor' : '/doctor?formato=texto', method: 'GET', timeout: 4_000 },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => resolver(res.statusCode === 200 ? Buffer.concat(partes).toString('utf8') : undefined));
        res.on('error', () => resolver(undefined));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolver(undefined));
    req.end();
  });
}

export async function diagnosticoLocal(carregada: ConfigCarregada, amb: AmbienteCaminhos): Promise<Diagnostico> {
  const config = carregada.config;
  const agora = Date.now();
  const dirDados = path.resolve(amb.cwd, expandir(config.servidor.dados, amb));
  const existe = fs.existsSync(dirDados);
  const d: Diagnostico = {
    geradoEm: agora,
    fuso: config.mundo.fuso,
    servidor: { rodando: false, versaoEsquema: VERSAO_ESQUEMA, node: versaoNode() },
    configuracao: descreverConfig(carregada),
    dados: { pasta: descreverDados(dirDados, amb), existe },
    portas: [
      { nome: 'Ingestão, saúde e doctor', host: config.servidor.ingestao.host, porta: config.servidor.ingestao.porta, estado: await sondarPorta('127.0.0.1', config.servidor.ingestao.porta) },
      { nome: 'Visualização (snapshot, SSE e depuração)', host: '127.0.0.1', porta: config.servidor.visualizacao.porta, estado: await sondarPorta('127.0.0.1', config.servidor.visualizacao.porta) },
    ],
    fontes: await coletarFontes(config, amb, { agora }),
  };
  if (existe) {
    const b = infoDoBanco(path.join(dirDados, 'arcadia.sqlite'));
    if (b) d.dados.banco = b;
    const sim = infoDoBanco(path.join(dirDados, 'arcadia-sim.sqlite'));
    if (sim) d.dados.bancoSimulador = sim;
  }
  return d;
}

async function principal(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), ['json']);
  const amb = ambienteAtual();
  let carregada: ConfigCarregada;
  try {
    carregada = carregarConfig({ amb, ...(args.valores['config'] !== undefined ? { argumento: args.valores['config'] } : {}) });
  } catch (e) {
    if (e instanceof ErroConfig) {
      console.log(explicarErroConfig(e));
      return 1;
    }
    throw e;
  }
  const json = args.sinais.has('json');
  const resposta = await perguntarAoServidor(carregada.config.servidor.ingestao.porta, json);
  if (resposta !== undefined) {
    process.stdout.write(resposta.endsWith('\n') ? resposta : `${resposta}\n`);
    return 0;
  }
  // As mesmas guardas da rota /doctor (o JSON campo a campo, o texto linha a linha): nada de caminho absoluto, pasta
  // pessoal, e-mail ou segredo na saída.
  const d = await diagnosticoLocal(carregada, amb);
  process.stdout.write(json ? `${JSON.stringify(protegerDiagnostico(d, amb), null, 2)}\n` : `${protegerTextoDoctor(formatarDiagnostico(d), amb)}\n`);
  return 0;
}

const igual = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const executadoDireto = process.argv[1] !== undefined && igual(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (executadoDireto) {
  principal().then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(`Erro inesperado no doctor: ${(e as { name?: string }).name ?? 'erro'}`);
      process.exit(1);
    },
  );
}
