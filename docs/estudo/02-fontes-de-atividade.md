# De onde tirar a atividade dos agentes (Claude Code, Codex, MCP)

Pesquisa de 22/10/2026 com Claude Code 2.1.296, Codex CLI 0.163.0 e Node 24.5.0 no PC do Igor. No disco só foram olhados nomes de pastas, arquivos e campos; nenhum conteúdo de conversa. Documentação oficial: [hooks](https://code.claude.com/docs/en/hooks), [settings](https://code.claude.com/docs/en/settings), [monitoring](https://code.claude.com/docs/en/monitoring-usage), [headless](https://code.claude.com/docs/en/headless), [Codex hooks](https://developers.openai.com/codex/hooks), [Codex config](https://developers.openai.com/codex/config-advanced), [Codex app-server](https://developers.openai.com/codex/app-server).

## Resumo

- **OpenMausBot:** a melhor fonte para os bots é o SSE dele (ver `01-openmausbot.md`). Os bots rodam o Claude com `--setting-sources project`, então **hooks do usuário não disparam neles**.
- **Claude Code fora do OMB** (VS Code, terminal, app desktop): hooks são a melhor fonte ao vivo e existe hook HTTP nativo; o JSONL das transcrições é a fonte "zero instalação" e a base do histórico.
- **Codex:** tem hooks (precisam ser aprovados em `/hooks`); os rollouts JSONL dão o histórico; o `notify` é legado e só cobre o fim do turno.
- **OpenTelemetry:** bom para custo, tokens e erros; **não** serve para estado ao vivo (lotes de 5 s nos logs, 60 s nas métricas).
- **MCP:** não observa nada. Um MCP "arcadia" só serve para o agente anunciar rótulos, com confiabilidade baixa.

## 1. Fonte, estados, latência, custo, confiabilidade

| Fonte | Estados que dá | Latência | Configuração | Confiabilidade |
|---|---|---|---|---|
| SSE do OpenMausBot | tudo dos bots, inclusive delegação e "precisa de você" | tempo real | nenhuma (só ler) | alta; API sem versão |
| Hooks do Claude Code | sessão, pensando, ferramenta X, permissão na hora, ocioso, subagente, erro, compactação | ms (http) ou 0,1 a 0,3 s (command async)* | baixa, com ok do Igor | alta onde o hook carrega |
| JSONL do Claude Code | quase tudo por inferência; permissão só por heurística; tokens | 0,5 a 2 s* | nenhuma | alta para histórico; formato interno |
| stream-json / Agent SDK | tudo, inclusive `running/idle/requires_action` | tempo real | só para sessões que você mesmo lança | a mais alta |
| OTel do Claude Code | turno, decisão e resultado de ferramenta (depois do fato), custo, erro de API | 5 s (logs), 60 s (métricas) | baixa + coletor | média |
| Statusline | modelo, custo, % de contexto, limites | 300 ms após cada mensagem | baixa, só terminal | baixa como estado |
| Hooks do Codex | sessão, pensando, ferramenta, permissão, ocioso, subagente, interrupção | 0,1 a 0,3 s* | média (aprovar em `/hooks`) | alta onde roda |
| `notify` do Codex | fim de turno | fim do turno | baixa | média-baixa |
| Rollouts do Codex | pensando, ferramenta, ocioso, subagente, erro, tokens | ~1 s* | nenhuma | alta para histórico; formato interno |
| MCP "arcadia" | o que o agente anunciar | quando o modelo lembra | média | baixa |

\* estimativa, não documentada.

## 2. Claude Code

### 2.1 Hooks

- **Eventos (33 na 2.1.296):** SessionStart, Setup, InstructionsLoaded, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd.
- **Campos comuns:** `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`; dentro de subagente, também `agent_id` e `agent_type`.
- **Campos por evento que interessam:**
  - SessionStart: `source` (startup, resume, clear, compact, fork).
  - PreToolUse: `tool_name`, `tool_input`, `tool_use_id`. PostToolUse: o mesmo mais `tool_response` e `duration_ms`. PostToolUseFailure: `error`, `is_interrupt`.
  - PermissionRequest: `tool_name`, `tool_input`.
  - Notification: `notification_type` (`permission_prompt` chega após ~6 s; `idle_prompt` após ~60 s).
  - SubagentStop: `agent_transcript_path`. Stop: `background_tasks`. StopFailure: `error` (rate_limit, overloaded, billing_error).
  - PreCompact e PostCompact: `trigger`. SessionEnd: `reason`.
- **Tipos de handler:** `command` (com `args` para executar sem shell, `async`, `onFailure`), `http` (POST do JSON para `url`), `mcp_tool`, `prompt`, `agent`.
- **Assíncrono:** só `command` aceita `"async": true`. O Claude não espera o script. Se o script imprimir JSON com `additionalContext` ou `systemMessage`, isso entra no turno seguinte: **o hook do Arcadia nunca imprime nada**.
- **Falhas:** exit 2 bloqueia a ação. Qualquer outro erro (exit diferente de 0 e 2, HTTP fora de 2xx, conexão recusada, timeout) é não bloqueante, mas o hook HTTP gera aviso e uma linha `hook_non_blocking_error` na transcrição quando o coletor está desligado. Por isso o recomendado é **command assíncrono**, não http.
- **Onde configurar:** `~/.claude/settings.json` (usuário), `.claude/settings.json` (projeto), `.claude/settings.local.json`, política gerenciada, plugin. Os níveis se somam e recarregam sozinhos.
- **`--setting-sources project` (bots do OpenMausBot):** carrega só o settings do projeto (e a política gerenciada). Para cobrir os bots com hooks, as alternativas seriam: o OMB repassar o stream (o SSE já faz isso, então **não precisa**); `--settings` extra (depende do OMB); política gerenciada (exige cuidado: JSON inválido impede o Claude de abrir); ou settings em cada pasta. **Conclusão:** para bots, use o SSE do OMB; hooks ficam para as sessões fora do OMB.
- **Projeto do Copiloto:** o `.claude/settings.json` de `ecossistema-copiloto` tem o guardião da equipe e **só o Igor altera**. O Arcadia nunca mexe em settings de projeto.

### 2.2 Transcrições JSONL

- **Caminho:** `~/.claude/projects/<cwd codificado>/<session_id>.jsonl`. O nome da pasta troca tudo que não é letra ou número por `-` (acima de 200 caracteres, trunca e põe hash). No PC do Igor o mesmo projeto aparece como `C--Users-...` e `c--Users-...`: **use o campo `cwd` da linha, não o nome da pasta**, e normalize sem diferenciar maiúsculas no Windows. Retenção padrão: 30 dias.
- **Subagentes:** `<session_id>/subagents/agent-<agentId>.jsonl` e `.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`).
- **Sessões vivas:** `~/.claude/sessions/` tem um arquivo por sessão rodando.
- **Tipos de linha:** `user`, `assistant`, `system` (`stop_hook_summary`, `api_error`, `compact_boundary`), `attachment`, `queue-operation`, `mode`, `ai-title`, `last-prompt`, `cost-state`, `file-history-*`, `api-request*`. Não existem linhas `tool_use` ou `tool_result`: são **blocos dentro de `message.content`**, junto com `thinking` e `text`.
- **Campos:** `uuid`, `parentUuid`, `isSidechain`, `agentId`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `entrypoint` (`sdk-cli` nos bots do OMB, `claude-vscode`, `claude-desktop`), `promptId`; nas linhas assistant, `message.id`, `message.stop_reason`, `message.usage`, `requestId`; no bloco `tool_result`, `tool_use_id` e `is_error`.
- **Tokens:** uma resposta da API vira várias linhas. Some por par `(message.id, requestId)`, nunca por linha.
- **Estados por inferência:**
  - pensando: a última coisa é prompt ou tool_result e o arquivo continua mudando;
  - ferramenta X: `tool_use` sem `tool_result` com o mesmo id;
  - esperando permissão ou entrada: **não fica gravado**; só heurística (ferramenta sem resultado por mais de 7 s sem atividade) ou um `AskUserQuestion` pendente;
  - ocioso: `stop_reason: "end_turn"` sem nada pendente;
  - subagente: `tool_use` Agent pendente e arquivo crescendo em `subagents/`;
  - erro: `system/api_error`, `isApiErrorMessage` ou `is_error`.

