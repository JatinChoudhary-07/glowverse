import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DisplayInfo } from '../../shared/display'
import { IPC } from '../../shared/ipc'
import type { DemoCommand, DemoTrackSummary, NowPlaying, SourceStatus } from '../../shared/nowPlaying'
import type { Settings } from '../../shared/settings'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  patchSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<Settings>,
  regeneratePairingToken: (): Promise<Settings> =>
    ipcRenderer.invoke(IPC.tokenRegenerate) as Promise<Settings>,
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.displaysGet) as Promise<DisplayInfo[]>,
  onSettings: (callback: (settings: Settings) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, settings: Settings): void => callback(settings)
    ipcRenderer.on(IPC.settingsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.settingsChanged, handler)
    }
  },
  getNowPlaying: (): Promise<NowPlaying> => ipcRenderer.invoke(IPC.nowPlayingGet) as Promise<NowPlaying>,
  onNowPlaying: (callback: (report: NowPlaying) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, report: NowPlaying): void => callback(report)
    ipcRenderer.on(IPC.nowPlayingReport, handler)
    return () => {
      ipcRenderer.removeListener(IPC.nowPlayingReport, handler)
    }
  },
  getSourceStatus: (): Promise<SourceStatus> => ipcRenderer.invoke(IPC.sourceStatusGet) as Promise<SourceStatus>,
  onSourceStatus: (callback: (status: SourceStatus) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: SourceStatus): void => callback(status)
    ipcRenderer.on(IPC.sourceStatus, handler)
    return () => {
      ipcRenderer.removeListener(IPC.sourceStatus, handler)
    }
  },
  getDemoTracks: (): Promise<DemoTrackSummary[]> =>
    ipcRenderer.invoke(IPC.demoTracksGet) as Promise<DemoTrackSummary[]>,
  demoCommand: (command: DemoCommand): Promise<NowPlaying> =>
    ipcRenderer.invoke(IPC.demoCommand, command) as Promise<NowPlaying>
}

contextBridge.exposeInMainWorld('glowverse', api)

export type SettingsApi = typeof api
