import type { LyricsQuery } from './provider'

export interface LyricsQueryVariant {
  title: string
  artist: string
  album: string
}

const TRAILING_BRACKET = /\s*[([{][^)\]}]*[)\]}]\s*$/
const FEATURED_SUFFIX = /\s*[-–—]?\s*(?:feat\.?|ft\.?|featuring|with)\s+.*$/i
const REMASTER_SUFFIX = /\s*[-–—]?\s*(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+version)?(?:\s+\d{4})?\s*$/i
const NOISE_SUFFIX =
  /\s*[-–—]\s*(?:[^–—-]+\s+)?(?:live|version|edit|radio edit|remix|acoustic|instrumental|demo|mono|stereo)(?:\s+\d{4})?\s*$/i
const EXTRA_ARTISTS = /\s*(?:,|&|×|x|vs\.?|with|feat\.?|ft\.?|featuring)\s+.*$/i

/** Strips the suffixes streaming titles carry but lyric databases do not. */
export function cleanTitle(raw: string): string {
  let value = raw.trim()
  for (let pass = 0; pass < 4; pass += 1) {
    const before = value
    value = value.replace(TRAILING_BRACKET, '')
    value = value.replace(FEATURED_SUFFIX, '')
    value = value.replace(REMASTER_SUFFIX, '')
    value = value.replace(NOISE_SUFFIX, '')
    if (value === before) break
  }
  return value
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Removes featured artists but keeps co-artists joined by commas or ampersands. */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The lead artist only, for the second lookup attempt. */
export function primaryArtist(raw: string): string {
  return cleanArtist(raw).replace(EXTRA_ARTISTS, '').trim()
}

/** Lowercases, strips accents and punctuation so titles can be compared. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Cleaned query first, then the lead-artist variant, then the raw query. */
export function buildLyricQueries(query: LyricsQuery): LyricsQueryVariant[] {
  const variants: LyricsQueryVariant[] = [
    { title: cleanTitle(query.title), artist: cleanArtist(query.artist), album: query.album.trim() },
    { title: cleanTitle(query.title), artist: primaryArtist(query.artist), album: query.album.trim() },
    { title: query.title.trim(), artist: query.artist.trim(), album: query.album.trim() }
  ]

  const seen = new Set<string>()
  return variants.filter((variant) => {
    if (variant.title.length === 0 || variant.artist.length === 0) return false
    const key = `${normalizeForMatch(variant.title)}|${normalizeForMatch(variant.artist)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Cache key: normalized title, artist and duration in whole seconds. */
export function lyricsCacheKey(query: LyricsQuery): string {
  return `${normalizeForMatch(cleanTitle(query.title))}|${normalizeForMatch(cleanArtist(query.artist))}|${Math.round(
    query.durationMs / 1000
  )}`
}
