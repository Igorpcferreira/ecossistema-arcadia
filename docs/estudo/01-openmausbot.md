# OpenMausBot visto como fonte de dados do Arcadia

Leitura feita em 22/10/2026 no código do OpenMausBot **0.1.121** instalado no Windows (app Electron), mais o repositório público [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) na tag v0.1.121. Só leitura: nenhuma rota foi chamada, nenhum banco foi aberto, nenhum token foi lido.

- **FATO** = visto no código ou em listagem de pastas, com o arquivo citado.
- **INFERÊNCIA** = dedução que ainda precisa de teste.
- Os números de linha valem para a 0.1.121. O app se atualiza várias vezes por semana (a `main` já estava em 0.1.122 no dia da leitura), então confira antes de depender de um detalhe.

Abreviações de caminho:
- `S` = `%LOCALAPPDATA%\Programs\openmausbot\resources\server\server`
- `SH` = `...\resources\server\shared`
- `C` = `...\resources\companion`
- `A` = `...\resources\app.asar`
- `D` = `%USERPROFILE%\.openmausbot` (dados do app)
- `GH` = repositório no GitHub, tag v0.1.121

## 1. Em uma frase

O OpenMausBot já expõe tudo o que o Arcadia precisa para os bots: um **único fluxo SSE** com eventos canônicos por thread, um **snapshot** de bots, salas e equipes, e a **árvore de delegação**. O Arcadia só precisa ler, nunca escrever.

## 2. Arquitetura que importa

- Servidor local (o "harness") sempre em `127.0.0.1`, numa destas portas: **8799, 18799 ou 28799** (a primeira livre, escolhida pelo Electron e passada em `OMB_PORT`) (`A:22714`, `A:30157`, `S\index.js:16766`).
- A UI manda comandos por HTTP e dobra **um fluxo SSE** em estado. Não existe WebSocket para a UI (README do GH).
- Cada bot roda um **motor** por thread. No caso do Claude Code: `claude -p --output-format stream-json --input-format stream-json --verbose`, com `--setting-sources project`, `--strict-mcp-config` e um `--settings` privado com os hooks do próprio app (`S\drivers\claude.js:924-927, 953-961, 1097-1108`).
- O app normaliza o stream de cada motor em **RuntimeEvent**, grava em `D\events\<thread>.ndjson` (já mascarado) e transmite como quadro `runtime` no SSE (`S\harness\bus.js:188-209`, `S\index.js:6577`).
- São 22 drivers (Claude, Codex via app-server JSON-RPC, Gemini via Antigravity, Grok, Kimi, Cursor, OpenCode, Qwen e outros por ACP, além de APIs compatíveis com OpenAI). Todos publicam o mesmo RuntimeEvent; o campo `provider` diz qual motor gerou (`S\drivers\builtIn.js`, `S\harness\bus.js:42-48`).

## 3. Tempo real: `GET /api/events` (SSE)

**Formato** (`S\index.js:4899-4957`):
- Cada quadro: `id: <STREAM_ID>:<seq>` e `data: {"kind": ..., "seq": n, ...}`.
- O `STREAM_ID` muda a cada início do servidor.
- O primeiro quadro, sem id: `{"kind":"hello","cursor":"<STREAM>:<seq>","resumed":bool}`.
- Batimento a cada 15 s: comentário `: keepalive` e `{"kind":"ping"}`.

**Parâmetros:**
- `screens=off`: **use sempre**. Sem ele, o servidor manda quadros `screen` com PNG em base64 do computador do bot (linha 15797).
- `since=<cursor>` ou cabeçalho `Last-Event-ID` (tem preferência) para retomar.
- Replay guarda até 500 quadros ou 8 M caracteres (`S\host\sse-replay.js:1-3`). Cursor de outro `STREAM_ID` ou fora do buffer volta `resumed:false`: refaça o snapshot.
- Cliente com mais de 4 MB pendentes é desconectado (`S\sse-fanout.js:1-12`).

**Tipos de quadro** (união `ServerFrame` em `GH shared/wire.ts`):

| Grupo | Quadros |
|---|---|
| Estado | `bot` (WireBot inteiro, com tasks), `bot.deleted`, `group`, `group.deleted`, `sections`, `bot.queued`, `computer`, `computer-control`, `config` |
| Conversa | `message`, `message.patch` (`{threadId, message}`), `thread` (`{threadId, activeLeafId}`) |
| Motor | `runtime` (`{event: RuntimeEvent}`) |
| Outros | `notify`, `routine`, `routine.run`, `routine.deleted`, `webhook*`, `app-trigger*`, `screen`, `data`, `live.call` (só admin) |

