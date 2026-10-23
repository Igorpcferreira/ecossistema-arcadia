// Testes do saneamento e da guarda da saída. Todos os dados são inventados.
// O oráculo dos testes de caminho e de segredo é o texto puro (o pedaço proibido não pode sobrar), e não o
// próprio detector: assim uma regex que falhe nos dois lados não passa despercebida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITES, MASCARA, detectarBruto, encontrarProblemas, identificadorProibido, inspecionarSaida, mascararSegredos, nomeCurtoDeArquivo,
  nomeDeFerramentaSeguro, protegerSaida, sanearEvento, sanearTexto, substituirCaminhos,
} from './saneamento.ts';

const cc = (...c: number[]) => String.fromCharCode(...c);
const cp = (...c: number[]) => String.fromCodePoint(...c);
/** Dígitos de largura total (U+FF10 em diante). */
const largo = (s: string) => [...s].map((c) => (/\d/.test(c) ? cc(0xff10 + Number(c)) : c)).join('');
/** Texto escondido em caracteres de etiqueta (U+E0000 em diante): invisível na tela. */
const etiquetas = (s: string) => [...s].map((c) => cp(0xe0000 + c.charCodeAt(0))).join('');

// Alguns tokens falsos são montados em partes: inteiros no código, o GitHub barra o push como segredo.
const SEGREDOS: Record<string, string> = {
  'chave sk': 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt',
  'chave sk de projeto': 'sk-proj-abcdefghijklmnop1234',
  'token do GitHub': 'ghp_abcdefghijklmnopqrstuvwxyz0123',
  'token fino do GitHub': 'github_pat_11ABCDEFG0123456789_abcdefghij',
  'token do GitLab': 'glpat-AbCdEfGhIjKlMnOpQrSt',
  'chave do Supabase em hex': 'sbp_' + '0123456789abcdef0123456789abcdef01234567',
  'token de bot do Discord': ['MTk4NjIyNDgzNDcxOTI1MjQ4', 'Cl2FMQ', 'ZnCjm1XVW7vRze4b7Cq4se7kKWs'].join('.'),
  'chave da AWS': 'AKIAABCDEFGHIJKLMNOP',
  'JWT': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSJ9.c2lnbmF0dXJh',
  'chave privada': '-----BEGIN PRIVATE KEY----- MIIEvQIBADANBg -----END PRIVATE KEY-----',
  'senha em atribuição': 'password=hunter2',
  'senha em português': 'senha: abacaxi123',
  'variável de senha': 'DB_PASSWORD=hunter2',
  'variável SMTP': 'SMTP_PASS=abacaxi',
  'variável de token': 'GITHUB_TOKEN=abc123xyz',
  'string de conexão': 'postgres://admin:segredo@db.exemplo.com:5432/app',
  'conexão ADO': 'Server=db.exemplo;Database=app;User Id=sa;Password=Abc123;',
  'e-mail': 'fulano.de.tal@exemplo.com.br',
  'e-mail com acento': 'joão.silva@empresa.com.br',
  'CPF formatado': '123.456.789-09',
  'CPF sem pontos': '12345678909',
  'CPF de largura total': largo('123.456.789-09'),
  'CNPJ formatado': '12.345.678/0001-95',
  'CNPJ sem pontos': '12345678000195',
  'telefone': '(62) 99876-5432',
  'telefone sem parênteses': '62 99876-5432',
  'cartão': '4111 1111 1111 1111',
  'Bearer': 'Bearer abcdefghijklmnop.qrstuv',
  'sessão do OpenMausBot': 'omb_sess_abcdefgh12345678',
  'Slack': 'xoxb-1234567890-abcdefghij',
  'Google': 'AIzaSyA1234567890abcdefghijklmnopqrstu',
  'token longo aleatório': 'Zx8Qp2Lm9Vt4Rk7Wn3Hs6Jd1Fg5Cb0Ya2Ue',
};

