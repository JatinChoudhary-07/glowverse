import { join } from 'node:path'
import { lyricsCacheKey } from '../../shared/lyrics/clean'
import type { LyricsLookup, LyricsProvider, LyricsStatus, TimedLyricLine } from '../../shared/lyrics/provider'
import { CACHE_HIT_TTL_MS, CACHE_MISS_TTL_MS, LyricsCache } from './lyricsCache'

const DEBOUNCE_MS = 300
const RETRY_DELAYS_MS = [400, 1200] as const
const REQUEST_TIMEOUT_MS = 10000

export interface LyricsTrack {
  trackId: string
  title: string
  artist: string
  album: string
  durationMs: number
}

export interface LyricsUpdate {
  status: LyricsStatus
  lines: TimedLyricLine[]
}

export interface LyricsService {
  request(track: LyricsTrack): void
  cancel(): void
  status(): LyricsStatus
  dispose(): void
}

export interface LyricsServiceOptions {
  cacheDir: string
  provider: LyricsProvider
  onUpdate: (update: LyricsUpdate) => void
  debounceMs?: number
  retryDelaysMs?: readonly number[]
  now?: () => number
}

type Outcome =
  | { kind: 'hit'; lookup: LyricsLookup }
  | { kind: 'miss' }
  | { kind: 'error' }
  | { kind: 'stale' }

const IDLE_STATUS: LyricsStatus = {
  phase: 'idle',
  source: null,
  lineCount: 0,
  trackId: '',
  title: '',
  artist: ''
}

/**
 * One lyrics lookup at a time: debounced, aborted on track change, stale results
 * dropped, cached on disk, and never able to block rendering.
 */
export function createLyricsService(options: LyricsServiceOptions): LyricsService {
  const cache = new LyricsCache(join(options.cacheDir, 'lyrics-cache.json'))
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS
  const now = options.now ?? Date.now

  let generation = 0
  let timer: NodeJS.Timeout | null = null
  let controller: AbortController | null = null
  let currentStatus: LyricsStatus = IDLE_STATUS

  const emit = (status: LyricsStatus, lines: TimedLyricLine[] = []): void => {
    currentStatus = status
    options.onUpdate({ status, lines })
  }

  const statusFor = (track: LyricsTrack, phase: LyricsStatus['phase'], extra: Partial<LyricsStatus> = {}): LyricsStatus => ({
    phase,
    source: null,
    lineCount: 0,
    trackId: track.trackId,
    title: track.title,
    artist: track.artist,
    ...extra
  })

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const lookup = async (track: LyricsTrack, token: number): Promise<Outcome> => {
    const query = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs
    }
    const key = lyricsCacheKey(query)
    const cached = cache.get(key)
    if (cached !== undefined) return cached === null ? { kind: 'miss' } : { kind: 'hit', lookup: cached }

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      if (token !== generation) return { kind: 'stale' }
      const requestController = new AbortController()
      controller = requestController
      const timeout = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS)
      try {
        const result = await options.provider.fetch(query, requestController.signal)
        clearTimeout(timeout)
        if (token !== generation) return { kind: 'stale' }
        if (!result) {
          cache.set(key, null, CACHE_MISS_TTL_MS)
          return { kind: 'miss' }
        }
        cache.set(key, result, CACHE_HIT_TTL_MS)
        return { kind: 'hit', lookup: result }
      } catch (error) {
        clearTimeout(timeout)
        if (token !== generation) return { kind: 'stale' }
        if (attempt === retryDelays.length) {
          console.warn('[glowverse] lyrics lookup failed', error instanceof Error ? error.message : error)
          return { kind: 'error' }
        }
        await wait(retryDelays[attempt])
      }
    }
    return { kind: 'error' }
  }

  const run = async (track: LyricsTrack, token: number): Promise<void> => {
    const started = now()
    const outcome = await lookup(track, token)
    if (outcome.kind === 'stale' || token !== generation) return

    const elapsed = Math.round(now() - started)

    if (outcome.kind === 'hit') {
      const { lookup: found } = outcome
      // Counts only: lyric text must never reach logs.
      console.info(
        `[glowverse] lyrics ${found.instrumental ? 'instrumental' : `${found.lines.length} lines`} · ${found.match} · ${found.source} · ${elapsed} ms`
      )
      emit(
        statusFor(track, found.instrumental ? 'instrumental' : 'found', {
          source: found.source,
          lineCount: found.lines.length
        }),
        found.lines
      )
      return
    }

    if (outcome.kind === 'miss') {
      console.info(`[glowverse] lyrics none · miss · ${elapsed} ms`)
      emit(statusFor(track, 'not-found'))
      return
    }

    emit(statusFor(track, 'error'))
  }

  return {
    request(track) {
      generation += 1
      const token = generation
      clearTimer()
      controller?.abort()
      controller = null
      emit(statusFor(track, 'searching'))
      timer = setTimeout(() => {
        timer = null
        void run(track, token)
      }, debounceMs)
    },
    cancel() {
      generation += 1
      clearTimer()
      controller?.abort()
      controller = null
      emit(IDLE_STATUS)
    },
    status: () => currentStatus,
    dispose() {
      generation += 1
      clearTimer()
      controller?.abort()
      controller = null
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
