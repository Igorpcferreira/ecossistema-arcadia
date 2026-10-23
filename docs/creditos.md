# Créditos e licenças

Tudo o que entra no Arcadia de terceiros fica registrado aqui: o que é, de quem, a licença, onde é usado e quando entrou. Regra: só CC0, MIT, Apache-2.0 e OFL (fontes). Pacote pago que proíbe redistribuir arquivos não entra no repositório. As dependências npm não são copiadas para o repositório: ficam declaradas nos `package.json`, com versão exata.

## Dependências do projeto (instaladas em 22/10/2026)

| Pacote | Versão | Licença | Onde | Autor |
|---|---|---|---|---|
| pixi.js | 8.22.0 | MIT | `apps/world`: motor 2D do mundo (ADR 0001) | Mathew Groves, Chad Engler e colaboradores |
| vite | 8.3.4 | MIT | `apps/world`: servidor de desenvolvimento e build | Evan You e colaboradores |
| @fontsource/silkscreen | 5.3.0 | SIL OFL 1.1 | `apps/world`: títulos, botões e rótulos do HUD | fonte de Jason Kottke |
| @fontsource/vt323 | 5.3.0 | SIL OFL 1.1 | `apps/world`: balões, faixa de eventos e números | fonte de Peter Hull |
| @fontsource/atkinson-hyperlegible | 5.3.0 | SIL OFL 1.1 | `apps/world`: texto corrido | fonte do Braille Institute of America |
| hono | 4.13.13 | MIT | `apps/server`: HTTP e SSE | Yusuke Wada e colaboradores |
| @hono/node-server | 2.1.4 | MIT | `apps/server`: adaptador do Hono para o Node | Yusuke Wada e colaboradores |
| chokidar | 5.0.0 | MIT | `apps/server`: acompanhar transcrições e rollouts | Paul Miller e colaboradores |
| js-yaml | 5.4.3 | MIT | `apps/server`: ler o arquivo de configuração | Vitaly Puzrin e colaboradores |
| zod | 4.6.5 | MIT | `packages/shared`: esquema do evento canônico | Colin McDonnell e colaboradores |
| typescript | 7.0.2 | Apache-2.0 | checagem de tipos (desenvolvimento) | Microsoft |
| @types/node | 24.19.1 | MIT | tipos do Node (desenvolvimento) | DefinitelyTyped |

## Arte

Toda a arte do mundo (ladrilhos, paredes, mobília, androides, drones, humanos genéricos, letreiros e a fonte bitmap 3 por 5 com acentos) é original e gerada por código. Nenhum pacote de pixel art de terceiros foi usado. Os personagens pessoais do dono da máquina ficam num pacote local, fora do repositório.

## Ferramentas de desenvolvimento (não distribuídas)

| Item | Licença | Uso |
|---|---|---|
| Playwright | Apache-2.0 | Capturas e medição de fps no Chromium headless (instalação da máquina, fora do projeto) |

## Referências estudadas (nenhum código ou arte copiado)

Os projetos parecidos e o que se aprendeu com cada um estão em `docs/estudo/03-referencias.md`. Ficam fora por licença, mesmo como base: o painel do disler (sem licença), o Agents Office (PolyForm Noncommercial) e a arte do Star Office UI (não comercial).
