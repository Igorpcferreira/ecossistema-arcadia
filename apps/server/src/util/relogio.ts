// Relógio injetável: o servidor usa o real; testes, replay e simulador usam o falso, que só anda quando mandam.

export type Agendamento = { cancelar(): void };

export type Relogio = {
  agora(): number;
  /** Como setTimeout. */
  agendar(ms: number, fn: () => void): Agendamento;
  /** Como setInterval. */
  repetir(ms: number, fn: () => void): Agendamento;
};

export function relogioReal(): Relogio {
  return {
    agora: () => Date.now(),
    agendar(ms, fn) {
      const t = setTimeout(fn, Math.max(0, ms));
      return { cancelar: () => clearTimeout(t) };
    },
    repetir(ms, fn) {
      const t = setInterval(fn, Math.max(1, ms));
      return { cancelar: () => clearInterval(t) };
    },
  };
}

export type RelogioFalso = Relogio & {
  /** Anda `ms` milissegundos, disparando os agendamentos em ordem, cada um no seu instante. */
  avancar(ms: number): void;
  /** Anda até o instante `t`. */
  irPara(t: number): void;
  pendentes(): number;
};

type Tarefa = { id: number; quando: number; fn: () => void; intervalo?: number; ativa: boolean };

export function relogioFalso(inicio = 0): RelogioFalso {
  let atual = inicio;
  let proximoId = 1;
  const tarefas: Tarefa[] = [];

  function criar(ms: number, fn: () => void, intervalo?: number): Agendamento {
    const tarefa: Tarefa = { id: proximoId++, quando: atual + Math.max(0, ms), fn, ativa: true };
    if (intervalo !== undefined) tarefa.intervalo = Math.max(1, intervalo);
    tarefas.push(tarefa);
    return {
      cancelar() {
        tarefa.ativa = false;
      },
    };
  }

  function irPara(alvo: number): void {
    for (let guarda = 0; guarda < 1_000_000; guarda++) {
      let proxima: Tarefa | undefined;
      for (const t of tarefas) {
        if (!t.ativa) continue;
        if (t.quando <= alvo && (!proxima || t.quando < proxima.quando || (t.quando === proxima.quando && t.id < proxima.id))) proxima = t;
      }
      if (!proxima) break;
      atual = Math.max(atual, proxima.quando);
      if (proxima.intervalo !== undefined) proxima.quando += proxima.intervalo;
      else proxima.ativa = false;
      proxima.fn();
    }
    for (let i = tarefas.length - 1; i >= 0; i--) if (!tarefas[i]?.ativa) tarefas.splice(i, 1);
    atual = Math.max(atual, alvo);
  }

  return {
    agora: () => atual,
    agendar: (ms, fn) => criar(ms, fn),
    repetir: (ms, fn) => criar(ms, fn, ms),
    avancar: (ms) => irPara(atual + ms),
    irPara,
    pendentes: () => tarefas.filter((t) => t.ativa).length,
  };
}
