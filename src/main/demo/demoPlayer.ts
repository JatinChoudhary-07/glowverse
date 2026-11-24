import type { DemoCommand, DemoTrackSummary, NowPlaying } from '../../shared/nowPlaying'
import { DEMO_TRACKS, findDemoTrack } from './tracks'

const REPORT_INTERVAL_MS = 250

export interface DemoPlayer {
  start(onReport: (report: NowPlaying) => void): void
  stop(): void
  report(): NowPlaying
  tracks(): DemoTrackSummary[]
  command(command: DemoCommand): NowPlaying
}

export interface DemoPlayerOptions {
  /** Called when the user picks another demo track (lyric offset resets there). */
  onTrackChange?: () => void
}

export function createDemoPlayer(options: DemoPlayerOptions = {}): DemoPlayer {
  let trackIndex = 0
  let playing = false
  let basePositionMs = 0
  let baseAtMs = Date.now()
  let seekToken = 0
  let timer: NodeJS.Timeout | null = null
  let onReport: ((report: NowPlaying) => void) | null = null

  const track = () => DEMO_TRACKS[trackIndex]

  const positionAt = (nowMs: number): number => {
    const duration = track().durationMs
    if (!playing) return Math.min(basePositionMs, duration)
    let position = basePositionMs + (nowMs - baseAtMs)
    if (position >= duration) {
      position %= duration
      basePositionMs = position
      baseAtMs = nowMs
      seekToken += 1
    }
    return position
  }

  const report = (): NowPlaying => {
    const now = Date.now()
    const current = track()
    return {
      source: 'demo',
      trackId: current.id,
      title: current.title,
      artist: current.artist,
      album: current.album,
      durationMs: current.durationMs,
      positionMs: positionAt(now),
      isPlaying: playing,
      artUrl: null,
      bpm: current.bpm,
      updatedAt: now,
      seekToken,
      palette: { primary: current.primaryColor, secondary: current.secondaryColor },
      lines: current.lines
    }
  }

  const emit = (): void => {
    if (onReport) onReport(report())
  }

  const play = (): void => {
    if (playing) return
    basePositionMs = positionAt(Date.now())
    baseAtMs = Date.now()
    playing = true
    emit()
  }

  const pause = (): void => {
    if (!playing) return
    basePositionMs = positionAt(Date.now())
    baseAtMs = Date.now()
    playing = false
    emit()
  }

  const seek = (positionMs: number): void => {
    const duration = track().durationMs
    basePositionMs = Math.min(duration, Math.max(0, positionMs))
    baseAtMs = Date.now()
    seekToken += 1
    emit()
  }

  const select = (trackId: string): void => {
    const index = DEMO_TRACKS.findIndex((candidate) => candidate.id === trackId)
    if (index < 0 || index === trackIndex) return
    basePositionMs = positionAt(Date.now())
    trackIndex = index
    basePositionMs = 0
    baseAtMs = Date.now()
    seekToken += 1
    options.onTrackChange?.()
    emit()
  }

  return {
    start(callback) {
      onReport = callback
      if (timer) clearInterval(timer)
      timer = setInterval(emit, REPORT_INTERVAL_MS)
      emit()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      onReport = null
    },
    report,
    tracks: () =>
      DEMO_TRACKS.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
        bpm: candidate.bpm,
        durationMs: candidate.durationMs
      })),
    command(command: DemoCommand): NowPlaying {
      switch (command.action) {
        case 'play':
          play()
          break
        case 'pause':
          pause()
          break
        case 'seek':
          seek(command.positionMs)
          break
        case 'select':
          if (findDemoTrack(command.trackId)) select(command.trackId)
          break
      }
      return report()
    }
  }
}
