# ADR 0003: o mundo em PixiJS (Fase 1)

- **Data:** 22/10/2026 (Fase 1, marcos 1 e 2)
- **Status:** aceita para a Fase 1. As escolhas de gosto saem no portão G1; o desempenho real sai no aparelho, no portão G4.

## Contexto

O ADR 0001 escolheu o PixiJS 8.22.0. A Fase 1 levou a cena da prancha para um motor genérico em `apps/world`, com as variações de gosto em `/prototipos`. O mundo precisa nascer dos dados (alas, salas e agentes vêm do servidor na Fase 3), sem nome pessoal no código, e rodar a 30 fps num celular de entrada.

## Decisão

- **Organização:** `motor/` (renderizador, laço, câmera, atlas, vistas isométrica e de corte lateral), `arte/` (cerca de 55 tipos de objeto, personagens em 16 por 32 e 24 por 40, passe à mão, rostos por estado, letreiros), `cena/` (formato, temas, gerador, exemplo genérico, mundo e simulador com semente), `ui/` (HUD, balões e cartões em DOM), `prototipos/` e `qualidade/` (presets).
- **Formato de cena em dois níveis:** uma `Planta` (alas, salas, personagens e agenda) gera sempre a mesma `CenaDados` (objetos, posições, luzes). A ordem dos eventos do cenário fica na `agenda`, não no código. Os campos seguem o servidor (ADR 0002): `sala.dormindo`, `sala.ultimaAtividade`, `ocio.pausaMinutos` (3) e `ocio.dormeMinutos` (20), e `Personagem.tipoAgente` (`bot`, `sessao`, `subagente`).
- **Renderizador:** WebGL. Com WebGL por software (SwiftShader, llvmpipe), cai no renderizador Canvas do PixiJS com o preset baixo. Laço próprio (30 fps no celular, 60 no PC), pausa com a aba escondida, ticker e eventos do PixiJS desligados (toque no DOM), perda de contexto recarrega a página. Câmera com zoom só em múltiplos inteiros e modo aquário.
- **Arte gerada por código** e assada na carga num atlas de 2048 px, quadros de animação inclusive. Posições sempre inteiras.
- **Stand-by** (decisão do Igor): ala parada fica em meia-luz fria, com hologramas, telas e LEDs desligados, linha de dados sem pulso, letreiro respirando a cada 8 s e um ícone fixo de stand-by ao lado da placa. Quando o primeiro androide cruza a porta, a ala acorda em 1,6 s a partir dela, com pulsos até o Núcleo e a câmera do aquário junto (detalhes na revisão visual, abaixo). Bot parado vai para a cápsula de recarga da própria ala; academia e lounge só para pausas curtas.
- **Pessoal fora do Git:** o pacote de personagens (`docs/local/personagens/personagens.json`) e o cenário com as alas reais (`docs/local/fase1/cenario-local.json`) só são servidos pelo Vite em desenvolvimento e só para o próprio PC (pedido de outro endereço recebe 403). O build é genérico e não leva nada de `docs/local`.
- **Parâmetros de URL** para forçar e comparar: `?motor=`, `?q=`, `?fps=0`, `?hora=`, `?vista=corte`, `?escala=24`, `?arte=mao`, `?paleta=quente`, `?densidade=cheio`, `?ocio=rapido`, `?movimento=reduzido` e `?local=0`.
- **TypeScript:** `noUncheckedIndexedAccess` ficou desligado só em `apps/world` (o resto do monorepo segue estrito).

## Medidas (Playwright, perfil do Moto G14: 412 por 915, DPR 2,625, CPU limitada pelo CDP)

