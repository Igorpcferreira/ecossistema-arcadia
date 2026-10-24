# Próxima sessão

Único roteiro vigente. Atualizado em 24/10/2026, na publicação da Fase 3.

**Situação em 24/10/2026.** As Fases 1 e 2 foram publicadas em `main` (`5fdc06a`), com o ok do Igor. A Fase 3 passou no G3, com ressalvas que ficam para a Fase 4, e foi publicada em `main` no mesmo dia, também com o ok dele.
- **Fase 1:** G1 feito em 23/10/2026. O Igor aceitou todas as recomendações, que agora são o padrão do mundo; as outras opções seguem em `/prototipos` (`npm run dev:mundo`).
- **Fase 2:** marcos 1 a 5 feitos, com 240 testes, duas revisões de privacidade corrigidas e as regras de sala conferidas nos dados reais. Para o G2, falta ver com caso real a delegação e a ferramenta de bot do OpenMausBot.
- **Fase 3:** o mundo lê o snapshot e o SSE do servidor (ADR 0004), e o servidor entrega o build. A revisão independente do G3 (24/10/2026) achou três falhas que barram o portão (academia, sala nova numa ala cheia e o corte com cápsula) e outros ajustes; o resumo está em `docs/estado-atual.md`. As correções ficaram prontas em 24/10/2026, com um campo `tema` por ala na config, e o servidor real já roda com elas. A segunda rodada da revisão, no mesmo dia, aprovou o G3 com ressalvas; o resumo está em `docs/estado-atual.md`. O Igor já vê o mundo no PC em `http://127.0.0.1:4780/`, servido pelo servidor.

Próximos passos:
1. Fechar o G2 quando aparecer um caso real de delegação do OpenMausBot (o servidor sobe com `npm run servidor -- --config <config real>`).
2. Fase 4 (celular e rede, seção 6 do prompt), quando o Igor der o ok, com as ressalvas do G3: no aparelho real, fps, carga, remontagem do andar, aba em segundo plano, toque nos cartões e a recarga das 03:00; placas das cápsulas maiores ou mais claras no celular; balão sem cobrir o letreiro no corte; selo certo para a aba escondida que soltou a conexão; remontagem mais barata e medida de fps que atravesse a remontagem; testar o adeus por muitas conexões e o 403 de outro aparelho.
3. Achar e dar folga aos testes sensíveis a tempo: em 23/10/2026, logo depois de religar o PC, 3 de 240 falharam uma vez e passaram nas 5 rodadas seguintes; em 24/10/2026, a varredura de 2 s de `apps/server/src/adaptadores/integracao.test.ts` falhou uma vez, logo depois das capturas com o Playwright, e passou nas 3 rodadas seguintes.

As decisões abertas de salas e de config ficam em `docs/local/salas-reais.md`.

## Onde estamos

A Fase 0 está feita e publicada (`16c152a`). O Igor respondeu às perguntas do portão G0 em 22/10/2026: celular-alvo Moto G14 com Android 14, mapa de alas confirmado, modo autônomo liberado, Wi-Fi de casa como Privada (ele roda os comandos de `scripts/rede-local.ps1` como administrador na hora de ver no celular). As Fases 1 e 2 começaram em paralelo, com subagentes, no mesmo dia. O resultado completo está em `docs/estado-atual.md`; a escolha do motor, em `docs/decisoes/0001-stack.md`.

## Antes de começar

1. Leia `AGENTS.md`, `docs/prompt-arcadia.md`, `docs/estado-atual.md` e `docs/decisoes/0001-stack.md`.
2. Se existirem (fora do Git), leia `docs/local/contexto-local.md` (a seção 9 tem as respostas do G0), `docs/local/verificacao-maquina.md`, `docs/local/verificacao-omb.md` e `docs/local/arcadia.config.rascunho.yaml` (mapa de alas confirmado).
3. Veja em `docs/estado-atual.md` até onde as Fases 1 e 2 chegaram.

## Fase 1 e Fase 2, em paralelo

O esqueleto é um monorepo com npm workspaces: `apps/world` (Vite e PixiJS), `apps/server` (Node, Hono e `node:sqlite`) e `packages/shared` (esquema e saneamento). Cada fase mexe só na sua pasta; dependência nova só com conferência de data no npm (nada com menos de duas semanas).

### Fase 1: lapidar a direção em pixel art no motor escolhido (`apps/world`)

