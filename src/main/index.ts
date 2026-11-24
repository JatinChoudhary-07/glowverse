import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { DisplayInfo } from '../shared/display'
import type { LyricsStatus } from '../shared/lyrics/provider'
import type { DemoCommand, NowPlaying, SourceStatus } from '../shared/nowPlaying'
import type { Settings } from '../shared/settings'
import { startBridge, type BridgeServer } from './bridge/nowPlayingServer'
import { captureWindow } from './capture'
import { DEMO_TRACKS } from './demo/tracks'
import { createNowPlayingHub, type NowPlayingHub } from './nowPlayingHub'
import { createOverlayManager, type OverlayManager } from './overlayManager'
import { createSettingsStore, generatePairingToken } from './settingsStore'
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

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

/** Dev-only: three moments in one line plus a backwards seek, captured in one session. */
async function runCaptureSequence(hub: NowPlayingHub, overlays: OverlayManager): Promise<void> {
  const target = overlays.firstWindow()
  if (!target) throw new Error('no overlay window to capture')
  hub.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
  hub.command({ action: 'pause' })
  const moments = [
    { name: 'moment-1-first-word', positionMs: 2300 },
    { name: 'moment-2-middle', positionMs: 3800 },
    { name: 'moment-3-last-word', positionMs: 4700 },
    { name: 'moment-4-seek-back', positionMs: 2500 }
  ]
  for (const moment of moments) {
    hub.command({ action: 'seek', positionMs: moment.positionMs })
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
  let bridge: BridgeServer | null = null

  const hub = createNowPlayingHub({
    cacheDir: app.getPath('userData'),
    onTrackChange: () => store.patch({ lyricOffsetMs: 0 }),
    onLyricsStatus: (status: LyricsStatus) => broadcast(IPC.lyricsStatus, status)
  })

  const publish = (next: Settings): void => {
    settings = next
    broadcast(IPC.settingsChanged, next)
    overlays.apply(next)
    tray?.refresh(next)
  }

  const broadcastNowPlaying = (report: NowPlaying): void => {
    broadcast(IPC.nowPlayingReport, report)
  }

  const broadcastSourceStatus = (status: SourceStatus): void => {
    broadcast(IPC.sourceStatus, status)
  }

  ipcMain.handle(IPC.settingsGet, () => settings)
  ipcMain.handle(IPC.settingsPatch, (_event, patch: unknown) => {
    const partial = typeof patch === 'object' && patch !== null ? (patch as Partial<Settings>) : {}
    return store.patch(partial)
  })
  ipcMain.handle(IPC.tokenRegenerate, () => {
    const next = store.patch({ pairingToken: generatePairingToken() })
    bridge?.unpair()
    return next
  })
  ipcMain.handle(IPC.displaysGet, () => collectDisplays())
  ipcMain.handle(IPC.nowPlayingGet, () => hub.report())
  ipcMain.handle(IPC.sourceStatusGet, () => hub.status())
  ipcMain.handle(IPC.lyricsStatusGet, () => hub.lyricsStatus())
  ipcMain.handle(IPC.demoTracksGet, () => hub.tracks())
  ipcMain.handle(IPC.demoCommand, (_event, command: DemoCommand) => {
    if (command && command.action === 'select') store.patch({ lyricOffsetMs: 0 })
    return hub.command(command)
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
    hub.stop()
    bridge?.close()
  })

  publish(settings)
  showSettingsWindow()
  hub.start(broadcastNowPlaying, broadcastSourceStatus)

  try {
    bridge = await startBridge({
      getToken: () => store.get().pairingToken,
      onUpdate: (payload) => hub.applyYtMusic(payload)
    })
    console.log(`[glowverse] bridge listening on 127.0.0.1:${bridge.port}`)
  } catch (error) {
    console.error('[glowverse] bridge unavailable', error)
  }

  // Dev harness: deterministic demo state for frame-time and capture runs.
  const seekEnv = process.env['GLOWVERSE_DEMO_SEEK']
  if (seekEnv !== undefined && Number.isFinite(Number(seekEnv))) {
    hub.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
    hub.command({ action: 'seek', positionMs: Number(seekEnv) })
    hub.command({ action: 'pause' })
  } else if (process.env['GLOWVERSE_DEMO_PLAY']) {
    hub.command({ action: 'select', trackId: DEMO_TRACKS[0].id })
    hub.command({ action: 'play' })
  }

  if (process.env['GLOWVERSE_CAPTURE_SEQUENCE']) {
    await wait(1200)
    await runCaptureSequence(hub, overlays)
    console.log('[glowverse] capture sequence complete')
  }
}
