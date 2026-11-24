import type { LyricLine } from './timing'

export interface LyricsQuery {
  title: string
  artist: string
  album: string
  durationMs: number
}

export interface TimedLyricLine {
  startMs: number
  text: string
}

/** Provider result for one track. Lines only ever carry timings, never language. */
export interface LyricsLookup {
  source: string
  match: 'exact' | 'search'
  instrumental: boolean
  lines: TimedLyricLine[]
}

export interface LyricsProvider {
  readonly name: string
  fetch(query: LyricsQuery, signal: AbortSignal): Promise<LyricsLookup | null>
}

export type LyricsPhase = 'idle' | 'searching' | 'found' | 'instrumental' | 'not-found' | 'error'

export interface LyricsStatus {
  phase: LyricsPhase
  source: string | null
  lineCount: number
  trackId: string
  title: string
  artist: string
}

export function toLyricLines(lines: readonly TimedLyricLine[]): LyricLine[] {
  return lines.map((line) => ({ text: line.text, startMs: line.startMs }))
}
