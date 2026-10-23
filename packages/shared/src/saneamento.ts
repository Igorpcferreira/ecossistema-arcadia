// Saneamento: a allowlist de campos (o esquema do evento) e a segunda barreira (regex de segredos e de caminhos).
// Regra: nada de prompt, resposta, thinking, entrada ou saída de ferramenta, comando, diff, conteúdo de arquivo,
// caminho completo, e-mail ou token sai do servidor. Este módulo não depende do Node (serve também ao navegador).
//
// Três camadas, de fora para dentro:
//   1. normalização: NFKC (menos ª, º, ² e ³), sem caractere invisível (formato, etiqueta, seletor), sem pictograma,
//      barras parecidas viram barra de verdade. Vem antes de qualquer máscara, para um invisível não partir um token;
//   2. saneamento: cada caminho (absoluto ou relativo, com espaço no nome) vira o último pedaço, com paradas que
//      protegem o resto da frase; segredo e dado pessoal viram `[oculto]` (na senha, só o valor);
//   3. guarda da saída: um detector bruto e diferente das regex (barra entre pedaços, arroba, muitos dígitos,
//      trecho denso, prefixo de segredo, invisível) que bloqueia o texto inteiro antes do banco, do SSE e do snapshot.
import { EsquemaArcadiaEvent, type ArcadiaEvent, type CategoriaFerramenta } from './evento.ts';

export const MASCARA = '[oculto]';
export const MASCARA_CAMINHO = '[caminho]';

export const LIMITES = {
  nome: 40,
  cargo: 40,
  equipe: 48,
  sala: 48,
  titulo: 120,
  alvo: 64,
  status: 24,
} as const;

type Padrao = { nome: string; re: RegExp; validar?: (trecho: string) => boolean; substituir?: (trecho: string, ...grupos: unknown[]) => string };

