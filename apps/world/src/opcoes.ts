// Leitura das opções pela URL, comum às duas páginas.
//   ?motor=webgl|canvas   ?q=baixo|medio|alto   ?fps=30 (0 tira o teto)   ?semente=4242
//   ?hora=22 (força a hora)   ?noite=1|0   ?aquario=0   ?foco=<zona>   ?hud=completo|enxuto|nenhum
//   ?escala=16|24 (padrão 24)   ?arte=procedural|humanos|mao (padrão humanos: passe à mão só nos humanos; mao inclui os androides)
//   ?vista=iso|corte   ?paleta=fria|quente   ?densidade=prancha|cheio (padrão cheio)   ?roupa=variante|base (força a roupa alternativa)
//   Os padrões são as escolhas do G1 (23/10/2026): 24 por 40, passe à mão nos humanos, isométrico, noite fria e andar cheio.
//   ?local=0 (força o cenário genérico mesmo em desenvolvimento)   ?debug=1   ?zoom=-1 (passos de zoom)   ?pausado=1 (simulação parada, para testes)
//   ?ocio=rapido (pausa em 15 s e sono em 45 s, para ver uma ala voltar à espera sem esperar 20 min)
//   ?movimento=reduzido|normal (sem o parâmetro, segue a preferência do sistema)
import type { NomePreset } from './qualidade/presets.ts';
import type { PasseMao } from './arte/personagens.ts';
import type { ModoRoupa } from './cena/roupa.ts';

export interface OpcoesUrl {
  motor: 'webgl' | 'canvas' | null;
  preset: NomePreset | null;
  teto: number | null;
  semente: number;
  hora: number | null;
  noite: boolean | null;
  aquario: boolean;
  foco: string | null;
  hud: 'completo' | 'enxuto' | 'nenhum' | 'auto';
  tam: 16 | 24;
  maoFeita: PasseMao;
  vista: 'iso' | 'corte';
  paleta: 'fria' | 'quente';
  densidade: 'prancha' | 'cheio';
  local: boolean;
  debug: boolean;
  celular: boolean | null;
  zoom: number;
  pausado: boolean;
  ocio: 'real' | 'rapido';
  movimento: 'auto' | 'reduzido' | 'normal';
  roupa: ModoRoupa;
}

export function lerOpcoes(qs: URLSearchParams): OpcoesUrl {
  const num = (k: string): number | null => { const v = qs.get(k); if (v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const motor = qs.get('motor');
  const q = qs.get('q');
  const hud = qs.get('hud');
  const noite = qs.get('noite');
  const cel = qs.get('celular');
  return {
    motor: motor === 'webgl' || motor === 'canvas' ? motor : null,
    preset: q === 'baixo' || q === 'medio' || q === 'alto' ? q : null,
    teto: num('fps'),
    semente: num('semente') ?? 4242,
    hora: num('hora'),
    noite: noite === '1' ? true : noite === '0' ? false : null,
    aquario: qs.get('aquario') !== '0',
    foco: qs.get('foco'),
    hud: hud === 'completo' || hud === 'enxuto' || hud === 'nenhum' ? hud : 'auto',
    tam: qs.get('escala') === '16' ? 16 : 24,
    maoFeita: qs.get('arte') === 'procedural' ? 'nenhum' : qs.get('arte') === 'mao' ? 'todos' : 'humanos',
    vista: qs.get('vista') === 'corte' ? 'corte' : 'iso',
    paleta: qs.get('paleta') === 'quente' ? 'quente' : 'fria',
    densidade: qs.get('densidade') === 'prancha' ? 'prancha' : 'cheio',
    local: qs.get('local') !== '0',
    debug: qs.get('debug') === '1',
    celular: cel === '1' ? true : cel === '0' ? false : null,
    zoom: num('zoom') ?? 0,
    pausado: qs.get('pausado') === '1',
    ocio: qs.get('ocio') === 'rapido' ? 'rapido' : 'real',
    movimento: qs.get('movimento') === 'reduzido' ? 'reduzido' : qs.get('movimento') === 'normal' ? 'normal' : 'auto',
    roupa: qs.get('roupa') === 'variante' ? 'variante' : qs.get('roupa') === 'base' ? 'base' : 'auto',
  };
}
