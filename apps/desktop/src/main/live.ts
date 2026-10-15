// The live view of a QA scenario: the driver's Chrome, streamed over CDP (DESIGN.md §24.5).
// qa.mjs writes live.json while a scenario is driven; we attach a second CDP client to its page
// and forward `Page.screencastFrame`s. The driver (browser-use) is never disturbed: screencast is
// read-only, and a failure here only loses the picture.
//
// A tab Chrome does not paint sends no screencast frames at all: browser-use drives a tab of its
// own while the first one stays the active one, so its tab is "hidden" and the view stayed on the
// grey placeholder. Whenever the screencast has been silent for a moment, a screenshot of the
// same page stands in for the frame — read-only too, and it works on a hidden tab.

import type { QaFrame } from '../shared/types.ts'
import { liveOf } from './qa.ts'

/** How long the screencast may stay silent before a screenshot stands in for it. */
export const STILL_MS = 1200

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
  private lastFrameAt = 0
  private shotId: number | null = null
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
    this.shotId = null
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
    if (key === this.key && this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.shotId === null && Date.now() - this.lastFrameAt > STILL_MS) {
        this.shotId = ++this.id
        this.ws.send(JSON.stringify({ id: this.shotId, method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 60 } }))
      }
      return
    }
    this.close()
    this.key = key
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    this.ws = ws
    const send = (method: string, params: Record<string, unknown> = {}) => ws.send(JSON.stringify({ id: ++this.id, method, params }))
    ws.onopen = () => send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 })
    this.lastFrameAt = 0
    this.shotId = null
    ws.onmessage = e => {
      let m: any
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      const frame = (data: string) => {
        this.lastFrameAt = Date.now()
        if (this.session === session) this.onFrame({ session, scenario: live.scenario, data: `data:image/jpeg;base64,${data}` })
      }
      if (m.id !== undefined && m.id === this.shotId) {
        this.shotId = null
        if (typeof m.result?.data === 'string') frame(m.result.data)
        return
      }
      if (m.method !== 'Page.screencastFrame') return
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
      frame(m.params.data)
    }
    ws.onclose = () => {
      if (this.ws === ws) this.close()
    }
    ws.onerror = () => {
      if (this.ws === ws) this.close()
    }
  }
}
