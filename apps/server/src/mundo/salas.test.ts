// Testes da resolução de sala e do glob. Pastas e nomes inventados; sistema de arquivos falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarResolvedor, type ConfigSalas, type ResultadoSala } from './salas.ts';
import { compilarGlob } from '../util/glob.ts';
import { normalizar, type AmbienteCaminhos } from '../util/caminhos.ts';

const amb: AmbienteCaminhos = {
  casa: 'C:\\Users\\Teste',
  variaveis: { LOCALAPPDATA: 'C:\\Users\\Teste\\AppData\\Local', TEMP: 'C:\\Users\\Teste\\AppData\\Local\\Temp' },
  windows: true,
  cwd: 'C:\\',
};

const cfg: ConfigSalas = {
  alas: [
    { id: 'produtos', regras: ['~/projetos/produto-*/**'] },
    { id: 'estudio', regras: ['~/videos/**'], tipo: 'video' },
    { id: 'trabalho', regras: ['D:/empresa/**'] },
    { id: 'bastidores', regras: ['~', 'C:/', '%TEMP%/**', '~/projetos'] },
  ],
  recepcaoId: 'recepcao',
  pastasAgregadoras: ['~/projetos', '~/videos', 'D:\\empresa'],
  excluir: ['**/senhas/**', '~/Documentos/Pessoal/**', '**/*recovery*'],
  apelidos: { '~/projetos/produto-alfa': 'Alfa' },
};

function fsFalso(existentes: string[]) {
  const conjunto = new Set(existentes.map((p) => normalizar(p, amb)));
  let chamadas = 0;
  return {
    existe(p: string) {
      chamadas++;
      return conjunto.has(normalizar(p, amb));
    },
    chamadas: () => chamadas,
  };
}

const ARQUIVOS = [
  '~/projetos/produto-beta/.git',
  '~/projetos/produto-beta/vite.config.ts',
  '~/projetos/produto-alfa/.git',
  'D:/empresa/sistema-x/.git',
];

function resolvedor(existentes = ARQUIVOS, sal = 'sal-teste') {
  const sfs = fsFalso(existentes);
  return { r: criarResolvedor(cfg, { sal, amb, fs: sfs }), sfs };
}

function sala(r: ResultadoSala) {
  assert.equal(r.tipo, 'sala');
  if (r.tipo !== 'sala') throw new Error('não é sala');
  return r;
}

test('glob: ** casa zero ou mais pastas, * e ? não atravessam a barra, sem diferenciar maiúsculas', () => {
  const g = (p: string) => compilarGlob(p, amb);
  const c = (s: string) => normalizar(s, amb);
  assert.ok(g('~/projetos/produto-*/**').testar(c('~/projetos/produto-x')));
  assert.ok(g('~/projetos/produto-*/**').testar(c('~/Projetos/PRODUTO-X/src/a.ts')));
  assert.ok(!g('~/projetos/produto-*/**').testar(c('~/projetos/outro')));
  assert.ok(g('**/senhas/**').testar(c('D:/a/senhas')));
  assert.ok(g('**/senhas/**').testar(c('D:/a/senhas/b/c.txt')));
  assert.ok(!g('**/senhas/**').testar(c('D:/a/senhas-velhas')));
  assert.ok(g('~').testar(c('~')) && !g('~').testar(c('~/x')));
  assert.ok(g('C:/').testar(c('C:\\')));
  assert.ok(g('%TEMP%/**').testar(c('%TEMP%/claude/x')));
  assert.ok(g('senhas').testar(c('D:/qualquer/senhas')), 'padrão relativo vale em qualquer profundidade');
  assert.ok(g('a?c').testar(c('D:/x/abc')) && !g('a?c').testar(c('D:/x/a/c')));
  assert.ok(g('~/Mídias videos IA/**').testar(c('~/mídias videos ia/corte 1')));
});

