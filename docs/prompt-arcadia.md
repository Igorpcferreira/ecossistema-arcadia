# Arcadia: prompt de implementação do universo dos agentes

> Escrito em 22/10/2026 numa sessão só de estudo e atualizado no mesmo dia depois da escolha do Igor pela **pixel art**. Esta é a missão completa para a sessão que vai construir o Arcadia. Leia **tudo** antes de agir.

## 0. Como usar (para o Igor)

1. Abra uma sessão nova do Claude Code na pasta `C:\Users\user\Documents\AAA_PROGRAMMING\ecossistema-arcadia` (Opus 5.5, esforço alto ou máximo).
2. Cole esta mensagem:

   ```
   Leia docs/prompt-arcadia.md inteiro, depois docs/local/contexto-local.md, todos os arquivos de docs/estudo/ e abra a prancha docs/local/conceitos/arcadia-pixel.html. Execute a Fase 0 e me mostre o resultado antes de construir qualquer coisa.
   ```

3. A sessão para só nos portões que são seus (refino visual, mudanças de configuração, rede, commit e push) e junta as perguntas de gosto.

## 1. Leitura obrigatória antes de qualquer ação

| Arquivo | O que tem |
|---|---|
| `docs/local/contexto-local.md` | **fora do Git**: máquina, portas em uso, mapa real das pastas e frentes, links privados, a ficha dos personagens humanos e as preferências do Igor |
| `docs/local/conceitos/arcadia-pixel.html` | **a prancha aprovada como ponto de partida**: o andar inteiro em pixel art, rodando com dados simulados (fora do Git, porque tem os personagens pessoais) |
| `docs/estudo/05-direcoes-de-arte.md` | a direção em pixel art: mundo, alas, personagens, estados, identidade; e o histórico das direções 3D descartadas |
| `docs/estudo/04-stack-e-celular.md` | motor 2D recomendado, técnicas de pixel art no celular antigo, orçamento, licenças, rede local, bateria |
| `docs/estudo/01-openmausbot.md` | o OpenMausBot como fonte: SSE, snapshot, árvore de delegação, autenticação, o que nunca ler |
| `docs/estudo/02-fontes-de-atividade.md` | Claude Code (hooks, JSONL, OTel), Codex (hooks, rollouts, notify), MCP, pipeline à prova de falhas, privacidade |
| `docs/estudo/03-referencias.md` | projetos parecidos (Pixel Agents, Vibecraft, AI Town e outros), o que copiar e evitar, lacunas |
| `docs/conceitos/direcoes-de-arte.html` | prancha 3D da primeira rodada (histórico: o Igor achou "longe do que eu penso") |

Se um fato daqui divergir do que você observar na máquina, **vale o que você observar**: registre a divergência em `docs/estado-atual.md` e siga.

## 2. Quem é o Igor e o que ele quer

Desenvolvedor full-stack em Goiânia, com várias frentes ao mesmo tempo (trabalho CLT, estúdio próprio, clientes, produtos próprios, vídeos). Gosta de **academia**, **programação** e **games**. Usa muito Claude Code e Codex, e está montando equipes de bots no **OpenMausBot** (app desktop que orquestra bots com papéis, cada um rodando Claude Code ou outro motor por baixo, com delegação entre eles). A primeira equipe é a do Copiloto (Coordenador, Design, Dev, QA e Crítico), e ela **ainda está em desenvolvimento**: é o primeiro inquilino do Arcadia, não o molde.

**O pedido, nas palavras dele (trechos):**
- "construir um universo tridimensional para ver os meus agentes trabalhando", "bem estilo joguinho mesmo";
- "cada projeto tem uma sala... e viraria departamentos", "conforme eu for trabalhando, é criado essas salas... e depois fica lá", "algo vivo";
- "um celular que eu não uso muito... deixar ligado em frente ao computador... só de visualizar já é legal", "ver as tarefas, se eu conseguir expandir a tarefa", "não preciso controlar nada do celular";
- depois de ver a primeira prancha em 3D low-poly: "tá longe do que eu penso", "pixel art... a gente consegue dar muito detalhe... os elementos do mundo e os personagens", "um mundo que seja mais complexo, que tenha mais coisa", "achei pequeno os modelos", "pense em algo mais futurista";
- "coloca a [pessoa] no cenário... trabalhando... ela fica fixa", "fazer até um personagem parecido com a gente" (ficha dos personagens humanos no contexto local).

