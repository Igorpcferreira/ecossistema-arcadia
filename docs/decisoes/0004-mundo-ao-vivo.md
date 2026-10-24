# ADR 0004: o mundo ao vivo, ligado ao servidor (Fase 3)

- **Data:** 23/10/2026 (Fase 3)
- **Status:** aceita para a Fase 3. O portão G3 confere as capturas, o desempenho e a lista da seção 4.3; o celular de verdade fica para o G4.
- **Revisão:** 24/10/2026, correções do G3 (academia, anexos, tema por ala, corte lateral, holograma da cápsula, placas e celular).

## Contexto

Até a Fase 2, o mundo (`apps/world`) só rodava com o simulador do navegador, e o servidor (`apps/server`, ADR 0002) já entregava o snapshot e o SSE. A Fase 3 liga os dois: o mundo mostra o estado do servidor e não decide nada de negócio. Estado, sala, fila "precisa de você", obras e métricas chegam prontos; o mundo só coreografa.

## Decisão

### Fonte dos dados

- **Padrão: o servidor.** A página do mundo busca `GET /api/snapshot` e abre o SSE de `/api/events?desde=<seq do snapshot>`. `?fonte=simulador` volta ao simulador do navegador, e o `/prototipos` continua sempre com ele. O HUD mostra um selo: AO VIVO, CONECTANDO, SEM CONEXÃO ou SIMULADO.
- **Conexão** (`fonte/conexao.ts`): quadro com `seq` repetido é ignorado; buraco no `seq` e `event: resync` refazem o snapshot (os quadros que chegam durante a busca esperam e entram depois, em ordem); `ola` com outro `buildId` recarrega a página; outra `instancia` (servidor reiniciado) refaz o snapshot. O EventSource retoma sozinho com `Last-Event-ID`; se ele desistir (resposta de erro, proxy sem servidor), a reabertura é nossa, de 1 a 10 s. Um vigia dá a conexão por morta depois de 45 s sem nada (nem o ping de 15 s).
- **Sem servidor:** o mundo fica na tela, com o aviso "Sem conexão com o servidor. O mundo volta sozinho." Na carga, sem snapshot, a tela diz que está sem conexão e tenta de novo em 2, 4, 8 e depois 10 s.
- **Espelho** (`fonte/espelho.ts`): o estado do servidor no navegador, com as entidades inteiras substituídas a cada quadro, e uma fila de sinais (o que mudou, com o instante do quadro) para o coreógrafo. Os tipos vêm de `@arcadia/shared` só como `import type`: nada do zod entra no build.
- **Desenvolvimento:** o Vite (4781 e 4782) encaminha `/api` para o servidor de teste (4790); `ARCADIA_API` troca o alvo e só aceita endereço do próprio PC.

### A planta do andar sai das alas do servidor

- A base é o cenário local (só em desenvolvimento, só no próprio PC) ou o andar de exemplo do repositório. As áreas comuns ficam onde estão (`fonte/planta.ts`).
- **Tema da ala:** o da configuração (`alas[].tema`, que o servidor manda no estado); sem ele, o id da ala quando é nome de tema; sem os dois, o conteúdo (bots na ala viram equipe, senão o tipo mais comum das salas). A Recepção nunca traz tema.
- **Lote:** a Recepção vai para a área da recepção; ala com o mesmo id de um lote de ala da base fica nele (o tema da configuração troca o do lote); as outras ocupam primeiro o lote livre de mesmo tema e depois qualquer lote livre. Sem lote, a ala ganha um lote novo em linhas no fim do andar, com a altura alternada da base (11 e 10); o último lote de uma linha incompleta, quando é de ala, ocupa as colunas que sobram. Com os temas do cenário local na configuração, o andar de produção sai igual ao dele: seis alas nos lotes do exemplo e as outras três na linha de baixo.
- **A academia nunca some:** o lote de academia só recebe ala de tema academia (pela configuração ou pelo id). Sem ela, continua a academia comum do andar (área, com os pontos de treino), e a pausa de dia vai à academia ou ao lounge.
- Lote de ala sem ala no servidor vira **lote livre**: piso de depósito, quase vazio, em espera, com o nome "LOTE LIVRE".
- **Toda sala tem cápsula:** a planta conta os terrenos de cada lote (o gerador mobilia só aquele lote, nas duas densidades, e vale o menor número) e distribui as salas na ordem do terreno do servidor. As que não cabem vão para um **anexo de cápsulas** da ala: um salão de cápsulas (tema de produtos) com o nome "<ALA> · ANEXO" e a cor dela, num lote livre do andar ou, sem ele, num lote novo no fim, depois das alas novas. Anexo nunca usa o lote da academia nem ocupa as colunas que sobram.
- **Sala nova sem terreno:** o coreógrafo nunca sai calado. Sala que nasceu depois da planta fica no primeiro terreno livre das zonas da ala (lote e anexos); sem nenhum, pede a remontagem: a planta nova já conta a sala, cria o anexo, e a obra aparece nele, com a câmera indo até ela e a faixa de eventos avisando. Sala que a planta já contava e ficou sem terreno só gera um aviso no console (remontar daria o mesmo andar).
- **Remontagem:** ala nova, renomeada, de outra cor ou de outro tema na configuração remonta o mundo (como a troca de vista): a assinatura das alas tem id, ordem, tipo, nome, cor e tema. O campo `ativa` da ala não é a espera: ala que saiu da configuração continua no andar, como as salas.

