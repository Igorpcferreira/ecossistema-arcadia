# Estado atual

Atualizado em 22/10/2026, no fim da Fase 0.

## Em uma frase

A Fase 0 (preparação e verificação, sem código de produto) está feita: continuidade criada, máquina verificada só lendo, OpenMausBot sondado, motor 2D escolhido com uma prova de fps. O commit e o push da Fase 0 foram autorizados pelo Igor em 22/10/2026; o portão G0 espera só as respostas às perguntas da Fase 0. Nenhum hook, configuração, firewall ou rede foi alterado.

## O que existe

| Caminho | O que é |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | regras curtas da missão (o `CLAUDE.md` só aponta para o `AGENTS.md`) |
| `docs/prompt-arcadia.md` | a missão completa |
| `docs/estudo/01` a `05` | o estudo de 22/10/2026 |
| `docs/proxima-sessao.md` | o único roteiro vigente |
| `docs/decisoes/0001-stack.md` | ADR da stack: PixiJS 8.22.0 no mundo, Node com Hono e `node:sqlite` no servidor |
| `docs/creditos.md` | terceiros e licenças |
| `config/arcadia.config.exemplo.yaml` | exemplo genérico de configuração |
| `tools/checar-escrita.mjs` | checagem das regras de escrita (`node tools/checar-escrita.mjs`) |
| `docs/conceitos/direcoes-de-arte.html` | prancha 3D da primeira rodada (histórico) |
| `docs/local/` (fora do Git) | contexto pessoal, prancha em pixel art, verificação detalhada, rascunho da configuração real e a prova do motor |

Nada de `apps/`, `packages/` ou `package.json` ainda: isso começa na Fase 1.

## Verificação da Fase 0 (só leitura)

| Item | Resultado |
|---|---|
| Versões | Node 24.5.0, npm 11.17.0, Git 2.55, Python 3.12.10, Claude Code 2.1.296 no CLI, Codex CLI 0.163.0, OpenMausBot 0.1.121, Chrome 155, Playwright 1.62.1 (Chromium 151) |
| Portas | 4780 e 47800 livres. OpenMausBot em 8799 (e webhooks em 8800); acesso remoto dele desligado |
| OpenMausBot | aberto. Descoberta pelo `/.well-known/openmausbot/environment` e `environment-id` conferido. `GET /api/bots?messages=0` responde sem token a partir do próprio PC (confiança de loopback). 5 bots, todos ociosos. SSE de 60 s com `screens=off`: só `hello` e `ping`, nada para validar de eventos |
| Transcrições do Claude | 37 pastas, 33 sessões e 25 subagentes no último mês; formato conferido só por nomes de campos |
| Rollouts do Codex | 40 rollouts no último mês; `originator` inclui `openmausbot` |
| Rede | a Wi-Fi do PC está como rede **Pública** e não há regra de firewall do Arcadia: o celular ainda não alcança o PC |
| Pastas do Arcadia fora do repositório | `%USERPROFILE%\.arcadia` e `%LOCALAPPDATA%\Arcadia` ainda não existem |

Detalhes que só servem nesta máquina (caminhos, rede, processos, contagens por pasta) ficam em `docs/local/verificacao-maquina.md` e `docs/local/verificacao-omb.md`.

## Prova do motor

A cena da prancha foi portada para PixiJS 8.22.0 sem mudar a simulação (prova em `docs/local/prova-motor/`, fora do Git porque a cena tem os personagens pessoais). As duas páginas rodaram no Chromium headless do Playwright com semente fixa, 6 s de aquecimento e 15 s de medida.

**Quadro inteiro** (simulação, câmera, desenho e balões): fps e ms de CPU por quadro, média (p95).

