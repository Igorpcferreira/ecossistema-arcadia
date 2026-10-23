import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Desenvolvimento só no PC: 4780 e 47800 ficam para o servidor do Arcadia.
// Duas páginas: o mundo (/) e os protótipos da Fase 1 (/prototipos).

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const LOCAL = path.join(RAIZ, 'docs', 'local');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const TIPOS: Record<string, string> = { '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };

/**
 * Arquivos pessoais (fora do Git) servidos só em desenvolvimento e só para o próprio PC:
 * o pacote de personagens, o cenário local, a prancha aprovada e a prova do motor.
 * Nada disso entra no build: o plugin só existe no modo "serve".
 */
function arquivosLocais(): Plugin {
  const fixos: Record<string, string> = {
    '/local/personagens.json': path.join(LOCAL, 'personagens', 'personagens.json'),
    '/local/cenario-local.json': path.join(LOCAL, 'fase1', 'cenario-local.json'),
  };
  const pastas: Record<string, string> = {
    '/local/prancha/': path.join(LOCAL, 'conceitos'),
    '/local/prova/': path.join(LOCAL, 'prova-motor'),
  };
  return {
    name: 'arcadia-arquivos-locais',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/local/')) return next();
        if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) { res.statusCode = 403; res.end('só no próprio PC'); return; }
        let arquivo: string | null = fixos[url] ?? null;
        if (!arquivo) {
          for (const [pref, pasta] of Object.entries(pastas)) {
            if (!url.startsWith(pref)) continue;
            const alvo = path.resolve(pasta, '.' + path.posix.normalize('/' + decodeURIComponent(url.slice(pref.length))));
            if (alvo.startsWith(pasta + path.sep) && TIPOS[path.extname(alvo)]) arquivo = alvo;
          }
        }
        if (!arquivo || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) { res.statusCode = 404; res.end('não existe'); return; }
        res.setHeader('Content-Type', TIPOS[path.extname(arquivo)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(arquivo).pipe(res);
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [arquivosLocais()],
  server: { host: '127.0.0.1', port: 4781, strictPort: true },
  preview: { host: '127.0.0.1', port: 4782, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rolldownOptions: { input: { mundo: path.join(AQUI, 'index.html'), prototipos: path.join(AQUI, 'prototipos.html') } },
  },
});
