# Estado atual

Atualizado em 24/10/2026, na publicação da Fase 3.

## Em uma frase

A Fase 0 está feita e publicada (`16c152a`) e as perguntas do portão G0 foram respondidas no mesmo dia, inclusive a da rede (Wi-Fi de casa Privada, com os comandos prontos para o Igor rodar). As Fases 1 e 2 correram em paralelo, cada uma com um agente: a Fase 1 passou pelo portão G1 em 23/10/2026 (o Igor aceitou todas as recomendações, que viraram o padrão); a Fase 2 tem os marcos 1 a 5 prontos e espera um caso real de delegação do OpenMausBot para fechar o G2. As duas foram publicadas em `main` em 23/10/2026 (`5fdc06a`). A Fase 3 (o mundo ligado ao servidor) passou no portão G3 em 24/10/2026, com ressalvas que ficam para a Fase 4, e foi publicada em `main` no mesmo dia, com o ok do Igor. Nenhum hook, configuração, firewall ou rede foi alterado.

## Fases 1 a 3

| Parte | Situação |
|---|---|
| Esqueleto | npm workspaces com `apps/world`, `apps/server` e `packages/shared`, versões exatas (ADR 0001). `npm run typecheck`, `npm test`, `npm run build:mundo`, `npm run servidor`, `npm run doctor`, `npm run simular` |
| Fase 2, marco 1 | Feito e revisado. `packages/shared`: evento canônico e estado em zod, saneamento com allowlist, regex de segredos e guarda na saída. `apps/server`: configuração, resolução de sala, motor com os timers da seção 4.3, SQLite em WAL, simulador com 7 cenários, snapshot e SSE, página de depuração, doctor. 126 testes passando, incluindo replay determinístico e o teste de vazamento (que falha se a máscara for desligada). Decisões no ADR 0002 |
| Fase 2, marco 2 | Feito: adaptadores reais (transcrições do Claude com catch-up, sessões vivas, rollouts do Codex, OpenMausBot com snapshot, SSE e delegações), fusão entre fontes e contagem de linhas ignoradas no doctor. 155 testes passando, inclusive contrato com o OpenMausBot 0.1.121 instalado e dois testes de vazamento. Evidência do G2 com as fontes reais: o doctor mostra cada fonte; uma sessão real do Claude Code apareceu na sala certa com mediana de 252 ms e máxima de 273 ms entre a linha no JSONL e o quadro no SSE; o banco real passou na guarda de vazamento. Turno real de bot do OpenMausBot visto em 22/10/2026, com uma mensagem do Igor a um bot de motor Codex: 7 quadros `runtime` viraram 5 eventos em cerca de 8 s (presença ativa, início do turno, uso de tokens, fim e presença ociosa), o bot foi para a sala do QG da equipe pela regra do config e contou uma entrega, e nenhum texto de mensagem chegou ao banco nem ao snapshot (os bots não têm nenhum campo de texto e as delegações ficaram vazias). **Ainda sem caso real:** ferramenta de bot, delegação por drone, erro e interrupção |
| Fase 2, revisão de privacidade | Feita por outro agente, só leitura, com prova por script de dados inventados. Achou 11 problemas e 5 plausíveis. O mais grave: caminho de rede (UNC ou WSL) citado numa ferramenta fazia o servidor sondar o host remoto, o que no Windows pode entregar o hash NTLM. Os outros: título de sessão em pasta excluída vazava; caminho com espaço vazava pela metade; formatos de segredo e caracteres invisíveis passavam; o banco não passava pela guarda; nome de equipe como `constructor` derrubava o servidor; opção de privacidade desligada não apagava o já gravado; doctor com caminho completo; HEAD no SSE pendurava conexão; varredura síncrona crescendo com o histórico. Corrigidos no marco 3 da Fase 2, cada um com teste: 201 testes passando, teste de vazamento refeito com canários exatos procurados como texto puro em todas as saídas, e mutação (desligar uma proteção por vez) provando que cada proteção tem teste. Conferi rodando de novo as provas do revisor. Segunda passada: as 16 correções se confirmaram e apareceram 7 problemas novos, em correção pelo agente da Fase 2: dois médios nas salas (projeto fora das raízes conhecidas virava uma sala por subpasta; uma fila única deixava um disco lento segurar todos os agentes e criar salas erradas), a marca de privado que se perdia ao reiniciar, um resto de caminho relativo com espaço, saneamento apagando texto legítimo demais, erro repetido escondido da `/saude` e o SSE que um processo local conseguia lotar. Também faltava teste que falhasse sem as guardas da `/saude` e do doctor. Corrigidos no marco 4 da Fase 2: 229 testes passando, mutação derrubando um teste para cada proteção nova, e eu conferi rodando de novo os scripts do revisor e 39 casos difíceis de saneamento (só a senha escrita em frase, como "minha senha é ...", ainda passava; corrigida no marco 5 e conferida com os mesmos casos) |
| Fase 2, salas nos dados reais | O snapshot real mostrou salas que não deviam existir: pastas de apoio na raiz de uma agregadora sem git (`docs`, `tmp`), a pasta de rascunho das sessões em `%TEMP%` e salas de origem desconhecida. Também havia vaivém: evento sem caminho devolvia o agente à sala do cwd. Corrigido no marco 5, com dados inventados: evento sem caminho mantém a sala; arquivo só leva a sala de projeto (raiz git, filha de agregadora ou apelido); pastas de apoio (`salas.pastasDeApoio`) contam para a agregadora; arquivo em rascunho (`salas.rascunho`, padrão `%TEMP%`) ou em sala fixa não move o agente; gravação move na hora e leitura só depois de 3 eventos seguidos. 240 testes passando e mutação derrubando um teste para cada regra nova. Nos dados reais, com o banco recomeçado às 18:06 de 22/10/2026: de 20 para 16 salas, sem as pastas de apoio, a de rascunho e a de arquivos dos agentes, e o doctor mostra, por motivo, quantos arquivos deixaram o agente na sala atual. Uma sala de projeto sem regra de ala ficou na Recepção, esperando classificação |
| Fase 2, defeito antigo achado no caminho | Um agente com ferramenta pendente e parado 20 min alternava entre dormir e "talvez esperando" sem fim, e o servidor não subia com o banco real. Corrigido com teste: o "talvez" só vale para estado de trabalho e há uma trava de repetição no mesmo instante |
| Banco de testes | Os bancos de teste de 22/10/2026 em `%LOCALAPPDATA%\Arcadia\dados` foram apagados com o ok do Igor depois da correção; o próximo servidor começa limpo. Não havia cópia do banco real em outro lugar. Às 18:06, também com o ok do Igor, o banco real recomeçou para valerem as regras de sala do marco 5; o anterior foi movido, sem apagar, para `%LOCALAPPDATA%\Arcadia\banco-anterior-2026-10-22-1806` |
| Fase 1 | Marcos 1 e 2 entregues: motor genérico em PixiJS (`apps/world`), cena base com o stand-by das alas e a cápsula de recarga dos bots, e a página `/prototipos` com as cinco perguntas de gosto e o elenco nos dois tamanhos. Typecheck e build verdes; nada pessoal no Git nem no build (o pacote de personagens e o cenário com as alas reais ficam em `docs/local` e só o Vite em desenvolvimento serve, só para o próprio PC). No perfil do Moto G14, todas as opções seguraram 30 fps a 4x e 6x. Decisões no ADR 0003. Revisão visual independente feita: confirmou o pixel perfeito, a fidelidade à prancha, o orçamento e os 30 fps a 6x, e achou 17 problemas, 4 altos (no aquário o acordar da ala acontecia fora da tela; `/prototipos` recarregava a cada troca e no celular escondia a opção B; balões cortados e sobrepostos; as capturas das perguntas 1 e 2 comparavam zooms diferentes). Corrigidos em 23/10/2026, cada um com prova de antes e depois: o acordar fica na tela, `/prototipos` não recarrega, nenhum balão cortado ou sobreposto, comparações no mesmo zoom, ordem de desenho sem erro, ícones com contraste de 4,4 a 14,7 para 1 à noite e movimento reduzido respeitado. O build final segura 30 fps a 4x e 6x no perfil do Moto G14. Conferi typecheck, build, escrita e a ausência de dados pessoais no build. Portão G1 em 23/10/2026: o Igor aceitou todas as recomendações (24 por 40; passe à mão só nos humanos; no celular em pé, isométrico como padrão e corte lateral a um toque; noite fria; andar cheio; letreiro respirando com ícone fixo de espera; roupa alternativa para um dos humanos do pacote local). As escolhas viraram o padrão do mundo, e as Fases 1 e 2 foram publicadas (`5fdc06a`) |
| Incidente de 23/10/2026 | Às 20:34 e às 20:37, um agente rodou o servidor sem `--config`; ele caiu na config de exemplo, que aponta para a pasta de dados real, abriu o banco por cerca de 1 s e só depois falhou na porta ocupada. Mexeu só na tabela de alas (5 alas desligadas, um nome trocado, 2 alas do exemplo criadas) e gravou 2 snapshots; eventos e salas ficaram intactos. Com o ok do Igor, o banco foi copiado para `%LOCALAPPDATA%\Arcadia\banco-antes-do-reparo-2026-10-23.sqlite` e as alas foram regravadas a partir da memória do servidor real, sem as 2 alas e os 2 snapshots errados; conferência depois: 10 de 10 alas iguais e integridade ok. Pedidas ao agente do servidor: o exemplo nunca vale como config de execução, portas abertas antes do banco, trava de instância única na pasta de dados e `--help` |
| Fase 3 | Começou em 23/10/2026, com o ok do Igor: o mundo passa a ler o snapshot e o SSE do servidor. Um agente cuida do mundo (cliente de dados, mapeamento dos estados, drones, cartões, obra das salas novas); outro, do servidor (config de teste, cenário do simulador com todos os estados da 4.3, servir o build e o pacote local só no próprio PC). Portão G3: capturas no PC e no celular emulado, 30 fps com CPU limitada, checklist da 4.3 e revisão visual por outro agente. Feito em 23/10/2026: o mundo lê o snapshot e o SSE (retomada, resync, recarga por `buildId`) e põe cada estado da 4.3 no lugar, com drones, obra, cartões e selo de conexão; o servidor entrega o build e o pacote local (só no próprio PC), com uma CSP sem `'unsafe-eval'`; 271 testes passando (ADR 0004). Revisão independente do G3 em 24/10/2026, por outro agente: ainda não passa. Passam os estados no isométrico (PC e celular), os cartões, o selo, a volta depois de uma queda, o protocolo, a privacidade e o fps (de 29,6 a 29,9 com a CPU limitada a 4x e 6x, 30 sem limite, sem regressão contra `5fdc06a`; a medida anterior, de 27,7 a 29,4, foi com o PC carregado). Falham três itens: a academia some do andar servido pelo servidor; sala nova numa ala cheia nasce sem obra (no andar real, uma ala já tem 2 salas sem cápsula); e o corte lateral esconde quem está numa cápsula. Achou também: recarga com o servidor fora que prende a página na tela de erro do navegador; ala renomeada que não remonta o andar; temas trocados no andar real, porque o andar servido pelo servidor parte do andar de exemplo e o tema das alas sai do conteúdo delas; teto de abas do SSE em rodízio sem fim; placas sobrepostas; status em inglês no cartão; aquário lento para ir até quem espera; holograma de estado que falta na cápsula; e pouca leitura de longe no celular. Corrigido em 24/10/2026 pelos dois agentes: no corte, quem está numa cápsula fica inteiro entre o fundo e a bancada, e o que está na frente fica translúcido; a academia só vai para ala de tema academia e, sem ela, continua como área comum; a planta conta os terrenos de cada lote, e o que não cabe vai para um anexo da ala, com a obra visível e a câmera indo até ela; a config ganhou um campo `tema` opcional por ala (sem ele, o tema sai do id da ala e depois do conteúdo); o andar remonta quando uma ala muda de nome, cor ou tema; o servidor avisa a aba que perdeu a vaga (`event: adeus`) em vez do rodízio, a aba escondida solta a conexão depois de 60 s e a recarga só acontece quando o servidor responde; status em português, holograma na cápsula, aquário que chega à espera em menos de 2 s, fumaça mais visível e placas maiores no celular. Conferido por mim: 301 testes passando (os 19 do mundo agora entram no `npm test`), typecheck e escrita com saída 0, nada pessoal no build e as capturas de prova dos dois agentes. No andar real, depois de reiniciar o servidor com os temas na config: as nove alas com o tema certo, a academia de volta com 10 aparelhos e 8 lugares de treino, 17 salas com 17 cápsulas (uma ala ganhou um anexo) e nenhum erro no console. Segunda rodada do revisor em 24/10/2026: o G3 passa com ressalvas. Os três itens que barravam passam, com capturas no PC e no celular emulado, no andar de teste e no real; os outros achados foram corrigidos ou melhoraram; fps de 28,98 a 29,96 com a CPU limitada a 4x e 6x (teto de 30); nada pessoal no build. Achado novo, corrigido por mim no mesmo dia: no corte, as telas apagadas da ala de tema agência acendiam (branco de dia, lilás de noite) e, no celular, cobriam o nome da ala; agora ficam escuras, e as telas que bateriam no letreiro em dobro saem (capturas no PC e no celular, de dia e de noite). Tirei também a linha repetida de delegação nas últimas ações do cartão. Depois disso: 302 testes passando (uma rodada teve uma falha no teste de tempo da varredura de 2 s, e as três seguintes passaram), typecheck e build com saída 0, e nenhum termo privado a mais no build. Ficam para a Fase 4: no aparelho real, fps, carga, remontagem do andar, aba em segundo plano, toque nos cartões e a recarga das 03:00; placas das cápsulas maiores ou mais claras no celular; balão sem cobrir o letreiro no corte; selo certo para a aba escondida que soltou a conexão; remontagem mais barata e medida de fps que atravesse a remontagem; testar o adeus por muitas conexões e o 403 de outro aparelho. Publicada em `main` em 24/10/2026, com o ok do Igor |