**RuntimeEvent** (validação em `S\thread-events.js:122-199`; tipos em `GH shared/runtime-events.ts`). Campos-base: `eventId`, `provider`, `providerInstanceId`, `threadId`, `createdAt`, `turnId`, `itemId`, `requestId`.

| Tipo | Campos úteis | Uso no Arcadia |
|---|---|---|
| `session.started` | `sessionId`, `model` | liga a sessão do Claude à thread (deduplicar com o JSONL) |
| `session.exited` | | personagem sai |
| `turn.started`, `turn.retrying` | | começa a trabalhar |
| `turn.completed` | `ok`, `stopReason`, `cost`, `usage{input, output, cachedInput}`, `denials` | entregou ou falhou; tokens e custo do turno |
| `turn.wait_started`, `turn.wait_ended` | | espera pelo computador do bot (fila) |
| `cap.exhausted` | | limite de uso: "apagão" |
| `item.started` | `itemType` (tool ou reasoning), `title` (nome da ferramenta), `summary`, `input` | ferramenta X ou pensando |
| `item.updated`, `item.completed` | `ok`, `output` ou `text` | fim da ferramenta, sucesso ou erro |
| `content.delta` | agrupado em janelas de 50 ms | ignorar (texto) |
| `request.opened` | `requestType` (permission ou question), `tool`, `summary`, `choices`, `questions` | **precisa de você** |
| `request.resolved` | `behavior`, `source` (user, auto, timeout, system, unavailable, peer) | fim da espera |
| `thread.token-usage.updated` | | medidor de contexto; **nunca somar** (o total está em `turn.completed.usage`) |
| `runtime.error`, `runtime.notice` | `setup`, `terminal`, `stalled`, `limitResetsAt` | erro, travamento, limite |

**Onde aparece cada coisa:**
- **Turno:** eventos `turn.*` e o quadro `bot`, que traz `tasks[].busy/activity/turnStartedAt`. No fim de cada turno o app grava uma mensagem `kind:"digest"` com ferramentas usadas, duração, `usage` e **arquivos alterados** (`S\index.js:5733-5780`, `S\digest.js:16-57`).
- **Ferramenta:** `item.*` e mensagens `kind:"activity"` com `tool{name, ok, itemId}`.
- **Aprovação:** `request.opened` gera mensagem `kind:"options"` com `card{title, subtitle, options, requestId, requestType, tool}`; a task vira `waiting-on-you` e sai um `notify` (`S\index.js:6803-6870`).
- **Delegação:** não tem quadro próprio. Sinais: `item.started` com title `mcp__agents__coordinate_bots`; task nova no colega com `openedBy{kind:"work", botId}`; `waitingForTeammates:true` em quem pediu; chip com `threadRef` quando o colega termina (`S\index.js:2879-2886, 4027-4036`). O próprio CLI relê o job a cada quadro `bot`, `group` ou `message` (`S\headless\events.js:120-121`).
- **Sala (group):** o quadro `group` traz `{working, busyBotId, turnStartedAt, queue, tasks[].working}` (`S\index.js:4216-4248`).
- **Erro:** `runtime.error`, `turn.completed ok:false`, chip com `tool.ok:false`, `notify` de falha.

**Consumidor pronto para se inspirar:** `openmausbot events` (CLI) já reconecta com backoff de até 10 s e filtra por kind (`S\headless\events.js:6-141`).

## 4. Snapshot e consultas (GET)

Toda rota fora da lista `CLIENT_ALLOW` exige escopo admin (`S\request-auth.js:219-319`).

| GET | Escopo | Traz |
|---|---|---|
| `/api/bots?messages=0` | client | `bots[]` (WireBot), `groups[]`, `sections[]`, `botQueuedMessages`, `computerControl` (`S\routes\threads.js:19-46`) |
| `/api/threads/{id}/job?scope=job` | client | árvore de delegação (`S\routes\jobs.js`, `S\job-view.js`) |
| `/api/team-map` | client | `collaborations` e arestas `queued`/`running` entre bots (`S\index.js:15639-15661`) |
| `/api/today?since=ms` | client | `tiles`, `needsYou`, `lines` (`S\today.js:201-212`) |
| `/api/routines?from&to` | client | rotinas e execuções |
| `/api/threads/{id}/messages?limit` | client | página de mensagens (evitar: é conteúdo) |
| `/api/health`, `/.well-known/openmausbot/environment` | público | identidade, versão, `pid` |
| `/api/usage?from&to&groupBy=bot\|model\|day\|engine` | admin | tokens, `costUsd` (`S\routes\usage.js`) |
| `/api/plan-usage` | admin | janelas de 5 h e semanal (**não** usar `?refresh=1`) |

