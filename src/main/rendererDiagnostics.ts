import type { WebContents } from 'electron'

/** Forward renderer warnings/errors to the terminal so the app is verifiable from logs. */
export function logRendererMessages(contents: WebContents, label: string): void {
  contents.on('console-message', (details) => {
    const isGlowverseLog = details.message.startsWith('[glowverse]')
    if (details.level === 'error' || details.level === 'warning' || isGlowverseLog) {
      console.log(`[glowverse:${label}] ${details.level}: ${details.message}`)
    }
  })
  contents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[glowverse:${label}] preload failed: ${preloadPath}`, error)
  })
}
