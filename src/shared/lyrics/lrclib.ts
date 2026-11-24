import { buildLyricQueries, normalizeForMatch, type LyricsQueryVariant } from './clean'
import { parseLrc } from './lrc'
import type { LyricsLookup, LyricsProvider, LyricsQuery } from './provider'

export const LRCLIB_BASE_URL = 'https://lrclib.net'
export const DEFAULT_USER_AGENT = 'Glowverse/0.1.0 (+https://github.com/glowverse/glowverse)'

const DURATION_TOLERANCE_SECONDS = 3

interface LrclibItem {
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

export interface LrclibProviderOptions {
  fetchImpl?: typeof fetch
  userAgent?: string
  baseUrl?: string
}

/** LRCLIB: exact match first, then a scored search over cleaned and raw queries. */
export function createLrclibProvider(options: LrclibProviderOptions = {}): LyricsProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const baseUrl = options.baseUrl ?? LRCLIB_BASE_URL
  const headers = { Accept: 'application/json', 'User-Agent': userAgent }

  const request = async (path: string, params: Record<string, string>, signal: AbortSignal): Promise<Response> => {
    const url = new URL(path, baseUrl)
    for (const [key, value] of Object.entries(params)) {
      if (value.length > 0) url.searchParams.set(key, value)
    }
    return fetchImpl(url, { headers, signal })
  }

  const exact = async (
    variant: LyricsQueryVariant,
    durationSeconds: number,
    signal: AbortSignal
  ): Promise<LrclibItem | null> => {
    const response = await request(
      '/api/get',
      {
        track_name: variant.title,
        artist_name: variant.artist,
        album_name: variant.album,
        duration: String(durationSeconds)
      },
      signal
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`lrclib exact ${response.status}`)
    return (await response.json()) as LrclibItem
  }

  const search = async (
    variant: LyricsQueryVariant,
    signal: AbortSignal
  ): Promise<LrclibItem[]> => {
    const response = await request(
      '/api/search',
      {
        track_name: variant.title,
        artist_name: variant.artist,
        album_name: variant.album
      },
      signal
    )
    if (!response.ok) throw new Error(`lrclib search ${response.status}`)
    const body = (await response.json()) as unknown
    return Array.isArray(body) ? (body as LrclibItem[]) : []
  }

  return {
    name: 'lrclib',
    async fetch(query: LyricsQuery, signal: AbortSignal): Promise<LyricsLookup | null> {
      const durationSeconds = Math.round(query.durationMs / 1000)
      const variants = buildLyricQueries(query)

      for (const variant of variants) {
        const item = await exact(variant, durationSeconds, signal)
        const lookup = toLookup(item, 'exact')
        if (lookup) return lookup
      }

      for (const variant of variants) {
        const items = await search(variant, signal)
        const best = pickBestSearchResult(items, variant, durationSeconds)
        const lookup = toLookup(best, 'search')
        if (lookup) return lookup
      }

      return null
    }
  }
}

/** Chooses a search hit by normalized title, artist match and near duration. */
export function pickBestSearchResult(
  items: readonly LrclibItem[],
  variant: LyricsQueryVariant,
  durationSeconds: number
): LrclibItem | null {
  const wantedTitle = normalizeForMatch(variant.title)
  const wantedArtist = normalizeForMatch(variant.artist)
  let best: LrclibItem | null = null
  let bestScore = -Infinity

  for (const item of items) {
    if (normalizeForMatch(item.trackName ?? '') !== wantedTitle) continue

    const duration = typeof item.duration === 'number' ? item.duration : Number.NaN
    if (durationSeconds > 0 && Number.isFinite(duration) && Math.abs(duration - durationSeconds) > DURATION_TOLERANCE_SECONDS) {
      continue
    }

    const synced = typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim().length > 0
    if (!synced && item.instrumental !== true) continue

    const artist = normalizeForMatch(item.artistName ?? '')
    const artistMatch = artist === wantedArtist ? 3 : artist.includes(wantedArtist) || wantedArtist.includes(artist) ? 1 : 0
    if (wantedArtist.length > 0 && artistMatch === 0) continue

    const closeness =
      Number.isFinite(duration) && durationSeconds > 0
        ? 1 - Math.abs(duration - durationSeconds) / DURATION_TOLERANCE_SECONDS
        : 0
    const score = (synced ? 4 : 0) + artistMatch + closeness
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }

  return best
}

function toLookup(item: LrclibItem | null, match: 'exact' | 'search'): LyricsLookup | null {
  if (!item) return null
  if (item.instrumental === true) return { source: 'lrclib', match, instrumental: true, lines: [] }
  if (typeof item.syncedLyrics !== 'string' || item.syncedLyrics.trim().length === 0) return null

  const parsed = parseLrc(item.syncedLyrics)
  if (parsed.lines.length === 0) return null
  return { source: 'lrclib', match, instrumental: false, lines: parsed.lines }
}
