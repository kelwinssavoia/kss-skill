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
  var L = T[String(M.lang || 'en').slice(0, 2).toLowerCase()] || T.en
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
      var color = PALETTE[Math.max(0, groups.indexOf(n.group)) % PALETTE.length]
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
        sw.style.background = PALETTE[i % PALETTE.length]
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
      : null
    if (body) wrapEl.appendChild(body)
    return wrapEl
  }

  // ── Pages ────────────────────────────────────────────────────────────────────────────────
  var builtPhases = M.reports.filter(function (r) { return r.sections && r.sections.length })
  // Implementation first: execute, then the design that led to it.
  builtPhases.sort(function (a, b) {
    var rank = function (p) { return p === 'execute' ? 0 : p === 'review' ? 1 : p === 'plan' ? 2 : p === 'spec' ? 3 : 4 }
    return rank(a.phase) - rank(b.phase)
  })
  var state = { view: builtPhases.length ? 'built' : 'overview', phase: null, q: '', kind: null }
  function readHash() {
    var h = decodeURIComponent(location.hash.slice(1))
    if (h.indexOf('phase-') === 0 && byPhase[h.slice(6)]) { state.view = 'phase'; state.phase = h.slice(6) }
    else if (h === 'decisions' || h === 'overview' || (h === 'built' && builtPhases.length)) state.view = h
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
  function render() {
    app.textContent = ''
    var w = el('div', 'wrap')
    add(w, header(), track(), tabs())
    if (M.errors && M.errors.length) w.appendChild(el('div', 'errors', M.errors.join('\n')))
    if (state.view === 'phase' && byPhase[state.phase]) w.appendChild(phaseView(byPhase[state.phase]))
    else if (state.view === 'decisions') w.appendChild(decisionsView())
    else if (state.view === 'built') w.appendChild(built())
    else w.appendChild(overview())
    w.appendChild(el('footer', null, 'KSS · ' + M.reports.length + '/' + M.phases.length + ' ' + L.phases + ' · ' + L.gen + ' ' + new Date(M.generatedAt).toLocaleString(M.lang)))
    app.appendChild(w)
  }
  readHash()
  render()
}