1. Levar o motor da prova (`docs/local/prova-motor/src/renderizador-pixi.js`) para `apps/world/src`, genérico: sem nomes de projeto, de bot, do Igor ou da pessoa fixa. A cena de exemplo do repositório usa alas e personagens genéricos; os pessoais entram por um pacote local (em desenvolvimento, `docs/local/personagens/`).
2. Corrigir o que a prova ensinou: atlas também para os quadros de animação, pré-assar na carga, ticker interno do PixiJS parado, detecção de WebGL por software com saída para o renderizador Canvas.
3. Página `/prototipos` com as cinco variações (escala 16 por 32 contra 24 por 40; procedural contra passe à mão; isométrico contra corte lateral no celular; noite fria contra quente; densidade), medidor de fps, presets `baixo`, `medio` e `alto` e uma frase por opção. A prancha e a prova continuam acessíveis.
   - **Decidido pelo Igor em 22/10/2026:** agentes fixos parados (bots do OpenMausBot) ficam em stand-by na própria ala, numa cápsula de recarga (olhos apagados, luz de carga lenta), e acordam quando recebem trabalho; a academia e o lounge ficam só para pausas curtas entre tarefas. É comportamento base, não opção de protótipo.
   - Ideia do Igor (22/10/2026), já no comportamento base: ala sem atividade fica em stand-by (meia-luz, letreiro apagado, telas desligadas, sem pulso nas linhas de dados) e acorda em sequência quando ele começa a trabalhar num projeto dela; o androide chega pelo teletransporte e a câmera do aquário vai até lá. O servidor já entrega o dado (`sala.dormindo` depois de 20 min sem atividade e `sala.ultimaAtividade`).
4. Capturas em 1440 e 390 px de cada variação, lidas, numa página local fora do Git. Medição com o perfil do Moto G14 (412 por 915, DPR 2,625, CPU 4x e 6x).
5. Servir só no PC até o Igor rodar os comandos de rede. No G1, servir `/prototipos` na porta 4780 com host `0.0.0.0` (a regra do firewall cobre só essa porta), só enquanto ele olha no celular.
6. **Portão G1:** o Igor escolhe vendo.

### Fase 2: núcleo de dados (`packages/shared` e `apps/server`)

1. `packages/shared`: esquema do `ArcadiaEvent` com zod, saneamento por allowlist e regex de segredos, com testes.
2. Adaptadores: simulador determinístico; transcrições do Claude Code com catch-up de 24 h; sessões vivas do Claude (`~/.claude/sessions/*.json`, só `status`, `statusUpdatedAt`, `sessionId`, `cwd`, `entrypoint`; nunca abrir `.key`, nunca guardar `peerToken`); OpenMausBot (snapshot e SSE, lista fixa de rotas, `mascotBody` ausente vale `cursor`); rollouts do Codex.
3. Motor do mundo, SQLite com `node:sqlite`, snapshot e SSE próprios, `doctor`.
4. Testes: unitários, fixtures sintéticas, contrato contra `shared/wire.ts` e `shared/runtime-events.ts` da tag instalada do OpenMausBot, replay determinístico e o teste de vazamento. Gravar uma sessão de SSE com bots trabalhando só para extrair estrutura.
5. **Portão G2** (seção 6 do prompt).

## Decisões que esperam o Igor

1. Rede: decidida (Privada). Falta só o Igor rodar os comandos como administrador quando for ver no celular; avisar na hora do G1.
2. No G1: as escolhas visuais.
3. No fim de cada fase: commit e push daquele escopo.

## Cuidados que a Fase 0 deixou

- Toda página precisa de `<meta name="viewport">`: a prancha não tem e, aberta como arquivo no celular, vira o layout de PC reduzido.
- Posição sempre inteira: a prancha borra alguns pontos por coordenada fracionária (`pxl` sem arredondar); a prova em PixiJS não.
- Medição de fps no Playwright é aproximação: a CPU é limitada pelo CDP, a GPU do celular não é emulada. O número que vale é o do aparelho real no G4.
- Para medir, conte o quadro desenhado pelo contador do próprio laço, nunca pela duração: na Fase 0, um critério de "mais de 0,5 ms" perdeu quadros baratos do PixiJS e inventou travadas.
- Lições da prova para o motor de verdade: pré-assar os quadros de animação na carga (a prova assa na primeira vez que o quadro aparece); juntar as texturas pequenas em atlas (a prova chegou a 600 texturas soltas); parar o ticker interno do PixiJS, que pede um quadro a mais mesmo com os eventos desligados (o laço é nosso); detectar WebGL por software e cair no renderizador Canvas do PixiJS.
