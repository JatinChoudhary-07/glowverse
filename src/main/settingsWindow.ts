import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { captureWindowIfRequested } from './capture'
import { logRendererMessages } from './rendererDiagnostics'

let settingsWindow: BrowserWindow | null = null

function rendererUrl(route: string): string | undefined {
  const base = process.env['ELECTRON_RENDERER_URL']
  return base ? `${base}/${route}/index.html` : undefined
}

export function showSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  const window = new BrowserWindow({
    width: 780,
    height: 900,
    minWidth: 620,
    minHeight: 560,
    show: false,
    title: 'Glowverse',
    backgroundColor: '#08080a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/glowverse.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setMenuBarVisibility(false)
  logRendererMessages(window.webContents, 'settings')

  window.webContents.on('did-finish-load', () => captureWindowIfRequested(window, 'settings'))

  const devUrl = rendererUrl('settings')
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/settings/index.html'))

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
  })

  settingsWindow = window
  return window
}
