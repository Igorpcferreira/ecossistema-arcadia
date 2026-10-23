// Doctor: explica em português o estado de cada fonte, o último evento, as contagens, a versão do OpenMausBot e as
// portas. Só conta arquivos e lê datas de modificação: nunca abre transcrição, rollout ou sessão. Os .key nunca.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MASCARA, VERSAO_ESQUEMA, detectarBruto, encontrarProblemas, type EstadoMundo } from '@arcadia/shared';
import type { Config } from '../config/esquema.ts';
import { DESCRICAO_ORIGEM, RAIZ_REPO, type ConfigCarregada } from '../config/carregar.ts';
import { descobrirOmb, VERSAO_CONFERIDA_OMB } from '../adaptadores/omb/cliente.ts';
import { descreverCaminho, expandir, type AmbienteCaminhos } from '../util/caminhos.ts';
import { diaTexto, horaTexto } from '../mundo/tempo.ts';
import type { Contadores } from '../nucleo.ts';
import type { DiagnosticoAdaptador } from '../adaptadores/comum.ts';
import { REGEX_ARQUIVO_SESSAO } from '../adaptadores/claude/sessoes.ts';

export type EstadoPorta = 'deste-servidor' | 'livre' | 'ocupada';

export type InfoBanco = {
  arquivo: string; eventos: number; snapshots: number; ultimoSnapshotEm?: number; ultimoEventoEm?: number; modo: string; bytes: number;
  /** Salas que nasceram de pasta fora das raízes conhecidas (só a contagem). */
  salasForaDasRaizes?: number;
  /** Agentes com marca de pasta excluída (só a contagem). */
  marcas?: number;
};

export type FonteDiagnostico = { id: string; nome: string; estado: string; linhas: string[] };

export type Diagnostico = {
  geradoEm: number;
  fuso: string;
  servidor: {
    rodando: boolean; versaoEsquema: number; node: string; buildId?: string; instancia?: string; iniciadoEm?: number; simulador?: string;
    /** Exceções não tratadas desde a partida e nos últimos 10 minutos (com alguma, a saúde responde ok falso). */
    excecoes?: number; excecoesRecentes?: number;
  };
  configuracao: { descricao: string; origem: string; avisos: string[] };
  dados: { pasta: string; existe: boolean; banco?: InfoBanco; bancoSimulador?: InfoBanco };
  portas: { nome: string; host: string; porta: number; estado: EstadoPorta; observacao?: string }[];
  fontes: FonteDiagnostico[];
  mundo?: {
    alas: number; salas: number; salasNaRecepcao: number; agentes: number; trabalhando: number; esperandoVoce: number;
    dormindo: number; conexoesSse: number; seq: number; ultimoEvento?: number;
  };
  saneamento?: Contadores & { bloqueadosNaSaida: number };
  /** Marcas de pasta excluída, salas fora das raízes conhecidas e a sonda de disco agora (só contagens). */
  privacidade?: { marcas: number; marcasDeTurno: number; salasForaDasRaizes: number; sondas: { emVoo: number; esperando: number; lentas: number } };
};