### 2.3 OpenTelemetry

- Variáveis: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL` (use `http/json`), `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://127.0.0.1:4318`), `OTEL_LOGS_EXPORT_INTERVAL` (5000 ms), `OTEL_METRIC_EXPORT_INTERVAL` (60000 ms).
- Eventos: `claude_code.user_prompt`, `tool_result` (`tool_name`, `success`, `duration_ms`), `api_request` (`cost_usd`, tokens), `api_error`, `tool_decision`.
- Atributos incluem `user.email` e `organization.id`: **nunca saem do PC**. As variáveis `OTEL_LOG_*` de conteúdo ficam desligadas.
- Variáveis de projeto não ligam a telemetria; precisa ser variável de ambiente do usuário. Fica para uma fase opcional (custo e tokens), não para o tempo real.

### 2.4 stream-json e statusline

- `claude -p --output-format stream-json --verbose` com `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` dá `system/session_state_changed` (`running`, `idle`, `requires_action`) e eventos de tarefas de subagente. Só serve para sessões que o próprio processo lança (é o que o OMB faz por dentro).
- Statusline: `cost.total_cost_usd`, `context_window.used_percentage`, `rate_limits`. É do terminal; serve de medidor, não de estado.

## 3. Codex CLI

- **Hooks (0.163):** SessionStart, SubagentStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStop, Stop, Interrupt, SessionEnd. Entrada com `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`, `agent_id`. Só handlers `command` e `mcp_tool` (sem HTTP); `async: true`; `commandWindows` no Windows. Configuração em `~/.codex/hooks.json` ou `[hooks]` no `config.toml`. **Hook não gerenciado só roda depois de aprovado em `/hooks`**, e a aprovação vale para o hash atual: mudou o hook, aprova de novo.
- **`notify`:** `notify = [...]` no topo de `~/.codex/config.toml`; só emite `agent-turn-complete` com `thread-id`, `turn-id`, `cwd`, `client`. É legado e, no Windows, texto longo pode estourar o limite da linha de comando.
- **Rollouts:** `~/.codex/sessions/AAAA/MM/DD/rollout-<data>T<hora>-<id>.jsonl`, cada linha `{timestamp, ordinal, type, payload, metadata}`:
  - `session_meta`: `id`, `session_id`, `cwd`, `originator` (`codex_vscode`, `Codex Desktop`, `openmausbot`), `source`, `cli_version`, `git`, `parent_thread_id`;
  - `turn_context`: `turn_id`, `cwd`, `model`, `approval_policy`;
  - `response_item`: `message`, `reasoning`, `function_call`, `custom_tool_call` e saídas `*_output`;
  - `event_msg`: `task_started`, `task_complete` (com `error`), `turn_aborted`, `token_count`, `item_completed` (CommandExecution, FileChange, McpToolCall, SubAgentActivity);
  - subagentes têm arquivo próprio, com `parent_thread_id`.
