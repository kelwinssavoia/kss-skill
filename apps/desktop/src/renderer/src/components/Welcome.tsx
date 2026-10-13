export function Welcome({ recent, onPick, onOpen, error }: { recent: string[]; onPick: () => void; onOpen: (root: string) => void; error: string | null }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand">
          <span className="brand-mark">kss</span>
          <span className="brand-sub">phase-based development, in parallel</span>
        </div>
        <button className="primary big" onClick={onPick}>Open project…</button>
        {error && <p className="error">{error}</p>}
        {recent.length > 0 && (
          <div className="recent">
            <h3>Recent</h3>
            {recent.map(r => (
              <button key={r} className="recent-item" onClick={() => onOpen(r)}>
                <span className="recent-name">{r.split('/').pop()}</span>
                <span className="recent-path">{r}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