**WireBot** (`S\index.js:2888-2898`, `S\store.js:1390-1440`):
- identidade: `id`, `threadId`, `mainThreadId`, `name`, `title` (cargo), `description`, `soul` (não mandar ao cliente);
- aparência: `color`, `mascotBody`, `mascotExpression`, `avatarUrl`, `avatarCrop`, `avatarZoom`, `avatarFocusX/Y`;
- modelo e lugar: `modelSelection{instanceId, model, effort, variant}`, `cwd`, `section` (equipe), `chiefOfStaff`, `approvalMode`;
- estado: `activity`, `busy`, `waitingForTeammates`;
- `tasks[]`: `threadId`, `title`, `activity`, `busy`, `turnStartedAt`, `modelSelection`, `cwd`, `pinnedCwd`, `openedBy`, `closedBy`, `archivedAt`, `routineRunId`, `waitingForTeammates`.

**Nó do job** (`S\job-view.js:92-116`): `id`, `rootId`, `parentId`, `depth`, `botId`, `botName`, `threadId`, `groupId`, `status` (queued, running, waiting, needs_input, resume, completed, failed, cancelled), `outcome`, `question`, `mode`, `reply`, `executions`, horários e `result` (até 280 caracteres). O job tem `state`, `reason` e `version`.

Cuidados:
- `/api/bots` **sem** `messages=0` devolve a transcrição inteira da thread principal de cada bot.
- `done_when` e `brief` da delegação **não** saem na API (ficam no `runtime.db` e no envelope do turno delegado).
- Checkpoints não têm rota; os arquivos alterados chegam pelo `digest`.
- `/api/instances` sonda os CLIs dos motores a cada chamada: não usar em laço.

## 5. Status e aparência dos bots

**`activity`** (`GH wire.ts`, `S\store.js:200, 1800-1805`): `idle`, `working`, `waiting-on-you`, `no-signal`, `dead` e `parked.computer` (só em task). Contam como busy: working, waiting-on-you e no-signal. O bot herda a prioridade das tasks: waiting-on-you, depois no-signal, working e dead.

| Situação | Como aparece |
|---|---|
| Trabalhando | `working` + `turnStartedAt`; numa sala, `group.working` e `busyBotId` |
| Esperando aprovação | `waiting-on-you` com card `options` sem resposta |
| NEEDS INPUT | nó `needs_input` com `question`; expira em 30 min |
| Falhou | `dead`; `turn.completed ok:false`; `runtime.error`; nó `failed` com outcome (provider_error, stalled, expired, refused, budget, denied, interrupted) |
| Travado | `no-signal`; job `stalled` |
| Interrompido | `stopReason:"interrupted"`; nó `cancelled` |
| Na fila | `bot.queued`; nó `queued` ou `resume`; aresta `team-map.queued`; `group.queue`; `turn.wait_started` |
| Esperando colegas | `waitingForTeammates` |

**Aparência** (o Arcadia deve herdar isso no personagem):
- `color`: green, blue, red, orange, purple, cyan, pink, yellow, teal, coral (`SH\wire.js:7-10`).
- `mascotBody`: cursor (padrão), blob, circle, squircle, capsule, drop, shield, hexagon, diamond, star, mais corpos sazonais (pumpkin, ghost, witch, bat, cat, skull, monster, mummy, vampire, spider) (`SH\mascot-bodies.js`, `SH\bot-body.js`).
- `mascotExpression`: texto curto; a UI oferece idle, happy, curious, drowsy, working, thinking, listening, sleeping, suspicious, proud.
- `avatarUrl`: `/api/attachments/<uuid>.png|jpg|gif|webp`.

## 6. Autenticação: só existem `admin` e `client`

