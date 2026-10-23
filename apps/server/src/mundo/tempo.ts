// Datas no fuso da configuração, sem biblioteca: Intl faz a conversão. Determinístico (só depende do instante).

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatos.set(fuso, f);
  }
  return f;
}

export function partesLocais(t: number, fuso: string): Partes {
  const p: Record<string, number> = {};
  for (const parte of formato(fuso).formatToParts(new Date(t))) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }
  return { ano: p['year'] ?? 1970, mes: p['month'] ?? 1, dia: p['day'] ?? 1, hora: (p['hour'] ?? 0) % 24, minuto: p['minute'] ?? 0, segundo: p['second'] ?? 0 };
}

const dois = (n: number) => String(n).padStart(2, '0');

/** Chave interna do dia (aaaa-mm-dd), usada só como chave de banco. */
export function chaveDoDia(t: number, fuso: string): string {
  const p = partesLocais(t, fuso);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/** Dia para mostrar: dd/mm/aaaa. */
export function diaTexto(t: number, fuso: string): string {
  const p = partesLocais(t, fuso);
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano}`;
}

export function horaTexto(t: number, fuso: string): string {
  const p = partesLocais(t, fuso);
  return `${dois(p.hora)}:${dois(p.minuto)}:${dois(p.segundo)}`;
}

function deslocamento(t: number, fuso: string): number {
  const p = partesLocais(t, fuso);
  const segundos = Math.floor(t / 1000) * 1000;
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - segundos;
}

/** Próxima meia-noite local depois de `t` (em ms UTC). */
export function proximaMeiaNoite(t: number, fuso: string): number {
  const p = partesLocais(t, fuso);
  const alvoLocal = Date.UTC(p.ano, p.mes - 1, p.dia + 1, 0, 0, 0);
  let alvo = alvoLocal - deslocamento(t, fuso);
  const ajuste = deslocamento(alvo, fuso);
  alvo = alvoLocal - ajuste;
  return alvo > t ? alvo : alvo + 24 * 3600_000;
}
