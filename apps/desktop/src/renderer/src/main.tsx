import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App.tsx'

/** A render error shows itself and a reload, not a black window; the phases keep running in main. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    return (
      <div className="empty">
        <h2>The window hit an error</h2>
        <p>The phases and terminals keep running; reloading reattaches to them.</p>
        <pre>{e.stack ?? e.message}</pre>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(<Crash><App /></Crash>)
