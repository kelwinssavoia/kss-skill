// The renderer's own small memory — layout, tab order and names, handoffs in flight — kept in the
// app's localStorage. Never KSS state: losing it costs a preference, nothing more.

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`kss.${key}`)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`kss.${key}`, JSON.stringify(value))
  } catch {
    /* full or unavailable: the preference is lost, nothing else */
  }
}
