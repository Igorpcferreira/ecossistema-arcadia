#!/usr/bin/env node
// Checagem automática das regras de escrita do Arcadia (AGENTS.md, seção Escrita).
// Uso: node tools/checar-escrita.mjs [arquivos...]   (sem argumentos, varre o repositório)
// Sai com código 1 se achar problema. Não depende de nada além do Node.
//
// O que procura:
//   travessão (U+2014) e meia-risca (U+2013) em qualquer arquivo de texto;
//   emoji em qualquer arquivo de texto;
//   hífen com espaços como separador (" - ") no texto corrido dos .md;
//   data no formato aaaa-mm-dd no texto corrido dos .md (use dd/mm/aaaa).
// Código entre crases e blocos de código dos .md ficam de fora das duas últimas regras.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PULAR_PASTAS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite', 'dados']);
const PULAR_CAMINHOS = ['docs/local/']; // fora do Git
const EXTENSOES = new Set(['.md', '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yaml', '.yml', '.txt']);

// Os caracteres proibidos são montados pelo código, para este arquivo não conter nenhum deles.
const TRAVESSAO = new RegExp('[' + String.fromCharCode(0x2014, 0x2013) + ']');
const EMOJI = /\p{Extended_Pictographic}/u;
const PERMITIDOS_PICTO = new Set([0xa9, 0xae, 0x2122].map((c) => String.fromCharCode(c))); // (c), (r) e TM não são emoji na prática
const SEPARADOR = / - /;
const DATA_ISO = /\b(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;

function listar(dir, saida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!PULAR_PASTAS.has(e.name)) listar(path.join(dir, e.name), saida); continue; }
    const rel = path.relative(RAIZ, path.join(dir, e.name)).split(path.sep).join('/');
    if (PULAR_CAMINHOS.some((p) => rel.startsWith(p))) continue;
    if (EXTENSOES.has(path.extname(e.name).toLowerCase())) saida.push(rel);
  }
  return saida;
}
function temEmoji(linha) {
  for (const ch of linha) if (EMOJI.test(ch) && !PERMITIDOS_PICTO.has(ch)) return ch;
  return null;
}

const arquivos = process.argv.length > 2 ? process.argv.slice(2).map((a) => path.relative(RAIZ, path.resolve(a)).split(path.sep).join('/')) : listar(RAIZ);
const problemas = [];
for (const rel of arquivos) {
  const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const md = rel.toLowerCase().endsWith('.md');
  let emBloco = false;
  texto.split(/\r?\n/).forEach((linha, i) => {
    const onde = `${rel}:${i + 1}`;
    if (TRAVESSAO.test(linha)) problemas.push(`${onde}: travessão ou meia-risca`);
    const e = temEmoji(linha);
    if (e) problemas.push(`${onde}: emoji (${e})`);
    if (!md) return;
    if (/^\s*(```|~~~)/.test(linha)) { emBloco = !emBloco; return; }
    if (emBloco) return;
    const corrido = linha.replace(/`[^`]*`/g, '').replace(/^\s*([-*+]|\d+\.)\s+/, '').replace(/^\s*\|?[\s:|-]+\|?\s*$/, '');
    if (SEPARADOR.test(corrido)) problemas.push(`${onde}: hífen com espaços como separador`);
    if (DATA_ISO.test(corrido)) problemas.push(`${onde}: data aaaa-mm-dd no texto (use dd/mm/aaaa)`);
  });
}
if (problemas.length) {
  console.log(problemas.join('\n'));
  console.log(`\n${problemas.length} problema(s) de escrita em ${arquivos.length} arquivo(s).`);
  process.exit(1);
}
console.log(`Escrita ok: ${arquivos.length} arquivo(s) conferido(s).`);
