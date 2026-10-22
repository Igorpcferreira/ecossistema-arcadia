# Projetos com a mesma proposta: o que existe, o que copiar, o que evitar

Panorama de 22/10/2026. Estrelas e último push tirados da API do GitHub no mesmo dia (o push serve de aproximação para o último commit). Foram lidos os READMEs e o código principal de Pixel Agents, disler, AI Town, Vibecraft, Claw3D e OpenMausBot.

## 1. Tabela-resumo

| Projeto | Tipo | Render | Fonte de dados | Licença | Estrelas | Últ. push |
|---|---|---|---|---|---|---|
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | Escritório 2D (VS Code + web) | React 19, Canvas 2D | Hooks + JSONL | MIT | 9.835 | 21/10/2026 |
| [Claude Office](https://github.com/paulrobello/claude-office) | Escritório 2D | Next.js, PixiJS | Hooks | MIT | 578 | 16/10/2026 |
| [Claude-Office (W17ant)](https://github.com/W17ant/Claude-Office) | Escritório isométrico pixel | React, Express + ws | Hooks + statusline | MIT (fan art fora) | 273 | 16/10/2026 |
| [pixtuoid](https://github.com/pixtuoid/pixtuoid) | Escritório no terminal | Rust, ratatui | Hook shim + JSONL | MIT | 501 | 21/10/2026 |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI) | Escritório 2D (OpenClaw) | Phaser 3, Flask | Push HTTP do agente | MIT; arte não comercial | 7.532 | 11/03/2026 |
| [Vibecraft](https://github.com/Nearcyan/vibecraft) | Oficina 3D | Three.js | Hooks (bash) | MIT | 1.427 | 18/01/2026 |
| [Claw3D](https://github.com/iamlukethedev/Claw3D) | Escritório 3D (OpenClaw) | Three.js, R3F, Phaser | WebSocket do gateway | MIT | 2.354 | 21/08/2026 |
| [Agents Office](https://github.com/ajsahni/agents-office) | 3D isométrico + orquestrador | Three.js | Processos Claude próprios | PolyForm Noncommercial | 675 | 08/10/2026 |
| [Roving Office](https://github.com/atlassian-labs/roving-office) | Soft-3D isométrico | Three.js sem build | Adaptadores + protocolo neutro (AOP) | Apache-2.0 | 8 | 20/10/2026 |
| [AgentCraft](https://getagentcraft.com) | Orquestrador estilo RTS | Web/PWA | Detecta ou cria sessões | não publicada | n/d | ativo |
| [AgentCraft mod](https://github.com/blendi-remade/agentcraft) | Estúdio no Minecraft | Fabric + Node | Claude Agent SDK via WS | MIT | 868 | 08/10/2026 |
| [Multi-Agent Observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | Painel em tempo real | Vue 3, Bun | Hooks, POST, WS | **sem LICENSE** | 1.551 | 08/02/2026 |
| [AI Town](https://github.com/a16z-infra/ai-town) | Simulação 2D | PixiJS, Convex | Simulação própria | MIT | 10.682 | 26/08/2026 |
| [Generative Agents](https://github.com/joonspk-research/generative_agents) | Simulação 2D (Smallville) | Phaser, Django | Simulação própria | Apache-2.0 | 22.265 | 05/08/2024 |
| [ChatDev](https://github.com/OpenBMB/ChatDev) | Multiagente + visualizador | Flask (1.0), Vue 3 (2.0) | Orquestrador próprio | Apache-2.0 | 34.563 | 16/10/2026 |
| [The Delegation](https://github.com/arturitu/the-delegation) | Playground 3D | Three.js WebGPU | Agentes Gemini próprios | MIT; assets CC BY-NC | 705 | 16/04/2026 |
| [AI Village](https://theaidigest.org/village) | "Reality show" de agentes | Site | Scaffold próprio | fechado | n/a | ativo |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | Agentes no Minecraft | Mineflayer | Agentes próprios | MIT | 5.910 | 21/10/2026 |
| [Happy](https://github.com/slopus/happy) | App móvel/desktop | Expo + relay | Wrapper do CLI | MIT | 24.255 | 21/10/2026 |
| [CloudCLI](https://github.com/siteboon/claudecodeui) | Web UI responsiva | React | `~/.claude` + CLI | AGPL-3.0 | 14.225 | 21/10/2026 |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Kanban de agentes | Rust + web | Processos próprios | Apache-2.0 | 28.424 | 19/09/2026 |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | TUI multiagente | Go, tmux | tmux + worktrees | AGPL-3.0 | 8.642 | 20/08/2026 |
| [Langfuse](https://github.com/langfuse/langfuse) / [Phoenix](https://github.com/Arize-ai/phoenix) | Tracing (referência) | Web | SDK / OTel | MIT (exceto ee) / ELv2 | 36.155 / 11.942 | 22/10 e 21/10/2026 |

Radar (pequenos, mas muito próximos da ideia do Igor):
- [agent-floor](https://github.com/develop212/agent-floor): 3D, um escritório por time ao longo de um corredor; hooks ou POST JSON; estados working, thinking, waiting, error, done e idle, cada um com animação; aviões de papel entre agentes; toque; 60 fps com mais de 50 agentes usando malhas estáticas agrupadas e resolução adaptativa.
- [skyborne](https://github.com/ishraq21/skyborne): cidade 3D com um distrito por sessão; a torre cresce com os tokens; a cor dos olhos mostra o estado; histórico em SQLite com importação de sessões antigas.
- [Hypernovum](https://github.com/Pardesco/hypernovum): cidade 3D com um prédio por projeto; um anel de conflito aparece quando duas sessões mexem no mesmo arquivo.
- [roundtable](https://github.com/Kostakurta8/roundtable): lê só o JSONL e roda uma simulação determinística que permite voltar a qualquer segundo e exportar GIF; feito no Windows.
- [agent-campus](https://github.com/mateovalle/agent-campus): fork do Pixel Agents em que cada projeto é um escritório num campus, mas registrado à mão.

## 2. Os que mais ensinam

**Pixel Agents** (a referência principal de dados).
- Hooks autenticados por padrão; fallback lendo `~/.claude/projects/*.jsonl` a cada 1 s: `assistant` com `tool_use` marca ativo e gera o rótulo ("Reading foo.ts"); `user` com `tool_result` encerra a ferramenta com 300 ms de atraso para não piscar; `system/turn_duration` encerra o turno.
- Sem hooks, timers: 5 s de silêncio depois de turno só de texto = concluído; ferramenta sem resultado por 7 s = provável pedido de permissão.
- Tudo vira um `AgentEvent` canônico (toolStart, toolEnd, permissionRequest, turnEnd, subagentStart).
- Personagem: IDLE, WALK, TYPE (e "lendo"); anda por BFS em grade até a cadeira; "Areas" do mapa recebem diretórios; subagentes em volta do pai; medidor de contexto sob o nome.
- **Celular:** com `--host 0.0.0.0`, qualquer navegador da rede vê um escritório somente leitura; ações exigem token. Roda no Windows. O roadmap prevê "um escritório por projeto", que é a ideia do Igor (ainda não entregue).
- Copiar: evento canônico, dupla fonte com timers, áreas por diretório, leitura sem token na LAN. Evitar: a heurística de 7 s, que erra em ferramentas lentas.

**Multi-Agent Observability (disler)**: 12 hooks chamam um script que faz POST para `localhost:4000/events`; o servidor grava em SQLite (WAL) e transmite em `WS /stream`; quem conecta recebe os últimos 300 eventos. Copiar o envelope simples e o **snapshot na conexão**. **Não reaproveitar código: o repositório não tem licença.**

**AI Town**: estado com autoridade no servidor, passos de 1 s com histórico curto de posições para o cliente interpolar (bom para celular lento); A* em grade com teto de cálculos de rota por passo. Evitar: movimento inventado por LLM; no Arcadia o movimento precisa refletir eventos reais.

**Vibecraft**: o Claude anda até a **estação da ferramenta** (estante para Read, mesa para Write, bancada para Edit, terminal para Bash, scanner para Grep, antena para Web, portal para Task que cria mini-Claudes, quadro para TodoWrite); comemora commit, balança a cabeça no erro, a zona pulsa quando precisa de você. Hook em bash anexa num `events.jsonl` e faz POST em segundo plano. Parado desde 01/2026 e não roda no Windows.

**Claw3D**: salas com função (review, QA, standup) que "seguram" agentes. Evitar duas stacks de render e gatilhos por texto de chat.

**Star Office UI**: tabela estado para zona (idle no sofá; trabalhando na mesa; erro no "canto do bug") e um **memo diário** gerado das notas do dia anterior. Evitar: estado reportado pelo próprio modelo, que falha em silêncio; e a arte não comercial.

**Claude Office (paulrobello)**: o principal é o chefe e os subagentes são funcionários; uma lixeira enche com o contexto e o chefe pisa nela na compactação; um "Command Center" com colunas Precisa de você, Trabalhando, Feito, Encerrado.

**Claude-Office (W17ant)**: statusline como fonte barata de custo e contexto; na permissão o personagem **levanta a mão** e a pílula fica âmbar. Evitar eventos aleatórios (pizza, incêndio) que se confundem com sinal real.

**pixtuoid**: "?" quando precisa de você, dorme quando termina, pilha de papel pelos tokens, **abre um andar novo quando o atual lota**, cor da roupa vem do diretório.

**Agents Office**: 35 mesas em 6 departamentos em volta de um "Brain"; o cartão de tarefa **caminha de volta até o líder**. Licença não comercial: só ideia.

**Roving Office (Atlassian Labs)**: "a sala é o painel"; Three.js vendorizado sem build num único servidor; adaptadores para Claude Code, Codex, Cursor e OpenClaw falando um protocolo neutro. Muito alfa.

**AgentCraft**: mapa igual ao sistema de arquivos (a posição mostra o arquivo em que o agente mexe). Lição do [talk](https://ai.engineer/talks/agentcraft-putting-the-orc-in-agent-orchestration): baratear cada intervenção não reduz quantas intervenções existem.

**AgentCraft mod (Minecraft)**: pergunta e merge como **lugares físicos** (um pódio onde os agentes vêm perguntar, uma estação de merge com diff).

**Generative Agents**: um ícone curto resume a ação de cada personagem; modo replay. **ChatDev**: identidade visual fixa por papel. **AI Village**: linha do tempo por meta com recaps diários.

**Clientes de celular** (Happy, CloudCLI, Omnara, vibe-kanban, claude-squad): todos são para conversar e comandar; nenhum é um mundo.

**Tracing** (Langfuse, Phoenix, AgentOps): o modelo trace com spans aninhados é um bom modelo mental para o "detalhe da tarefa". O OTel do Claude Code manda em lotes de 5 s: não serve para tempo real. O [claude-code-otel](https://github.com/ColeMurray/claude-code-otel) monta Collector, Prometheus, Loki e Grafana.

## 3. Padrões que se repetem

- **Fontes:** hooks como padrão e JSONL como fallback; o hook nunca bloqueia o agente (POST em segundo plano ou socket); orquestradores entregam por WS ou SSE.
- **Máquina de estados:** nasce (porta, efeito) → anda até o posto → trabalha (digita ou lê, conforme a ferramenta) → pensa → precisa de você (mão, balão, âmbar) → erro (vermelho, balança a cabeça) → concluído (check, café, sofá, cochilo) → sai. Timers comuns: debounce de 300 ms; 5 s sem dados = concluído; 2 a 3 min = cochilo ou alerta.
- **Layout:** grade de tiles; estação por ferramenta; zona por estado; departamentos; andares; prédio ou distrito por projeto.
- **Subagentes e delegação:** em volta do pai; mini-agentes saindo de um portal; aviões de papel; cartão que volta andando.
- **Detalhe da tarefa:** rótulo sobre a cabeça, medidor de contexto, inspetor, timeline com rebobinar.
- **Muitos agentes:** andares que abrem sozinhos, colunas por estado, "fantasmas" para agentes sem tela, teto de eventos na tela e de cálculos de rota por passo.

## 4. Lacunas que o Arcadia ocupa

1. **Sala que nasce sozinha e fica.** Ninguém cria a sala no primeiro evento e a mantém depois com história.
2. **OpenMausBot.** Nenhum visualizador fala com ele, e ele entrega o que falta aos outros: eventos canônicos, "precisa de você" exato e a árvore de delegação.
3. **Personagem é bot persistente, não sessão.** Quase todos criam personagens efêmeros; os bots do Igor têm papel, cor e corpo fixos.
4. **3D leve em celular antigo, só leitura.** Os projetos 3D miram desktop (WebGPU, bloom, R3F pesado).
5. **História do universo.** Existem replays por sessão, mas nada mostra quando cada sala nasceu e quem trabalhou onde.
6. **Toque para ver detalhe, sem controle.** Quase todos levam ao terminal.

## 5. As cinco ideias mais fortes para emprestar

1. **Evento canônico com várias fontes** (Pixel Agents): hooks, JSONL e o SSE do OMB num único formato, com timers só onde falta sinal.
2. **Log append-only, push que nunca bloqueia e snapshot na conexão** (Vibecraft, disler), mais **replay determinístico** (roundtable): é a história do mundo.
3. **Lugar com significado** (Vibecraft, Star Office, AgentCraft): ferramenta vira estação, estado vira zona, projeto vira sala. Na tela pequena, posição comunica mais que texto.
4. **"Precisa de você" acima de tudo** (W17ant, paulrobello, Pixel Agents): mão levantada, âmbar, fila "Precisa de você".
5. **Delegação como objeto que viaja** (Agents Office, agent-floor): o envelope sai da sala de quem delega, fica na mesa de quem executa enquanto está `running` e volta quando chega a `completed`, seguindo a árvore de assignments do OMB.

## 6. Teste rápido possível hoje

`npx pixel-agents --host 0.0.0.0` com "Watch All Sessions" ligado, aberto no celular, mostra o modo somente leitura de um mundo 2D com as sessões do Claude Code. Serve como referência de sensação e de leitura no celular. Só numa rede local confiável.
