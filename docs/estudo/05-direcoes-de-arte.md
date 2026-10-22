# Direção de arte do Arcadia

## Decisão de 22/10/2026: pixel art isométrica, futurista e cheia de vida

Depois de ver a primeira prancha (três direções em 3D low-poly), o Igor pediu outro rumo: **pixel art**, porque ela permite muito detalhe nos elementos e nos personagens; um **mundo mais complexo**, com mais coisa; personagens maiores; algo **mais futurista**; e o mundo dele dentro do mundo (academia, programação, games, o Cockpit pessoal com a pessoa fixa trabalhando ao lado dele). Ele mandou três imagens como referência, não como base: um escritório de agentes em pixel art com rótulos e setas de tarefa, um escritório isométrico estilo Habbo com luz quente e balões de atividade, e uma cena frontal de escritório com janela para a cidade.

A prancha que materializa essa direção está em `docs/local/conceitos/arcadia-pixel.html` (fora do Git porque traz os personagens pessoais). Ela é o ponto de partida da Fase 1.

## 1. O mundo: um andar de arcologia

- **Forma:** um andar flutuante de uma arcologia futurista, em pixel art isométrica (ladrilhos de 32 por 16), visto de cima num ângulo de jogo de gestão. A laje mostra janelas dos andares de baixo; as paredes do fundo têm janelas para uma cidade com prédios iluminados, lua ou sol e carros voadores.
- **Alas** = departamentos (frentes). **Salas** = projetos dentro da ala. **Corredores** com luzes-guia e **linhas de dados** que levam pulsos de cada ala até o **Núcleo** (o holograma do orquestrador, com contador de entregas).
- **Alas da prancha** (exemplo, a real vem dos dados): Servidores, Copiloto (com quadro de portões e vitrine holográfica de carro), Kyber Tech (parede de sites de clientes), Estúdio de vídeo (tela verde, câmera, ring light, luz ON AIR), Trabalho (baias corporativas), Núcleo, SABINVS e academia (palco de poses, halteres, rack de agachamento, esteiras, supino), Lounge (café, máquina de whey, fliperamas, pufes), Recepção (teletransporte), Produtos (cápsulas dos produtos e o terreno da próxima sala) e o **Cockpit** (mesa de comando do Igor, mesa da pessoa fixa, aquário, estante de troféus, saco de pancada, celular na doca mostrando o próprio Arcadia).
- **Crescimento:** projeto novo vira sala nova no terreno livre da ala, com obra (drones, andaime, faíscas, barra de progresso) e letreiro com o nome; depois chega um agente pelo teletransporte. Andar lotado ganha um andar novo.
- **Leitura:** zoom por níveis (andar, ala, sala, personagem, tarefa) em múltiplos inteiros, sem borrar.

## 2. Personagens

| Quem | Como aparece |
|---|---|
| Agentes (bots do OMB) | **androides** chibi de 16 por 32: casco branco, corpo na cor do papel, olhos de LED que mudam com o estado, luz no peito na cor do estado, antena; acessório pelo cargo (headset do coordenador, boina do design, fone do dev, lupa do QA, monóculo do crítico, gravata no trabalho) |
| Sessões avulsas | Claude Code em terracota; Codex de casco escuro e olhos brancos; chegam e saem pelo teletransporte |
| Subagentes | minidrones redondos que nascem ao lado do pai e somem ao entregar |
| Drones | carregam envelope (delegação e pedidos), check verde (aprovação) e pacote (entrega até o Núcleo), com sombra no chão e rastro |
| Humanos | o Igor e a pessoa fixa do Cockpit, desenhados a partir de fotos de referência (ficha só no contexto local; nada pessoal no Git) |
| Cenário | recepcionista androide, drone de manutenção dos servidores |

Animações: parado (respira), andar (4 quadros), sentar e digitar, operar console em pé, levantar peso, pose de fisiculturismo (duplo bíceps), correr na esteira, beber, jogar fliperama, acenar.

## 3. Linguagem dos estados

