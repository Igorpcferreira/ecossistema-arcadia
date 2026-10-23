// Guardas das rotas /saude e /doctor: um gerador com canário (caminho absoluto, pasta pessoal, e-mail e token) passa
// pela rota de verdade e nada dele sai. Sem a guarda de uma rota, o canário aparece na saída dela e o teste falha.
// (A saúde só recebe texto já saneado pelo motor; este teste prova a guarda da rota contra um defeito no gerador.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASCARA } from '@arcadia/shared';
import { criarAppIngestao } from './ingestao.ts';
import type { Diagnostico } from '../doctor/diagnostico.ts';
import type { AmbienteCaminhos } from '../util/caminhos.ts';

const AMB: AmbienteCaminhos = { casa: 'C:\\Users\\Joana Canario', variaveis: {}, windows: true, cwd: 'C:\\' };
const C = {
  caminho: 'C:\\Users\\Joana Canario\\Clientes Canario Qz\\contrato.pdf',
  email: 'joana.canario.qz@exemplo.com',
  token: 'ghp_CANARIOqzROTA1abcdefghijklmnop',
};
const PROIBIDOS = ['Joana Canario', 'Clientes Canario', 'joana.canario', 'CANARIOqzROTA1'];

function diagnostico(): Diagnostico {
  return {
    geradoEm: Date.UTC(2026, 9, 22, 15, 0, 0),
    fuso: 'America/Sao_Paulo',
    servidor: { rodando: true, versaoEsquema: 1, node: '24.5.0' },
    configuracao: { descricao: C.caminho, origem: 'indicada em --config', avisos: [`chave perto de ${C.email}`, 'aviso sem nada a esconder'] },
    dados: { pasta: 'dados', existe: true },
    portas: [],
    fontes: [{ id: 'x', nome: 'Fonte falsa', estado: `falhou com ${C.token}`, linhas: [`Lido: ${C.caminho}`, 'linha sem nada a esconder'] }],
  };
}

function app() {
  return criarAppIngestao({
    amb: AMB,
    diagnosticar: async () => diagnostico(),
    saude: () => ({ ok: true, servidor: 'arcadia', fontes: { x: { estado: 'erro', mensagem: `falha em ${C.caminho} para ${C.email}`, versao: C.token } } }),
  });
}

async function pedir(rota: string): Promise<string> {
  const r = await app().request(rota, { headers: { host: '127.0.0.1:47800' } });
  assert.equal(r.status, 200);
  return r.text();
}

function semCanario(nome: string, texto: string): void {
  for (const p of PROIBIDOS) assert.ok(!texto.includes(p), `${nome} deixou passar "${p}"`);
}

test('rota /saude: o que o gerador mandar passa pela guarda antes de sair', async () => {
  const texto = await pedir('/saude');
  semCanario('/saude', texto);
  const corpo = JSON.parse(texto);
  assert.equal(corpo.servidor, 'arcadia', 'o resto da saúde sai');
  assert.equal(corpo.fontes.x.mensagem, MASCARA);
  assert.equal(corpo.fontes.x.versao, MASCARA);
});

test('rota /doctor em JSON: campo reprovado vira [oculto], o resto sai', async () => {
  const texto = await pedir('/doctor');
  semCanario('/doctor', texto);
  const d = JSON.parse(texto) as Diagnostico;
  assert.equal(d.configuracao.descricao, MASCARA);
  assert.deepEqual(d.configuracao.avisos, [MASCARA, 'aviso sem nada a esconder']);
  assert.deepEqual(d.fontes[0]?.linhas, [MASCARA, 'linha sem nada a esconder']);
});

test('rota /doctor em texto: linha reprovada vira aviso, o resto sai', async () => {
  const texto = await pedir('/doctor?formato=texto');
  semCanario('/doctor?formato=texto', texto);
  assert.match(texto, /^Atenção: este relatório mostra nomes de pastas desta máquina\./);
  assert.match(texto, /linha omitida pela guarda do doctor/);
  assert.match(texto, /aviso sem nada a esconder/);
  assert.match(texto, /linha sem nada a esconder/);
});