test('raiz git vira a sala, com o nome da pasta como estava escrito', () => {
  const { r } = resolvedor();
  const s = sala(r.resolver('C:\\Users\\Teste\\Projetos\\Produto-Beta\\src\\lib'));
  assert.equal(s.raiz, 'c:/users/teste/projetos/produto-beta');
  assert.equal(s.nome, 'Produto-Beta');
  assert.equal(s.ala, 'produtos');
  assert.equal(s.tipoSala, 'web');
  assert.match(s.chave, /^s[a-p]{15}$/);
});

test('maiúsculas e barras não mudam a chave', () => {
  const { r } = resolvedor();
  const a = sala(r.resolver('c:/users/teste/projetos/produto-beta'));
  const b = sala(r.resolver('C:\\USERS\\TESTE\\PROJETOS\\PRODUTO-BETA\\'));
  assert.equal(a.chave, b.chave);
  const outroSal = sala(resolvedor(ARQUIVOS, 'outro-sal').r.resolver('c:/users/teste/projetos/produto-beta'));
  assert.notEqual(outroSal.chave, a.chave, 'o sal muda a chave: ninguém adivinha o caminho pelo hash');
});

test('sem git: subpasta de primeiro nível da agregadora, ou a própria agregadora', () => {
  const { r } = resolvedor();
  const s = sala(r.resolver('~/projetos/site-solto/paginas/inicio'));
  assert.equal(s.raiz, 'c:/users/teste/projetos/site-solto');
  assert.equal(s.nome, 'site-solto');
  assert.equal(s.ala, 'recepcao', 'sem regra, a sala espera na Recepção');
  const raiz = sala(r.resolver('~/projetos'));
  assert.equal(raiz.raiz, 'c:/users/teste/projetos');
  assert.equal(raiz.ala, 'bastidores');
  const trab = sala(r.resolver('D:\\empresa\\sistema-x\\modulo'));
  assert.equal(trab.nome, 'sistema-x');
  assert.equal(trab.ala, 'trabalho');
});

test('git na agregadora ou na pasta pessoal não engole os projetos', () => {
  const { r } = resolvedor([...ARQUIVOS, '~/projetos/.git', '~/.git']);
  const s = sala(r.resolver('~/projetos/produto-gama/x'));
  assert.equal(s.raiz, 'c:/users/teste/projetos/produto-gama');
  const solto = sala(r.resolver('~/scripts/utilidades'));
  assert.equal(solto.raiz, 'c:/users/teste/scripts/utilidades', 'repositório de dotfiles na pasta pessoal é ignorado');
});

test('sem git e sem agregadora: a própria pasta', () => {
  const { r } = resolvedor();
  const s = sala(r.resolver('E:\\coisas\\avulsas'));
  assert.equal(s.raiz, 'e:/coisas/avulsas');
  assert.equal(s.nome, 'avulsas');
  assert.equal(s.ala, 'recepcao');
});

test('lista de exclusão: nunca vira sala', () => {
  const { r } = resolvedor();
  assert.deepEqual(r.resolver('~/projetos/produto-alfa/senhas/cofre'), { tipo: 'excluida' });
  assert.deepEqual(r.resolver('C:\\Users\\Teste\\Documentos\\Pessoal\\a'), { tipo: 'excluida' });
  assert.ok(r.excluido('~/projetos/x/ngrok_recovery_codes.txt'));
  assert.ok(!r.excluido('~/projetos/x/app.ts'));
});

test('pasta privada de tarefa do OpenMausBot fica para o adaptador do OMB', () => {
  const { r } = resolvedor();
  assert.deepEqual(r.resolver('~/.openmausbot/task-workspaces/bot-1/thread-9/sub'), { tipo: 'omb-privada', botId: 'bot-1', threadId: 'thread-9' });
});

test('apelido, pasta pessoal, raiz do disco, pasta temporária e tipo pela ala', () => {
  const { r } = resolvedor();
  assert.equal(sala(r.resolver('~/projetos/produto-alfa/src')).nome, 'Alfa');
  const casa = sala(r.resolver('~'));
  assert.deepEqual([casa.nome, casa.ala, casa.tipoSala], ['Pasta pessoal', 'bastidores', 'outro']);
  const disco = sala(r.resolver('C:\\'));
  assert.deepEqual([disco.nome, disco.ala], ['Disco C', 'bastidores']);
  const temp = sala(r.resolver('%TEMP%\\claude\\abc\\rascunho'));
  assert.deepEqual([temp.nome, temp.ala], ['rascunho', 'bastidores']);
  const video = sala(r.resolver('~/videos/corte-de-outubro/render'));
  assert.deepEqual([video.nome, video.ala, video.tipoSala], ['corte-de-outubro', 'estudio', 'video']);
});