**A intenção, melhorada:**
1. **Um aquário vivo do trabalho**, em pixel art detalhada com cara de jogo: de relance, saber quem trabalha, em quê, onde, quem precisa dele e o que foi entregue.
2. **Um mundo complexo e futurista que cresce com a vida profissional dele**: um andar de arcologia com alas por frente, salas por projeto que nascem sozinhas e ficam, com história.
3. **Pessoal**: o Igor e a pessoa fixa no Cockpit, academia, programação e games como temas do mundo.
4. **Feito para um celular antigo parado na mesa**: modo aquário que se dirige sozinho; toque abre detalhes; nada de controle.
5. **Seguro e invisível para os agentes**: não atrapalha, não expõe segredo, não muda nada.

**Fora de escopo agora:** controlar agentes, aprovar cartões, mandar mensagens (o OpenMausBot já tem app de celular e PWA para isso), acesso pela internet, vários usuários.

## 3. Princípios inegociáveis

1. **Só observar.** O Arcadia nunca escreve em `~\.openmausbot`, `~\.claude` ou `~\.codex`; no OpenMausBot usa só GET e o SSE, com lista fixa de rotas permitidas; nunca abre os SQLite do app; nunca lê `hook-tokens`, `sessions.json`, `config.json`, o lease ou credenciais (`01-openmausbot.md`, seção 9).
2. **Nunca atrapalhar um agente.** Hooks (quando o Igor autorizar) são assíncronos, saem sempre com 0, não imprimem nada, têm timeout curto e spool em disco. Arcadia desligado tem efeito zero nos agentes.
3. **Mudança de configuração só com o ok do Igor**, uma por vez, com backup, diff mostrado e como desfazer: `~\.claude\settings.json`, `~\.codex\*`, firewall, perfil de rede, variáveis de ambiente, tarefas agendadas, instalação de programas. **Settings de projeto nunca** (o `.claude\settings.json` do Copiloto tem o guardião da equipe e só o Igor altera).
4. **Privacidade por padrão.** Allowlist de campos; nada de prompt, resposta, thinking, `tool_input` bruto, comando, diff, conteúdo de arquivo, caminho completo, e-mail ou token para o navegador. Caminhos viram apelidos de sala. Regex de segredos como segunda barreira. Teste automatizado que procura campos proibidos no fluxo que sai para os clientes. Caminhos de arquivo podem ser usados **só em memória** para decidir a sala.
5. **Rede local apenas.** Ingestão em `127.0.0.1`; visualização na LAN com pareamento; nada exposto à internet; regra de firewall só no perfil Privado e só para a sub-rede local.
6. **Celular antigo primeiro.** Orçamento da `04-stack-e-celular.md`, seção 1; presets de qualidade; 30 fps; pausa quando a aba some; teste de 24 horas.
7. **Funciona sem fonte.** Simulador determinístico desde o primeiro dia (desenvolver, testar, demonstrar) e replay do histórico real.
8. **Genérico e extensível.** Nenhum nome de projeto, bot, equipe ou papel fixo no código. Tudo vem dos dados e de um arquivo de configuração. Adaptadores, alas e plugins de domínio plugáveis.
9. **Repositório público.** O `ecossistema-arcadia` é público no GitHub: nada de dados reais, nomes de clientes, nomes do trabalho, caminhos pessoais, **personagens pessoais** (o Igor, a pessoa fixa, as fotos de referência), capturas com dados reais, tokens ou configuração real no Git. Isso fica em `docs/local/` (ignorado) ou em `%USERPROFILE%\.arcadia\` e `%LOCALAPPDATA%\Arcadia\`. O repositório traz personagens genéricos; os pessoais entram por um pacote local carregado em tempo de execução.
10. **Escrita.** Português do Brasil, "você", frases curtas, sem travessão, sem meia-risca, sem hífen com espaços como separador, sem emoji, datas dd/mm/aaaa, dinheiro em R$ (US$ entre parênteses quando a fonte for em dólar). Vale para UI, documentos, comentários e mensagens de commit. Crie uma checagem automática para isso.
11. **Git.** Commit e push só com autorização explícita do Igor, por escopo; proponha ao fim de cada fase. Nunca force push. Sem `git init` em pasta agregadora.
12. **Evidência.** Só afirme o que rodou: comando, código de saída e saída real. Abra as capturas que gerar. Diga o que não foi verificado (aparelho físico, OpenMausBot real, hooks reais).
13. **Licenças.** Só código e arte com licença compatível com repositório público (CC0, MIT, Apache-2.0, OFL para fontes). Pacotes pagos de pixel art que proíbem redistribuir os arquivos (LimeZu e afins) **não** entram no repositório. Nada do disler (sem licença), Agents Office (não comercial), arte não comercial do Star Office. Tudo registrado em `docs/creditos.md`.
14. **Protótipos nunca se apagam.** Toda opção visual fica acessível (por exemplo `/prototipos` e `?skin=`), e as pranchas de estudo continuam onde estão.

## 4. O mundo

A direção completa está na `05-direcoes-de-arte.md`. O resumo que guia o código:

### 4.1 Forma

- **Um andar de arcologia flutuante**, em pixel art isométrica (ladrilhos de 32 por 16), ampliado em múltiplos inteiros sem borrar. Paredes de fundo com janelas para uma cidade futurista (carros voadores, letreiros), laje com janelas dos andares de baixo, corredores com luzes-guia e **linhas de dados** que levam pulsos de cada ala até o **Núcleo**.
- **Alas** = departamentos (frentes); **salas** = projetos. A prancha tem 11 alas: Servidores, Copiloto, Kyber Tech, Estúdio de vídeo, Trabalho, Núcleo OpenMausBot, SABINVS e academia, Lounge, Recepção (teletransporte), Produtos (com o terreno da próxima sala) e o **Cockpit** do Igor.
- **Cresce**: projeto novo vira sala nova no terreno livre da ala (obra com drones, andaime, faíscas, letreiro com o nome); ala nova ocupa um terreno do andar; andar cheio ganha um andar novo (elevador ou teletransporte entre andares).
- **Zoom por níveis**: andar inteiro, ala, sala, personagem, tarefa.

### 4.2 Personagens

- **Agentes são androides**: cor e corpo herdados do OpenMausBot (`color`, `mascotBody`), olhos de LED que mudam com o estado, luz no peito na cor do estado, acessório inferido do cargo (headset, boina, fone, lupa, monóculo, gravata...).
- **Sessões fora do OMB** viram androides visitantes: Claude Code em terracota, Codex de casco escuro e olhos brancos. Chegam e saem pelo teletransporte da Recepção.
- **Subagentes** são minidrones que nascem ao lado do pai e somem ao entregar.
- **Drones** carregam o que viaja: envelope de delegação, pedido do Igor, aprovação (check verde), pacote de entrega até o Núcleo.
- **Humanos**: o Igor (no Cockpit; manda pedidos por drone e treina na academia nos intervalos) e a **pessoa fixa** do Cockpit, sempre trabalhando na mesa dela. Aparência, nomes e detalhes só no contexto local.
- **NPCs** de cenário: recepcionista, drone de manutenção dos servidores.

### 4.3 Estados viram lugar e gesto

| Estado | Fontes principais | Mundo |
|---|---|---|
| chegando | `session.started`, SessionStart, rollout novo | feixe no teletransporte, anda até a sala |
| pensando | `turn.started` sem item, `reasoning` | olhos para cima, ícone de três pontos |
| lendo | Read, Grep, Glob, WebFetch, WebSearch | olhos para baixo, holograma de texto |
| editando | Edit, Write, apply_patch | digitando, holograma de código na cor do estado |
| rodando comando | Bash, PowerShell | terminal verde; build acende o ON AIR no estúdio quando for vídeo; commit e deploy detectados por padrão de comando (sem mostrar o comando) |
| delegando | `coordinate_bots`, Task/Agent | drone com envelope até o colega e volta na conclusão |
| **esperando você** | `request.opened`, `waiting-on-you`, `needs_input`, PermissionRequest, Notification `permission_prompt` | olhos "! !", coluna de luz âmbar, botão "Precisa de você" no HUD; quando o Igor aprova de verdade, um drone verde leva o check |
| erro | `runtime.error`, `turn.completed ok:false`, PostToolUseFailure, StopFailure | olhos "X X", fumaça, racks piscam vermelho |
| entregou | `turn.completed ok`, Stop, `task_complete` | confete, drone com pacote até o Núcleo, contador de entregas |
| ocioso | sem atividade | vai à **academia** (halteres, esteira, palco de poses) ou ao **lounge** (café, whey, fliperama); à noite dorme |
| na fila | `bot.queued`, nó `queued` | espera na recepção |
| sem sinal | `no-signal`, `dead` | congelado e translúcido |
| limite de uso | `cap.exhausted`, rate_limit | apagão na ala do motor |

Timers só onde falta sinal exato: debounce de 300 ms; turno só de texto sem dados por 5 s = concluído; ferramenta sem resultado por mais de 7 s **sem hook** = "talvez esperando" (estado próprio, diferente do âmbar exato); 3 min ocioso = pausa; 20 min = dorme.

### 4.4 Vida ambiente

Dia e noite pelo relógio real (fuso America/Sao_Paulo); estrelas e nuvens em pixel; servidores piscando no ritmo da atividade; esteiras girando; vapor do café; peixes no aquário; teclado RGB; letreiros neon que falham de vez em quando; pulsos de dados nas linhas; som desligado por padrão (no celular, sempre).

### 4.5 Modos de uso e cartões

- **Aquário** (padrão no celular): câmera que passeia sozinha, com prioridade para quem espera você, erros, entregas, obra e trabalho intenso; volta sozinho depois de 25 s sem toque.
- **Explorar**: arrastar, pinça e roda para zoom em múltiplos inteiros, toque abre cartão.
- **Replay**: "o dia em um minuto".
- **Cartões** (DOM, só leitura): agente (estado, tarefa saneada, últimas ações, tokens, árvore de delegação), sala, ala, "Precisa de você".
- **Balões** em DOM com texto curto do estado, no máximo 3 no celular e 7 no PC, por prioridade.

## 5. Arquitetura

### 5.1 Visão geral

```
Fontes ──> Adaptadores ──> Normalizador (ArcadiaEvent) ──> Motor do mundo ──> SQLite (eventos saneados + snapshots)
                                                                  └──> Transmissão (snapshot + SSE) ──> Clientes (PC e celular)
