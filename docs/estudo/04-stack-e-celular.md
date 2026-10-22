# Stack, pixel art no celular antigo, rede local e bateria

Versões conferidas em 22/10/2026 no registro do npm e nas páginas oficiais. Antes de instalar, confira de novo e **evite versões publicadas há menos de duas semanas**. Em 22/10/2026 a direção mudou de 3D low-poly para **pixel art 2D isométrica**; a pesquisa 3D ficou no fim deste arquivo como histórico.

## 1. Motor 2D e orçamento (vigente)

### 1.1 Opções

| Opção | Versão | Leitura |
|---|---|---|
| **PixiJS** | 8.22.0 (10/10/2026) | WebGL 2D com lote de sprites, texturas criadas a partir de canvas (encaixa no gerador procedural da prancha), render textures para a camada estática, blends de multiplicação e adição para a luz. **Recomendado** |
| Phaser | 4.2.1 (07/2026) | Framework de jogo completo: cenas, câmera com zoom e seguir, tweens, tilemaps isométricos do Tiled, animações exportadas do Aseprite. **Alternativa** se a Fase 0 mostrar ganho real |
| Canvas 2D sem biblioteca | nativo | É o que a prancha usa: simples e sem dependência, mas tudo roda na CPU; plano C |
| Excalibur | 0.32.0 | TypeScript, ainda 0.x |
| @pixi/tilemap, pixi-filters | 5.0.2, 6.1.5 | opcionais; filtros custam tela cheia, cuidado no celular |

**Recomendação do estudo:** PixiJS 8 com um motor isométrico próprio (ladrilhos, ordenação, câmera, luz, como na prancha), HUD e cartões em DOM, e os mesmos desenhos procedurais virando texturas. Registrar a decisão em ADR depois de uma prova de fps na Fase 0.

### 1.2 Pixel perfeito: técnicas

1. **Resolução interna** = pixels físicos da área do palco divididos por uma **escala inteira** (2 no PC com DPR 1; 4 num celular com DPR 3, como na prancha). CSS `image-rendering: pixelated`, texturas com filtro `nearest`, posições arredondadas.
2. **Zoom só em passos inteiros**, mantendo o ponto sob o dedo ou o mouse.
3. **Câmera arredondada** no quadro, para não tremer.
4. **Camada estática** (piso, paredes, janelas, letreiros, linhas de dados) desenhada uma vez numa textura; refeita só na troca de dia e noite. Mapas grandes em blocos de até 2048 px por lado (GPUs antigas).
5. **Objetos como sprites pré-renderizados**; ordenação isométrica: objeto pela borda da frente `(i + w) + (j + d)`, personagem por `i + j`; itens rentes ao chão (palco, esteira, tapete, teletransporte) num passe anterior.
6. **Cache de sprites de personagem** por aparência, pose, quadro, costas, estado e espelho.
7. **Luz:** noite = multiplicação da cena por um azul escuro + brilhos aditivos pré-renderizados; dia = feixes de sol suaves vindos das janelas. No PixiJS, conferir se o blend de multiplicação exige o import de blends avançados na versão instalada.
8. **Texto:** frases (balões, cartões, HUD) em DOM com fonte pixel; dentro do mundo, só fonte bitmap (a prancha tem uma 3 por 5 com acentos).
9. **Celular:** teto de 30 fps, pausa com a aba oculta, reload de madrugada, `webglcontextlost` recarrega, presets `baixo`, `medio` e `alto` (escala, brilhos, partículas, frequência das animações) com `?q=` para forçar.

### 1.3 Orçamento (ponto de partida)

| Item | Celular antigo | PC |
|---|---|---|
| FPS | 30 | 60 |
| Resolução interna | até ~300 por 560 px de arte | até ~700 por 480 |
| Sprites desenhados por quadro | até 400 | até 1.500 |
| Brilhos noturnos visíveis | até 40 | até 120 |
| Partículas | até 120 | até 400 |
| Textura estática | até 2048 px por lado | até 4096 |
| Atlas de sprites | 1 de 2048 por 2048 (16 MB) | até 2 |
| Download inicial | até 500 KB de JS gzip + 2 MB de arte | até 5 MB |
| Heap JS | até 120 MB, estável em 24 h | até 300 MB |
| Rede | snapshot até 50 KB gzip, deltas até 2 KB/s | igual |

Medido na prancha (Canvas 2D, Chromium headless em 22/10/2026): 60 fps no PC e 30 fps (o teto) no celular emulado. **Aparelho real ainda não medido.**

## 2. Arte, sprites e licenças

