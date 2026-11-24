import { app, BrowserWindow, screen, type Display } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'
import { captureWindowIfRequested } from './capture'
import { logRendererMessages } from './rendererDiagnostics'

export interface OverlayManager {
  apply(settings: Settings): void
  destroy(): void
}

const OVERLAY_ROUTE = 'overlay'
const DISPLAY_SYNC_DELAY_MS = 150

function rendererUrl(route: string): string | undefined {
  const base = process.env['ELECTRON_RENDERER_URL']
  return base ? `${base}/${route}/index.html` : undefined
}

function loadOverlay(window: BrowserWindow, display: Display): void {
  const devUrl = rendererUrl(OVERLAY_ROUTE)
  const query = { displayId: String(display.id), scale: String(display.scaleFactor) }
  if (devUrl) {
    const search = new URLSearchParams(query).toString()
    void window.loadURL(`${devUrl}?${search}`)
  } else {
    void window.loadFile(join(__dirname, `../renderer/${OVERLAY_ROUTE}/index.html`), { query })
  }
}

export function createOverlayManager(): OverlayManager {
  const windows = new Map<number, BrowserWindow>()
  let settings: Settings = DEFAULT_SETTINGS
  let syncTimer: NodeJS.Timeout | null = null

  const shouldShow = (): boolean => settings.overlayEnabled && !settings.paused

  function applyState(): void {
    for (const window of windows.values()) {
      if (window.isDestroyed()) continue
      if (shouldShow()) {
        if (!window.isVisible()) window.showInactive()
      } else if (window.isVisible()) {
        window.hide()
      }
    }
  }

  function createOverlayWindow(display: Display): BrowserWindow {
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: false,
      enableLargerThanScreen: true,
      roundedCorners: false,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/glowverse.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: !app.isPackaged
      }
    })

    window.setMenuBarVisibility(false)
    logRendererMessages(window.webContents, `overlay ${display.id}`)
    // Fully click-through: the cursor never hits the overlay.
    window.setIgnoreMouseEvents(true, { forward: true })
    // Highest always-on-top level so the rim can sit over fullscreen apps where the OS allows it.
    window.setAlwaysOnTop(true, 'screen-saver', 1)
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    const show = (): void => {
      if (!window.isDestroyed() && shouldShow()) window.showInactive()
    }

    window.once('ready-to-show', show)
    window.webContents.on('did-finish-load', () => {
      window.webContents.send(IPC.settingsChanged, settings)
      show()
      captureWindowIfRequested(window, `overlay-display-${display.id}`)
    })

    window.on('closed', () => {
      if (windows.get(display.id) === window) windows.delete(display.id)
    })

    console.log(
      `[glowverse] overlay on display ${display.id} ${display.bounds.width}x${display.bounds.height} @${display.scaleFactor}x`
    )
    loadOverlay(window, display)
    return window
  }

  function sync(): void {
    const displays = screen.getAllDisplays()
    for (const display of displays) {
      const existing = windows.get(display.id)
      if (existing && !existing.isDestroyed()) {
        existing.setBounds(display.bounds)
        continue
      }
      windows.set(display.id, createOverlayWindow(display))
    }
    for (const [displayId, window] of windows) {
      if (displays.some((display) => display.id === displayId)) continue
      windows.delete(displayId)
      if (!window.isDestroyed()) window.destroy()
    }
    applyState()
  }

  const scheduleSync = (): void => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      sync()
    }, DISPLAY_SYNC_DELAY_MS)
  }

  screen.on('display-added', scheduleSync)
  screen.on('display-removed', scheduleSync)
  screen.on('display-metrics-changed', scheduleSync)

  return {
    apply(next: Settings): void {
      settings = next
      sync()
      for (const window of windows.values()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.settingsChanged, next)
      }
    },
    destroy(): void {
      if (syncTimer) clearTimeout(syncTimer)
      screen.removeListener('display-added', scheduleSync)
      screen.removeListener('display-removed', scheduleSync)
      screen.removeListener('display-metrics-changed', scheduleSync)
      for (const window of windows.values()) {
        if (!window.isDestroyed()) window.destroy()
      }
      windows.clear()
    }
  }
}
