// Integração: servidor de verdade com os adaptadores reais apontados para uma casa falsa (pasta temporária) e um
// OpenMausBot falso. Mede o tempo entre a linha chegar ao JSONL e o agente aparecer na sala certa pelo SSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EsquemaQuadro } from '@arcadia/shared';
import { iniciarServidor, type Servidor } from '../servidor.ts';
import { validarConfig } from '../config/carregar.ts';
import { criarLog } from '../util/log.ts';
import { montarCasa, servidorComFontes } from '../testes/casa.ts';
import { pastaTemporaria } from '../testes/apoio.ts';
import { abrirSse, esperar, lerSse, obter } from '../testes/http.ts';
import { esperarAte, iniciarOmbFalso } from '../testes/omb-falso.ts';

const linhaClaude = (sid: string, cwd: string, uuid: string, extra: Record<string, unknown>) =>
  JSON.stringify({ type: 'user', sessionId: sid, cwd, entrypoint: 'claude-vscode', uuid, timestamp: new Date().toISOString(), isSidechain: false, ...extra }) + '\n';

test('linha nova no JSONL vira agente na sala certa em até 2 s; o doctor mostra cada fonte', async () => {
  const p = pastaTemporaria();
  const logs: string[] = [];
  const casa = montarCasa(path.join(p.caminho, 'casa'), 'env-x');
  const omb = await iniciarOmbFalso({ environmentId: 'env-x', versao: '0.1.121', bots: [] });
  let s: Servidor | undefined;
  try {
    s = await servidorComFontes(casa, omb, logs, path.join(p.caminho, 'dados'));
    const sse = await abrirSse(s.visualizacao.porta);
    await esperar(100);
    const dir = path.join(casa.transcricoes, 'C--projetos-produto-alfa');
    fs.mkdirSync(dir, { recursive: true });
    const arq = path.join(dir, 'sessao-g2.jsonl');
    const medidas: number[] = [];
    for (let i = 0; i < 3; i++) {
      const antes = sse.texto().length;
      const inicio = Date.now();
      fs.appendFileSync(arq, linhaClaude('sessao-g2', casa.projeto, `u${i}`, { message: { role: 'user', content: 'pedido inventado' } }));
      await esperarAte(() => {
        const novos = lerSse(sse.texto().slice(antes)).filter((m) => m.event === 'mundo');
        return novos.some((m) => EsquemaQuadro.parse(JSON.parse(m.data ?? '')).mudancas.some((x) => x.k === 'evento' && x.evento.agente.chave === 'claude:sessao-g2'));
      }, 4_000);
      medidas.push(Date.now() - inicio);
      await esperar(400);
    }
    sse.fechar();
    const agente = s.nucleo.mundo().agentes['claude:sessao-g2'];
    assert.ok(agente, 'a sessão aparece como agente');
    const sala = agente?.salaChave ? s.nucleo.mundo().salas[agente.salaChave] : undefined;
    assert.equal(sala?.nome, 'produto-alfa');
    assert.equal(sala?.alaId, 'produtos');
    assert.ok(Math.max(...medidas) <= 2_000, `latências: ${medidas.join(', ')} ms`);
    // O doctor mostra cada fonte, com o diagnóstico dos adaptadores.
    const texto = (await obter(s.ingestao.porta, '/doctor?formato=texto')).corpo.toString('utf8');
    for (const trecho of ['OpenMausBot: conectado', 'Transcrições do Claude Code: lendo', 'Sessões vivas do Claude Code: lendo', 'Rollouts do Codex: lendo', 'SSE conectado']) {
      assert.ok(texto.includes(trecho), `faltou "${trecho}" no doctor:\n${texto}`);
    }
    const saude = s.nucleo.mundo().saude.fontes;
    assert.equal(saude['omb']?.estado, 'ligada');
    assert.equal(saude['claude-transcricao']?.estado, 'ligada');
    console.log(`latência linha no JSONL até o quadro do SSE: ${medidas.join(', ')} ms`);
  } finally {
    await s?.parar();
    await omb.fechar();
    p.remover();
  }
});

test('sem o observador de arquivos, a varredura de 2 s ainda pega a linha', async () => {
  const p = pastaTemporaria();
  const casa = montarCasa(path.join(p.caminho, 'casa'));
  const logs: string[] = [];
  let s: Servidor | undefined;
  try {
    const barra = (x: string) => x.replace(/\\/g, '/');
    const { config } = validarConfig(
      { versao: 1, fontes: { openmausbot: { ligado: false }, claudeSessoesVivas: { ligado: false }, codexRollouts: { ligado: false }, claudeTranscricoes: { pasta: barra(casa.transcricoes) } } },
      casa.amb,
    );
    s = await iniciarServidor({
      carregada: { config, arquivo: 't', descricao: 't', origem: 'argumento', avisos: [] }, amb: casa.amb, log: criarLog({ saida: (l) => logs.push(l) }),
      dirDados: path.join(p.caminho, 'dados'), portas: { ingestao: 0, visualizacao: 0 }, buildId: 't', fontesReais: true, observar: false,
    });
    const dir = path.join(casa.transcricoes, 'C--x');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'sessao-v.jsonl'), linhaClaude('sessao-v', casa.projeto, 'v1', { message: { content: 'x' } }));
    const servidor = s;
    await esperarAte(() => Boolean(servidor.nucleo.mundo().agentes['claude:sessao-v']), 3_500);
  } finally {
    await s?.parar();
    p.remover();
  }
});

