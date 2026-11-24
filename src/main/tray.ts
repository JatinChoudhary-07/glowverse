import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { Settings } from '../shared/settings'

export interface TrayHandlers {
  openSettings(): void
  patchSettings(partial: Partial<Settings>): Settings
  quit(): void
}

export interface TrayController {
  refresh(settings: Settings): void
  destroy(): void
}

function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png')
}

export function createTrayController(handlers: TrayHandlers): TrayController {
  const image = nativeImage.createFromPath(trayIconPath())
  const icon = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16, quality: 'best' })
  const tray = new Tray(icon)
  tray.setToolTip('Glowverse')

  const buildMenu = (settings: Settings): Menu =>
    Menu.buildFromTemplate([
      { label: 'Open Glowverse', click: () => handlers.openSettings() },
      { type: 'separator' },
      {
        label: 'Show overlay',
        type: 'checkbox',
        checked: settings.overlayEnabled,
        click: (item) => handlers.patchSettings({ overlayEnabled: item.checked })
      },
      {
        label: 'Pause overlay',
        type: 'checkbox',
        checked: settings.paused,
        click: (item) => handlers.patchSettings({ paused: item.checked })
      },
      { type: 'separator' },
      { label: 'Quit Glowverse', click: () => handlers.quit() }
    ])

  const refresh = (settings: Settings): void => {
    tray.setContextMenu(buildMenu(settings))
  }

  tray.on('double-click', () => handlers.openSettings())

  return {
    refresh,
    destroy(): void {
      tray.destroy()
    }
  }
}
