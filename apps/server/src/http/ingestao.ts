// Listener local (127.0.0.1:47800): saúde e doctor. A ingestão de hooks entra aqui na Fase 6, com o ok do dono.
// Cada saída tem a sua guarda: a saúde e o doctor em JSON, campo a campo (texto reprovado vira [oculto]); o doctor
// em texto, linha a linha (linha reprovada vira um aviso). Caminho absoluto, pasta pessoal, e-mail e segredo nunca
// saem, nem quando uma mensagem montada no código levar um por engano.
import { Hono } from 'hono';
import { formatarDiagnostico, protegerDiagnostico, protegerTextoDoctor, type Diagnostico } from '../doctor/diagnostico.ts';
import type { AmbienteCaminhos } from '../util/caminhos.ts';
import { hostPermitido } from './visualizacao.ts';

export type OpcoesIngestao = {
  diagnosticar: () => Promise<Diagnostico>;
  saude: () => Record<string, unknown>;
  amb: AmbienteCaminhos;
};

export function criarAppIngestao(op: OpcoesIngestao): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (!hostPermitido(c.req.header('host'))) return c.text('Host não permitido.', 403);
    const origem = c.req.header('origin');
    if (origem !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i.test(origem)) return c.text('Origem não permitida.', 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Só leitura por enquanto: a ingestão de hooks chega na Fase 6.', 405);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('cache-control', 'no-store');
  });
  app.get('/saude', (c) => c.json(protegerDiagnostico(op.saude(), op.amb)));
  app.get('/doctor', async (c) => {
    if (c.req.query('formato') === 'texto') {
      const d = await op.diagnosticar();
      return c.text(protegerTextoDoctor(formatarDiagnostico(d), op.amb) + '\n');
    }
    const d = protegerDiagnostico(await op.diagnosticar(), op.amb);
    return c.json(d);
  });
  app.notFound((c) => c.text('Não encontrado. Rotas: /saude e /doctor (use ?formato=texto).', 404));
  return app;
}
