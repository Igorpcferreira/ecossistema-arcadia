// Planta de exemplo do repositório: um andar genérico com a mesma forma e a mesma riqueza
// da prancha aprovada. Nomes de alas, equipes e pessoas aqui são inventados; o andar real
// entra por um cenário local (docs/local/fase1/cenario-local.json) carregado em tempo de execução.
import type { Planta } from './formato.ts';

export const PLANTA_EXEMPLO: Planta = {
  versao: 1,
  nome: 'Andar de exemplo',
  colunas: [10, 10, 10, 8],
  linhas: [11, 10, 11],
  corredor: 2,
  parede: 74,
  lotes: [
    { zona: 'servidores', nome: 'SERVIDORES', titulo: 'Sala dos servidores', tipo: 'area', tema: 'servidores', cor: '#6fd3ff', col: 0, lin: 0, texto: 'Racks que piscam mais forte quando o trabalho aperta. Um drone faz a manutenção.' },
    { zona: 'alfa', nome: 'EQUIPE ALFA', titulo: 'Equipe Alfa', tipo: 'ala', tema: 'equipe', cor: '#ff6b5a', col: 1, lin: 0, texto: 'Uma equipe de bots: coordenação, design, desenvolvimento, QA e crítica, com quadro de portões, vitrine holográfica e as cápsulas de recarga onde os bots esperam por trabalho.' },
    { zona: 'agencia', nome: 'AGÊNCIA', titulo: 'Agência', tipo: 'ala', tema: 'agencia', cor: '#4f8cff', col: 2, lin: 0, texto: 'Sites de clientes na parede, quadro de wireframes e mesas de desenvolvimento.' },
    { zona: 'video', nome: 'VÍDEO', titulo: 'Estúdio de vídeo', tipo: 'ala', tema: 'estudio', cor: '#ffb347', col: 3, lin: 0, dormindo: true, texto: 'Tela verde, câmera, ring light e ilha de edição. A luz ON AIR acende quando um vídeo renderiza.' },
    { zona: 'empresa', nome: 'EMPRESA', titulo: 'Empresa', tipo: 'ala', tema: 'corporativo', cor: '#a9b3d6', col: 0, lin: 1, dormindo: true, texto: 'Baias corporativas, mais sóbrias, para os projetos do emprego.' },
    { zona: 'nucleo', nome: 'NÚCLEO', titulo: 'Núcleo', tipo: 'area', tema: 'nucleo', cor: '#3ee0ff', col: 1, lin: 1, texto: 'O coração do andar: o holograma recebe as entregas e os pulsos de dados de todas as alas.' },
    { zona: 'saude', nome: 'SAÚDE · ACADEMIA', titulo: 'Saúde e academia', tipo: 'ala', tema: 'academia', cor: '#3fd28b', col: 2, lin: 1, dormindo: true, texto: 'Academia completa com palco de poses. Os agentes vêm aqui nas pausas curtas entre tarefas, e você também.' },
    { zona: 'lounge', nome: 'LOUNGE', titulo: 'Lounge e café', tipo: 'area', tema: 'lounge', cor: '#ff8fd0', col: 3, lin: 1, texto: 'Café, máquina de whey, fliperamas e pufes para as pausas.' },
    { zona: 'recepcao', nome: 'RECEPÇÃO', titulo: 'Recepção', tipo: 'area', tema: 'recepcao', cor: '#ffe08a', col: 0, lin: 2, texto: 'Teletransporte por onde as sessões chegam e saem. Projeto sem ala espera aqui.' },
    { zona: 'produtos', nome: 'PRODUTOS', titulo: 'Produtos próprios', tipo: 'ala', tema: 'produtos', cor: '#c9a7ff', col: 1, lin: 2, dormindo: true, salas: ['ALFA', 'BETA', 'GAMA', 'DELTA', 'ÔMEGA'], texto: 'Cápsulas dos produtos, dormindo quando ninguém mexe, e o terreno onde nasce a próxima sala.' },
    { zona: 'cockpit', nome: 'COCKPIT', titulo: 'Cockpit', tipo: 'area', tema: 'cockpit', cor: '#f2b45a', col: 2, lin: 2, cols: 2, texto: 'A mesa de comando ao lado da mesa da parceria, aquário, troféus, saco de pancada e o celular na doca mostrando o próprio Arcadia.' },
  ],
  personagens: [
    { id: 'coord', nome: 'Coordenador Alfa', curto: 'Coordenador', cargo: 'Coordena a equipe de bots', tipo: 'agente', papel: 'coordenador', aparencia: 'coord', zona: 'alfa', equipe: 'alfa', motor: 'claude', tarefas: [['pensando', 'Planejando a demanda nova'], ['lendo', 'Lendo o relatório do QA'], ['comando', 'Conferindo o git status']] },
    { id: 'design', nome: 'Design Alfa', curto: 'Design', cargo: 'Direção de design', tipo: 'agente', papel: 'agente', aparencia: 'design', zona: 'alfa', equipe: 'alfa', motor: 'claude', tarefas: [['lendo', 'Pesquisando referências de cabeçalho'], ['editando', 'Escrevendo a especificação da capa'], ['pensando', 'Comparando as direções A e B']] },
    { id: 'dev', nome: 'Dev Alfa', curto: 'Dev', cargo: 'Implementação', tipo: 'agente', papel: 'agente', aparencia: 'dev', zona: 'alfa', equipe: 'alfa', motor: 'claude', tarefas: [['editando', 'Editando src/pagina/capa.tsx'], ['comando', 'Rodando npm run build'], ['editando', 'Ajustando o cabeçalho de vidro']] },
    { id: 'qa', nome: 'QA Alfa', curto: 'QA', cargo: 'Validação com evidência', tipo: 'agente', papel: 'agente', aparencia: 'qa', zona: 'alfa', equipe: 'alfa', motor: 'claude', tarefas: [['comando', 'Rodando a auditoria no celular'], ['lendo', 'Lendo as capturas em 390 px'], ['comando', 'Medindo o contraste']] },
    { id: 'critico', nome: 'Crítico Alfa', curto: 'Crítico', cargo: 'Revisão independente', tipo: 'agente', papel: 'agente', aparencia: 'critico', zona: 'alfa', equipe: 'alfa', motor: 'claude', dormindo: true, tarefas: [['lendo', 'Revisando a direção (G1)'], ['pensando', 'Conferindo a lista de não repetir'], ['lendo', 'Revisando as capturas (G3)']] },
    { id: 'claudeAgencia', nome: 'Claude na Agência', curto: 'Claude', cargo: 'Sessão do Claude Code no editor', tipo: 'agente', papel: 'agente', aparencia: 'claude', zona: 'agencia', motor: 'claude', tarefas: [['editando', 'Corrigindo a rota de contatos'], ['comando', 'Rodando os testes do servidor'], ['lendo', 'Lendo o AGENTS.md']] },
    { id: 'codexSaude', nome: 'Codex na Saúde', curto: 'Codex', cargo: 'Sessão do Codex no terminal', tipo: 'agente', papel: 'agente', aparencia: 'codex', zona: 'saude', motor: 'codex', tarefas: [['editando', 'Refatorando a tela de treinos'], ['comando', 'Gerando os testes do app'], ['lendo', 'Lendo o README']] },
    { id: 'claudeEmpresa', nome: 'Claude na Empresa', curto: 'Claude', cargo: 'Sessão do Claude Code no trabalho', tipo: 'agente', papel: 'agente', aparencia: 'claudeGravata', zona: 'empresa', motor: 'claude', tarefas: [['editando', 'Ajustando o endpoint de filtros'], ['comando', 'Rodando os testes de integração'], ['lendo', 'Lendo a tela legada']] },
    { id: 'claudeVideo', nome: 'Claude no Vídeo', curto: 'Claude', cargo: 'Pipeline de vídeo', tipo: 'agente', papel: 'agente', aparencia: 'claudeFone', zona: 'video', motor: 'claude', tarefas: [['comando', 'Renderizando o vídeo 041'], ['editando', 'Ajustando as legendas'], ['lendo', 'Conferindo a narração']] },
    { id: 'dono', nome: 'Pessoa no comando', curto: 'Você', cargo: 'Você, no comando', tipo: 'humano', papel: 'dono', aparencia: 'humanoDono', zona: 'cockpit', tarefaInicial: 'Acompanhando o Arcadia' },
    { id: 'fixo', nome: 'Parceria', curto: 'Parceria', cargo: 'Sempre no Cockpit, trabalhando', tipo: 'humano', papel: 'fixo', aparencia: 'humanoFixo', zona: 'cockpit', tarefaInicial: 'Trabalhando' },
    { id: 'recepcionista', nome: 'Recepcionista', curto: 'Recepção', cargo: 'Androide da recepção', tipo: 'npc', papel: 'recepcionista', aparencia: 'recepcao', zona: 'recepcao', tarefaInicial: 'Recebendo as sessões' },
    { id: 'visitante', nome: 'Codex visitante', curto: 'Codex', cargo: 'Sessão avulsa do Codex', tipo: 'agente', papel: 'visitante', aparencia: 'visitante', zona: 'recepcao', motor: 'codex', visivel: false, tarefas: [['lendo', 'Lendo o projeto'], ['editando', 'Ajustando um script'], ['comando', 'Rodando a checagem']] },
  ],
  aparencias: {
    coord: { tipo: 'androide', papel: '#8a5cff', acessorio: 'headset', maoFeita: 'coordenador' },
    design: { tipo: 'androide', papel: '#ff5fa8', acessorio: 'boina', maoFeita: 'design' },
    dev: { tipo: 'androide', papel: '#3f8cff', acessorio: 'fone', maoFeita: 'dev' },
    qa: { tipo: 'androide', papel: '#ff9a3c', acessorio: 'lupa' },
    critico: { tipo: 'androide', papel: '#22c4b0', acessorio: 'monoculo' },
    claude: { tipo: 'androide', papel: '#e0704f', acessorio: 'brilho', maoFeita: 'claude' },
    claudeGravata: { tipo: 'androide', papel: '#e0704f', acessorio: 'gravata', maoFeita: 'claude' },
    claudeFone: { tipo: 'androide', papel: '#e0704f', acessorio: 'fone', maoFeita: 'claude' },
    codex: { tipo: 'androide', papel: '#cfd3ea', casco: '#2f3448', visor: '#030409', olho: '#ffffff', acessorio: 'nenhum', maoFeita: 'codex' },
    visitante: { tipo: 'androide', papel: '#cfd3ea', casco: '#2f3448', visor: '#030409', olho: '#ffffff', acessorio: 'nenhum', maoFeita: 'codex' },
    recepcao: { tipo: 'androide', papel: '#e8b93c', acessorio: 'gravatinha' },
    npcTreinador: { tipo: 'androide', papel: '#3fd28b', acessorio: 'capacete' },
    npcBarista: { tipo: 'androide', papel: '#a8744a', acessorio: 'gravatinha' },
    npcLimpeza: { tipo: 'robo', cor: '#d6dbe6', detalhe: '#3ee0ff' },
    gato: { tipo: 'gato', cor: '#e08a3c', detalhe: '#f6e2c8' },
    // humanos genéricos de reserva (o pacote de personagens troca estes)
    humanoDono: {
      tipo: 'humano', pele: '#d9a27c', peleSombra: '#b9825e', cabelo: { estilo: 'curto', cor: '#2b2420', luz: '#4a3c33', sombra: '#16110e' },
      roupa: '#2f5f9a', roupaSombra: '#234a78', detalhe: '#e8eef8', mangas: 'longas', calca: '#2b2e3b', sapato: '#ecebf2', sola: '#aeb2c3', relogio: '#1b1d29',
    },
    humanoFixo: {
      tipo: 'humano', pele: '#8d5a3b', peleSombra: '#6f442a', cabelo: { estilo: 'coque', cor: '#1d1614', luz: '#3a2b25', sombra: '#0e0a09' },
      roupa: '#2f7a5a', roupaSombra: '#225c43', detalhe: '#f2d36b', mangas: 'curtas', calca: '#3a3340', sapato: '#2a2328', batom: '#a8404c',
    },
  },
  textos: {
    pedidos: ['deixar o cabeçalho mais compacto', 'trocar a foto da capa', 'revisar a busca no celular', 'preparar o vídeo 041', 'corrigir o formulário de contato', 'subir a prévia no celular'],
    delegacoes: ['implementar a capa aprovada', 'validar o portão G2', 'revisar as capturas do G3', 'fechar a direção da busca'],
    erro: 'O build saiu com código 1',
    erroTicker: 'viu o build falhar',
    entrega: 'Relatório da etapa entregue',
    esperando: 'Precisa da sua aprovação',
    subagente: 'Abriu um subagente para pesquisar',
    visitante: { chegada: 'Nova sessão do Codex', tarefas: [['lendo', 'Lendo o projeto'], ['editando', 'Ajustando um script'], ['comando', 'Rodando a checagem']] },
    obra: {
      nome: 'Sala nova', salaNome: 'NOVA',
      agente: { nome: 'Claude na sala nova', curto: 'Claude', cargo: 'Sessão que nasceu com a sala nova', aparencia: 'claude', tarefas: [['editando', 'Montando a primeira tela'], ['comando', 'Rodando o simulador'], ['pensando', 'Desenhando a próxima sala']] },
    },
  },
  roteiro: ['cockpit', 'alfa', 'saude', 'nucleo', 'agencia', 'lounge', 'video', 'servidores', 'produtos', 'empresa', 'recepcao'],
  // duas alas acordadas (a equipe de bots e a Agência), o resto em espera; aos 6 s uma sessão
  // abre no Vídeo (a ala acorda e o aquário vai junto) e aos 12 s o Crítico sai da cápsula
  ocio: { pausaMinutos: 3, dormeMinutos: 20 },
  agenda: [
    { t: 6, acao: 'abrirSessao', quem: 'claudeVideo' },
    { t: 12, acao: 'delegar', quem: 'critico' },
  ],
};