- **Procedural em código** (o caminho da prancha): paleta própria; ladrilhos; mobília montada com caixas isométricas e detalhes por pixel; personagens montados por partes (cabeça, cabelo, rosto, roupa, braços por pose). Vantagens: estilo consistente, salas e personagens novos sem desenhista, variação por cor do OMB, nenhuma questão de licença no repositório público.
- **Passe à mão** onde a expressão importa (humanos, androides principais, peças-chave): Pixelorama (MIT, grátis), LibreSprite (GPL, grátis) ou Aseprite (pago, perto de US$ 20: **pedir o ok do Igor**). Exportar PNG + JSON de animação.
- **Personagens pessoais** (o Igor e a pessoa fixa): pacote local com aparência e sprites em `%USERPROFILE%\.arcadia\`, carregado em tempo de execução; o repositório traz personagens genéricos.
- **Pacotes de terceiros:** muitos pacotes de pixel art (LimeZu, a maioria do itch.io) são pagos e proíbem redistribuir os arquivos: **fora do repositório público**. Kenney e 0x72 têm pacotes CC0 (conferir cada um). Preferência: arte original.
- **Fontes:** Silkscreen e VT323 (OFL), servidas pelo próprio servidor. A Pixelify Sans foi descartada: em tamanho pequeno o "C" vira "O".
- **Créditos:** tudo em `docs/creditos.md` com fonte, licença, data e arquivo.

## 3. Referências visuais em pixel art

Habbo (salas isométricas e balões), Theme Hospital e Two Point Hospital (sala = função, ícones sobre as pessoas), Tiny Tower e Game Dev Story (andares, bolhas de progresso, cabe em pé no celular), Stardew Valley (rotina por hora e luz de fim de tarde), Eastward e Hyper Light Drifter (detalhe e cor), VA-11 Hall-A e Katana ZERO (cidade neon), A Short Hike (3D em baixa resolução ampliado). Mais as três imagens que o Igor mandou: escritório de agentes com rótulos e setas de tarefa, escritório isométrico de luz quente com balões de atividade, escritório frontal com janela para a cidade. Inspiração, nunca cópia.

## 4. Histórico: pesquisa do motor 3D (rodada descartada)

Para o caso de um modo 3D no futuro: three r186 (0.186.1) com WebGLRenderer (WebGPU não roda em celular antigo), React Three Fiber 9.8.2, drei 10.7.9, troika-three-text para rótulos, camera-controls 3.1.2, ngraph.path para caminhos; DPR 0,75 a 1 no celular, até 60 draw calls, 80 mil triângulos e 8 personagens animados em taxa cheia; assets KayKit e Kenney (CC0); Quaternius mudou para a licença QAL em 28/08/2026 e Mixamo proíbe distribuir arquivo cru, então nenhum dos dois no repositório público.

## 5. Transporte em tempo real

- **SSE é melhor que WebSocket** para painel só de leitura: reconecta sozinho, o `id:` volta como `Last-Event-ID`, `retry:` controla o intervalo, `: ping` a cada 15 s mantém a conexão.
- **Snapshot + deltas:** `GET /api/snapshot` (gzip, com `seq` e `buildId`) + `GET /api/events` (SSE). O servidor guarda ~1.000 eventos; buraco no `seq` ou id velho = `event: resync` e o cliente baixa o snapshot.
- **Conteúdo:** eventos semânticos ("agente X editando"), não posições. O cliente coreografa a caminhada.
- **Ritmo:** agrupar rajadas em 250 ms; não comprimir o stream (o middleware segura o buffer); recarregar a página quando o `buildId` mudar.

## 6. Rede local

- **Bind:** o servidor de visualização escuta na rede local; a ingestão de hooks escuta só em `127.0.0.1`. No Vite de desenvolvimento, `server.host: true` (nomes como `meupc.local` precisam entrar em `server.allowedHosts`; IP já passa).
- **Firewall** (PowerShell como administrador, **feito pelo Igor ou com o ok dele**):

  ```powershell
  New-NetFirewallRule -DisplayName "Arcadia (rede local)" -Direction Inbound -Protocol TCP -LocalPort 4780 -Action Allow -Profile Private -RemoteAddress LocalSubnet
  ```

  Se a rede Wi-Fi estiver como "Pública", mudar para "Privada" é decisão do Igor (`Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private`). Se o Windows perguntar sobre o `node.exe`, não marcar "Pública".
- **Endereço:** reserva DHCP no roteador para o PC; o Android só resolve `.local` em versões recentes, então em aparelho antigo use o IP (QR code na tela do PC).
- **Contexto seguro:** Wake Lock, Service Worker, PWA instalável, `deviceMemory` e Battery API exigem HTTPS fora de localhost. Cache com hash no nome e `Cache-Control: immutable` funciona em HTTP.

| Opção | No celular | A favor | Contra |
|---|---|---|---|
| HTTP + "Permanecer ativo" | nada | zero esforço | sem PWA e Wake Lock |
| Flag `unsafely-treat-insecure-origin-as-secure` | `chrome://flags` | 1 minuto | gambiarra; flags mudam |
| mkcert 1.4.4 | CA de usuário instalada à mão | simples | Chrome aceita CA de usuário, apps não; aviso "rede monitorada"; proteger a chave da CA |
| Caddy 2.11.7 com `tls internal` | CA de usuário | HTTP/2, gzip, proxy, renova sozinho | mesmo cuidado com a CA |
| Tailscale 1.104.2 (`tailscale serve`) | app (Android 8+) | certificado público; acesso de fora de casa | VPN ligada 24 h; nome da máquina em log público de certificados |
| NoSleep.js 0.12.0 | nada | vídeo em loop sem HTTPS | parado desde 2020 |

