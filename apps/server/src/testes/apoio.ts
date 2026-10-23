// Apoio aos testes: eventos inventados, congelamento profundo e pasta temporária do sistema.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ArcadiaEvent } from '@arcadia/shared';

let contador = 0;

/** Evento canônico de teste. `t` vale para ts e recebidoEm. */
export function ev(tipo: ArcadiaEvent['tipo'], t: number, extra: Partial<ArcadiaEvent> = {}): ArcadiaEvent {
  contador++;
  return {
    v: 1,
    id: `teste:${contador}`,
    ts: t,
    recebidoEm: t,
    origem: 'sim',
    motor: 'claude',
    agente: { chave: 'sim:a', tipo: 'sessao' },
    local: {},
    tipo,
    ...extra,
  };
}

export function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor as Record<string, unknown>)) congelar(v);
  }
  return valor;
}

export function json<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

/**
 * Pasta temporária para teste, dentro da pasta temporária do sistema (arcadia-testes), que some no fim. Nada de
 * teste vai para %LOCALAPPDATA%\Arcadia: lá ficam só os dados do servidor de verdade.
 */
export function pastaTemporaria(): { caminho: string; remover(): void } {
  const base = path.join(os.tmpdir(), 'arcadia-testes');
  const caminho = path.join(base, `t-${process.pid}-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(caminho, { recursive: true });
  return {
    caminho,
    remover() {
      fs.rmSync(caminho, { recursive: true, force: true });
      try {
        if (fs.readdirSync(base).length === 0) fs.rmdirSync(base);
      } catch {
        // outra execução pode estar usando a pasta base
      }
    },
  };
}