### Salas, agentes e lugares

- **Sala = cápsula com o nome**, num terreno de 2 por 2 da ala. O terreno sai de uma lista fixa por zona (no tema de produtos, os lugares das cápsulas e o terreno da obra; nos outros temas, terrenos livres com passagem, do fundo para a frente; os que ficam embaixo da placa flutuante da zona vão para o fim da lista). A planta dá o terreno de cada sala (a ordem do `terreno.indice` do servidor, no lote da ala e depois nos anexos): a mesma sala fica sempre no mesmo lugar. O nome vai em até 12 letras ("PORT. AURORA"), e a placa subiu 10 px para não cobrir quem senta dentro. A cápsula acende quando a sala está acordada e apaga quando ela dorme.
- **Quem senta na cápsula** fica no ladrilho do fundo à direita, atrás da bancada, e aparece inteiro (corpo, olhos, luz do peito e ícone) nas duas vistas. No isométrico, é desenhado na frente da cápsula inteira (as paredes do fundo cobriam o androide). No corte, a cápsula de frente é larga (52 px), com a placa do nome em cima, como parte dela, e fundo, bancada, tela, holograma e placa em camadas: quem senta fica entre o fundo e a bancada, à direita da tela, com o ícone ao lado da cabeça, e o que estiver na frente da cápsula ocupada fica translúcido. Quando a cápsula da sala fica pronta, quem trabalha nela e estava numa mesa da mesma ala muda para dentro.
- **Holograma da cápsula:** quem senta é o dono da cápsula, e um holograma em pé sobre a tela mostra o estado dele: texto quando lê, código quando edita, terminal verde quando roda comando (desligado nos outros estados), nas duas vistas.
- **Sala nova nasce com obra:** andaime, drones e barra de progresso no terreno dela durante a obra do servidor (60 s); no fim, a cápsula aparece com faíscas e fica. Obra recente na carga (ou na remontagem do andar que cresceu para ela) leva a câmera até lá.
- **Postos dinâmicos:** cada agente vai para a cápsula da sala dele (se estiver livre), depois para uma mesa do tema (o bot de coordenação prefere o console) e, sem mesa, para um lugar em pé, mexendo num holograma. O bot guarda a mesa enquanto descansa na cápsula de recarga, que nasce na própria ala quando ele precisa.
- **Atlas que cresce:** o que nasce depois da carga (placa da cápsula de uma sala nova, um bot de cor nova, a cápsula de recarga) é assado uma vez, direto na folha do atlas, que sobe de novo para a placa de vídeo. As aparências das sessões (Claude e Codex) já vão na carga.
- **Aparência:** sessão do Claude em terracota, do Codex de casco escuro e olhos brancos; bot com a cor do OpenMausBot, o acessório inferido de palavras comuns do cargo e o corpo do mascote como um emblema de 3 por 3 na barriga.

### Estado vira lugar e gesto (seção 4.3)

| Estado do servidor | No mundo |
|---|---|
| chegando | feixe no teletransporte, a recepcionista acena, anda depressa até o posto; a câmera do aquário segue |
| pensando, lendo, editando, comando, delegando | no posto, com o ícone, os olhos e o holograma do estado; balão com o nome curto do arquivo quando há |
| trabalhando | aparece como comando |
| esperando | olhos "! !", coluna âmbar, poça de luz, botão "Precisa de você" com a fila do servidor; espera nova leva a câmera do aquário até ela em menos de 2 s, sem esperar a troca de plano; resolvida com trabalho, um drone verde leva o check do Cockpit |
| talvez-esperando | coluna âmbar tracejada (não é o âmbar exato) |
| erro | olhos "X X", fumaça clara saindo da cabeça por uns 4 s (baforadas com faíscas, perto de 30 partículas, sem a tinta da noite), racks piscando |
| entregou | confete e um drone com o pacote até o Núcleo; o contador do Núcleo segue `metricas.entregas` e sobe quando o pacote chega |
| ocioso | parado no posto |
| pausa | sessão: academia ou lounge, alternando a cada pausa (de noite, cochila no posto); bot: cápsula de recarga |
| dormindo | sessão: volta pelo teletransporte e fica fora do andar; bot: dorme na cápsula |
| na-fila | espera na fila da recepção, de costas |
| sem-sinal | congela onde está, translúcido |
| limite | apagão na ala onde ele está |
| saindo | volta pelo teletransporte; `agente.saiu` tira do mundo |
| subagente | minidrone ao lado do pai, com o ícone do estado dele (no corte, na sala do pai) |