/** O miolo que não pode sobrar de cada segredo (sem o prefixo que já some com a máscara). */
function miolo(segredo: string): string[] {
  // Fica de fora a palavra que anuncia a senha (DB_PASSWORD=, senha:): ela continua no texto, só o valor some.
  const partes = segredo.normalize('NFKC').split(/[\s=:@/.,;()-]+/).filter((p) => p.length >= 4 && !/^(?:Server|Database|Bearer|PRIVATE|BEGIN|postgres)$/i.test(p) && !/pass|senha|token/i.test(p));
  return partes.length > 0 ? partes : [segredo];
}

for (const [nome, segredo] of Object.entries(SEGREDOS)) {
  test(`mascara ${nome}`, () => {
    const t = sanearTexto(`antes ${segredo}, depois`, 500);
    for (const m of miolo(segredo)) assert.ok(!t.includes(m), `sobrou "${m}" de ${nome}: ${t}`);
    const canonico = segredo.normalize('NFKC');
    assert.ok(!t.includes(canonico) && !t.includes(segredo), `sobrou o segredo inteiro: ${nome}`);
    const digitos = canonico.replace(/\D/g, '');
    if (digitos.length >= 8) assert.ok(!t.replace(/\D/g, '').includes(digitos.slice(0, 6)), `sobraram dígitos de ${nome}: ${t}`);
    assert.ok(t.includes(MASCARA), `não pôs a máscara: ${nome}`);
    assert.ok(t.startsWith('antes') && t.endsWith('depois'), t);
    assert.ok(encontrarProblemas(segredo.normalize('NFKC')).length > 0 || detectarBruto(segredo).length > 0, `nenhum detector viu: ${nome}`);
  });
}

test('invisível, seletor e pictograma no meio do token não salvam o segredo', () => {
  const vs16 = cc(0xfe0f);
  const zwsp = cc(0x200b);
  const zwj = cc(0x200d);
  const hifenMole = cc(0xad);
  const fogo = cp(0x1f525);
  const casos = [
    `deploy ghp_${vs16}abcdefghijklmnopqrstuvwxyz`,
    `deploy ghp_${fogo}abcdefghijklmnopqrstuvwxyz`,
    `chave sk-${vs16}ant-api03-AbCdEfGhIjKlMnOpQrSt`,
    `chave sk-ant-api03-AbCdEf${zwsp}GhIjKlMnOpQrSt`,
    `chave ghp_abcdefgh${zwj}ijklmnopqrstuvwxyz`,
    `chave ghp_abcdefgh${hifenMole}ijklmnopqrstuvwxyz`,
  ];
  for (const c of casos) {
    const t = sanearTexto(c, 200);
    assert.ok(!/abcdefgh|AbCdEf|ijklmnop/.test(t), `sobrou: ${JSON.stringify(t)}`);
    assert.ok(!/[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Extended_Pictographic}]/u.test(t), `invisível ou emoji na saída: ${JSON.stringify(t)}`);
  }
});

test('caracteres de etiqueta (U+E0000 a U+E007F) somem e não escondem segredo', () => {
  const t = sanearTexto(`Revisar login${etiquetas('sk-ant-api03-SEGREDO')}`, 120);
  assert.equal(t, 'Revisar login');
  const decodificado = [...t].map((c) => ((c.codePointAt(0) ?? 0) >= 0xe0000 ? String.fromCharCode((c.codePointAt(0) ?? 0) - 0xe0000) : '')).join('');
  assert.equal(decodificado, '');
});

test('não mascara texto comum', () => {
  const comuns = [
    'Corrigir o login do portal',
    'versão 2.1.296 do CLI',
    'task-force e risk-free',
    'reunião às 14:30 de 22/10/2026',
    '550e8400-e29b-41d4-a716-446655440000',
    'relatorio-de-vendas-do-mes-de-outubro-de-2026',
    'revisar e/ou corrigir o CI/CD a 80 km/h',
    'Plano de R$ 1.000/mês',
    'a'.repeat(30),
  ];
  for (const c of comuns) assert.equal(sanearTexto(c, 500), c, c);
});

