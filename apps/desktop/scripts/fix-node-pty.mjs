// node-pty's macOS prebuilds ship `spawn-helper` without the exec bit, and every spawn then fails
// with "posix_spawnp failed". Restore it after every install.

import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../node_modules/node-pty/prebuilds')
if (existsSync(root)) {
  for (const dir of readdirSync(root)) {
    const helper = join(root, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
