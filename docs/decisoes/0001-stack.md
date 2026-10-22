# ADR 0001: stack do Arcadia

- **Data:** 22/10/2026 (Fase 0)
- **Status:** aceita para as Fases 1 e 2. Revisar se o celular real do Igor não chegar a 25 fps no preset escolhido (portão G4).

## Contexto

O Arcadia é um mundo em pixel art isométrica, cheio de objetos animados e luz noturna, que precisa rodar a 30 fps num celular antigo parado na mesa, só para ver, e a 60 fps no PC. A arte é gerada por código (salas e personagens novos nascem sozinhos). O repositório é público e os dados ficam na máquina. A prancha aprovada (`docs/local/conceitos/arcadia-pixel.html`, fora do Git) usa Canvas 2D puro e redesenha à mão, a cada quadro, hologramas, anéis e LEDs ponto a ponto.

## Decisão

### Mundo (cliente)

- **PixiJS 8.22.0** (MIT, publicado em 01/10/2026), renderizador WebGL, com motor isométrico próprio: ladrilhos 32 por 16, ordenação por profundidade, câmera com zoom inteiro, luz por multiplicação e brilhos aditivos (os dois blends são nativos no WebGL do PixiJS 8.22, sem o pacote de blends avançados).
- **Arte gerada por código em canvas e convertida em textura uma vez**: objetos estáticos num atlas de 2048 px; animações como quadros assados com chave (estado e índice do quadro), compartilhados entre objetos do mesmo tipo; partes que mudam de posição (peixes, feixe, partículas, drones) como sprites movidos. Nada de redesenhar pixel a pixel a cada quadro.
- **Posições sempre inteiras**, ampliação só em múltiplos inteiros, filtro `nearest`.
- **HUD, balões e cartões em DOM**, sem framework na Fase 1 (React 19 só se o HUD crescer). Fontes Silkscreen e VT323 servidas pelo próprio servidor.
- **Plano B no próprio PixiJS:** o 8.22 traz um renderizador Canvas (`preference: 'canvas'`). Quando o WebGL não existir ou for por software, o cliente cai nele ou num preset de resolução menor. Na prova ele desenhou a mesma cena sem mudar uma linha da montagem (medido só no PC).
- **Build:** Vite 8.3.4 (a 8.3.5 saiu em 21/10/2026, nova demais) e TypeScript 7.0.2.
- **Peso:** o pacote completo do PixiJS (`pixi.min.js`) tem 821 KB, 232 KB com gzip. Cabe no orçamento do celular (até 500 KB de JavaScript com gzip) mesmo sem tirar o que não se usa.

### Servidor e dados

- **Node 24** (o PC tem 24.5.0, onde `node:sqlite` já funciona com aviso de experimental; atualizar para a LTS mais nova é decisão do Igor, não bloqueia nada).
- **Hono 4.13.13** com **@hono/node-server 2.1.4** (a 2.1.5 é de 13/10/2026), SSE próprio.
- **`node:sqlite`** (`DatabaseSync`), sem dependência nativa. Alternativa se o aviso ou alguma API atrapalhar: better-sqlite3 13.0.3.
- **chokidar 5.0.0** (a 6.0.0 é de 19/10/2026) mais varredura de segurança a cada 2 s.
- **zod 4.6.5** (a 4.6.7 é de 12/10/2026) para o esquema do evento.
- **npm workspaces** (`apps/server`, `apps/world`, `packages/shared`): o Igor já usa npm; pnpm exigiria instalar programa novo.
- Testes do servidor e do `shared` com `node --test` direto em TypeScript (o Node 24.5.0 faz a remoção de tipos sozinho); o cliente decide na Fase 1 se precisa de Vitest.

Regra de versão: antes de instalar, conferir no npm e não usar nada publicado há menos de duas semanas.

## A prova (Fase 0)

A mesma cena da prancha foi portada para PixiJS (`docs/local/prova-motor/`, fora do Git porque a cena tem os personagens pessoais): o script da prancha ficou idêntico e só o desenho do quadro foi trocado. Simulação com semente fixa nas duas páginas. Celular emulado: 360 por 740, DPR 3, toque, meta viewport no HTML, CPU limitada pelo CDP (4x e 6x), resolução interna 230 por 308. Medida: fps e tempo de CPU de cada quadro desenhado (todos os callbacks de animação daquele quadro) em 15 s, depois de 6 s de aquecimento; e, à parte, só a função de desenho. Dois modos de navegador: tudo em software (SwiftShader) e com a placa de vídeo do PC. Tabelas completas em `docs/estado-atual.md`.

