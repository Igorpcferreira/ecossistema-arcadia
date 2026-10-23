// Teste de vazamento, de ponta a ponta: eventos sintéticos cheios de segredos, caminhos completos, prompts e
// comandos entram pelo núcleo do servidor de verdade e pelos adaptadores reais. Nada disso pode aparecer no
// snapshot, no SSE, no SQLite (bytes do arquivo e linhas das tabelas), nos logs, no doctor, na saúde nem na página
// de depuração. Todos os dados são inventados e o ambiente é falso (casa e LOCALAPPDATA dentro da pasta do teste).
//
// O oráculo são canários exatos procurados como texto puro em cada saída (e na forma NFKC, e no texto escondido em
// caracteres de etiqueta). Ele não usa o detector do saneamento: um furo que as regex não veem também não escapa daqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { EsquemaSnapshot, MASCARA, sanearEvento } from '@arcadia/shared';
import { iniciarServidor, type Servidor } from './servidor.ts';
import { validarConfig } from './config/carregar.ts';
import { criarLog } from './util/log.ts';
import { pastaTemporaria } from './testes/apoio.ts';
import { ambienteFalso } from './testes/casa.ts';
import { abrirSse, esperar, obter } from './testes/http.ts';

const cc = (...c: number[]) => String.fromCharCode(...c);
const cp = (...c: number[]) => String.fromCodePoint(...c);
const largo = (s: string) => [...s].map((c) => (/\d/.test(c) ? cc(0xff10 + Number(c)) : c)).join('');
const etiquetas = (s: string) => [...s].map((c) => cp(0xe0000 + c.charCodeAt(0))).join('');
const VS16 = cc(0xfe0f);
const ZWSP = cc(0x200b);

const C = {
  prompt: 'CANARIO-PROMPT-qz81 escreva o contrato do cliente',
  resposta: 'CANARIO-RESPOSTA-qz82',
  pensamento: 'CANARIO-PENSAMENTO-qz83',
  comando: 'CANARIO-COMANDO-qz84 git push --force',
  diff: 'CANARIO-DIFF-qz85',
  conteudo: 'CANARIO-CONTEUDO-qz86',
  saida: 'CANARIO-SAIDA-qz87',
  chave: 'sk-ant-api03-CANARIOqz88xyzw',
  github: 'ghp_CANARIOqz89abcdefghijklmnop',
  aws: 'AKIACANARIOQZ9012345',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJjYW5hcmlvIjoicXo5MSJ9.Q0FOQVJJTw',
  pem: '-----BEGIN PRIVATE KEY----- CANARIOqz92 -----END PRIVATE KEY-----',
  senha: 'password=CANARIOqz93',
  conexao: 'postgres://admin:CANARIOqz94@db.exemplo.com/app',
  email: 'fulano.canario.qz95@exemplo.com',
  cpf: '529.982.247-25',
  cnpj: '11.222.333/0001-81',
  usuario: 'fulanocanarioqz96',
  mcp: 'crm-cliente-qz98',
  // Da revisão do marco 3:
  pastaComEspaco: 'Clientes Canario Ltda',
  pessoaComEspaco: 'Joana Canario Silva',
  // Na pasta do arquivo, o nome curto da pasta vira o nome da sala (é o desenho); os pedaços de cima nunca saem.
  unix: '/home/joana canario/clientes canario corp/projeto/contrato-canario.pdf',
  envSenha: 'DB_PASSWORD=CANARIOqzDB1',
  smtp: 'SMTP_PASS=CANARIOqzSM2',
  envToken: 'GITHUB_TOKEN=CANARIOqzGH3',
  // Montados em partes: inteiros no código, o GitHub barra o push como segredo.
  gitlab: 'glpat-' + 'CANARIOqzGL4abcdefgh',
  supabase: 'sbp_' + 'ca7a1a0ca7a1a0ca7a1a0ca7a1a0ca7a1a0ca7a',
  discord: ['MTk4NjIyNDgzNDcxOTI1MjQ4', 'Cl2FMQ', 'CANARIOqzDC5ZnCjm1XVW7vRze4b7'].join('.'),
  emailAcento: 'joão.canário.qz@exemplo.com.br',
  telefone: '62 99876-1357',
  cpfLargo: largo('390.533.447-05'),
  escondido: `Revisar login${etiquetas('CANARIOqzTAG6')}`,
  seletor: `ghp_${VS16}CANARIOqzVS7abcdefghijkl`,
  larguraZero: `sk-ant-api03-CANARIO${ZWSP}qzZW8abcdefgh`,
  rede: '\\\\canario-qz.invalid\\publico\\leia.txt',
};