| Cenário | Modo | Canvas 2D (prancha) | PixiJS WebGL (prova) | PixiJS Canvas (plano B) |
|---|---|---|---|---|
| PC 1440, noite | software | 60 fps; 2,5 ms (p95 3,7); 2 rodadas | 60 fps; 0,7 ms (p95 1,2 a 1,3); 2 rodadas | 60 fps; 2,6 a 2,7 ms (p95 4,1 a 4,5); 2 rodadas |
| PC 1440, dia | software | 60 fps; 2,6 ms (p95 4) | 60 fps; 0,7 ms (p95 1,3) | 60 fps; 2 ms (p95 3,5) |
| Celular, noite, CPU 1x, teto 30 | software | 30 fps; 1,6 ms (p95 2,7) | 30 fps; 1,7 ms (p95 4,1) |  |
| Celular, noite, CPU 4x, teto 30 | software | 30 fps; 4,2 ms (p95 9,6) | 30 fps; 4,4 ms (p95 11) |  |
| Celular, dia, CPU 4x, teto 30 | software | 30 fps; 4,4 ms (p95 10,9) | 30 fps; 3,9 ms (p95 10) |  |
| Celular, noite, CPU 6x, teto 30 | software | 30 fps; 5,3 a 6,1 ms (p95 11,1 a 15,3); 2 rodadas | 30 fps; 5,9 a 6,2 ms (p95 14,2 a 15,1); 2 rodadas |  |
| Celular, noite, CPU 4x, sem teto | software | 60 fps; 3,3 ms (p95 7,8) | 59 fps; 3,1 ms (p95 6,9) |  |
| Celular, noite, CPU 6x, sem teto | software | 56 a 58 fps; 4,9 a 5,3 ms (p95 10,5 a 11,9); 2 rodadas | 54 a 56 fps; 4,7 a 4,9 ms (p95 10,8 a 13,4); 2 rodadas |  |
| PC 1440, noite | placa de vídeo | 175 fps; 1,5 ms (p95 3,3) | 180 fps; 1,3 ms (p95 2,7) | 175 fps; 2 ms (p95 4,1) |
| Celular, noite, CPU 4x, teto 30 | placa de vídeo | 30 fps; 4,9 ms (p95 12,7) | 30 fps; 5,1 ms (p95 13,8) |  |
| Celular, noite, CPU 6x, teto 30 | placa de vídeo | 29 a 30 fps; 6,4 a 9 ms (p95 15,8 a 25,1); 2 rodadas | 29 a 30 fps; 5,2 a 7,5 ms (p95 11,7 a 21); 2 rodadas |  |
| Celular, noite, CPU 4x, sem teto | placa de vídeo | 129 fps; 3,9 ms (p95 10,4) | 146 fps; 2,8 ms (p95 7,6) |  |
| Celular, noite, CPU 6x, sem teto | placa de vídeo | 97 a 100 fps; 5,1 a 5,2 ms (p95 12,1 a 12,3); 2 rodadas | 127 a 129 fps; 3,4 a 3,6 ms (p95 9,2 a 9,8); 2 rodadas |  |

**Só o desenho do quadro** (a função de desenho, sem simulação nem balões): ms, média (p95).

| Cenário | Modo | Canvas 2D (prancha) | PixiJS WebGL (prova) | PixiJS Canvas (plano B) |
|---|---|---|---|---|
| PC 1440, noite | software | 2,1 ms (p95 3,1) | 0,5 ms (p95 1) | 2,1 ms (p95 3,4) |
| Celular, noite, CPU 6x, teto 30 | software | 4 ms (p95 9,2) | 4,4 ms (p95 11,7), dos quais 2,4 no render do PixiJS |  |
| Celular, noite, CPU 6x, sem teto | software | 3,5 ms (p95 7,5) | 3,1 ms (p95 7,8), dos quais 1,8 no render do PixiJS |  |
| PC 1440, noite | placa de vídeo | 1,3 ms (p95 2,7) | 0,8 ms (p95 1,7) | 1,6 ms (p95 3,3) |
| Celular, noite, CPU 4x, teto 30 | placa de vídeo | 3,5 ms (p95 10) | 3,4 ms (p95 9,5) |  |
| Celular, noite, CPU 6x, teto 30 | placa de vídeo | 4,8 a 6,9 ms (p95 11 a 19,7); 2 rodadas | 3,8 a 5,6 ms (p95 9,3 a 15,7), dos quais 2,1 no render do PixiJS; 2 rodadas |  |
| Celular, noite, CPU 4x, sem teto | placa de vídeo | 3 ms (p95 8,3) | 1,8 ms (p95 4,9) |  |
| Celular, noite, CPU 6x, sem teto | placa de vídeo | 3,9 a 4 ms (p95 9,2 a 9,5); 2 rodadas | 2,1 a 2,3 ms (p95 6,2 a 6,3), dos quais 1,2 no render do PixiJS; 2 rodadas |  |

