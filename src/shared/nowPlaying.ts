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
