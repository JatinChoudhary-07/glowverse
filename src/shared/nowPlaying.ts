import type { LyricLine } from './lyrics/timing'

export type NowPlayingSource = 'demo' | 'ytmusic' | 'spotify'

export interface NowPlayingPalette {
  primary: string
  secondary: string
}

/** Shared now-playing model: every source adapter emits this shape. */
export interface NowPlaying {
  source: NowPlayingSource
  trackId: string
  title: string
  artist: string
  album: string
  durationMs: number
  positionMs: number
  isPlaying: boolean
  artUrl: string | null
  bpm: number | null
  updatedAt: number
  /** Bumped whenever playback jumps so lyric state can be reset. */
  seekToken: number
  palette: NowPlayingPalette
  lines: LyricLine[]
}

/** Raw update the browser extension sends; the bridge validates it into this shape. */
export interface YtMusicPayload {
  title: string
  artist: string
  album: string
  durationMs: number
  positionMs: number
  isPlaying: boolean
  artUrl: string | null
}

export interface SourceStatus {
  source: NowPlayingSource
  connected: boolean
  title: string
  artist: string
  lastUpdateAt: number
}

export interface DemoTrackSummary {
  id: string
  title: string
  artist: string
  bpm: number
  durationMs: number
}

export type DemoCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; positionMs: number }
  | { action: 'select'; trackId: string }

const MAX_TEXT = 240
const MAX_ART_URL = 2048
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

function readText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : ''
}

function readMilliseconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)))
}

function readArtUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ART_URL) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url.toString()
    // Loopback is allowed for local artwork tests; nothing else in plain HTTP.
    if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
      return url.toString()
    }
    return null
  } catch {
    return null
  }
}

/** Validates an untrusted bridge body into the adapter payload, or null if unusable. */
export function parseYtMusicPayload(value: unknown): YtMusicPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const title = readText(source.title)
  if (title.length === 0) return null
  const durationMs = readMilliseconds(source.durationMs)
  const positionMs = readMilliseconds(source.positionMs)
  if (durationMs === null || positionMs === null) return null
  if (typeof source.isPlaying !== 'boolean') return null

  return {
    title,
    artist: readText(source.artist),
    album: readText(source.album),
    durationMs,
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
    isPlaying: source.isPlaying,
    artUrl: readArtUrl(source.artUrl)
  }
}