test('cache: o mesmo caminho não volta ao disco', () => {
  const { r, sfs } = resolvedor();
  r.resolver('~/projetos/produto-beta/src');
  const depoisDaPrimeira = sfs.chamadas();
  r.resolver('~/projetos/produto-beta/src');
  assert.equal(sfs.chamadas(), depoisDaPrimeira);
});

/** Sistema de arquivos espião: registra cada pergunta (e responde que nada existe). */
function espiao() {
  const perguntas: string[] = [];
  return { perguntas, fs: { existe: (p: string) => (perguntas.push(p), false) } };
}

test('pasta de rede, de dispositivo e do WSL: sala fixa, nenhum acesso ao disco, nenhum nome do caminho', () => {
  const { perguntas, fs } = espiao();
  const r = criarResolvedor(cfg, { sal: 's', amb, fs });
  const remotos = [
    '\\\\servidor-externo.exemplo\\publico\\leia.txt',
    '//servidor-externo.exemplo/publico/pasta',
    '\\\\?\\UNC\\servidor\\compartilhado\\x',
    '\\\\.\\pipe\\algum-cano',
    '\\\\?\\C:\\Users\\Teste\\projetos\\x',
    '\\\\wsl$\\Ubuntu\\home\\teste\\app',
    '\\\\wsl.localhost\\Ubuntu\\home\\teste\\app',
    '/\\servidor/misturado',
  ];
  const chaves = new Set<string>();
  for (const p of remotos) {
    const s = sala(r.resolver(p));
    assert.equal(s.nome, 'Pasta de rede', p);
    assert.equal(s.ala, 'bastidores', 'fica na ala da pasta pessoal');
    chaves.add(s.chave);
  }
  assert.equal(chaves.size, 1, 'uma sala só para tudo o que é de rede');
  assert.deepEqual(perguntas, [], 'nenhuma pergunta ao disco');
});

test('o disco só é consultado dentro de raízes conhecidas, e a busca de .git não passa delas', () => {
  const { perguntas, fs } = espiao();
  const semRaizDeDisco: ConfigSalas = { ...cfg, alas: cfg.alas.map((a) => ({ ...a, regras: a.regras.filter((x) => x !== 'C:/') })) };
  const r = criarResolvedor(semRaizDeDisco, { sal: 's', amb, fs });
  const fora = sala(r.resolver('E:\\coisas\\repo\\src'));
  assert.equal(fora.nome, 'src', 'fora das raízes conhecidas: a própria pasta, sem procurar .git');
  assert.deepEqual(perguntas, []);
  r.resolver('C:\\Users\\Teste\\scripts\\utilidades');
  assert.ok(perguntas.length > 0, 'dentro da pasta pessoal procura');
  for (const p of perguntas) assert.ok(normalizar(p, amb).startsWith('c:/users/teste/'), `perguntou fora da casa: ${p}`);
});

test('pastas dos agentes e dados do Arcadia viram salas fixas, sem nome vindo do caminho', () => {
  const { perguntas, fs } = espiao();
  const r = criarResolvedor({ ...cfg, pastasDosAgentes: ['D:/fontes/claude'] }, { sal: 's', amb, fs });
  const agentes = [
    'C:\\Users\\Teste\\.claude\\projects\\C--Users-Teste-Clientes-Acme-Saude-prontuarios',
    '~/.codex/sessions/2026/10/22',
    '~/.openmausbot/bots/x',
    'D:\\fontes\\claude\\C--x',
  ];
  for (const p of agentes) assert.equal(sala(r.resolver(p)).nome, 'Arquivos dos agentes', p);
  for (const p of ['%LOCALAPPDATA%\\Arcadia\\dados', '~/.arcadia/personagens']) assert.equal(sala(r.resolver(p)).nome, 'Dados do Arcadia', p);
  assert.deepEqual(r.resolver('~/.openmausbot/task-workspaces/bot-1/t-1'), { tipo: 'omb-privada', botId: 'bot-1', threadId: 't-1' }, 'pasta privada de tarefa segue com o OMB');
  assert.deepEqual(perguntas, []);
});