Celular emulado: 360 por 740, DPR 3, toque, CPU limitada pelo CDP, resolução interna 230 por 308. "Software" é o Chromium headless shell (WebGL e canvas por SwiftShader); "placa de vídeo" é o Chromium em headless novo com a GPU do PC e sem vsync. Quando um cenário foi medido duas vezes, aparece a faixa. Resultados brutos e método em `docs/local/prova-motor/`.

**Leitura:** as três versões seguram 60 fps no PC e o teto de 30 fps no celular emulado, com folga (o pior quadro médio foi 9 ms para um limite de 33 ms). No PC, o PixiJS desenha com um quarto a pouco mais da metade da CPU da prancha. No celular com teto, empate dentro do ruído. Sem teto e com placa de vídeo, o PixiJS dá de 13% a 33% mais quadros. Decisão e motivos no ADR 0001.

## Divergências entre o estudo e o que foi observado

1. **PixiJS 8.22.0 foi publicado em 01/10/2026**, não em 10/10/2026: já passou das duas semanas e pode ser usado.
2. **Vite 8.3.5 saiu em 21/10/2026**: nova demais. O ADR fixa a 8.3.4. O mesmo vale para `@hono/node-server` (2.1.4 em vez de 2.1.5) e `zod` (4.6.5 em vez de 4.6.7).
3. **Multiplicação e brilho aditivo são nativos no WebGL do PixiJS 8.22** (não precisam do pacote de blends avançados), e o 8.22 traz um renderizador Canvas como alternativa ao WebGL.
4. **`node:sqlite` já funciona no Node 24.5.0**, com aviso de experimental. Não é preciso atualizar o Node para começar.
5. **Claude Code:** o CLI no PATH é 2.1.296, mas as sessões abertas (extensão do VS Code e app desktop) estão em 2.1.304 e 2.1.306. As transcrições têm tipos de linha que o estudo não lista: `atis-latch`, `api-request-shape`, `api-request-blob`, `agent-name`, `custom-title`, `bridge-session`, `file-history-delta`.
6. **`~/.claude/sessions/` tem `.json` e `.key`.** O `.json` traz `status` (`idle` ou `busy`) e `statusUpdatedAt`: um sinal de "trabalhando" sem hook nenhum. Traz também `peerToken` e `messagingSocketPath`, que nunca podem sair da memória. Os `.key` nunca podem ser abertos.
7. **Codex:** tipos novos nos rollouts: `token_usage_record`, `inter_agent_communication_metadata`, `world_state`.
8. **OpenMausBot:** `mascotBody` e `mascotExpression` não vieram em nenhum bot (o app parece omitir o padrão `cursor`); o WireBot ganhou campos novos (`soulDrift`, `soulHash`, `installedPackage`, `playbooks`, `connectorTools`, entre outros). A equipe que está no app hoje não é a primeira equipe descrita no contexto local (detalhe em `docs/local/verificacao-omb.md`).
9. **A prancha não tem `<meta name="viewport">`.** Aberta como arquivo no celular, ela vira o layout de PC reduzido (no claude.ai o host resolve). O produto precisa da meta; a prova já tem.
10. **A prancha borra alguns pontos:** `pxl` desenha em coordenada fracionária sem arredondar (LEDs dos racks, carro holográfico, peixes). Na prova em PixiJS tudo é inteiro e fica nítido.

## O que não foi verificado

- Aparelho físico (o modelo ainda não é conhecido) e a GPU de um celular antigo: o Playwright limita só a CPU.
- Eventos reais do OpenMausBot com bots trabalhando (estavam ociosos), formato do `id:` do SSE e retomada por `Last-Event-ID`.
- Itens que exigem mudar configuração e ficam para a Fase 6 com o ok do Igor: hooks do Codex nas sessões do VS Code, comportamento do exportador OTel com o coletor desligado, `--settings` extra junto com `--setting-sources project`.
- O renderizador Canvas do PixiJS (plano B) foi medido só no PC.
- Tempo de carga no celular: o pacote completo do PixiJS (232 KB com gzip) não teve a abertura cronometrada com CPU limitada.

## Pendências do portão G0

- Respostas do Igor: modelo do celular e versão do Android; rede Privada e regra de firewall; mapa de alas (rascunho em `docs/local/arcadia.config.rascunho.yaml`); modo autônomo nas Fases 1 e 2.

O commit e o push da Fase 0 em `main` foram autorizados em 22/10/2026, só com o que está no Git (nada de `docs/local/`).
