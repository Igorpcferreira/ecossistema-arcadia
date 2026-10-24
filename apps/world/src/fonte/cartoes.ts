// Cartões com os dados do servidor (seção 4.5 do prompt): agente (estado, tarefa saneada, últimas
// ações, tokens e árvore de delegação), sala, ala e "Precisa de você". Só leitura: o texto que
// aparece é o que o servidor mandou (já saneado), com rótulos em português.
import type { Pessoa } from '../cena/mundo.ts';
import type { Cartao, FonteCartoes, ItemCartao } from '../ui/interface.ts';
import type { Espelho } from './espelho.ts';
import { ROTULO_SERVIDOR, cargoDoAgente, nomeDoAgente, NOME_MOTOR, type Coreografo } from './coreografo.ts';
import type { Acao, Agente, SalaServidor } from './tipos.ts';

const TIPO_SALA: Record<string, string> = { web: 'site', app: 'aplicativo', video: 'vídeo', backend: 'servidor', pesquisa: 'pesquisa', outro: 'outro' };
const TIPO_ESPERA: Record<string, string> = { permissao: 'permissão', pergunta: 'pergunta', aprovacao: 'aprovação', talvez: 'talvez' };
/** Situação da delegação como o servidor manda (vinda do OpenMausBot, em inglês) para o cartão; desconhecida não aparece. */
export const STATUS_DELEGACAO: Record<string, string> = {
  enviada: 'enviada', queued: 'na fila', pending: 'na fila', running: 'em andamento', in_progress: 'em andamento', 'in-progress': 'em andamento',
  resume: 'retomada', resumed: 'retomada', needs_input: 'esperando resposta', 'needs-input': 'esperando resposta', blocked: 'bloqueada', paused: 'pausada',
  completed: 'concluída', done: 'concluída', succeeded: 'concluída', failed: 'falhou', error: 'falhou', cancelled: 'cancelada', canceled: 'cancelada',
};
const VERBO: Record<string, string> = { ler: 'leu', editar: 'editou', comando: 'rodou um comando', web: 'buscou na web', navegador: 'usou o navegador', delegar: 'delegou', integracao: 'usou uma integração', outro: 'usou' };
const ACAO: Record<string, string> = {
  'sessao.inicio': 'abriu a sessão', 'sessao.fim': 'encerrou a sessão', 'pedido.humano': 'recebeu um pedido seu', 'turno.inicio': 'começou um turno',
  pensando: 'pensou', 'espera.inicio': 'pediu a sua atenção', 'espera.fim': 'seguiu depois da resposta', 'delegacao.enviada': 'delegou uma tarefa',
  'delegacao.recebida': 'recebeu uma tarefa', 'delegacao.concluida': 'concluiu uma delegação', 'subagente.inicio': 'abriu um subagente',
  'subagente.fim': 'um subagente terminou', compactacao: 'compactou a conversa', erro: 'deu erro', limite: 'bateu o limite de uso', uso: 'usou tokens',
  entrega: 'entregou', dominio: 'evento do domínio', presenca: 'mudou de presença',
};

/** Há quanto tempo, por extenso e curto (ms). */
export function haQuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 48) return r ? `há ${h} h ${r} min` : `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** Contagem de tokens curta: 950, 12,3 mil, 1,4 mi. */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')} mil`;
  return `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} mi`;
}

export function textoAcao(a: Acao): string {
  if (a.tipo === 'ferramenta.inicio') {
    const v = VERBO[a.categoria ?? 'outro'] ?? 'usou';
    return a.alvo ? `${v} ${a.alvo}` : a.categoria === 'outro' && a.nome ? `usou ${a.nome}` : v;
  }
  if (a.tipo === 'ferramenta.fim') return a.ok === false ? 'uma ferramenta falhou' : 'terminou uma ferramenta';
  if (a.tipo === 'ferramenta.erro') return 'uma ferramenta falhou';
  if (a.tipo === 'turno.fim') return a.ok === false ? 'terminou o turno com erro' : 'terminou o turno';
  return ACAO[a.tipo] ?? a.tipo;
}

/** Até esta distância, a ferramenta de delegar e o evento da delegação são a mesma delegação. */
const JANELA_DELEGACAO_MS = 5_000;

/** Últimas ações sem a linha repetida: a ferramenta de delegar sai quando o evento da delegação está junto dela. */
export function semDelegacaoRepetida(acoes: readonly Acao[]): Acao[] {
  const enviadas = acoes.filter((x) => x.tipo === 'delegacao.enviada');
  return acoes.filter((x) => !(x.tipo === 'ferramenta.inicio' && x.categoria === 'delegar' && enviadas.some((y) => Math.abs(y.ts - x.ts) <= JANELA_DELEGACAO_MS)));
}

