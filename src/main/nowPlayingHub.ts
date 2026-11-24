import { FALLBACK_PALETTE, type ArtPalette } from '../shared/artColors'
import type {
  DemoCommand,
  DemoTrackSummary,
  NowPlaying,
  SourceStatus,
  YtMusicPayload
} from '../shared/nowPlaying'
import { createAlbumArtService } from './art/albumArt'
import { createDemoPlayer } from './demo/demoPlayer'

const REPORT_INTERVAL_MS = 250
const DISCONNECT_AFTER_MS = 3000
const SEEK_RESET_MS = 800

export interface NowPlayingHub {
  start(onReport: (report: NowPlaying) => void, onStatus: (status: SourceStatus) => void): void
  stop(): void
  tracks(): DemoTrackSummary[]
  command(command: DemoCommand): NowPlaying
  applyYtMusic(payload: YtMusicPayload): void
  report(): NowPlaying
  status(): SourceStatus
}

/**
 * Single publisher for every source. YT Music wins while updates keep arriving;
 * otherwise the demo player takes over, so demo mode still works alone.
 */
export function createNowPlayingHub(options: { onTrackChange: () => void }): NowPlayingHub {
  const demo = createDemoPlayer({ onTrackChange: options.onTrackChange })
  const albumArt = createAlbumArtService()

  let ytPayload: YtMusicPayload | null = null
  let ytReceivedAt = 0
  let ytPalette: ArtPalette | null = null
  let ytTrackKey = ''
  let ytTrackId = ''
  let ytSeekToken = 0
  let ytLastPositionMs = 0
  let ytLastAt = 0

  let timer: NodeJS.Timeout | null = null
  let emitReport: (report: NowPlaying) => void = () => {}
  let emitStatus: (status: SourceStatus) => void = () => {}
  let lastStatusKey = ''

  const isYtConnected = (): boolean => ytPayload !== null && Date.now() - ytReceivedAt < DISCONNECT_AFTER_MS

  const buildReport = (): NowPlaying => {
    if (!isYtConnected() || !ytPayload) return demo.report()
    return {
      source: 'ytmusic',
      trackId: ytTrackId,
      title: ytPayload.title,
      artist: ytPayload.artist,
      album: ytPayload.album,
      durationMs: ytPayload.durationMs,
      positionMs: ytPayload.positionMs,
      isPlaying: ytPayload.isPlaying,
      artUrl: ytPayload.artUrl,
      bpm: null,
      updatedAt: ytReceivedAt,
      seekToken: ytSeekToken,
      palette: ytPalette ?? FALLBACK_PALETTE,
      lines: []
    }
  }

  const buildStatus = (): SourceStatus => {
    if (isYtConnected() && ytPayload) {
      return {
        source: 'ytmusic',
        connected: true,
        title: ytPayload.title,
        artist: ytPayload.artist,
        lastUpdateAt: ytReceivedAt
      }
    }
    const report = demo.report()
    return {
      source: report.source,
      connected: false,
      title: report.title,
      artist: report.artist,
      lastUpdateAt: 0
    }
  }

  const emitAll = (): void => {
    if (!emitReport) return
    emitReport(buildReport())
    const status = buildStatus()
    const key = `${status.connected}:${status.source}:${status.title}:${status.artist}`
    if (key !== lastStatusKey) {
      lastStatusKey = key
      emitStatus(status)
    }
  }

  const resolvePalette = async (url: string | null, key: string): Promise<void> => {
    if (!url) return
    const palette = await albumArt.paletteFor(url)
    if (ytTrackKey !== key) return
    ytPalette = palette
    emitAll()
  }

  return {
    start(onReport, onStatus) {
      emitReport = onReport
      emitStatus = onStatus
      demo.start(() => {
        if (!isYtConnected()) emitReport(demo.report())
      })
      emitAll()
      timer = setInterval(emitAll, REPORT_INTERVAL_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      demo.stop()
    },
    tracks: () => demo.tracks(),
    command(command) {
      const report = demo.command(command)
      if (!isYtConnected()) emitReport(report)
      return report
    },
    applyYtMusic(payload) {
      const now = Date.now()
      const key = `${payload.title}\u0000${payload.artist}\u0000${payload.artUrl ?? ''}`

      if (key !== ytTrackKey) {
        ytTrackKey = key
        ytTrackId = `yt-${hashString(key)}`
        ytSeekToken += 1
        ytPalette = null
        void resolvePalette(payload.artUrl, key)
      } else if (ytPayload) {
        const expected = ytLastPositionMs + (ytPayload.isPlaying ? now - ytLastAt : 0)
        if (Math.abs(payload.positionMs - expected) > SEEK_RESET_MS) ytSeekToken += 1
      }

      ytPayload = payload
      ytReceivedAt = now
      ytLastPositionMs = payload.positionMs
      ytLastAt = now
      emitAll()
    },
    report: buildReport,
    status: buildStatus
  }
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
