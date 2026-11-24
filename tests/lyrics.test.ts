import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { buildLyricQueries, cleanArtist, cleanTitle, lyricsCacheKey, primaryArtist } from '../src/shared/lyrics/clean'
import { parseLrc } from '../src/shared/lyrics/lrc'
import { createLrclibProvider, pickBestSearchResult } from '../src/shared/lyrics/lrclib'
import type { LyricsProvider } from '../src/shared/lyrics/provider'
import { createLyricsService, type LyricsUpdate } from '../src/main/lyrics/lyricsService'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const temporaryDirectories: string[] = []

function temporaryCache(): string {
  const directory = mkdtempSync(join(tmpdir(), 'glowverse-test-'))
  temporaryDirectories.push(directory)
  return directory
}

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

describe('LRC parser', () => {
  it('splits multiple timestamps on one line', () => {
    const parsed = parseLrc('[00:10.00][00:20.50]la la\n[00:30.00]da da')
    assert.deepEqual(
      parsed.lines.map((line) => line.startMs),
      [10000, 20500, 30000]
    )
    assert.equal(parsed.lines[0].text, 'la la')
    assert.equal(parsed.lines[2].text, 'da da')
  })

  it('reads two and three digit fractions', () => {
    const parsed = parseLrc('[01:02.50]a\n[01:02.500]b\n[00:05.05]c')
    assert.deepEqual(
      parsed.lines.map((line) => line.startMs),
      [5050, 62500, 62500]
    )
  })

  it('applies the offset tag before sorting', () => {
    const parsed = parseLrc('[offset:500]\n[00:10.00]later\n[00:08.00]earlier')
    assert.equal(parsed.offsetMs, 500)
    assert.deepEqual(
      parsed.lines.map((line) => line.startMs),
      [7500, 9500]
    )
  })

  it('drops blank and metadata lines and never goes negative', () => {
    const parsed = parseLrc('[ti:Synthetic]\n[ar:Nobody]\n[00:01.00]\n[00:02.00]   \n[00:03.00]kept\n[offset:9000]')
    assert.deepEqual(parsed.lines, [{ startMs: 0, text: 'kept' }])
  })
})

describe('title and artist cleaning', () => {
  it('strips feat, remaster, live and bracketed suffixes', () => {
    assert.equal(cleanTitle('Signal (feat. Someone)'), 'Signal')
    assert.equal(cleanTitle('Signal feat. Someone'), 'Signal')
    assert.equal(cleanTitle('Signal - 2011 Remaster'), 'Signal')
    assert.equal(cleanTitle('Signal (Remastered 2011)'), 'Signal')
    assert.equal(cleanTitle('Signal - Live'), 'Signal')
    assert.equal(cleanTitle('Signal [Official Video]'), 'Signal')
    assert.equal(cleanTitle('Signal (Radio Edit)'), 'Signal')
  })

  it('keeps meaningful parentheses at the start of a title', () => {
    assert.equal(cleanTitle("(Don't) Stop Me"), "(Don't) Stop Me")
  })

  it('drops featured and extra artists', () => {
    assert.equal(cleanArtist('Headliner feat. Guest'), 'Headliner')
    assert.equal(primaryArtist('Headliner, Guest & Other'), 'Headliner')
    assert.equal(primaryArtist('Headliner & Guest'), 'Headliner')
  })

  it('falls back to the lead artist for duets written with "and"', () => {
    assert.equal(cleanArtist('The Weeknd and Ariana Grande'), 'The Weeknd and Ariana Grande')
    assert.equal(primaryArtist('The Weeknd and Ariana Grande'), 'The Weeknd')
    const variants = buildLyricQueries({ title: 'Signal', artist: 'Headliner and Guest', album: '', durationMs: 200000 })
    assert.deepEqual(
      variants.map((variant) => variant.artist),
      ['Headliner and Guest', 'Headliner']
    )
  })

  it('tries cleaned, lead-artist and raw queries in order', () => {
    const variants = buildLyricQueries({
      title: 'Signal (feat. Guest)',
      artist: 'Headliner, Guest',
      album: 'Album',
      durationMs: 200000
    })
    assert.deepEqual(
      variants.map((variant) => `${variant.title}|${variant.artist}`),
      ['Signal|Headliner, Guest', 'Signal|Headliner', 'Signal (feat. Guest)|Headliner, Guest']
    )
  })

  it('keys the cache by normalized title, artist and seconds', () => {
    const key = lyricsCacheKey({ title: 'SIGNAL!', artist: 'The Headliner', album: '', durationMs: 200400 })
    assert.equal(key, 'signal|the headliner|200')
  })
})