Achado da máquina no caminho: um npm 6 antigo fora do projeto entra no lugar quando um script do `package.json` chama `npm` por dentro. Os scripts da raiz chamam `tsc`, `vite` e `node` direto.

## O que existe

| Caminho | O que é |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | regras curtas da missão (o `CLAUDE.md` só aponta para o `AGENTS.md`) |
| `docs/prompt-arcadia.md` | a missão completa |
| `docs/estudo/01` a `05` | o estudo de 22/10/2026 |
| `docs/proxima-sessao.md` | o único roteiro vigente |
| `docs/decisoes/0001-stack.md` | ADR da stack: PixiJS 8.22.0 no mundo, Node com Hono e `node:sqlite` no servidor |
| `docs/decisoes/0002-nucleo-de-dados.md` | ADR do núcleo de dados e do protocolo (snapshot e SSE) |
| `docs/decisoes/0003-mundo.md` | ADR do mundo em PixiJS: formato de cena, renderizador, stand-by, medidas |
| `docs/decisoes/0004-mundo-ao-vivo.md` | ADR do mundo ao vivo: cliente de dados, planta a partir das alas do servidor, estados, drones, cartões |
| `docs/creditos.md` | terceiros e licenças |
| `config/arcadia.config.exemplo.yaml` | exemplo genérico de configuração |
| `tools/checar-escrita.mjs` | checagem das regras de escrita (`node tools/checar-escrita.mjs`) |
| `scripts/rede-local.ps1` | imprime os comandos de rede para ver no celular (não executa nada) |
| `package.json`, `apps/`, `packages/` | o código das Fases 1 a 3 |
| `docs/conceitos/direcoes-de-arte.html` | prancha 3D da primeira rodada (histórico) |
| `docs/local/` (fora do Git) | contexto pessoal, prancha em pixel art, verificação detalhada, configuração real com o mapa de alas, passo a passo da rede e a prova do motor |

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
11. **Achados da Fase 2 nas fontes reais:** as transcrições do Claude trazem ainda os tipos `frame-link`, `artifact-comment-monitor` e `artifact-autoreact-ledger` e ferramentas novas do app desktop (Workflow, Monitor, TaskCreate e outras); os rollouts do Codex trazem `sub_agent_activity`, `mcp_tool_call_end` e `patch_apply_end` e as ferramentas `exec`, `js`, `send_message` e `followup_task`; no Codex, o id do item só bate com o `call_id` em cerca de 1 de cada 5 casos, então a falha vem do status do `item_completed`.
12. **OpenMausBot 0.1.121:** `cap.exhausted` não está mais na validação do RuntimeEvent (o adaptador ainda o trata), e o quadro `bot.queued` traz o texto das mensagens na fila (o Arcadia usa só a contagem).

