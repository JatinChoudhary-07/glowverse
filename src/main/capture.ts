import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_CAPTURE_DELAY_MS = 700

/**
 * Dev-only visual check: GLOWVERSE_CAPTURE=1 writes a PNG of each window into
 * .dev-capture/ so rendering can be inspected without screenshotting the desktop.
 */
export function captureWindowIfRequested(window: BrowserWindow, name: string): void {
  if (!process.env['GLOWVERSE_CAPTURE']) return
  const delay = Number(process.env['GLOWVERSE_CAPTURE_DELAY'] ?? DEFAULT_CAPTURE_DELAY_MS)
  setTimeout(() => {
    if (window.isDestroyed()) return
    void window.webContents
      .capturePage()
      .then((image) => {
        const directory = join(app.getAppPath(), '.dev-capture')
        mkdirSync(directory, { recursive: true })
        const file = join(directory, `${name}.png`)
        writeFileSync(file, image.toPNG())
        console.log(`[glowverse] captured ${file}`)
      })
      .catch((error: unknown) => console.error('[glowverse] capture failed', error))
  }, Number.isFinite(delay) ? delay : DEFAULT_CAPTURE_DELAY_MS)
}