export class CartoesServidor implements FonteCartoes {
  private e: Espelho;
  private cor: Coreografo;
  constructor(e: Espelho, cor: Coreografo) { this.e = e; this.cor = cor; }

  versao(): number { return this.e.versao; }
  private ha(ts: number): string { return haQuanto(this.e.agora() - ts); }
  private agenteDe(p: Pessoa): Agente | undefined { return this.e.estado.agentes[p.id]; }
  private nomeSala(chave: string | undefined): string | undefined { return chave ? this.e.estado.salas[chave]?.nome : undefined; }
  private nomeAla(id: string): string { return this.e.estado.alas[id]?.nome ?? id; }

  precisa(): { p: Pessoa; texto: string }[] {
    return this.cor.itensPrecisa().map((it) => ({ p: it.p, texto: `${it.p.curto}: ${TIPO_ESPERA[it.tipo] ?? it.tipo}, ${this.ha(it.desde)}` }));
  }

  cartaoPrecisa(): Cartao {
    const itens: ItemCartao[] = this.cor.itensPrecisa().map((it) => ({
      q: this.ha(it.desde), texto: `${it.p.nome}: ${TIPO_ESPERA[it.tipo] ?? it.tipo}${it.sala ? ` em ${it.sala}` : ''}`, abrir: { tipo: 'pessoa', id: it.p.id },
    }));
    return {
      titulo: 'Precisa de você', sub: itens.length ? 'Do pedido mais antigo para o mais novo' : 'Ninguém esperando agora',
      linhas: [['Na fila', String(itens.length)]], listas: [{ titulo: 'Quem espera', itens }],
    };
  }

  agente(p: Pessoa): Cartao | null {
    const a = this.agenteDe(p);
    if (!a) return null;
    const e = this.e.estado;
    const sala = a.salaChave ? e.salas[a.salaChave] : undefined;
    const onde = sala ? `${sala.nome} (${this.nomeAla(sala.alaId)})` : 'Recepção, sem sala ainda';
    const linhas: [string, string][] = [['Onde', onde], ['Agora', `${ROTULO_SERVIDOR[a.estado]}, ${this.ha(a.desde)}`]];
    if (p.naRecarga) linhas.push(['Lugar', 'na cápsula de recarga']);
    if (a.tarefa) linhas.push(['Tarefa', a.tarefa]);
    if (a.ferramenta) linhas.push(['Ferramenta', a.ferramenta.alvo ? `${a.ferramenta.nome}, ${a.ferramenta.alvo}` : a.ferramenta.nome]);
    if (a.espera) linhas.push(['Espera', `${TIPO_ESPERA[a.espera.tipo] ?? a.espera.tipo}, ${this.ha(a.espera.desde)}`]);
    linhas.push(['Tokens', `${tokens(a.uso.entrada)} de entrada, ${tokens(a.uso.saida)} de saída, ${tokens(a.uso.cache)} de cache`]);
    linhas.push(['Hoje', `${a.entregasHoje} ${a.entregasHoje === 1 ? 'entrega' : 'entregas'}, ${a.errosHoje} ${a.errosHoje === 1 ? 'erro' : 'erros'}`]);
    linhas.push(['Chegou', this.ha(a.chegouEm)]);
    const acoes: ItemCartao[] = semDelegacaoRepetida(a.ultimasAcoes).sort((x, y) => y.ts - x.ts).map((x) => ({ q: this.ha(x.ts), texto: textoAcao(x) }));
    // árvore de delegação: quem delegou a quem, e os subagentes
    const arvore: ItemCartao[] = [];
    const nome = (k: string) => { const g = e.agentes[k]; return g ? nomeDoAgente(g) : 'agente que saiu'; };
    if (a.paiChave) arvore.push({ texto: `subagente de ${nome(a.paiChave)}`, abrir: { tipo: 'pessoa', id: a.paiChave } });
    for (const d of Object.values(e.delegacoes)) {
      if (d.de === a.chave) arvore.push({ q: this.ha(d.desde), texto: `delegou a ${nome(d.para)}${d.titulo ? `: ${d.titulo}` : ''}${d.status && STATUS_DELEGACAO[d.status] ? ` (${STATUS_DELEGACAO[d.status]})` : ''}`, abrir: { tipo: 'pessoa', id: d.para } });
      if (d.para === a.chave) arvore.push({ q: this.ha(d.desde), texto: `recebeu de ${nome(d.de)}${d.titulo ? `: ${d.titulo}` : ''}`, abrir: { tipo: 'pessoa', id: d.de } });
    }
    const filhos = Object.values(e.agentes).filter((g) => g.paiChave === a.chave);
    for (const f of filhos) arvore.push({ texto: `subagente ${ROTULO_SERVIDOR[f.estado]}` });
    const listas = [{ titulo: 'Últimas ações', itens: acoes }];
    if (arvore.length) listas.push({ titulo: 'Delegações', itens: arvore });
    return { titulo: nomeDoAgente(a), sub: cargoDoAgente(a), linhas, listas, sprite: true };
  }

