// Copies the built KSS.app into /Applications, replacing an older copy, and signs it ad hoc
// (Apple Silicon refuses to run an unsigned bundle). Run through: npm run install-app

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '../dist')
const dir = readdirSync(dist).find(d => d.startsWith('mac') && existsSync(join(dist, d, 'KSS.app')))
if (!dir) throw new Error('no dist/mac*/KSS.app — run npm run dist first')
const target = '/Applications/KSS.app'
rmSync(target, { recursive: true, force: true })
execFileSync('ditto', [join(dist, dir, 'KSS.app'), target])
execFileSync('codesign', ['--force', '--deep', '--sign', '-', target])
console.log(`installed ${target}`)
