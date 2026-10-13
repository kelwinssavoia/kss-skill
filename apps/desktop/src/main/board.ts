// A session's board: the same files and the same model kss-ui draws from (DESIGN.md §23, §24.2).

import { join } from 'node:path'

import { buildBoard, parseConfig, parseJson, parseReadme, sumTokens } from '../../../../mods/kss-ui/hooks/kss.ts'
import type { KssBoard } from '../shared/types.ts'
import { read } from './project.ts'

export type SessionFiles = { featureDir: string | null; board: KssBoard | null; feature: string | null }

/**
 * `.kss/current` names the feature while a run is open; outside one (a fresh session, a closed
 * run whose file was cleared) the branch does, and the README's State stands in for the phase.
 */
export function sessionBoard(path: string, branchFeature: string | null): SessionFiles {
  const config = parseConfig(read(join(path, '.kss/config.md')))
  const current = parseJson(read(join(path, '.kss/current')))
  const feature = (typeof current?.feature === 'string' && current.feature) || branchFeature
  if (!feature || !config) return { featureDir: null, board: null, feature: feature ?? null }
  const dir = join(path, config.featuresRoot, feature)
  const readme = parseReadme(read(join(dir, 'README.md')))
  const state = current && current.feature === feature ? current : { feature, phase: readme.state ?? 'clarify' }
  const board = buildBoard(state, readme, sumTokens(read(join(dir, 'metrics.jsonl'))), {
    graph: read(join(dir, '05-tickets/graph.md')),
    log: read(join(dir, '06-execution.md')),
  })
  return { featureDir: dir, board, feature }
}