/** Miolos que não podem sobrar em lugar nenhum. */
const MIOLOS = [
  'CANARIO-PROMPT', 'CANARIO-RESPOSTA', 'CANARIO-PENSAMENTO', 'CANARIO-COMANDO', 'git push --force', 'CANARIO-DIFF', 'CANARIO-CONTEUDO',
  'CANARIO-SAIDA', 'CANARIOqz88', 'CANARIOqz89', 'CANARIOQZ9012345', C.jwt, 'eyJjYW5hcmlv', 'CANARIOqz92', 'BEGIN PRIVATE', 'CANARIOqz93',
  'CANARIOqz94', 'fulano.canario', C.cpf, '52998224725', C.cnpj, '11222333000181', C.usuario, C.mcp, 'escreva o contrato',
  'Clientes Canario', 'Canario Ltda', 'Joana Canario', 'Canario Silva', 'clientes canario corp', 'CANARIOqzDB1', 'CANARIOqzSM2',
  'CANARIOqzGH3', 'CANARIOqzGL4', 'ca7a1a0ca7a1a0', 'CANARIOqzDC5', 'joão', 'canário.qz', '99876-1357', '998761357', C.cpfLargo,
  '390.533.447-05', '39053344705', 'CANARIOqzTAG6', 'CANARIOqzVS7', 'qzZW8', 'canario-qz.invalid', 'C--Users-Joana-Canario',
  'CANARIO-TITULO-EXCLUIDO', 'CANARIO-NOME-EXCLUIDO', 'transcript', '.jsonl', '\\AppData', '/AppData',
];

function proibidos(raiz: string): string[] {
  const r = path.resolve(raiz);
  return [...MIOLOS, r, r.replace(/\\/g, '/'), r.replace(/\\/g, '\\\\')];
}

/** O que vazou: busca como texto puro, na forma NFKC e no texto escondido em caracteres de etiqueta. */
function vazamentos(texto: string, lista: string[]): string[] {
  const bruto = texto.toLowerCase();
  const nfkc = texto.normalize('NFKC').toLowerCase();
  const escondido = [...texto].map((c) => ((c.codePointAt(0) ?? 0) >= 0xe0000 && (c.codePointAt(0) ?? 0) <= 0xe007f ? String.fromCharCode((c.codePointAt(0) ?? 0) - 0xe0000) : '')).join('').toLowerCase();
  const achados = lista.filter((p) => {
    const x = p.toLowerCase();
    return bruto.includes(x) || nfkc.includes(x.normalize('NFKC')) || (escondido.length > 0 && escondido.includes(x));
  });
  if (/[\u{E0000}-\u{E007F}]/u.test(texto)) achados.push('(caractere de etiqueta)');
  return achados;
}

/** Todas as saídas do servidor no ar: snapshot, SSE (já coletado), doctor em texto e JSON, saúde e depuração. */
async function saidasDoServidor(s: Servidor): Promise<Record<string, string>> {
  const snap = await obter(s.visualizacao.porta, '/api/snapshot', { 'accept-encoding': 'gzip' });
  return {
    snapshot: gunzipSync(snap.corpo).toString('utf8'),
    'doctor em texto': (await obter(s.ingestao.porta, '/doctor?formato=texto')).corpo.toString('utf8'),
    'doctor em JSON': (await obter(s.ingestao.porta, '/doctor')).corpo.toString('utf8'),
    saúde: (await obter(s.ingestao.porta, '/saude')).corpo.toString('utf8'),
    'página de depuração': (await obter(s.visualizacao.porta, '/depurar')).corpo.toString('utf8') + (await obter(s.visualizacao.porta, '/depurar.js')).corpo.toString('utf8'),
  };
}

