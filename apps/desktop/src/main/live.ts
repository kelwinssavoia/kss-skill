// The live view of a QA scenario: the driver's Chrome, streamed over CDP (DESIGN.md §24.5).
// qa.mjs writes live.json while a scenario is driven; we attach a second CDP client to its page
// and forward `Page.screencastFrame`s. The driver (browser-use) is never disturbed: screencast is
// read-only, and a failure here only loses the picture.

import type { QaFrame } from '../shared/types.ts'
import { liveOf } from './qa.ts'

type Target = { type: string; url: string; webSocketDebuggerUrl?: string }

/** The page the driver is on: the last real page target (browser-use may open new tabs). */
export function pickTarget(targets: Target[]): Target | null {
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'))
  return pages.find(t => t.url !== 'about:blank') ?? pages[0] ?? null
}

export class LiveView {
  private session: string | null = null
  private ws: WebSocket | null = null
  private key = ''
  private timer: NodeJS.Timeout | null = null
  private id = 0
  private readonly onFrame: (f: QaFrame) => void

  constructor(onFrame: (f: QaFrame) => void) {
    this.onFrame = onFrame
  }

  watch(session: string | null) {
    if (session === this.session) return
    this.stop()
    this.session = session
    if (!session) return
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.close()
    this.session = null
  }

  private close() {
    try {
      this.ws?.close()
    } catch {
      /* already closed */
    }
    this.ws = null
    this.key = ''
  }

  private async tick() {
    const session = this.session
    if (!session) return
    const live = liveOf(session)
    if (!live) return this.close()
    let target: Target | null = null
    try {
      const res = await fetch(`${live.cdp}/json/list`, { signal: AbortSignal.timeout(800) })
      target = pickTarget((await res.json()) as Target[])
    } catch {
      return this.close()
    }
    if (!target?.webSocketDebuggerUrl) return
    const key = `${live.scenario}|${target.webSocketDebuggerUrl}`
    if (key === this.key && this.ws) return
    this.close()
    this.key = key
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    this.ws = ws
    const send = (method: string, params: Record<string, unknown> = {}) => ws.send(JSON.stringify({ id: ++this.id, method, params }))
    ws.onopen = () => send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 })
    ws.onmessage = e => {
      let m: any
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.method !== 'Page.screencastFrame') return
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
      if (this.session === session) this.onFrame({ session, scenario: live.scenario, data: `data:image/jpeg;base64,${m.params.data}` })
    }
    ws.onclose = () => {
      if (this.ws === ws) this.close()
    }
    ws.onerror = () => {
      if (this.ws === ws) this.close()
    }
  }
}