  /** Sala (cápsula) que cobre um ladrilho, ou que está logo atrás dele na tela. */
  salaEm(i: number, j: number): string | null {
    for (const s of this.cor.m.cena.salas) {
      if (s.estilo !== 'pod' || !this.e.estado.salas[s.id]) continue;
      for (let k = 0; k <= 3; k++) { const a = i + k, b = j + k; if (a >= s.i && a < s.i + s.w && b >= s.j && b < s.j + s.d) return s.id; }
    }
    return null;
  }

  sala(chave: string): Cartao | null {
    const e = this.e.estado, s: SalaServidor | undefined = e.salas[chave];
    if (!s) return null;
    const obra = e.obras.find((o) => o.salaChave === chave);
    const estado = obra ? 'em obra' : s.dormindo ? 'dormindo' : 'acordada';
    const linhas: [string, string][] = [
      ['Ala', this.nomeAla(s.alaId)], ['Tipo', TIPO_SALA[s.tipo] ?? s.tipo], ['Estado', estado], ['Última atividade', this.ha(s.ultimaAtividade)],
      ['Hoje', `${s.entregasHoje} ${s.entregasHoje === 1 ? 'entrega' : 'entregas'}, ${s.errosHoje} ${s.errosHoje === 1 ? 'erro' : 'erros'}`],
      ['Desde o começo', `${s.entregas} ${s.entregas === 1 ? 'entrega' : 'entregas'}, ${s.erros} ${s.erros === 1 ? 'erro' : 'erros'}`],
      ['Nasceu', this.ha(s.criadaEm)],
    ];
    const gente = Object.values(e.agentes).filter((a) => a.salaChave === chave && a.tipo !== 'subagente' && a.tipo !== 'humano');
    const itens: ItemCartao[] = gente.map((a) => ({ q: NOME_MOTOR[a.motor] ?? '', texto: `${nomeDoAgente(a)}: ${ROTULO_SERVIDOR[a.estado]}`, abrir: { tipo: 'pessoa', id: a.chave } }));
    return { titulo: s.nome, sub: 'Sala de projeto', linhas, listas: [{ titulo: itens.length ? 'Quem trabalha aqui' : 'Ninguém agora', itens }] };
  }

  zona(id: string): Cartao | null {
    const m = this.cor.m, z = m.zonaPorId.get(id);
    if (!z) return null;
    const e = this.e.estado;
    // a ala dona da zona (anexo incluído); na Recepção, a ala de recepção
    const alaId = this.cor.mapa.alaDaZona.get(id);
    const ala = alaId ? e.alas[alaId] : undefined;
    const ez = m.estadoZona.get(id);
    const salas = Object.values(e.salas).filter((s) => this.cor.zonaDaSala(s) === id).sort((a, b) => b.ultimaAtividade - a.ultimaAtividade);
    const presentes = m.pessoas.filter((a) => a.visivel && m.zonaEm(Math.floor(a.pi), Math.floor(a.pj)) === z);
    const ativos = presentes.filter((a) => !a.naRecarga && a.estado !== 'ocioso' && a.estado !== 'dormindo').length;
    const estado = this.cor.mapa.livres.has(id) ? 'livre' : ez?.espera ? 'em espera' : ez && ez.nivel < 1 ? 'acordando' : presentes.length ? (ativos ? 'ativa' : 'calma') : 'vazia';
    const linhas: [string, string][] = [['Estado', estado], ['Gente', String(presentes.length)]];
    if (salas.length) linhas.push(['Última atividade', this.ha(salas[0].ultimaAtividade)]);
    if (ala && !ala.ativa) linhas.push(['Configuração', 'saiu da configuração; as salas ficam']);
    linhas.push(['Sobre', z.texto]);
    const listas: { titulo: string; itens: ItemCartao[] }[] = [];
    if (salas.length) listas.push({ titulo: 'Salas', itens: salas.map((s) => ({ q: s.dormindo ? 'dorme' : 'ativa', texto: s.nome, abrir: { tipo: 'sala' as const, id: s.chave } })) });
    listas.push({ titulo: presentes.length ? 'Quem está aqui' : 'Ninguém agora', itens: presentes.map((a) => ({ q: a.curto, texto: this.agenteDe(a) ? ROTULO_SERVIDOR[this.agenteDe(a)!.estado] : a.tarefa, abrir: { tipo: 'pessoa' as const, id: a.id } })) });
    const sub = z.tipo !== 'ala' ? 'Área do andar' : this.cor.mapa.livres.has(id) ? 'Lote do andar' : this.cor.mapa.anexos.has(id) ? `Anexo da ala ${ala?.nome ?? ''}`.trim() : 'Ala do andar';
    return { titulo: z.titulo, sub, linhas, listas };
  }
}
