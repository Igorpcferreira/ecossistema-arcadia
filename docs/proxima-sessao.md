# Próxima sessão

Único roteiro vigente. Atualizado em 22/10/2026, no fim da Fase 0.

## Onde estamos

A Fase 0 (preparação e verificação, sem código de produto) está feita. O commit e o push da Fase 0 foram autorizados pelo Igor em 22/10/2026. O portão G0 espera só as respostas às perguntas da Fase 0. O resultado completo está em `docs/estado-atual.md`; a escolha do motor, em `docs/decisoes/0001-stack.md`.

## Antes de começar

1. Leia `AGENTS.md`, `docs/prompt-arcadia.md`, `docs/estado-atual.md` e `docs/decisoes/0001-stack.md`.
2. Se existirem (fora do Git), leia `docs/local/contexto-local.md`, `docs/local/verificacao-maquina.md`, `docs/local/verificacao-omb.md` e `docs/local/arcadia.config.rascunho.yaml`.
3. Confira se as respostas do Igor já estão registradas em `docs/estado-atual.md`. Sem elas, a Fase 1 começa só no PC e a rede local espera.

## Fase 1 e Fase 2, em paralelo

### Fase 1: lapidar a direção em pixel art no motor escolhido

1. Esqueleto com npm workspaces (`apps/world`, `apps/server`, `packages/shared`), nas versões do ADR. Antes de instalar, confira de novo as datas no npm: nada publicado há menos de duas semanas.
2. Levar o motor da prova (`docs/local/prova-motor/src/renderizador-pixi.js`) para `apps/world/src/motor` e `apps/world/src/arte`, genérico: sem nomes de projeto, de bot, do Igor ou da pessoa fixa. A cena de exemplo do repositório usa alas e personagens genéricos; os pessoais entram pelo pacote local.
3. Página `/prototipos` com as cinco variações da Fase 1 (escala 16 por 32 contra 24 por 40; procedural contra passe à mão; isométrico contra corte lateral no celular; noite fria contra quente; densidade), medidor de fps, presets `baixo`, `medio` e `alto` e uma frase por opção. A prancha e a prova continuam acessíveis.
4. Capturas em 1440 e 390 px de cada variação, lidas, numa página local fora do Git.
5. Servir só no PC. Celular só depois da rede Privada e da regra de firewall, com o ok do Igor.
6. **Portão G1:** o Igor escolhe vendo.

### Fase 2: núcleo de dados

1. `packages/shared`: esquema do `ArcadiaEvent` com zod, saneamento por allowlist e regex de segredos, com testes.
2. Adaptadores: simulador determinístico; transcrições do Claude Code com catch-up de 24 h; sessões vivas do Claude (`~/.claude/sessions/*.json`, só `status`, `statusUpdatedAt`, `sessionId`, `cwd`, `entrypoint`; nunca abrir `.key`, nunca guardar `peerToken`); OpenMausBot (snapshot e SSE, lista fixa de rotas, `mascotBody` ausente vale `cursor`); rollouts do Codex.
3. Motor do mundo, SQLite com `node:sqlite`, snapshot e SSE próprios, `doctor`.
4. Testes: unitários, fixtures sintéticas, contrato contra `shared/wire.ts` e `shared/runtime-events.ts` da tag instalada do OpenMausBot, replay determinístico e o teste de vazamento. Gravar uma sessão de SSE com bots trabalhando só para extrair estrutura.
5. **Portão G2** (seção 6 do prompt).

## Decisões que esperam o Igor

1. Modelo do celular e versão do Android (define o alvo do build e o preset).
2. Rede: a Wi-Fi do PC está como **Pública**; mudar para Privada e criar a regra da porta 4780 é decisão e execução dele.
3. Mapa de alas: confirmar o rascunho local (três ajustes propostos: a raiz da pasta agregadora vira Cockpit; rascunhos do Codex Desktop e `C:\` vão para Bastidores; a equipe que está hoje no OpenMausBot vai para o Trabalho).
4. Modo autônomo nas Fases 1 e 2 (subagentes ou workflow em paralelo, parando só nos portões dele).

## Cuidados que a Fase 0 deixou

- Toda página precisa de `<meta name="viewport">`: a prancha não tem e, aberta como arquivo no celular, vira o layout de PC reduzido.
- Posição sempre inteira: a prancha borra alguns pontos por coordenada fracionária (`pxl` sem arredondar); a prova em PixiJS não.
- Medição de fps no Playwright é aproximação: a CPU é limitada pelo CDP, a GPU do celular não é emulada. O número que vale é o do aparelho real no G4.
- Para medir, conte o quadro desenhado pelo contador do próprio laço, nunca pela duração: na Fase 0, um critério de "mais de 0,5 ms" perdeu quadros baratos do PixiJS e inventou travadas.
- Lições da prova para o motor de verdade: pré-assar os quadros de animação na carga (a prova assa na primeira vez que o quadro aparece); juntar as texturas pequenas em atlas (a prova chegou a 600 texturas soltas); parar o ticker interno do PixiJS, que pede um quadro a mais mesmo com os eventos desligados (o laço é nosso); detectar WebGL por software e cair no renderizador Canvas do PixiJS.
