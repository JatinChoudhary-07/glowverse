import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { DisplayInfo } from '../shared/display'
import type { Settings } from '../shared/settings'
import { createOverlayManager } from './overlayManager'
import { createSettingsStore } from './settingsStore'
import { showSettingsWindow } from './settingsWindow'
import { createTrayController, type TrayController } from './tray'

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showSettingsWindow()
  })

  // Glowverse lives in the tray: closing the settings window must not quit.
  app.on('window-all-closed', () => {})

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('[glowverse] failed to start', error)
      app.quit()
    })
}

function collectDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `Display ${display.id}`,
    primary: display.id === primaryId,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor
  }))
}

function bootstrap(): void {
  // macOS: no dock icon for an ambient overlay app.
  if (process.platform === 'darwin') app.dock?.hide()

  const store = createSettingsStore()
  const overlays = createOverlayManager()
  let settings: Settings = store.get()
  let tray: TrayController | null = null

  const publish = (next: Settings): void => {
    settings = next
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.settingsChanged, next)
    }
    overlays.apply(next)
    tray?.refresh(next)
  }

  ipcMain.handle(IPC.settingsGet, () => settings)
  ipcMain.handle(IPC.settingsPatch, (_event, patch: unknown) => {
    const partial = typeof patch === 'object' && patch !== null ? (patch as Partial<Settings>) : {}
    return store.patch(partial)
  })
  ipcMain.handle(IPC.displaysGet, () => collectDisplays())

  store.onChange(publish)

  tray = createTrayController({
    openSettings: () => showSettingsWindow(),
    patchSettings: (partial) => store.patch(partial),
    quit: () => app.quit()
  })

  app.on('before-quit', () => {
    store.flush()
    overlays.destroy()
  })

  publish(settings)
  showSettingsWindow()
}