## O que não foi verificado

- Aparelho físico (o modelo ainda não é conhecido) e a GPU de um celular antigo: o Playwright limita só a CPU.
- Eventos reais do OpenMausBot com bots trabalhando (estavam ociosos), formato do `id:` do SSE e retomada por `Last-Event-ID`.
- Itens que exigem mudar configuração e ficam para a Fase 6 com o ok do Igor: hooks do Codex nas sessões do VS Code, comportamento do exportador OTel com o coletor desligado, `--settings` extra junto com `--setting-sources project`.
- O renderizador Canvas do PixiJS (plano B) foi medido só no PC.
- Tempo de carga no celular: o pacote completo do PixiJS (232 KB com gzip) não teve a abertura cronometrada com CPU limitada.

## Portão G0: respostas do Igor (22/10/2026)

1. **Celular-alvo:** Moto G14 com Android 14. Tela LCD de 6,5" em 1080 por 2400 a 60 Hz, Unisoc T616 (2 núcleos Cortex-A75 e 6 Cortex-A55), GPU Mali-G57 MP1, 4 GB de RAM. O Chrome é atual, então o build não precisa de alvo antigo. Emulação nas medições: 412 por 915, DPR 2,625, CPU limitada a 4x e 6x.
2. **Rede:** decidido em 22/10/2026 que a Wi-Fi de casa vira **Privada**. Os comandos (abrir, conferir e desfazer) saem de `scripts/rede-local.ps1`, que só lê a rede e imprime; o Igor roda como administrador quando for a hora de ver no celular. A regra libera só a porta 4780, só no perfil Privado e só para a sub-rede local; fora de casa a porta continua fechada. Até ele rodar, tudo é servido só no PC.
3. **Mapa de alas confirmado** (configuração real fora do Git): Copiloto, Kyber Tech, Estúdio, Trabalho, SABINVS e academia, Produtos, Pessoal, Arcadia, Bastidores e Recepção. O Cockpit continua como área fixa do andar, não como ala de projetos.
4. **Modo autônomo:** sim. Fases 1 e 2 em paralelo com subagentes, parando só nos portões do Igor (escolha visual no G1, rede e commit).

Decisões de mundo tomadas pelo Igor depois do G0, em 22/10/2026:
- **Stand-by:** ala sem atividade fica em meia-luz, com letreiro apagado, telas desligadas e linhas de dados sem pulso, e acorda em sequência quando ele começa a trabalhar num projeto dela; o androide chega pelo teletransporte e a câmera do aquário vai até lá.
- **Bots parados:** agentes fixos (bots do OpenMausBot) ficam em stand-by na própria ala, numa cápsula de recarga, e acordam quando recebem trabalho; academia e lounge só para pausas curtas entre tarefas.

O commit e o push da Fase 0 em `main` foram feitos em 22/10/2026 (`16c152a`), só com o que está no Git (nada de `docs/local/`).
