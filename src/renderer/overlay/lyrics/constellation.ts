import type { TimedLine } from '../../../shared/lyrics/timing'

export const LINE_ENTER_LEAD_MS = 120
export const LINE_EXIT_MS = 350
export const LINE_EXIT_DRIFT_PX = 12

const LINE_FADE_MS = 400
const WORD_GROW_MS = 220
const WORD_SETTLE_MS = 300
const WORD_STAGGER_MS = 25
const UPCOMING_SCALE = 0.55
const SUNG_SCALE = 0.6
const UPCOMING_ALPHA = 0.25
const SUNG_ALPHA = 0.55

const FONT_STACK = `"Inter Variable", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`
const TEXT_COLOR = '#F2F2F5'

export interface StarLayout {
  text: string
  startMs: number
  endMs: number
  centerX: number
  centerY: number
  width: number
  nodeX: number
  nodeY: number
  phase: number
}

export interface ConstellationLayout {
  line: TimedLine
  stars: StarLayout[]
  fontSize: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const fontCache = new Map<number, string>()

function fontFor(sizePx: number): string {
  const size = Math.max(8, Math.round(sizePx))
  let font = fontCache.get(size)
  if (!font) {
    font = `700 ${size}px ${FONT_STACK}`
    fontCache.set(size, font)
  }
  return font
}

function hashLine(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const smoothstep = (t: number): number => t * t * (3 - 2 * t)
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/**
 * Seeded, stable star layout: a loose left-to-right path inside 70% of the width
 * and the central 35% of the height. Words are sized so full-size labels never
 * overlap; later frames shrink them.
 */
export function layoutConstellation(
  ctx: CanvasRenderingContext2D,
  line: TimedLine,
  viewWidth: number,
  viewHeight: number,
  baseSize: number
): ConstellationLayout {
  const words = line.words
  const maxWidth = viewWidth * 0.7
  const gapRatio = 0.6
  const widths: number[] = []

  const measureWidths = (size: number): number => {
    ctx.font = fontFor(size)
    widths.length = 0
    let sum = 0
    for (const word of words) {
      const width = ctx.measureText(word.text).width
      widths.push(width)
      sum += width
    }
    return sum
  }

  let fontSize = Math.max(16, baseSize)
  let sum = measureWidths(fontSize)
  let gap = fontSize * gapRatio
  let total = sum + gap * Math.max(0, words.length - 1)

  for (let attempt = 0; attempt < 2 && total > maxWidth; attempt += 1) {
    fontSize = Math.max(12, (fontSize * maxWidth) / total)
    sum = measureWidths(fontSize)
    gap = fontSize * gapRatio
    total = sum + gap * Math.max(0, words.length - 1)
  }

  const band = viewHeight * 0.35
  const centerY = viewHeight * 0.5
  // Gentle vertical drift: a loose path, not a scatter, kept inside the central band.
  const amplitude = Math.min(band * 0.18, Math.max(0, band / 2 - fontSize * 1.4))
  const random = createRandom(hashLine(line.text))
  const startX = (viewWidth - total) / 2
  const stars: StarLayout[] = []
  let cursor = startX

  for (let index = 0; index < words.length; index += 1) {
    const width = widths[index]
    const word = words[index]
    const y = centerY + (random() - 0.5) * 2 * amplitude
    stars.push({
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
      centerX: cursor + width / 2,
      centerY: y,
      width,
      nodeX: cursor + width / 2,
      nodeY: y - fontSize * 0.95,
      phase: random() * Math.PI * 2
    })
    cursor += width + gap
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const star of stars) {
    minX = Math.min(minX, star.centerX - star.width / 2)
    maxX = Math.max(maxX, star.centerX + star.width / 2)
    minY = Math.min(minY, star.nodeY - fontSize * 0.6)
    maxY = Math.max(maxY, star.centerY + fontSize * 0.8)
  }
  const margin = 48

  return {
    line,
    stars,
    fontSize,
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin
  }
}

function traceStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, innerRatio: number): void {
  ctx.beginPath()
  for (let point = 0; point < 8; point += 1) {
    const angle = (Math.PI / 4) * point - Math.PI / 2
    const pointRadius = point % 2 === 0 ? radius : radius * innerRatio
    const px = x + Math.cos(angle) * pointRadius
    const py = y + Math.sin(angle) * pointRadius
    if (point === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function floatOffset(star: StarLayout, timeMs: number): number {
  // 1 to 2 px of idle drift so the constellation never sits frozen.
  return Math.sin(timeMs / 900 + star.phase) * 1.5
}

/** Draws the whole constellation. All per-word state is derived from song time. */
export function renderConstellation(
  ctx: CanvasRenderingContext2D,
  layout: ConstellationLayout,
  timeMs: number,
  alpha: number,
  accent: string,
  driftY: number
): void {
  if (alpha <= 0.002) return
  const { stars, fontSize, line } = layout
  if (stars.length === 0) return

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Thread between stars, drawn over each word's duration with ease out.
  ctx.strokeStyle = 'rgba(242, 242, 245, 0.32)'
  ctx.lineWidth = 1
  ctx.globalAlpha = alpha
  for (let index = 1; index < stars.length; index += 1) {
    const star = stars[index]
    if (timeMs < star.startMs) continue
    const duration = Math.max(1, star.endMs - star.startMs)
    const progress = easeOutCubic(clamp01((timeMs - star.startMs) / duration))
    const previous = stars[index - 1]
    const fromX = previous.nodeX
    const fromY = previous.nodeY + driftY + floatOffset(previous, timeMs)
    const toX = star.nodeX
    const toY = star.nodeY + driftY + floatOffset(star, timeMs)
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress)
    ctx.stroke()
  }

  for (let index = 0; index < stars.length; index += 1) {
    const star = stars[index]
    const appear = smoothstep(
      clamp01((timeMs - (line.startMs - LINE_ENTER_LEAD_MS) - index * WORD_STAGGER_MS) / LINE_FADE_MS)
    )
    if (appear <= 0.002) continue

    const start = star.startMs
    const end = star.endMs
    let scale = UPCOMING_SCALE
    let opacity = UPCOMING_ALPHA
    let fill = 0
    let isCurrent = false

    if (timeMs >= start && timeMs < end) {
      isCurrent = true
      const grow = easeOutCubic(clamp01((timeMs - start) / WORD_GROW_MS))
      scale = UPCOMING_SCALE + (1 - UPCOMING_SCALE) * grow
      opacity = UPCOMING_ALPHA + (1 - UPCOMING_ALPHA) * grow
      fill = clamp01((timeMs - start) / Math.max(1, end - start))
    } else if (timeMs >= end) {
      const settle = easeOutCubic(clamp01((timeMs - end) / WORD_SETTLE_MS))
      scale = 1 - (1 - SUNG_SCALE) * settle
      opacity = 1 - (1 - SUNG_ALPHA) * settle
      fill = 1
    }

    const size = fontSize * scale
    const floatY = floatOffset(star, timeMs)
    const y = star.centerY + driftY + floatY
    const nodeY = star.nodeY + driftY + floatY
    const wordAlpha = alpha * appear

    ctx.globalAlpha = wordAlpha * Math.min(1, opacity + 0.12)
    ctx.fillStyle = isCurrent ? '#FFFFFF' : TEXT_COLOR
    if (isCurrent) {
      ctx.shadowColor = accent
      ctx.shadowBlur = 18
    } else {
      ctx.shadowBlur = 0
    }
    traceStar(ctx, star.nodeX, nodeY, isCurrent ? 7 : 2.6, 0.22)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.font = fontFor(size)
    ctx.globalAlpha = wordAlpha * opacity * 0.62
    ctx.fillStyle = TEXT_COLOR
    ctx.fillText(star.text, star.centerX, y)

    if (isCurrent) {
      // Soft accent bloom behind the current word.
      ctx.globalAlpha = wordAlpha * 0.24
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 22
      ctx.fillText(star.text, star.centerX, y)
      ctx.shadowBlur = 0
    }

    if (fill <= 0) continue

    const scaledWidth = star.width * scale
    const left = star.centerX - scaledWidth / 2
    const filled = scaledWidth * fill

    if (fill >= 1) {
      ctx.globalAlpha = wordAlpha * opacity
      ctx.fillStyle = '#FFFFFF'
      if (isCurrent) {
        ctx.shadowColor = accent
        ctx.shadowBlur = 14
      }
      ctx.fillText(star.text, star.centerX, y)
      ctx.shadowBlur = 0
      continue
    }

    // Left-to-right fill with a soft leading edge: a solid pass plus one fading pass.
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, y - size, Math.max(0, filled), size * 2)
    ctx.clip()
    ctx.globalAlpha = wordAlpha * opacity
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(star.text, star.centerX, y)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(left, y - size, Math.max(0, filled + 9), size * 2)
    ctx.clip()
    ctx.globalAlpha = wordAlpha * opacity * 0.38
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(star.text, star.centerX, y)
    ctx.restore()
  }

  ctx.restore()
}
