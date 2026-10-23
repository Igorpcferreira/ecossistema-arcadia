// Folha do elenco: cada personagem nos dois tamanhos, procedural e com passe à mão, em
// algumas poses. Desenhada em canvas 2D só uma vez (é uma página de consulta).
import type { Aparencia, Estado, Pose } from '../cena/formato.ts';
import { desenharPersonagem, desenharRosto, dyPose, DIM, type PasseMao, type Tam } from '../arte/personagens.ts';
import { usarPaleta } from '../arte/cor.ts';
import { ampliarCanvas } from '../ui/escalaDom.ts';

export interface FichaElenco { nome: string; texto: string; aparencia: Aparencia }

const QUADROS: { pose: Pose; q: number; costas: boolean; rotulo: string }[] = [
  { pose: 'parado', q: 0, costas: false, rotulo: 'parado' },
  { pose: 'parado', q: 0, costas: true, rotulo: 'costas' },
  { pose: 'andar', q: 1, costas: false, rotulo: 'andando' },
  { pose: 'digitando', q: 0, costas: false, rotulo: 'digitando' },
  { pose: 'pose', q: 1, costas: false, rotulo: 'pose' },
  { pose: 'beber', q: 0, costas: false, rotulo: 'café' },
];

function quadro(ap: Aparencia, tam: Tam, mao: PasseMao, f: (typeof QUADROS)[number], estado: Estado, zoom: number): HTMLCanvasElement {
  const { w, h } = DIM[tam];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  ampliarCanvas(c, zoom);
  const g = c.getContext('2d')!;
  usarPaleta('fria');
  desenharPersonagem(g, ap, f.pose, f.q, f.costas, tam, mao);
  if (ap.tipo === 'androide' && !f.costas) {
    const r = document.createElement('canvas'); r.width = w; r.height = h;
    desenharRosto(r.getContext('2d')!, ap, estado, tam);
    g.drawImage(r, 0, dyPose(f.pose, f.q, tam));
  }
  return c;
}

export function montarElenco(alvo: HTMLElement, fichas: FichaElenco[]): void {
  alvo.replaceChildren();
  for (const fi of fichas) {
    const linha = document.createElement('div');
    linha.className = 'elenco-linha';
    const cab = document.createElement('div');
    cab.className = 'elenco-nome';
    const b = document.createElement('b'); b.textContent = fi.nome;
    const s = document.createElement('span'); s.textContent = fi.texto;
    cab.append(b, s);
    linha.append(cab);
    for (const [tam, mao, rot] of [[16, 'nenhum', '16 por 32, procedural'], [16, 'todos', '16 por 32, à mão'], [24, 'nenhum', '24 por 40, procedural'], [24, 'todos', '24 por 40, à mão']] as const) {
      const grupo = document.createElement('figure');
      grupo.className = 'elenco-grupo';
      const fila = document.createElement('div'); fila.className = 'elenco-fila';
      for (const f of QUADROS) fila.append(quadro(fi.aparencia, tam, mao, f, f.pose === 'digitando' ? 'editando' : 'ocioso', tam === 16 ? 3 : 2));
      const leg = document.createElement('figcaption'); leg.textContent = rot;
      grupo.append(fila, leg);
      linha.append(grupo);
    }
    alvo.append(linha);
  }
}
