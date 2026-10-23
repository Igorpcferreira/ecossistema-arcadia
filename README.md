# Ecossistema Arcadia

Um mundo em pixel art para assistir agentes de IA trabalhando: cada frente vira uma ala de um andar futurista, cada projeto uma sala que nasce sozinha e fica, e os agentes são androides que trabalham, delegam por drone e, quando ficam ociosos, vão para a academia ou para o café. Feito para ficar aberto num celular antigo na rede local, só para assistir.

Estado em 22/10/2026: **Fase 0 concluída** (preparação e verificação, sem código de produto). Detalhes em `docs/estado-atual.md`; próximo passo em `docs/proxima-sessao.md`.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `AGENTS.md` e `CLAUDE.md` | regras curtas para qualquer agente que trabalhe aqui |
| `docs/prompt-arcadia.md` | a missão completa para a sessão que vai construir o Arcadia |
| `docs/estado-atual.md` | o que existe, o que foi verificado e as divergências encontradas |
| `docs/proxima-sessao.md` | o único roteiro vigente |
| `docs/decisoes/` | decisões de arquitetura (ADR), a começar pela stack |
| `docs/creditos.md` | tudo de terceiros, com licença |
| `config/arcadia.config.exemplo.yaml` | exemplo genérico de configuração (a real fica fora do repositório) |
| `tools/checar-escrita.mjs` | checagem automática das regras de escrita |
| `scripts/rede-local.ps1` | imprime os comandos (abrir, conferir e desfazer) para ver o Arcadia no celular pela Wi-Fi de casa; não executa nada |
| `docs/estudo/01-openmausbot.md` | o OpenMausBot como fonte de dados (SSE, snapshot, delegação, autenticação) |
| `docs/estudo/02-fontes-de-atividade.md` | Claude Code, Codex e MCP: de onde tirar a atividade e como proteger a privacidade |
| `docs/estudo/03-referencias.md` | projetos parecidos e o que aproveitar deles |
| `docs/estudo/04-stack-e-celular.md` | motor 2D, pixel art no celular antigo, rede local e bateria |
| `docs/estudo/05-direcoes-de-arte.md` | a direção de arte em pixel art e o histórico da rodada 3D |
| `docs/conceitos/direcoes-de-arte.html` | prancha da rodada 3D (histórico) |
| `docs/local/` | contexto pessoal e da máquina, fora do Git |

## Como rodar

Node 24 e `npm install` na raiz. Depois:

| Comando | O que faz |
|---|---|
| `npm run dev:mundo` | o mundo em `http://127.0.0.1:4781/` e os protótipos em `http://127.0.0.1:4781/prototipos` |
| `npm run simular` | o servidor com o simulador; depuração em `http://127.0.0.1:4780/depurar` |
| `npm run servidor -- --config <arquivo>` | o servidor com as fontes reais, só leitura |
| `npm run doctor -- --config <arquivo>` | explica em português o estado de cada fonte |
| `npm test`, `npm run typecheck`, `npm run checar:escrita` | as verificações |

## Como começar

Abra uma sessão do Claude Code nesta pasta e mande:

```
Leia AGENTS.md e docs/proxima-sessao.md e siga o roteiro.
```
