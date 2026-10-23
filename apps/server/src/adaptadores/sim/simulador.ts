// Simulador determinístico: mesma semente e mesmo início dão exatamente os mesmos eventos.
// Serve para desenvolver, testar e demonstrar sem nenhuma fonte ligada. Nomes, salas e equipes são inventados e
// genéricos; as alas vêm da configuração (sem ala, a sala vai para a Recepção).
import type { ArcadiaEvent, CategoriaFerramenta, Motor, TipoAgente, TipoEspera, TipoSala } from '@arcadia/shared';
import type { Relogio, Agendamento } from '../../util/relogio.ts';

export const CENARIOS = ['dia-normal', 'pico', 'falhas', 'esperando-voce', '30-agentes', 'sala-nova', 'visitante'] as const;
export type Cenario = (typeof CENARIOS)[number];

export const DESCRICAO_CENARIO: Record<Cenario, string> = {
  'dia-normal': 'uma equipe de bots e algumas sessões num ritmo comum, com pausas e uma delegação',
  pico: 'muita gente trabalhando ao mesmo tempo, com rajadas de eventos',
  falhas: 'ferramentas que falham, turno com erro, limite de uso e uma ferramenta que trava',
  'esperando-voce': 'agentes parados esperando permissão, resposta e aprovação',
  '30-agentes': 'trinta agentes em doze salas',
  'sala-nova': 'projeto novo vira sala com obra; outro cai na Recepção e depois é classificado',
  visitante: 'sessões que chegam pelo teletransporte, trabalham com subagente e vão embora',
};

export const DURACAO_PADRAO_MS: Record<Cenario, number> = {
  'dia-normal': 30 * 60_000,
  pico: 5 * 60_000,
  falhas: 15 * 60_000,
  'esperando-voce': 15 * 60_000,
  '30-agentes': 20 * 60_000,
  'sala-nova': 10 * 60_000,
  visitante: 10 * 60_000,
};

export type OpcoesCenario = {
  semente: number;
  inicio: number;
  duracaoMs?: number;
  /** Ids das alas disponíveis (da configuração). */
  alas?: string[];
  /** Rodada da simulação ao vivo (muda os ids dos eventos e o sorteio, mantém agentes e salas). */
  rodada?: number;
};

export function ehCenario(valor: string): valor is Cenario {
  return (CENARIOS as readonly string[]).includes(valor);
}

/** Gerador pseudoaleatório mulberry32: rápido, pequeno e determinístico. */
export function criarSorteio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOMES_SALA = [
  'Portal Aurora', 'App Brisa', 'Loja Cometa', 'Painel Duna', 'API Eclipse', 'Vídeo Farol', 'Estudo Geada', 'Site Horizonte',
  'Agenda Íris', 'Jogo Jade', 'Mapa Lótus', 'Rádio Maré', 'Guia Nimbo', 'Catálogo Ônix', 'Bot Prisma', 'Quiz Quasar',
];
const TIPOS_SALA_SIM: TipoSala[] = ['web', 'app', 'backend', 'video', 'pesquisa', 'web', 'app', 'outro'];
const CARGOS = ['Coordenação', 'Pesquisa', 'Código', 'Revisão', 'Testes', 'Dados', 'Design', 'Suporte'];
const CORES = ['green', 'blue', 'red', 'orange', 'purple', 'cyan', 'pink', 'yellow', 'teal', 'coral'];
const CORPOS = ['cursor', 'blob', 'circle', 'squircle', 'capsule', 'drop', 'shield', 'hexagon', 'diamond', 'star'];
const EQUIPES = ['Equipe Alfa', 'Equipe Beta', 'Equipe Gama'];
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TITULOS = [
  'Revisar a tela inicial', 'Corrigir o teste de login', 'Escrever o resumo da semana', 'Ajustar as cores do painel',
  'Medir o tempo de carga', 'Organizar as rotas', 'Conferir o texto do cartão', 'Preparar o roteiro do vídeo',
];
const ARQUIVOS = ['index.ts', 'App.tsx', 'motor.ts', 'README.md', 'estilos.css', 'rotas.ts', 'login.spec.ts', 'config.json', 'roteiro.md'];
const FERRAMENTAS: Record<Motor, Partial<Record<CategoriaFerramenta, string[]>>> = {
  claude: { ler: ['Read', 'Grep', 'Glob'], web: ['WebFetch', 'WebSearch'], editar: ['Edit', 'Write'], comando: ['Bash', 'PowerShell'], delegar: ['Task'] },
  codex: { ler: ['read_file', 'grep_files'], web: ['web_search'], editar: ['apply_patch'], comando: ['exec_command'], delegar: ['spawn_agent'] },
  outro: { ler: ['Read'], editar: ['Edit'], comando: ['Bash'] },
};
const MISTURA: CategoriaFerramenta[] = ['ler', 'ler', 'ler', 'editar', 'editar', 'comando', 'web', 'ler', 'editar', 'comando'];

