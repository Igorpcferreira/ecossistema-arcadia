// Linha de comando do servidor e do doctor em processos filhos, com casa, LOCALAPPDATA e TEMP inventados (pasta
// temporária) e sem ARCADIA_CONFIG: a configuração e os dados de quem roda os testes nunca entram.
// Em 23/10/2026 um `--help` não reconhecido subiu o servidor com o exemplo do repositório e mexeu no banco real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_EXEMPLO } from './config/carregar.ts';
import { pastaTemporaria } from './testes/apoio.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const DOCTOR = fileURLToPath(new URL('./doctor.ts', import.meta.url));

type Execucao = { codigo: number | null; saida: string; local: string };

/** Roda o programa num ambiente inventado. ARCADIA_CONFIG, quando pedida, aponta para um arquivo que não existe. */
function rodar(arquivo: string, args: string[], opcoes: { configInexistente?: boolean } = {}): Promise<Execucao> {
  const pasta = pastaTemporaria();
  const casa = path.join(pasta.caminho, 'casa');
  const local = path.join(casa, 'AppData', 'Local');
  const temp = path.join(local, 'Temp');
  fs.mkdirSync(temp, { recursive: true });
  const trocadas: Record<string, string> = { USERPROFILE: casa, HOME: casa, LOCALAPPDATA: local, APPDATA: path.join(casa, 'AppData', 'Roaming'), TEMP: temp, TMP: temp };
  if (opcoes.configInexistente) trocadas['ARCADIA_CONFIG'] = path.join(casa, 'nao-existe.yaml');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const chave = k.toUpperCase();
    if (v === undefined || chave.startsWith('ARCADIA_') || chave in trocadas) continue;
    env[k] = v;
  }
  Object.assign(env, trocadas, { NODE_NO_WARNINGS: '1' });
  return new Promise((ok) => {
    const filho = spawn(process.execPath, [arquivo, ...args], { cwd: casa, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    filho.stdout.on('data', (c: Buffer) => (saida += c.toString('utf8')));
    filho.stderr.on('data', (c: Buffer) => (saida += c.toString('utf8')));
    // Rede de segurança: um filho que subisse um servidor de verdade não fica para trás.
    const limite = setTimeout(() => filho.kill(), 60_000);
    filho.on('close', (codigo) => {
      clearTimeout(limite);
      // O que existir na LOCALAPPDATA inventada depois da execução (só nomes), para provar que nada foi criado.
      const criado = fs.readdirSync(local).filter((n) => n !== 'Temp').join(',') + '|' + fs.readdirSync(temp).join(',');
      pasta.remover();
      ok({ codigo, saida, local: criado });
    });
  });
}

const NADA_CRIADO = '|';

/** Um filho por vez: uma rajada de processos pesaria nos testes de tempo que rodam ao lado. */
async function emSerie<T extends readonly (() => Promise<Execucao>)[] | []>(lista: T): Promise<{ [K in keyof T]: Execucao }> {
  const r: Execucao[] = [];
  for (const f of lista) r.push(await f());
  return r as { [K in keyof T]: Execucao };
}


// Poucos filhos (cada um custa uma partida do Node); os casos de argumento ficam em util/args.test.ts.
test('servidor: --help e -h, em qualquer posição, mostram o uso e saem sem ler configuração nem tocar em dados', { timeout: 120_000 }, async () => {
  const execucoes = await emSerie([() => rodar(MAIN, ['--help'], { configInexistente: true }), () => rodar(MAIN, ['--simulador', 'estados', '-h'], { configInexistente: true })]);
  for (const r of execucoes) {
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /^Arcadia: servidor de dados\.\nUso: node apps\/server\/src\/main\.ts \[opções\]/);
    assert.ok(!r.saida.includes('não existe'), 'a configuração (que não existe) nem foi procurada');
    assert.equal(r.local, NADA_CRIADO);
  }
});

test('servidor: opção desconhecida é recusada antes da configuração', { timeout: 120_000 }, async () => {
  const r = await rodar(MAIN, ['--porta-errada', '1'], { configInexistente: true });
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /^Opção desconhecida: --porta-errada\. Nada foi aberto\. Use --ajuda para ver as opções\./);
  assert.ok(!r.saida.includes('não existe'), 'a configuração nem foi procurada');
  assert.equal(r.local, NADA_CRIADO);
});

test('servidor: sem configuração real, recusa com mensagem clara; o exemplo do repositório não vale nem indicado', { timeout: 120_000 }, async () => {
  const [semNada, comExemplo, semSimulador] = await emSerie([
    () => rodar(MAIN, []),
    () => rodar(MAIN, ['--config', CONFIG_EXEMPLO, '--simulador', 'dia-normal']),
    () => rodar(MAIN, ['--uma-vez']),
  ]);
  assert.equal(semNada.codigo, 1, semNada.saida);
  assert.match(semNada.saida, /^Nenhuma configuração encontrada, e o exemplo do repositório não serve para rodar/);
  assert.ok(semNada.saida.includes('%USERPROFILE%\\.arcadia\\arcadia.config.yaml'), semNada.saida);
  assert.equal(comExemplo.codigo, 1, comExemplo.saida);
  assert.match(comExemplo.saida, /^O exemplo do repositório \(config\/arcadia\.config\.exemplo\.yaml\) não vale como configuração de execução/);
  assert.equal(semSimulador.codigo, 1);
  assert.match(semSimulador.saida, /^--semente, --velocidade e --uma-vez só valem com --simulador\. Nada foi aberto\./);
  for (const r of [semNada, comExemplo, semSimulador]) assert.equal(r.local, NADA_CRIADO, 'nada criado na LOCALAPPDATA');
});

test('doctor: --help mostra o uso sem ler nada; sem configuração real, recusa como o servidor', { timeout: 120_000 }, async () => {
  const [ajuda, semNada] = await emSerie([() => rodar(DOCTOR, ['--help'], { configInexistente: true }), () => rodar(DOCTOR, [])]);
  assert.equal(ajuda.codigo, 0, ajuda.saida);
  assert.match(ajuda.saida, /^Arcadia doctor:/);
  assert.equal(semNada.codigo, 1, semNada.saida);
  assert.match(semNada.saida, /^Nenhuma configuração encontrada/);
  for (const r of [ajuda, semNada]) assert.equal(r.local, NADA_CRIADO);
});