test('exclusão sem /** vale também para as subpastas', () => {
  const r = criarResolvedor({ ...cfg, excluir: ['~/Documentos/Diario', 'D:/clientes/acme'] }, { sal: 's', amb, fs: { existe: () => false } });
  assert.deepEqual(r.resolver('~/Documentos/Diario'), { tipo: 'excluida' });
  assert.deepEqual(r.resolver('~/Documentos/Diario/2026/outubro'), { tipo: 'excluida' });
  assert.ok(r.excluido('D:\\clientes\\acme\\contratos\\a.pdf'));
  assert.ok(!r.excluido('~/Documentos/Diario-de-bordo'), 'só a pasta e o que fica dentro dela');
});

test('sonda assíncrona: responde pendente, termina sem travar e a resposta fica no cache', { timeout: 20_000 }, async () => {
  const perguntas: string[] = [];
  const existentes = new Set([normalizar('~/projetos/produto-beta/.git', amb), normalizar('~/projetos/produto-beta/vite.config.ts', amb)]);
  const r = criarResolvedor(cfg, {
    sal: 's',
    amb,
    fs: {
      existe: (p: string) => {
        perguntas.push(p);
        return new Promise<boolean>((ok) => setTimeout(() => ok(existentes.has(normalizar(p, amb))), 5));
      },
    },
  });
  const primeira = r.resolver('~/projetos/produto-beta/src/lib');
  assert.equal(primeira.tipo, 'pendente');
  let voltas = 0;
  let resultado: ResultadoSala = primeira;
  while (resultado.tipo === 'pendente' && voltas++ < 5) {
    await resultado.pronto;
    resultado = r.resolver('~/projetos/produto-beta/src/lib');
  }
  const s = sala(resultado);
  assert.equal(s.nome, 'produto-beta');
  assert.equal(s.tipoSala, 'web');
  const antes = perguntas.length;
  assert.equal(r.resolver('~/projetos/produto-beta/src/lib').tipo, 'sala', 'do cache, sem esperar');
  assert.equal(perguntas.length, antes);
});

test('caches com teto', () => {
  const r = criarResolvedor(cfg, { sal: 's', amb, fs: { existe: () => false }, limiteCache: 50 });
  for (let i = 0; i < 400; i++) r.resolver(`~/projetos/produto-${i}/src`);
  const t = r.tamanhoDosCaches();
  assert.ok(t.resultados <= 50 && t.sondas <= 200 && t.tipos <= 50, JSON.stringify(t));
});

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('fora das raízes conhecidas: a sala sai marcada (o núcleo só a aceita para o cwd) e o disco não é consultado', () => {
  const { perguntas, fs } = espiao();
  const r = criarResolvedor(cfg, { sal: 's', amb, fs });
  const fora = sala(r.resolver('F:\\trabalho\\app\\src\\components'));
  assert.equal(fora.foraDasRaizes, true);
  assert.equal(fora.nome, 'components');
  assert.equal(sala(r.resolver('~/projetos/site-solto/paginas')).foraDasRaizes, undefined, 'dentro da agregadora');
  assert.equal(sala(r.resolver('D:\\empresa\\sistema-x')).foraDasRaizes, undefined, 'dentro de uma regra de ala');
  assert.deepEqual(perguntas.filter((p) => normalizar(p, amb).startsWith('f:')), [], 'nada perguntado fora das raízes');
});

