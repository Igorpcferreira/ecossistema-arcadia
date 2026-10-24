// Criação do renderizador do PixiJS com as regras do Arcadia:
// sem ticker interno (o laço é nosso), sem sistema de eventos (o toque é tratado no DOM),
// sem coleta de lixo de texturas (as texturas são fixas), WebGL por padrão e o renderizador
// Canvas do próprio PixiJS quando o WebGL não existe ou roda por software (SwiftShader,
// llvmpipe). ?motor=webgl ou ?motor=canvas força a escolha.
// O módulo pixi.js/unsafe-eval troca as funções que o PixiJS geraria na hora (new Function) por
// versões prontas: o mundo roda com a CSP do servidor sem 'unsafe-eval'.
import 'pixi.js/unsafe-eval';
import { autoDetectRenderer, Ticker, type Renderer } from 'pixi.js';
import { recarregarQuandoResponder } from '../fonte/conexao.ts';

export interface InfoGpu { webgl: boolean; gpu: string | null; software: boolean }
export interface InfoMotor extends InfoGpu { nome: 'webgl' | 'canvas'; motivo: string }

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|microsoft basic/i;

/** Lê o nome da placa de vídeo num contexto de teste e diz se o WebGL é por software. */
export function detectarGpu(): InfoGpu {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  try { gl = (c.getContext('webgl2') as WebGL2RenderingContext | null) ?? (c.getContext('webgl') as WebGLRenderingContext | null); } catch { gl = null; }
  if (!gl) return { webgl: false, gpu: null, software: true };
  let gpu: string | null = null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { gpu = null; }
  let software = !!gpu && SOFTWARE.test(gpu);
  if (!software) {
    // segunda opinião: o navegador recusa contexto "sem grande perda de desempenho" quando é software
    const c2 = document.createElement('canvas');
    try { const t = c2.getContext('webgl', { failIfMajorPerformanceCaveat: true }); if (!t) software = true; else t.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* sem opinião */ }
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { webgl: true, gpu, software };
}

/**
 * Cria o renderizador. `desligar` tira o ouvinte de perda de contexto: chame antes de destruir
 * o renderizador (o PixiJS perde o contexto de propósito no destroy, e isso não pode recarregar a
 * página, como acontecia em /prototipos a cada troca de opção).
 */
export async function criarRenderizador(canvas: HTMLCanvasElement, forcar: 'webgl' | 'canvas' | null, fundo: number): Promise<{ r: Renderer; info: InfoMotor; desligar: () => void }> {
  // o ticker de sistema do PixiJS ligaria um requestAnimationFrame próprio: fica parado
  Ticker.system.autoStart = false;
  Ticker.system.stop();
  const gpu = detectarGpu();
  let nome: 'webgl' | 'canvas';
  let motivo: string;
  if (forcar) { nome = forcar; motivo = `forçado por ?motor=${forcar}`; }
  else if (!gpu.webgl) { nome = 'canvas'; motivo = 'sem WebGL'; }
  else if (gpu.software) { nome = 'canvas'; motivo = `WebGL por software (${gpu.gpu ?? 'sem nome'})`; }
  else { nome = 'webgl'; motivo = 'WebGL com placa de vídeo'; }
  const opcoes = {
    canvas, width: 16, height: 16, resolution: 1, autoDensity: false, antialias: false, roundPixels: true,
    background: fundo, clearBeforeRender: true, preference: nome === 'webgl' ? (['webgl', 'canvas'] as const) : (['canvas'] as const),
    skipExtensionImports: true, gcActive: false,
    powerPreference: 'low-power' as const, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
  };
  const r = await autoDetectRenderer(opcoes as unknown as Parameters<typeof autoDetectRenderer>[0]);
  Ticker.system.stop();
  const real = r.name === 'canvas' ? 'canvas' : 'webgl';
  if (real !== nome) motivo += `; o PixiJS caiu para ${real}`;
  // perda de contexto WebGL de verdade: recarrega a página (o estado vem de novo do simulador ou do servidor), mas só
  // quando ela responder: com o servidor fora, recarregar deixaria a página de erro do navegador para sempre
  const perdeu = (e: Event) => { e.preventDefault(); setTimeout(() => void recarregarQuandoResponder(), 300); };
  if (real === 'webgl') canvas.addEventListener('webglcontextlost', perdeu, { once: true });
  return { r, info: { ...gpu, nome: real, motivo }, desligar: () => canvas.removeEventListener('webglcontextlost', perdeu) };
}