- **Estados:** pensando (`task_started` até o fim, com `reasoning`); ferramenta (`function_call` sem `*_output`); esperando (hook PermissionRequest ou `request_user_input` pendente); ocioso (`task_complete`, `turn_aborted`); subagente (`spawn_agent`, rollout filho); erro (`task_complete.error`, `exit_code` diferente de 0).
- **app-server e `exec --json`:** eventos ricos, mas só para threads que o próprio cliente abriu. Não servem para observar o VS Code.

## 4. MCP

Um servidor MCP só vê as chamadas que o modelo decide fazer a ele. Não recebe prompts, outras ferramentas nem mudanças de estado: **não é barramento de eventos**. Papel possível de um MCP "arcadia" (opcional, último da fila): `arcadia.anunciar(tarefa, sala, progresso)`, `arcadia.quem_esta_aqui(repo)`, `arcadia.recado(texto)`. Depende de instrução no AGENTS.md, some após compactação e gasta tokens; no OMB só existe se estiver no `--mcp-config` dos bots. Trate como rótulo com validade, nunca como estado.

## 5. Hook "dispare e esqueça" (referência, não instalado)

Regras: `command` com `node` e `args` (sem abrir shell), `"async": true`, script que **sempre sai com 0**, **nunca imprime nada**, POST com timeout de 400 ms, trava de 1,5 s e **spool em disco** quando o coletor está desligado. `SessionEnd` síncrono e curto (`"timeout": 2`). Allowlist de campos: nada de prompt, saída, conteúdo de arquivo ou comando.

```js
// %USERPROFILE%\.arcadia\arcadia-hook.js (Node 18+, sem dependências)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +(process.env.ARCADIA_PORT || 47800), SRC = process.argv[2] || 'claude';
const fim = () => process.exit(0);           // sempre 0; nunca escreve no stdout
setTimeout(fim, 1500);                       // trava de segurança
let bruto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { if (bruto.length < 1e6) bruto += c; });
process.stdin.on('end', () => {
  let e = {}; try { e = JSON.parse(bruto); } catch {}
  const ti = e.tool_input || {}, ev = e.hook_event_name;
  const corpo = JSON.stringify({             // allowlist: sem prompt, saída ou conteúdo
    v: 1, src: SRC, ts: Date.now(), event: ev, session_id: e.session_id,
    prompt_id: e.prompt_id, turn_id: e.turn_id, agent_id: e.agent_id, agent_type: e.agent_type,
    cwd: e.cwd, mode: e.permission_mode, model: e.model, tool: e.tool_name, tool_use_id: e.tool_use_id,
    file: typeof ti.file_path === 'string' ? path.basename(ti.file_path) : undefined,
    notification: e.notification_type, source: e.source, reason: e.reason,
    error_type: ev === 'StopFailure' ? e.error : undefined,
    failed: ev === 'PostToolUseFailure' || undefined,
  });
  const spool = () => { try {
    const dir = path.join(process.env.LOCALAPPDATA || '.', 'Arcadia', 'spool');
    fs.mkdirSync(dir, { recursive: true });
    const id = String(e.session_id || 'sem-sessao').replace(/[^\w-]/g, '_');
    fs.appendFileSync(path.join(dir, id + '.ndjson'), corpo + '\n');
  } catch {} fim(); };
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/ingest', method: 'POST', timeout: 400,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corpo) } },
    (res) => { res.resume(); res.on('end', fim); });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', spool);
  req.end(corpo);
});
```