test('disco lento: sem resposta no prazo a sonda fica desconhecida (nunca "não existe"), a raiz para de ser sondada e a resposta atrasada vale', { timeout: 20_000 }, async () => {
  const atrasadas: ((v: boolean) => void)[] = [];
  const perguntas: string[] = [];
  const r = criarResolvedor(cfg, {
    sal: 's',
    amb,
    tempoMaxSondaMs: 40,
    lentaPorMs: 300,
    fs: {
      existe: (p: string) => {
        perguntas.push(p);
        if (normalizar(p, amb).endsWith('/produto-beta/.git')) return new Promise<boolean>((ok) => atrasadas.push(ok));
        return false;
      },
    },
  });
  const primeira = r.resolver('~/projetos/produto-beta/src/componentes');
  assert.equal(primeira.tipo, 'pendente');
  if (primeira.tipo === 'pendente') await primeira.pronto;
  assert.deepEqual(r.resolver('~/projetos/produto-beta/src/componentes'), { tipo: 'desconhecida' }, 'sem resposta: sem sala (a pasta "componentes" seria a sala errada)');
  const antes = perguntas.length;
  assert.deepEqual(r.resolver('~/projetos/produto-beta/src/servicos'), { tipo: 'desconhecida' }, 'raiz lenta: nem pergunta');
  assert.equal(perguntas.length, antes, 'a raiz marcada como lenta não é sondada');
  assert.equal(r.sondasAgora().lentas, 1);
  // O disco responde, atrasado: a resposta vai para o cache. Passado o tempo de raiz lenta, a sala certa aparece.
  for (const ok of atrasadas) ok(true);
  await dormir(350);
  let s = r.resolver('~/projetos/produto-beta/src/servicos');
  for (let i = 0; i < 10 && s.tipo === 'pendente'; i++) {
    await s.pronto;
    s = r.resolver('~/projetos/produto-beta/src/servicos');
  }
  assert.equal(sala(s).nome, 'produto-beta');
  assert.equal(r.sondasAgora().lentas, 0);
});

test('prazo estourado fica "desconhecida" no cache mesmo sem raiz lenta (com "não existe", a sala sairia sem o .git)', { timeout: 20_000 }, async () => {
  const r = criarResolvedor(cfg, {
    sal: 's',
    amb,
    tempoMaxSondaMs: 30,
    lentaPorMs: 0,
    fs: { existe: (p: string) => (normalizar(p, amb).endsWith('/produto-delta/.git') ? new Promise<boolean>(() => {}) : false) },
  });
  let s = r.resolver('~/projetos/produto-delta/src/componentes');
  for (let i = 0; i < 5 && s.tipo === 'pendente'; i++) {
    await s.pronto;
    s = r.resolver('~/projetos/produto-delta/src/componentes');
  }
  assert.deepEqual(s, { tipo: 'desconhecida' });
  assert.equal(r.sondasAgora().lentas, 0, 'raiz lenta desligada neste teste: quem segura a sala é só a resposta desconhecida');
});

