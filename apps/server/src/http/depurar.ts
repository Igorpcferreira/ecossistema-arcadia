// Página simples de depuração: texto ao vivo com alas, salas, agentes, fila, delegações, obras, métricas e os
// últimos eventos. Lê o mesmo snapshot e o mesmo SSE do mundo (só dados saneados) e escreve só com textContent.

export const HTML_DEPURAR = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arcadia: depuração</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #d6deeb; font: 14px/1.45 ui-monospace, Consolas, monospace; }
  header { padding: 12px 16px; border-bottom: 1px solid #263040; }
  h1 { margin: 0; font-size: 16px; }
  #status { color: #8aa0b8; margin-top: 4px; }
  pre { margin: 0; padding: 12px 16px 32px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<header><h1>Arcadia, página de depuração (só dados saneados)</h1><div id="status">conectando...</div></header>
<pre id="saida"></pre>
<script src="/depurar.js"></script>
</body>
</html>
`;

export const JS_DEPURAR = `'use strict';
(function () {
  var saida = document.getElementById('saida');
  var status = document.getElementById('status');
  var estado = null;
  var seq = 0;
  var buildInicial = null;
  var fonte = null;
  var ultimoSinal = 0;
  var ultimos = [];
  var sujo = true;

  function n(x) { return Number(x || 0).toLocaleString('pt-BR'); }
  function ha(t) {
    if (!t) return 'nunca';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'há ' + s + ' s';
    if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
    return 'há ' + Math.round(s / 3600) + ' h';
  }
  function hora(t) { var d = new Date(t); return d.toLocaleTimeString('pt-BR', { hour12: false }); }
  function nomeAgente(a) {
    if (!a) return '?';
    if (a.nome) return a.nome;
    var sufixo = String(a.chave).slice(-4);
    if (a.tipo === 'subagente') return 'Subagente ' + sufixo;
    return 'Sessão ' + a.motor + ' ' + sufixo;
  }
  function nomeSala(chave) { var s = estado && estado.salas[chave]; return s ? s.nome : (chave ? '(sala ' + chave + ')' : 'sem sala'); }
  function nomeAla(id) { var a = estado && estado.alas[id]; return a ? a.nome : id; }

  function aplicar(m) {
    switch (m.k) {
      case 'agente': estado.agentes[m.agente.chave] = m.agente; break;
      case 'agente.saiu': delete estado.agentes[m.chave]; break;
      case 'sala': estado.salas[m.sala.chave] = m.sala; break;
      case 'ala': estado.alas[m.ala.id] = m.ala; break;
      case 'delegacao': estado.delegacoes[m.delegacao.chave] = m.delegacao; break;
      case 'delegacao.fim': delete estado.delegacoes[m.chave]; break;
      case 'precisaDeVoce': estado.precisaDeVoce = m.itens; break;
      case 'metricas': estado.metricas = m.metricas; break;
      case 'saude': estado.saude = m.saude; break;
      case 'obra': estado.obras = estado.obras.filter(function (o) { return o.salaChave !== m.obra.salaChave; }).concat([m.obra]); break;
      case 'obra.fim': estado.obras = estado.obras.filter(function (o) { return o.salaChave !== m.salaChave; }); break;
      case 'evento': ultimos.unshift(m.evento); if (ultimos.length > 15) ultimos.length = 15; break;
    }
  }

  function desenhar() {
    if (!estado) return;
    var l = [];
    var alas = Object.values(estado.alas).sort(function (a, b) { return a.ordem - b.ordem; });
    var salas = Object.values(estado.salas);
    var agentes = Object.values(estado.agentes);
    l.push('ALAS (' + alas.length + ')');
    alas.forEach(function (a) {
      var qtd = salas.filter(function (s) { return s.alaId === a.id; }).length;
      l.push('  [' + a.ordem + '] ' + a.nome + (a.tipo === 'recepcao' ? ' (recepção)' : '') + ', lote ' + a.lote.col + ',' + a.lote.lin + ', ' + qtd + (qtd === 1 ? ' sala' : ' salas') + (a.ativa ? '' : ', fora da configuração'));
    });
    l.push('');
    l.push('SALAS (' + salas.length + ')');
    salas.sort(function (a, b) { return (estado.alas[a.alaId] ? estado.alas[a.alaId].ordem : 0) - (estado.alas[b.alaId] ? estado.alas[b.alaId].ordem : 0) || a.terreno.indice - b.terreno.indice; });
    salas.forEach(function (s) {
      var aqui = agentes.filter(function (a) { return a.salaChave === s.chave; }).length;
      l.push('  [' + nomeAla(s.alaId) + '] ' + s.nome + ', terreno ' + s.terreno.indice + ' (' + s.terreno.col + ',' + s.terreno.lin + '), ' + s.tipo + ', ' + aqui + (aqui === 1 ? ' agente' : ' agentes') + ', ' + n(s.entregasHoje) + ' entregas e ' + n(s.errosHoje) + ' erros hoje' + (s.dormindo ? ', dormindo' : ''));
    });
    l.push('');
    l.push('AGENTES (' + agentes.length + ')');
    agentes.sort(function (a, b) { return nomeAgente(a).localeCompare(nomeAgente(b)); });
    agentes.forEach(function (a) {
      var extra = [];
      if (a.cargo) extra.push(a.cargo);
      if (a.cor) extra.push(a.cor);
      if (a.equipe) extra.push(a.equipe);
      var linha = '  ' + nomeAgente(a) + ' (' + a.tipo + ', ' + a.motor + (extra.length ? ', ' + extra.join(', ') : '') + '): ' + a.estado + ' ' + ha(a.desde) + ' em ' + nomeSala(a.salaChave);
      if (a.ferramenta) linha += '; ferramenta ' + a.ferramenta.nome + ' (' + a.ferramenta.categoria + (a.ferramenta.alvo ? ', ' + a.ferramenta.alvo : '') + ')';
      if (a.espera) linha += '; espera: ' + a.espera.tipo;
      if (a.tarefa) linha += '; tarefa: ' + a.tarefa;
      if (a.paiChave) linha += '; pai: ' + nomeAgente(estado.agentes[a.paiChave]);
      l.push(linha);
    });
    l.push('');
    l.push('PRECISA DE VOCÊ (' + estado.precisaDeVoce.length + ')');
    estado.precisaDeVoce.forEach(function (i) { l.push('  ' + nomeAgente(estado.agentes[i.agenteChave]) + ': ' + i.tipo + ' ' + ha(i.desde) + ' em ' + nomeSala(i.salaChave)); });
    var dels = Object.values(estado.delegacoes);
    l.push('');
    l.push('DELEGAÇÕES EM VOO (' + dels.length + ')');
    dels.forEach(function (d) { l.push('  ' + nomeAgente(estado.agentes[d.de]) + ' para ' + nomeAgente(estado.agentes[d.para]) + (d.titulo ? ': ' + d.titulo : '') + ' (' + (d.status || '?') + ', ' + ha(d.desde) + ')'); });
    l.push('');
    l.push('OBRAS (' + estado.obras.length + ')');
    estado.obras.forEach(function (o) { l.push('  ' + nomeSala(o.salaChave) + ' em ' + nomeAla(o.alaId) + ', termina em ' + Math.max(0, Math.round((o.fim - Date.now()) / 1000)) + ' s'); });
    var m = estado.metricas;
    l.push('');
    l.push('MÉTRICAS DE ' + m.dia);
    l.push('  ' + n(m.entregas) + ' entregas, ' + n(m.erros) + ' erros, ' + n(m.ferramentas) + ' ferramentas, ' + n(m.turnos) + ' turnos, ' + n(m.pedidos) + ' pedidos, ' + n(m.delegacoes) + ' delegações, ' + n(m.esperas) + ' esperas');
    l.push('  tokens: ' + n(m.tokens.entrada) + ' de entrada, ' + n(m.tokens.saida) + ' de saída, ' + n(m.tokens.cache) + ' em cache; custo informado pela fonte (US$ ' + Number(m.custoUsd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ')');
    l.push('  agentes ativos hoje: ' + n(m.agentes) + '; salas ativas hoje: ' + n(m.salas));
    l.push('');
    l.push('FONTES');
    Object.keys(estado.saude.fontes).forEach(function (k) {
      var f = estado.saude.fontes[k];
      l.push('  ' + k + ': ' + f.estado + ', ' + n(f.eventos) + ' eventos, último ' + ha(f.ultimoEvento) + (f.mensagem ? ', ' + f.mensagem : ''));
    });
    l.push('');
    l.push('ÚLTIMOS EVENTOS');
    ultimos.forEach(function (e) {
      var det = [];
      if (e.ferramenta) det.push(e.ferramenta.categoria + ', ' + e.ferramenta.nome);
      if (e.espera) det.push(e.espera.tipo);
      if (e.delegacao) det.push('para ' + nomeAgente(estado.agentes[e.delegacao.para]));
      l.push('  ' + hora(e.ts) + ' ' + nomeAgente(estado.agentes[e.agente.chave] || { chave: e.agente.chave, tipo: e.agente.tipo, motor: e.motor }) + ' ' + e.tipo + (det.length ? ' (' + det.join('; ') + ')' : ''));
    });
    saida.textContent = l.join('\\n');
  }

  function mostrarStatus(texto) { status.textContent = texto; }

  function conectar() {
    if (fonte) fonte.close();
    fonte = new EventSource('/api/events?desde=' + seq);
    fonte.addEventListener('ola', function (ev) {
      var o = JSON.parse(ev.data);
      if (buildInicial === null) buildInicial = o.buildId;
      else if (o.buildId !== buildInicial) { location.reload(); return; }
      ultimoSinal = Date.now();
    });
    fonte.addEventListener('mundo', function (ev) {
      var q = JSON.parse(ev.data);
      if (q.seq <= seq) return;
      q.mudancas.forEach(aplicar);
      seq = q.seq;
      ultimoSinal = Date.now();
      sujo = true;
    });
    fonte.addEventListener('ping', function () { ultimoSinal = Date.now(); });
    fonte.addEventListener('resync', function () { carregar(); });
    fonte.onerror = function () { mostrarStatus('sem conexão; tentando de novo...'); };
  }

  function carregar() {
    fetch('/api/snapshot').then(function (r) { return r.json(); }).then(function (s) {
      estado = s.estado;
      seq = s.seq;
      if (buildInicial === null) buildInicial = s.buildId;
      ultimoSinal = Date.now();
      sujo = true;
      conectar();
    }).catch(function () { mostrarStatus('não consegui ler o snapshot; tentando de novo em 3 s'); setTimeout(carregar, 3000); });
  }

  setInterval(function () {
    if (estado) mostrarStatus('ao vivo: seq ' + seq + ', build ' + buildInicial + ', último sinal ' + ha(ultimoSinal));
    if (sujo || estado) { desenhar(); sujo = false; }
  }, 1000);
  carregar();
})();
`;