function entropia(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function pareceTokenAleatorio(s: string): boolean {
  return /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && entropia(s) >= 3.5;
}

/** Palavras que anunciam uma senha ou chave. Aceita prefixo de variável (DB_, SMTP_, GITHUB_). */
const PALAVRAS_DE_SENHA = String.raw`(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-]){0,4}(?:pass(?:word|wd|phrase)?|pwd|senha|secret|segredo|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?)`;

/** Palavras de senha da linguagem natural: "senha é X", "a senha X", "password is X". */
const SENHA_NATURAL = String.raw`(?<![\p{L}\p{N}_])(?:senhas?|passwords?|passwd|pwd)`;
/** Verbos que ligam a palavra de senha ao valor. */
const VERBOS_DE_SENHA = String.raw`(?:é|e|eh|era|será|sera|seria|fica|ficou|virou|são|sao|foi|is|was|are|will\s+be)`;
/** O valor: texto entre aspas ou o termo seguinte (nunca o que já é [oculto]). */
const TERMO_DE_SENHA = String.raw`(?!\[oculto\])(?:"[^"\n]*"|'[^'\n]*'|\S+)`;

/**
 * O termo depois de uma palavra de senha tem cara de senha? Com 4 caracteres ou mais e um dígito, um símbolo ou uma
 * maiúscula no meio: "senha é obrigatória" fica como está. Texto entre aspas tem as aspas como símbolo.
 */
function pareceSenha(trecho: string): boolean {
  const termo = /(?:"[^"\n]*"|'[^'\n]*'|\S+)$/u.exec(trecho)?.[0] ?? '';
  if (termo.includes(MASCARA)) return false;
  const nucleo = [...termo.replace(/^[(\[]+/, '').replace(/[.,;:!?)\]]+$/, '')];
  if (nucleo.length < 4) return false;
  const texto = nucleo.join('');
  return /\d/.test(texto) || /[^\p{L}\p{N}]/u.test(texto) || /\p{Lu}/u.test(nucleo.slice(1).join(''));
}

/** Troca o termo (com as aspas, se houver) por [oculto], deixando de fora o parêntese de abertura e a pontuação final. */
function mascararTermoDeSenha(termo: string): string {
  const inicio = /^[(\[]+/.exec(termo)?.[0] ?? '';
  const fim = /[.,;:!?)\]]+$/.exec(termo)?.[0] ?? '';
  return `${inicio}${MASCARA}${fim}`;
}

/**
 * Segunda barreira. A ordem importa: blocos e conexões antes de e-mail; CNPJ antes de CPF.
 * Cada trecho encontrado vira `[oculto]` (na senha, só o valor: "senha: [oculto]").
 */
export const PADROES_SEGREDO: readonly Padrao[] = [
  { nome: 'chave-privada', re: /-----BEGIN[A-Z ]*-----[\s\S]*?(?:-----END[A-Z ]*-----|$)/g },
  { nome: 'conexao', re: /\b[a-z][a-z0-9+.-]{1,24}:\/\/[^\s:@/]+:[^\s@/]+@\S*/gi },
  { nome: 'conexao', re: /\b(?:server|data source|host|uid|user id)\s*=[^;\n]*;[^\n]*?(?:password|pwd)\s*=[^;\s]+;?/gi },
  { nome: 'webhook', re: /https?:\/\/(?:[a-z0-9-]+\.)*(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\/\S+/gi },
  // Senha: só o valor some (o primeiro termo depois de "senha:", "password=" e afins, ou o texto entre aspas).
  {
    nome: 'senha',
    re: new RegExp('(' + PALAVRAS_DE_SENHA + String.raw`\s*[=:]\s*)(?!\[oculto\])(?:"[^"\n]*"?|'[^'\n]*'?|[^\s,;]+)`, 'gi'),
    substituir: (_m, prefixo) => `${String(prefixo)}${MASCARA}`,
  },
  // Senha em linguagem natural: "senha é X", "senha do wifi é X", "password is X" (até três palavras antes do verbo)
  // e "a senha X". Só o termo seguinte some, e só quando tem cara de senha.
  {
    nome: 'senha',
    re: new RegExp('(' + SENHA_NATURAL + String.raw`(?:\s+(?!` + VERBOS_DE_SENHA + String.raw`(?:\s|$))\S+){0,3}?\s+` + VERBOS_DE_SENHA + String.raw`\s+)(` + TERMO_DE_SENHA + ')', 'giu'),
    validar: pareceSenha,
    substituir: (_m, prefixo, termo) => `${String(prefixo)}${mascararTermoDeSenha(String(termo))}`,
  },
  {
    nome: 'senha',
    re: new RegExp('(' + SENHA_NATURAL + String.raw`\s+)(` + TERMO_DE_SENHA + ')', 'giu'),
    validar: pareceSenha,
    substituir: (_m, prefixo, termo) => `${String(prefixo)}${mascararTermoDeSenha(String(termo))}`,
  },
  { nome: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { nome: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g },
  { nome: 'chave-api', re: /(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}/g },
  { nome: 'chave-api', re: /(?<![A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { nome: 'github', re: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { nome: 'gitlab', re: /(?<![A-Za-z0-9])gl(?:pat|dt|ptt|rt|cbt|imt|soat|ft|agent|oas)-[A-Za-z0-9_-]{10,}/g },
  { nome: 'supabase', re: /(?<![A-Za-z0-9])sb[ps]_[A-Za-z0-9]{20,}/g },
  { nome: 'discord', re: /(?<![A-Za-z0-9])[MNO][A-Za-z0-9_-]{22,27}\.[A-Za-z0-9_-]{5,7}\.[A-Za-z0-9_-]{25,40}/g },
  { nome: 'telegram', re: /(?<!\d)\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g },
  { nome: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { nome: 'aws', re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g },
  { nome: 'slack', re: /(?<![A-Za-z0-9])xox[abeprs]-[A-Za-z0-9-]{10,}/g },
  { nome: 'google', re: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/g },
  { nome: 'npm', re: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{30,}/g },
  { nome: 'huggingface', re: /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}/g },
  { nome: 'openmausbot', re: /(?<![A-Za-z0-9])omb_sess_[A-Za-z0-9_-]{8,}/g },
  // E-mail com acento ou letra de outro alfabeto no nome e no domínio.
  { nome: 'email', re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  { nome: 'cnpj', re: /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g },
  { nome: 'cpf', re: /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g },
  { nome: 'cpf', re: /(?<!\d)\d{11}(?!\d)/g },
  { nome: 'cartao', re: /(?<!\d)(?:\d{4}[\s-]?){3}\d{4}(?!\d)/g },
  // Telefone com ou sem parênteses, com ou sem +55: (62) 99876-5432, 62 99876-5432, 6299876-5432.
  { nome: 'telefone', re: /(?<![\d.])(?:\+?55[\s.-]?)?\(?[1-9]\d\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/g },
  { nome: 'hex-longo', re: /(?<![A-Za-z0-9])[0-9a-fA-F]{32,}(?![A-Za-z0-9])/g, validar: (s) => /\d/.test(s) && /[a-f]/i.test(s) },
  { nome: 'token-longo', re: /[A-Za-z0-9+/_=-]{32,}/g, validar: pareceTokenAleatorio },
];

/** Padrões que não valem para identificadores (UUID e hash podem ter 11 ou 14 dígitos seguidos por acaso). */
const NOMES_SO_TEXTO: ReadonlySet<string> = new Set(['cpf', 'cnpj', 'telefone', 'token-longo', 'hex-longo', 'cartao']);

/** Versão estrita, para detectar (guarda da saída): só o que é inequivocamente caminho pessoal. */
const PADROES_CAMINHO_ESTRITO: readonly { nome: string; re: RegExp }[] = [
  { nome: 'caminho-windows', re: /[A-Za-z]:[\\/]/g },
  { nome: 'caminho-unc', re: /(?:\\\\|(?<![:/\w])\/\/)[^\s\\/]+[\\/]/g },
  { nome: 'caminho-casa', re: /(?<![\w])~[\\/]/g },
  { nome: 'caminho-variavel', re: /%(?:USERPROFILE|LOCALAPPDATA|APPDATA|TEMP|TMP|HOMEPATH|HOMEDRIVE)%/gi },
  { nome: 'caminho-unix', re: /(?<![\w.])\/(?:home|Users|root|mnt|private|var\/folders)\/[^\s/]+/g },
];

function casa(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  return re.exec(s);
}

// Montados pelo código (e não escritos no fonte): assim o arquivo não guarda travessão, meia-risca nem invisíveis.
const cc = (...codigos: number[]): string => String.fromCharCode(...codigos);
/** Controle C0 e C1 e separadores de linha: viram espaço. */
const CONTROLE = new RegExp('[' + cc(0x00) + '-' + cc(0x1f) + cc(0x7f) + '-' + cc(0x9f, 0x2028, 0x2029) + ']', 'g');
/** Formato (Cf), ignoráveis (largura zero, bidi, etiquetas, seletores de variação): somem antes de qualquer máscara. */
const INVISIVEIS = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const PICTOGRAFICO = new RegExp('[' + String.raw`\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}` + cc(0x20e3) + ']', 'gu');
/** Barras parecidas (divisão, fração, desenho de caixa) viram a barra de verdade, para o caminho não escapar. */
const BARRAS_PARECIDAS = new RegExp('[' + cc(0x2215, 0x2044, 0x29f8, 0x2571) + ']', 'g');
const CONTRABARRAS_PARECIDAS = new RegExp('[' + cc(0x2216, 0x29f9, 0x2572) + ']', 'g');
const TRACOS_LONGOS = new RegExp(String.raw`\s*[` + cc(0x2013, 0x2014) + String.raw`]\s*`, 'g');
/** Ordinais e expoentes do português ficam fora do NFKC: "2ª etapa", "nº 5", "m²", "m³". */
const PRESERVADOS_NFKC = new RegExp('([' + cc(0xaa, 0xba, 0xb2, 0xb3) + '])');

/** NFKC para largura total e afins (dígito e letra de largura total viram ASCII), sem mexer em ª, º, ² e ³. */
function nfkcSeletivo(valor: string): string {
  if (!PRESERVADOS_NFKC.test(valor)) return valor.normalize('NFKC');
  return valor
    .split(PRESERVADOS_NFKC)
    .map((p, i) => (i % 2 === 1 ? p : p.normalize('NFKC')))
    .join('');
}

/**
 * Primeira camada: forma canônica do texto. NFKC seletivo, sem invisível, sem pictograma, barras parecidas
 * trocadas, controle virando espaço.
 */
export function normalizarTexto(valor: string): string {
  return nfkcSeletivo(valor)
    .replace(INVISIVEIS, '')
    .replace(PICTOGRAFICO, '')
    .replace(BARRAS_PARECIDAS, '/')
    .replace(CONTRABARRAS_PARECIDAS, '\\')
    .replace(CONTROLE, ' ');
}

// Caminhos. O texto é lido termo a termo (separados por espaço). Um caminho começa num começo absoluto (C:\, \\,
// //, ~/, %VAR%\, file://, /pasta/) ou num termo com barra, e continua pelos termos seguintes enquanto vierem
// pedaços dele: atravessa espaços (pasta com espaço no nome), com teto de termos sem barra no meio (6 depois de um
// começo absoluto, 3 num caminho relativo), e para num novo começo de caminho, num termo protegido (data, fração,
// par curto, valor por unidade, rota, pasta solta), depois de um nome de arquivo com extensão, no fim da frase e
// quando a barra muda de tipo. O caminho inteiro vira o último pedaço.

/** Começos de caminho absoluto: file://, unidade (C:\ ou C:/, nunca C:// de URL), UNC, ~/, %VARIAVEL%\ e /pasta/. */
const INICIO_CAMINHO = new RegExp(
  [
    String.raw`file:\/\/`,
    String.raw`[A-Za-z]:(?:\\|\/(?!\/))`,
    String.raw`\\\\(?=[^\s\\])`,
    String.raw`(?<![\w:\/\\])\/\/(?=[^\s\/])`,
    String.raw`(?<![\w.\/\\-])~[\\\/]`,
    String.raw`%[A-Za-z_][A-Za-z0-9_]*%[\\\/]`,
    String.raw`(?<![\w.:\/\\~%-])\/(?=[^\s\/"'<>|]+\/)`,
  ].join('|'),
  'gi',
);

/** Data, hora ou fração (só dígitos entre as barras): não é caminho. */
const TOKEN_NUMERICO = /^[(\["']*[\d.,:-]*\d[\d.,:-]*(?:[\\/][\d.,:-]*\d[\d.,:-]*)+[)\]"'.,;:!?]*$/;
const TOKEN_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
/** Começo de rota de API (não é pasta): /api/eventos, /v1/usuarios e afins, em minúsculas e sem extensão. */
const PREFIXOS_DE_ROTA: ReadonlySet<string> = new Set(['api', 'v1', 'v2', 'v3', 'v4', 'graphql', 'auth', 'oauth', 'admin', 'health', 'healthz', 'metrics', 'ws', 'rpc', 'rest', 'webhooks']);

function ehTokenNumerico(token: string): boolean {
  return TOKEN_NUMERICO.test(token);
}

/** O termo sem a pontuação de fora (parênteses, aspas, vírgula, ponto final). */
function semPontuacao(token: string): string {
  return token.replace(/^[(\["']+/, '').replace(/[)\]"'.,;:!?]+$/, '');
}

/** Pedaço que é só o começo do caminho (unidade, variável, ~, esquema): não serve de nome curto. */
function ehPedacoDeRaiz(p: string): boolean {
  return /^[A-Za-z]:$/.test(p) || /^%[^%]+%$/.test(p) || p === '~' || /^[A-Za-z][A-Za-z0-9+.-]*:$/.test(p) || p === '?' || p === '.';
}

function ultimoPedaco(caminho: string): string {
  const partes = caminho.split(/[\\/]+/).filter((p) => p.trim().length > 0 && !ehPedacoDeRaiz(p.trim()));
  return partes.at(-1)?.trim() ?? MASCARA_CAMINHO;
}

/** Dois pedaços curtos (até 4 caracteres, sem ponto) ou valor por unidade: e/ou, CI/CD, km/h, R$ 1.000/mês. */
function ehParCurto(token: string): boolean {
  if (token.includes('\\')) return false;
  const pedacos = semPontuacao(token).split('/');
  const curto = (p: string) => p.length > 0 && p.length <= 4 && !p.includes('.') && !p.includes(':');
  const valor = (p: string) => /^(?:R\$|US\$|\$)?\d[\d.,]*$/.test(p);
  return pedacos.length === 2 && pedacos.every((p) => curto(p) || valor(p));
}

function ehRota(token: string): boolean {
  const m = /^\/([a-z0-9_-]{1,32})(?:\/[a-z0-9_{}:-]{1,32}){1,3}\/?$/.exec(semPontuacao(token));
  return m !== null && PREFIXOS_DE_ROTA.has(m[1] ?? '');
}

type ClasseDoTermo = 'simples' | 'protegido' | 'par' | 'caminho';

/**
 * simples: sem barra. protegido: data, fração, par curto, valor por unidade, rota de API ou pasta solta ("src/",
 * "/saude"); nunca é caminho. par: dois pedaços em minúsculas (input/output, frontend/backend); fica quando está
 * sozinho, vira caminho perto de outro termo com barra. caminho: o resto com barra.
 */
function classeDoTermo(token: string): ClasseDoTermo {
  if (!/[\\/]/.test(token)) return 'simples';
  if (ehTokenNumerico(token) || ehParCurto(token) || ehRota(token)) return 'protegido';
  const t = semPontuacao(token);
  const pedacos = t.split(/[\\/]+/).filter((p) => p.length > 0);
  if (!t.includes('\\') && !t.startsWith('//') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) && pedacos.length <= 1) return 'protegido';
  if (/^[a-zà-ÿ]{1,16}\/[a-zà-ÿ]{1,16}$/.test(t)) return 'par';
  return 'caminho';
}

/** Posição do começo de caminho absoluto dentro do termo (rota de API não conta), ou -1. */
function inicioAbsoluto(token: string): number {
  INICIO_CAMINHO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INICIO_CAMINHO.exec(token)) !== null) {
    const resto = token.slice(m.index);
    if (m[0] === '/' && ehRota(resto)) continue;
    return m.index;
  }
  return -1;
}

/** Tipo de barra de um pedaço de caminho: invertida, normal ou as duas. */
function tipoDeBarra(t: string): 'invertida' | 'normal' | 'mista' {
  const inv = t.includes('\\');
  const nor = t.includes('/');
  return inv && nor ? 'mista' : inv ? 'invertida' : 'normal';
}

/** Termo que fecha o caminho: termina num nome de arquivo com extensão, numa URL ou no fim da frase. */
function fechaCaminho(token: string): boolean {
  if (/[.,;:!?)\]"']$/.test(token) && !/\.[A-Za-z0-9]{1,8}$/.test(token)) return true;
  if (TOKEN_URL.test(token)) return true;
  const ultimo = semPontuacao(token).split(/[\\/]/).at(-1) ?? '';
  return /[^.]\.[A-Za-z0-9]{1,8}$/.test(ultimo);
}

type Termo = { t: string; ini: number; fim: number };

/** Índice do último termo com barra que ainda é do caminho que começa em `i`. */
function fimDoCaminho(termos: Termo[], i: number, absoluto: boolean, tipo: ReturnType<typeof tipoDeBarra>): { ultimo: number; pedacos: number } {
  let ultimo = i;
  let pedacos = 1;
  const primeiro = termos[i];
  if (!primeiro || fechaCaminho(primeiro.t)) return { ultimo, pedacos };
  const teto = absoluto ? 6 : 3;
  let simples = 0;
  for (let j = i + 1; j < termos.length; j++) {
    const t = termos[j]?.t ?? '';
    if (inicioAbsoluto(t) >= 0) break;
    // "Acme Ltda/": o último pedaço da pasta, terminado em barra, fecha o caminho.
    if (/^[^\\/\s]+[\\/]+[)\]"'.,;:!?]*$/.test(t) && !ehTokenNumerico(t)) {
      ultimo = j;
      pedacos++;
      break;
    }
    const classe = classeDoTermo(t);
    if (classe === 'protegido') break;
    if (classe === 'simples') {
      simples++;
      if (simples > teto || /[.,;:!?]$/.test(t)) break;
      continue;
    }
    if (TOKEN_URL.test(t)) break;
    const tipoAqui = tipoDeBarra(t);
    if (tipo !== 'mista' && tipoAqui !== 'mista' && tipoAqui !== tipo) break;
    ultimo = j;
    pedacos++;
    simples = 0;
    if (fechaCaminho(t)) break;
  }
  return { ultimo, pedacos };
}

/** O caminho inteiro (que pode ter espaços) vira o último pedaço; terminado em barra, o pedaço antes dela. */
function nomeCurtoDoTrecho(trecho: string): string {
  const corte = Math.max(trecho.lastIndexOf('/'), trecho.lastIndexOf('\\'));
  const depois = corte >= 0 ? trecho.slice(corte + 1) : trecho;
  if (depois.trim().length > 0) return depois;
  return ultimoPedaco(trecho);
}

/** Troca cada caminho (absoluto ou relativo, com ou sem espaço) pelo último pedaço. */
export function substituirCaminhos(texto: string): string {
  const termos: Termo[] = [...texto.matchAll(/\S+/g)].map((m) => ({ t: m[0], ini: m.index ?? 0, fim: (m.index ?? 0) + m[0].length }));
  const trocas: { ini: number; fim: number; por: string }[] = [];
  for (let i = 0; i < termos.length; i++) {
    const termo = termos[i];
    if (!termo) continue;
    const abs = inicioAbsoluto(termo.t);
    if (abs >= 0) {
      const { ultimo } = fimDoCaminho(termos, i, true, tipoDeBarra(termo.t.slice(abs)));
      const ini = termo.ini + abs;
      const fim = termos[ultimo]?.fim ?? termo.fim;
      trocas.push({ ini, fim, por: nomeCurtoDoTrecho(texto.slice(ini, fim)) });
      i = ultimo;
      continue;
    }
    const classe = classeDoTermo(termo.t);
    if (classe !== 'caminho' && classe !== 'par') continue;
    const { ultimo, pedacos } = fimDoCaminho(termos, i, false, tipoDeBarra(termo.t));
    if (classe === 'par' && pedacos === 1) continue;
    const prefixo = /^[(\["']*/.exec(termo.t)?.[0] ?? '';
    const ini = termo.ini + prefixo.length;
    const fim = termos[ultimo]?.fim ?? termo.fim;
    trocas.push({ ini, fim, por: nomeCurtoDoTrecho(texto.slice(ini, fim)) });
    i = ultimo;
  }
  if (trocas.length === 0) return texto;
  let saida = '';
  let pos = 0;
  for (const t of trocas) {
    saida += texto.slice(pos, t.ini) + t.por;
    pos = t.fim;
  }
  return saida + texto.slice(pos);
}

/** Troca cada segredo reconhecido por `[oculto]`. */
export function mascararSegredos(texto: string): string {
  let t = texto;
  for (const p of PADROES_SEGREDO) {
    t = t.replace(p.re, (m: string, ...grupos: unknown[]) => {
      if (p.validar && !p.validar(m)) return m;
      return p.substituir ? p.substituir(m, ...grupos) : MASCARA;
    });
  }
  return t;
}

/** Nomes dos padrões proibidos encontrados no texto (segredos e caminhos pessoais). Lista vazia = limpo. */
export function encontrarProblemas(texto: string, comoIdentificador = false): string[] {
  const achados = new Set<string>();
  for (const p of PADROES_SEGREDO) {
    if (comoIdentificador && NOMES_SO_TEXTO.has(p.nome)) continue;
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(texto)) !== null) {
      if (!p.validar || p.validar(m[0])) {
        achados.add(p.nome);
        break;
      }
      if (m[0].length === 0) p.re.lastIndex++;
    }
  }
  for (const p of PADROES_CAMINHO_ESTRITO) if (casa(p.re, texto)) achados.add(p.nome);
  return [...achados];
}

export function contemCaminho(texto: string): boolean {
  return PADROES_CAMINHO_ESTRITO.some((p) => casa(p.re, texto) !== null);
}

export type Contador = { mascarados: number };

/**
 * Texto curto de uma linha, pronto para sair: forma canônica, sem caminho, sem segredo, sem emoji, sem travessão
 * e com no máximo `max` caracteres.
 */
export function sanearTexto(valor: string, max: number, contador?: Contador): string {
  // Só o começo interessa (a saída tem no máximo `max`); o corte também limita o custo das regex.
  let t = normalizarTexto(String(valor).slice(0, Math.max(1024, max * 8)));
  const antes = t;
  // Segredo dentro de URL (webhook, conexão) sai antes de a URL virar o último pedaço; depois, de novo.
  t = mascararSegredos(t);
  t = substituirCaminhos(t);
  t = mascararSegredos(t);
  if (t !== antes && contador) contador.mascarados++;
  t = t.replace(TRACOS_LONGOS, ', ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, Math.max(1, max - 3)).trimEnd() + '...';
  return t;
}

/** Nome curto de arquivo: só o último pedaço, saneado. */
export function nomeCurtoDeArquivo(alvo: string, contador?: Contador): string | undefined {
  const base = ultimoPedaco(normalizarTexto(String(alvo)).trim());
  if (base === MASCARA_CAMINHO) return undefined;
  const limpo = sanearTexto(base, LIMITES.alvo, contador);
  return limpo.length > 0 && limpo !== MASCARA ? limpo : undefined;
}

// Guarda da saída: detector bruto, escrito à parte das regex do saneamento.

const G_INVISIVEL = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const G_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const G_UNIDADE = /[A-Za-z]:[\\/]/;
const G_CASA = /(?:^|[^\w.])~[\\/]/;
const G_VARIAVEL = /%[A-Za-z_][A-Za-z0-9_]*%/;
const G_ARROBA = /[^\s@]@[^\s@.]+\.[^\s@]/u;
const G_PREFIXO = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]|github_pat_|gl(?:pat|dt|ptt|rt|cbt|imt|soat|ft|agent|oas)-|sk-[A-Za-z0-9]|(?:sk|rk|pk)_(?:live|test)|xox[abeprs]-|xapp-|(?:AKIA|ASIA)[0-9A-Z]{12}|AIza[0-9A-Za-z_-]{16}|npm_[A-Za-z0-9]{8}|hf_[A-Za-z0-9]{8}|sb[ps]_[A-Za-z0-9]{8}|omb_sess_|eyJ[A-Za-z0-9_-]{8}|SG\.[A-Za-z0-9_-]{8}|-----BEGIN)`,
);
/** Palavra de senha com atribuição e um valor que ainda não foi mascarado. */
const G_PALAVRA = new RegExp(PALAVRAS_DE_SENHA + String.raw`\s*[=:]\s*(?!\[oculto\])\S`, 'i');

/**
 * Barra separando pedaços: caminho ou resto de caminho. Ficam de fora data, fração, par curto, valor por unidade,
 * rota de API, pasta solta e o par em minúsculas sozinho; dois termos com barra perto um do outro são caminho.
 */
function gBarra(t: string, comoId: boolean): boolean {
  if (t.includes('\\')) return true;
  const termos = t.match(/\S+/g) ?? [];
  if (comoId) return termos.some((x) => x.includes('/') && !ehTokenNumerico(x));
  let ultimoPar = -10;
  for (let i = 0; i < termos.length; i++) {
    const classe = classeDoTermo(termos[i] ?? '');
    if (classe === 'caminho') return true;
    if (classe === 'par') {
      if (i - ultimoPar <= 4) return true;
      ultimoPar = i;
    }
  }
  return false;
}

/**
 * Dez dígitos ou mais num grupo ligado por ponto, hífen ou barra (documento, telefone, cartão). Espaço separa
 * números ("portas 8799 18799"); data, hora e versão (2.1.296, v2026.10.22) ficam de fora.
 */
function gDigitos(t: string): boolean {
  const s = t
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    .replace(/(?<![\d.])[vV]?\d{1,4}(?:\.\d{1,4}){1,3}(?![\d.]|[-/]\d)/g, ' ')
    .replace(/[()]/g, '');
  for (const m of s.matchAll(/\d+(?:[.\-/]\d+)*/g)) {
    if (m[0].replace(/\D/g, '').length >= 10) return true;
  }
  return false;
}

/**
 * Trecho denso de letras e números (cara de chave, token ou hash): muitos pedaços curtos trocando de caixa ou entre
 * letra e dígito. Identificador em CamelCase (OAuth2PKCEFlowHandlerV2, ControleDeEstoqueWPF) tem pedaços longos.
 */
function gDenso(t: string): boolean {
  for (const m of t.matchAll(/[A-Za-z0-9]{16,}/g)) {
    const s = m[0];
    const pedacos = s.match(/[A-Z]+[a-z]*|[a-z]+|\d+/g) ?? [];
    if (pedacos.length >= 6 && s.length / pedacos.length < 3.2) return true;
  }
  return false;
}

/**
 * Detector bruto da guarda. Não reaproveita as regex do saneamento: procura formas (barra entre pedaços, arroba
 * com domínio, muitos dígitos, trecho denso, prefixo de segredo, palavra de senha com atribuição, invisível).
 * Em identificador (`comoId`) e em nome de sala (`nomeDePasta`, que vem do nome da pasta), não olha dígitos nem
 * densidade (UUID, hash e "ProjetoFinal2026v2" são normais ali).
 */
export function detectarBruto(texto: string, comoId = false, nomeDePasta = false): string[] {
  const achados: string[] = [];
  if (G_INVISIVEL.test(texto)) achados.push('invisivel');
  const t = texto.normalize('NFKC');
  if (G_URL.test(t)) achados.push('url');
  if (G_UNIDADE.test(t) || G_CASA.test(t) || G_VARIAVEL.test(t)) achados.push('caminho');
  if (gBarra(t, comoId)) achados.push('barra');
  if (G_ARROBA.test(t)) achados.push('arroba');
  if (G_PREFIXO.test(t)) achados.push('prefixo-de-segredo');
  if (G_PALAVRA.test(t)) achados.push('palavra-de-senha');
  if (!comoId && !nomeDePasta) {
    if (gDigitos(t)) achados.push('digitos');
    if (gDenso(t)) achados.push('denso');
  }
  return achados;
}

/** Nomes de propriedade do Object: nunca servem de chave (um mapa comum devolveria a função herdada). */
export const NOMES_RESERVADOS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Ferramentas genéricas dos motores: o nome pode sair. Qualquer outra vira a categoria (MCP pode revelar cliente). */
const FERRAMENTAS_CONHECIDAS: ReadonlySet<string> = new Set([
  // Claude Code
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Bash', 'BashOutput', 'KillShell', 'KillBash',
  'PowerShell', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'TodoRead',
  'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'Skill', 'SlashCommand', 'ToolSearch', 'Monitor',
  'TaskCreate', 'TaskUpdate', 'TaskStop', 'TaskList', 'TaskGet', 'TaskOutput', 'SendMessage', 'SubagentHandback',
  'Workflow',
  // Codex
  'apply_patch', 'shell', 'exec_command', 'write_stdin', 'view_image', 'web_search', 'spawn_agent', 'update_plan',
  'read_file', 'list_dir', 'grep_files', 'local_shell', 'unified_exec', 'exec', 'js', 'send_message', 'followup_task',
  'wait_agent', 'list_agents', 'request_user_input_async', 'run', 'sleep',
  // OpenMausBot
  'coordinate_bots',
]);

const NOME_POR_CATEGORIA: Record<CategoriaFerramenta, string> = {
  ler: 'leitura',
  editar: 'edição',
  comando: 'comando',
  web: 'web',
  navegador: 'navegador',
  delegar: 'delegação',
  integracao: 'integração',
  outro: 'ferramenta',
};

export function nomeDeFerramentaSeguro(nome: string, categoria: CategoriaFerramenta): string {
  const n = nome.trim();
  if (FERRAMENTAS_CONHECIDAS.has(n)) return n;
  const semPrefixo = n.replace(/^mcp__(?:(?!__).)+__/, '');
  if (semPrefixo !== n && FERRAMENTAS_CONHECIDAS.has(semPrefixo)) return semPrefixo;
  if (/^mcp(__|_|$)/i.test(n) || n.includes('__')) return 'MCP';
  return NOME_POR_CATEGORIA[categoria];
}

const REGEX_COR = /^(?:#[0-9a-fA-F]{3,8}|[a-z]{3,16})$/;
const REGEX_CORPO = /^[a-z][a-z0-9-]{0,23}$/;
const REGEX_STATUS = /^[a-z_-]{1,24}$/;

export type OpcoesSaneamento = {
  /** `privacidade.mostrarNomeCurtoDoArquivo` da configuração (padrão: não). */
  permitirAlvo?: boolean;
  /** `privacidade.mostrarTituloDaTarefa` da configuração (padrão: sim). */
  permitirTitulo?: boolean;
};

export type ResultadoSaneamento =
  | { ok: true; evento: ArcadiaEvent; descartados: number; mascarados: number }
  | { ok: false; problemas: string[] };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function contarDescartes(bruto: unknown, limpo: unknown): number {
  if (!ehObjeto(bruto) || !ehObjeto(limpo)) return 0;
  let n = 0;
  for (const k of Object.keys(bruto)) {
    if (!Object.hasOwn(limpo, k)) n++;
    else n += contarDescartes(bruto[k], limpo[k]);
  }
  return n;
}

function textoOuNada(valor: string | undefined, max: number, c: Contador): string | undefined {
  if (valor === undefined) return undefined;
  const t = sanearTexto(valor, max, c);
  return t.length > 0 ? t : undefined;
}

function numero(v: number | undefined, casas = 0): number | undefined {
  if (v === undefined || !Number.isFinite(v) || v < 0) return undefined;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

/** Monta um objeto sem as chaves `undefined` (forma estável para JSON e comparação). */
export function compactar<T extends Record<string, unknown>>(obj: T): T {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) saida[k] = v;
  return saida as T;
}

/** Identificador que não pode sair: padrão proibido (saneamento ou guarda) ou nome de propriedade do Object. */
export function identificadorProibido(id: string): boolean {
  return NOMES_RESERVADOS.has(id) || encontrarProblemas(id, true).length > 0 || detectarBruto(id, true).length > 0;
}

/**
 * Porta de entrada de todo evento: valida pelo esquema (campos fora da allowlist são descartados),
 * saneia cada texto e aplica as opções de privacidade. Nunca devolve valores do evento nos problemas.
 */
export function sanearEvento(bruto: unknown, opcoes: OpcoesSaneamento = {}): ResultadoSaneamento {
  if (!ehObjeto(bruto)) return { ok: false, problemas: ['o evento não é um objeto'] };
  const r = EsquemaArcadiaEvent.safeParse(bruto);
  if (!r.success) {
    return { ok: false, problemas: r.error.issues.map((i) => `${i.path.map((p) => (typeof p === 'number' ? p : /^[A-Za-z]{1,24}$/.test(String(p)) ? String(p) : '?')).join('.') || '(raiz)'}: ${i.code}`) };
  }
  const e = r.data;
  // Identificador não passa por máscara (quebraria a referência): com segredo dentro, o evento inteiro fica de fora.
  const ids = [
    e.id, e.agente.chave, e.agente.paiChave, e.local.projetoChave, e.ferramenta?.id, e.delegacao?.de, e.delegacao?.para,
    e.delegacao?.jobId, e.tarefa?.chave, e.turno?.chave, e.local.sala?.ala,
  ];
  if (ids.some((id) => id !== undefined && identificadorProibido(id))) {
    return { ok: false, problemas: ['identificador com padrão proibido (segredo, caminho ou nome reservado)'] };
  }
  const c: Contador = { mascarados: 0 };
  const permitirTitulo = opcoes.permitirTitulo ?? true;
  const permitirAlvo = opcoes.permitirAlvo ?? false;

  const agente = compactar({
    chave: e.agente.chave,
    tipo: e.agente.tipo,
    nome: textoOuNada(e.agente.nome, LIMITES.nome, c),
    cargo: textoOuNada(e.agente.cargo, LIMITES.cargo, c),
    cor: e.agente.cor !== undefined && REGEX_COR.test(e.agente.cor) ? e.agente.cor : undefined,
    corpo: e.agente.corpo !== undefined && REGEX_CORPO.test(e.agente.corpo) ? e.agente.corpo : undefined,
    paiChave: e.agente.paiChave,
  });

  const sala = e.local.sala
    ? compactar({
        nome: textoOuNada(e.local.sala.nome, LIMITES.sala, c) ?? 'Sala',
        ala: e.local.sala.ala,
        tipo: e.local.sala.tipo,
      })
    : undefined;
  const local = compactar({
    projetoChave: e.local.projetoChave,
    equipe: textoOuNada(e.local.equipe, LIMITES.equipe, c),
    sala,
    excluida: e.local.excluida === true ? (true as const) : undefined,
  });

  const evento: ArcadiaEvent = {
    v: 1,
    id: e.id,
    ts: Math.floor(e.ts),
    recebidoEm: Math.floor(e.recebidoEm),
    origem: e.origem,
    motor: e.motor,
    agente,
    local,
    tipo: e.tipo,
  };

  if (e.ferramenta) {
    evento.ferramenta = compactar({
      nome: nomeDeFerramentaSeguro(e.ferramenta.nome, e.ferramenta.categoria),
      categoria: e.ferramenta.categoria,
      alvo: permitirAlvo && e.ferramenta.alvo !== undefined ? nomeCurtoDeArquivo(e.ferramenta.alvo, c) : undefined,
      ok: e.ferramenta.ok,
      duracaoMs: numero(e.ferramenta.duracaoMs),
      id: e.ferramenta.id,
    });
  }
  if (e.espera) evento.espera = { tipo: e.espera.tipo };
  if (e.delegacao) {
    evento.delegacao = compactar({
      de: e.delegacao.de,
      para: e.delegacao.para,
      jobId: e.delegacao.jobId,
      titulo: permitirTitulo ? textoOuNada(e.delegacao.titulo, LIMITES.titulo, c) : undefined,
      status: e.delegacao.status !== undefined && REGEX_STATUS.test(e.delegacao.status) ? e.delegacao.status : undefined,
    });
  }
  if (e.uso) {
    evento.uso = compactar({
      entrada: numero(e.uso.entrada),
      saida: numero(e.uso.saida),
      cache: numero(e.uso.cache),
      custoUsd: numero(e.uso.custoUsd, 6),
    });
  }
  if (e.tarefa) {
    const tarefa = compactar({
      chave: e.tarefa.chave,
      titulo: permitirTitulo ? textoOuNada(e.tarefa.titulo, LIMITES.titulo, c) : undefined,
    });
    if (Object.keys(tarefa).length > 0) evento.tarefa = tarefa;
  }
  if (e.turno) {
    const turno = compactar({ chave: e.turno.chave, texto: e.turno.texto, interrompido: e.turno.interrompido });
    if (Object.keys(turno).length > 0) evento.turno = turno;
  }
  if (e.presenca) evento.presenca = { estado: e.presenca.estado };

  return { ok: true, evento, descartados: contarDescartes(bruto, r.data), mascarados: c.mascarados };
}

/**
 * Campos que guardam identificadores, nomes de enum ou códigos (não texto livre). Neles a guarda não procura
 * dígitos nem trecho denso, porque um UUID pode ter 11 dígitos seguidos por acaso. Os identificadores
 * já passam pela regex de `REGEX_ID` na entrada (sem espaço, barra, arroba ou porcentagem).
 */
export const CAMPOS_ID: ReadonlySet<string> = new Set([
  'id', 'chave', 'paiChave', 'projetoChave', 'salaChave', 'agenteChave', 'de', 'para', 'jobId', 'alaId', 'ala',
  'origem', 'motor', 'tipo', 'estado', 'categoria', 'corpo', 'cor', 'buildId', 'instancia', 'status', 'k', 'dia',
  'fonte', 'motivo', 'ordem', 'salaPendente', 'recepcaoId',
]);

function problemasDoTexto(texto: string, comoId: boolean, nomeDePasta = false): string[] {
  const a = encontrarProblemas(texto, comoId);
  for (const b of detectarBruto(texto, comoId, nomeDePasta)) if (!a.includes(b)) a.push(b);
  return a;
}

/** O campo é o nome de uma sala (vem do nome da pasta): `salas.<chave>.nome`, `sala.nome`, `local.sala.nome`. */
function ehNomeDeSala(caminho: string): boolean {
  return /(?:^|\.)(?:salas\.[^.[\]]+|sala)\.nome$/.test(caminho);
}

/**
 * Inspeciona um valor que vai sair (snapshot, quadro do SSE, linha do banco) e devolve onde há texto proibido.
 * Lista vazia = limpo. Junta as regex do saneamento e o detector bruto da guarda.
 */
export function inspecionarSaida(valor: unknown, caminho = '', campo = ''): string[] {
  if (typeof valor === 'string') {
    return problemasDoTexto(valor, CAMPOS_ID.has(campo), ehNomeDeSala(caminho)).map((p) => `${caminho || '(raiz)'}: ${p}`);
  }
  if (Array.isArray(valor)) return valor.flatMap((x, i) => inspecionarSaida(x, `${caminho}[${i}]`, campo));
  if (ehObjeto(valor)) {
    const saida: string[] = [];
    for (const [k, x] of Object.entries(valor)) {
      const aqui = caminho ? `${caminho}.${k}` : k;
      for (const p of problemasDoTexto(k, true)) saida.push(`${aqui} (chave): ${p}`);
      saida.push(...inspecionarSaida(x, aqui, k));
    }
    return saida;
  }
  return [];
}

/**
 * Guarda da saída: troca por `[oculto]` qualquer texto que o detector bruto ou as regex reprovem. Devolve o mesmo
 * objeto quando está limpo (o caso normal) e conta o que bloqueou.
 */
export function protegerSaida<T>(valor: T, contador?: Contador, prefixo = ''): T {
  if (inspecionarSaida(valor, prefixo).length === 0) return valor;
  return limparProfundo(valor, prefixo, '', contador) as T;
}

function limparProfundo(v: unknown, caminho: string, campo: string, contador?: Contador): unknown {
  if (typeof v === 'string') {
    if (problemasDoTexto(v, CAMPOS_ID.has(campo), ehNomeDeSala(caminho)).length === 0) return v;
    if (contador) contador.mascarados++;
    return MASCARA;
  }
  if (Array.isArray(v)) return v.map((x, i) => limparProfundo(x, `${caminho}[${i}]`, campo, contador));
  if (ehObjeto(v)) {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const chave = problemasDoTexto(k, true).length > 0 ? MASCARA : k;
      const aqui = caminho ? `${caminho}.${k}` : k;
      Object.defineProperty(saida, chave, { value: limparProfundo(x, aqui, k, contador), enumerable: true, writable: true, configurable: true });
    }
    return saida;
  }
  return v;
}