const fmt = (n: number) => n.toLocaleString('pt-BR');
/** Quebras de linha (inclusive as do Unicode), para cada item do doctor caber numa linha só. */
const QUEBRAS = new RegExp('[\r\n' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g');

function ha(agora: number, t: number | undefined): string {
  if (t === undefined || t <= 0) return 'nunca';
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

function quando(t: number, fuso: string): string {
  return `${diaTexto(t, fuso)} ${horaTexto(t, fuso).slice(0, 5)}`;
}

type Contagem = { total: number; recentes: number };

/** Conta arquivos por extensão e idade, sem abrir nenhum e sem travar o servidor (assíncrono). Não segue atalhos. */
async function contarArquivos(pasta: string, opcoes: { extensao: string; desde: number; profundidade: number; filtro?: (rel: string) => boolean }): Promise<Contagem> {
  let total = 0;
  let recentes = 0;
  const andar = async (dir: string, nivel: number, rel: string): Promise<void> => {
    if (nivel > opcoes.profundidade) return;
    let entradas: fs.Dirent[];
    try {
      entradas = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const tarefas: Promise<void>[] = [];
    for (const e of entradas) {
      const filho = path.join(dir, e.name);
      const relFilho = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) tarefas.push(andar(filho, nivel + 1, relFilho));
      else if (e.isFile() && e.name.toLowerCase().endsWith(opcoes.extensao) && (!opcoes.filtro || opcoes.filtro(relFilho))) {
        total++;
        tarefas.push(
          fs.promises.stat(filho).then(
            (s) => {
              if (s.mtimeMs >= opcoes.desde) recentes++;
            },
            () => {
              // arquivo sumiu no meio da contagem
            },
          ),
        );
      }
    }
    await Promise.all(tarefas);
  };
  await andar(pasta, 0, '');
  return { total, recentes };
}

/** Cache da contagem (60 s): cada /doctor não reconta a árvore inteira. */
const cacheContagem = new Map<string, { quando: number; r: Promise<Contagem> }>();

function contarComCache(chave: string, contar: () => Promise<Contagem>): Promise<Contagem> {
  const agora = Date.now();
  const c = cacheContagem.get(chave);
  if (c && agora - c.quando < 60_000) return c.r;
  const r = contar();
  cacheContagem.set(chave, { quando: agora, r });
  if (cacheContagem.size > 50) {
    const primeiro = cacheContagem.keys().next().value;
    if (primeiro !== undefined) cacheContagem.delete(primeiro);
  }
  return r;
}

async function pastaExiste(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export type OpcoesFontes = {
  agora: number;
  simulador?: string;
  saude?: EstadoMundo['saude'];
  /** Para testes: sem sondar o OpenMausBot. */
  semOmb?: boolean;
  /** Diagnóstico dos adaptadores em funcionamento (servidor no ar): substitui a conferência estática da fonte. */
  adaptadores?: Record<string, DiagnosticoAdaptador & { nome: string }>;
};

export async function coletarFontes(config: Config, amb: AmbienteCaminhos, op: OpcoesFontes): Promise<FonteDiagnostico[]> {
  const vivos = op.adaptadores;
  // Fonte com adaptador no ar não é conferida de novo (nem contada, nem sondada): o diagnóstico dele já diz tudo.
  const estaticas = await coletarFontesEstaticas(config, amb, op, new Set(Object.keys(vivos ?? {})));
  if (!vivos) return estaticas;
  return estaticas.map((f) => {
    const d = Object.hasOwn(vivos, f.id) ? vivos[f.id] : undefined;
    if (!d) return f;
    const linhas = [...d.linhas];
    if (d.ultimoEvento !== undefined) linhas.push(`Último evento ${ha(op.agora, d.ultimoEvento)}.`);
    return { id: f.id, nome: d.nome, estado: d.resumo, linhas };
  });
}

async function coletarFontesEstaticas(config: Config, amb: AmbienteCaminhos, op: OpcoesFontes, comAdaptador: ReadonlySet<string>): Promise<FonteDiagnostico[]> {
  const fontes: FonteDiagnostico[] = [];
  const f = config.fontes;
  const ultimo = (origem: string) => {
    const s = op.saude?.fontes[origem];
    return s ? ` Eventos recebidos: ${fmt(s.eventos)}; último ${ha(op.agora, s.ultimoEvento)}.` : '';
  };
  const lugar = (id: string, nome: string) => ({ id, nome, estado: 'com adaptador', linhas: [] as string[] });

  fontes.push(
    op.simulador
      ? { id: 'sim', nome: 'Simulador', estado: 'ligado', linhas: [`${op.simulador}.${ultimo('sim')}`] }
      : { id: 'sim', nome: 'Simulador', estado: 'desligado', linhas: ['Para ligar: npm run servidor -- --simulador dia-normal'] },
  );

  if (!f.openmausbot.ligado) {
    fontes.push({ id: 'omb', nome: 'OpenMausBot', estado: 'desligado na configuração', linhas: [] });
  } else if (comAdaptador.has('omb')) {
    fontes.push(lugar('omb', 'OpenMausBot'));
  } else if (op.semOmb) {
    fontes.push({ id: 'omb', nome: 'OpenMausBot', estado: 'não sondado', linhas: [] });
  } else {
    const d = await descobrirOmb(f.openmausbot.portas, amb.casa);
    if (d.encontrado) {
      const e = d.encontrado;
      const linhas = [`Encontrado na porta ${e.porta}, versão ${e.versao ?? 'desconhecida'}; o environment-id confere com o do app instalado.`];
      if (e.versao && e.versao !== VERSAO_CONFERIDA_OMB) linhas.push(`Versão diferente da conferida (${VERSAO_CONFERIDA_OMB}): confira o teste de contrato antes de confiar no adaptador.`);
      fontes.push({ id: 'omb', nome: 'OpenMausBot', estado: 'encontrado', linhas });
    } else if (d.recusado) {
      fontes.push({
        id: 'omb',
        nome: 'OpenMausBot',
        estado: 'recusado',
        linhas: [`Algo respondeu na porta ${d.recusado.porta}, mas o environment-id não confere com o do app instalado (ou não deu para conferir): o Arcadia não conecta. Pode ser outro programa nessa porta.`],
      });
    } else {
      fontes.push({
        id: 'omb',
        nome: 'OpenMausBot',
        estado: 'fechado',
        linhas: [`Nenhuma resposta nas portas ${f.openmausbot.portas.join(', ')} (${d.tentativas.map((t) => `${t.porta}: ${t.resultado}`).join('; ')}). O mundo segue com as outras fontes.`],
      });
    }
  }

  const desde = op.agora - f.claudeTranscricoes.catchUpHoras * 3600_000;
  const pastaFonte = (p: string) => path.resolve(amb.cwd, expandir(p, amb));
  const configurada = (p: string) => `Pasta configurada: ${descreverCaminho(pastaFonte(p), amb, RAIZ_REPO)}`;

  if (!f.claudeTranscricoes.ligado) fontes.push({ id: 'claude-transcricao', nome: 'Transcrições do Claude Code', estado: 'desligado na configuração', linhas: [] });
  else if (comAdaptador.has('claude-transcricao')) fontes.push(lugar('claude-transcricao', 'Transcrições do Claude Code'));
  else {
    const p = pastaFonte(f.claudeTranscricoes.pasta);
    if (!(await pastaExiste(p))) fontes.push({ id: 'claude-transcricao', nome: 'Transcrições do Claude Code', estado: 'pasta não encontrada', linhas: [configurada(f.claudeTranscricoes.pasta)] });
    else {
      const [sessoes, sub] = await Promise.all([
        contarComCache(`claude-sessoes|${p}|${Math.floor(desde / 60_000)}`, () => contarArquivos(p, { extensao: '.jsonl', desde, profundidade: 1 })),
        contarComCache(`claude-sub|${p}|${Math.floor(desde / 60_000)}`, () => contarArquivos(p, { extensao: '.jsonl', desde, profundidade: 4, filtro: (r) => r.includes('/subagents/') })),
      ]);
      fontes.push({
        id: 'claude-transcricao',
        nome: 'Transcrições do Claude Code',
        estado: 'pasta encontrada',
        linhas: [
          `${fmt(sessoes.total)} sessões e ${fmt(sub.total)} subagentes no disco; ${fmt(sessoes.recentes + sub.recentes)} arquivos mexidos nas últimas ${f.claudeTranscricoes.catchUpHoras} h.`,
          'O adaptador lê as transcrições quando o servidor roda com as fontes reais.',
        ],
      });
    }
  }

  if (!f.claudeSessoesVivas.ligado) fontes.push({ id: 'claude-sessoes', nome: 'Sessões vivas do Claude Code', estado: 'desligado na configuração', linhas: [] });
  else if (comAdaptador.has('claude-sessoes')) fontes.push(lugar('claude-sessoes', 'Sessões vivas do Claude Code'));
  else {
    const p = pastaFonte(f.claudeSessoesVivas.pasta);
    if (!(await pastaExiste(p))) fontes.push({ id: 'claude-sessoes', nome: 'Sessões vivas do Claude Code', estado: 'pasta não encontrada', linhas: [configurada(f.claudeSessoesVivas.pasta)] });
    else {
      const desdeHora = op.agora - 3600_000;
      const json = await contarComCache(`claude-vivas|${p}|${Math.floor(desdeHora / 60_000)}`, () =>
        contarArquivos(p, { extensao: '.json', desde: desdeHora, profundidade: 0, filtro: (r) => REGEX_ARQUIVO_SESSAO.test(r) }),
      );
      fontes.push({
        id: 'claude-sessoes',
        nome: 'Sessões vivas do Claude Code',
        estado: 'pasta encontrada',
        linhas: [`${fmt(json.total)} sessões registradas (só os <pid>.json contam; os .key nunca são abertos).`],
      });
    }
  }

  if (!f.codexRollouts.ligado) fontes.push({ id: 'codex-rollout', nome: 'Rollouts do Codex', estado: 'desligado na configuração', linhas: [] });
  else if (comAdaptador.has('codex-rollout')) fontes.push(lugar('codex-rollout', 'Rollouts do Codex'));
  else {
    const p = pastaFonte(f.codexRollouts.pasta);
    if (!(await pastaExiste(p))) fontes.push({ id: 'codex-rollout', nome: 'Rollouts do Codex', estado: 'pasta não encontrada', linhas: [configurada(f.codexRollouts.pasta)] });
    else {
      const r = await contarComCache(`codex|${p}|${Math.floor(desde / 60_000)}`, () => contarArquivos(p, { extensao: '.jsonl', desde, profundidade: 4 }));
      fontes.push({
        id: 'codex-rollout',
        nome: 'Rollouts do Codex',
        estado: 'pasta encontrada',
        linhas: [`${fmt(r.total)} rollouts no disco; ${fmt(r.recentes)} mexidos nas últimas ${f.claudeTranscricoes.catchUpHoras} h.`],
      });
    }
  }

  const fase = (ligado: boolean, nome: string, id: string, quando: string) =>
    fontes.push({ id, nome, estado: ligado ? 'pedido na configuração, ainda não existe' : 'desligado', linhas: [quando] });
  fase(f.claudeHooks.ligado, 'Hooks do Claude Code', 'claude-hook', 'Fase 6, só com o seu ok.');
  fase(f.codexHooks.ligado, 'Hooks do Codex', 'codex-hook', 'Fase 6, só com o seu ok.');
  fase(f.git.ligado, 'Entregas por git', 'git', 'Fase 5.');
  fase(f.otel.ligado, 'OpenTelemetry', 'otel', 'Opcional, Fase 6.');
  return fontes;
}

// Guarda do doctor. O doctor fala com o dono da máquina e mostra pastas no formato de descreverCaminho
// (%USERPROFILE%\..., %LOCALAPPDATA%\...); o que nunca sai é caminho absoluto, a pasta pessoal por extenso,
// e-mail e segredo. Linha reprovada vira um aviso de linha omitida.

const SEGREDOS_NO_DOCTOR = new Set(['chave-privada', 'conexao', 'webhook', 'senha', 'bearer', 'jwt', 'chave-api', 'github', 'gitlab', 'supabase', 'discord', 'telegram', 'sendgrid', 'aws', 'slack', 'google', 'npm', 'huggingface', 'openmausbot', 'email', 'cnpj', 'cpf', 'cartao']);

export function textoProibidoNoDoctor(texto: string, amb: AmbienteCaminhos): boolean {
  if (/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/.test(texto)) return true;
  if (/\\\\[^\s\\]|(?<![:/\w])\/\/[^\s/]/.test(texto)) return true;
  if (/(?<![\w.%])~[\\/]/.test(texto)) return true;
  if (/(?<![\w.%])\/(?:home|Users|root|mnt)\//.test(texto)) return true;
  const t = texto.toLowerCase();
  const casa = amb.casa.trim().toLowerCase();
  if (casa.length > 3 && (t.includes(casa) || t.includes(casa.replace(/\\/g, '/')))) return true;
  if (encontrarProblemas(texto).some((p) => SEGREDOS_NO_DOCTOR.has(p))) return true;
  return detectarBruto(texto).some((p) => p === 'arroba' || p === 'prefixo-de-segredo' || p === 'palavra-de-senha' || p === 'invisivel');
}

/** Texto do doctor pronto para sair: cada linha reprovada pela guarda vira um aviso (o resto fica). */
export function protegerTextoDoctor(texto: string, amb: AmbienteCaminhos): string {
  return texto
    .split('\n')
    .map((l) => (textoProibidoNoDoctor(l, amb) ? `${/^\s*/.exec(l)?.[0] ?? ''}[linha omitida pela guarda do doctor]` : l))
    .join('\n');
}

/** Diagnóstico pronto para sair em JSON: todo texto reprovado vira [oculto]. */
export function protegerDiagnostico<T>(valor: T, amb: AmbienteCaminhos): T {
  const limpar = (v: unknown): unknown => {
    if (typeof v === 'string') return textoProibidoNoDoctor(v, amb) ? MASCARA : v;
    if (Array.isArray(v)) return v.map(limpar);
    if (typeof v === 'object' && v !== null) {
      const saida: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) Object.defineProperty(saida, k, { value: limpar(x), enumerable: true, writable: true, configurable: true });
      return saida;
    }
    return v;
  };
  return limpar(valor) as T;
}

export function resumoDoMundo(m: EstadoMundo, conexoesSse: number, seq: number): NonNullable<Diagnostico['mundo']> {
  const agentes = Object.values(m.agentes);
  const trabalhando = new Set(['pensando', 'lendo', 'editando', 'comando', 'trabalhando', 'delegando']);
  const recepcao = Object.values(m.alas).find((a) => a.tipo === 'recepcao')?.id;
  let ultimoEvento: number | undefined;
  for (const s of Object.values(m.saude.fontes)) if (s.ultimoEvento !== undefined && (ultimoEvento === undefined || s.ultimoEvento > ultimoEvento)) ultimoEvento = s.ultimoEvento;
  const r: NonNullable<Diagnostico['mundo']> = {
    alas: Object.keys(m.alas).length,
    salas: Object.keys(m.salas).length,
    salasNaRecepcao: Object.values(m.salas).filter((s) => s.alaId === recepcao).length,
    agentes: agentes.length,
    trabalhando: agentes.filter((a) => trabalhando.has(a.estado)).length,
    esperandoVoce: m.precisaDeVoce.length,
    dormindo: agentes.filter((a) => a.estado === 'dormindo').length,
    conexoesSse,
    seq,
  };
  if (ultimoEvento !== undefined) r.ultimoEvento = ultimoEvento;
  return r;
}

/** Porta livre ou ocupada, por tentativa de conexão (sem abrir porta nenhuma). */
export function sondarPorta(host: string, porta: number, timeoutMs = 400): Promise<'livre' | 'ocupada'> {
  return new Promise((resolver) => {
    const s = net.connect({ host, port: porta });
    const fim = (r: 'livre' | 'ocupada') => {
      s.destroy();
      resolver(r);
    };
    s.setTimeout(timeoutMs, () => fim('livre'));
    s.once('connect', () => fim('ocupada'));
    s.once('error', () => fim('livre'));
  });
}

export function infoDoBanco(arquivo: string): InfoBanco | undefined {
  if (!fs.existsSync(arquivo)) return undefined;
  let bytes = 0;
  for (const sufixo of ['', '-wal', '-shm']) {
    try {
      bytes += fs.statSync(arquivo + sufixo).size;
    } catch {
      // arquivo auxiliar ausente
    }
  }
  try {
    const db = new DatabaseSync(arquivo, { readOnly: true });
    try {
      const n = (sql: string) => Number((db.prepare(sql).get() as { n: number | null }).n ?? 0);
      const modo = String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode);
      const r: InfoBanco = {
        arquivo: path.basename(arquivo),
        eventos: n('SELECT count(*) AS n FROM eventos'),
        snapshots: n('SELECT count(*) AS n FROM snapshots'),
        modo,
        bytes,
      };
      const snap = n('SELECT max(criado_em) AS n FROM snapshots');
      if (snap > 0) r.ultimoSnapshotEm = snap;
      const ev = n('SELECT max(recebido_em) AS n FROM eventos');
      if (ev > 0) r.ultimoEventoEm = ev;
      // Tabelas que um banco antigo ainda não tem: sem a tabela, sem a contagem.
      const contarSeExistir = (tabela: string): number => {
        try {
          return n(`SELECT count(*) AS n FROM ${tabela}`);
        } catch {
          return 0;
        }
      };
      const fora = contarSeExistir('salas_fora_das_raizes');
      if (fora > 0) r.salasForaDasRaizes = fora;
      const marcas = contarSeExistir('marcas_privadas');
      if (marcas > 0) r.marcas = marcas;
      return r;
    } finally {
      db.close();
    }
  } catch {
    return { arquivo: path.basename(arquivo), eventos: 0, snapshots: 0, modo: 'ilegível', bytes };
  }
}

export function descreverConfig(c: ConfigCarregada): Diagnostico['configuracao'] {
  return { descricao: c.descricao, origem: DESCRICAO_ORIGEM[c.origem], avisos: c.avisos };
}

export function descreverDados(pasta: string, amb: AmbienteCaminhos): string {
  return descreverCaminho(pasta, amb, RAIZ_REPO);
}

export function formatarDiagnostico(d: Diagnostico): string {
  const l: string[] = [];
  const agora = d.geradoEm;
  l.push('Atenção: este relatório mostra nomes de pastas desta máquina. Serve para conferir aqui; não cole em arquivo do repositório.');
  l.push(`Arcadia doctor, ${quando(agora, d.fuso)}`);
  l.push('');
  l.push('Servidor');
  if (d.servidor.rodando) {
    l.push(`  Rodando desde ${quando(d.servidor.iniciadoEm ?? agora, d.fuso)} (build ${d.servidor.buildId ?? '?'}, instância ${d.servidor.instancia ?? '?'}).`);
  } else {
    l.push('  Não está rodando. Para ligar: npm run servidor (ou npm run servidor -- --simulador dia-normal).');
  }
  l.push(`  Esquema do evento: v${d.servidor.versaoEsquema}. Node ${d.servidor.node}.`);
  if (d.servidor.simulador) l.push(`  Modo simulador: ${d.servidor.simulador}.`);
  if (d.servidor.excecoes) {
    l.push(`  Exceções não tratadas: ${fmt(d.servidor.excecoesRecentes ?? 0)} nos últimos 10 min, ${fmt(d.servidor.excecoes)} desde a partida. O servidor segue no ar.`);
    l.push('  Com exceção nos últimos 10 min, a saúde responde ok falso. No log, cada tipo de erro aparece no máximo uma vez por minuto, com a contagem das repetidas, só pelo código.');
  }
  l.push('');
  l.push('Configuração');
  l.push(`  ${d.configuracao.descricao} (${d.configuracao.origem}).`);
  for (const a of d.configuracao.avisos) l.push(`  Aviso: ${a}`);
  l.push('');
  l.push('Dados');
  l.push(`  Pasta: ${d.dados.pasta} (${d.dados.existe ? 'existe' : 'ainda não existe; o servidor cria na partida'}).`);
  const linhasBanco = (b: InfoBanco) => {
    l.push(`  Banco ${b.arquivo}: ${fmt(b.eventos)} eventos, ${fmt(b.snapshots)} snapshots, modo ${b.modo}, ${fmt(Math.round(b.bytes / 1024))} KB.`);
    l.push(`  Último evento gravado: ${ha(agora, b.ultimoEventoEm)}. Último snapshot: ${ha(agora, b.ultimoSnapshotEm)}.`);
  };
  if (d.dados.banco) linhasBanco(d.dados.banco);
  else if (d.dados.existe) l.push('  Banco ainda não criado.');
  if (d.dados.bancoSimulador) linhasBanco(d.dados.bancoSimulador);
  const fora = d.privacidade?.salasForaDasRaizes ?? d.dados.banco?.salasForaDasRaizes ?? 0;
  if (fora > 0) {
    l.push(`  Salas que nasceram de pasta fora das raízes conhecidas: ${fmt(fora)} (sessão aberta numa pasta sem regra de ala, pasta agregadora ou apelido por cima).`);
    l.push('  Para agrupar esses projetos, crie uma regra de ala (alas, regras) ou uma pasta agregadora (salas, pastasAgregadoras) que cubra essas pastas. Fora das raízes conhecidas, arquivo mexido não cria sala.');
  }
  const marcas = d.privacidade?.marcas ?? d.dados.banco?.marcas ?? 0;
  if (marcas > 0) {
    const deTurno = d.privacidade?.marcasDeTurno ?? 0;
    l.push(`  Agentes com marca de pasta excluída: ${fmt(marcas)}${deTurno > 0 ? `, dos quais ${fmt(deTurno)} só no turno atual (bot)` : ''}. Sem tarefa e sem nome de arquivo; a sessão, também sem nome.`);
  }
  l.push('');
  l.push('Portas');
  const nomesPorta: Record<EstadoPorta, string> = { 'deste-servidor': 'em uso por este servidor', livre: 'livre', ocupada: 'ocupada por outro programa' };
  for (const p of d.portas) l.push(`  ${p.nome}: ${p.host}:${p.porta}, ${nomesPorta[p.estado]}${p.observacao ? `. ${p.observacao}` : ''}.`);
  l.push('');
  l.push('Fontes');
  for (const f of d.fontes) {
    l.push(`  ${f.nome}: ${f.estado}.`);
    for (const x of f.linhas) l.push(`    ${x}`);
  }
  if (d.mundo) {
    const m = d.mundo;
    l.push('');
    l.push('Mundo');
    l.push(`  ${fmt(m.alas)} alas, ${fmt(m.salas)} salas (${fmt(m.salasNaRecepcao)} na Recepção esperando classificação).`);
    l.push(`  ${fmt(m.agentes)} agentes: ${fmt(m.trabalhando)} trabalhando, ${fmt(m.esperandoVoce)} esperando você, ${fmt(m.dormindo)} dormindo.`);
    l.push(`  Último evento: ${ha(agora, m.ultimoEvento)}. Clientes conectados no SSE: ${fmt(m.conexoesSse)}.`);
  }
  if (d.saneamento) {
    const s = d.saneamento;
    l.push('');
    l.push('Saneamento');
    l.push(`  ${fmt(s.recebidos)} eventos recebidos: ${fmt(s.aceitos)} aceitos, ${fmt(s.recusados)} recusados pelo esquema, ${fmt(s.duplicados)} duplicados.`);
    l.push(`  ${fmt(s.camposDescartados)} campos fora da allowlist descartados; ${fmt(s.textosMascarados)} textos com segredo ou caminho mascarados.`);
    l.push(`  ${fmt(s.excluidos)} eventos de pasta excluída (sem sala, sem nome de arquivo, sem nome e sem tarefa do agente); ${fmt(s.foraDaSala)} com caminho que o adaptador do OMB resolve.`);
    l.push(`  ${fmt(s.esperaramSala)} eventos passaram pela fila da sala (esperando o disco responder, ou um evento do mesmo agente na frente); ${fmt(s.errosDeSala)} falhas ao decidir a sala.`);
    l.push(`  ${fmt(s.arquivoForaDasRaizes)} eventos de arquivo fora das raízes conhecidas ficaram na sala atual do agente; ${fmt(s.salaDesconhecida)} ficaram sem sala porque o disco não respondeu no prazo; ${fmt(s.esperaEstourada)} estouraram o teto de espera da fila.`);
    l.push(`  Arquivos que não mudaram a sala do agente: rascunho ${fmt(s.arquivoEmRascunho)}, pasta de apoio ou raiz da agregadora ${fmt(s.arquivoEmApoio)}, pasta comum sem git ${fmt(s.arquivoEmPastaComum)}, leitura isolada ${fmt(s.leituraIsolada)} (só três seguidas na mesma outra sala levam o agente), sala fixa ${fmt(s.arquivoEmSalaFixa)}.`);
    l.push(`  ${fmt(s.bloqueadosNaSaida)} textos bloqueados pela guarda da saída e ${fmt(s.bloqueadosNaGravacao)} na gravação do banco (o normal é zero).`);
  }
  if (d.privacidade) {
    const so = d.privacidade.sondas;
    l.push(`  Sonda de disco agora: no disco ${fmt(so.emVoo)}, esperando vaga ${fmt(so.esperando)}, raízes marcadas como lentas ${fmt(so.lentas)} (sem sonda por alguns minutos).`);
  }
  // Uma linha por item: um texto com quebra de linha não vira várias linhas soltas (a guarda do texto olha linha a linha).
  return l.map((x) => x.replace(QUEBRAS, ' ')).join('\n');
}

export function versaoNode(): string {
  return process.versions.node;
}

export { VERSAO_ESQUEMA };
