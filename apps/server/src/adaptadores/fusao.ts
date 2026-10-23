// Fusão entre fontes (estudo 02, seção 6). Prioridade: SSE do OpenMausBot (bots) > hooks > JSONL e rollouts.
// Cada fonte só mexe no que conhece. Aqui fica quem é dono de cada sessão: a sessão do Claude ou do Codex que um bot
// do OpenMausBot roda por baixo é do adaptador do OMB, e as transcrições dela não viram um visitante a mais.

export type Fusao = {
  ombConectado(): boolean;
  definirOmbConectado(conectado: boolean): void;
  /** O OMB avisou (session.started) que esta sessão do motor é de um bot. */
  registrarSessaoDoOmb(sessionId: string, agenteChave: string): void;
  sessaoDoOmb(sessionId: string): string | undefined;
  /**
   * A linha é de um bot do OMB? Sessão registrada ou pasta privada de tarefa: sempre. Entrypoint `sdk-cli` (Claude)
   * ou originator `openmausbot` (Codex) fora da pasta privada: só enquanto o adaptador do OMB está conectado.
   */
  ehDoOmb(dados: { sessionId?: string | undefined; entrypoint?: string | undefined; originator?: string | undefined; pastaPrivada?: boolean }): boolean;
};

export function criarFusao(): Fusao {
  let conectado = false;
  const sessoes = new Map<string, string>();
  return {
    ombConectado: () => conectado,
    definirOmbConectado(v) {
      conectado = v;
    },
    registrarSessaoDoOmb(sessionId, agenteChave) {
      sessoes.set(sessionId, agenteChave);
      if (sessoes.size > 5_000) {
        const primeiro = sessoes.keys().next().value;
        if (primeiro !== undefined) sessoes.delete(primeiro);
      }
    },
    sessaoDoOmb: (sessionId) => sessoes.get(sessionId),
    ehDoOmb(d) {
      if (d.sessionId !== undefined && sessoes.has(d.sessionId)) return true;
      if (d.pastaPrivada) return true;
      if (!conectado) return false;
      return d.entrypoint === 'sdk-cli' || d.originator === 'openmausbot';
    },
  };
}