test('caminho com espaço, barra normal, Unix, Git Bash e colado: nenhum pedaço da pasta sobra', () => {
  const casos: [string, string][] = [
    ['Ver C:\\Users\\Joao Silva\\Clientes\\Acme Ltda\\contrato.pdf hoje', 'Ver contrato.pdf hoje'],
    ['Ver C:/Users/Joao Silva/Clientes/Acme Ltda/contrato.pdf hoje', 'Ver contrato.pdf hoje'],
    ['Ver /home/joao silva/clientes/acme corp/contrato.pdf hoje', 'Ver contrato.pdf hoje'],
    ['Ver /c/Users/joao/Clientes/Acme/contrato.pdf hoje', 'Ver contrato.pdf hoje'],
    ['abrirC:/Users/joao/Clientes/Acme/contrato.pdf', 'abrircontrato.pdf'],
    ['C:\\Users\\fulano\\Pasta com espaco\\x.txt', 'x.txt'],
    ['Ver \\\\servidor\\Pasta Comum\\Acme Ltda\\dados.csv agora', 'Ver dados.csv agora'],
    ['Ver //servidor/Pasta Comum/Acme Ltda/dados.csv agora', 'Ver dados.csv agora'],
    ['Ver C:/Users/Joao Silva/Acme/a.txt em 22/10/2026', 'Ver a.txt em 22/10/2026'],
    ['Abrir C:/Users/Joao Silva/Acme Ltda/ agora', 'Abrir Acme Ltda agora'],
  ];
  for (const [entrada, esperado] of casos) {
    const t = sanearTexto(entrada, 200);
    assert.equal(t, esperado, entrada);
    for (const proibido of ['Joao', 'Silva', 'joao', 'Clientes', 'clientes', 'Pasta', 'servidor', 'Users', 'home']) {
      if (!esperado.includes(proibido)) assert.ok(!t.includes(proibido), `sobrou "${proibido}" em ${t}`);
    }
  }
  assert.equal(nomeCurtoDeArquivo('C:\\Users\\Joao Silva\\Clientes\\Acme Ltda\\contrato.pdf'), 'contrato.pdf');
});

test('troca caminho completo pelo nome curto e reduz qualquer trecho com barra', () => {
  assert.equal(substituirCaminhos('abri C:\\Users\\fulano\\proj\\arquivo.ts agora'), 'abri arquivo.ts agora');
  assert.equal(substituirCaminhos('C:/Users/fulano/proj/'), 'proj');
  assert.equal(substituirCaminhos('\\\\servidor\\pasta\\dados.csv'), 'dados.csv');
  assert.equal(substituirCaminhos('~/projetos/app/main.ts'), 'main.ts');
  assert.equal(substituirCaminhos('%USERPROFILE%\\Documents\\nota.md'), 'nota.md');
  assert.equal(substituirCaminhos('/home/fulano/app/index.ts'), 'index.ts');
  assert.equal(substituirCaminhos('file:///C:/Users/fulano/x.txt'), 'x.txt');
  // URL e caminho relativo também: sobra só o último pedaço (o domínio e as pastas podem ter nome de cliente).
  assert.equal(substituirCaminhos('ler https://exemplo.com/a/b'), 'ler b');
  assert.equal(substituirCaminhos('editar src/mundo/motor.ts'), 'editar motor.ts');
  // Data, fração e par curto ficam.
  assert.equal(substituirCaminhos('22/10/2026, 1/2 e e/ou'), '22/10/2026, 1/2 e e/ou');
});

test('remove controle, emoji e travessão e corta no limite', () => {
  const travessao = cc(0x2014);
  const emoji = cp(0x1f680);
  assert.equal(sanearTexto(`linha1\nlinha2\t${emoji} fim`, 100), 'linha1 linha2 fim');
  assert.equal(sanearTexto(`Arcadia ${travessao} Fase 2`, 100), 'Arcadia, Fase 2');
  const longo = sanearTexto('a'.repeat(50), 10);
  assert.equal(longo.length, 10);
  assert.ok(longo.endsWith('...'));
});

test('segredo maior que o limite não deixa pedaço', () => {
  const t = sanearTexto(`x ${SEGREDOS['chave sk']}`, 12);
  assert.ok(!t.includes('sk-ant'), t);
});

