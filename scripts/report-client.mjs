// The script of report/index.html (DESIGN.md §25), kept as a real function so it is readable and
// linted; report.mjs embeds `(${client})()` into the page. It runs with no network, reads the
// data embedded in #kss-data, and builds every element with textContent: report text is
// model-written and quotes the repository, so none of it ever becomes markup.

export function client() {
  var M = JSON.parse(document.getElementById('kss-data').textContent)
  var SVG = 'http://www.w3.org/2000/svg'
  var T = {
    en: { overview: 'Overview', built: 'What was built', decisions: 'All decisions', phase: 'Phase', did: 'What was done', dec: 'Decisions', why: 'Why', rejected: 'Rejected', source: 'Source', open: 'Open items', risks: 'Risks', artifacts: 'Artifacts', highlights: 'Highlights', next: 'Next', state: 'State', size: 'Size', cost: 'Cost', agents: 'agents', turns: 'turns', tokens: 'tokens', min: 'min', search: 'Search decisions…', all: 'All', none: 'No decisions recorded in this phase.', notyet: 'Not run yet.', gen: 'Generated', phases: 'phases', theme: 'Theme', noreport: 'No report yet — phases add theirs as they finish.', copy: 'Copy', copied: 'Copied', more: 'Show all', less: 'Show less', before: 'Before', after: 'After', unified: 'Diff', prev: 'Previous', nextStep: 'Next', play: 'Play', step: 'Step', input: 'Input', output: 'Result', files: 'files', clickNode: 'Click a box to see what it does and what it talks to.', clickMsg: 'Click a message, or play the whole flow.', nothingBuilt: 'No implementation sections yet — execute adds them.' },
    pt: { overview: 'Visão geral', built: 'O que foi implementado', decisions: 'Todas as decisões', phase: 'Fase', did: 'O que foi feito', dec: 'Decisões', why: 'Por quê', rejected: 'Descartado', source: 'Fonte', open: 'Pendências', risks: 'Riscos', artifacts: 'Artefatos', highlights: 'Destaques', next: 'Próximo', state: 'Estado', size: 'Tamanho', cost: 'Custo', agents: 'agentes', turns: 'turnos', tokens: 'tokens', min: 'min', search: 'Buscar decisões…', all: 'Todas', none: 'Nenhuma decisão registrada nesta fase.', notyet: 'Ainda não executada.', gen: 'Gerado em', phases: 'fases', theme: 'Tema', noreport: 'Sem relatório ainda — cada fase adiciona o seu ao terminar.', copy: 'Copiar', copied: 'Copiado', more: 'Ver tudo', less: 'Ver menos', before: 'Antes', after: 'Depois', unified: 'Diff', prev: 'Anterior', nextStep: 'Próximo', play: 'Reproduzir', step: 'Passo', input: 'Entrada', output: 'Resultado', files: 'arquivos', clickNode: 'Clique numa caixa para ver o que ela faz e com quem conversa.', clickMsg: 'Clique numa mensagem, ou reproduza o fluxo inteiro.', nothingBuilt: 'Ainda sem seções de implementação — o execute as adiciona.' },
    es: { overview: 'Resumen', built: 'Qué se implementó', decisions: 'Todas las decisiones', phase: 'Fase', did: 'Qué se hizo', dec: 'Decisiones', why: 'Por qué', rejected: 'Descartado', source: 'Fuente', open: 'Pendientes', risks: 'Riesgos', artifacts: 'Artefactos', highlights: 'Destacados', next: 'Siguiente', state: 'Estado', size: 'Tamaño', cost: 'Costo', agents: 'agentes', turns: 'turnos', tokens: 'tokens', min: 'min', search: 'Buscar decisiones…', all: 'Todas', none: 'No hay decisiones registradas en esta fase.', notyet: 'Aún no ejecutada.', gen: 'Generado', phases: 'fases', theme: 'Tema', noreport: 'Aún no hay informe — cada fase añade el suyo al terminar.', copy: 'Copiar', copied: 'Copiado', more: 'Ver todo', less: 'Ver menos', before: 'Antes', after: 'Después', unified: 'Diff', prev: 'Anterior', nextStep: 'Siguiente', play: 'Reproducir', step: 'Paso', input: 'Entrada', output: 'Resultado', files: 'archivos', clickNode: 'Haz clic en una caja para ver qué hace y con quién habla.', clickMsg: 'Haz clic en un mensaje, o reproduce todo el flujo.', nothingBuilt: 'Aún sin secciones de implementación — execute las añade.' },
  }
  // The living feature's labels (§25.1); English fills any key a language lacks.
  var TF = {
    en: { feature: 'Feature', problem: 'Problem', outcome: 'Outcome', actors: 'Who', inScope: 'In scope', outOfScope: 'Out of scope', updatedBy: 'updated by', progress: 'Progress', requirements: 'requirements', reqDone: 'done', tickets: 'tickets', integrated: 'integrated', ticketGraph: 'Tickets by dependency, colored by state', planned: 'planned', building: 'building', done: 'done', dropped: 'dropped', rules: 'Rules', ruleCode: 'Where this rule lives in the code', notCoded: 'Not in the code yet — execute quotes it here.', modeled: 'Simulated in', simulators: 'Simulators', machines: 'State machines', architecture: 'Architecture', code: 'Code', decisionsNow: 'Decisions now', changed: 'changed', changedOnly: 'Changed', now: 'now', whatChanged: 'What changed', removed: 'removed', inputs: 'Inputs', result: 'Result', derived: 'Derived', fired: 'Fired', noRule: 'No rule applies to these inputs', holds: 'true', fails: 'false', scenarios: 'Scenarios from the spec', custom: 'Your scenarios', scenarioName: 'Name this scenario', note: 'Note (optional)', expected: 'Expected', expectedHint: 'expected (optional)', save: 'Save current inputs', load: 'Load', remove: 'Delete', send: 'Send to agent', sent: 'Sent', noCustom: 'None yet — set the inputs above, name them and save. Edge cases the spec missed belong here.', memoryOnly: 'Saved only while this page is open (storage unavailable).', error: 'Error', yes: 'yes', no: 'no', reset: 'Reset', path: 'Path', events: 'Events from here', finalState: 'No event leaves this state.', guard: 'if', current: 'Current', sendCurrent: 'Send these inputs', whyFired: 'Each rule’s condition for these inputs:', noFeature: 'No feature model yet.' },
    pt: { feature: 'Funcionalidade', problem: 'Problema', outcome: 'Resultado esperado', actors: 'Quem', inScope: 'No escopo', outOfScope: 'Fora do escopo', updatedBy: 'atualizado por', progress: 'Progresso', requirements: 'requisitos', reqDone: 'prontos', tickets: 'tickets', integrated: 'integrados', ticketGraph: 'Tickets por dependência, coloridos pelo estado', planned: 'planejado', building: 'em construção', done: 'pronto', dropped: 'descartado', rules: 'Regras', ruleCode: 'Onde esta regra vive no código', notCoded: 'Ainda não está no código — o execute a cita aqui.', modeled: 'Simulada em', simulators: 'Simuladores', machines: 'Máquinas de estado', architecture: 'Arquitetura', code: 'Código', decisionsNow: 'Decisões atuais', changed: 'mudou', changedOnly: 'Mudaram', now: 'agora', whatChanged: 'O que mudou', removed: 'removido', inputs: 'Entradas', result: 'Resultado', derived: 'Derivados', fired: 'Disparou', noRule: 'Nenhuma regra se aplica a estas entradas', holds: 'verdadeira', fails: 'falsa', scenarios: 'Cenários da spec', custom: 'Seus cenários', scenarioName: 'Nome do cenário', note: 'Nota (opcional)', expected: 'Esperado', expectedHint: 'esperado (opcional)', save: 'Salvar entradas atuais', load: 'Carregar', remove: 'Apagar', send: 'Enviar ao agente', sent: 'Enviado', noCustom: 'Nenhum ainda — ajuste as entradas acima, dê um nome e salve. Casos de borda que a spec não cobriu ficam aqui.', memoryOnly: 'Salvo só enquanto a página estiver aberta (armazenamento indisponível).', error: 'Erro', yes: 'sim', no: 'não', reset: 'Reiniciar', path: 'Caminho', events: 'Eventos a partir daqui', finalState: 'Nenhum evento sai deste estado.', guard: 'se', current: 'Atual', sendCurrent: 'Enviar estas entradas', whyFired: 'A condição de cada regra para estas entradas:', noFeature: 'Ainda sem modelo da funcionalidade.' },
    es: { feature: 'Funcionalidad', problem: 'Problema', outcome: 'Resultado esperado', actors: 'Quién', inScope: 'En alcance', outOfScope: 'Fuera de alcance', updatedBy: 'actualizado por', progress: 'Progreso', requirements: 'requisitos', reqDone: 'listos', tickets: 'tickets', integrated: 'integrados', ticketGraph: 'Tickets por dependencia, coloreados por estado', planned: 'planificado', building: 'en construcción', done: 'listo', dropped: 'descartado', rules: 'Reglas', ruleCode: 'Dónde vive esta regla en el código', notCoded: 'Aún no está en el código — execute la cita aquí.', modeled: 'Simulada en', simulators: 'Simuladores', machines: 'Máquinas de estado', architecture: 'Arquitectura', code: 'Código', decisionsNow: 'Decisiones actuales', changed: 'cambió', changedOnly: 'Cambiaron', now: 'ahora', whatChanged: 'Qué cambió', removed: 'eliminado', inputs: 'Entradas', result: 'Resultado', derived: 'Derivados', fired: 'Se aplicó', noRule: 'Ninguna regla aplica a estas entradas', holds: 'verdadera', fails: 'falsa', scenarios: 'Escenarios de la spec', custom: 'Tus escenarios', scenarioName: 'Nombre del escenario', note: 'Nota (opcional)', expected: 'Esperado', expectedHint: 'esperado (opcional)', save: 'Guardar entradas actuales', load: 'Cargar', remove: 'Borrar', send: 'Enviar al agente', sent: 'Enviado', noCustom: 'Ninguno aún — ajusta las entradas, nómbralas y guarda. Aquí van los casos borde que la spec no cubrió.', memoryOnly: 'Guardado solo mientras la página esté abierta (almacenamiento no disponible).', error: 'Error', yes: 'sí', no: 'no', reset: 'Reiniciar', path: 'Camino', events: 'Eventos desde aquí', finalState: 'Ningún evento sale de este estado.', guard: 'si', current: 'Actual', sendCurrent: 'Enviar estas entradas', whyFired: 'La condición de cada regla para estas entradas:', noFeature: 'Aún sin modelo de la funcionalidad.' },
  }
  var code2 = String(M.lang || 'en').slice(0, 2).toLowerCase()
  var L = Object.assign({}, T.en, TF.en, T[code2] || {}, TF[code2] || {})
  var byPhase = {}
  M.reports.forEach(function (r) { byPhase[r.phase] = r })
  var app = document.getElementById('app')

  // ── DOM helpers ────────────────────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = String(text)
    return e
  }
  function add(p) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i])
    return p
  }
  function svg(tag, attrs, text) {
    var e = document.createElementNS(SVG, tag)
    for (var k in attrs) e.setAttribute(k, String(attrs[k]))
    if (text != null) e.textContent = String(text)
    return e
  }
  function button(cls, text, onClick) {
    var b = el('button', cls, text)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }
  function human(n) {
    if (!n) return '0'
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
    return String(n)
  }
  function costLine(c) {
    if (!c) return null
    var s = [c.agents + ' ' + L.agents, c.turns + ' ' + L.turns, human(c.tokens) + ' ' + L.tokens]
    if (c.minutes != null) s.push(c.minutes + ' ' + L.min)
    if (c.harnesses && c.harnesses.length) s.push(c.harnesses.join(' + '))
    return s.join(' · ')
  }

  // ── Inline markdown: `code`, **bold**, *em* — as nodes, never HTML ──────────────────────────
  function inline(parent, text) {
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g
    var last = 0
    var m
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)))
      var t = m[0]
      if (t[0] === '`') parent.appendChild(el('code', null, t.slice(1, -1)))
      else if (t.slice(0, 2) === '**') parent.appendChild(el('strong', null, t.slice(2, -2)))
      else parent.appendChild(el('em', null, t.slice(1, -1)))
      last = m.index + t.length
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
    return parent
  }
  function prose(text) {
    var box = el('div', 'prose')
    String(text || '').split(/\n{2,}/).forEach(function (block) {
      var lines = block.split('\n')
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l) })) {
        var ul = el('ul')
        lines.forEach(function (l) { ul.appendChild(inline(el('li'), l.replace(/^\s*[-*]\s+/, ''))) })
        box.appendChild(ul)
      } else if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l) })) {
        var ol = el('ol')
        lines.forEach(function (l) { ol.appendChild(inline(el('li'), l.replace(/^\s*\d+[.)]\s+/, ''))) })
        box.appendChild(ol)
      } else if (/^#{1,4}\s/.test(lines[0])) {
        box.appendChild(inline(el('h4'), lines[0].replace(/^#+\s*/, '')))
        if (lines.length > 1) box.appendChild(inline(el('p'), lines.slice(1).join(' ')))
      } else {
        box.appendChild(inline(el('p'), lines.join(' ')))
      }
    })
    return box
  }

  // ── Code: a small tokenizer for the usual languages, spans by class ─────────────────────────
  var KW = /^(?:abstract|as|async|await|break|case|catch|class|const|continue|def|default|defer|delete|do|elif|else|enum|except|export|extends|false|final|finally|fn|for|from|func|function|go|if|implements|import|in|instanceof|interface|is|lambda|let|match|module|new|nil|None|not|null|of|or|and|package|pass|private|protected|pub|public|raise|readonly|return|self|static|struct|super|switch|this|throw|throws|true|True|False|try|type|typeof|undefined|use|var|void|where|while|with|yield|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|ALTER|INDEX|JOIN|LEFT|ON|AND|OR|NOT|NULL|PRIMARY|KEY|REFERENCES|INTO|VALUES|SET|message|service|rpc|returns|repeated|optional)$/
  function highlight(line, lang) {
    var frag = document.createDocumentFragment()
    var hash = /^(py|python|sh|bash|shell|yaml|yml|toml|rb|ruby|rego|dockerfile|make)$/i.test(lang || '')
    var re = /(\/\/.*$|#.*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.]*\b|\b[A-Za-z_$][\w$]*\b|@[\w.]+)/g
    var last = 0
    var m
    while ((m = re.exec(line))) {
      var t = m[0]
      if (t[0] === '#' && !hash) {
        // `#` is a comment only in hash-comment languages; elsewhere keep scanning after it.
        frag.appendChild(document.createTextNode(line.slice(last, m.index + 1)))
        last = m.index + 1
        re.lastIndex = m.index + 1
        continue
      }
      if (m.index > last) frag.appendChild(document.createTextNode(line.slice(last, m.index)))
      var cls = /^(\/\/|#|\/\*)/.test(t) ? 'c' : /^["'`]/.test(t) ? 's' : /^\d/.test(t) ? 'n' : t[0] === '@' ? 'd' : KW.test(t) ? 'k' : /^[A-Z]/.test(t) ? 't' : line.charAt(m.index + t.length) === '(' ? 'f' : null
      frag.appendChild(cls ? el('span', 'tk-' + cls, t) : document.createTextNode(t))
      last = m.index + t.length
    }
    if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)))
    return frag
  }
  function copyButton(getText) {
    var b = button('mini', L.copy, function () {
      var text = getText()
      var done = function () { b.textContent = L.copied; setTimeout(function () { b.textContent = L.copy }, 1200) }
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback)
        else fallback()
      } catch (e) { fallback() }
      function fallback() {
        var ta = el('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy'); done() } catch (e) { /* the text stays selectable */ }
        ta.remove()
      }
    })
    return b
  }
  function codeBlock(s) {
    var box = el('figure', 'code')
    var head = el('figcaption')
    if (s.file) head.appendChild(el('code', 'file', s.file + (s.line ? ':' + s.line : '')))
    if (s.lang) head.appendChild(el('span', 'lang', s.lang))
    head.appendChild(el('span', 'grow'))
    head.appendChild(copyButton(function () { return s.code }))
    box.appendChild(head)
    var lines = String(s.code).replace(/\n$/, '').split('\n')
    var marks = {}
    ;(s.highlight || []).forEach(function (n) { marks[n] = true })
    var pre = el('pre')
    var start = s.line || 1
    // report.mjs records each line's real number (null for an elision); without it, count from `line`.
    var nums = Array.isArray(s.lines) && s.lines.length === lines.length ? s.lines : null
    var prev = start - 1
    lines.forEach(function (l, i) {
      var n = nums ? nums[i] : start + i
      var gap = nums && n === null
      var row = el('div', 'ln' + (n != null && marks[n] ? ' hl' : '') + (gap ? ' gap' : ''))
      row.appendChild(el('span', 'no', gap ? '⋮' : n == null ? '' : String(n)))
      row.appendChild(add(el('span', 'tx'), gap ? document.createTextNode('') : highlight(l, s.lang)))
      if (gap) row.title = String(l).trim()
      pre.appendChild(row)
      if (n != null) prev = n
    })
    var long = lines.length > 24
    if (long) pre.classList.add('folded')
    box.appendChild(pre)
    if (long) {
      var t = button('mini more', L.more, function () {
        var folded = pre.classList.toggle('folded')
        t.textContent = folded ? L.more : L.less
      })
      box.appendChild(t)
    }
    if (s.explain) box.appendChild(add(el('div', 'explain'), prose(s.explain)))
    return box
  }
  function diffBlock(s) {
    var box = el('figure', 'code diff')
    var head = el('figcaption')
    if (s.file) head.appendChild(el('code', 'file', s.file))
    head.appendChild(el('span', 'grow'))
    var body = el('div')
    var modes = []
    if (s.before != null || s.after != null) modes.push(['before', L.before], ['after', L.after])
    if (s.diff) modes.unshift(['diff', L.unified])
    function show(mode) {
      body.textContent = ''
      modes.forEach(function (m, i) { tabs[i].classList.toggle('on', m[0] === mode) })
      var pre = el('pre')
      var text = mode === 'diff' ? s.diff : mode === 'before' ? s.before : s.after
      String(text || '').replace(/\n$/, '').split('\n').forEach(function (l) {
        var cls = mode !== 'diff' ? '' : l[0] === '+' && l.slice(0, 3) !== '+++' ? ' add' : l[0] === '-' && l.slice(0, 3) !== '---' ? ' del' : l.slice(0, 2) === '@@' ? ' hunk' : ''
        var row = el('div', 'ln' + cls)
        row.appendChild(add(el('span', 'tx'), mode === 'diff' ? document.createTextNode(l) : highlight(l, s.lang)))
        pre.appendChild(row)
      })
      body.appendChild(pre)
    }
    var tabs = modes.map(function (m) { return button('mini', m[1], function () { show(m[0]) }) })
    tabs.forEach(function (t) { head.appendChild(t) })
    add(box, head, body)
    if (modes.length) show(modes[0][0])
    if (s.explain) box.appendChild(add(el('div', 'explain'), prose(s.explain)))
    return box
  }

  // ── Flow diagram: layered left-to-right layout, click a node to see it and its links ────────
  var PALETTE = ['#f58a2e', '#6fa8dc', '#8fcf6f', '#c792ea', '#e8c547', '#6cc4c4', '#ef6461', '#b4b8bf']
  function wrap(text, width) {
    var words = String(text).split(/\s+/)
    var lines = ['']
    words.forEach(function (w) {
      var cur = lines[lines.length - 1]
      if ((cur + ' ' + w).trim().length > width && cur) lines.push(w)
      else lines[lines.length - 1] = (cur + ' ' + w).trim()
    })
    return lines.slice(0, 3)
  }
  // A node may carry a `tone` (the ticket graph colors tickets by state); otherwise its group's color.
  var TONES = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', accent: 'var(--accent)', dim: 'var(--dim)' }
  function toneOf(n, groups) {
    if (n && TONES[n.tone]) return TONES[n.tone]
    return PALETTE[Math.max(0, groups.indexOf(n && n.group)) % PALETTE.length]
  }
  function flowBlock(s) {
    var box = el('figure', 'diagram')
    var nodes = s.nodes || []
    var edges = (s.edges || []).filter(function (e) { return e && e.from && e.to })
    var ids = {}
    nodes.forEach(function (n, i) { ids[n.id] = i })
    var level = {}
    function depth(id, seen) {
      if (level[id] != null) return level[id]
      if (seen[id]) return 0
      seen[id] = true
      var d = 0
      edges.forEach(function (e) { if (e.to === id && ids[e.from] != null && e.from !== id) d = Math.max(d, depth(e.from, seen) + 1) })
      level[id] = d
      return d
    }
    nodes.forEach(function (n) { depth(n.id, {}) })
    var cols = []
    nodes.forEach(function (n) { (cols[level[n.id]] = cols[level[n.id]] || []).push(n) })
    var groups = []
    nodes.forEach(function (n) { if (n.group && groups.indexOf(n.group) < 0) groups.push(n.group) })
    var W = 170, H = 58, GX = 70, GY = 22, P = 16
    var pos = {}
    var maxRows = 0
    cols.forEach(function (c) { maxRows = Math.max(maxRows, c ? c.length : 0) })
    var height = P * 2 + maxRows * H + (maxRows - 1) * GY
    cols.forEach(function (c, ci) {
      if (!c) return
      var colH = c.length * H + (c.length - 1) * GY
      c.forEach(function (n, ri) { pos[n.id] = { x: P + ci * (W + GX), y: P + (height - P * 2 - colH) / 2 + ri * (H + GY) } })
    })
    var width = P * 2 + cols.length * W + (cols.length - 1) * GX
    var s2 = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, class: 'flow' })
    var defs = svg('defs')
    var mk = svg('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrowhead' }))
    defs.appendChild(mk)
    s2.appendChild(defs)
    var edgeEls = []
    edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to]
      if (!a || !b) return
      var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2
      if (b.x <= a.x) { x1 = a.x + W / 2; y1 = a.y + H; x2 = b.x + W / 2; y2 = b.y + H }
      var mx = (x1 + x2) / 2
      var d = b.x <= a.x ? 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + 40) + ' ' + x2 + ' ' + (y2 + 40) + ' ' + x2 + ' ' + y2 : 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2
      var g = svg('g', { class: 'edge' })
      g.appendChild(svg('path', { d: d, 'marker-end': 'url(#arr)' }))
      if (e.label) {
        var lx = (x1 + x2) / 2, ly = (y1 + y2) / 2 - 6
        g.appendChild(svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'edgelabel' }, e.label))
      }
      s2.appendChild(g)
      edgeEls.push({ e: e, g: g })
    })
    var info = el('div', 'dinfo', L.clickNode)
    var nodeEls = {}
    nodes.forEach(function (n) {
      var p = pos[n.id]
      if (!p) return
      var color = toneOf(n, groups)
      var g = svg('g', { class: 'node' + (n.changed ? ' changed' : ''), transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0 })
      g.appendChild(svg('rect', { width: W, height: H, rx: 8, style: 'stroke:' + color }))
      g.appendChild(svg('rect', { width: 5, height: H, rx: 2, style: 'fill:' + color, class: 'band' }))
      var lines = wrap(n.label || n.id, 22)
      lines.forEach(function (l, i) {
        g.appendChild(svg('text', { x: W / 2 + 2, y: H / 2 + (i - (lines.length - 1) / 2) * 14 + 4, 'text-anchor': 'middle', class: i === 0 ? 'nlabel' : 'nlabel sub' }, l))
      })
      if (n.changed) g.appendChild(svg('circle', { cx: W - 9, cy: 9, r: 4, class: 'dot' }))
      function pick() {
        Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.toggle('on', k === n.id) })
        edgeEls.forEach(function (x) { x.g.classList.toggle('on', x.e.from === n.id || x.e.to === n.id) })
        info.textContent = ''
        add(info, el('b', null, n.label || n.id))
        if (n.group) info.appendChild(el('span', 'tag', n.group))
        if (n.detail) info.appendChild(prose(n.detail))
        var links = edgeEls.filter(function (x) { return x.e.from === n.id || x.e.to === n.id })
        if (links.length) {
          var ul = el('ul', 'links')
          links.forEach(function (x) {
            var other = x.e.from === n.id ? x.e.to : x.e.from
            var on = nodes[ids[other]]
            ul.appendChild(el('li', null, (x.e.from === n.id ? '→ ' : '← ') + (on ? on.label || on.id : other) + (x.e.label ? ' — ' + x.e.label : '')))
          })
          info.appendChild(ul)
        }
      }
      g.addEventListener('click', pick)
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') pick() })
      nodeEls[n.id] = g
      s2.appendChild(g)
    })
    var scroll = el('div', 'dscroll')
    scroll.appendChild(s2)
    add(box, scroll, info)
    if (groups.length > 1) {
      var legend = el('div', 'legend')
      groups.forEach(function (gname, i) {
        var it = el('span', 'lg')
        var sw = el('i')
        var first = nodes.filter(function (n) { return n.group === gname })[0]
        sw.style.background = toneOf(first, groups)
        add(it, sw, document.createTextNode(gname))
        legend.appendChild(it)
      })
      box.appendChild(legend)
    }
    return box
  }

  // ── Sequence diagram: lifelines and messages; click one, or play them in order ──────────────
  function sequenceBlock(s) {
    var box = el('figure', 'diagram')
    var parts = s.participants || []
    var msgs = (s.messages || []).filter(function (m) { return m && m.from && m.to })
    var CW = 170, TOP = 44, ROW = 46, P = 16
    var x = {}
    parts.forEach(function (p, i) { x[p] = P + CW / 2 + i * CW })
    var width = P * 2 + parts.length * CW
    var height = TOP + msgs.length * ROW + 30
    var s2 = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, class: 'seq' })
    var defs = svg('defs')
    var mk = svg('marker', { id: 'sarr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrowhead' }))
    defs.appendChild(mk)
    s2.appendChild(defs)
    parts.forEach(function (p) {
      s2.appendChild(svg('line', { x1: x[p], y1: TOP, x2: x[p], y2: height - 8, class: 'life' }))
      var g = svg('g', { class: 'part' })
      g.appendChild(svg('rect', { x: x[p] - CW / 2 + 8, y: 6, width: CW - 16, height: 28, rx: 6 }))
      g.appendChild(svg('text', { x: x[p], y: 24, 'text-anchor': 'middle' }, wrap(p, 20)[0]))
      s2.appendChild(g)
    })
    var info = el('div', 'dinfo', L.clickMsg)
    var rows = []
    msgs.forEach(function (m, i) {
      var y = TOP + 26 + i * ROW
      var a = x[m.from], b = x[m.to]
      if (a == null || b == null) return
      var g = svg('g', { class: 'msg' + (m.kind === 'reply' ? ' reply' : '') + (m.kind === 'error' ? ' error' : ''), tabindex: 0 })
      if (a === b) g.appendChild(svg('path', { d: 'M' + a + ' ' + (y - 8) + ' h34 v16 h-34', 'marker-end': 'url(#sarr)' }))
      else g.appendChild(svg('line', { x1: a, y1: y, x2: b + (b > a ? -2 : 2), y2: y, 'marker-end': 'url(#sarr)' }))
      g.appendChild(svg('rect', { x: Math.min(a, b) - 4, y: y - 22, width: Math.max(Math.abs(b - a), 40) + 8, height: 30, class: 'hit' }))
      g.appendChild(svg('text', { x: a === b ? a + 40 : (a + b) / 2, y: y - 7, 'text-anchor': a === b ? 'start' : 'middle', class: 'mlabel' }, (i + 1) + '. ' + m.text))
      function pick() {
        rows.forEach(function (r, j) { r.classList.toggle('on', j === i); r.classList.toggle('past', j < i) })
        info.textContent = ''
        add(info, el('b', null, (i + 1) + '. ' + m.from + ' → ' + m.to), el('div', null, m.text))
        if (m.detail) info.appendChild(prose(m.detail))
      }
      g.addEventListener('click', pick)
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') pick() })
      g.pick = pick
      rows.push(g)
      s2.appendChild(g)
    })
    var bar = el('div', 'dbar')
    var timer = null
    var at = -1
    bar.appendChild(button('mini', '▶ ' + L.play, function () {
      if (timer) clearInterval(timer)
      at = -1
      timer = setInterval(function () {
        at++
        if (at >= rows.length) { clearInterval(timer); timer = null; return }
        rows[at].pick()
      }, 1300)
    }))
    bar.appendChild(button('mini', '‹ ' + L.prev, function () { if (at > 0) rows[--at].pick() }))
    bar.appendChild(button('mini', L.nextStep + ' ›', function () { if (at < rows.length - 1) rows[++at].pick() }))
    var scroll = el('div', 'dscroll')
    scroll.appendChild(s2)
    add(box, bar, scroll, info)
    return box
  }

  // ── Example: cases as tabs, each a sequence of steps with input and result ──────────────────
  function exampleBlock(s) {
    var box = el('figure', 'example')
    var cases = s.cases && s.cases.length ? s.cases : [{ name: s.title || '', steps: s.steps || [] }]
    var tabs = el('div', 'etabs')
    var body = el('div', 'ebody')
    function showCase(ci) {
      Array.prototype.forEach.call(tabs.children, function (t, i) { t.classList.toggle('on', i === ci) })
      var steps = cases[ci].steps || []
      var at = 0
      function showStep() {
        body.textContent = ''
        var dots = el('div', 'edots')
        steps.forEach(function (st, i) {
          dots.appendChild(button('edot' + (i === at ? ' on' : i < at ? ' past' : ''), String(i + 1), function () { at = i; showStep() }))
        })
        var st = steps[at] || {}
        var card = el('div', 'estep')
        add(card, el('div', 'elabel', L.step + ' ' + (at + 1) + '/' + steps.length), inline(el('div', 'etitle'), st.label || ''))
        if (st.input) add(card, el('div', 'ehead', L.input), codeLike(st.input, st.lang))
        if (st.output) add(card, el('div', 'ehead', L.output), codeLike(st.output, st.lang))
        if (st.note) card.appendChild(prose(st.note))
        var nav = el('div', 'enav')
        var p = button('mini', '‹ ' + L.prev, function () { if (at > 0) { at--; showStep() } })
        var n = button('mini', L.nextStep + ' ›', function () { if (at < steps.length - 1) { at++; showStep() } })
        p.disabled = at === 0
        n.disabled = at >= steps.length - 1
        add(nav, p, n)
        add(body, dots, card, nav)
      }
      showStep()
    }
    function codeLike(text, lang) {
      var pre = el('pre', 'io')
      String(text).replace(/\n$/, '').split('\n').forEach(function (l) { pre.appendChild(add(el('div'), highlight(l, lang))) })
      return pre
    }
    if (cases.length > 1) cases.forEach(function (c, i) { tabs.appendChild(button('chip', c.name, function () { showCase(i) })) })
    add(box, tabs, body)
    showCase(0)
    return box
  }

  function tableBlock(s) {
    var wrapEl = el('div', 'tscroll')
    var t = el('table')
    var head = el('tr')
    ;(s.columns || []).forEach(function (c) { head.appendChild(el('th', null, c)) })
    add(t, add(el('thead'), head))
    var tb = el('tbody')
    ;(s.rows || []).forEach(function (r) {
      var tr = el('tr')
      ;(r || []).forEach(function (c) { tr.appendChild(inline(el('td'), String(c))) })
      tb.appendChild(tr)
    })
    t.appendChild(tb)
    wrapEl.appendChild(t)
    return wrapEl
  }

  function filesBlock(s) {
    var box = el('div', 'files')
    var groups = {}
    var order = []
    ;(s.items || []).forEach(function (f) {
      var path = String(f.path)
      var dir = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '.'
      if (!groups[dir]) { groups[dir] = []; order.push(dir) }
      groups[dir].push(f)
    })
    var total = { a: 0, d: 0 }
    ;(s.items || []).forEach(function (f) { total.a += f.added || 0; total.d += f.deleted || 0 })
    box.appendChild(el('div', 'ftotal', (s.items || []).length + ' ' + L.files + ' · +' + total.a + ' −' + total.d))
    order.forEach(function (dir) {
      var d = el('details', 'fdir')
      d.open = order.length <= 6
      d.appendChild(el('summary', null, dir + '/  (' + groups[dir].length + ')'))
      groups[dir].forEach(function (f) {
        var row = el('div', 'frow')
        add(row, el('span', 'fch ' + (f.change || 'modified'), (f.change || 'modified').slice(0, 1).toUpperCase()), el('code', null, String(f.path).slice(dir.length + 1) || f.path))
        if (f.added || f.deleted) row.appendChild(el('span', 'fnum', '+' + (f.added || 0) + ' −' + (f.deleted || 0)))
        if (f.what) row.appendChild(inline(el('span', 'fwhat'), f.what))
        d.appendChild(row)
      })
      box.appendChild(d)
    })
    return box
  }

  function section(s) {
    var wrapEl = el('section', 'block block-' + s.type)
    if (s.title) wrapEl.appendChild(el('h3', 'btitle', s.title))
    if (s.intro) wrapEl.appendChild(prose(s.intro))
    var body =
      s.type === 'text' ? prose(s.body)
      : s.type === 'callout' ? add(el('div', 'callout ' + (s.tone || 'info')), prose(s.body))
      : s.type === 'code' ? codeBlock(s)
      : s.type === 'diff' ? diffBlock(s)
      : s.type === 'flow' ? flowBlock(s)
      : s.type === 'sequence' ? sequenceBlock(s)
      : s.type === 'example' ? exampleBlock(s)
      : s.type === 'table' ? tableBlock(s)
      : s.type === 'files' ? filesBlock(s)
      : s.type === 'states' ? statesBlock(s)
      : s.type === 'simulator' ? simulatorBlock(s)
      : null
    if (body) wrapEl.appendChild(body)
    return wrapEl
  }

  // ── State machine: walk it — the current state lit, its events as buttons, the path so far ───
  function statesBlock(s) {
    var box = el('figure', 'diagram machine')
    var states = s.states || []
    var trans = (s.transitions || []).filter(function (t) { return t && t.from && t.to })
    var byId = {}
    states.forEach(function (st) { byId[st.id] = st })
    // Columns by distance from the initial state; unreachable states go last.
    var level = {}
    var queue = [s.initial]
    level[s.initial] = 0
    while (queue.length) {
      var cur = queue.shift()
      trans.forEach(function (t) { if (t.from === cur && level[t.to] == null) { level[t.to] = level[cur] + 1; queue.push(t.to) } })
    }
    var maxL = 0
    Object.keys(level).forEach(function (k) { maxL = Math.max(maxL, level[k]) })
    states.forEach(function (st) { if (level[st.id] == null) level[st.id] = maxL + 1 })
    var cols = []
    states.forEach(function (st) { (cols[level[st.id]] = cols[level[st.id]] || []).push(st) })
    cols = cols.filter(Boolean)
    var W = 150, H = 46, GX = 110, GY = 40, PX = 34, TOP = 40, BOTTOM = 70
    var maxRows = 0
    cols.forEach(function (c) { maxRows = Math.max(maxRows, c.length) })
    var inner = maxRows * H + (maxRows - 1) * GY
    var height = TOP + inner + BOTTOM
    var width = PX * 2 + cols.length * W + (cols.length - 1) * GX
    var pos = {}
    cols.forEach(function (c, ci) {
      var colH = c.length * H + (c.length - 1) * GY
      c.forEach(function (st, ri) { pos[st.id] = { x: PX + ci * (W + GX), y: TOP + (inner - colH) / 2 + ri * (H + GY), c: ci } })
    })
    var s2 = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, class: 'fsm' })
    var defs = svg('defs')
    var mk = svg('marker', { id: 'farr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrowhead' }))
    defs.appendChild(mk)
    s2.appendChild(defs)
    var pairCount = {}
    var below = 0
    var edgeEls = trans.map(function (t) {
      var a = pos[t.from], b = pos[t.to]
      var g = svg('g', { class: 'edge tr' })
      if (!a || !b) return g
      var key = t.from + '>' + t.to
      var k = pairCount[key] = (pairCount[key] || 0) + 1
      var d, lx, ly
      if (t.from === t.to) {
        var cx = a.x + W / 2
        d = 'M' + (cx - 14) + ' ' + a.y + ' C' + (cx - 30) + ' ' + (a.y - 36) + ' ' + (cx + 30) + ' ' + (a.y - 36) + ' ' + (cx + 14) + ' ' + a.y
        lx = cx; ly = a.y - 32 - (k - 1) * 13
      } else if (b.c > a.c) {
        var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2
        d = 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2
        lx = mx; ly = (y1 + y2) / 2 - 7 - (k - 1) * 13
      } else {
        // Backwards or within a column: an arc under the boxes, deeper for each one.
        below++
        var depth = 26 + below * 12
        var bx1 = a.x + W / 2 + 10, by1 = a.y + H, bx2 = b.x + W / 2 - 10, by2 = b.y + H
        var low = Math.max(by1, by2) + depth
        d = 'M' + bx1 + ' ' + by1 + ' C' + bx1 + ' ' + low + ' ' + bx2 + ' ' + low + ' ' + bx2 + ' ' + by2
        lx = (bx1 + bx2) / 2; ly = low - 4
      }
      g.appendChild(svg('path', { d: d, 'marker-end': 'url(#farr)' }))
      g.appendChild(svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'edgelabel' }, t.event + (t.guard ? ' [' + t.guard.slice(0, 24) + (t.guard.length > 24 ? '…' : '') + ']' : '')))
      s2.appendChild(g)
      return g
    })
    var nodeEls = {}
    states.forEach(function (st) {
      var p = pos[st.id]
      var g = svg('g', { class: 'node st', transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0 })
      g.appendChild(svg('rect', { width: W, height: H, rx: 22 }))
      wrap(st.label || st.id, 20).slice(0, 2).forEach(function (l, i, arr) {
        g.appendChild(svg('text', { x: W / 2, y: H / 2 + (i - (arr.length - 1) / 2) * 14 + 4, 'text-anchor': 'middle', class: 'nlabel' }, l))
      })
      g.addEventListener('click', function () { show(st.id) })
      nodeEls[st.id] = g
      s2.appendChild(g)
    })
    if (pos[s.initial]) {
      var ip = pos[s.initial]
      s2.appendChild(svg('circle', { cx: ip.x - 22, cy: ip.y + H / 2, r: 6, class: 'init' }))
      s2.appendChild(svg('path', { d: 'M' + (ip.x - 16) + ' ' + (ip.y + H / 2) + ' H' + (ip.x - 2), class: 'initline', 'marker-end': 'url(#farr)' }))
    }
    var bar = el('div', 'dbar')
    var events = el('div', 'fsm-events')
    var info = el('div', 'dinfo')
    var path = [s.initial]
    var steps = []
    var lastEdge = -1
    function show(id) {
      info.textContent = ''
      var st = byId[id]
      if (!st) return
      add(info, el('b', null, st.label || st.id))
      if (st.detail) info.appendChild(prose(st.detail))
    }
    function paint() {
      var at = path[path.length - 1]
      Object.keys(nodeEls).forEach(function (k) {
        nodeEls[k].classList.toggle('on', k === at)
        nodeEls[k].classList.toggle('seen', k !== at && path.indexOf(k) >= 0)
      })
      edgeEls.forEach(function (g, i) { g.classList.toggle('on', i === lastEdge) })
      events.textContent = ''
      events.appendChild(el('span', 'lbl', L.events))
      var out = trans.map(function (t, i) { return { t: t, i: i } }).filter(function (x) { return x.t.from === at })
      if (!out.length) events.appendChild(el('span', 'empty', L.finalState))
      out.forEach(function (x) {
        var b = button('evt', '', function () {
          path.push(x.t.to)
          steps.push(x.t)
          lastEdge = x.i
          paint()
        })
        add(b, el('b', null, x.t.event), el('span', 'to', '→ ' + ((byId[x.t.to] || {}).label || x.t.to)))
        if (x.t.guard) b.appendChild(el('span', 'guard', L.guard + ' ' + x.t.guard))
        if (x.t.fr && x.t.fr.length) b.appendChild(el('span', 'fr', x.t.fr.join(' ')))
        events.appendChild(b)
      })
      walked.textContent = ''
      walked.appendChild(el('span', 'lbl', L.path))
      path.forEach(function (id, i) {
        if (i) walked.appendChild(el('span', 'ev', steps[i - 1].event))
        walked.appendChild(el('span', 'crumb' + (i === path.length - 1 ? ' on' : ''), (byId[id] || {}).label || id))
      })
      show(at)
    }
    var walked = el('div', 'fsm-path')
    bar.appendChild(button('mini', '↺ ' + L.reset, function () { path = [s.initial]; steps = []; lastEdge = -1; paint() }))
    bar.appendChild(button('mini', '‹ ' + L.prev, function () {
      if (path.length < 2) return
      path.pop()
      steps.pop()
      lastEdge = steps.length ? trans.indexOf(steps[steps.length - 1]) : -1
      paint()
    }))
    var scroll = el('div', 'dscroll')
    scroll.appendChild(s2)
    add(box, bar, scroll, events, walked, info)
    paint()
    return box
  }

  // ── Simulator: the rule as a form — type values, see which rule fires and why ──────────────
  var X = window.kssExpr || null
  function fmtValue(v, o) {
    if (v === null || v === undefined || v === '') return '—'
    var f = (o && o.format) || (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text')
    var unit = o && o.unit ? o.unit : ''
    try {
      if (typeof v === 'boolean' || f === 'boolean') return v === true ? '✓ ' + L.yes : v === false ? '✗ ' + L.no : String(v)
      if (typeof v === 'number' && f === 'money') return (unit ? unit + ' ' : '') + v.toLocaleString(M.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      if (typeof v === 'number' && f === 'percent') return (v * 100).toLocaleString(M.lang, { maximumFractionDigits: 2 }) + '%'
      if (typeof v === 'number') return v.toLocaleString(M.lang, { maximumFractionDigits: 6 }) + (unit ? ' ' + unit : '')
    } catch (e) { /* an unknown locale falls back to plain text */ }
    return String(v) + (unit && f !== 'text' ? ' ' + unit : '')
  }
  /** A value typed as an expectation, read the way the output is formatted. */
  function parseExpected(raw, o) {
    var t = String(raw).trim()
    if (!t) return undefined
    var f = o.format || 'text'
    if (f === 'boolean') return /^(true|yes|sim|sí|si|1|✓)$/i.test(t)
    if (f === 'number' || f === 'money' || f === 'percent') {
      var n = Number(t.replace(/%$/, '').replace(/\s/g, '').replace(',', '.'))
      if (n !== n) return t
      return f === 'percent' && /%$/.test(t) ? n / 100 : n
    }
    return t
  }
  function storage(key) {
    var memory = null
    return {
      read: function () {
        if (memory) return memory
        try {
          var v = JSON.parse(window.localStorage.getItem(key) || '[]')
          return Array.isArray(v) ? v : []
        } catch (e) { memory = memory || []; return memory }
      },
      write: function (list) {
        try { window.localStorage.setItem(key, JSON.stringify(list)); return true } catch (e) { memory = list; return false }
      },
      volatile: function () { return !!memory },
    }
  }
  function simulatorBlock(s) {
    var box = el('div', 'sim')
    if (!X) return add(box, el('p', 'empty', '—'))
    var outById = {}
    ;(s.outputs || []).forEach(function (o) { outById[o.id] = o })
    var ruleById = {}
    ;(s.rules || []).forEach(function (r) { ruleById[r.id] = r })
    var values = {}
    var controls = {}
    ;(s.inputs || []).forEach(function (i) { values[i.id] = i.default })

    // Inputs
    var form = el('div', 'sim-form')
    form.appendChild(el('div', 'sim-h', L.inputs))
    ;(s.inputs || []).forEach(function (i) {
      var row = el('label', 'sim-in')
      var head = el('span', 'sim-lbl', i.label || i.id)
      row.appendChild(head)
      var c
      if (i.type === 'boolean') {
        c = el('input')
        c.type = 'checkbox'
        c.addEventListener('change', function () { values[i.id] = c.checked; update() })
      } else if (i.type === 'enum') {
        c = el('select')
        ;(i.options || []).forEach(function (o, k) { var op = el('option', null, String(o)); op.value = String(k); c.appendChild(op) })
        c.addEventListener('change', function () { values[i.id] = (i.options || [])[Number(c.value)]; update() })
      } else {
        c = el('input')
        c.type = i.type === 'number' ? 'number' : i.type === 'date' ? 'date' : i.type === 'time' ? 'time' : 'text'
        if (i.type === 'number') {
          c.step = 'any'
          if (i.min != null) c.min = String(i.min)
          if (i.max != null) c.max = String(i.max)
        }
        c.addEventListener('input', function () {
          values[i.id] = i.type === 'number' ? (c.value === '' ? null : Number(c.value)) : c.value
          update()
        })
      }
      var line = el('span', 'sim-ctl')
      add(line, c)
      if (i.unit) line.appendChild(el('span', 'unit', i.unit))
      if (i.type === 'number' && (i.min != null || i.max != null)) line.appendChild(el('span', 'range', (i.min != null ? i.min : '…') + ' – ' + (i.max != null ? i.max : '…')))
      row.appendChild(line)
      controls[i.id] = { c: c, i: i }
      form.appendChild(row)
    })
    function setControls() {
      Object.keys(controls).forEach(function (k) {
        var x = controls[k]
        var v = values[k]
        if (x.i.type === 'boolean') x.c.checked = v === true
        else if (x.i.type === 'enum') x.c.value = String(Math.max(0, (x.i.options || []).indexOf(v)))
        else x.c.value = v == null ? '' : String(v)
      })
    }
    function load(inputs) {
      ;(s.inputs || []).forEach(function (i) { values[i.id] = inputs && Object.prototype.hasOwnProperty.call(inputs, i.id) ? inputs[i.id] : i.default })
      setControls()
      update()
    }

    // Result
    var result = el('div', 'sim-result')
    var firedEl = el('div', 'sim-fired')
    var outsEl = el('div', 'sim-outs')
    var outCells = {}
    ;(s.outputs || []).forEach(function (o) {
      var cell = el('div', 'sim-out')
      var v = el('div', 'v')
      add(cell, el('div', 'k', o.label || o.id), v)
      outCells[o.id] = { cell: cell, v: v, last: undefined }
      outsEl.appendChild(cell)
    })
    var derivedEl = el('div', 'sim-derived')
    var errorsEl = el('div', 'sim-errors')
    add(result, el('div', 'sim-h', L.result), firedEl, outsEl, derivedEl, errorsEl)

    // Every rule with its condition, live
    var rulesEl = el('div', 'sim-rules')
    var ruleRows = {}
    rulesEl.appendChild(el('div', 'sim-h', L.whyFired))
    ;(s.rules || []).forEach(function (r) {
      var row = el('div', 'sim-rule')
      var mark = el('span', 'mark')
      var body = el('div', 'rb')
      var head = el('div', 'rh')
      add(head, el('b', null, r.id))
      if (r.label) head.appendChild(document.createTextNode(' ' + r.label))
      if (r.rule) head.appendChild(ruleChip(r.rule))
      ;(r.fr || []).forEach(function (fr) { head.appendChild(el('span', 'tag', fr)) })
      var when = el('code', 'when', r.when)
      var then = el('div', 'then')
      Object.keys(r.then || {}).forEach(function (k) {
        then.appendChild(add(el('span', 'assign'), el('span', 'k', (outById[k] && outById[k].label) || k), document.createTextNode(' ← '), el('code', null, typeof r.then[k] === 'string' ? r.then[k] : JSON.stringify(r.then[k]))))
      })
      add(body, head, when, then)
      add(row, mark, body)
      ruleRows[r.id] = { row: row, mark: mark }
      rulesEl.appendChild(row)
    })

    function update() {
      var r = X.simulate(s, values)
      firedEl.textContent = ''
      if (r.fired.length) {
        firedEl.className = 'sim-fired yes'
        firedEl.appendChild(el('span', 'lbl', L.fired))
        r.fired.forEach(function (id) {
          var rule = ruleById[id] || {}
          var chip = el('span', 'firedchip', id + (rule.label ? ' — ' + rule.label : ''))
          firedEl.appendChild(chip)
          if (rule.rule) firedEl.appendChild(ruleChip(rule.rule))
        })
      } else {
        firedEl.className = 'sim-fired no'
        firedEl.textContent = L.noRule
      }
      Object.keys(outCells).forEach(function (k) {
        var cell = outCells[k]
        var txt = fmtValue(r.outputs[k], outById[k])
        if (cell.last !== undefined && cell.last !== txt) {
          cell.cell.classList.remove('flash')
          void cell.cell.offsetWidth
          cell.cell.classList.add('flash')
        }
        cell.last = txt
        cell.v.textContent = txt
      })
      derivedEl.textContent = ''
      ;(s.derive || []).forEach(function (d) {
        derivedEl.appendChild(add(el('span', 'dv'), el('span', 'k', d.label || d.id), el('b', null, fmtValue(r.derived[d.id]))))
      })
      errorsEl.textContent = r.errors.length ? L.error + ': ' + r.errors.join(' · ') : ''
      r.conditions.forEach(function (c) {
        var x = ruleRows[c.id]
        if (!x) return
        var fired = r.fired.indexOf(c.id) >= 0
        x.row.className = 'sim-rule' + (fired ? ' fired' : c.error ? ' err' : c.value ? ' true' : ' false')
        x.mark.textContent = c.error ? '!' : c.value ? '✓' : '✗'
        x.mark.title = c.error || (c.value ? L.holds : L.fails)
      })
      return r
    }

    // Scenarios: the spec's, and the user's own
    function describe(sc, r) {
      var lines = [s.title + ' (' + s.id + ') — ' + M.feature, (sc.name ? 'Scenario: ' + sc.name : 'Scenario: ' + L.current)]
      lines.push('Inputs: ' + Object.keys(r.inputs).map(function (k) { return k + ' = ' + JSON.stringify(r.inputs[k]) }).join(', '))
      lines.push('Result: ' + Object.keys(r.outputs).map(function (k) { return k + ' = ' + JSON.stringify(r.outputs[k]) }).join(', '))
      lines.push('Rules fired: ' + (r.fired.length ? r.fired.map(function (id) { var x = ruleById[id]; return id + (x && x.rule ? ' (' + x.rule + ')' : '') }).join(', ') : 'none'))
      if (sc.expect && Object.keys(sc.expect).length) lines.push('Expected: ' + Object.keys(sc.expect).map(function (k) { return k + ' = ' + JSON.stringify(sc.expect[k]) + (X.same(r.outputs[k], sc.expect[k]) ? ' ✓' : ' ✗') }).join(', '))
      if (sc.note) lines.push('Note: ' + sc.note)
      return lines.join('\n')
    }
    function send(sc, b) {
      var r = X.simulate(s, sc.inputs || {})
      var msg = { type: 'kss:scenario', feature: M.feature, simulator: s.id, title: s.title, scenario: sc.name || null, inputs: r.inputs, outputs: r.outputs, fired: r.fired, expected: sc.expect || null, note: sc.note || null }
      try { window.parent.postMessage(msg, '*') } catch (e) { /* nothing listens in a plain browser */ }
      b.textContent = L.sent
      setTimeout(function () { b.textContent = L.send }, 1400)
    }
    function scenarioRow(sc, onDelete) {
      var row = el('div', 'scn')
      var c = X.check(s, { inputs: sc.inputs || {}, expect: sc.expect || {} })
      var has = sc.expect && Object.keys(sc.expect).length
      var badge = el('span', 'verdict ' + (!has ? 'none' : c.ok ? 'ok' : 'bad'), !has ? '•' : c.ok ? '✓' : '✗')
      if (has && !c.ok) badge.title = c.mismatches.map(function (m) { return m.output + ': ' + JSON.stringify(m.got) + ' ≠ ' + JSON.stringify(m.expected) }).join('\n')
      var name = button('scn-name', sc.name, function () { load(sc.inputs) })
      name.title = L.load
      var meta = el('div', 'scn-meta')
      meta.appendChild(document.createTextNode(Object.keys(sc.inputs || {}).map(function (k) { return k + '=' + sc.inputs[k] }).join(' · ')))
      if (has) meta.appendChild(el('span', 'exp', ' → ' + Object.keys(sc.expect).map(function (k) { return k + '=' + sc.expect[k] }).join(' · ')))
      if (has && !c.ok) meta.appendChild(el('span', 'got', ' (' + c.mismatches.map(function (m) { return m.output + '=' + m.got }).join(' · ') + ')'))
      var main = add(el('div', 'scn-main'), name, meta)
      if (sc.note) main.appendChild(el('div', 'scn-note', sc.note))
      var acts = el('div', 'scn-acts')
      var sb = button('mini acc', L.send, function () { send(sc, sb) })
      add(acts, sb, copyButton(function () { return describe(sc, X.simulate(s, sc.inputs || {})) }))
      if (onDelete) acts.appendChild(button('mini', '✕', onDelete))
      return add(row, badge, main, acts)
    }
    var scenEl = el('div', 'sim-scen')
    if ((s.scenarios || []).length) {
      scenEl.appendChild(el('div', 'sim-h', L.scenarios))
      s.scenarios.forEach(function (sc) { scenEl.appendChild(scenarioRow(sc)) })
    }
    var store = storage('kss:scenarios:' + M.feature + ':' + s.id)
    var customEl = el('div', 'sim-custom')
    var customList = el('div')
    function fillCustom() {
      customList.textContent = ''
      var saved = store.read()
      if (!saved.length) customList.appendChild(el('p', 'empty', L.noCustom))
      saved.forEach(function (sc, i) {
        customList.appendChild(scenarioRow(sc, function () {
          var next = store.read().slice()
          next.splice(i, 1)
          store.write(next)
          fillCustom()
        }))
      })
      if (store.volatile()) customList.appendChild(el('p', 'empty', L.memoryOnly))
    }
    var nameIn = el('input')
    nameIn.placeholder = L.scenarioName
    var noteIn = el('input')
    noteIn.placeholder = L.note
    var expIns = {}
    var expRow = el('div', 'sim-exp')
    expRow.appendChild(el('span', 'lbl', L.expected))
    ;(s.outputs || []).forEach(function (o) {
      var x = el('input')
      x.placeholder = (o.label || o.id) + ' — ' + L.expectedHint
      expIns[o.id] = x
      expRow.appendChild(x)
    })
    var saveB = button('mini acc', L.save, function () {
      var name = nameIn.value.trim() || L.current + ' ' + (store.read().length + 1)
      var expect = {}
      Object.keys(expIns).forEach(function (k) {
        var v = parseExpected(expIns[k].value, outById[k])
        if (v !== undefined) expect[k] = v
      })
      var inputs = {}
      ;(s.inputs || []).forEach(function (i) { inputs[i.id] = values[i.id] })
      var sc = { name: name, inputs: inputs, expect: expect }
      if (noteIn.value.trim()) sc.note = noteIn.value.trim()
      store.write(store.read().concat([sc]))
      nameIn.value = ''
      noteIn.value = ''
      Object.keys(expIns).forEach(function (k) { expIns[k].value = '' })
      fillCustom()
    })
    var sendNow = button('mini', L.sendCurrent, function () {
      var inputs = {}
      ;(s.inputs || []).forEach(function (i) { inputs[i.id] = values[i.id] })
      send({ name: nameIn.value.trim() || null, inputs: inputs, note: noteIn.value.trim() || null }, sendNow)
      setTimeout(function () { sendNow.textContent = L.sendCurrent }, 1400)
    })
    add(customEl, el('div', 'sim-h', L.custom), add(el('div', 'sim-save'), nameIn, noteIn), expRow, add(el('div', 'sim-save'), saveB, sendNow), customList)
    fillCustom()

    var grid = add(el('div', 'sim-grid'), form, result)
    add(box, grid, rulesEl, scenEl, customEl)
    setControls()
    update()
    return box
  }
  /** A rule id as a chip that scrolls to its card in the Feature view, when it is there. */
  function ruleChip(id) {
    var b = button('tag rulechip', id, function (e) {
      e.preventDefault()
      e.stopPropagation()
      var t = document.getElementById('rule-' + id)
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.remove('ping'); void t.offsetWidth; t.classList.add('ping') }
    })
    return b
  }

  // ── Pages ────────────────────────────────────────────────────────────────────────────────
  var builtPhases = M.reports.filter(function (r) { return r.sections && r.sections.length })
  // Implementation first: execute, then the design that led to it.
  builtPhases.sort(function (a, b) {
    var rank = function (p) { return p === 'execute' ? 0 : p === 'review' ? 1 : p === 'plan' ? 2 : p === 'spec' ? 3 : 4 }
    return rank(a.phase) - rank(b.phase)
  })
  var LIVE = M.living || null
  // The living feature opens the page when it exists; otherwise what was built, then the overview.
  var state = { view: LIVE ? 'feature' : builtPhases.length ? 'built' : 'overview', phase: null, q: '', kind: null, fkind: null, fchanged: false }
  function readHash() {
    var h = decodeURIComponent(location.hash.slice(1))
    if (h.indexOf('phase-') === 0 && byPhase[h.slice(6)]) { state.view = 'phase'; state.phase = h.slice(6) }
    else if (h === 'decisions' || h === 'overview' || (h === 'built' && builtPhases.length) || (h === 'feature' && LIVE)) state.view = h
  }
  function go(view, phase) {
    var h = view === 'phase' ? 'phase-' + phase : view
    if (location.hash.slice(1) !== h) location.hash = h
    else { readHash(); render() }
  }
  window.addEventListener('hashchange', function () { readHash(); render() })
  document.addEventListener('keydown', function (e) {
    if (state.view !== 'phase' || e.target.tagName === 'INPUT') return
    var done = M.phases.filter(function (p) { return byPhase[p] })
    var i = done.indexOf(state.phase)
    if (e.key === 'ArrowRight' && i < done.length - 1) go('phase', done[i + 1])
    if (e.key === 'ArrowLeft' && i > 0) go('phase', done[i - 1])
  })

  function decision(d, phase) {
    var box = el('div', 'dec')
    var b = el('button')
    b.type = 'button'
    add(b, el('span', 'id', d.id || '•'))
    var t = el('span', 't')
    var head = el('b', null, d.title)
    if (d.status) head.appendChild(el('span', 'tag ' + d.status, d.status))
    if (d.kind && d.kind !== d.status) head.appendChild(el('span', 'tag', d.kind))
    if (phase) head.appendChild(el('span', 'tag', phase))
    add(t, head, el('span', null, d.decision))
    add(b, t, el('span', 'chev', '›'))
    var body = el('div', 'body')
    if (d.why) add(body, add(el('p'), el('span', 'lbl', L.why), document.createTextNode(d.why)))
    if (d.rejected && d.rejected.length) {
      var ul = el('ul', 'did')
      d.rejected.forEach(function (x) { ul.appendChild(el('li', null, x)) })
      add(body, add(el('p'), el('span', 'lbl', L.rejected)), ul)
    }
    if (d.source) add(body, add(el('p'), el('span', 'lbl', L.source), el('code', null, d.source)))
    if (!body.childNodes.length) body.appendChild(el('p', 'empty', '—'))
    b.addEventListener('click', function () { box.classList.toggle('open') })
    return add(box, b, body)
  }
  function header() {
    var h = el('header', 'top')
    h.appendChild(el('h1', null, M.feature))
    if (M.size) h.appendChild(el('span', 'pill acc', L.size + ' ' + M.size))
    if (M.state) h.appendChild(el('span', 'pill', L.state + ': ' + M.state))
    h.appendChild(el('span', 'spacer'))
    if (M.next) add(h, el('span', 'pill', L.next + ':'), el('code', null, M.next))
    h.appendChild(button('theme', L.theme, function () {
      var r = document.documentElement
      var dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
      r.dataset.theme = dark ? 'light' : 'dark'
    }))
    return h
  }
  function track() {
    var t = el('div', 'track')
    M.phases.forEach(function (p, i) {
      var has = !!byPhase[p]
      var s = el('button', 'step ' + (has ? 'done' : 'todo') + (state.view === 'phase' && state.phase === p ? ' on' : ''))
      s.type = 'button'
      add(s, el('span', 'n', has ? '✓' : String(i + 1)), document.createTextNode(p))
      if (has) s.addEventListener('click', function () { go('phase', p) })
      else s.title = L.notyet
      t.appendChild(s)
    })
    return t
  }
  function tabs() {
    var n = el('nav', 'tabs')
    var list = [['overview', L.overview]]
    if (builtPhases.length) list.unshift(['built', L.built])
    if (LIVE) list.unshift(['feature', L.feature])
    list.push(['decisions', L.decisions])
    list.forEach(function (x) { n.appendChild(button(state.view === x[0] ? 'on' : '', x[1], function () { go(x[0]) })) })
    if (state.view === 'phase') n.appendChild(el('button', 'on', L.phase + ': ' + state.phase))
    return n
  }
  function sectionsOf(r) {
    var f = document.createDocumentFragment()
    ;(r.sections || []).forEach(function (s) { f.appendChild(section(s)) })
    return f
  }
  function built() {
    var f = document.createDocumentFragment()
    if (!builtPhases.length) { f.appendChild(el('p', 'empty', L.nothingBuilt)); return f }
    builtPhases.forEach(function (r) {
      var c = el('div', 'card')
      var h = el('div', 'chead')
      add(h, el('h2', null, r.title || r.phase), button('mini', L.phase + ': ' + r.phase + ' ›', function () { go('phase', r.phase) }))
      add(c, h, el('p', 'summary', r.summary), sectionsOf(r))
      f.appendChild(c)
    })
    return f
  }
  function overview() {
    var f = document.createDocumentFragment()
    if (!M.reports.length) { f.appendChild(el('p', 'empty', L.noreport)); return f }
    var tl = el('div', 'timeline')
    M.reports.forEach(function (r) {
      var it = el('div', 'tl')
      var nd = (r.decisions || []).length
      add(it, el('div', 'h', r.phase + (nd ? ' · ' + nd + ' ' + L.dec.toLowerCase() : '')), el('p', null, r.summary))
      var c = costLine(M.cost[r.phase])
      if (c) it.appendChild(el('p', null, L.cost + ': ' + c))
      it.addEventListener('click', function () { go('phase', r.phase) })
      tl.appendChild(it)
    })
    f.appendChild(tl)
    return f
  }
  function phaseView(r) {
    var c = el('div', 'card')
    add(c, el('h2', null, r.title || r.phase), el('p', 'summary', r.summary))
    var meta = el('div', 'meta')
    var cl = costLine(M.cost[r.phase])
    if (cl) add(meta, add(el('span'), el('b', null, L.cost + ' '), document.createTextNode(cl)))
    if (r.at) meta.appendChild(el('span', null, new Date(r.at).toLocaleString(M.lang)))
    if (meta.childNodes.length) c.appendChild(meta)
    c.appendChild(sectionsOf(r))
    c.appendChild(el('h3', null, L.did))
    var ul = el('ul', 'did')
    r.did.forEach(function (x) { ul.appendChild(inline(el('li'), x)) })
    c.appendChild(ul)
    c.appendChild(el('h3', null, L.dec + ' (' + (r.decisions || []).length + ')'))
    if (r.decisions && r.decisions.length) r.decisions.forEach(function (d) { c.appendChild(decision(d)) })
    else c.appendChild(el('p', 'empty', L.none))
    if (r.highlights && r.highlights.length) {
      c.appendChild(el('h3', null, L.highlights))
      r.highlights.forEach(function (g, i) {
        var d = el('details', 'hl')
        if (i === 0) d.open = true
        d.appendChild(el('summary', null, g.group + ' (' + g.items.length + ')'))
        var u = el('ul')
        g.items.forEach(function (it) {
          var li = el('li')
          if (it.label) li.appendChild(el('span', 'lab', it.label))
          inline(li, it.text)
          u.appendChild(li)
        })
        d.appendChild(u)
        c.appendChild(d)
      })
    }
    if (r.open && r.open.length) { c.appendChild(el('h3', null, L.open)); r.open.forEach(function (x) { c.appendChild(el('div', 'warnbox', x)) }) }
    if (r.risks && r.risks.length) { c.appendChild(el('h3', null, L.risks)); r.risks.forEach(function (x) { c.appendChild(el('div', 'warnbox risk', x)) }) }
    if (r.artifacts && r.artifacts.length) {
      c.appendChild(el('h3', null, L.artifacts))
      var au = el('ul', 'did')
      r.artifacts.forEach(function (a) {
        var li = el('li')
        li.appendChild(el('code', null, a.path))
        if (a.what) li.appendChild(document.createTextNode(' — ' + a.what))
        au.appendChild(li)
      })
      c.appendChild(au)
    }
    return c
  }
  function decisionsView() {
    var f = document.createDocumentFragment()
    var all = []
    M.reports.forEach(function (r) { (r.decisions || []).forEach(function (d) { all.push({ d: d, p: r.phase }) }) })
    var bar = el('div', 'filters')
    var inp = el('input')
    inp.placeholder = L.search
    inp.value = state.q
    bar.appendChild(inp)
    var kinds = []
    all.forEach(function (x) { if (x.d.kind && kinds.indexOf(x.d.kind) < 0) kinds.push(x.d.kind) })
    var list = el('div')
    function chip(k, label) { return button('chip' + (state.kind === k ? ' on' : ''), label, function () { state.kind = k; render() }) }
    bar.appendChild(chip(null, L.all + ' (' + all.length + ')'))
    kinds.forEach(function (k) { bar.appendChild(chip(k, k)) })
    function fill() {
      list.textContent = ''
      var q = state.q.toLowerCase()
      var shown = all.filter(function (x) {
        if (state.kind && x.d.kind !== state.kind) return false
        if (!q) return true
        return [x.d.id, x.d.title, x.d.decision, x.d.why, (x.d.rejected || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0
      })
      if (!shown.length) list.appendChild(el('p', 'empty', '—'))
      shown.forEach(function (x) { list.appendChild(decision(x.d, x.p)) })
    }
    inp.addEventListener('input', function () { state.q = inp.value; fill() })
    fill()
    add(f, bar, list)
    return f
  }
  // ── The living feature (§25.1): the feature as it is now, product and technical ────────────
  function ago(iso) {
    var t = Date.parse(iso)
    if (!(t === t)) return ''
    var sec = Math.round((t - Date.now()) / 1000)
    var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
    try {
      var rtf = new Intl.RelativeTimeFormat(M.lang, { numeric: 'auto' })
      for (var i = 0; i < units.length; i++) if (Math.abs(sec) >= units[i][1] || i === units.length - 1) return rtf.format(Math.round(sec / units[i][1]), units[i][0])
    } catch (e) { /* no Intl: the date itself */ }
    return new Date(t).toLocaleString(M.lang)
  }
  var REQ_MARK = { done: '✓', building: '◐', planned: '○', dropped: '✕' }
  function fsec(id, icon, title, meta, body) {
    var d = el('details', 'fsec')
    d.id = 'f-' + id
    d.open = true
    var sum = el('summary')
    add(sum, el('span', 'ficon', icon), el('span', 'ftitle', title))
    if (meta != null && meta !== '') sum.appendChild(el('span', 'fmeta', meta))
    sum.appendChild(el('span', 'chev', '›'))
    add(d, sum, add(el('div', 'fbody'), body))
    return d
  }
  function chips(items, cls) {
    var w = el('div', 'chips')
    ;(items || []).forEach(function (x) { w.appendChild(el('span', 'fchip ' + (cls || ''), x)) })
    return w
  }
  function bar(done, total, cls) {
    var b = el('div', 'pbar ' + (cls || ''))
    var f = el('i')
    f.style.width = (total ? Math.round((done / total) * 100) : 0) + '%'
    b.appendChild(f)
    return b
  }
  function decChip(id) {
    return button('tag decchip', id, function () {
      var t = document.getElementById('dec-' + id)
      if (!t) return
      t.classList.add('open')
      t.scrollIntoView({ behavior: 'smooth', block: 'center' })
      t.classList.remove('ping'); void t.offsetWidth; t.classList.add('ping')
    })
  }
  function frChip(id) {
    var st = LIVE.progress && LIVE.progress.requirements[id]
    return el('span', 'tag frchip ' + (st ? st.status : ''), id)
  }
  function hero() {
    var p = LIVE.product || {}
    var c = el('div', 'card hero')
    add(c, el('div', 'eyebrow', L.feature + ' · ' + (LIVE.feature || M.feature)), el('h2', 'htitle', p.title || LIVE.feature || M.feature))
    if (p.problem || p.outcome) {
      var po = el('div', 'po')
      if (p.problem) po.appendChild(add(el('div', 'pobox prob'), el('span', 'lbl', L.problem), inline(el('p'), p.problem)))
      if (p.problem && p.outcome) po.appendChild(el('div', 'poarrow', '→'))
      if (p.outcome) po.appendChild(add(el('div', 'pobox out'), el('span', 'lbl', L.outcome), inline(el('p'), p.outcome)))
      c.appendChild(po)
    }
    var rows = el('div', 'scope')
    if (p.actors && p.actors.length) rows.appendChild(add(el('div', 'srow'), el('span', 'lbl', L.actors), chips(p.actors, 'actor')))
    if (p.inScope && p.inScope.length) rows.appendChild(add(el('div', 'srow'), el('span', 'lbl', L.inScope), chips(p.inScope, 'in')))
    if (p.outOfScope && p.outOfScope.length) rows.appendChild(add(el('div', 'srow'), el('span', 'lbl', L.outOfScope), chips(p.outOfScope, 'out')))
    if (rows.childNodes.length) c.appendChild(rows)
    // The track, compact: phases with a report done, the one that last updated the feature lit.
    var tr = el('div', 'mtrack')
    var curPhase = M.state && M.phases.indexOf(M.state) >= 0 ? M.state : LIVE.updatedBy
    M.phases.forEach(function (ph) {
      var cls = 'mstep' + (byPhase[ph] ? ' done' : '') + (ph === curPhase ? ' cur' : '')
      tr.appendChild(el('span', cls, ph))
    })
    c.appendChild(tr)
    var last = (LIVE.changes || [])[LIVE.changes ? LIVE.changes.length - 1 : 0]
    if (LIVE.updatedBy) {
      var u = el('div', 'updated')
      add(u, el('span', 'dot'), document.createTextNode(L.updatedBy + ' '), el('b', null, LIVE.updatedBy), document.createTextNode(' · ' + ago(LIVE.updatedAt)))
      if (last && last.text) u.appendChild(el('span', 'ulast', ' — ' + last.text))
      c.appendChild(u)
    }
    return c
  }
  function progressSec() {
    var P = LIVE.progress || { requirements: {}, done: 0, total: 0, tickets: { integrated: 0, total: 0 } }
    var f = el('div')
    var top = el('div', 'ptop')
    var pct = P.total ? Math.round((P.done / P.total) * 100) : 0
    add(top, add(el('div', 'pbig'), el('b', null, pct + '%'), el('span', null, P.done + '/' + P.total + ' ' + L.requirements + ' ' + L.reqDone)))
    if (P.tickets.total) top.appendChild(add(el('div', 'pbig'), el('b', null, P.tickets.integrated + '/' + P.tickets.total), el('span', null, L.tickets + ' ' + L.integrated)))
    add(f, top, bar(P.done, P.total, 'big'))
    var ul = el('div', 'reqs')
    ;(LIVE.requirements || []).forEach(function (r) {
      var st = P.requirements[r.id] || { status: r.status || 'planned', total: 0, integrated: 0 }
      var row = el('div', 'req ' + st.status)
      var mark = el('span', 'rmark', REQ_MARK[st.status] || '○')
      var mid = el('div', 'rmid')
      var head = el('div', 'rhead')
      add(head, el('b', 'rid', r.id), el('span', 'rstat ' + st.status, L[st.status] || st.status))
      ;(r.stories || []).forEach(function (x) { head.appendChild(el('span', 'tag', x)) })
      ;(r.decisions || []).forEach(function (x) { head.appendChild(decChip(x)) })
      add(mid, head, inline(el('div', 'rtext'), r.text || ''))
      if (st.total) add(mid, add(el('div', 'rbar'), bar(st.integrated, st.total), el('span', 'rnum', st.integrated + '/' + st.total + ' · ' + st.tickets.join(', '))))
      ul.appendChild(add(row, mark, mid))
    })
    f.appendChild(ul)
    if (LIVE.ticketFlow) f.appendChild(section({ type: 'flow', title: L.ticketGraph, nodes: LIVE.ticketFlow.nodes, edges: LIVE.ticketFlow.edges }))
    return f
  }
  function rulesSec() {
    var g = el('div', 'rules')
    var simsOf = {}
    ;(LIVE.simulators || []).forEach(function (s) {
      ;(s.rules || []).forEach(function (r) { if (r.rule) (simsOf[r.rule] = simsOf[r.rule] || []).indexOf(s.title) < 0 && simsOf[r.rule].push(s.title) })
    })
    ;(LIVE.rules || []).forEach(function (r) {
      var c = el('article', 'rule')
      c.id = 'rule-' + r.id
      var head = el('div', 'rulehead')
      add(head, el('span', 'id', r.id), el('b', null, r.title))
      c.appendChild(head)
      c.appendChild(prose(r.text))
      var links = el('div', 'rlinks')
      ;(r.fr || []).forEach(function (x) { links.appendChild(frChip(x)) })
      // Decisions: the rule's own, and those of the requirements it implements.
      var decs = (r.decisions || []).slice()
      ;(LIVE.requirements || []).forEach(function (q) {
        if ((r.fr || []).indexOf(q.id) >= 0) (q.decisions || []).forEach(function (d) { if (decs.indexOf(d) < 0) decs.push(d) })
      })
      decs.forEach(function (d) { links.appendChild(decChip(d)) })
      ;(simsOf[r.id] || []).forEach(function (t) { links.appendChild(el('span', 'tag sim', L.modeled + ' ' + t)) })
      if (links.childNodes.length) c.appendChild(links)
      if (r.code && r.code.code) add(c, el('div', 'lbl codelbl', L.ruleCode), codeBlock(r.code))
      else c.appendChild(el('p', 'empty small', L.notCoded))
      g.appendChild(c)
    })
    return g
  }
  function featureDecision(d) {
    var box = decision(d, d.phase)
    box.id = 'dec-' + d.id
    var hist = d.history || []
    if (hist.length) {
      box.classList.add('haschange')
      var head = box.querySelector('.t b')
      if (head) head.appendChild(el('span', 'tag changed', L.changed + (hist.length > 1 ? ' ×' + hist.length : '')))
      var body = box.querySelector('.body')
      var tl = el('div', 'hist')
      hist.concat([{ at: d.at, phase: d.phase, decision: d.decision, why: d.why, now: true }]).forEach(function (h, i) {
        if (i) tl.appendChild(el('div', 'harrow', '↓'))
        var it = el('div', 'hitem' + (h.now ? ' now' : ''))
        var meta = el('div', 'hmeta')
        add(meta, el('span', 'tag', h.phase || '—'))
        if (h.now) meta.appendChild(el('span', 'tag decided', L.now))
        if (h.at) meta.appendChild(el('span', 'when', ago(h.at)))
        add(it, meta, el('div', 'htext', h.decision))
        if (h.why) it.appendChild(el('div', 'hwhy', h.why))
        tl.appendChild(it)
      })
      if (body) body.insertBefore(tl, body.firstChild)
    }
    return box
  }
  function decisionsSec() {
    var f = el('div')
    var all = LIVE.decisions || []
    var bar2 = el('div', 'filters')
    var list2 = el('div')
    var kinds = []
    all.forEach(function (d) { if (d.kind && kinds.indexOf(d.kind) < 0) kinds.push(d.kind) })
    var nChanged = all.filter(function (d) { return d.history && d.history.length }).length
    function chip(label, on, fn) { return button('chip' + (on ? ' on' : ''), label, fn) }
    function fill() {
      bar2.textContent = ''
      bar2.appendChild(chip(L.all + ' (' + all.length + ')', !state.fkind && !state.fchanged, function () { state.fkind = null; state.fchanged = false; fill() }))
      kinds.forEach(function (k) {
        var n = all.filter(function (d) { return d.kind === k }).length
        bar2.appendChild(chip(k + ' (' + n + ')', state.fkind === k, function () { state.fkind = state.fkind === k ? null : k; fill() }))
      })
      if (nChanged) bar2.appendChild(chip('↻ ' + L.changedOnly + ' (' + nChanged + ')', state.fchanged, function () { state.fchanged = !state.fchanged; fill() }))
      list2.textContent = ''
      var shown = all.filter(function (d) {
        if (state.fkind && d.kind !== state.fkind) return false
        if (state.fchanged && !(d.history && d.history.length)) return false
        return true
      })
      if (!shown.length) list2.appendChild(el('p', 'empty', '—'))
      shown.forEach(function (d) { list2.appendChild(featureDecision(d)) })
    }
    fill()
    return add(f, bar2, list2)
  }
  function changesSec() {
    var tl = el('div', 'timeline changes')
    ;(LIVE.changes || []).slice().reverse().forEach(function (c) {
      var it = el('div', 'tl')
      var h = el('div', 'h')
      add(h, el('span', 'tag', c.phase), el('span', 'when', ago(c.at)))
      add(it, h, inline(el('p', 'ctext'), c.text))
      if ((c.changed && c.changed.length) || (c.removed && c.removed.length)) {
        var x = el('div', 'chips')
        ;(c.changed || []).forEach(function (id) { x.appendChild(el('span', 'fchip chg', '↻ ' + id + ' ' + L.changed)) })
        ;(c.removed || []).forEach(function (id) { x.appendChild(el('span', 'fchip rm', '− ' + id + ' ' + L.removed)) })
        it.appendChild(x)
      }
      tl.appendChild(it)
    })
    return tl
  }
  function featureView() {
    var f = document.createDocumentFragment()
    f.appendChild(hero())
    var P = LIVE.progress || {}
    if ((LIVE.requirements || []).length || LIVE.ticketFlow) f.appendChild(fsec('progress', '▰', L.progress, (P.done || 0) + '/' + (P.total || 0), progressSec()))
    if ((LIVE.rules || []).length) f.appendChild(fsec('rules', '§', L.rules, String(LIVE.rules.length), rulesSec()))
    if ((LIVE.simulators || []).length) {
      var sims = el('div')
      LIVE.simulators.forEach(function (s) { sims.appendChild(section(Object.assign({}, s, { type: 'simulator' }))) })
      f.appendChild(fsec('simulators', 'ƒ', L.simulators, String(LIVE.simulators.length), sims))
    }
    if ((LIVE.states || []).length) {
      var ms = el('div')
      LIVE.states.forEach(function (s) { ms.appendChild(section(Object.assign({}, s, { type: 'states' }))) })
      f.appendChild(fsec('states', '◉', L.machines, String(LIVE.states.length), ms))
    }
    var A = LIVE.architecture || {}
    if (A.flow || A.sequence || (LIVE.code || []).length) {
      var arch = el('div')
      if (A.flow) arch.appendChild(section(Object.assign({}, A.flow, { type: 'flow' })))
      if (A.sequence) arch.appendChild(section(Object.assign({}, A.sequence, { type: 'sequence' })))
      ;(LIVE.code || []).forEach(function (c) { arch.appendChild(section(Object.assign({}, c, { type: 'code' }))) })
      f.appendChild(fsec('architecture', '⌗', L.architecture, '', arch))
    }
    if ((LIVE.decisions || []).length) f.appendChild(fsec('decisions', '⚑', L.decisionsNow, String(LIVE.decisions.length), decisionsSec()))
    if ((LIVE.changes || []).length) f.appendChild(fsec('changes', '↻', L.whatChanged, String(LIVE.changes.length), changesSec()))
    return f
  }

  function render() {
    app.textContent = ''
    var w = el('div', 'wrap')
    add(w, header(), track(), tabs())
    if (M.errors && M.errors.length) w.appendChild(el('div', 'errors', M.errors.join('\n')))
    if (state.view === 'phase' && byPhase[state.phase]) w.appendChild(phaseView(byPhase[state.phase]))
    else if (state.view === 'decisions') w.appendChild(decisionsView())
    else if (state.view === 'built') w.appendChild(built())
    else if (state.view === 'feature' && LIVE) w.appendChild(featureView())
    else w.appendChild(overview())
    w.appendChild(el('footer', null, 'KSS · ' + M.reports.length + '/' + M.phases.length + ' ' + L.phases + ' · ' + L.gen + ' ' + new Date(M.generatedAt).toLocaleString(M.lang)))
    app.appendChild(w)
  }
  readHash()
  render()
}