```

- **`apps/server`** (Node 24 LTS, TypeScript): coleta, normaliza, mantém o estado, grava histórico, serve a UI e o fluxo. Dois listeners: `127.0.0.1:47800` (ingestão de hooks, saúde, `doctor`) e `0.0.0.0:4780` (visualização: estáticos, `/api/snapshot`, `/api/events`, pareamento, só dados saneados). Portas configuráveis; conferir antes com `Get-NetTCPConnection`.
- **`apps/world`** (Vite, TypeScript, motor 2D; HUD e cartões em DOM): renderiza o estado; nunca calcula regra de negócio; coreografa caminhadas a partir de eventos semânticos.
- **`packages/shared`**: esquema do evento canônico e do estado (zod), tipos, saneamento.

Motor e versões na `04-stack-e-celular.md`, seção 1. Registre a decisão final num ADR curto em `docs/decisoes/0001-stack.md`, com os motivos.

### 5.2 Adaptadores

| Adaptador | Papel | Fase |
|---|---|---|
| **Simulador** | cenários determinísticos com semente: dia normal, pico, falhas, "esperando você", 30 agentes, sala nova nascendo, visitante chegando | 1 |
| **OpenMausBot** | descoberta pelas portas 8799, 18799, 28799 (`/.well-known/openmausbot/environment` + `environment-id`); snapshot `/api/bots?messages=0`, `/api/team-map`, `/api/today`, `/api/routines`; SSE `/api/events?screens=off` com `Last-Event-ID`; árvore `/api/threads/{raiz}/job` com debounce de 300 ms; `session.started` liga sessão e thread. Detalhes e proibições na `01-openmausbot.md`, seção 12 | 2 |
| **Transcrições do Claude Code** | zero instalação: `~\.claude\projects\**\*.jsonl` e `subagents\`; campo `cwd` (não o nome da pasta); `entrypoint` diz a origem (`sdk-cli` = bot do OMB, `claude-vscode`, `claude-desktop`); `~\.claude\sessions\` diz quem está vivo; catch-up das últimas 24 h na partida | 2 |
| **Rollouts do Codex** | `~\.codex\sessions\AAAA\MM\DD\rollout-*.jsonl`; `originator` diz a origem (inclusive `openmausbot`) | 2 |
| **Hooks do Claude Code** | baixa latência e "esperando permissão" exato nas sessões fora do OMB; script assíncrono da `02-fontes-de-atividade.md`, seção 5; instalador e desinstalador com backup e diff; **só com o ok do Igor** | 6 |
| **Hooks e notify do Codex** | aprovação em `/hooks` feita pelo Igor; **só com o ok dele** | 6 |
| **Plugins de domínio** | interface genérica para arquivos de processo de uma equipe. Primeiro plugin: equipe do Copiloto (portões G0 a G4 no README da demanda, demanda ativa, bloqueios do guardião), só leitura e tolerante a mudança de formato. Vira o quadro de portões da ala | 6 |
| **Git** | entregas por `git log -1` periódico nas salas ativas, só leitura | 5 |
| **OTel** | custo e tokens agregados (nunca conteúdo) | 6, opcional |
| **MCP "arcadia"** | o agente anuncia rótulos; nunca fonte de verdade | 6, opcional |

Prioridade entre fontes e chaves de deduplicação: `02-fontes-de-atividade.md`, seção 6.

### 5.3 Evento canônico (ponto de partida)

```ts
type ArcadiaEvent = {
  v: 1;
  id: string;                 // estável: hash da origem + chave natural (para deduplicar)
  ts: number;                 // momento do evento na fonte (ms)
  recebidoEm: number;
  origem: 'omb' | 'claude-transcricao' | 'claude-hook' | 'codex-rollout' | 'codex-hook' | 'dominio' | 'git' | 'sim';
  motor: 'claude' | 'codex' | 'outro';
  agente: { chave: string; tipo: 'bot' | 'sessao' | 'subagente' | 'humano'; nome?: string; cargo?: string; cor?: string; corpo?: string; paiChave?: string };
  local: { projetoChave?: string; equipe?: string };   // nunca o caminho cru
  tipo:
    | 'sessao.inicio' | 'sessao.fim' | 'pedido.humano'
    | 'turno.inicio' | 'turno.fim' | 'pensando'
    | 'ferramenta.inicio' | 'ferramenta.fim' | 'ferramenta.erro'
    | 'espera.inicio' | 'espera.fim'
    | 'delegacao.enviada' | 'delegacao.recebida' | 'delegacao.concluida'
    | 'subagente.inicio' | 'subagente.fim'
    | 'compactacao' | 'erro' | 'limite' | 'uso' | 'entrega' | 'dominio';
  ferramenta?: { nome: string; categoria: 'ler' | 'editar' | 'comando' | 'web' | 'navegador' | 'delegar' | 'integracao' | 'outro'; alvo?: string; ok?: boolean; duracaoMs?: number };
  espera?: { tipo: 'permissao' | 'pergunta' | 'aprovacao' | 'talvez' };
  delegacao?: { de: string; para: string; jobId?: string; titulo?: string; status?: string };
  uso?: { entrada?: number; saida?: number; cache?: number; custoUsd?: number };
};
```

`alvo` é só o nome curto do arquivo ou um apelido, e só quando o config permitir. Não existe campo de conteúdo bruto.

### 5.4 Motor do mundo

- Redutores puros (evento > estado) com testes. Estado: alas, salas (com posição no andar), agentes (estado, desde, tarefa, últimas ações), delegações em voo, fila "precisa de você", métricas do dia, saúde, obras em andamento.
- **Salas que nascem e ficam**: chave = raiz git do `cwd` normalizada (no Windows, sem diferenciar maiúsculas; barras normais); sem git, regra de pasta agregadora do config ou a própria pasta. Bots do OMB com pasta privada (`~\.openmausbot\task-workspaces\...`) usam `tasks[].cwd`/`pinnedCwd` ou o QG da equipe. Ala por regras de glob no config; sem regra, a sala vai para a **Recepção** até o Igor classificar. Salas nunca são apagadas automaticamente; sala ociosa dorme. Lista de exclusão para pastas que nunca viram sala (ver contexto local).
- **Layout do andar**: as alas ocupam lotes de uma grade; cada sala ocupa um terreno dentro da ala, gerado de um modelo por tipo de projeto (web, app, vídeo, backend, pesquisa) com mobília procedural; a posição de cada sala é **estável** (gravada) para o Igor reconhecer o lugar ao longo dos meses.
- Agente vai até a sala do arquivo que mexe (histerese de 20 s).
- Relógio injetável (testes, replay, simulador).
- Persistência: SQLite em `%LOCALAPPDATA%\Arcadia\dados\` (WAL): eventos saneados append-only, snapshots periódicos, alas, salas e posições, métricas diárias. Retenção configurável (padrão 180 dias). Replay de qualquer instante = snapshot + eventos.
- Configuração real em `%USERPROFILE%\.arcadia\arcadia.config.yaml` (fora do repositório); o repositório tem `config/arcadia.config.exemplo.yaml` com nomes genéricos. O **pacote de personagens pessoais** (aparência do Igor e da pessoa fixa) também fica em `%USERPROFILE%\.arcadia\`.

### 5.5 Transmissão

- `GET /api/snapshot` (gzip, com `seq` e `buildId`) e `GET /api/events` (SSE com `id`, `retry`, ping a cada 15 s). Buffer de ~1.000 eventos; buraco de `seq` = `event: resync`.
- Eventos semânticos, não posições. Rajadas agrupadas em 250 ms.
- O cliente recarrega quando o `buildId` muda (atualização sem tocar no celular).

### 5.6 Cliente em pixel art

- **Base**: a prancha `docs/local/conceitos/arcadia-pixel.html` mostra o caminho (Canvas 2D, sprites gerados por código e guardados em cache, camada estática pré-renderizada, ordenação isométrica, luz noturna com multiplicação e brilhos aditivos, balões em DOM). Ela roda a 60 fps no PC e no teto de 30 fps no celular emulado; serve de referência visual e de comportamento, não de arquitetura final.
- **Motor recomendado**: PixiJS 8 (WebGL, lote de sprites, texturas geradas a partir dos mesmos desenhos procedurais) com renderização em resolução baixa e ampliação inteira; Phaser 4 é a alternativa se a Fase 0 concluir que vale um framework de jogo completo; Canvas 2D só se o PixiJS falhar no celular. Decisão no ADR.
- **Arte**: gerada por código (consistente, sem problema de licença, permite salas e personagens novos sozinhos) e refinada à mão onde importa (os humanos, os androides principais, peças-chave). Folhas de sprite com animações (parado, andar, sentar e digitar, levantar peso, pose, correr, beber, jogar, acenar).
- **Personagens humanos pessoais** carregados do pacote local, nunca do repositório.
- **Presets** `baixo`, `medio`, `alto` (escala, número de brilhos, partículas, frequência das animações), com `?q=` para forçar.
- Fontes servidas pelo próprio servidor (Silkscreen e VT323 são OFL); nada de CDN em tempo de execução.
- Acessibilidade: estado por forma, cor e ícone; `prefers-reduced-motion`; contraste; tudo em português.
- `webglcontextlost` recarrega; reload programado de madrugada; heap estável em 24 h.

### 5.7 Celular e rede local

- **MVP em HTTP** na porta 4780, só na sub-rede local, com **pareamento**: a tela do PC mostra um QR com um código de uso único (5 min) que vira cookie de longa duração no celular, revogável na tela do PC. Sem cookie, nada de dados.
- Regra de firewall e perfil de rede: comandos prontos na `04-stack-e-celular.md`, seção 6, **executados pelo Igor ou com o ok dele**.
- Endereço: reserva DHCP no roteador (instrução para o Igor) e QR com o IP.
- Tela acesa: "Permanecer ativo" (grátis); Fully Kiosk PLUS é opcional pago (pergunte). Wake Lock e PWA só com HTTPS (Caddy com `tls internal` ou Tailscale), em fase posterior e com ok.
- HUD do celular enxuto (aquário, noite, zoom), balões limitados, botão "Precisa de você" só quando houver alguém esperando.
- Página "Como ligar o celular" no próprio Arcadia (passo a passo com imagens).
- Bateria e tela: cuidados da `04-stack-e-celular.md`, seção 7, viram um checklist no README.

### 5.8 Estrutura do repositório

```
ecossistema-arcadia/
  AGENTS.md  CLAUDE.md  README.md  .gitignore
  apps/server/   src/adaptadores/{sim,omb,claude-transcricao,claude-hook,codex,dominio,git}  src/mundo  src/db  src/http
  apps/world/    src/motor (iso, câmera, ordenação, luz)  src/arte (gerador de sprites, paletas, ladrilhos, mobília)  src/alas  src/personagens  src/ui  src/qualidade
  packages/shared/   esquema, tipos, saneamento
  tools/         doctor, simular, instalar-hooks, desinstalar-hooks, gravar-cenario, exportar-sprites
  config/        arcadia.config.exemplo.yaml, personagens.exemplo.json
  assets/        fontes OFL, sprites originais, LICENCAS
  scripts/       PowerShell: firewall (imprime, não executa), iniciar com o Windows
  docs/          prompt-arcadia.md, estudo/, conceitos/, decisoes/, estado-atual.md, proxima-sessao.md, creditos.md, local/ (ignorado)
