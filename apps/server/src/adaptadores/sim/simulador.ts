// Simulador determinístico: mesma semente e mesmo início dão exatamente os mesmos eventos.
// Serve para desenvolver, testar e demonstrar sem nenhuma fonte ligada. Nomes, salas e equipes são inventados e
// genéricos; as alas vêm da configuração (sem ala, a sala vai para a Recepção).
import type { ArcadiaEvent, CategoriaFerramenta, EstadoAgente, Motor, TipoAgente, TipoEspera, TipoSala } from '@arcadia/shared';
import type { Relogio, Agendamento } from '../../util/relogio.ts';

export const CENARIOS = ['dia-normal', 'pico', 'falhas', 'esperando-voce', '30-agentes', 'sala-nova', 'visitante', 'estados'] as const;
export type Cenario = (typeof CENARIOS)[number];

export const DESCRICAO_CENARIO: Record<Cenario, string> = {
  'dia-normal': 'uma equipe de bots e algumas sessões num ritmo comum, com pausas e uma delegação',
  pico: 'muita gente trabalhando ao mesmo tempo, com rajadas de eventos',
  falhas: 'ferramentas que falham, turno com erro, limite de uso e uma ferramenta que trava',
  'esperando-voce': 'agentes parados esperando permissão, resposta e aprovação',
  '30-agentes': 'trinta agentes em doze salas',
  'sala-nova': 'projeto novo vira sala com obra; outro cai na Recepção e depois é classificado',
  visitante: 'sessões que chegam pelo teletransporte, trabalham com subagente e vão embora',
  estados: 'todos os estados da seção 4.3, um de cada vez, numa ordem fixa e documentada (portão G3)',
};

