// Testes do carregador de configuração. Caminhos e nomes inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_EXEMPLO, ErroConfig, arquivoDoPacoteLocal, carregarConfig, localizarConfig, pastaDeDados, validarConfig } from './carregar.ts';
import type { AmbienteCaminhos } from '../util/caminhos.ts';
import { load as lerYaml } from 'js-yaml';

const amb: AmbienteCaminhos = {
  casa: 'C:\\Users\\teste',
  variaveis: { LOCALAPPDATA: 'C:\\Users\\teste\\AppData\\Local', USERPROFILE: 'C:\\Users\\teste', TEMP: 'C:\\Users\\teste\\AppData\\Local\\Temp' },
  windows: true,
  cwd: 'C:\\repo',
};

function erros(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof ErroConfig, 'esperava ErroConfig');
    return [e.message, ...e.problemas];
  }
  assert.fail('esperava erro de configuração');
}

const MINIMA = `
versao: 1
servidor:
  ingestao: { host: 127.0.0.1, porta: 47800 }
  visualizacao: { host: 127.0.0.1, porta: 4780 }
alas:
  - id: produtos
    nome: Produtos
    cor: "#c9a7ff"
    regras: ["~/projetos/produto-*/**"]
salas:
  pastasAgregadoras: ["~/projetos"]
`;

test('o exemplo do repositório é válido e sem avisos, com a visualização em 127.0.0.1, mas não vale para rodar', () => {
  const r = validarConfig(lerYaml(fs.readFileSync(CONFIG_EXEMPLO, 'utf8')), amb);
  assert.equal(r.config.servidor.ingestao.porta, 47800);
  assert.equal(r.config.servidor.visualizacao.host, '127.0.0.1');
  assert.equal(r.config.servidor.retencaoDias, 180);
  assert.ok(r.config.alas.length > 0);
  assert.deepEqual(r.avisos, []);
  assert.ok(r.config.salas.pastasDeApoio.includes('docs') && r.config.salas.pastasDeApoio.includes('node_modules'));
  assert.deepEqual(r.config.salas.rascunho, ['%TEMP%']);
  // Ele aponta para a pasta de dados real: carregar para rodar é recusado, mesmo indicado de propósito.
  assert.match(erros(() => carregarConfig({ amb, argumento: CONFIG_EXEMPLO })).join('\n'), /não vale como configuração de execução/);
});

test('pastas de apoio e de rascunho: padrão genérico, só nome de pasta no apoio, aviso para variável desconhecida', () => {
  const { config } = validarConfig({ versao: 1 }, amb);
  assert.ok(config.salas.pastasDeApoio.includes('tmp') && config.salas.pastasDeApoio.includes('.github'));
  assert.deepEqual(config.salas.rascunho, ['%TEMP%']);
  assert.match(erros(() => validarConfig({ versao: 1, salas: { pastasDeApoio: ['docs/velhos'] } }, amb)).join('\n'), /salas\.pastasDeApoio.*só o nome da pasta, sem barra/);
  const { avisos } = validarConfig({ versao: 1, salas: { rascunho: ['%NAO_EXISTE%/x'] } }, amb);
  assert.ok(avisos.some((a) => a.startsWith('salas.rascunho: uma pasta usa variável de ambiente desconhecida')), avisos.join('; '));
});

test('visualização pedida em 0.0.0.0 avisa que fica em 127.0.0.1 até existir pareamento', () => {
  const { avisos } = validarConfig(lerYaml(MINIMA.replace('visualizacao: { host: 127.0.0.1', 'visualizacao: { host: 0.0.0.0')), amb);
  assert.ok(avisos.some((a) => a.includes('servidor.visualizacao.host')), avisos.join('; '));
});

test('padrões preenchem o que falta', () => {
  const { config, avisos } = validarConfig(lerYaml(MINIMA), amb);
  assert.deepEqual(avisos, []);
  assert.equal(config.privacidade.mostrarNomeCurtoDoArquivo, false);
  assert.equal(config.privacidade.mostrarTituloDaTarefa, true);
  assert.equal(config.mundo.fuso, 'America/Sao_Paulo');
  assert.deepEqual(config.mundo.ocio, { pausaMinutos: 3, dormeMinutos: 20 });
  assert.deepEqual(config.fontes.openmausbot.portas, [8799, 18799, 28799]);
  assert.equal(config.fontes.claudeHooks.ligado, false);
  assert.equal(config.recepcao.id, 'recepcao');
  assert.equal(config.servidor.dados, '%LOCALAPPDATA%/Arcadia/dados');
});