| Cenário (mesma cena) | Canvas 2D (prancha) | PixiJS WebGL (prova) | PixiJS Canvas (plano B) |
|---|---|---|---|
| PC 1440, noite, em software | 60 fps; 2,5 ms por quadro, 2,1 no desenho | 60 fps; 0,7 ms, 0,5 no desenho | 60 fps; 2,6 a 2,7 ms, 2,1 no desenho |
| PC 1440, noite, placa de vídeo, sem vsync | 175 fps; 1,5 ms, 1,3 no desenho | 180 fps; 1,3 ms, 0,8 no desenho | 175 fps; 2,0 ms, 1,6 no desenho |
| Celular, CPU 6x, teto de 30 fps, em software | 30 fps; 5,3 a 6,1 ms | 30 fps; 5,9 a 6,2 ms | não medido |
| Celular, CPU 6x, teto de 30 fps, placa de vídeo | 30 fps; 6,4 a 9,0 ms | 30 fps; 5,2 a 7,5 ms | não medido |
| Celular, CPU 6x, sem teto, placa de vídeo | 97 a 100 fps | 127 a 129 fps | não medido |

Leitura:

1. As três versões seguram 60 fps no PC e o teto de 30 fps no celular emulado. O quadro mais pesado de toda a medição ficou em 9 ms de média, para um limite de 33 ms.
2. No PC, o desenho do quadro custa 0,5 ms no PixiJS contra 2,1 ms na prancha em software, e 0,8 contra 1,3 ms com placa de vídeo.
3. No celular com teto de 30 fps, empate: a diferença entre duas rodadas do mesmo cenário foi maior que a diferença entre os motores (a máquina tinha dezenas de processos de agentes abertos).
4. No celular sem teto, com placa de vídeo, o PixiJS dá de 13% a 33% mais quadros. É folga para o mundo crescer.
5. No celular, cerca de metade do desenho no PixiJS é o próprio PixiJS (montar lotes e enviar à GPU); a outra metade é a montagem da cena que a prova faz a cada quadro (chaves em texto, troca de texturas soltas). Atlas e chaves numéricas cortam essa segunda parte.
6. O renderizador Canvas do PixiJS desenhou a mesma cena com custo parecido com o da prancha: o plano B existe e funciona.

**Por que PixiJS mesmo com empate no celular de hoje:** o custo do Canvas 2D cresce com a área desenhada e com cada objeto animado (o PC, com mais área, já mostra), e o mundo vai crescer: salas novas, andares, zoom afastado com o andar inteiro, mais luz e partículas. Com placa de vídeo sobra mais folga, a saída Canvas fica no mesmo código, e atlas com folhas de sprite servem ao passe à mão nos personagens que a Fase 1 vai mostrar.

## Alternativas

- **Canvas 2D puro (o que a prancha usa).** Simples e sem dependência, e segurou o teto de 30 fps no celular emulado. Mas cada holograma, anel e LED é redesenhado ponto a ponto, em chamadas feitas pela CPU a cada quadro, e esse custo cresce junto com o mundo (salas que nascem, andares novos, mais agentes). Fica como referência visual e como plano C.
- **Phaser 4.2.1.** Framework de jogo completo (cenas, física, tilemap, tweens), também em WebGL. O Arcadia não usa física nem tilemap do Tiled e já tem o próprio motor isométrico na prancha; o Phaser traria peso e uma segunda forma de pensar a cena sem ganho medido. Reavaliar só se a Fase 1 pedir animação de sprites do Aseprite em grande volume.
- **Excalibur 0.32.** Ainda 0.x.
- **3D (three.js).** Descartado com a direção de arte em 22/10/2026.

## Consequências

- O motor precisa de um gerenciador de texturas: atlas também para os quadros de animação (a prova chegou a 600 texturas soltas), chaves numéricas, limite de memória (orçamento do celular: um atlas de 2048 por 2048) e pré-assar na carga para não ter tranco na primeira vez que um quadro aparece.
- O laço é do Arcadia: o ticker interno do PixiJS fica parado (na prova ele ainda pedia um quadro a mais a cada quadro, mesmo com os eventos desligados) e o toque é tratado no DOM.
- Perda de contexto WebGL (`webglcontextlost`) recarrega a página; reload programado de madrugada.
- Detectar WebGL por software (SwiftShader, llvmpipe) e cair no renderizador Canvas do PixiJS ou num preset mais baixo.
- A medição no Playwright é aproximação: a CPU é limitada pelo CDP e a GPU do celular não é emulada. O número que vale é o do aparelho real no G4.
