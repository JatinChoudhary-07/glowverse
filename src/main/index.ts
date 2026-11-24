import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { DisplayInfo } from '../shared/display'
import type { DemoCommand, NowPlaying } from '../shared/nowPlaying'
import type { Settings } from '../shared/settings'
import { captureWindow } from './capture'
import { createDemoPlayer } from './demo/demoPlayer'
import { DEMO_TRACKS } from './demo/tracks'
import { createOverlayManager, type OverlayManager } from './overlayManager'
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

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Dev-only: three moments in one line plus a backwards seek, captured in one session. */
async function runCaptureSequence(demo: ReturnType<typeof createDemoPlayer>, overlays: OverlayManager): Promise<void> {
  const target = overlays.firstWindow()
  if (!target) throw new Error('no overlay window to capture')
  demo.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
  demo.command({ action: 'pause' })
  const moments = [
    { name: 'moment-1-first-word', positionMs: 2300 },
    { name: 'moment-2-middle', positionMs: 3800 },
    { name: 'moment-3-last-word', positionMs: 4700 },
    { name: 'moment-4-seek-back', positionMs: 2500 }
  ]
  for (const moment of moments) {
    demo.command({ action: 'seek', positionMs: moment.positionMs })
    await wait(700)
    await captureWindow(target, moment.name)
  }
}

async function bootstrap(): Promise<void> {
  // macOS: no dock icon for an ambient overlay app.
  if (process.platform === 'darwin') app.dock?.hide()

  const store = createSettingsStore()
  const overlays = createOverlayManager()
  let settings: Settings = store.get()
  let tray: TrayController | null = null

  const demo = createDemoPlayer({
    onTrackChange: () => store.patch({ lyricOffsetMs: 0 })
  })

  const publish = (next: Settings): void => {
    settings = next
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.settingsChanged, next)
    }
    overlays.apply(next)
    tray?.refresh(next)
  }

  const broadcastNowPlaying = (report: NowPlaying): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.nowPlayingReport, report)
    }
  }

  ipcMain.handle(IPC.settingsGet, () => settings)
  ipcMain.handle(IPC.settingsPatch, (_event, patch: unknown) => {
    const partial = typeof patch === 'object' && patch !== null ? (patch as Partial<Settings>) : {}
    return store.patch(partial)
  })
  ipcMain.handle(IPC.displaysGet, () => collectDisplays())
  ipcMain.handle(IPC.nowPlayingGet, () => demo.report())
  ipcMain.handle(IPC.demoTracksGet, () => demo.tracks())
  ipcMain.handle(IPC.demoCommand, (_event, command: DemoCommand) => {
    if (command && command.action === 'select') store.patch({ lyricOffsetMs: 0 })
    return demo.command(command)
  })

  store.onChange(publish)

  tray = createTrayController({
    openSettings: () => showSettingsWindow(),
    patchSettings: (partial) => store.patch(partial),
    quit: () => app.quit()
  })

  app.on('before-quit', () => {
    store.flush()
    overlays.destroy()
    demo.stop()
  })

  publish(settings)
  showSettingsWindow()
  demo.start(broadcastNowPlaying)

  // Dev harness: deterministic demo state for frame-time and capture runs.
  const seekEnv = process.env['GLOWVERSE_DEMO_SEEK']
  if (seekEnv !== undefined && Number.isFinite(Number(seekEnv))) {
    demo.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
    demo.command({ action: 'seek', positionMs: Number(seekEnv) })
    demo.command({ action: 'pause' })
  } else if (process.env['GLOWVERSE_DEMO_PLAY']) {
    demo.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
    demo.command({ action: 'play' })
  }

  if (process.env['GLOWVERSE_CAPTURE_SEQUENCE']) {
    await wait(1200)
    await runCaptureSequence(demo, overlays)
    console.log('[glowverse] capture sequence complete')
  }
}