test('problemas viram mensagens em português com o caminho do campo', () => {
  const ruim = {
    versao: 1,
    servidor: { ingestao: { host: '0.0.0.0', porta: 70000 }, visualizacao: { porta: 4780 }, dados: 'C:/outro/lugar' },
    alas: [
      { id: 'a', nome: 'A', cor: 'vermelho', regras: [] },
      { id: 'a', nome: 'B', cor: '#000000' },
      { id: 'Com Espaco', nome: 'C', cor: '#000000' },
    ],
  };
  const lista = erros(() => validarConfig(ruim, amb));
  const texto = lista.join('\n');
  assert.match(texto, /servidor\.ingestao\.porta: pode ser no máximo 65535/);
  assert.match(texto, /alas\[0\]\.cor: formato inválido \(cor no formato #rrggbb\)/);
  assert.match(texto, /alas\[2\]\.id: formato inválido/);
  const lista2 = erros(() =>
    validarConfig({ versao: 1, servidor: { ingestao: { host: '0.0.0.0' }, dados: 'C:/outro/lugar' }, alas: [{ id: 'a', nome: 'A', cor: '#000000' }, { id: 'a', nome: 'B', cor: '#000000' }] }, amb),
  );
  const texto2 = lista2.join('\n');
  assert.match(texto2, /alas\[1\]\.id: o id "a" se repete/);
  assert.match(texto2, /servidor\.ingestao\.host: a ingestão/);
  assert.match(texto2, /servidor\.dados: os dados do Arcadia ficam só dentro de %LOCALAPPDATA%\/Arcadia/);
  assert.match(erros(() => validarConfig({}, amb)).join('\n'), /versao: campo obrigatório/);
  assert.match(erros(() => validarConfig({ versao: 1, mundo: { fuso: 'Lugar/Nenhum' } }, amb)).join('\n'), /mundo\.fuso: fuso desconhecido/);
  assert.match(erros(() => validarConfig([], amb)).join('\n'), /bloco de chaves/);
});

test('chave desconhecida vira aviso, não erro', () => {
  const { avisos } = validarConfig({ versao: 1, salas: { pastasAgregadora: ['~/x'] }, extra: true }, amb);
  assert.ok(avisos.some((a) => a.includes('salas: chave desconhecida ignorada (pastasAgregadora)')), avisos.join('; '));
  assert.ok(avisos.some((a) => a.includes('(raiz): chave desconhecida ignorada (extra)')), avisos.join('; '));
});

test('YAML quebrado diz linha e coluna', () => {
  const texto = erros(() => carregarConfig({ amb, argumento: 'x.yaml', existe: () => true, ler: () => 'versao: 1\nalas:\n  - id: a\n   nome: errado' })).join('\n');
  assert.match(texto, /não é um YAML válido \(linha \d+, coluna \d+\)/);
  assert.match(erros(() => carregarConfig({ amb, argumento: 'x.yaml', existe: () => true, ler: () => '  \n' })).join('\n'), /vazia/);
});

test('ordem de procura: --config, ARCADIA_CONFIG e pasta do usuário; sem nenhuma, recusa (o exemplo nunca entra no lugar)', () => {
  const raizRepo = 'C:\\repo';
  const doUsuario = path.join(amb.casa, '.arcadia', 'arcadia.config.yaml');
  const existe = (p: string) => [doUsuario, path.resolve('C:\\repo', 'meu.yaml'), 'D:\\cfg\\outra.yaml'].includes(p);
  assert.equal(localizarConfig({ amb, raizRepo, existe, argumento: 'meu.yaml' }).origem, 'argumento');
  const comVariavel = { ...amb, variaveis: { ...amb.variaveis, ARCADIA_CONFIG: 'D:\\cfg\\outra.yaml' } };
  assert.equal(localizarConfig({ amb: comVariavel, raizRepo, existe }).origem, 'variavel');
  assert.deepEqual(localizarConfig({ amb, raizRepo, existe }), { arquivo: doUsuario, origem: 'usuario' });
  const nada = erros(() => localizarConfig({ amb, raizRepo, existe: () => false })).join('\n');
  assert.match(nada, /^Nenhuma configuração encontrada/);
  assert.ok(nada.includes('%USERPROFILE%\\.arcadia\\arcadia.config.yaml') && nada.includes('--config'), nada);
  // O exemplo do repositório não vale nem indicado de propósito: por --config (com outra caixa ou com ..) ou ARCADIA_CONFIG.
  const sempre = () => true;
  for (const argumento of ['config/arcadia.config.exemplo.yaml', 'C:\\REPO\\Config\\Arcadia.Config.Exemplo.yaml', 'C:\\repo\\config\\..\\config\\arcadia.config.exemplo.yaml']) {
    assert.match(erros(() => localizarConfig({ amb, raizRepo, existe: sempre, argumento })).join('\n'), /não vale como configuração de execução/, argumento);
  }
  const variavelNoExemplo = { ...amb, variaveis: { ...amb.variaveis, ARCADIA_CONFIG: 'C:\\repo\\config\\arcadia.config.exemplo.yaml' } };
  assert.match(erros(() => localizarConfig({ amb: variavelNoExemplo, raizRepo, existe: sempre })).join('\n'), /não vale como configuração de execução/);
  const msg = erros(() => localizarConfig({ amb, raizRepo, existe: () => false, argumento: 'C:\\Users\\teste\\sumiu.yaml' })).join('\n');
  assert.match(msg, /não existe: %USERPROFILE%\\sumiu\.yaml/);
  assert.ok(!msg.includes('C:\\Users\\teste'), 'a mensagem não mostra a pasta pessoal');
});

test('pasta de dados: falha fechada sem LOCALAPPDATA e nunca dentro das pastas dos agentes', () => {
  const semLocal = { ...amb, variaveis: { USERPROFILE: 'C:\\Users\\teste' } };
  assert.match(erros(() => validarConfig({ versao: 1 }, semLocal)).join('\n'), /LOCALAPPDATA não existe/);
  const naRede = { ...amb, variaveis: { LOCALAPPDATA: '\\\\servidor\\perfis\\teste' } };
  assert.match(erros(() => validarConfig({ versao: 1 }, naRede)).join('\n'), /aponta para a rede/);
  // LOCALAPPDATA trocada para dentro da pasta do Claude: os dados iriam parar lá.
  const desviada = { ...amb, variaveis: { LOCALAPPDATA: 'C:\\Users\\teste\\.claude' } };
  assert.match(erros(() => validarConfig({ versao: 1 }, desviada)).join('\n'), /não pode ficar dentro das pastas dos agentes/);
  assert.match(erros(() => validarConfig({ versao: 1, servidor: { dados: '~/.codex/arcadia' } }, amb)).join('\n'), /servidor\.dados/);
});

test('pasta de dados de teste: subpasta de %TEMP% vale; a própria %TEMP%, outra pasta qualquer e a rede, não', () => {
  for (const dados of ['%TEMP%/arcadia-fase3/dados', 'C:\\Users\\teste\\AppData\\Local\\Temp\\x', '%LOCALAPPDATA%/Arcadia/dados']) {
    assert.doesNotThrow(() => validarConfig({ versao: 1, servidor: { dados } }, amb), dados);
  }
  for (const dados of ['%TEMP%', 'C:\\Users\\teste\\Documentos\\arcadia', 'D:\\dados', '\\\\servidor\\temp\\arcadia']) {
    assert.match(erros(() => validarConfig({ versao: 1, servidor: { dados } }, amb)).join('\n'), /servidor\.dados: os dados do Arcadia ficam só dentro de %LOCALAPPDATA%\/Arcadia/, dados);
  }
  // %TEMP% apontando para a rede não abre exceção nenhuma.
  const tempNaRede = { ...amb, variaveis: { ...amb.variaveis, TEMP: '\\\\servidor\\temp' } };
  assert.match(erros(() => validarConfig({ versao: 1, servidor: { dados: '%TEMP%/arcadia' } }, tempNaRede)).join('\n'), /servidor\.dados/);
});

test('simulador nunca grava na pasta de dados real: com a configuração apontando para lá, vai para uma pasta própria na %TEMP%', () => {
  const real = validarConfig({ versao: 1 }, amb).config;
  assert.equal(pastaDeDados(real, amb, false), 'C:\\Users\\teste\\AppData\\Local\\Arcadia\\dados');
  assert.equal(pastaDeDados(real, amb, true), 'C:\\Users\\teste\\AppData\\Local\\Temp\\arcadia-simulador');
  const dentroDaReal = validarConfig({ versao: 1, servidor: { dados: '%LOCALAPPDATA%/Arcadia/outra' } }, amb).config;
  assert.equal(pastaDeDados(dentroDaReal, amb, true), 'C:\\Users\\teste\\AppData\\Local\\Temp\\arcadia-simulador');
  const deTeste = validarConfig({ versao: 1, servidor: { dados: '%TEMP%/arcadia-fase3/dados' } }, amb).config;
  assert.equal(pastaDeDados(deTeste, amb, true), 'C:\\Users\\teste\\AppData\\Local\\Temp\\arcadia-fase3\\dados', 'configuração de teste fica como está');
  assert.equal(pastaDeDados(deTeste, amb, false), 'C:\\Users\\teste\\AppData\\Local\\Temp\\arcadia-fase3\\dados');
});

test('pacote local: pasta ou arquivo .json, relativo à raiz do repositório; caminho de rede e variável desconhecida ficam de fora', () => {
  const cfg = (pacoteLocal?: string) => validarConfig({ versao: 1, ...(pacoteLocal !== undefined ? { personagens: { pacoteLocal } } : {}) }, amb);
  const raiz = 'C:\\repo';
  assert.equal(arquivoDoPacoteLocal(cfg().config, amb, raiz), undefined);
  assert.equal(arquivoDoPacoteLocal(cfg('  ').config, amb, raiz), undefined);
  assert.equal(arquivoDoPacoteLocal(cfg('%USERPROFILE%/.arcadia/personagens').config, amb, raiz), 'C:\\Users\\teste\\.arcadia\\personagens\\personagens.json');
  assert.equal(arquivoDoPacoteLocal(cfg('docs/local/fase3/personagens').config, amb, raiz), 'C:\\repo\\docs\\local\\fase3\\personagens\\personagens.json');
  assert.equal(arquivoDoPacoteLocal(cfg('~/meus/pacote.json').config, amb, raiz), 'C:\\Users\\teste\\meus\\pacote.json');
  assert.deepEqual(cfg('%USERPROFILE%/.arcadia/personagens').avisos, []);
  const casos: [string, RegExp][] = [
    // Host com o domínio reservado .invalid: mesmo que a guarda falhasse, nenhum nome resolveria na rede.
    ['\\\\servidor.invalid\\pacotes', /^personagens\.pacoteLocal: caminho de rede não é lido/],
    ['//servidor.invalid/pacotes/personagens.json', /^personagens\.pacoteLocal: caminho de rede não é lido/],
    ['%NAO_EXISTE%/personagens', /^personagens\.pacoteLocal: usa variável de ambiente desconhecida/],
  ];
  for (const [valor, aviso] of casos) {
    const r = cfg(valor);
    assert.equal(arquivoDoPacoteLocal(r.config, amb, raiz), undefined, valor);
    assert.ok(r.avisos.some((a) => aviso.test(a)), `${valor}: ${r.avisos.join('; ')}`);
    assert.ok(!r.avisos.join('\n').includes('servidor') && !r.avisos.join('\n').includes('NAO_EXISTE'), 'o aviso não repete o caminho');
  }
});

test('id de ala reservado (nome de propriedade do Object) é recusado', () => {
  const lista = erros(() => validarConfig({ versao: 1, alas: [{ id: 'constructor', nome: 'X', cor: '#000000' }] }, amb)).join('\n');
  assert.match(lista, /alas\[0\]\.id: "constructor" é um nome reservado/);
});

test('chave desconhecida que não é nome simples não se repete no aviso nem no caminho do problema', () => {
  const { avisos } = validarConfig({ versao: 1, salas: { 'C:/Users/teste/Clientes/Acme Ltda/prontuarios': 'Acme', extra: 1 } }, amb);
  const texto = avisos.join('\n');
  assert.ok(texto.includes('salas: chave desconhecida ignorada (extra, 1 com nome que não é simples, que não repito aqui)'), texto);
  assert.ok(!texto.includes('Acme Ltda') && !texto.includes('C:/Users'), texto);
  const problema = erros(() => validarConfig({ versao: 1, salas: { apelidos: { 'C:/Users/teste/Clientes/Acme Ltda': 'x'.repeat(60) } } }, amb)).join('\n');
  assert.match(problema, /salas\.apelidos\.\[chave\]: pode ter no máximo 48/);
  assert.ok(!problema.includes('Acme Ltda'), problema);
});

test('tema da ala: opcional, da lista; tema desconhecido é erro com a lista', () => {
  const ala = (extra: Record<string, unknown>) => ({ versao: 1, alas: [{ id: 'produtos', nome: 'Produtos', cor: '#c9a7ff', ...extra }] });
  assert.equal(validarConfig(ala({}), amb).config.alas[0]?.tema, undefined);
  for (const tema of ['equipe', 'agencia', 'estudio', 'corporativo', 'laboratorio', 'pessoal', 'bastidores', 'produtos', 'academia']) {
    assert.equal(validarConfig(ala({ tema }), amb).config.alas[0]?.tema, tema);
  }
  const msg = erros(() => validarConfig(ala({ tema: 'castelo' }), amb)).join('\n');
  assert.ok(msg.includes('alas[0].tema: tema desconhecido; use um destes: equipe, agencia, estudio, corporativo, laboratorio, pessoal, bastidores, produtos, academia'), msg);
  assert.ok(!msg.includes('castelo'), 'o valor errado não se repete');
  assert.match(erros(() => validarConfig(ala({ tema: 3 }), amb)).join('\n'), /alas\[0\]\.tema: tema desconhecido/);
});
