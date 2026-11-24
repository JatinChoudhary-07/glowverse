import { clampLuminous, oklabToHex, rgbToOklab, type OklabColor } from './color'

export interface RgbaImage {
  /** RGBA, 8 bits per channel. */
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface ArtPalette {
  primary: string
  secondary: string
}

export const FALLBACK_PALETTE: ArtPalette = { primary: '#FF5FA2', secondary: '#6F8BFF' }

const HUE_BINS = 12
const MIN_CHROMA = 0.025
const DISTINCT_DISTANCE = 0.16

interface Bucket {
  count: number
  l: number
  a: number
  b: number
  chroma: number
}

interface Candidate {
  l: number
  a: number
  b: number
  score: number
}

/**
 * The two most vivid, distinct dominant colours of a downsampled cover:
 * hue/lightness buckets weighted by chroma and frequency, then clamped so the
 * palette stays luminous but never washes out to white.
 */
export function extractDominantColors(image: RgbaImage): ArtPalette {
  const buckets = new Map<string, Bucket>()
  const color: OklabColor = { l: 0, a: 0, b: 0 }
  const { data } = image

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 200) continue
    rgbToOklab(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255, color)
    const chroma = Math.hypot(color.a, color.b)
    if (chroma < MIN_CHROMA || color.l < 0.06 || color.l > 0.96) continue

    const hue = Math.atan2(color.b, color.a)
    const hueBin = Math.floor(((hue + Math.PI) / (Math.PI * 2)) * HUE_BINS) % HUE_BINS
    const lightBin = color.l < 0.45 ? 0 : color.l < 0.72 ? 1 : 2
    const key = `${hueBin}:${lightBin}`

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { count: 0, l: 0, a: 0, b: 0, chroma: 0 }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    bucket.l += color.l
    bucket.a += color.a
    bucket.b += color.b
    bucket.chroma += chroma
  }

  if (buckets.size === 0) return FALLBACK_PALETTE

  const candidates: Candidate[] = []
  for (const bucket of buckets.values()) {
    const l = bucket.l / bucket.count
    const a = bucket.a / bucket.count
    const b = bucket.b / bucket.count
    const chroma = Math.hypot(a, b)
    // Frequency matters, but a small vivid region can still win.
    const frequency = Math.min(1, bucket.count / (image.width * image.height * 0.08))
    candidates.push({ l, a, b, score: chroma * (0.45 + frequency) })
  }
  candidates.sort((left, right) => right.score - left.score)

  const primary = candidates[0]
  let secondary = primary
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.l - primary.l, candidate.a - primary.a, candidate.b - primary.b)
    if (distance >= DISTINCT_DISTANCE) {
      secondary = candidate
      break
    }
  }

  return {
    primary: luminousHex(primary),
    secondary: luminousHex(secondary)
  }
}

const scratch: OklabColor = { l: 0, a: 0, b: 0 }

function luminousHex(candidate: Candidate): string {
  clampLuminous(candidate, scratch)
  return oklabToHex(scratch)
}
