import { buildTimedLines, type LyricLine, type TimedLine } from '../../../shared/lyrics/timing'
import {
  layoutConstellation,
  renderConstellation,
  LINE_ENTER_LEAD_MS,
  LINE_EXIT_DRIFT_PX,
  LINE_EXIT_MS,
  type ConstellationLayout
} from './constellation'

const SEEK_FADE_MS = 300
const TRACK_FADE_MS = 350
const DIRTY_MARGIN_PX = 12

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/**
 * Draws the current line (and the previous line's exit tail) on the lyric canvas,
 * clearing only the rectangle the previous frame touched. Everything is derived
 * from the lyric time, so seeking or pausing can never leave stale nodes behind.
 */
export class LyricStage {
  private lines: TimedLine[] = []
  private layouts: (ConstellationLayout | null)[] = []
  private viewWidth = 0
  private viewHeight = 0
  private baseSize = 48
  private accent = '#FF5FA2'
  private seekFade = 0
  private needsFullClear = true
  private hasDirty = false
  private dirtyX = 0
  private dirtyY = 0
  private dirtyW = 0
  private dirtyH = 0
  private boundsMinX = 0
  private boundsMinY = 0
  private boundsMaxX = 0
  private boundsMaxY = 0
  private trackId = ''
  private canvas: HTMLCanvasElement | null = null
  private fadeImage: HTMLCanvasElement | null = null
  private fadeElapsedMs = 0

  configure(trackId: string, lines: readonly LyricLine[]): void {
    // Crossfade the previous track's lines out instead of cutting them.
    if (trackId !== this.trackId && this.lines.length > 0 && this.canvas && this.canvas.width > 0) {
      this.captureFade(this.canvas)
    }
    this.trackId = trackId
    this.lines = buildTimedLines(lines)
    this.layouts = this.lines.map(() => null)
    this.seekFade = 0
    this.needsFullClear = true
  }

  private captureFade(source: HTMLCanvasElement): void {
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    copy.getContext('2d')?.drawImage(source, 0, 0)
    this.fadeImage = copy
    this.fadeElapsedMs = 0
  }

  /** Clear the canvas and crossfade the new lyric state in (used on seeks). */
  clear(): void {
    this.seekFade = 0
    this.needsFullClear = true
  }

  setMetrics(width: number, height: number, baseSize: number): void {
    if (width === this.viewWidth && height === this.viewHeight && baseSize === this.baseSize) return
    this.viewWidth = width
    this.viewHeight = height
    this.baseSize = baseSize
    this.layouts = this.lines.map(() => null)
    this.needsFullClear = true
  }

  setAccent(color: string): void {
    this.accent = color
  }

  private findActiveIndex(timeMs: number): number {
    if (this.lines.length === 0) return -1
    let active = -1
    for (let index = 0; index < this.lines.length; index += 1) {
      if (timeMs >= this.lines[index].startMs) active = index
    }
    if (active < 0) {
      return timeMs >= this.lines[0].startMs - LINE_ENTER_LEAD_MS ? 0 : -1
    }
    if (timeMs >= this.lines[active].endMs + LINE_EXIT_MS) return -1
    return active
  }

  private layoutFor(index: number, ctx: CanvasRenderingContext2D): ConstellationLayout | null {
    if (index < 0 || index >= this.lines.length) return null
    let layout = this.layouts[index]
    if (!layout) {
      layout = layoutConstellation(ctx, this.lines[index], this.viewWidth, this.viewHeight, this.baseSize)
      this.layouts[index] = layout
    }
    return layout
  }

  private includeLayout(layout: ConstellationLayout): void {
    this.boundsMinX = Math.min(this.boundsMinX, layout.minX)
    this.boundsMinY = Math.min(this.boundsMinY, layout.minY)
    this.boundsMaxX = Math.max(this.boundsMaxX, layout.maxX)
    this.boundsMaxY = Math.max(this.boundsMaxY, layout.maxY)
  }