Estado aparece por **forma, cor, lugar e gesto**, nunca só por cor:

| Estado | Olhos (androide) | Ícone e cor | Lugar ou gesto |
|---|---|---|---|
| pensando | olhando para cima | três pontos, creme | no posto |
| lendo | olhando para baixo | linhas, lilás | holograma de texto |
| editando | foco azul | lápis, azul | digitando; holograma de código |
| rodando comando | foco verde | `>_`, verde | terminal; ON AIR no estúdio quando renderiza |
| esperando você | "! !" âmbar | "!", âmbar | coluna de luz âmbar; botão "Precisa de você" |
| erro | "X X" vermelhos | X, coral | fumaça; racks piscam vermelho |
| entregou | "^ ^" verdes | check, verde | confete; drone com pacote até o Núcleo |
| delegando | foco dourado | envelope, dourado | drone sai com o envelope |
| treinando | foco rosa | haltere, rosa | academia |
| pausa | "^ ^" | xícara, azul claro | lounge |
| ocioso | piscando devagar | sem ícone | pausas e, à noite, dorme |

Balões de texto (em DOM, com fonte pixel) mostram a frase curta do estado ("Rodando npm run build:demo"), como os rótulos das referências do Igor, limitados por prioridade para não poluir.

## 4. Vida ambiente

Dia e noite pelo relógio real; à noite a cena escurece por multiplicação e acendem brilhos aditivos (hologramas, lampiões, neon, aquário, máquina de whey, teletransporte). Racks piscando no ritmo da atividade, esteiras girando, vapor do café, peixes, teclado RGB, letreiros neon que falham de vez em quando, nuvens de dia e estrelas à noite em volta da laje.

## 5. Identidade visual

- **HUD:** fundo noturno `#0a0c1b`, painéis `#131733`, linhas `#2b3170`, texto `#eef0ff`, ciano `#3ee0ff`, âmbar `#ffb347`, magenta `#ff4fd8`; bordas duplas de pixel e sombras duras.
- **Fontes:** Silkscreen (títulos, botões e rótulos) e VT323 (balões, faixa de eventos, números), ambas OFL; letreiros dentro do mundo com uma fonte bitmap 3 por 5 desenhada em código, com acentos do português. A Pixelify Sans foi testada e descartada: em tamanho pequeno o "C" vira "O".
- **Cores das alas:** configuráveis; na prancha, Copiloto coral, Kyber azul, SABINVS verde, Estúdio âmbar, Trabalho cinza-azulado, Núcleo ciano, Lounge rosa, Produtos lilás, Cockpit dourado.
- **Texto:** português do Brasil, sem travessão nem meia-risca, sem emoji, datas dd/mm/aaaa, R$.

## 6. O que a Fase 1 ainda decide com o Igor (vendo)

1. Escala dos personagens: 16 por 32 contra 24 por 40.
2. Arte só procedural contra procedural com passe à mão nos humanos e nos androides principais.
3. Celular em pé: isométrico com câmera aquário contra corte lateral em pixel (andar visto de frente, estilo Tiny Tower).
4. Paleta noturna: neon fria contra quente.
5. Densidade: o andar da prancha contra um andar ainda mais cheio.

## 7. Histórico: a primeira rodada em 3D (descartada em 22/10/2026)

A prancha `docs/conceitos/direcoes-de-arte.html` mostra as três direções 3D low-poly estudadas antes: **A Vila** (ilha-diorama com pavilhões em corte), **B Torre** (prédio em corte, um andar por departamento) e **C Arquipélago** (ilhas no céu com farol e pontes de luz), mais a sugestão de um híbrido. O Igor achou "legal, só que longe do que eu penso" e os modelos pequenos. Ideias que sobreviveram e foram para a pixel art: alas por frente, sala que nasce e fica, zoom por níveis, modo aquário, delegação como objeto que viaja, sinal claro de "esperando você", ócio virando lugar (café, academia), dia e noite pelo relógio. Fica guardada como histórico (protótipos nunca se apagam).