Ordem sugerida: **HTTP no MVP**, Caddy quando quiser PWA e Wake Lock, Tailscale se um dia quiser ver de fora de casa (decisões do Igor).

## 7. Celular ligado o dia todo

- **Tela acesa:** "Permanecer ativo" nas opções do desenvolvedor (mantém a tela acesa enquanto carrega). Alternativa paga: [Fully Kiosk](https://www.fully-kiosk.com) PLUS (8,90 € por aparelho: tela cheia, orientação, autostart, reload e agenda). Sem ele: "Fixar app" + Fullscreen API (`screen.orientation.lock` só em tela cheia).
- **Versão do Chrome:** Android 8 e 9 pararam no Chrome 138; Android 7 no 119. O alvo padrão do Vite 8 é chrome111: aparelho mais velho pede `build.target` menor. **Perguntar ao Igor o modelo e a versão do Android na Fase 0.**
- **Bateria:** carga cheia com calor é o pior caso (a 25 °C, guardada a 100%, perde perto de 20% da capacidade em um ano, contra 4% a 40%: [Battery University](https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries)). Usar o limite de carga do fabricante ou uma tomada inteligente ciclando entre 30 e 80%; tirar a capa; brilho baixo; inspecionar todo mês e, se estufar, desligar e levar a um ponto de coleta.
- **Tela AMOLED:** nada de HUD claro fixo; tema escuro à noite; câmera sempre em movimento lento; HUD que desloca alguns pixels de tempos em tempos.

## 8. Backend local

- **Node:** 24.22.1 LTS (o PC tem 24.5.0; atualizar pelo nvm4w é decisão do Igor) ou 26 depois de 28/10/2026.
- **SQLite:** `node:sqlite` (`DatabaseSync`) é release candidate desde o Node 24.15, sem flag e sem compilação. Alternativa: better-sqlite3 13.0.3 (Node-API, binários no pacote).
- **HTTP:** Hono 4.13.13 + @hono/node-server 2.1.5 (tem `streamSSE`); Fastify 5.12.7 resolve igual.
- **Arquivos:** chokidar **5.0.0** (a 6.0.0 saiu em 19/10/2026: nova demais). Ler JSONL guardando offset e buffer de linha incompleta, detectar truncamento e rodar um poll de segurança a cada 2 s (no Windows, arquivo mantido aberto pelo processo que escreve pode atrasar eventos). Na partida, ler só o fim de cada arquivo.
- **Build:** Vite 8.3.5 (Rolldown). TypeScript 7.0.2 (ou 6.0.3 se alguma ferramenta exigir a API JS antiga). Workspaces: npm (o Igor já usa) ou pnpm 12.

## 9. Stack recomendada (resumo)

- **Mundo:** Vite 8.3.5, TypeScript, **PixiJS 8.22** (motor isométrico próprio, texturas geradas por código), HUD e cartões em DOM (React 19 opcional), fontes Silkscreen e VT323 locais.
- **Arte:** gerador procedural em TypeScript + passe à mão em Pixelorama ou LibreSprite; pacote local para os personagens pessoais.
- **Servidor:** Node 24 LTS, Hono 4.13.13, `node:sqlite`, chokidar 5.0.0, zod para o esquema.
- **Rede (depois do MVP, com ok do Igor):** Caddy 2.11.7 ou Tailscale; Fully Kiosk PLUS e tomada inteligente são opcionais pagos.