- Delegação entre agentes: drone com envelope até o colega e de volta na conclusão. Pedido seu (`pedido.humano`): drone com envelope saindo do Cockpit.
- **Caminhada:** 4 ladrilhos por segundo na chegada e 2,6 no resto, mais depressa nos caminhos longos (no máximo 8 por segundo, perto de 10 s de caminhada). No caminho, o androide já mostra o estado do servidor; só a chegada (do teletransporte ou da cápsula) mostra "chegando" até sentar.
- **Contadores do Núcleo:** entregas e, com o servidor, os erros do dia (`metricas.erros`), com os números em dobro sobre uma placa escura e sem a tinta da noite.
- **Placas e cabeças:** nenhuma placa cobre cabeça ou ícone de agente. Os ícones de estado ficam por cima de todas as placas. No isométrico, a placa flutuante da zona procura, perto do canto do fundo, um lugar sem cabeça parada embaixo (postos, cápsulas, recargas, treinos, pausas, fila), e as placas (da zona, das cápsulas e os neons) desbotam enquanto alguém passa atrás delas; o balão de quem senta numa cápsula sobe acima da placa dela. No corte, a placa da cápsula é parte dela (em cima, larga o bastante para 12 letras), o neon fica embaixo das pessoas e a parede da sala ficou 8 px mais alta: o letreiro da sala, mesmo em dobro, não encosta no topo das cápsulas do fundo, e as placas das cápsulas da mesma fila não se tocam.
- **Efeitos no corte:** as partículas guardam o ponto de origem (a pessoa ou o ladrilho do chão) e o corte as desenha em volta dele; o ponto do isométrico convertido sozinho caía noutro andar ou no poço do elevador.
- **Celular:** a primeira tela põe o Cockpit no meio e sobe até o chão encher a parte de baixo da tela (sem o vazio embaixo); as placas das zonas (no isométrico) e os letreiros das salas (no corte) saem em dobro, em escala inteira, para ler de longe, e as placas das zonas não escurecem de noite.
- **Animação só do que é recente:** quadro com mais de 20 s (a volta de uma aba escondida, por exemplo) muda o lugar sem anúncio, balão nem drone. Na carga e no resync, todo mundo vai direto para o lugar certo e as alas entram no estado certo, sem acordar na tela; na carga (e na remontagem), só quem está chegando agora entra pelo teletransporte.
- A ala acorda pelas regras da Fase 1: `sala.dormindo` falso só acende a ala quando alguém da ala está dentro dela (a sessão que cruza a porta, o bot na cápsula) ou depois de 45 s. O mundo não dorme salas sozinho com dados do servidor.
- A vida ambiente continua no simulador, em modo só ambiente: o dono treina, a pessoa fixa toma café e os figurantes passeiam, sem nada na faixa de eventos.

### Cartões

- Agente: onde, estado e desde quando, tarefa saneada, ferramenta, espera, tokens (entrada, saída e cache), entregas e erros do dia, últimas ações e a árvore de delegação (quem delegou a quem, com a situação em português: na fila, em andamento, concluída, falhou; situação desconhecida não aparece, e os subagentes). Sem valor em dinheiro.
- Sala: ala, tipo, estado (acordada, dormindo ou em obra), última atividade, entregas e erros, e quem trabalha nela. O toque na cápsula abre o cartão dela.
- Ala: estado, salas (cada uma abre o cartão dela) e quem está nela. O anexo mostra "Anexo da ala" e as salas dele. "Precisa de você": a fila, do pedido mais antigo para o mais novo; cada item leva a câmera até o agente.

### Privacidade

- O build não leva nada de `docs/local`. Em produção, só o snapshot, o SSE e o pacote de personagens (que o servidor só entrega ao próprio PC) chegam ao navegador; o cenário local só existe no Vite de desenvolvimento.
- **CSP sem `unsafe-eval`:** o mundo importa `pixi.js/unsafe-eval` (no módulo do renderizador), e o PixiJS 8 não gera mais funções na hora. O servidor tirou o `unsafe-eval` da CSP do mundo.

## Consequências

- Em produção (o mundo servido pelo servidor), o andar usa a planta genérica com as alas do servidor; o desenho curado do cenário local só aparece em desenvolvimento. Com o tema por ala na configuração, o andar de produção sai com os mesmos lotes do cenário local; ala com mais salas do que terrenos ganha um anexo (por exemplo, uma ala de equipe com 6 salas: o lote dela tem 4 terrenos na densidade cheia), que entra na linha de baixo.
- A planta gera a cena de cada lote para contar os terrenos (uma sonda pequena por lote, guardada em memória): a carga custa poucos milissegundos a mais.
- Os testes do mundo rodam no Node, sem navegador: `node --test "apps/world/src/**/*.test.ts"` (planta e coreógrafo).
- O corte lateral mostra as salas, os agentes e a obra (andaime de frente, drones e barra).
- `apps/world` resolve `@arcadia/shared` pelo workspace da raiz, só para tipos.
