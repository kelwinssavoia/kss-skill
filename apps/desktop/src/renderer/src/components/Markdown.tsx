// Markdown as the phases write it — headings, lists, tables, fences, inline code and emphasis —
// built as React elements, so nothing model-written ever becomes markup.

import { Fragment, type ReactNode } from 'react'

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index))
    const t = m[0]
    const k = `${key}-${m.index}`
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<b key={k}>{t.slice(2, -2)}</b>)
    else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>)
    else out.push(<span key={k} className="md-link">{/^\[([^\]]+)\]/.exec(t)![1]}</span>)
    at = m.index + t.length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** A table row's cells; `\|` is a pipe inside a cell, as GitHub reads it. */
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]!
    const k = blocks.length
    if (/^```/.test(l)) {
      const body: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) body.push(lines[i]!)
      i++
      blocks.push(<pre key={k} className="md-pre">{body.join('\n')}</pre>)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) {
      const level = Math.min(h[1]!.length + 1, 6)
      const Tag = `h${level}` as 'h2'
      blocks.push(<Tag key={k} className="md-h">{inline(h[2]!, k)}</Tag>)
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(l)
      const rows: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(cells(lines[i]!))
      blocks.push(
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c, n)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l)
      const items: string[] = []
      for (; i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i]!); i++) items.push(lines[i]!.replace(/^\s*([-*]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={k} className="md-list">{items.map((t, j) => <li key={j}>{inline(t.replace(/^\[([ x])\]\s*/, (_m, x) => (x === 'x' ? '☑ ' : '☐ ')), j)}</li>)}</List>)
      continue
    }
    if (/^>\s?/.test(l)) {
      const q: string[] = []
      for (; i < lines.length && /^>\s?/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^>\s?/, ''))
      blocks.push(<blockquote key={k} className="md-quote">{inline(q.join(' '), k)}</blockquote>)
      continue
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) {
      blocks.push(<hr key={k} className="md-hr" />)
      i++
      continue
    }
    if (!l.trim()) {
      i++
      continue
    }
    const para: string[] = []
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+[.)])\s|>|\s*\|)/.test(lines[i]!); i++) para.push(lines[i]!)
    if (!para.length) para.push(lines[i++]!)
    blocks.push(<p key={k} className="md-p">{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, j)}</Fragment>)}</p>)
  }
  return <div className={`md ${className}`}>{blocks}</div>
}