export const DURACAO_PADRAO_MS: Record<Cenario, number> = {
  'dia-normal': 30 * 60_000,
  pico: 5 * 60_000,
  falhas: 15 * 60_000,
  'esperando-voce': 15 * 60_000,
  '30-agentes': 20 * 60_000,
  'sala-nova': 10 * 60_000,
  visitante: 10 * 60_000,
  estados: 225_000,
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

/** Agentes do cenário "estados" (chaves fixas, para o G3 achar cada um). */
export const AGENTES_ESTADOS = {
  sessao: 'sim:estados-sessao',
  subagente: 'sim:estados-sessao:sub-1',
  coordenacao: 'sim:estados-bot-1',
  colega: 'sim:estados-bot-2',
  suporte: 'sim:estados-bot-3',
  pioneira: 'sim:estados-pioneira',
} as const;

export type PassoEstados = {
  /** Segundos desde o começo da rodada, na velocidade 1. */
  t: number;
  /** Chave do agente (ver AGENTES_ESTADOS). */
  agente: string;
  /** Estado que o agente mostra a partir deste instante; "fora" é quando ele some do mundo. */
  estado: EstadoAgente | 'fora';
  /** O que conferir no mundo neste passo. */
  conferir: string;
  /** Só com o ócio curto da configuração de teste (pausa em 15 s, sono em 30 s); com o padrão, o estado anterior fica. */
  ocioCurto?: true;
};

const S = AGENTES_ESTADOS.sessao;
const SA = AGENTES_ESTADOS.subagente;
const B1 = AGENTES_ESTADOS.coordenacao;
const B2 = AGENTES_ESTADOS.colega;
const B3 = AGENTES_ESTADOS.suporte;
const P = AGENTES_ESTADOS.pioneira;

/**
 * Roteiro do cenário "estados", na ordem: cada estado da seção 4.3 (e talvez esperando, saindo, pausa e sono) fica
 * alguns segundos, um de cada vez. Os tempos e a ordem são fixos; a semente só troca enfeites (nome do arquivo e
 * título da delegação). Feito para a velocidade 1: os timers do motor (chegada, texto, talvez, pausa, sono) não
 * aceleram. Cada rodada dura 225 s e abre uma sala nova.
 */
export const ROTEIRO_ESTADOS: readonly PassoEstados[] = [
  { t: 5, agente: S, estado: 'chegando', conferir: 'a sessão chega pelo teletransporte e anda até a Sala dos Estados' },
  { t: 15, agente: S, estado: 'ocioso', conferir: 'parada, sem atividade (a chegada fecha sozinha em 10 s)' },
  { t: 19, agente: S, estado: 'pensando', conferir: 'pedido do humano: olhos para cima, três pontos' },
  { t: 25, agente: S, estado: 'lendo', conferir: 'Read: olhos para baixo, holograma de texto, nome curto do arquivo' },
  { t: 31, agente: S, estado: 'editando', conferir: 'Edit: digitando, holograma de código' },
  { t: 37, agente: S, estado: 'comando', conferir: 'Bash: terminal verde' },
  { t: 43, agente: S, estado: 'delegando', conferir: 'Task: a sessão manda um subagente' },
  { t: 44, agente: SA, estado: 'pensando', conferir: 'o subagente nasce (minidrone) na sala da sessão' },
  { t: 45, agente: SA, estado: 'lendo', conferir: 'o subagente lê dois arquivos' },
  { t: 52, agente: SA, estado: 'pensando', conferir: 'o subagente fecha o trabalho' },
  { t: 53, agente: SA, estado: 'saindo', conferir: 'o subagente entrega para a sessão e vai embora' },
  { t: 53.5, agente: S, estado: 'pensando', conferir: 'a sessão recebe a entrega do subagente' },
  { t: 55, agente: S, estado: 'trabalhando', conferir: 'ferramenta de outro tipo, que não devolve resultado' },
  { t: 62, agente: S, estado: 'talvez-esperando', conferir: '7 s sem resultado e sem sinal exato: talvez esperando (não é o âmbar)' },
  { t: 63, agente: SA, estado: 'fora', conferir: 'o subagente some do mundo' },
  { t: 68, agente: S, estado: 'pensando', conferir: 'a ferramenta devolveu o resultado' },
  { t: 70, agente: S, estado: 'comando', conferir: 'Bash que vai pedir permissão' },
  { t: 71, agente: S, estado: 'esperando', conferir: 'esperando você: olhos "! !", coluna âmbar, item na fila "Precisa de você"' },
  { t: 79, agente: S, estado: 'comando', conferir: 'espera resolvida: drone verde leva o check e a fila esvazia' },
  { t: 80, agente: S, estado: 'pensando', conferir: 'o comando terminou' },
  { t: 82, agente: S, estado: 'comando', conferir: 'outro Bash' },
  { t: 83, agente: S, estado: 'erro', conferir: 'a ferramenta falhou: olhos "X X", fumaça, contador de erros' },
  { t: 89, agente: S, estado: 'pensando', conferir: 'resposta só de texto: o turno fecha sozinho em 5 s' },
  { t: 94, agente: S, estado: 'entregou', conferir: 'confete, drone com pacote até o Núcleo, contador de entregas' },
  { t: 100, agente: B1, estado: 'pensando', conferir: 'o bot de coordenação começa um turno no QG' },
  { t: 102, agente: B1, estado: 'delegando', conferir: 'delegação entre bots: drone com envelope até o colega' },
  { t: 104, agente: S, estado: 'pausa', conferir: 'a sessão vai à academia ou ao lounge', ocioCurto: true },
  { t: 105, agente: B2, estado: 'pensando', conferir: 'o colega recebe a delegação (com o título da tarefa)' },
  { t: 106, agente: B2, estado: 'lendo', conferir: 'o colega lê' },
  { t: 110, agente: B2, estado: 'editando', conferir: 'o colega edita' },
  { t: 114, agente: B2, estado: 'pensando', conferir: 'o colega fecha o trabalho' },
  { t: 115.2, agente: B2, estado: 'entregou', conferir: 'o colega entrega e a delegação some' },
  { t: 116, agente: B1, estado: 'pensando', conferir: 'o drone volta com a conclusão' },
  { t: 117, agente: B1, estado: 'entregou', conferir: 'o bot de coordenação entrega' },
  { t: 119, agente: S, estado: 'dormindo', conferir: 'a sessão dorme', ocioCurto: true },
  { t: 125, agente: B3, estado: 'na-fila', conferir: 'bot na fila: espera na recepção' },
  { t: 130.2, agente: B2, estado: 'pausa', conferir: 'o colega vai descansar', ocioCurto: true },
  { t: 132, agente: B1, estado: 'pausa', conferir: 'o bot de coordenação vai descansar', ocioCurto: true },
  { t: 133, agente: B3, estado: 'sem-sinal', conferir: 'sem sinal: congelado e translúcido' },
  { t: 141, agente: B3, estado: 'limite', conferir: 'limite de uso: apagão na ala do motor' },
  { t: 145.2, agente: B2, estado: 'dormindo', conferir: 'o colega dorme', ocioCurto: true },
  { t: 147, agente: B1, estado: 'dormindo', conferir: 'o bot de coordenação dorme', ocioCurto: true },
  { t: 149, agente: B3, estado: 'ocioso', conferir: 'o limite passou' },
  { t: 155, agente: P, estado: 'chegando', conferir: 'sala nova nascendo: obra por 60 s, e a pioneira chega nela' },
  { t: 156, agente: B3, estado: 'pausa', conferir: 'o bot de suporte vai descansar', ocioCurto: true },
  { t: 165, agente: P, estado: 'ocioso', conferir: 'a pioneira espera a obra' },
  { t: 170, agente: P, estado: 'pausa', conferir: 'a pioneira vai descansar', ocioCurto: true },
  { t: 171, agente: B3, estado: 'dormindo', conferir: 'o bot de suporte dorme', ocioCurto: true },
  { t: 175, agente: S, estado: 'saindo', conferir: 'a sessão termina e sai pelo teletransporte' },
  { t: 185, agente: S, estado: 'fora', conferir: 'a sessão some do mundo' },
  { t: 185, agente: P, estado: 'dormindo', conferir: 'a pioneira dorme', ocioCurto: true },
  { t: 195, agente: P, estado: 'saindo', conferir: 'a pioneira termina e sai' },
  { t: 205, agente: P, estado: 'fora', conferir: 'a pioneira some do mundo (a sala fica)' },
];

/** Monta os eventos do cenário "estados" (tempos em segundos desde o início da rodada; ver ROTEIRO_ESTADOS). */
function cenarioEstados(r: Roteiro, inicio: number, alas: string[], rodada: number): void {
  const em = (s: number) => inicio + s * 1000;
  const ala = (i: number) => alas[Math.min(i, alas.length - 1)];
  const comAla = (s: SalaSim, a: string | undefined): SalaSim => (a !== undefined ? { ...s, ala: a } : s);
  const salaDosEstados = comAla({ chave: 'sim-estados-sala', nome: 'Sala dos Estados', tipo: 'web' }, ala(0));
  const qg = comAla({ chave: 'sim-estados-qg', nome: 'QG dos Estados', tipo: 'outro' }, ala(1));
  // Uma sala nova por rodada (o início entra na chave: religar o simulador também abre uma obra).
  const obra = comAla({ chave: `sim-estados-obra-${inicio.toString(36)}`, nome: `Obra Nova ${rodada + 1}`, tipo: 'app' }, ala(2));
  const equipe = EQUIPES[0] ?? 'Equipe';
  const bot = (chave: string, i: number, cargo: string): Persona => ({
    chave, tipo: 'bot', motor: 'claude', nome: `Unidade ${LETRAS[i] ?? 'Z'}1`, cargo, cor: CORES[i] ?? 'blue', corpo: CORPOS[i * 3] ?? 'cursor', equipe, sala: qg,
  });
  const s: Persona = { chave: S, tipo: 'sessao', motor: 'claude', sala: salaDosEstados };
  const sa: Persona = { chave: SA, tipo: 'subagente', motor: 'claude', paiChave: S, sala: salaDosEstados };
  const b1 = bot(B1, 0, 'Coordenação');
  const b2 = bot(B2, 1, 'Código');
  const b3 = bot(B3, 2, 'Suporte');
  const p: Persona = { chave: P, tipo: 'sessao', motor: 'codex', sala: obra };
  const ferr = (nome: string, categoria: CategoriaFerramenta, id: string, alvo?: string) => (alvo !== undefined ? { nome, categoria, id, alvo } : { nome, categoria, id });
  const fim = (nome: string, categoria: CategoriaFerramenta, id: string, ok = true) => ({ ferramenta: { nome, categoria, id, ok } });
  const id = (n: string) => `e${rodada}-${n}`;

  // Sessão: chegada, os estados de trabalho, o subagente, talvez esperando, esperando você, erro e entrega.
  r.add(em(5), s, 'sessao.inicio', {}, true);
  r.add(em(19), s, 'pedido.humano', { tarefa: { titulo: 'Conferir os estados um por um' } }, true);
  r.add(em(25), s, 'ferramenta.inicio', { ferramenta: ferr('Read', 'ler', id('ler'), r.escolher(ARQUIVOS)) });
  // A próxima ferramenta começa antes da anterior acabar: o estado visível segue a mais nova, sem piscar.
  r.add(em(31), s, 'ferramenta.inicio', { ferramenta: ferr('Edit', 'editar', id('editar'), r.escolher(ARQUIVOS)) }, true);
  r.add(em(31.1), s, 'ferramenta.fim', fim('Read', 'ler', id('ler')));
  r.add(em(37), s, 'ferramenta.inicio', { ferramenta: ferr('Bash', 'comando', id('comando')) });
  r.add(em(37.1), s, 'ferramenta.fim', fim('Edit', 'editar', id('editar')));
  r.add(em(43), s, 'ferramenta.inicio', { ferramenta: ferr('Task', 'delegar', id('task')) });
  r.add(em(43.1), s, 'ferramenta.fim', fim('Bash', 'comando', id('comando')));
  r.add(em(44), sa, 'subagente.inicio');
  r.add(em(45), sa, 'ferramenta.inicio', { ferramenta: ferr('Grep', 'ler', id('sub-1'), r.escolher(ARQUIVOS)) });
  r.add(em(49), sa, 'ferramenta.inicio', { ferramenta: ferr('Read', 'ler', id('sub-2'), r.escolher(ARQUIVOS)) });
  r.add(em(49.1), sa, 'ferramenta.fim', fim('Grep', 'ler', id('sub-1')));
  r.add(em(52), sa, 'ferramenta.fim', fim('Read', 'ler', id('sub-2')));
  r.add(em(53), sa, 'subagente.fim');
  r.add(em(53.5), s, 'ferramenta.fim', fim('Task', 'delegar', id('task')));
  r.add(em(55), s, 'ferramenta.inicio', { ferramenta: ferr('TodoWrite', 'outro', id('outro')) });
  r.add(em(68), s, 'ferramenta.fim', fim('TodoWrite', 'outro', id('outro')));
  r.add(em(70), s, 'ferramenta.inicio', { ferramenta: ferr('Bash', 'comando', id('permissao')) });
  r.add(em(71), s, 'espera.inicio', { espera: { tipo: 'permissao' } });
  r.add(em(79), s, 'espera.fim');
  r.add(em(80), s, 'ferramenta.fim', fim('Bash', 'comando', id('permissao')));
  r.add(em(82), s, 'ferramenta.inicio', { ferramenta: ferr('Bash', 'comando', id('falha')) });
  r.add(em(83), s, 'ferramenta.erro', fim('Bash', 'comando', id('falha'), false));
  r.add(em(89), s, 'pensando', { turno: { texto: true } });
  r.add(em(175), s, 'sessao.fim');

  // Delegação entre bots, no QG.
  const job = `sim-estados-job-${inicio.toString(36)}`;
  const titulo = r.escolher(TITULOS);
  r.add(em(100), b1, 'turno.inicio', { tarefa: { titulo: 'Distribuir o trabalho' } }, true);
  r.add(em(102), b1, 'ferramenta.inicio', { ferramenta: ferr('coordinate_bots', 'delegar', id('coordenar')) });
  r.add(em(102.2), b1, 'delegacao.enviada', { delegacao: { de: B1, para: B2, jobId: job, titulo, status: 'queued' } });
  r.add(em(105), b2, 'delegacao.recebida', { delegacao: { de: B1, para: B2, jobId: job, titulo, status: 'running' }, tarefa: { titulo } }, true);
  r.add(em(106), b2, 'ferramenta.inicio', { ferramenta: ferr('Read', 'ler', id('colega-ler'), r.escolher(ARQUIVOS)) });
  r.add(em(110), b2, 'ferramenta.inicio', { ferramenta: ferr('Edit', 'editar', id('colega-editar'), r.escolher(ARQUIVOS)) }, true);
  r.add(em(110.1), b2, 'ferramenta.fim', fim('Read', 'ler', id('colega-ler')));
  r.add(em(114), b2, 'ferramenta.fim', fim('Edit', 'editar', id('colega-editar')));
  r.add(em(115), b2, 'delegacao.concluida', { delegacao: { de: B1, para: B2, jobId: job, status: 'completed' } });
  r.add(em(115.2), b2, 'turno.fim');
  r.add(em(116), b1, 'ferramenta.fim', fim('coordinate_bots', 'delegar', id('coordenar')));
  r.add(em(117), b1, 'turno.fim');

  // Fila, sem sinal e limite de uso, num bot de suporte.
  r.add(em(125), b3, 'presenca', { presenca: { estado: 'na-fila' } }, true);
  r.add(em(133), b3, 'presenca', { presenca: { estado: 'sem-sinal' } }, true);
  r.add(em(141), b3, 'limite', {}, true);
  r.add(em(149), b3, 'presenca', { presenca: { estado: 'ocioso' } }, true);

  // Sala nova: a pioneira chega numa pasta que o mundo ainda não conhecia.
  r.add(em(155), p, 'sessao.inicio', {}, true);
  r.add(em(195), p, 'sessao.fim');
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
    case 'estados':
      cenarioEstados(r, inicio, alas, rodada);
      break;
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