- Todas as opções seguraram o teto de 30 fps a 4x e 6x, com placa de vídeo e em software, entre 3 e 10 ms de CPU por quadro. Sem teto, a 6x: de 115 a 153 fps com placa de vídeo e de 40 a 54 em software. A variação entre rodadas é do tamanho da diferença entre as opções.
- Com placa de vídeo, a 6x: o mundo novo gastou 6,5 ms por quadro, a prancha 8,5 e a prova da Fase 0 7,2; sem teto, 138, 113 e 92 fps.
- Em software, o WebGL por SwiftShader saiu mais barato que o Canvas (3,5 contra 7,9 ms por quadro): a regra de cair no Canvas deve ser reavaliada no aparelho real.
- PC 1440 de noite: 60 fps, 1,6 ms por quadro. Carga no perfil do celular a 6x: de 0,8 a 2,7 s. JavaScript do build perto de 240 KB com gzip.

## Revisão visual da Fase 1 (22/10/2026)

Decisões tomadas ao corrigir os 17 achados da revisão visual independente:

- **Acordar na tela.** A ala acorda quando o primeiro androide cruza a porta dela. Se já houver alguém dentro (bot na cápsula), acorda na hora; se ninguém chegar em 45 s, acorda assim mesmo. Na Fase 3 vale o mesmo: `sala.dormindo` falso só dispara o acordar visual quando o androide da sessão chega à porta. A sessão nova anda a 4 ladrilhos por segundo do teletransporte até a mesa, e a câmera do aquário segue o androide até ele sentar (a duração sai da distância, não de um tempo fixo). Pausa de treino ou de café só 45 s depois de chegar.
- **Prioridade da câmera:** "esperando você" vem antes de qualquer chegada ou obra.
- **Perda de contexto:** o ouvinte de `webglcontextlost` sai antes de destruir o renderizador (o destroy do PixiJS perde o contexto de propósito). A aba A ou B da comparação no celular fica na URL (`?lado=B`).
- **Balões:** caixa presa entre 8 px e a largura menos 8 px, com o bico ainda apontando para o personagem; na colisão, o de menor prioridade sobe uma linha ou some; desviam da faixa de eventos e do aviso "precisa de você"; texto longo quebra a linha. No celular, letra de 22 px.
- **Comparações justas:** em `/prototipos`, A e B na mesma escala inteira (2x ou mais), no mesmo foco, com a câmera parada e sem a faixa de eventos por cima. No PC, o celular em pé mostra a área de arte do Moto G14 (271 por 601 px). As capturas de A e B saem no mesmo zoom, com a escala na legenda.
- **Ordem de desenho:** a pessoa é comparada com a caixa dos objetos de 3 ladrilhos ou mais (passou da borda da frente, vai depois; antes da borda de trás, vai antes). Ficou mais simples e barato que fatiar os objetos.
- **Noite sem multiplicar a tela:** a cor da noite (`#4b5592`) vai como tinta em cada sprite ou contêiner iluminado. Olhos, luz do peito, ícones de estado, coluna âmbar e brilhos ficam sem tinta, como luz própria, e continuam na ordem de profundidade. A poça de luz de "esperando" fica no chão. Contraste medido: ícones de 4,37 a 14,7 para 1, de dia e de noite, nas duas vistas.
- **Ícones:** "sem sinal" tem desenho próprio (tomada desligada), e o fundo dos ícones de "sem sinal" e "dormindo" ficou mais claro. Os olhos de "sem sinal" subiram para `#626c8a`, para passar de 3 para 1.
- **Luz da mesa de comando** no tampo, na frente do teclado (intensidade 0,25), no isométrico e no corte: não lava mais o rosto de quem senta atrás.
- **Movimento reduzido:** `prefers-reduced-motion` (ou `?movimento=reduzido|normal`) é lido em `criarMundo` e muda ao vivo. A câmera troca de plano em corte seco e, numa chegada, corta direto para a ala de destino em vez de seguir o androide. Nada pisca: o letreiro que acorda só sobe, a meia-luz da espera fica fixa, o neon não falha, o ON AIR fica aceso, a coluna âmbar fica fixa, as estrelas não cintilam, o ícone e o minidrone não balançam e a luz do peito na cápsula fica acesa.
- **Semelhança, como capacidades genéricas:** cabelo comprido atrás dos ombros (de frente, o que passa da linha dos ombros vai para trás do corpo), manga de tatuagem (`tatuagem.manga` e `tatuagem.ombro`) e, com barba no 16 por 32, uma linha de pele entre os olhos e o bigode. O que é de cada pessoa fica no pacote local.
- **`/prototipos`:** elenco em grade 2 por 2. No celular, o palco vem antes das perguntas e a página rola por cima dele (`touch-action: pan-y`): o mundo anda com arrasto que começa na horizontal ou, depois de um toque nele, com qualquer gesto. O link "Abrir o mundo em tela cheia" leva as escolhas atuais.
- **Miniaturas no DOM** (cartão e elenco) com ampliação física inteira, calculada pelo `devicePixelRatio`.
- **Ala em espera** ganhou um ícone fixo de stand-by (azul frio, sem a tinta da noite) ao lado da placa ou do letreiro, além da respiração.
- **Andar cheio** chega às alas da linha de baixo (pessoal, laboratório e bastidores), e a ala de duas colunas mobilia também a metade da direita.
- **Correções sem achado:** o grupo de minidrones era indexado de 2 em 2 e quebrava com subagentes; agora segue a contagem. Os arquivos do mundo voltaram ao fim de linha LF do repositório.