  render(ctx: CanvasRenderingContext2D, timeMs: number, deltaMs: number, visible: boolean): void {
    this.seekFade = Math.min(1, this.seekFade + deltaMs / SEEK_FADE_MS)
    this.canvas = ctx.canvas

    if (this.fadeImage) {
      ctx.clearRect(0, 0, this.viewWidth, this.viewHeight)
      const progress = Math.min(1, this.fadeElapsedMs / TRACK_FADE_MS)
      ctx.globalAlpha = 1 - easeOutCubic(progress)
      ctx.drawImage(this.fadeImage, 0, 0)
      ctx.globalAlpha = 1
      this.fadeElapsedMs += deltaMs
      if (progress >= 1) this.fadeImage = null
      this.hasDirty = false
      this.needsFullClear = false
    } else if (this.needsFullClear) {
      ctx.clearRect(0, 0, this.viewWidth, this.viewHeight)
      this.needsFullClear = false
      this.hasDirty = false
    } else if (this.hasDirty) {
      ctx.clearRect(this.dirtyX, this.dirtyY, this.dirtyW, this.dirtyH)
      this.hasDirty = false
    }

    if (!visible || this.lines.length === 0) return

    const active = this.findActiveIndex(timeMs)
    if (active < 0) return

    this.boundsMinX = Infinity
    this.boundsMinY = Infinity
    this.boundsMaxX = -Infinity
    this.boundsMaxY = -Infinity

    // The line before the active one may still be drifting out.
    if (active > 0) {
      const previousEnd = this.lines[active - 1].endMs
      const exit = (timeMs - previousEnd) / LINE_EXIT_MS
      if (exit < 1) {
        const layout = this.layoutFor(active - 1, ctx)
        if (layout) {
          const progress = Math.max(0, exit)
          const alpha = timeMs < previousEnd ? 1 : 1 - easeOutCubic(Math.min(1, progress))
          const drift = timeMs < previousEnd ? 0 : -LINE_EXIT_DRIFT_PX * easeOutCubic(progress)
          renderConstellation(ctx, layout, timeMs, alpha * this.seekFade, this.accent, drift)
          this.includeLayout(layout)
        }
      }
    }

    const activeLine = this.lines[active]
    const activeLayout = this.layoutFor(active, ctx)
    if (activeLayout) {
      if (timeMs < activeLine.endMs) {
        renderConstellation(ctx, activeLayout, timeMs, this.seekFade, this.accent, 0)
      } else {
        const exit = Math.min(1, (timeMs - activeLine.endMs) / LINE_EXIT_MS)
        if (exit < 1) {
          renderConstellation(
            ctx,
            activeLayout,
            timeMs,
            (1 - easeOutCubic(exit)) * this.seekFade,
            this.accent,
            -LINE_EXIT_DRIFT_PX * easeOutCubic(exit)
          )
        }
      }
      this.includeLayout(activeLayout)
    }

    // The next line's nodes fade in with a per-word stagger during the enter lead.
    const nextIndex = active + 1
    if (nextIndex < this.lines.length && timeMs >= this.lines[nextIndex].startMs - LINE_ENTER_LEAD_MS) {
      const nextLayout = this.layoutFor(nextIndex, ctx)
      if (nextLayout) {
        renderConstellation(ctx, nextLayout, timeMs, this.seekFade, this.accent, 0)
        this.includeLayout(nextLayout)
      }
    }

    if (this.boundsMaxX > this.boundsMinX) {
      this.dirtyX = this.boundsMinX - DIRTY_MARGIN_PX
      this.dirtyY = this.boundsMinY - DIRTY_MARGIN_PX
      this.dirtyW = this.boundsMaxX - this.boundsMinX + DIRTY_MARGIN_PX * 2
      this.dirtyH = this.boundsMaxY - this.boundsMinY + DIRTY_MARGIN_PX * 2
      this.hasDirty = true
    }
  }
}