describe('LRCLIB search picking', () => {
  const variant = { title: 'Signal', artist: 'Headliner', album: 'Album' }

  it('ignores wrong titles, far durations, plain-only and artist mismatches', () => {
    const item = pickBestSearchResult(
      [
        { trackName: 'Other', artistName: 'Headliner', duration: 200, syncedLyrics: '[00:01.00]x' },
        { trackName: 'Signal', artistName: 'Headliner', duration: 260, syncedLyrics: '[00:01.00]x' },
        { trackName: 'Signal', artistName: 'Headliner', duration: 200, plainLyrics: 'x' },
        { trackName: 'Signal', artistName: 'Different', duration: 200, syncedLyrics: '[00:01.00]x' }
      ],
      variant,
      200
    )
    assert.equal(item, null)
  })

  it('prefers a synced result and an exact artist', () => {
    const best = pickBestSearchResult(
      [
        { trackName: 'Signal', artistName: 'Headliner Tribute', duration: 200, syncedLyrics: '[00:01.00]x' },
        { trackName: 'Signal', artistName: 'Headliner', duration: 201.5, syncedLyrics: '[00:01.00]x' }
      ],
      variant,
      200
    )
    assert.equal(best?.artistName, 'Headliner')
  })

  it('accepts instrumentals without synced lyrics', () => {
    const best = pickBestSearchResult(
      [{ trackName: 'Signal', artistName: 'Headliner', duration: 200, instrumental: true }],
      variant,
      200
    )
    assert.equal(best?.instrumental, true)
  })
})

describe('LRCLIB provider requests', () => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const provider = (handler: (url: URL) => Response): ReturnType<typeof createLrclibProvider> =>
    createLrclibProvider({ fetchImpl: (async (input: RequestInfo | URL) => handler(new URL(String(input)))) as typeof fetch })

  it('skips the exact lookup when the duration is outside LRCLIB limits', async () => {
    const urls: string[] = []
    const lookup = await provider((url) => {
      urls.push(url.pathname)
      return json([])
    }).fetch(
      { title: 'Live Set', artist: 'Headliner', album: '', durationMs: 5_400_000 },
      new AbortController().signal
    )

    assert.equal(lookup, null)
    assert.deepEqual([...new Set(urls)], ['/api/search'])
  })

  it('treats a rejected exact request as a miss and still searches', async () => {
    const lookup = await provider((url) =>
      url.pathname === '/api/get'
        ? json({ message: 'duration: must be between 1 and 3600' }, 400)
        : json([])
    ).fetch({ title: 'Signal', artist: 'Headliner', album: '', durationMs: 200000 }, new AbortController().signal)

    assert.equal(lookup, null)
  })

  it('still throws on server errors so the lookup can retry', async () => {
    const failing = provider(() => json({ message: 'boom' }, 503))
    await assert.rejects(() =>
      failing.fetch({ title: 'Signal', artist: 'Headliner', album: '', durationMs: 200000 }, new AbortController().signal)
    )
  })
})

describe('lyrics service', () => {
  const track = (trackId: string, title: string): { trackId: string; title: string; artist: string; album: string; durationMs: number } => ({
    trackId,
    title,
    artist: 'Headliner',
    album: 'Album',
    durationMs: 200000
  })

  it('drops stale responses when the track changes mid lookup', async () => {
    const calls: string[] = []
    const provider: LyricsProvider = {
      name: 'fake',
      async fetch(query, signal) {
        calls.push(query.title)
        if (query.title === 'Slow') await sleep(80)
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return { source: 'fake', match: 'exact', instrumental: false, lines: [{ startMs: 0, text: 'synthetic' }] }
      }
    }

    const updates: LyricsUpdate[] = []
    const service = createLyricsService({
      cacheDir: temporaryCache(),
      provider,
      onUpdate: (update) => updates.push(update),
      debounceMs: 10,
      retryDelaysMs: []
    })

    service.request(track('a', 'Slow'))
    await sleep(30)
    service.request(track('b', 'Fast'))
    await sleep(150)

    const found = updates.filter((update) => update.status.phase === 'found')
    assert.equal(found.length, 1)
    assert.equal(found[0].status.trackId, 'b')
    assert.equal(found[0].lines.length, 1)
    service.dispose()
  })

  it('debounces rapid requests and caches hits', async () => {
    let fetches = 0
    const provider: LyricsProvider = {
      name: 'fake',
      async fetch() {
        fetches += 1
        return { source: 'fake', match: 'search', instrumental: false, lines: [{ startMs: 0, text: 'synthetic' }] }
      }
    }
    const cacheDir = temporaryCache()
    const updates: LyricsUpdate[] = []
    const service = createLyricsService({
      cacheDir,
      provider,
      onUpdate: (update) => updates.push(update),
      debounceMs: 20,
      retryDelaysMs: []
    })

    service.request(track('c', 'First'))
    service.request(track('d', 'Second'))
    await sleep(100)
    assert.equal(fetches, 1)
    assert.equal(updates.filter((update) => update.status.phase === 'found').length, 1)
    service.dispose()

    const cachedUpdates: LyricsUpdate[] = []
    const cachedService = createLyricsService({
      cacheDir,
      provider,
      onUpdate: (update) => cachedUpdates.push(update),
      debounceMs: 10,
      retryDelaysMs: []
    })
    cachedService.request(track('d', 'Second'))
    await sleep(60)
    assert.equal(fetches, 1)
    assert.equal(cachedUpdates.filter((update) => update.status.phase === 'found').length, 1)
    cachedService.dispose()
  })
})