function saidasDoBanco(arquivo: string): Record<string, string> {
  const bytes = ['', '-wal', '-shm'].map((suf) => (fs.existsSync(arquivo + suf) ? fs.readFileSync(arquivo + suf) : Buffer.alloc(0)));
  const db = new DatabaseSync(arquivo, { readOnly: true });
  let linhas = '';
  try {
    for (const t of (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((x) => x.name)) {
      linhas += JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all()) + '\n';
    }
  } finally {
    db.close();
  }
  return { 'bytes do SQLite': bytes.map((b) => b.toString('latin1') + '\n' + b.toString('utf8')).join('\n'), 'linhas do SQLite': linhas };
}

function conferir(saidas: Record<string, string>, lista: string[]): void {
  for (const [nome, texto] of Object.entries(saidas)) {
    assert.ok(texto.length > 0, `${nome} vazio: o teste não viu nada`);
    assert.deepEqual(vazamentos(texto, lista), [], `vazou em ${nome}`);
  }
}

test('nada proibido sai pelo snapshot, SSE, SQLite, logs, doctor, saúde ou depuração', async (t) => {
  const pasta = pastaTemporaria();
  t.after(() => pasta.remover());
  const raiz = pasta.caminho;
  const casa = path.join(raiz, C.usuario);
  const amb = ambienteFalso(casa);
  const projeto = path.join(casa, 'projetos', 'produto-alfa');
  const comEspaco = path.join(casa, C.pastaComEspaco, 'projeto do cliente');
  const cofre = path.join(casa, 'segredos', 'cofre');
  for (const p of [path.join(projeto, '.git'), path.join(comEspaco, '.git'), cofre]) fs.mkdirSync(p, { recursive: true });
  const barra = (p: string) => p.replace(/\\/g, '/');
  const { config } = validarConfig(
    {
      versao: 1,
      alas: [
        { id: 'produtos', nome: 'Produtos', cor: '#c9a7ff', regras: [`${barra(casa)}/projetos/produto-*/**`] },
        { id: 'bastidores', nome: 'Bastidores', cor: '#6fd3ff', regras: ['~'] },
      ],
      salas: { pastasAgregadoras: [barra(path.join(casa, 'projetos'))], excluir: ['**/segredos/**'] },
      privacidade: { mostrarNomeCurtoDoArquivo: true, mostrarTituloDaTarefa: true },
    },
    amb,
  );
  const logs: string[] = [];
  const s = await iniciarServidor({
    carregada: { config, arquivo: 'teste.yaml', descricao: 'configuração de teste', origem: 'argumento', avisos: [] },
    amb,
    log: criarLog({ saida: (l) => logs.push(l) }),
    dirDados: path.join(raiz, 'dados'),
    portas: { ingestao: 0, visualizacao: 0 },
    semSondarOmb: true,
    buildId: 'teste-vazamento',
  });
  let saidas: Record<string, string> = {};
  let sseTexto = '';
  try {
    const sse = await abrirSse(s.visualizacao.porta);
    await esperar(50);
    const agora = Date.now();
    let n = 0;
    const base = (tipo: string, extra: Record<string, unknown> = {}) => ({
      v: 1, id: `vaz:${++n}`, ts: agora + n, recebidoEm: agora + n, origem: 'claude-transcricao', motor: 'claude',
      agente: { chave: 'claude:vaz-1', tipo: 'sessao' }, local: {}, tipo, ...extra,
    });
    const pessoaComEspaco = `C:/Users/${C.pessoaComEspaco}/${C.pastaComEspaco}/contrato-canario.pdf`;
    const entradas: { evento: unknown; caminhos?: { cwd?: string; arquivo?: string; pasta?: string } }[] = [
      {
        evento: base('sessao.inicio', {
          agente: { chave: 'claude:vaz-1', tipo: 'sessao', nome: `Sessão ${C.chave}`, cargo: C.email },
          local: { equipe: C.conexao },
          prompt: C.prompt, message: { content: [{ type: 'text', text: C.prompt }] }, thinking: C.pensamento,
          transcript_path: path.join(casa, '.claude', 'projects', 'x.jsonl'), cwd: projeto,
        }),
        caminhos: { cwd: path.join(projeto, 'src') },
      },
      { evento: base('pedido.humano', { tarefa: { titulo: `Deploy com ${C.senha}, CPF ${C.cpf} em ${path.join(casa, 'x.md')}`, prompt: C.prompt }, prompt: C.prompt }) },
      {
        evento: base('ferramenta.inicio', {
          ferramenta: { nome: `mcp__${C.mcp}__exportar_leads`, categoria: 'integracao', id: 'toolu_vaz1', alvo: path.join(projeto, '.env'), input: { command: C.comando } },
          tool_input: { command: C.comando, file_path: path.join(projeto, 'src', 'app.ts') }, comando: C.comando,
        }),
        caminhos: { arquivo: path.join(projeto, 'src', 'app.ts') },
      },
      {
        evento: base('ferramenta.fim', {
          ferramenta: { nome: 'Bash', categoria: 'comando', id: 'toolu_vaz1', ok: true, output: C.saida },
          tool_response: { stdout: C.saida }, output: C.saida, diff: C.diff, conteudo: C.conteudo, resposta: C.resposta,
        }),
      },
      {
        evento: base('delegacao.enviada', {
          agente: { chave: 'omb:vaz-bot', tipo: 'bot', nome: `Bot ${C.github}`, cor: 'red; background:url(x)', corpo: '<script>' },
          delegacao: { de: 'omb:vaz-bot', para: 'claude:vaz-1', jobId: 'job-vaz', titulo: `Revisar ${C.pem} em ${path.join(casa, 'docs', 'plano.md')}`, status: 'running', brief: C.prompt },
        }),
      },
      { evento: base('espera.inicio', { espera: { tipo: 'permissao', pergunta: C.prompt }, tool_input: { command: C.comando } }) },
      {
        evento: base('ferramenta.inicio', { agente: { chave: 'claude:vaz-2', tipo: 'sessao' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'toolu_vaz2' } }),
        caminhos: { cwd: cofre, arquivo: path.join(cofre, 'senhas-do-banco.txt') },
      },
      { evento: base('uso', { uso: { entrada: 10, saida: 20, cache: 5, custoUsd: 0.001 }, last_assistant_message: C.resposta }) },
      { evento: base('erro', { error: `${C.aws} ${C.jwt}`, apiError: { message: C.chave } }) },
      { evento: base('subagente.inicio', { agente: { chave: 'claude:vaz-1:sub', tipo: 'subagente', paiChave: 'claude:vaz-1', nome: C.email }, description: C.prompt }) },
      { evento: base('pensando', { turno: { texto: true }, text: C.resposta }) },
      // Da revisão do marco 3: caminho com espaço (barra normal e Unix), senha de variável, tokens novos, e-mail
      // com acento, telefone sem parênteses, CPF de largura total, texto escondido, seletor e largura zero.
      { evento: base('pedido.humano', { agente: { chave: 'claude:vaz-3', tipo: 'sessao', nome: C.seletor, cargo: C.larguraZero }, local: { equipe: C.emailAcento }, tarefa: { titulo: `Revisar ${pessoaComEspaco} hoje, ${C.envSenha} e ${C.smtp}` } }), caminhos: { cwd: path.join(comEspaco, 'src') } },
      { evento: base('pedido.humano', { agente: { chave: 'claude:vaz-4', tipo: 'sessao', nome: C.gitlab }, tarefa: { titulo: `Ver ${C.unix} com ${C.envToken}` } }) },
      { evento: base('delegacao.enviada', { agente: { chave: 'omb:vaz-bot2', tipo: 'bot', nome: C.discord }, delegacao: { de: 'omb:vaz-bot2', para: 'claude:vaz-4', jobId: 'job-vaz2', titulo: `Ligar ${C.telefone}, CPF ${C.cpfLargo}, chave ${C.supabase}` } }) },
      { evento: base('pedido.humano', { agente: { chave: 'claude:vaz-5', tipo: 'sessao' }, tarefa: { titulo: C.escondido } }) },
      // Arquivo de sala fixa não move o agente: quem dá a sala (fixa, sem nome do caminho) é o cwd da sessão.
      { evento: base('ferramenta.inicio', { agente: { chave: 'claude:vaz-6', tipo: 'sessao' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'toolu_vaz6' } }), caminhos: { arquivo: C.rede, cwd: path.win32.dirname(C.rede) } },
      { evento: base('ferramenta.inicio', { agente: { chave: 'claude:vaz-7', tipo: 'sessao' }, ferramenta: { nome: 'Read', categoria: 'ler', id: 'toolu_vaz7' } }), caminhos: { arquivo: path.join(casa, '.claude', 'projects', 'C--Users-Joana-Canario-Clientes-Canario-Ltda', 'sessao.jsonl'), cwd: path.join(casa, '.claude', 'projects', 'C--Users-Joana-Canario-Clientes-Canario-Ltda') } },
      // Recusados: tipo inexistente, identificador com segredo e chave reservada.
      { evento: base('nao-existe', { prompt: C.prompt }) },
      { evento: base('turno.inicio', { agente: { chave: `claude:${C.chave}`, tipo: 'sessao' } }) },
      { evento: base('turno.inicio', { agente: { chave: 'constructor', tipo: 'sessao' } }) },
    ];
    for (const e of entradas) s.nucleo.ingerir(e as Parameters<typeof s.nucleo.ingerir>[0]);
    await s.nucleo.ocioso();
    await esperar(500);
    saidas = await saidasDoServidor(s);
    sseTexto = sse.texto();
    sse.fechar();

    // O teste não é vazio: o que devia passar, passou (saneado).
    const estado = EsquemaSnapshot.parse(JSON.parse(saidas['snapshot'] ?? '')).estado;
    const a1 = estado.agentes['claude:vaz-1'];
    assert.ok(a1, 'a sessão aparece');
    assert.equal(a1?.nome, `Sessão ${MASCARA}`);
    assert.equal(a1?.cargo, MASCARA);
    assert.equal(a1?.equipe, MASCARA);
    assert.equal(a1?.tarefa, `Deploy com password=${MASCARA}, CPF ${MASCARA} em x.md`);
    assert.equal(estado.agentes['omb:vaz-bot']?.nome, `Bot ${MASCARA}`);
    assert.equal(estado.agentes['omb:vaz-bot']?.cor, undefined);
    assert.equal(estado.agentes['omb:vaz-bot']?.corpo, undefined);
    assert.match(estado.delegacoes['job-vaz']?.titulo ?? '', /^Revisar \[oculto\]/);
    assert.equal(estado.agentes['claude:vaz-3']?.tarefa, `Revisar contrato-canario.pdf hoje, DB_PASSWORD=${MASCARA} e SMTP_PASS=${MASCARA}`);
    assert.equal(estado.agentes['claude:vaz-4']?.tarefa, `Ver contrato-canario.pdf com GITHUB_TOKEN=${MASCARA}`);
    assert.equal(estado.agentes['claude:vaz-5']?.tarefa, 'Revisar login');
    const salaDe = (k: string) => estado.salas[estado.agentes[k]?.salaChave ?? '']?.nome;
    assert.equal(salaDe('claude:vaz-1'), 'produto-alfa');
    assert.equal(salaDe('claude:vaz-3'), 'projeto do cliente', 'sala pela raiz git, com o nome curto da pasta');
    assert.equal(salaDe('claude:vaz-6'), 'Pasta de rede');
    assert.equal(salaDe('claude:vaz-7'), 'Arquivos dos agentes');
    assert.equal(estado.agentes['claude:vaz-2']?.salaChave, undefined, 'pasta excluída não vira sala');
    const acoes = a1?.ultimasAcoes ?? [];
    assert.ok(acoes.some((x) => x.nome === 'MCP' && x.alvo === '.env'), JSON.stringify(acoes));
    assert.ok(!JSON.stringify(estado.agentes['claude:vaz-2']).includes('senhas'), 'nem o nome do arquivo da pasta excluída');
    assert.equal(s.nucleo.contadores().recusados, 3);
    assert.ok(s.nucleo.contadores().camposDescartados >= 15);
    assert.equal(estado.metricas.esperas, 1, 'a espera passou (e saiu da fila com o erro seguinte)');
  } finally {
    await s.parar();
  }

  // Cada evento gravado é canônico e sem campo fora da allowlist.
  const db = new DatabaseSync(s.arquivoBanco, { readOnly: true });
  try {
    const eventos = db.prepare('SELECT json FROM eventos').all() as { json: string }[];
    assert.equal(eventos.length, 17);
    for (const l of eventos) {
      const r = sanearEvento(JSON.parse(l.json), { permitirAlvo: true });
      assert.ok(r.ok, 'evento gravado é um evento canônico válido');
      if (r.ok) assert.equal(r.descartados, 0, 'evento gravado não tem campo fora da allowlist');
    }
  } finally {
    db.close();
  }
  conferir({ ...saidas, SSE: sseTexto, ...saidasDoBanco(s.arquivoBanco), logs: logs.join('\n') }, proibidos(raiz));
  assert.ok(logs.some((l) => l.includes('evento recusado pelo esquema')), 'o log registra a recusa, sem conteúdo');
});

