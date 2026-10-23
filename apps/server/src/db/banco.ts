// Persistência em SQLite (node:sqlite, modo WAL), em %LOCALAPPDATA%\Arcadia\dados.
// Guarda só o que já passou pelo saneamento: eventos (só acréscimo), snapshots do motor, alas, salas com posição,
// métricas por dia, as marcas de pasta excluída (hash com sal da chave do agente) e as chaves das salas que nasceram
// fora das raízes conhecidas. Nenhum caminho de pasta entra aqui: a sala é a chave (hash) e o apelido. Toda gravação passa
// também pela guarda da saída (o mesmo detector do snapshot e do SSE): o banco é uma saída como as outras.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { protegerSaida, type Ala, type ArcadiaEvent, type Contador, type Metricas, type Sala } from '@arcadia/shared';
import type { EstadoMotor } from '../mundo/motor.ts';
import { novoSal } from '../util/hash.ts';

export const VERSAO_BANCO = 1;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eventos (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  ts INTEGER NOT NULL,
  recebido_em INTEGER NOT NULL,
  origem TEXT NOT NULL,
  tipo TEXT NOT NULL,
  agente TEXT NOT NULL,
  sala TEXT,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS eventos_recebido_em ON eventos (recebido_em);
CREATE TRIGGER IF NOT EXISTS eventos_so_acrescimo BEFORE UPDATE ON eventos
BEGIN
  SELECT RAISE(ABORT, 'eventos sao so de acrescimo');
END;
CREATE TABLE IF NOT EXISTS snapshots (
  criado_em INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (criado_em, seq)
);
CREATE TABLE IF NOT EXISTS alas (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  col INTEGER NOT NULL,
  lin INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  ativa INTEGER NOT NULL,
  criada_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS salas (
  chave TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ala_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  indice INTEGER NOT NULL,
  col INTEGER NOT NULL,
  lin INTEGER NOT NULL,
  andar INTEGER NOT NULL,
  criada_em INTEGER NOT NULL,
  atualizada_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metricas_diarias (
  dia TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marcas_privadas (
  chave TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  criada_em INTEGER NOT NULL,
  atualizada_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS marcas_privadas_atualizada_em ON marcas_privadas (atualizada_em);
CREATE TABLE IF NOT EXISTS salas_fora_das_raizes (
  chave TEXT PRIMARY KEY,
  criada_em INTEGER NOT NULL
);
`;

export type EventoGravado = { seq: number; evento: ArcadiaEvent };
/**
 * Marca de pasta excluída: `agente` vale para sempre (sessão e subagente, até a retenção); `turno` é do bot e cai
 * quando ele começa um turno novo.
 */
export type TipoMarca = 'agente' | 'turno';
export type MarcaPrivada = { chave: string; tipo: TipoMarca };
export type SnapshotGravado = { seq: number; criadoEm: number; estado: EstadoMotor };

export type Banco = {
  readonly arquivo: string;
  modoJournal(): string;
  lerMeta(chave: string): string | undefined;
  gravarMeta(chave: string, valor: string): void;
  /** Sal da instalação (criado na primeira vez). Entra no hash das chaves de sala. */
  sal(): string;
  /** Grava o evento saneado. Devolve o seq, ou undefined quando o id já existe (duplicado). */
  inserirEvento(ev: ArcadiaEvent): number | undefined;
  eventosDepois(seq: number, ateRecebidoEm?: number): IterableIterator<EventoGravado>;
  contarEventos(): number;
  ultimoSeq(): number;
  /** Instante de aplicação do evento mais antigo guardado (para o replay sem snapshot começar no tempo certo). */
  primeiroRecebidoEm(): number | undefined;
  transacao<T>(fn: () => T): T;
  gravarSnapshot(seq: number, criadoEm: number, estado: EstadoMotor): void;
  ultimoSnapshot(ateCriadoEm?: number): SnapshotGravado | undefined;
  contarSnapshots(): number;
  gravarAla(ala: Ala): void;
  gravarSala(sala: Sala, agora: number): void;
  alas(): Ala[];
  salas(): Sala[];
  gravarMetricasDia(dia: string, m: Metricas): void;
  metricasDia(dia: string): Metricas | undefined;
  /** Marcas de pasta excluída gravadas (a chave é o hash com sal da chave do agente, nunca a chave em si). */
  marcasPrivadas(): MarcaPrivada[];
  /** Grava ou renova uma marca. A marca de vez (agente) nunca vira marca de turno. */
  gravarMarca(chave: string, tipo: TipoMarca, agora: number): void;
  /** Tira a marca de turno de um bot que começou turno novo (a marca de vez só sai pela retenção). */
  apagarMarcaDeTurno(chave: string): void;
  /** Sala que nasceu de pasta fora das raízes conhecidas: só a chave (o doctor conta e sugere uma regra). */
  gravarSalaFora(chave: string, agora: number): void;
  salasFora(): string[];
  /**
   * Apaga eventos e snapshots mais velhos que a retenção (nunca o último snapshot nem o que vem depois dele) e as
   * marcas de agente parado há mais tempo que ela.
   */
  aplicarRetencao(agora: number, dias: number): { eventos: number; snapshots: number; marcas: number };
  /** Rareia os snapshots: tudo das últimas 24 h, um por hora até 7 dias, um por dia depois disso. */
  desbastarSnapshots(agora: number): number;
  /** Textos que a guarda trocou por [oculto] ao gravar (o normal é zero: o núcleo já guarda antes). */
  bloqueados(): number;
  fechar(): void;
};

export function abrirBanco(arquivo: string): Banco {
  const db = new DatabaseSync(arquivo);
  const guarda: Contador = { mascarados: 0 };
  const seguro = <T>(v: T): T => protegerSaida(v, guarda);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 2000;');
  db.exec(ESQUEMA);

  const cache = new Map<string, StatementSync>();
  const q = (sql: string): StatementSync => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  const lerMeta = (chave: string): string | undefined => {
    const linha = q('SELECT valor FROM meta WHERE chave = ?').get(chave) as { valor: string } | undefined;
    return linha?.valor;
  };
  const gravarMeta = (chave: string, valor: string): void => {
    q('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
  };
  if (lerMeta('versao') === undefined) gravarMeta('versao', String(VERSAO_BANCO));

  let profundidade = 0;
  function transacao<T>(fn: () => T): T {
    if (profundidade > 0) return fn();
    profundidade++;
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      profundidade--;
    }
  }

  const linhaParaAla = (l: Record<string, unknown>): Ala => ({
    id: String(l['id']),
    nome: String(l['nome']),
    cor: String(l['cor']),
    ordem: Number(l['ordem']),
    lote: { col: Number(l['col']), lin: Number(l['lin']) },
    tipo: l['tipo'] === 'recepcao' ? 'recepcao' : 'projetos',
    ativa: Number(l['ativa']) === 1,
    criadaEm: Number(l['criada_em']),
  });

  return {
    arquivo,
    modoJournal: () => String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode),
    lerMeta,
    gravarMeta,
    sal() {
      let s = lerMeta('sal');
      if (!s) {
        s = novoSal();
        gravarMeta('sal', s);
      }
      return s;
    },
    inserirEvento(bruto) {
      const ev = seguro(bruto);
      const r = q('INSERT OR IGNORE INTO eventos (id, ts, recebido_em, origem, tipo, agente, sala, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        ev.id, ev.ts, ev.recebidoEm, ev.origem, ev.tipo, ev.agente.chave, ev.local.projetoChave ?? null, JSON.stringify(ev),
      );
      return r.changes > 0 ? Number(r.lastInsertRowid) : undefined;
    },
    *eventosDepois(seq, ateRecebidoEm) {
      const sql = ateRecebidoEm === undefined
        ? 'SELECT seq, json FROM eventos WHERE seq > ? ORDER BY seq'
        : 'SELECT seq, json FROM eventos WHERE seq > ? AND recebido_em <= ? ORDER BY seq';
      const it = ateRecebidoEm === undefined ? db.prepare(sql).iterate(seq) : db.prepare(sql).iterate(seq, ateRecebidoEm);
      for (const l of it as Iterable<{ seq: number; json: string }>) yield { seq: Number(l.seq), evento: JSON.parse(l.json) as ArcadiaEvent };
    },
    contarEventos: () => Number((q('SELECT count(*) AS n FROM eventos').get() as { n: number }).n),
    ultimoSeq: () => Number((q('SELECT coalesce(max(seq), 0) AS s FROM eventos').get() as { s: number }).s),
    primeiroRecebidoEm: () => {
      const l = q('SELECT min(recebido_em) AS t FROM eventos').get() as { t: number | null };
      return l.t === null ? undefined : Number(l.t);
    },
    transacao,
    gravarSnapshot(seq, criadoEm, estado) {
      q('INSERT OR REPLACE INTO snapshots (criado_em, seq, json) VALUES (?, ?, ?)').run(criadoEm, seq, JSON.stringify(seguro(estado)));
    },
    ultimoSnapshot(ateCriadoEm) {
      const l = (ateCriadoEm === undefined
        ? q('SELECT criado_em, seq, json FROM snapshots ORDER BY criado_em DESC, seq DESC LIMIT 1').get()
        : q('SELECT criado_em, seq, json FROM snapshots WHERE criado_em <= ? ORDER BY criado_em DESC, seq DESC LIMIT 1').get(ateCriadoEm)) as
        | { criado_em: number; seq: number; json: string }
        | undefined;
      if (!l) return undefined;
      return { seq: Number(l.seq), criadoEm: Number(l.criado_em), estado: JSON.parse(l.json) as EstadoMotor };
    },
    contarSnapshots: () => Number((q('SELECT count(*) AS n FROM snapshots').get() as { n: number }).n),
    gravarAla(bruta) {
      const ala = seguro(bruta);
      q(`INSERT INTO alas (id, nome, cor, ordem, col, lin, tipo, ativa, criada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, cor = excluded.cor, ativa = excluded.ativa`).run(
        ala.id, ala.nome, ala.cor, ala.ordem, ala.lote.col, ala.lote.lin, ala.tipo, ala.ativa ? 1 : 0, ala.criadaEm,
      );
    },
    gravarSala(bruta, agora) {
      const sala = seguro(bruta);
      q(`INSERT INTO salas (chave, nome, ala_id, tipo, indice, col, lin, andar, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET nome = excluded.nome, ala_id = excluded.ala_id, tipo = excluded.tipo, indice = excluded.indice,
         col = excluded.col, lin = excluded.lin, andar = excluded.andar, atualizada_em = excluded.atualizada_em`).run(
        sala.chave, sala.nome, sala.alaId, sala.tipo, sala.terreno.indice, sala.terreno.col, sala.terreno.lin, sala.andar, sala.criadaEm, agora,
      );
    },
    alas: () => (q('SELECT * FROM alas ORDER BY ordem').all() as Record<string, unknown>[]).map(linhaParaAla),
    salas: () =>
      (q('SELECT * FROM salas ORDER BY criada_em, chave').all() as Record<string, unknown>[]).map((l) => ({
        chave: String(l['chave']),
        nome: String(l['nome']),
        alaId: String(l['ala_id']),
        tipo: String(l['tipo']) as Sala['tipo'],
        terreno: { indice: Number(l['indice']), col: Number(l['col']), lin: Number(l['lin']) },
        andar: Number(l['andar']),
        criadaEm: Number(l['criada_em']),
        ultimaAtividade: Number(l['atualizada_em']),
        dormindo: true,
        entregas: 0,
        erros: 0,
        entregasHoje: 0,
        errosHoje: 0,
      })),
    gravarMetricasDia(dia, m) {
      q('INSERT INTO metricas_diarias (dia, json) VALUES (?, ?) ON CONFLICT(dia) DO UPDATE SET json = excluded.json').run(dia, JSON.stringify(seguro(m)));
    },
    metricasDia(dia) {
      const l = q('SELECT json FROM metricas_diarias WHERE dia = ?').get(dia) as { json: string } | undefined;
      return l ? (JSON.parse(l.json) as Metricas) : undefined;
    },
    marcasPrivadas: () =>
      (q('SELECT chave, tipo FROM marcas_privadas ORDER BY criada_em, chave').all() as { chave: string; tipo: string }[]).map((l) => ({
        chave: String(l.chave),
        // Tipo desconhecido vale como a marca mais forte.
        tipo: l.tipo === 'turno' ? ('turno' as const) : ('agente' as const),
      })),
    gravarMarca(chave, tipo, agora) {
      q(`INSERT INTO marcas_privadas (chave, tipo, criada_em, atualizada_em) VALUES (?, ?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET tipo = CASE WHEN marcas_privadas.tipo = 'agente' THEN 'agente' ELSE excluded.tipo END,
         atualizada_em = excluded.atualizada_em`).run(chave, tipo, agora, agora);
    },
    apagarMarcaDeTurno(chave) {
      q("DELETE FROM marcas_privadas WHERE chave = ? AND tipo = 'turno'").run(chave);
    },
    gravarSalaFora(chave, agora) {
      q('INSERT OR IGNORE INTO salas_fora_das_raizes (chave, criada_em) VALUES (?, ?)').run(chave, agora);
    },
    salasFora: () => (q('SELECT chave FROM salas_fora_das_raizes ORDER BY criada_em, chave').all() as { chave: string }[]).map((l) => String(l.chave)),
    aplicarRetencao(agora, dias) {
      const limite = agora - dias * 24 * 3600_000;
      return transacao(() => {
        const ultimo = q('SELECT criado_em, seq FROM snapshots ORDER BY criado_em DESC, seq DESC LIMIT 1').get() as { criado_em: number; seq: number } | undefined;
        const seqProtegido = ultimo ? Number(ultimo.seq) : 0;
        const ev = q('DELETE FROM eventos WHERE recebido_em < ? AND seq <= ?').run(limite, seqProtegido);
        const sn = ultimo
          ? q('DELETE FROM snapshots WHERE criado_em < ? AND NOT (criado_em = ? AND seq = ?)').run(limite, ultimo.criado_em, ultimo.seq)
          : { changes: 0 };
        // A marca segue a retenção dos eventos, contada da última atividade do agente marcado.
        const mc = q('DELETE FROM marcas_privadas WHERE atualizada_em < ?').run(limite);
        return { eventos: Number(ev.changes), snapshots: Number(sn.changes), marcas: Number(mc.changes) };
      });
    },
    desbastarSnapshots(agora) {
      const umDia = 24 * 3600_000;
      return transacao(() => {
        const linhas = q('SELECT criado_em, seq FROM snapshots ORDER BY criado_em DESC, seq DESC').all() as { criado_em: number; seq: number }[];
        const vistos = new Set<string>();
        let apagados = 0;
        const apagar = q('DELETE FROM snapshots WHERE criado_em = ? AND seq = ?');
        linhas.forEach((l, i) => {
          if (i === 0) return;
          const idade = agora - Number(l.criado_em);
          if (idade < umDia) return;
          const balde = idade < 7 * umDia ? `h${Math.floor(Number(l.criado_em) / 3600_000)}` : `d${Math.floor(Number(l.criado_em) / umDia)}`;
          if (vistos.has(balde)) {
            apagar.run(l.criado_em, l.seq);
            apagados++;
          } else {
            vistos.add(balde);
          }
        });
        return apagados;
      });
    },
    bloqueados: () => guarda.mascarados,
    fechar() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // fechar mesmo assim
      }
      db.close();
    },
  };
}
