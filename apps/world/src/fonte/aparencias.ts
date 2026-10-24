// Aparência de cada agente do servidor (seção 4.2 do prompt): sessões do Claude Code em
// terracota, do Codex de casco escuro e olhos brancos; bots com a cor do OpenMausBot, o corpo
// guardado na aparência e o acessório inferido do cargo. Nada de nome fixo: só a cor, o motor
// e palavras comuns de cargo.
import type { Acessorio, AparenciaAndroide } from '../cena/formato.ts';
import type { Agente } from './tipos.ts';

/** Cores nomeadas do OpenMausBot, no tom do andar. Cor em hexadecimal passa direto. */
const CORES: Record<string, string> = {
  green: '#3fd28b', blue: '#3f8cff', red: '#e8484f', orange: '#ff9a3c', purple: '#8a5cff',
  cyan: '#3ec8e8', pink: '#ff5fa8', yellow: '#f2c230', teal: '#22c4b0', coral: '#ff7f6b',
};
const RESERVA = ['#8a5cff', '#ff5fa8', '#3f8cff', '#ff9a3c', '#22c4b0', '#3fd28b', '#f2c230', '#3ec8e8'];

function hash(s: string): number { let h = 0x811c9dc5; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); } return h >>> 0; }

export function corDoBot(cor: string | undefined, chave: string): string {
  const c = (cor ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return CORES[c] ?? RESERVA[hash(c || chave) % RESERVA.length];
}

/** Sem acento e em minúsculas, para comparar palavras de cargo. */
function simples(t: string): string { return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

const REGRAS: [RegExp, Acessorio][] = [
  [/coorden|gerent|lider|chefe|gestor|orquestr|planej|\bpm\b|produto/, 'headset'],
  [/design|arte|criativ|\bux\b|\bui\b|ilustr|visual|marca/, 'boina'],
  [/critic|revis|audit|avali|parecer/, 'monoculo'],
  [/\bqa\b|teste|valid|qualidade|pesquis|analis|dados/, 'lupa'],
  [/\bdev\b|codig|program|engenh|implement|front|back|full|software/, 'fone'],
  [/infra|devops|\bops\b|deploy|servidor|operac/, 'capacete'],
  [/segur|acesso|admin/, 'chave'],
  [/financ|jurid|venda|comercial|negoci|contab|cliente|atendimento|secret|assistente/, 'gravata'],
];

export function acessorioDoCargo(cargo: string | undefined): Acessorio {
  const c = simples(cargo ?? '');
  for (const [re, ac] of REGRAS) if (re.test(c)) return ac;
  return 'nenhum';
}

/** Chave da aparência no mundo (agentes com a mesma aparência dividem os quadros do atlas). */
export function chaveAparencia(a: Agente): string {
  if (a.tipo !== 'bot') return `srv-${a.motor}`;
  return `srv-bot-${corDoBot(a.cor, a.chave).slice(1)}-${acessorioDoCargo(a.cargo)}-${(a.corpo ?? 'cursor').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** As três aparências das sessões, assadas já na carga (quem abrir uma sessão depois não espera). */
export const APARENCIAS_SESSAO: Record<string, AparenciaAndroide> = {
  'srv-claude': { tipo: 'androide', papel: '#e0704f', acessorio: 'brilho', maoFeita: 'claude' },
  'srv-codex': { tipo: 'androide', papel: '#cfd3ea', casco: '#2f3448', visor: '#030409', olho: '#ffffff', acessorio: 'nenhum', maoFeita: 'codex' },
  'srv-outro': { tipo: 'androide', papel: '#a9aed6', acessorio: 'nenhum' },
};

export function aparenciaDoAgente(a: Agente): AparenciaAndroide {
  if (a.tipo !== 'bot') return APARENCIAS_SESSAO[`srv-${a.motor}`] ?? APARENCIAS_SESSAO['srv-outro'];
  return { tipo: 'androide', papel: corDoBot(a.cor, a.chave), acessorio: acessorioDoCargo(a.cargo), corpo: (a.corpo ?? 'cursor').toLowerCase() };
}

/** Cor do agente para drones, minidrones, faixa de eventos e cápsula. */
export function corDoAgente(a: Agente): string { return aparenciaDoAgente(a).papel; }