## Escolhas do G1 (23/10/2026)

O Igor aceitou todas as recomendações do portão G1, e elas viraram o padrão do mundo. As outras respostas continuam no `/prototipos`, com a escolhida marcada em cada pergunta ("escolhida no G1"), e pela URL.

- **Personagens em 24 por 40.** `?escala=16` volta ao tamanho da prancha.
- **Passe à mão só nos humanos** (os do pacote local); os androides ficam procedurais. `?arte=procedural` tira o passe de todos, e `?arte=mao` o põe também nos androides principais, como no protótipo do G1.
- **Celular em pé no isométrico**, com o corte lateral a um toque no botão Corte do HUD. O botão aparece no celular e no PC, recria o mundo na outra vista e guarda `?vista=corte` na URL.
- **Noite neon fria.** A quente segue em `?paleta=quente` e no `/prototipos`.
- **Andar cheio.** `?densidade=prancha` volta à mobília da prancha.
- **Ala em espera:** letreiro respirando mais o ícone fixo de stand-by. Já era o comportamento base, sem opção.
- **Roupa alternativa**, como capacidade genérica: a aparência ganha `variante` (só os campos que mudam), `bone` e `jaqueta`; os dados ficam no pacote local. A regra é um sorteio por dia: a data de São Paulo, a semente do mundo e a chave da aparência passam por um hash FNV-1a, e a variante sai quando o resto da divisão por `umDiaEm` (padrão 3) dá zero, perto de um dia em três. O mesmo dia dá sempre a mesma roupa; um mundo aberto de um dia para o outro troca no reload das 3 h. `?roupa=variante` e `?roupa=base` forçam, e o elenco do `/prototipos` mostra a roupa alternativa.
- As capturas dos marcos 1 e 2 (`docs/local/fase1/capturar.cjs`) fixam a combinação da Fase 1 (`escala=16`, `densidade=prancha`, `arte=procedural`) para continuarem comparáveis com a prancha; as do mundo padrão saem em `g1-padrao-*`.

## Consequências

- Na Fase 3, o mundo troca o simulador do navegador pelo snapshot e pelo SSE do servidor. Mapeamento de estados: `talvez-esperando` vira `talvez`, `na-fila` vira `fila`, `sem-sinal` vira `semSinal`, `trabalhando` aparece como `comando`, `saindo` é a sessão voltando pelo teletransporte, e `pausa` de bot vai para a cápsula. O campo `ativa` da ala no servidor (ala ainda presente no config) não é o stand-by.
- O mundo trata `nome` e `tarefa` ausentes e as salas fixas do servidor ("Pasta de rede", "Arquivos dos agentes", "Dados do Arcadia").
- Ver no celular pede o servidor na rede de casa (comandos de `scripts/rede-local.ps1`) e, para mostrar o pacote pessoal no celular, uma liberação temporária e explícita dos arquivos locais para a rede de casa.