Trecho de configuração (vai em `~/.claude/settings.json`, **mesclado** com o que já existe, com backup e só com o ok do Igor; repetir o bloco para SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart, SubagentStop, Stop, StopFailure, PreCompact e PostCompact):

```json
{ "hooks": {
  "PreToolUse": [ { "hooks": [ { "type": "command", "command": "node",
    "args": ["C:/Users/user/.arcadia/arcadia-hook.js", "claude"], "async": true } ] } ],
  "SessionEnd": [ { "hooks": [ { "type": "command", "command": "node",
    "args": ["C:/Users/user/.arcadia/arcadia-hook.js", "claude"], "timeout": 2 } ] } ]
} }
```

Para medir o custo do hook: `claude --debug-file <arquivo>` registra `Hooks: ... (31ms)` por hook. Para desligar tudo de uma vez: `"disableAllHooks": true`.

## 6. Pipeline à prova de falhas

1. **Coletor separado do 3D.** O servidor do Arcadia coleta, normaliza, guarda e publica o estado; o 3D e o celular só consomem. Desligar o 3D não perde nada.
2. **Prioridade entre fontes:** SSE do OMB (bots) > hooks (sessões fora do OMB) > JSONL e rollouts (histórico, conferência e sessões sem hook) > OTel (custo) > MCP (rótulos). Cada fonte só muda os estados que conhece; vale o evento mais recente.
3. **Identidade:** `claude:<session_id>`; subagente `claude:<session_id>:<agent_id>`; `codex:<id>` agrupado por `session_id`; bot do OMB `omb:<botId>` (a sessão do Claude do bot se liga à thread pelo `session.started`).
4. **Chaves de deduplicação:**
   - JSONL do Claude: `(session_id, uuid)`; sem uuid, `(arquivo, offset)`;
   - tokens: `(message.id, requestId)`;
   - rollout do Codex: `(id, ordinal)`;
   - hooks: `(session_id, hook_event_name, tool_use_id)` ou `(session_id, prompt_id, hook_event_name)`;
   - OMB: `eventId` do RuntimeEvent e `seq` do quadro;
   - cruzar fontes por `tool_use_id` e `prompt_id`.
5. **Quando o Arcadia liga depois das sessões:** varrer `~/.claude/projects/` (com `subagents/`) e `~/.codex/sessions/` alterados nas últimas 24 h; ler a primeira linha e os últimos ~256 KB de cada um; conferir `~/.claude/sessions/`; processar o spool; pedir o snapshot do OMB. Depois, acompanhar com `fs.watch` mais varredura a cada 1 a 2 s, guardando o offset de cada arquivo e com buffer para linha incompleta.
6. **Coletor desligado:** hook assíncrono falha em milissegundos e vai para o spool; JSONL e rollouts continuam no disco (o Claude apaga após 30 dias); o SSE do OMB é retomado pelo snapshot.
7. **Privacidade (o que nunca vai para o navegador):** prompts, respostas e thinking; `tool_input`, `tool_response`, comandos, diffs e conteúdo de arquivo; `last_assistant_message`; linhas `api-request*`; `user.email`, `organization.id`; caminhos completos, `transcript_path` e remoto git; nomes de servidores MCP que revelem clientes. **Pode ir:** apelidos de sala e agente, estado, categoria da ferramenta (ler, editar, comando, web, navegador, delegar, integração), nome curto do arquivo quando o Igor permitir, durações, contagens, tokens e custo. Mascaramento: allowlist de campos, caminhos trocados por apelido, regex de segredos como segunda barreira (`sk-`, `ghp_`, `AKIA`, `eyJ`, `-----BEGIN`, `password=`, strings de conexão, e-mail, CPF e CNPJ) e teste automatizado que procura campos proibidos no fluxo que sai para os clientes.

## 7. Ainda falta validar (tarefa da Fase 0)

- Se os hooks do Codex rodam nas sessões do VS Code com a aprovação feita no CLI.
- O que o exportador OTel do Claude faz quando o coletor está desligado.
- Se `--settings` extra carrega hooks junto com `--setting-sources project` (só importa se um dia o OMB oferecer isso).
