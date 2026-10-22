# Ecossistema Arcadia: regras para agentes

Mundo em pixel art isométrica para assistir agentes de IA trabalhando, aberto num celular antigo na rede local, só para ver. A missão completa está em `docs/prompt-arcadia.md`. O estado está em `docs/estado-atual.md` e o próximo passo em `docs/proxima-sessao.md`, o único roteiro vigente.

## Antes de agir

- Leia `docs/prompt-arcadia.md`, `docs/estado-atual.md` e `docs/proxima-sessao.md`. Se existir `docs/local/contexto-local.md` (fora do Git), leia também.
- Se um fato dos documentos divergir do que você observar na máquina, vale o que você observar. Registre a divergência em `docs/estado-atual.md`.
- Decisões de arquitetura ficam em `docs/decisoes/` (ADR curto, numerado).

## Inegociáveis

- **Só observar.** Nunca escrever em `~/.openmausbot`, `~/.claude` ou `~/.codex`. No OpenMausBot, só GET e o SSE com `screens=off`, numa lista fixa de rotas; nunca abrir os SQLite do app; nunca ler `hook-tokens`, `sessions.json`, `config.json`, o lease ou credenciais. Em `~/.claude/sessions/`, nunca abrir os arquivos `.key`, e o campo `peerToken` dos `.json` nunca sai da memória.
- **Nunca atrapalhar um agente.** Hooks só com o ok do Igor: assíncronos, sempre saem com 0, não imprimem nada, timeout curto e spool em disco. Arcadia desligado tem efeito zero nos agentes.
- **Configuração só com o ok do Igor**, uma mudança por vez, com backup, diff e como desfazer: `~/.claude/settings.json`, `~/.codex/*`, firewall, perfil de rede, variáveis de ambiente, tarefas agendadas, instalação de programas. Settings de projeto, nunca.
- **Privacidade por padrão.** Allowlist de campos. Nada de prompt, resposta, thinking, entrada de ferramenta, comando, diff, conteúdo de arquivo, caminho completo, e-mail ou token chega ao navegador. Caminho só em memória, para decidir a sala.
- **Rede local apenas.** Ingestão em `127.0.0.1`; visualização na rede local com pareamento; nada exposto à internet.
- **Repositório público.** Nada pessoal no Git: dados reais, nomes de clientes ou do trabalho, caminhos pessoais, personagens pessoais, capturas com dados reais, tokens, configuração real. Isso fica em `docs/local/` (ignorado), `%USERPROFILE%\.arcadia\` ou `%LOCALAPPDATA%\Arcadia\`. Revise `git diff --cached` antes de cada commit.
- **Genérico.** Nenhum nome de projeto, bot, equipe ou papel fixo no código: tudo vem dos dados e do arquivo de configuração.
- **Licenças.** Só CC0, MIT, Apache-2.0 e OFL (fontes). Pacote pago que proíbe redistribuir não entra. Tudo registrado em `docs/creditos.md`.
- **Protótipos nunca se apagam.** Toda opção visual continua acessível, e as pranchas de estudo ficam onde estão.
- **Evidência.** Só afirme o que rodou: comando, código de saída e saída real. Abra as capturas que gerar. Diga o que não foi verificado.

## Desempenho e pixel art

- Celular antigo primeiro: 30 fps no preset do celular, pausa quando a aba some, orçamento da `docs/estudo/04-stack-e-celular.md`, seção 1.
- Pixel perfeito: posições inteiras, ampliação só em múltiplos inteiros, textura com filtro `nearest`.
- Arte gerada por código vira textura uma vez (atlas e quadros de animação assados). Nada de redesenhar pixel a pixel em todo quadro.
- Toda página tem `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Git

- Commit e push só com autorização explícita do Igor, por escopo; proponha ao fim de cada fase. Nunca force push. Nunca `git init` em pasta agregadora.

## Escrita

- Português do Brasil, "você", frases curtas, sem travessão nem meia-risca, sem hífen com espaços como separador, sem emoji, datas dd/mm/aaaa, dinheiro em R$ (US$ entre parênteses quando a fonte for em dólar). Vale para UI, documentos, comentários e mensagens de commit.
- Antes de concluir: `node tools/checar-escrita.mjs` (sai com código 1 se achar problema).
