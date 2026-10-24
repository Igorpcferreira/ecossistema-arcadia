// Tipos do protocolo do servidor (ADR 0002), só como tipos: o zod do pacote compartilhado não
// entra no build do mundo. Quem valida a saída é o servidor (allowlist e `protegerSaida`).
export type {
  Acao, Agente, Ala, ArcadiaEvent, Delegacao, EstadoAgente, EstadoMundo, ItemPrecisaDeVoce, Metricas, Mudanca, Obra, Ola,
  Quadro, Resync, Sala as SalaServidor, Snapshot, TemaAla,
} from '@arcadia/shared';