test('senha: só o valor (o primeiro termo, ou o texto entre aspas) some; a palavra e o resto ficam', () => {
  assert.equal(mascararSegredos('use password=abc, e siga'), `use password=${MASCARA}, e siga`);
  assert.equal(sanearTexto('password: minha senha forte', 100), `password: ${MASCARA} senha forte`);
  assert.equal(sanearTexto('DB_PASSWORD=hunter2 e SMTP_PASS=abacaxi', 100), `DB_PASSWORD=${MASCARA} e SMTP_PASS=${MASCARA}`);
  assert.equal(sanearTexto('token: "frase com espaço" aqui', 100), `token: ${MASCARA} aqui`);
  assert.equal(sanearTexto('Corrigir validação de senha: campo vazio', 100), `Corrigir validação de senha: ${MASCARA} vazio`);
  assert.equal(mascararSegredos(mascararSegredos('senha: x')), `senha: ${MASCARA}`, 'mascarar de novo não muda');
});

test('nome de ferramenta: só as conhecidas saem pelo nome', () => {
  assert.equal(nomeDeFerramentaSeguro('Read', 'ler'), 'Read');
  assert.equal(nomeDeFerramentaSeguro('apply_patch', 'editar'), 'apply_patch');
  assert.equal(nomeDeFerramentaSeguro('mcp__agents__coordinate_bots', 'delegar'), 'coordinate_bots');
  assert.equal(nomeDeFerramentaSeguro('mcp__crm-do-cliente__listar_leads', 'integracao'), 'MCP');
  assert.equal(nomeDeFerramentaSeguro('servidor__ferramenta', 'integracao'), 'MCP');
  assert.equal(nomeDeFerramentaSeguro('deploy_do_cliente_x', 'comando'), 'comando');
});

test('nome curto de arquivo', () => {
  assert.equal(nomeCurtoDeArquivo('C:\\Users\\fulano\\app\\src\\motor.ts'), 'motor.ts');
  assert.equal(nomeCurtoDeArquivo('/home/fulano/.env'), '.env');
  assert.equal(nomeCurtoDeArquivo('C:\\'), undefined);
  assert.equal(nomeCurtoDeArquivo('fulano@exemplo.com'), undefined);
});

test('guarda bruta: pega resto de caminho que as regex não pegam', () => {
  const resto = 'Joao Silva/Clientes/Acme Ltda/contrato.pdf';
  assert.deepEqual(encontrarProblemas(resto), [], 'as regex do saneamento não veem este resto (era o furo)');
  assert.ok(detectarBruto(resto).includes('barra'));
  const sujo = { agentes: { 'claude:a': { chave: 'claude:a', tarefa: `Revisar ${resto}` } } };
  const protegido = protegerSaida(sujo);
  assert.equal(protegido.agentes['claude:a']?.tarefa, MASCARA);
  for (const t of [
    'pasta\\com\\barra', 'fulano@exemplo.com', 'ligar (62)99876-5432', 'CPF 123.456.789-09', 'tok AbCdEfGhIjKlMnOpQrSt', 'chave ghp_abc', 'DB_PASSWORD=x',
    `oculto${cc(0x200b)}aqui`, 'https://exemplo.com', 'C:/x', '~/x', '%USERPROFILE%', 'sbp_0123456789abcdef',
  ]) {
    assert.ok(detectarBruto(t).length > 0, `a guarda bruta não viu: ${JSON.stringify(t)}`);
  }
  for (const t of [
    'Corrigir o login do portal', 'versão 2.1.296 do CLI', 'reunião às 14:30 de 22/10/2026', 'revisar e/ou corrigir o CI/CD',
    'Recepção', '2026-10-20', 'Arquivos dos agentes', 'MotorDoMundoService', 'ecossistema-arcadia', MASCARA,
    'Criar OAuth2PKCEFlowHandlerV2 no backend', 'Liberar portas 8799 18799 28799 no firewall', 'Release v2026.10.22 do app',
    'Ticket 123456789: corrigir cobrança', 'Rodar 100 200 300 testes', `senha: ${MASCARA} vazio`, 'Implementar SSE em /api/events',
  ]) {
    assert.deepEqual(detectarBruto(t), [], t);
  }
  // Identificador: UUID, hash e a data do dia passam; barra, arroba e segredo não.
  assert.deepEqual(detectarBruto('claude:550e8400-e29b-41d4-a716-446655440000', true), []);
  assert.deepEqual(detectarBruto('22/10/2026', true), []);
  assert.ok(detectarBruto('claude:a/b', true).length > 0);
  assert.ok(detectarBruto('claude:sk-ant-api03-x', true).length > 0);
});

function eventoBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: 'sim:teste:1',
    ts: 1000.7,
    recebidoEm: 1001,
    origem: 'sim',
    motor: 'claude',
    agente: { chave: 'sim:a1', tipo: 'sessao', nome: 'Unidade A1' },
    local: { projetoChave: 'sala-alfa', sala: { nome: 'Portal Alfa', ala: 'produtos', tipo: 'web' } },
    tipo: 'ferramenta.inicio',
    ferramenta: { nome: 'Edit', categoria: 'editar', alvo: 'C:\\Users\\fulano\\app\\motor.ts', id: 'toolu_1' },
    ...extra,
  };
}

test('sanearEvento descarta campos fora da allowlist e conta', () => {
  const bruto = eventoBase({
    prompt: 'texto do usuário',
    tool_input: { command: 'rm -rf /' },
    resposta: 'texto do modelo',
  });
  (bruto['ferramenta'] as Record<string, unknown>)['input'] = { file_path: 'C:\\x' };
  const r = sanearEvento(bruto);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.descartados, 4);
  const json = JSON.stringify(r.evento);
  for (const proibido of ['prompt', 'tool_input', 'resposta', 'rm -rf', 'texto do', 'fulano', '"input"']) {
    assert.ok(!json.includes(proibido), proibido);
  }
  assert.equal(r.evento.ts, 1000);
  assert.equal(r.evento.ferramenta?.alvo, undefined, 'alvo só sai quando a configuração permite');
});

test('sanearEvento mostra o nome curto quando permitido', () => {
  const r = sanearEvento(eventoBase(), { permitirAlvo: true });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.evento.ferramenta?.alvo, 'motor.ts');
});

test('sanearEvento mascara segredo em nome e título e respeita a opção de título', () => {
  const bruto = eventoBase({
    tipo: 'delegacao.enviada',
    ferramenta: undefined,
    agente: { chave: 'sim:a1', tipo: 'bot', nome: `Bot ${SEGREDOS['chave sk']}`, cor: 'purple', corpo: 'Cursor<script>' },
    delegacao: { de: 'sim:a1', para: 'sim:a2', titulo: 'Rodar em C:\\Users\\fulano\\x com password=abc123', status: 'running' },
  });
  delete bruto['ferramenta'];
  const r = sanearEvento(bruto);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.evento.agente.nome, `Bot ${MASCARA}`);
  assert.equal(r.evento.agente.cor, 'purple');
  assert.equal(r.evento.agente.corpo, undefined);
  assert.equal(r.evento.delegacao?.titulo, `Rodar em x com password=${MASCARA}`);
  assert.ok(r.mascarados >= 2);
  const semTitulo = sanearEvento(bruto, { permitirTitulo: false });
  assert.ok(semTitulo.ok);
  if (semTitulo.ok) assert.equal(semTitulo.evento.delegacao?.titulo, undefined);
});

