import { hexToOklab, oklabToRgb, type OklabColor } from '../../shared/color'

export { hexToOklab, oklabToRgb, type OklabColor }

const CROSSFADE_MS = 800

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function copyColor(from: OklabColor, to: OklabColor): void {
  to.l = from.l
  to.a = from.a
  to.b = from.b
}

/** Interpolates palettes in OKLab so brightness and hue stay even through the fade. */
export class PaletteTransition {
  readonly primaryRgb = new Float32Array(3)
  readonly secondaryRgb = new Float32Array(3)

  private readonly currentPrimary: OklabColor = { l: 0.5, a: 0, b: 0 }
  private readonly currentSecondary: OklabColor = { l: 0.5, a: 0, b: 0 }
  private readonly fromPrimary: OklabColor = { l: 0, a: 0, b: 0 }
  private readonly fromSecondary: OklabColor = { l: 0, a: 0, b: 0 }
  private readonly toPrimary: OklabColor = { l: 0, a: 0, b: 0 }
  private readonly toSecondary: OklabColor = { l: 0, a: 0, b: 0 }

  private primaryHex = ''
  private secondaryHex = ''
  private elapsedMs = CROSSFADE_MS

  setPalette(primaryHex: string, secondaryHex: string, instant = false): void {
    if (primaryHex === this.primaryHex && secondaryHex === this.secondaryHex) return
    this.primaryHex = primaryHex
    this.secondaryHex = secondaryHex

    copyColor(this.currentPrimary, this.fromPrimary)
    copyColor(this.currentSecondary, this.fromSecondary)
    hexToOklab(primaryHex, this.toPrimary)
    hexToOklab(secondaryHex, this.toSecondary)

    if (instant) {
      copyColor(this.toPrimary, this.currentPrimary)
      copyColor(this.toSecondary, this.currentSecondary)
      oklabToRgb(this.currentPrimary, this.primaryRgb)
      oklabToRgb(this.currentSecondary, this.secondaryRgb)
      this.elapsedMs = CROSSFADE_MS
      return
    }

    this.elapsedMs = 0
  }

  /** plainFade is used when the OS asks for reduced motion: no easing curve, just a fade. */
  update(deltaMs: number, plainFade: boolean): void {
    if (this.elapsedMs >= CROSSFADE_MS) return
    this.elapsedMs = Math.min(CROSSFADE_MS, this.elapsedMs + deltaMs)
    const progress = this.elapsedMs / CROSSFADE_MS
    const eased = plainFade ? progress : easeInOutCubic(progress)

    this.currentPrimary.l = this.fromPrimary.l + (this.toPrimary.l - this.fromPrimary.l) * eased
    this.currentPrimary.a = this.fromPrimary.a + (this.toPrimary.a - this.fromPrimary.a) * eased
    this.currentPrimary.b = this.fromPrimary.b + (this.toPrimary.b - this.fromPrimary.b) * eased
    this.currentSecondary.l = this.fromSecondary.l + (this.toSecondary.l - this.fromSecondary.l) * eased
    this.currentSecondary.a = this.fromSecondary.a + (this.toSecondary.a - this.fromSecondary.a) * eased
    this.currentSecondary.b = this.fromSecondary.b + (this.toSecondary.b - this.fromSecondary.b) * eased

    oklabToRgb(this.currentPrimary, this.primaryRgb)
    oklabToRgb(this.currentSecondary, this.secondaryRgb)
  }
}