test('erro do disco (sem permissão) deixa a sonda desconhecida, nunca "não existe"', { timeout: 20_000 }, async () => {
  const r = criarResolvedor(cfg, {
    sal: 's',
    amb,
    fs: { existe: (p: string) => (normalizar(p, amb).endsWith('/produto-gama/.git') ? Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' })) : false) },
  });
  let s = r.resolver('~/projetos/produto-gama/src');
  for (let i = 0; i < 5 && s.tipo === 'pendente'; i++) {
    await s.pronto;
    s = r.resolver('~/projetos/produto-gama/src');
  }
  assert.deepEqual(s, { tipo: 'desconhecida' });
  assert.equal(r.sondasAgora().lentas, 0, 'respondeu rápido (com erro): a raiz não fica lenta');
});

test('sonda real: arquivo que não existe responde "não existe"; o prazo não é dela', async () => {
  const { sistemaArquivosReal } = await import('./salas.ts');
  const os = await import('node:os');
  const p = await import('node:path');
  assert.equal(await sistemaArquivosReal.existe(p.join(os.tmpdir(), `arcadia-nao-existe-${process.pid}`, '.git')), false);
  assert.equal(await sistemaArquivosReal.existe(os.tmpdir()), true);
  assert.equal(sistemaArquivosReal.existe('\\\\servidor\\x\\.git'), false, 'rede: nem pergunta');
});

test('no máximo duas perguntas ao disco ao mesmo tempo', { timeout: 20_000 }, async () => {
  let voando = 0;
  let pico = 0;
  const r = criarResolvedor(cfg, {
    sal: 's',
    amb,
    fs: {
      existe: () => {
        voando++;
        pico = Math.max(pico, voando);
        return new Promise<boolean>((ok) =>
          setTimeout(() => {
            voando--;
            ok(false);
          }, 2),
        );
      },
    },
  });
  const caminhos = Array.from({ length: 4 }, (_, i) => `~/projetos/produto-${i}/src`);
  for (let volta = 0; volta < 40; volta++) {
    const pendentes = caminhos.map((c) => r.resolver(c)).filter((x) => x.tipo === 'pendente');
    if (pendentes.length === 0) break;
    await Promise.all(pendentes.map((x) => (x.tipo === 'pendente' ? x.pronto : undefined)));
  }
  for (const c of caminhos) assert.equal(r.resolver(c).tipo, 'sala', c);
  assert.ok(pico <= 2, `pico de perguntas ao mesmo tempo: ${pico}`);
  assert.ok(pico >= 1);
});

test('origem da sala: git, filha de agregadora, apoio, raiz da agregadora, apelido, pasta comum, casa, disco e fixa', () => {
  const r = criarResolvedor(
    { ...cfg, pastasDeApoio: ['docs', 'tmp', 'Scripts'], apelidos: { ...cfg.apelidos, '~/ferramentas': 'Ferramentas' } },
    { sal: 's', amb, fs: fsFalso(ARQUIVOS) },
  );
  const origem = (p: string) => {
    const s = sala(r.resolver(p));
    return [s.nome, s.origem];
  };
  assert.deepEqual(origem('~/projetos/produto-beta/src'), ['produto-beta', 'git']);
  assert.deepEqual(origem('~/projetos/site-solto/paginas'), ['site-solto', 'projeto']);
  assert.deepEqual(origem('~/projetos/docs/manual'), ['projetos', 'apoio'], 'pasta de apoio conta para a agregadora');
  assert.deepEqual(origem('~/projetos/SCRIPTS'), ['projetos', 'apoio'], 'nome comparado sem diferenciar maiúsculas');
  assert.deepEqual(origem('~/projetos'), ['projetos', 'agregadora']);
  assert.deepEqual(origem('~/ferramentas/limpeza/v2'), ['Ferramentas', 'apelido'], 'dentro de uma raiz de apelido, a sala é a do apelido');
  assert.deepEqual(origem('~/Documentos/planilhas'), ['planilhas', 'pasta']);
  assert.deepEqual(origem('~'), ['Pasta pessoal', 'casa']);
  assert.deepEqual(origem('C:\\'), ['Disco C', 'disco']);
  assert.deepEqual(origem('~/.claude/projects/x'), ['Arquivos dos agentes', 'fixa']);
  // Repositório git com nome de pasta de apoio continua sendo projeto.
  const comGit = criarResolvedor({ ...cfg, pastasDeApoio: ['tools'] }, { sal: 's', amb, fs: fsFalso([...ARQUIVOS, '~/projetos/tools/.git']) });
  assert.equal(sala(comGit.resolver('~/projetos/tools/bin')).origem, 'git');
});

test('rascunho: o resolvedor diz se a pasta é de rascunho (variável que não existe fica de fora)', () => {
  const r = criarResolvedor({ ...cfg, rascunho: ['%TEMP%', '~/sandbox', '%NAO_EXISTE%/x'] }, { sal: 's', amb, fs: fsFalso([]) });
  assert.ok(r.ehRascunho('C:\\Users\\Teste\\AppData\\Local\\Temp\\claude\\abc'));
  assert.ok(r.ehRascunho('~/sandbox/testes/a'));
  assert.ok(!r.ehRascunho('~/projetos/produto-beta'));
  assert.ok(!r.ehRascunho('C:\\%NAO_EXISTE%\\x\\y'), 'variável desconhecida não vira pasta relativa');
  assert.ok(!r.ehRascunho('\\\\servidor\\Temp\\x'), 'rede nunca');
});
