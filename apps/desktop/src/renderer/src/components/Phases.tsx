import type { KssPhase } from '../../../shared/types.ts'

const SHORT: Record<string, string> = {
  clarify: 'clr', investigate: 'inv', 'review-decisions': 'rvd', grill: 'grl', spec: 'spc', plan: 'pln', tickets: 'tkt',
  execute: 'exe', qa: 'qa', review: 'rev', 'docs-tech': 'dtc', 'docs-product': 'dpr',
}

export function Phases({ phases, compact }: { phases: KssPhase[]; compact?: boolean }) {
  return (
    <div className={compact ? 'phases compact' : 'phases'}>
      {phases.map(p => (
        <span key={p.name} className={`phase ${p.mark}`} title={p.name}>
          {compact ? <i /> : SHORT[p.name] ?? p.name}
        </span>
      ))}
    </div>
  )
}