- **Não existe escopo somente leitura** (`S\sessions.js:7`; confirmado em `GH docs/self-hosting.md`). O escopo `client` ("Somente chat e aprovações" na UI) também escreve: manda mensagem, interrompe, responde cartão, cria rotina.
- Pareamento: código de uso único, 5 min; `POST /api/auth/pair` troca por um token `omb_sess_...` de 30 dias renováveis, teto de 180 (`S\sessions.js:8-21`). Na UI 0.1.121: Configurações, **Acesso remoto**, "Parear um celular ou outro computador".
- CLI: `node "%LOCALAPPDATA%\Programs\openmausbot\resources\server\openmausbot.js" connect http://127.0.0.1:<porta> --code CODIGO --label Arcadia --out <arquivo>` grava o token só no arquivo.
- **Loopback no app desktop** (`S\request-auth.js:48-50, 346-365, 417-447`): requisição sem sessão vinda de 127.0.0.1, **sem** cabeçalho `Origin` externo, `Sec-Fetch-*` ou `X-Forwarded-*`, recebe confiança de dono. Escritas exigem um cabeçalho secreto do Electron; **GET funciona sem token**. Navegador sem sessão é recusado até em GET. Não há CORS.
- Para o SSE a partir do Node: `Authorization: Bearer`. Em navegador: `?ticket=` obtido em `POST /api/auth/stream-ticket` (o Arcadia não precisa disso, porque quem fala com o OMB é o servidor do Arcadia).

## 7. Descoberta da porta

1. Sondar `GET /.well-known/openmausbot/environment` em 8799, 18799 e 28799. É público e devolve `environmentId`, `version` e `capabilities` (`S\environment.js:86-104`).
2. Comparar `environmentId` com o arquivo `D\environment-id` (`S\environment.js:31`).
3. O arquivo de lease **não guarda a porta** e tem um token de posse: não ler.
4. App fechado = nenhuma das portas responde. O Arcadia mostra "OpenMausBot desligado" e segue com as outras fontes.

## 8. Processos do Claude Code lançados pelo app (importa para hooks e transcrições)

- **`--setting-sources project`**: só `<cwd>/.claude/settings.json` é carregado. Hooks do usuário (`~/.claude/settings.json`) **não rodam** nos bots. Hooks de projeto rodam (o guardião do Copiloto é um hook de projeto).
- Ambiente herdado do Electron (`A:30074-30090`): `OMB_DATA_DIR`, `OMB_DESKTOP_PARENT=1`, `OMB_DESKTOP_LAUNCH_ID`, `OMB_PORT`, `OMB_STATIC_DIR`, `OMB_RESOURCES_PATH`, `OMB_SKILLS_DIR`, `OMB_APP_VERSION`. Com os hooks do app ligados, o driver acrescenta `OMB_HOOK_URL`, `OMB_HOOK_TOKEN_FILE`, `OMB_HOOK_NODE`, `OMB_HOOK_HELPER`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (`S\drivers\claude.js:1084-1110`).
- `OMB_BOT_ID`, `OMB_THREAD_ID` e `OMB_TURN_DEPTH` vão **só** para o subprocesso MCP `agents`, não para o Claude (`S\index.js:1745-1780`).
- Um hook de projeto pode descobrir bot e thread: o nome do arquivo em `OMB_HOOK_TOKEN_FILE` é `sha256(botId + "\0" + threadId)` truncado em 24 hex (`S\drivers\claude.js:344-347`). **INFERÊNCIA:** basta calcular o hash para cada par (bot, task) vindo de `/api/bots`. O Arcadia não precisa disso se usar o SSE.
- **Transcrições:** o Claude dos bots grava no lugar padrão, `~/.claude/projects/<cwd codificado>/<session_id>.jsonl` (visto na listagem: há pastas `...openmausbot-task-workspaces-<bot>-<thread>`). Com cwd privado, o cwd é `D\task-workspaces\<botId>\<threadId>` e **não revela o projeto**: a sala desses bots vem do OMB (task `cwd`, `pinnedCwd` ou a equipe), não do caminho.
- No JSONL, as sessões dos bots aparecem com `entrypoint: "sdk-cli"`; as do VS Code com `claude-vscode`; as do app desktop com `claude-desktop`.
- O OMB também roda Codex: nos rollouts do Codex aparece `originator: "openmausbot"`.

## 9. Dados em disco: o que pode e o que não pode

