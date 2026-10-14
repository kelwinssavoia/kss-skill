// Renders build/icon.svg to build/icon.png (1024px) and build/icon.icns, with Electron's own Chromium.
// Run after editing the SVG: npm run icon

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

const dir = join(import.meta.dirname, '../build')
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(1)
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise(r => setTimeout(r, 500))
  const png = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' }).toPNG()
  writeFileSync(join(dir, 'icon.png'), png)

  if (process.platform === 'darwin') {
    const set = join(dir, 'icon.iconset')
    rmSync(set, { recursive: true, force: true })
    mkdirSync(set)
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), join(dir, 'icon.png'), '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), join(dir, 'icon.png'), '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', join(dir, 'icon.icns')])
    rmSync(set, { recursive: true, force: true })
  }
  app.quit()
})