test('adaptadores reais: transcrição, sessão viva, rollout e OpenMausBot cheios de segredo não vazam', async (t) => {
  const { montarCasa, servidorComFontes } = await import('./testes/casa.ts');
  const { iniciarOmbFalso, esperarAte } = await import('./testes/omb-falso.ts');
  const pasta = pastaTemporaria();
  t.after(() => pasta.remover());
  const casa = montarCasa(path.join(pasta.caminho, C.usuario), 'env');
  const projeto = casa.projeto;
  const segredoTexto = `${C.prompt} ${C.chave} ${C.senha} ${C.email} ${C.cpf} ${C.conexao} ${C.envSenha} ${C.gitlab} ${C.telefone}`;
  // Transcrição do Claude com tudo o que não pode sair.
  const dir = path.join(casa.transcricoes, 'C--Users-Joana-Canario-Clientes-Canario-Ltda');
  fs.mkdirSync(dir, { recursive: true });
  const comum = { sessionId: 'sess-vaz', cwd: projeto, entrypoint: 'claude-vscode', isSidechain: false };
  const agora = Date.now();
  const iso = (ms: number) => new Date(agora + ms).toISOString();
  const pastaComEspaco = `C:/Users/${C.pessoaComEspaco}/${C.pastaComEspaco}`;
  fs.writeFileSync(path.join(dir, 'sess-vaz.jsonl'), [
    { ...comum, type: 'user', uuid: 'v1', timestamp: iso(1), message: { content: segredoTexto } },
    { ...comum, type: 'assistant', uuid: 'v2', timestamp: iso(2), message: { id: 'm1', content: [{ type: 'thinking', thinking: C.pensamento }, { type: 'tool_use', id: 't1', name: `mcp__${C.mcp}__exportar`, input: { file_path: path.join(projeto, 'src', 'a.ts'), query: C.comando } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } },
    { ...comum, type: 'user', uuid: 'v3', timestamp: iso(3), toolUseResult: { stdout: C.saida }, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `${C.saida} ${C.jwt}` }] } },
    { ...comum, type: 'assistant', uuid: 'v4b', timestamp: iso(4), message: { id: 'm2b', content: [{ type: 'tool_use', id: 't2b', name: 'Glob', input: { path: C.rede } }, { type: 'tool_use', id: 't2c', name: 'Read', input: { file_path: `${C.unix}` } }], stop_reason: 'tool_use' } },
    { type: 'ai-title', sessionId: 'sess-vaz', aiTitle: `Deploy ${C.github} ${C.cnpj}` },
    { type: 'custom-title', sessionId: 'sess-vaz', customTitle: `Revisar ${pastaComEspaco}/contrato-canario.pdf, ${C.envSenha}${C.escondido}` },
    { type: 'agent-name', sessionId: 'sess-vaz', agentName: C.seletor },
    { ...comum, type: 'assistant', uuid: 'v5', timestamp: iso(5), message: { id: 'm3', content: [{ type: 'text', text: C.resposta }], stop_reason: 'end_turn' } },
    { type: 'last-prompt', sessionId: 'sess-vaz', lastPrompt: C.prompt },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  // Sessão aberta numa pasta excluída: título e nome nunca saem.
  const cofre = path.join(casa.raiz, 'segredos', 'diario');
  fs.mkdirSync(cofre, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sess-excluida.jsonl'), [
    { type: 'custom-title', sessionId: 'sess-excluida', customTitle: 'CANARIO-TITULO-EXCLUIDO' },
    { type: 'agent-name', sessionId: 'sess-excluida', agentName: 'CANARIO-NOME-EXCLUIDO' },
    { sessionId: 'sess-excluida', cwd: cofre, entrypoint: 'claude-vscode', type: 'user', uuid: 'e1', timestamp: iso(1), message: { content: 'x' } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  // Sessão de projeto que lê um arquivo da pasta excluída: perde nome e tarefa dali em diante (o título já tinha saído
  // antes da leitura, então ele não é canário aqui; o canário é o da sessão aberta dentro da pasta excluída).
  fs.writeFileSync(path.join(dir, 'sess-cofre.jsonl'), [
    { type: 'custom-title', sessionId: 'sess-cofre', customTitle: 'Projeto antes do cofre' },
    { ...comum, sessionId: 'sess-cofre', type: 'user', uuid: 'k1', timestamp: iso(1), message: { content: 'x' } },
    { ...comum, sessionId: 'sess-cofre', type: 'assistant', uuid: 'k2', timestamp: iso(2), message: { id: 'mk', content: [{ type: 'tool_use', id: 'tk', name: 'Read', input: { file_path: path.join(casa.raiz, 'segredos', 'cofre.txt') } }], stop_reason: 'tool_use' } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  // Sessão viva com token e o .key que nunca pode ser aberto.
  fs.writeFileSync(path.join(casa.sessoes, '777.json'), JSON.stringify({
    pid: process.pid, sessionId: 'sess-viva', cwd: projeto, status: 'busy', statusUpdatedAt: agora, startedAt: agora, entrypoint: 'claude-desktop',
    kind: 'interactive', peerToken: `${C.chave}-peer`, messagingSocketPath: `pipe-${C.usuario}`, name: C.email,
  }));
  fs.writeFileSync(path.join(casa.sessoes, '777.a1b2.key'), `${C.pem} ${C.aws}`);
  fs.writeFileSync(path.join(casa.sessoes, 'config.json'), JSON.stringify({ sessionId: 'sess-intrusa', cwd: projeto, status: 'busy', token: C.chave }));
  // Rollout do Codex.
  const dirCodex = path.join(casa.codex, '2026', '10', '22');
  fs.mkdirSync(dirCodex, { recursive: true });
  const idCodex = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  fs.writeFileSync(path.join(dirCodex, `rollout-2026-10-22T12-00-00-${idCodex}.jsonl`), [
    { timestamp: iso(1), ordinal: 0, type: 'session_meta', payload: { id: idCodex, cwd: projeto, originator: 'codex_vscode', base_instructions: segredoTexto, agent_nickname: C.emailAcento } },
    { timestamp: iso(2), ordinal: 1, type: 'event_msg', payload: { type: 'user_message', message: C.prompt } },
    { timestamp: iso(3), ordinal: 2, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: C.comando, workdir: projeto }) } },
    { timestamp: iso(4), ordinal: 3, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: `${C.saida} ${C.conexao}` } },
    { timestamp: iso(5), ordinal: 4, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: `*** Begin Patch\n*** Update File: src/b.ts\n-${C.diff}\n+${C.conteudo}\n*** End Patch` } },
    { timestamp: iso(6), ordinal: 5, type: 'event_msg', payload: { type: 'task_complete', last_agent_message: C.resposta } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  // OpenMausBot falso com alma, descrição, título de tarefa, pergunta, resultado e fila cheios de segredo.
  const omb = await iniciarOmbFalso({ environmentId: 'env', versao: '0.1.121', bots: [{
    id: 'bot-vaz', threadId: 'th-v', name: 'Unidade Teste', title: 'Revisão', color: 'teal', section: 'Equipe Teste', activity: 'idle',
    soul: segredoTexto, description: C.prompt,
    tasks: [{ threadId: 'th-v', cwd: path.join(casa.raiz, '.openmausbot', 'task-workspaces', 'bot-vaz', 'th-v'), title: segredoTexto, activity: 'idle' }],
  }] });
  t.after(() => omb.fechar());
  const logs: string[] = [];
  const s = await servidorComFontes(casa, omb, logs, path.join(pasta.caminho, 'dados'));
  let saidas: Record<string, string> = {};
  let sseTexto = '';
  try {
    const sse = await abrirSse(s.visualizacao.porta);
    await esperarAte(() => Boolean(s.nucleo.mundo().agentes['claude:sess-vaz']) && Boolean(s.nucleo.mundo().agentes['omb:bot-vaz']), 5_000);
    const ev = (rt: Record<string, unknown>) =>
      omb.enviar({ kind: 'runtime', event: { eventId: `ev-${Math.random()}`, provider: 'claude', createdAt: new Date().toISOString(), threadId: 'th-v', ...rt } });
    ev({ type: 'turn.started' });
    ev({ type: 'item.started', itemId: 'i1', itemType: 'tool', title: 'Bash', input: { command: C.comando } });
    ev({ type: 'request.opened', requestType: 'question', tool: 'AskUserQuestion', summary: segredoTexto, questions: [{ question: C.prompt, options: [{ label: C.senha }] }] });
    ev({ type: 'item.completed', itemType: 'assistant_text', text: C.resposta });
    ev({ type: 'runtime.error', message: segredoTexto });
    omb.enviar({ kind: 'bot.queued', queues: { 'th-v': [{ queueId: 'q', text: segredoTexto }] } });
    omb.enviar({ kind: 'message', threadId: 'th-v', message: { text: segredoTexto } });
    await esperarAte(() => ['erro', 'na-fila'].includes(s.nucleo.mundo().agentes['omb:bot-vaz']?.estado ?? ''), 4_000);
    await s.nucleo.ocioso();
    await esperar(600);
    saidas = await saidasDoServidor(s);
    sseTexto = sse.texto();
    sse.fechar();
    const estado = EsquemaSnapshot.parse(JSON.parse(saidas['snapshot'] ?? '')).estado;
    assert.ok(estado.agentes['claude:sess-viva'], 'a sessão viva aparece');
    assert.equal(estado.agentes['claude:sess-intrusa'], undefined, 'arquivo fora do padrão <pid>.json não é lido');
    assert.ok(estado.agentes[`codex:${idCodex}`], 'o rollout aparece');
    assert.equal(estado.agentes['claude:sess-vaz']?.nome, MASCARA);
    assert.equal(estado.agentes['claude:sess-vaz']?.tarefa, `Revisar contrato-canario.pdf, DB_PASSWORD=${MASCARA} login`);
    const excluida = estado.agentes['claude:sess-excluida'];
    assert.ok(excluida, 'a sessão da pasta excluída aparece, sem sala, sem nome e sem tarefa');
    assert.deepEqual([excluida?.salaChave, excluida?.nome, excluida?.tarefa], [undefined, undefined, undefined]);
    assert.deepEqual([estado.agentes['claude:sess-cofre']?.nome, estado.agentes['claude:sess-cofre']?.tarefa], [undefined, undefined]);
  } finally {
    await s.parar();
  }
  const lista = [...proibidos(pasta.caminho), 'cofre.txt', '-peer', 'pipe-', 'sess-intrusa'];
  conferir({ ...saidas, SSE: sseTexto, ...saidasDoBanco(s.arquivoBanco), logs: logs.join('\n') || '(sem linhas de log)' }, lista);
});
