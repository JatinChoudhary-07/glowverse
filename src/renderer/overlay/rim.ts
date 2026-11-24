import type { Settings } from '../../shared/settings'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1).toFixed(3)})`
}

/**
 * M0 static rim: soft rounded-rect line on the screen edge with an exponential
 * falloff inward. The WebGL2 energy-driven shader replaces this in M1.
 */
export class RimRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private width = 1
  private height = 1

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.resize()
  }

  /** Size the backing store to the window, capping device pixel ratio at 2. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = Math.max(1, window.innerWidth)
    this.height = Math.max(1, window.innerHeight)
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  render(settings: Settings): void {
    const { ctx, width, height } = this
    ctx.clearRect(0, 0, width, height)
    if (!settings.overlayEnabled || settings.paused) return

    const thickness = clamp(settings.thickness, 2, 40)
    const glow = clamp(settings.glow, 0, 2)
    const inset = thickness * 0.5 + 1
    const spread = thickness * (0.9 + glow * 4.2)
    const radius = clamp(settings.cornerRadius, 0, Math.max(0, Math.min(width, height) / 2 - inset))

    const gradient = ctx.createLinearGradient(0, height, width, 0)
    gradient.addColorStop(0, settings.primaryColor)
    gradient.addColorStop(1, settings.secondaryColor)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = gradient
    ctx.lineJoin = 'round'

    // Concentric strokes with exponential alpha: a continuous falloff inward, no hard edges.
    const bands = 30
    for (let index = bands; index >= 0; index -= 1) {
      const t = index / bands
      const distance = t * spread
      const x = inset + distance
      const y = inset + distance
      const boxWidth = width - 2 * x
      const boxHeight = height - 2 * y
      if (boxWidth <= 2 || boxHeight <= 2) continue
      ctx.globalAlpha = Math.exp(-2.8 * t) * 0.05
      ctx.lineWidth = thickness * (1 + t * 1.4)
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, Math.max(0, radius - distance))
      ctx.stroke()
    }

    // Core line: thin, bright, softly bloomed.
    ctx.globalAlpha = 0.9
    ctx.lineWidth = Math.max(1, thickness * 0.55)
    ctx.shadowBlur = thickness * 1.6
    ctx.shadowColor = withAlpha(settings.primaryColor, 0.55)
    ctx.beginPath()
    ctx.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, radius)
    ctx.stroke()

    ctx.restore()
  }
}
