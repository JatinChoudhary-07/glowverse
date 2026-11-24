import { app, nativeImage, net } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractDominantColors, FALLBACK_PALETTE, type ArtPalette } from '../../shared/artColors'

const MAX_BYTES = 12 * 1024 * 1024
const TIMEOUT_MS = 8000
const DOWNSCALE_PX = 64

export interface AlbumArtService {
  /** Downloads (or reuses) cover art and returns its two dominant colours. */
  paletteFor(url: string): Promise<ArtPalette>
}

export function createAlbumArtService(): AlbumArtService {
  const cacheDir = join(app.getPath('userData'), 'art-cache')
  const palettes = new Map<string, ArtPalette>()
  const pending = new Map<string, Promise<ArtPalette>>()

  const resolve = async (url: string): Promise<ArtPalette> => {
    mkdirSync(cacheDir, { recursive: true })
    const key = createHash('sha1').update(url).digest('hex')
    const paletteFile = join(cacheDir, `${key}.json`)

    try {
      const cached = JSON.parse(readFileSync(paletteFile, 'utf8')) as ArtPalette
      if (isPalette(cached)) return cached
    } catch {
      // Not cached yet.
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let buffer: Buffer
    try {
      const response = await net.fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Glowverse/0.1 (album art)' }
      })
      if (!response.ok) throw new Error(`artwork HTTP ${response.status}`)
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > MAX_BYTES) throw new Error('artwork too large')
      buffer = Buffer.from(await response.arrayBuffer())
    } finally {
      clearTimeout(timeout)
    }
    if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new Error('artwork too large')

    writeFileSync(join(cacheDir, `${key}.img`), buffer)

    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error('artwork could not be decoded')
    const bitmap = image.resize({ width: DOWNSCALE_PX, height: DOWNSCALE_PX, quality: 'good' }).toBitmap()

    // nativeImage bitmaps are BGRA; the extractor wants straight RGBA.
    const rgba = new Uint8Array(bitmap.length)
    for (let index = 0; index < bitmap.length; index += 4) {
      rgba[index] = bitmap[index + 2]
      rgba[index + 1] = bitmap[index + 1]
      rgba[index + 2] = bitmap[index]
      rgba[index + 3] = bitmap[index + 3]
    }

    const palette = extractDominantColors({ data: rgba, width: DOWNSCALE_PX, height: DOWNSCALE_PX })
    try {
      writeFileSync(paletteFile, `${JSON.stringify(palette)}\n`, 'utf8')
    } catch (error) {
      console.warn('[glowverse] could not cache artwork palette', error)
    }
    return palette
  }

  return {
    paletteFor(url: string): Promise<ArtPalette> {
      const cached = palettes.get(url)
      if (cached) return Promise.resolve(cached)
      const inFlight = pending.get(url)
      if (inFlight) return inFlight

      const promise = resolve(url)
        .then((palette) => {
          palettes.set(url, palette)
          return palette
        })
        .catch((error: unknown) => {
          console.warn('[glowverse] artwork unavailable, keeping the current palette', error)
          return FALLBACK_PALETTE
        })
        .finally(() => {
          pending.delete(url)
        })

      pending.set(url, promise)
      return promise
    }
  }
}

function isPalette(value: unknown): value is ArtPalette {
  if (typeof value !== 'object' || value === null) return false
  const palette = value as Record<string, unknown>
  return (
    typeof palette.primary === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(palette.primary) &&
    typeof palette.secondary === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(palette.secondary)
  )
}