```

Workspaces com npm (o Igor já usa) ou pnpm, decisão registrada no ADR.

## 6. Fases e portões

Cada fase termina com relatório curto ao Igor: o que foi feito, comandos e saídas, capturas lidas, o que **não** foi verificado, e o pedido de autorização de commit e push daquele escopo.

### Fase 0: preparação e verificação (sem código de produto)

1. Ler tudo da seção 1 e abrir as duas pranchas.
2. Criar a continuidade no padrão do Igor: `AGENTS.md` (regras desta missão, curtas), `CLAUDE.md` (aponta para o AGENTS.md), `docs/estado-atual.md`, `docs/proxima-sessao.md` (único roteiro vigente), `docs/decisoes/`, `docs/creditos.md`, `config/arcadia.config.exemplo.yaml`.
3. Verificar, só lendo: versões (`node -v`, `claude --version`, `codex --version`), portas livres, estrutura de `~\.claude\projects` e `~\.codex\sessions` (só nomes e campos), se o OpenMausBot está aberto.
4. Se o OMB estiver aberto: `GET /.well-known/openmausbot/environment`, `GET /api/health`, `GET /api/bots?messages=0` e 60 s do SSE com `screens=off`, registrando **só** tipos de quadro, contagens e nomes de campos em `docs/local/verificacao-omb.md` (nada de conteúdo). Se estiver fechado, registre e siga.
5. Prova rápida do motor: a mesma cena da prancha portada para o motor recomendado, medindo fps com CPU limitada no Playwright (aproximação do celular).
6. Perguntar ao Igor, numa mensagem só: modelo do celular e versão do Android; se a Wi-Fi do PC está como rede privada; se confirma o mapa de alas proposto; se quer modo autônomo.
7. ADR da stack.
8. **Portão G0:** relatório de verificação; nenhum hook, configuração ou rede alterados.

### Fase 1: lapidar a direção em pixel art (o Igor escolhe vendo)

A direção está escolhida: **pixel art isométrica, futurista, complexa, com o Cockpit pessoal**. A Fase 1 mostra as variações que ainda são gosto dele, todas no motor escolhido, com o mesmo cenário simulado:

1. **Escala dos personagens**: 16 por 32 (como a prancha) contra 24 por 40 (mais detalhe de rosto e roupa).
2. **Arte**: só procedural contra procedural com passe à mão nos humanos e nos androides principais (a semelhança com o Igor e a pessoa fixa pesa aqui).
3. **Celular em pé**: o isométrico com câmera aquário contra um **corte lateral em pixel** (andar visto de frente, estilo Tiny Tower) só para o celular.
4. **Paleta e luz**: noite neon fria contra noite quente (lampiões e madeira), ambas com dia e noite pelo relógio.
5. **Densidade**: o andar da prancha contra um andar mais cheio (mais mobília, mais NPCs de cenário, letreiros e detalhes de academia e games).

Entregas: página `/prototipos` com as variações lado a lado, medidor de fps, presets e uma frase por opção; servida temporariamente na LAN para o Igor abrir no PC **e no celular** (com o ok dele para a regra de firewall; sem ele, sirva só no PC e peça). Capturas em 1440 e 390 px de cada uma, lidas por você, numa página local fora do Git. Se o Igor ligar workflows ou subagentes, as variações podem ser feitas em paralelo; o revisor é sempre outro agente.

**Portão G1:** o Igor escolhe as variações. A Fase 3 não começa sem isso. A Fase 2 corre em paralelo.

### Fase 2: núcleo de dados (pode correr junto com a Fase 1)

1. `packages/shared`: esquema, saneamento (allowlist + regex de segredos) com testes.
2. Adaptadores: simulador completo, transcrições do Claude Code (com catch-up), OpenMausBot (snapshot, SSE, jobs), rollouts do Codex.
3. Motor do mundo (redutores, timers, resolução de sala, layout estável do andar), SQLite, snapshot e SSE, `doctor` (estado de cada fonte, último evento, contagens, versão do OMB, portas).
4. Testes: unitários (redutores, saneamento, resolução de sala), fixtures sintéticas (JSONL, rollout, SSE gravado com dados inventados), teste de contrato contra os tipos `shared/wire.ts` e `shared/runtime-events.ts` da tag instalada do OMB, replay determinístico, **teste de vazamento** (nenhum campo proibido no fluxo de saída).
5. **Portão G2:** `doctor` mostra cada fonte; uma sessão real do Claude Code no VS Code aparece como androide na sala certa em até 2 s depois do evento chegar ao JSONL; um turno real de bot do OMB aparece; o teste de vazamento passa; nada foi escrito fora de `%LOCALAPPDATA%\Arcadia` e do repositório.

### Fase 3: o mundo de verdade

1. Alas e salas geradas do estado (nascendo com obra e ficando), personagens com todos os estados da 4.3, drones, minidrones, teletransporte, academia e lounge como destinos de ócio, fila "precisa de você", cartões, aquário, dia e noite, zoom por níveis, Cockpit pessoal carregado do pacote local.
2. **Portão G3:** capturas lidas no PC e no celular (emulado), 30 fps no preset do celular com CPU limitada no Playwright como aproximação, checklist da 4.3 conferido estado por estado com o simulador, revisão visual por outro agente.

### Fase 4: celular e rede

1. Listener da LAN, pareamento por QR e cookie, página "Como ligar o celular", presets automáticos, recarga por `buildId`, reload de madrugada, teste de 24 h com heap estável.
2. Regra de firewall e perfil de rede **com o Igor**.
3. **Portão G4:** o Igor confirma no aparelho real: fps no canto, leitura de longe, toque abrindo cartão, tela acesa.

### Fase 5: vida, história e polimento

Replay "o dia em um minuto", murais e placas de marcos nas salas, troféus na estante do Cockpit por marcos reais, diário do dia gerado localmente (contagens e destaques, sem LLM), mais vida (pássaros e drones de fundo, carros voadores, chuva nas janelas quando há falhas), entregas por git, ajuste fino de desempenho.

### Fase 6: integrações opcionais (cada uma com o ok do Igor)

Hooks do Claude Code no usuário (instalador com backup, diff e desinstalador), hooks e notify do Codex, plugin de domínio da equipe do Copiloto, iniciar com o Windows, OTel para custo, HTTPS com Caddy para PWA e Wake Lock, MCP "arcadia", segundo andar quando o primeiro lotar.

## 7. Definição de pronto do MVP (fim da Fase 4)

- [ ] Com o OMB aberto e uma sessão do Claude Code no VS Code, os dois aparecem como androides nas salas certas e mudam de estado em até 2 s.
- [ ] Um bot do OMB pedindo aprovação fica em âmbar, aparece no botão "Precisa de você" e o modo aquário vai até ele.
- [ ] Uma delegação do Coordenador vira drone com envelope até o colega e volta na conclusão.
- [ ] Projeto novo vira sala nova com obra; sala sem regra cai na Recepção; reiniciar o servidor mantém salas, posições e história.
- [ ] O Igor e a pessoa fixa aparecem no Cockpit a partir do pacote local, e nada pessoal está no Git.
- [ ] O celular antigo do Igor mostra o mundo a 25 fps ou mais no preset escolhido, pareado por QR, só leitura.
- [ ] Teste de vazamento passa; nenhum conteúdo de conversa, comando, caminho completo ou segredo sai para os clientes.
- [ ] Arcadia desligado: os agentes funcionam exatamente igual.
- [ ] Simulador e replay funcionam sem nenhuma fonte ligada.
- [ ] `doctor` explica o estado de cada fonte em português.
- [ ] Documentação de continuidade em dia.

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| API do OMB muda (sem versão, atualiza várias vezes por semana) | adaptador isolado; checagem de `version`; `kind` desconhecido = ignorar e pedir snapshot; teste de contrato; aviso no `doctor` |
| Loopback do OMB deixa de aceitar GET sem token | plano B: sessão `client` pareada ("Somente chat e aprovações"), token em arquivo com ACL restrita, nunca "Acesso completo" |
| Formato do JSONL do Claude ou do rollout do Codex muda | parsers tolerantes; testes com fixtures; métricas de linhas ignoradas no `doctor` |
| Vazamento de segredo ou conteúdo | allowlist, regex de segredos, teste de vazamento, ingestão só em loopback, pareamento na LAN |
| Repositório público expõe dados pessoais | `docs/local/` e pacote de personagens fora do Git; exemplos genéricos; revisão de `git diff --cached` antes de cada commit |
| Pixel art ficar genérica | passe à mão nos personagens-chave; paleta própria; detalhes de academia, programação e games; revisão visual por outro agente com a prancha como régua |
| Celular fraco demais | PixiJS com texturas em atlas, camada estática em textura, presets, menos brilhos e partículas, teto de 30 fps |
| Andar fica cheio demais para ler | zoom por níveis, balões limitados, segundo andar, ala de arquivo para projetos parados |
| Atrasar os agentes | MVP sem hooks; hooks só assíncronos com spool; medir com `claude --debug-file` |
| Bateria inchada ou tela marcada | checklist de cuidado, tema escuro à noite, câmera em movimento, limite de carga |
| Escopo infinito | portões; MVP definido na seção 7; extras só depois do G4 |

## 9. Perguntas que só o Igor responde (e quando)

| Quando | Pergunta |
|---|---|
| Fase 0 | modelo do celular e versão do Android; rede privada; mapa de alas; modo autônomo |
| Portão G1 | escala dos personagens, arte à mão ou procedural, corte lateral no celular, paleta, densidade |
| Fase 1 ou 4 | regra de firewall e, se preciso, mudar a rede para privada |
| Fase 4 | Fully Kiosk pago ou "Permanecer ativo"; HTTPS agora ou depois |
| Fase 6 | instalar hooks do Claude Code e do Codex; iniciar com o Windows; OTel |
| Fim de cada fase | commit e push daquele escopo |
| Qualquer momento | classificar salas da Recepção (no arquivo de config) |

Pergunte em linguagem simples, uma frase por pergunta, com a imagem do que muda e a sua recomendação. Junte as perguntas de gosto no fim de cada fase.

## 10. Primeira resposta esperada da sessão

1. Confirma que leu os documentos da seção 1, abriu as pranchas e cita uma divergência encontrada, se houver.
2. Mostra o resultado da Fase 0 (versões, portas, estado do OMB, estrutura das transcrições, fps da prova do motor) e os arquivos de continuidade criados.
3. Faz as perguntas da Fase 0 numa mensagem só.
4. Apresenta o plano da Fase 1 com o que o Igor vai poder abrir e quando.