| Item | Conteúdo (pelo código) | Arcadia |
|---|---|---|
| `bots.json`, `groups.json` | bots, tasks, salas; **sem** `busy`, `activity`, `turnStartedAt` (`S\store.js:772-786`) | não usar para estado; preferir a API |
| `section-contexts.json` | brief por equipe | não precisa |
| `decisions/AAAA-MM.ndjson` | decisões de aprovação, mascaradas | opcional, histórico |
| `usage/AAAA-MM.jsonl` | `{at, botId, botName, threadId, model, driverKind, input, output, cachedInput, costUsd, trigger}` | opcional, histórico de custo |
| `events/<thread>.ndjson` | RuntimeEvent mascarado | fallback de histórico, formato interno |
| `native/<thread>.ndjson` | stream bruto do motor | **não** usar (muda por motor) |
| `runtime.db`, `messages.db` | SQLite em WAL, em uso | **nunca abrir** |
| `hook-tokens/`, `sessions.json*`, `config.json`, lease, `browser-engine-key` | segredos | **nunca ler** |

## 10. Celular do próprio OpenMausBot (e por que o Arcadia é outra coisa)

- O app tem **Acesso remoto** opcional: um sidecar em `0.0.0.0:8810` (dispositivos, com token), pareamento em `127.0.0.1:8811`, Bonjour `_openmausbot._tcp`, Tailscale ou túnel HTTPS gerenciado (`C\index.js`, `S\tunnel.js`). Clientes: app iOS, app Android e a UI como PWA (exige HTTPS).
- Esse acesso é para **conversar, aprovar e controlar**, não é só leitura (`C\routes.js:57-175`).
- O "Telefone" no perfil do bot é outra coisa: SMS, chamadas e um MCP que controla Android por ADB.
- **Conclusão:** para comandar bots pelo celular, o Igor já tem o app do OpenMausBot. O Arcadia é o **aquário visual só leitura**, e não deve reimplementar controle.

## 11. Saída para sistemas externos

- **Não existe webhook de saída.** Os webhooks do app são receptores, em `127.0.0.1:8800`.
- O que dá para assinar: o SSE `/api/events`, o CLI `openmausbot events` (JSON lines), o long-poll de job e o servidor MCP stdio do app (`resources\server\mcp-server.js`, com list_bots, get_bot_messages e ferramentas de ação).

## 12. Recomendação de integração

1. **Quem fala com o OMB é o servidor do Arcadia**, nunca o navegador.
2. **Snapshot:** `GET /api/bots?messages=0`, `/api/team-map`, `/api/today`, `/api/routines`; se tiver escopo, `/api/usage?groupBy=bot`.
3. **Tempo real:** `GET /api/events?screens=off`, guardando o último `id`. Reconexão com `Last-Event-ID`; `resumed:false` = refazer snapshot. Tratar `bot`, `group`, `sections`, `runtime`, `message`/`message.patch` (só `kind` activity, digest, options e chips de delegação), `bot.queued`, `notify`, `routine*`.
4. **Delegação:** ao ver `coordinate_bots`, task com `openedBy.kind = work` ou `waitingForTeammates`, chamar `/api/threads/{raiz}/job` e `/api/team-map` com debounce de 300 ms. **Não** deixar o long-poll `?wait` sempre aberto (bloqueia backup do app; o SSE não bloqueia).
5. **Autenticação com o menor privilégio:**
   - Opção A (mesma máquina, sem token): só GET, de 127.0.0.1, sem `Origin`, `Sec-Fetch-*` ou `X-Forwarded-*`, com **lista fixa de rotas permitidas** no código do Arcadia.
   - Opção B (se a A for fechada numa versão futura, ou se o Arcadia sair do PC): sessão `client` pareada ("Somente chat e aprovações"), revogável em "Dispositivos pareados". **Nunca** "Acesso completo". O token fica num arquivo com ACL restrita, fora do repositório.
6. **Não fazer:** POST de qualquer tipo; abrir os SQLite; ler segredos; tirar status de `bots.json`; tail de `native/`; gravar ou logar `item.started.input` e texto de mensagens (o quadro ao vivo não passa pelo mascaramento: `S\index.js:6575-6576`); usar `/api/bots` sem `messages=0`; SSE sem `screens=off`.
7. **Atualizações do app:** a API não tem versão nem contrato publicado. Mitigar com: checagem de `version` no início; `kind` desconhecido = ignorar e pedir snapshot; teste de contrato contra `shared/wire.ts` e `shared/runtime-events.ts` da tag instalada; o adaptador do OMB isolado atrás da interface de evento canônico.