type SalaSim = { chave: string; nome: string; ala?: string; tipo: TipoSala };

type Persona = {
  chave: string;
  tipo: TipoAgente;
  motor: Motor;
  nome?: string;
  cargo?: string;
  cor?: string;
  corpo?: string;
  equipe?: string;
  paiChave?: string;
  sala: SalaSim;
};

function slug(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

class Roteiro {
  eventos: { ev: ArcadiaEvent; ordem: number }[] = [];
  n = 0;
  prefixo: string;
  fim: number;
  sorteio: () => number;
  ferramentas = 0;

  constructor(prefixo: string, fim: number, sorteio: () => number) {
    this.prefixo = prefixo;
    this.fim = fim;
    this.sorteio = sorteio;
  }

  entre(min: number, max: number): number {
    return min + this.sorteio() * (max - min);
  }
  inteiro(min: number, max: number): number {
    return Math.floor(this.entre(min, max + 1));
  }
  escolher<T>(lista: readonly T[]): T {
    const item = lista[Math.floor(this.sorteio() * lista.length)];
    if (item === undefined) throw new Error('lista vazia');
    return item;
  }

  add(t: number, p: Persona, tipo: ArcadiaEvent['tipo'], extra: Partial<ArcadiaEvent> = {}, comSala = false): void {
    if (t > this.fim) return;
    this.n++;
    const agente: ArcadiaEvent['agente'] = { chave: p.chave, tipo: p.tipo };
    if (p.nome !== undefined) agente.nome = p.nome;
    if (p.cargo !== undefined) agente.cargo = p.cargo;
    if (p.cor !== undefined) agente.cor = p.cor;
    if (p.corpo !== undefined) agente.corpo = p.corpo;
    if (p.paiChave !== undefined) agente.paiChave = p.paiChave;
    const local: ArcadiaEvent['local'] = {};
    if (comSala) {
      local.projetoChave = p.sala.chave;
      local.sala = p.sala.ala !== undefined ? { nome: p.sala.nome, ala: p.sala.ala, tipo: p.sala.tipo } : { nome: p.sala.nome, tipo: p.sala.tipo };
    }
    if (p.equipe !== undefined) local.equipe = p.equipe;
    const ts = Math.round(t);
    this.eventos.push({
      ev: { v: 1, id: `${this.prefixo}:${this.n}`, ts, recebidoEm: ts, origem: 'sim', motor: p.motor, agente, local, tipo, ...extra },
      ordem: this.n,
    });
  }

  ferramenta(t: number, p: Persona, categoria: CategoriaFerramenta, duracao: number, opcoes: { falha?: boolean } = {}): number {
    const nomes = FERRAMENTAS[p.motor][categoria] ?? FERRAMENTAS.claude[categoria] ?? ['Read'];
    const nome = this.escolher(nomes);
    this.ferramentas++;
    const id = `f${this.ferramentas}`;
    const alvo = categoria === 'ler' || categoria === 'editar' ? this.escolher(ARQUIVOS) : undefined;
    const ferramenta = alvo !== undefined ? { nome, categoria, alvo, id } : { nome, categoria, id };
    this.add(t, p, 'ferramenta.inicio', { ferramenta }, categoria === 'editar');
    const fim = t + duracao;
    if (opcoes.falha) this.add(fim, p, 'ferramenta.erro', { ferramenta: { nome, categoria, id, ok: false, duracaoMs: Math.round(duracao) } });
    else this.add(fim, p, 'ferramenta.fim', { ferramenta: { nome, categoria, id, ok: true, duracaoMs: Math.round(duracao) } });
    return fim;
  }

  /** Um turno completo. Bot fecha com turno.fim (sinal exato); sessão termina em texto e o motor fecha em 5 s. */
  turno(t0: number, p: Persona, opcoes: { ferramentas?: [number, number]; probErro?: number; titulo?: string } = {}): number {
    let t = t0;
    const tarefa = opcoes.titulo !== undefined ? { titulo: opcoes.titulo } : undefined;
    this.add(t, p, p.tipo === 'bot' ? 'turno.inicio' : 'pedido.humano', tarefa ? { tarefa } : {}, true);
    t += this.entre(400, 1_500);
    this.add(t, p, 'pensando');
    const [min, max] = opcoes.ferramentas ?? [2, 7];
    const quantas = this.inteiro(min, max);
    for (let i = 0; i < quantas; i++) {
      t += this.entre(200, 900);
      const cat = this.escolher(MISTURA);
      const dur = cat === 'comando' ? this.entre(800, 5_500) : this.entre(120, 1_400);
      t = this.ferramenta(t, p, cat, dur, { falha: this.sorteio() < (opcoes.probErro ?? 0.03) });
      if (this.sorteio() < 0.4) {
        t += this.entre(300, 1_200);
        this.add(t, p, 'pensando');
      }
    }
    t += this.entre(500, 2_000);
    if (p.tipo === 'bot') this.add(t, p, 'turno.fim');
    else this.add(t, p, 'pensando', { turno: { texto: true } });
    const entrada = this.inteiro(800, 9_000);
    const saida = this.inteiro(200, 2_500);
    this.add(t + 50, p, 'uso', { uso: { entrada, saida, cache: this.inteiro(0, 20_000), custoUsd: Math.round((entrada * 3 + saida * 15) / 10) / 100_000 } });
    return t + (p.tipo === 'bot' ? 300 : 5_500);
  }

  /** Coordenador manda trabalho para um colega, que recebe, trabalha e devolve. */
  delegacao(t0: number, de: Persona, para: Persona, jobId: string): number {
    let t = t0;
    const titulo = this.escolher(TITULOS);
    this.add(t, de, 'turno.inicio', {}, true);
    t += this.entre(400, 1_000);
    this.ferramentas++;
    const id = `f${this.ferramentas}`;
    this.add(t, de, 'ferramenta.inicio', { ferramenta: { nome: 'coordinate_bots', categoria: 'delegar', id } });
    t += 200;
    this.add(t, de, 'delegacao.enviada', { delegacao: { de: de.chave, para: para.chave, jobId, titulo, status: 'queued' } });
    t += this.entre(600, 1_500);
    this.add(t, para, 'delegacao.recebida', { delegacao: { de: de.chave, para: para.chave, jobId, titulo, status: 'running' }, tarefa: { titulo } }, true);
    t = this.turno(t + 200, para, { titulo });
    this.add(t, para, 'delegacao.concluida', { delegacao: { de: de.chave, para: para.chave, jobId, status: 'completed' } });
    t += 300;
    this.add(t, de, 'ferramenta.fim', { ferramenta: { nome: 'coordinate_bots', categoria: 'delegar', id, ok: true } });
    t += this.entre(500, 1_500);
    this.add(t, de, 'turno.fim');
    return t + 300;
  }

  espera(t0: number, p: Persona, tipo: Exclude<TipoEspera, 'talvez'>, duracao: number): number {
    let t = t0;
    this.add(t, p, p.tipo === 'bot' ? 'turno.inicio' : 'pedido.humano', {}, true);
    t += this.entre(500, 1_200);
    const nome = tipo === 'pergunta' ? 'AskUserQuestion' : 'Bash';
    const categoria: CategoriaFerramenta = tipo === 'pergunta' ? 'outro' : 'comando';
    this.ferramentas++;
    const id = `f${this.ferramentas}`;
    this.add(t, p, 'ferramenta.inicio', { ferramenta: { nome, categoria, id } });
    t += 300;
    this.add(t, p, 'espera.inicio', { espera: { tipo } });
    t += duracao;
    this.add(t, p, 'espera.fim');
    t += this.entre(300, 2_000);
    this.add(t, p, 'ferramenta.fim', { ferramenta: { nome, categoria, id, ok: true } });
    t += this.entre(500, 1_500);
    if (p.tipo === 'bot') this.add(t, p, 'turno.fim');
    else this.add(t, p, 'pensando', { turno: { texto: true } });
    return t + 5_500;
  }

  ordenados(): ArcadiaEvent[] {
    return this.eventos.sort((a, b) => a.ev.ts - b.ev.ts || a.ordem - b.ordem).map((x) => x.ev);
  }
}

function criarSalas(quantas: number, alas: string[], semAlaACada = 6, deslocamento = 0): SalaSim[] {
  const salas: SalaSim[] = [];
  for (let i = 0; i < quantas; i++) {
    const nome = NOMES_SALA[(i + deslocamento) % NOMES_SALA.length] ?? `Sala ${i + 1}`;
    const tipo = TIPOS_SALA_SIM[(i + deslocamento) % TIPOS_SALA_SIM.length] ?? 'outro';
    const s: SalaSim = { chave: `sim-${slug(nome)}`, nome, tipo };
    const semAla = semAlaACada > 0 && i % semAlaACada === semAlaACada - 1;
    if (!semAla && alas.length > 0) s.ala = alas[i % alas.length] as string;
    salas.push(s);
  }
  return salas;
}

function criarBots(quantos: number, equipe: string, sala: SalaSim, base: number): Persona[] {
  const bots: Persona[] = [];
  for (let i = 0; i < quantos; i++) {
    const idx = base + i;
    bots.push({
      chave: `sim:bot-${idx + 1}`,
      tipo: 'bot',
      motor: 'claude',
      nome: `Unidade ${LETRAS[idx % LETRAS.length]}${Math.floor(idx / LETRAS.length) + 1}`,
      cargo: CARGOS[i % CARGOS.length] ?? 'Código',
      cor: CORES[idx % CORES.length] ?? 'blue',
      corpo: CORPOS[(idx * 3) % CORPOS.length] ?? 'cursor',
      equipe,
      sala,
    });
  }
  return bots;
}

function criarSessoes(quantas: number, motor: Motor, salas: SalaSim[], base: number): Persona[] {
  const s: Persona[] = [];
  for (let i = 0; i < quantas; i++) {
    const sala = salas[(base + i) % salas.length];
    if (!sala) continue;
    s.push({ chave: `sim:${motor}-${base + i + 1}`, tipo: 'sessao', motor, sala });
  }
  return s;
}

/** Laço de trabalho de um agente: turnos com intervalos (alguns longos o bastante para pausa e sono). */
function rotina(
  r: Roteiro,
  p: Persona,
  inicio: number,
  fim: number,
  opcoes: { pausa: [number, number]; probErro?: number; ferramentas?: [number, number]; semChegada?: boolean },
): void {
  let t = inicio;
  if (p.tipo === 'bot') r.add(t, p, 'sessao.inicio', {}, true);
  else if (!opcoes.semChegada) {
    r.add(t, p, 'sessao.inicio', {}, true);
    t += r.entre(1_000, 4_000);
  }
  while (t < fim) {
    const o: { probErro?: number; ferramentas?: [number, number] } = {};
    if (opcoes.probErro !== undefined) o.probErro = opcoes.probErro;
    if (opcoes.ferramentas !== undefined) o.ferramentas = opcoes.ferramentas;
    t = r.turno(t, p, o);
    t += r.entre(opcoes.pausa[0], opcoes.pausa[1]);
  }
}

export function gerarCenario(cenario: Cenario, opcoes: OpcoesCenario): ArcadiaEvent[] {
  const rodada = opcoes.rodada ?? 0;
  const inicio = opcoes.inicio;
  const fim = inicio + (opcoes.duracaoMs ?? DURACAO_PADRAO_MS[cenario]);
  const sorteio = criarSorteio((opcoes.semente * 1_000_003 + rodada * 7_919) >>> 0);
  // O início entra no id: religar o simulador na mesma pasta de dados não gera eventos "duplicados".
  const r = new Roteiro(`sim:${cenario}:${opcoes.semente}:${inicio.toString(36)}:${rodada}`, fim, sorteio);
  const alas = opcoes.alas ?? [];

  switch (cenario) {
    case 'dia-normal': {
      const salas = criarSalas(6, alas);
      const [qg, s1, s2, s3, s4] = salas as [SalaSim, SalaSim, SalaSim, SalaSim, SalaSim, SalaSim];
      const bots = criarBots(3, EQUIPES[0] ?? 'Equipe', qg, 0);
      const sessoes = [...criarSessoes(3, 'claude', [s1, s2, s3], 0), ...criarSessoes(1, 'codex', [s4], 0)];
      const [coord, b2, b3] = bots as [Persona, Persona, Persona];
      for (const b of bots) r.add(inicio + r.entre(0, 2_000), b, 'sessao.inicio', {}, true);
      let t = inicio + 5_000;
      let job = 0;
      while (t < fim) {
        job++;
        t = r.delegacao(t, coord, job % 2 ? b2 : b3, `sim-job-${rodada}-${job}`);
        t += r.entre(60_000, 240_000);
      }
      for (const s of sessoes) rotina(r, s, inicio + r.entre(0, 30_000), fim, { pausa: [20_000, 300_000] });
      const quem = sessoes[0];
      if (quem) r.espera(inicio + 12 * 60_000, quem, 'pergunta', 40_000);
      break;
    }
    case 'pico': {
      const salas = criarSalas(8, alas);
      const bots = criarBots(4, EQUIPES[0] ?? 'Equipe', salas[0] as SalaSim, 0);
      const sessoes = [...criarSessoes(6, 'claude', salas.slice(1), 0), ...criarSessoes(2, 'codex', salas.slice(1), 6)];
      for (const p of [...bots, ...sessoes]) rotina(r, p, inicio + r.entre(0, 5_000), fim, { pausa: [500, 6_000], ferramentas: [4, 12] });
      break;
    }
    case 'falhas': {
      const salas = criarSalas(4, alas);
      const bots = criarBots(2, EQUIPES[0] ?? 'Equipe', salas[0] as SalaSim, 0);
      const sessoes = criarSessoes(3, 'claude', salas.slice(1), 0);
      for (const p of [...bots, ...sessoes]) rotina(r, p, inicio + r.entre(0, 10_000), fim, { pausa: [10_000, 60_000], probErro: 0.3 });
      const [b1, b2] = bots as [Persona, Persona];
      r.add(inicio + 4 * 60_000, b1, 'turno.inicio', {}, true);
      r.add(inicio + 4 * 60_000 + 1_500, b1, 'erro');
      r.add(inicio + 6 * 60_000, b2, 'limite');
      const travada: Persona = { chave: 'sim:claude-travada', tipo: 'sessao', motor: 'claude', sala: salas[1] as SalaSim };
      const t = inicio + 8 * 60_000;
      r.add(t - 3_000, travada, 'sessao.inicio', {}, true);
      r.add(t, travada, 'pedido.humano', {}, true);
      r.add(t + 1_000, travada, 'ferramenta.inicio', { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f-travada' } });
      break;
    }
    case 'esperando-voce': {
      const salas = criarSalas(3, alas);
      const bots = criarBots(2, EQUIPES[1] ?? 'Equipe', salas[0] as SalaSim, 3);
      const sessoes = criarSessoes(2, 'claude', salas.slice(1), 0);
      const [b1, b2] = bots as [Persona, Persona];
      const [s1, s2] = sessoes as [Persona, Persona];
      r.add(inicio, s1, 'sessao.inicio', {}, true);
      r.add(inicio, s2, 'sessao.inicio', {}, true);
      r.espera(inicio + 20_000, b1, 'aprovacao', 6 * 60_000);
      r.espera(inicio + 45_000, s1, 'permissao', 9 * 60_000);
      r.espera(inicio + 90_000, b2, 'pergunta', 4 * 60_000);
      const t = inicio + 3 * 60_000;
      r.add(t, s2, 'pedido.humano', {}, true);
      r.add(t + 800, s2, 'ferramenta.inicio', { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f-lenta' } });
      r.add(t + 40_000, s2, 'ferramenta.fim', { ferramenta: { nome: 'Bash', categoria: 'comando', id: 'f-lenta', ok: true } });
      r.add(t + 41_000, s2, 'pensando', { turno: { texto: true } });
      break;
    }
    case '30-agentes': {
      const salas = criarSalas(12, alas);
      const bots = [...criarBots(5, EQUIPES[0] ?? 'Equipe', salas[0] as SalaSim, 0), ...criarBots(5, EQUIPES[1] ?? 'Equipe', salas[1] as SalaSim, 5)];
      const sessoes = [...criarSessoes(15, 'claude', salas.slice(2), 0), ...criarSessoes(5, 'codex', salas.slice(2), 15)];
      for (const p of [...bots, ...sessoes]) rotina(r, p, inicio + r.entre(0, 60_000), fim, { pausa: [15_000, 240_000] });
      break;
    }
    case 'sala-nova': {
      const salas = criarSalas(2, alas, 0);
      const sessoes = criarSessoes(2, 'claude', salas, 0);
      for (const p of sessoes) rotina(r, p, inicio + r.entre(0, 5_000), fim, { pausa: [20_000, 90_000] });
      const nova: SalaSim = { chave: 'sim-obra-nova', nome: 'Obra Nova', tipo: 'web' };
      if (alas[0] !== undefined) nova.ala = alas[0];
      const pioneira: Persona = { chave: 'sim:claude-pioneira', tipo: 'sessao', motor: 'claude', sala: nova };
      rotina(r, pioneira, inicio + 60_000, fim, { pausa: [30_000, 90_000] });
      const avulsa: SalaSim = { chave: 'sim-sem-regra', nome: 'Pasta Sem Regra', tipo: 'outro' };
      const andarilha: Persona = { chave: 'sim:codex-andarilha', tipo: 'sessao', motor: 'codex', sala: avulsa };
      rotina(r, andarilha, inicio + 120_000, inicio + 4 * 60_000, { pausa: [20_000, 40_000] });
      if (alas.length > 0) {
        // O dono classificou a pasta na configuração: a mesma sala muda da Recepção para a ala.
        const classificada: SalaSim = { ...avulsa, ala: alas[alas.length - 1] as string };
        rotina(r, { ...andarilha, sala: classificada }, inicio + 5 * 60_000 + 1_000, fim, { pausa: [20_000, 60_000], semChegada: true });
      }
      break;
    }
    case 'visitante': {
      const salas = criarSalas(2, alas, 0, 6);
      const [s1, s2] = salas as [SalaSim, SalaSim];
      const claude: Persona = { chave: 'sim:visitante-claude', tipo: 'sessao', motor: 'claude', sala: s1 };
      const codex: Persona = { chave: 'sim:visitante-codex', tipo: 'sessao', motor: 'codex', sala: s2 };
      const sub: Persona = { chave: 'sim:visitante-claude:sub-1', tipo: 'subagente', motor: 'claude', paiChave: claude.chave, sala: s1 };
      let t = inicio + 2_000;
      r.add(t, claude, 'sessao.inicio', {}, true);
      t = r.turno(t + 3_000, claude);
      t += 5_000;
      r.add(t, claude, 'pedido.humano', {}, true);
      r.ferramentas++;
      const idTask = `f${r.ferramentas}`;
      r.add(t + 800, claude, 'ferramenta.inicio', { ferramenta: { nome: 'Task', categoria: 'delegar', id: idTask } });
      r.add(t + 1_200, sub, 'subagente.inicio');
      let ts = t + 1_500;
      for (let i = 0; i < 6; i++) ts = r.ferramenta(ts + r.entre(200, 800), sub, 'ler', r.entre(150, 900));
      r.add(ts + 500, sub, 'subagente.fim');
      r.add(ts + 800, claude, 'ferramenta.fim', { ferramenta: { nome: 'Task', categoria: 'delegar', id: idTask, ok: true } });
      t = ts + 2_000;
      r.add(t, claude, 'pensando', { turno: { texto: true } });
      r.add(Math.min(fim - 1, inicio + 6 * 60_000), claude, 'sessao.fim');
      let tc = inicio + 2 * 60_000;
      r.add(tc, codex, 'sessao.inicio', {}, true);
      tc = r.turno(tc + 4_000, codex);
      r.add(Math.max(tc + 30_000, inicio + 8 * 60_000), codex, 'sessao.fim');
      break;
    }
  }
  return r.ordenados();
}

export type Simulacao = {
  parar(): void;
  info(): { cenario: Cenario; semente: number; rodada: number; emitidos: number };
};

export type OpcoesSimulacao = {
  cenario: Cenario;
  semente: number;
  relogio: Relogio;
  emitir: (ev: ArcadiaEvent) => void;
  alas?: string[];
  /** 2 = duas vezes mais rápido. */
  velocidade?: number;
  /** Ao terminar, começa outra rodada (mesmos agentes e salas, sorteio novo). */
  repetir?: boolean;
  duracaoMs?: number;
};

/** Simulação ao vivo: agenda os eventos do cenário no relógio e repete, se pedido. */
export function iniciarSimulacao(op: OpcoesSimulacao): Simulacao {
  const velocidade = op.velocidade && op.velocidade > 0 ? op.velocidade : 1;
  let rodada = 0;
  let emitidos = 0;
  let parado = false;
  let pendente: Agendamento | undefined;

  function rodar(): void {
    if (parado) return;
    const inicio = op.relogio.agora();
    const opcoes: OpcoesCenario = { semente: op.semente, inicio, rodada };
    if (op.alas !== undefined) opcoes.alas = op.alas;
    if (op.duracaoMs !== undefined) opcoes.duracaoMs = op.duracaoMs;
    const fila = gerarCenario(op.cenario, opcoes);
    const duracao = opcoes.duracaoMs ?? DURACAO_PADRAO_MS[op.cenario];
    let i = 0;
    const real = (ts: number) => inicio + (ts - inicio) / velocidade;
    const proximo = () => {
      if (parado) return;
      const agora = op.relogio.agora();
      while (i < fila.length && real((fila[i] as ArcadiaEvent).ts) <= agora) {
        const ev = fila[i++] as ArcadiaEvent;
        const ts = Math.round(real(ev.ts));
        op.emitir({ ...ev, ts, recebidoEm: ts });
        emitidos++;
      }
      if (i < fila.length) {
        pendente = op.relogio.agendar(real((fila[i] as ArcadiaEvent).ts) - agora, proximo);
      } else if (op.repetir) {
        const fimDaRodada = inicio + duracao / velocidade;
        pendente = op.relogio.agendar(Math.max(0, fimDaRodada - agora), () => {
          rodada++;
          rodar();
        });
      }
    };
    proximo();
  }

  rodar();
  return {
    parar() {
      parado = true;
      pendente?.cancelar();
    },
    info: () => ({ cenario: op.cenario, semente: op.semente, rodada, emitidos }),
  };
}