test('sanearEvento recusa evento inválido sem ecoar valores', () => {
  const r = sanearEvento(eventoBase({ tipo: 'tipo-que-nao-existe-segredo', id: 'C:/caminho' }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  const texto = r.problemas.join(' ');
  assert.ok(texto.includes('tipo'));
  assert.ok(!texto.includes('segredo') && !texto.includes('caminho'), texto);
});

test('sanearEvento recusa identificador com segredo dentro ou com nome de propriedade do Object', () => {
  const r = sanearEvento(eventoBase({ agente: { chave: `claude:${SEGREDOS['chave sk']}`, tipo: 'sessao' } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(!r.problemas.join(' ').includes('sk-ant'));
  for (const reservado of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(identificadorProibido(reservado), true, reservado);
    assert.equal(sanearEvento(eventoBase({ agente: { chave: reservado, tipo: 'sessao' } })).ok, false, reservado);
    assert.equal(sanearEvento(eventoBase({ ferramenta: { nome: 'Read', categoria: 'ler', id: reservado } })).ok, false, reservado);
  }
  const uuid = sanearEvento(eventoBase({ agente: { chave: 'claude:550e8400-e29b-41d4-a716-446655440000', tipo: 'sessao' } }));
  assert.equal(uuid.ok, true, 'UUID comum continua valendo');
});

test('sanearEvento leva a marca de pasta excluída', () => {
  const r = sanearEvento(eventoBase({ local: { excluida: true } }));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.evento.local.excluida, true);
  const falso = sanearEvento(eventoBase({ local: { excluida: false } }));
  assert.equal(falso.ok, false, 'só true vale');
});

test('sanearEvento exige o campo de cada tipo', () => {
  const bruto = eventoBase();
  delete bruto['ferramenta'];
  assert.equal(sanearEvento(bruto).ok, false);
  assert.equal(sanearEvento(eventoBase({ tipo: 'espera.inicio' })).ok, false);
  assert.equal(sanearEvento(eventoBase({ tipo: 'espera.inicio', espera: { tipo: 'permissao' } })).ok, true);
  assert.equal(sanearEvento('não é objeto').ok, false);
});

test('inspecionarSaida acha texto proibido e ignora dígitos em identificadores', () => {
  const limpo = { agentes: { 'claude:550e8400-e29b-41d4-a716-12345678901f': { chave: 'claude:550e8400-e29b-41d4-a716-12345678901f', nome: 'Unidade' } }, metricas: { dia: '22/10/2026' } };
  assert.deepEqual(inspecionarSaida(limpo), []);
  assert.equal(protegerSaida(limpo), limpo, 'objeto limpo volta igual, sem cópia');
  const sujo = { salas: [{ nome: 'C:\\Users\\fulano\\proj' }, { nome: 'ok', titulo: 'ligar 12345678909' }] };
  const problemas = inspecionarSaida(sujo);
  assert.deepEqual([...new Set(problemas.map((p) => p.split(':')[0]))].sort(), ['salas[0].nome', 'salas[1].titulo']);
  const contador = { mascarados: 0 };
  const protegido = protegerSaida(sujo, contador);
  assert.equal(contador.mascarados, 2);
  assert.deepEqual(inspecionarSaida(protegido), []);
  assert.notEqual(protegido, sujo);
  // Chave __proto__ vira chave comum na cópia, sem trocar o protótipo.
  const comProto = JSON.parse('{"__proto__": {"nome": "C:/x/y"}}') as Record<string, unknown>;
  const copia = protegerSaida(comProto) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(copia), Object.prototype);
  assert.deepEqual(Object.keys(copia), ['__proto__']);
});

// Corpo de 40 títulos inventados (os do script 14 da revisão), com os dois lados: o que sai igual, o que sai só com
// o caminho reduzido ao último pedaço e o que tem que esconder. Meta: 90% das palavras ou mais e nenhum título
// legítimo trocado inteiro por [oculto].
const IGUAIS = [
  'Corrigir login do portal', 'Refatorar componente de cartão no app/mundo', 'Revisar PR #42 do servidor', 'Atualizar dependências do Vite para 7.0.2',
  'Implementar SSE em /api/events com retry', 'Ajustar rota /api/snapshot e /api/events', 'Configurar CI/CD no GitHub Actions', 'Criar teste e/ou mock para o OMB',
  'Investigar erro 500 no endpoint /saude', 'Gerar relatório de vendas 2025/2026', 'Reunião de 22/10/2026 às 14:30', 'Mover /api/x para /api/y e testar',
  'Adicionar suporte a input/output assíncrono', 'Testar portas 4780 e 47800', 'Liberar portas 8799 18799 28799 no firewall', 'Ticket 123456789: corrigir cobrança',
  'Release v2026.10.22 do app', 'Rodar 100 200 300 testes de carga', 'Criar OAuth2PKCEFlowHandlerV2 no backend', 'Corrigir bug no frontend/backend da API',
  'Implementar R$ 1.000/mês no plano', 'Planejar Fase 2: núcleo de dados', 'Separar pastas src/ e tests/', 'Medir 30/60 fps no celular', 'Ajustar timeout para 2.000 ms',
  'Refatorar Agent SDK v0.2.15', 'Estimar 12 34 5678 horas', 'Pagamento de R$ 49,90 no plano básico', 'Revisão de privacidade do servidor do Arcadia',
];
const SO_CAMINHO: [string, string][] = [
  ['Fix TypeScript errors in src/mundo/motor.ts', 'Fix TypeScript errors in motor.ts'],
  ['Mover docs/README.md para docs/guia/README.md', 'Mover README.md para README.md'],
  ['Abrir C:\\proj\\a.txt e depois revisar docs/README.md com o time', 'Abrir a.txt e depois revisar README.md com o time'],
  ['Ler C:\\docs\\a.txt e/ou b.txt', 'Ler a.txt e/ou b.txt'],
  ['Converter Node.js/TypeScript para ESM', 'Converter TypeScript para ESM'],
  ['Ler https://docs.exemplo.com/guia/instalacao', 'Ler instalacao'],
  ['Ajustar regra no .github/workflows/ci.yml', 'Ajustar regra no ci.yml'],
];
const ESCONDE: [string, string, string[]][] = [
  ['Ler C:\\Users\\Joao Silva\\Clientes\\Acme\\contrato.pdf e resumir para o time', 'Ler contrato.pdf e resumir para o time', ['Joao', 'Silva', 'Clientes', 'Acme', 'Users']],
  ['Corrigir validação de senha: campo vazio', `Corrigir validação de senha: ${MASCARA} vazio`, ['campo']],
  ['Fluxo de token: refresh automático no login', `Fluxo de token: ${MASCARA} automático no login`, ['refresh']],
  ['Investigar commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39', `Investigar commit ${MASCARA}`, ['3f2a9c1e']],
];

function saida(titulo: string): string {
  return (protegerSaida({ tarefa: sanearTexto(titulo, LIMITES.titulo) }) as { tarefa: string }).tarefa;
}

test('corpo de 40 títulos: o legítimo fica (ou só perde o caminho) e o segredo some', () => {
  assert.equal(IGUAIS.length + SO_CAMINHO.length + ESCONDE.length, 40);
  for (const t of IGUAIS) assert.equal(saida(t), t, t);
  for (const [t, esperado] of SO_CAMINHO) assert.equal(saida(t), esperado, t);
  for (const [t, esperado, proibidos] of ESCONDE) {
    const s = saida(t);
    assert.equal(s, esperado, t);
    for (const p of proibidos) assert.ok(!s.includes(p), `sobrou "${p}" em ${s}`);
  }
  let antes = 0;
  let mantidas = 0;
  for (const t of [...IGUAIS, ...SO_CAMINHO.map((x) => x[0]), ...ESCONDE.map((x) => x[0])]) {
    const s = saida(t);
    assert.notEqual(s, MASCARA, `título trocado inteiro: ${t}`);
    const original = t.split(/\s+/);
    const depois = s.split(/\s+/);
    antes += original.length;
    mantidas += original.filter((p) => depois.includes(p)).length;
  }
  assert.ok(mantidas / antes >= 0.9, `palavras mantidas: ${mantidas} de ${antes}`);
});

test('nomes de pasta e ordinais: CamelCase, versão, números e ª º ² ³ passam', () => {
  const nome = (n: string) => (protegerSaida({ salas: { s1: { nome: sanearTexto(n, LIMITES.sala) } } }) as { salas: { s1: { nome: string } } }).salas.s1.nome;
  for (const n of ['ControleDeEstoqueWPF', 'SistemaERPGestao', 'ProjetoFinal2026v2Backup', 'relatorio-12345678', 'ArcadiaServer2026Build', 'LandingPage2026Q4Final', 'app_v2_2026_10_22']) {
    assert.equal(nome(n), n, n);
  }
  // Muitos dígitos e trecho denso não valem para nome de sala (o nome da pasta); em outro campo, continuam valendo.
  for (const n of ['export-1729612345678', 'k8s-cluster-a1b2c3d4e5f6g7h8']) {
    assert.equal(nome(n), n, n);
    assert.equal(saida(n), MASCARA, `${n} como título`);
  }
  for (const t of ['Revisar 2ª etapa do contrato nº 5', 'Calcular área em m² do 1º andar', 'Volume de 3 m³']) assert.equal(saida(t), t, t);
  // Largura total ainda vira ASCII (e o CPF escondido assim continua pego).
  assert.equal(sanearTexto('ABC' + String.fromCharCode(0xff11, 0xff12), 50), 'ABC12');
});

test('caminho relativo com espaço: os termos entre dois pedaços com barra são do caminho (até 3), com as mesmas paradas', () => {
  assert.equal(sanearTexto('Ver Users/Joana Silva/Clientes Acme/x.pdf', 120), 'Ver x.pdf');
  assert.equal(sanearTexto('Revisar Documentos/Clientes Acme Ltda/contrato.pdf hoje', 120), 'Revisar contrato.pdf hoje');
  assert.equal(sanearTexto('Ver users/joana silva/clientes acme/x.pdf', 120), 'Ver x.pdf', 'par em minúsculas perto de outro pedaço vira caminho');
  // Paradas: nome de arquivo com extensão fecha o caminho; o resto da frase fica.
  assert.equal(sanearTexto('Abrir src/a.ts e depois revisar docs/b.md com o time', 120), 'Abrir a.ts e depois revisar b.md com o time');
  // Mais de três termos sem barra no meio: são dois caminhos, cada um vira o seu último pedaço.
  assert.equal(sanearTexto('Comparar Docs/Manual e mais coisas aqui Docs/Guias', 120), 'Comparar Manual e mais coisas aqui Guias');
  // Até três: um caminho só (o teto existe para não comer a frase inteira).
  assert.equal(sanearTexto('Comparar Docs/Manual e Docs/Guias', 120), 'Comparar Guias');
  // Par em minúsculas sozinho (docs/manual, input/output) e par curto (docs/a) ficam.
  assert.equal(sanearTexto('Ler docs/manual e docs/a', 120), 'Ler docs/manual e docs/a');
  assert.ok(!detectarBruto('Ver x.pdf').length);
  assert.ok(detectarBruto('Ver Joana Silva/Clientes Acme').includes('barra'), 'a guarda vê o resto');
});

test('senha em linguagem natural: o termo seguinte some só quando tem cara de senha', () => {
  const mascarados: [string, string][] = [
    ['Minha senha é Abacaxi#2026 no banco', `Minha senha é ${MASCARA} no banco`],
    ['A senha do wifi é Casa2026 hoje', `A senha do wifi é ${MASCARA} hoje`],
    ['Use a senha Abacaxi#2026 no login', `Use a senha ${MASCARA} no login`],
    ['The password is Hunter22! for now', `The password is ${MASCARA}! for now`],
    ["A senha é 'banana' por enquanto", `A senha é ${MASCARA} por enquanto`],
    ['A senha nova do roteador é aBcDeFgH', `A senha nova do roteador é ${MASCARA}`],
    ['Senha do cofre é 123456.', `Senha do cofre é ${MASCARA}.`],
  ];
  for (const [entrada, esperado] of mascarados) {
    assert.equal(sanearTexto(entrada, 200), esperado, entrada);
    assert.equal(saida(entrada), esperado, `${entrada} (pela guarda da saída, sem virar [oculto] inteiro)`);
  }
  const iguais = [
    'A senha é obrigatória no cadastro', 'Validar senha forte com 12 caracteres', 'Trocar a senha do usuário', 'Senha expira em 90 dias',
    'Resetar senha 2 vezes', 'Senha do Postgres em produção', 'Password is required', 'Esqueci a senha de novo', 'Senha e usuário do admin',
  ];
  for (const t of iguais) {
    assert.equal(sanearTexto(t, 200), t, t);
    assert.equal(saida(t), t, `${t} (pela guarda da saída)`);
  }
});
