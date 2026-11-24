export interface OklabColor {
  l: number
  a: number
  b: number
}

const CROSSFADE_MS = 800

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)

const linearToSrgb = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function hexToOklab(hex: string, out: OklabColor): void {
  const value = hex.replace('#', '')
  const red = srgbToLinear(parseInt(value.slice(0, 2), 16) / 255)
  const green = srgbToLinear(parseInt(value.slice(2, 4), 16) / 255)
  const blue = srgbToLinear(parseInt(value.slice(4, 6), 16) / 255)

  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)

  out.l = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out.a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out.b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

export function oklabToRgb(color: OklabColor, out: Float32Array): void {
  const lRoot = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b
  const mRoot = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b
  const sRoot = color.l - 0.0894841775 * color.a - 1.291485548 * color.b

  const l = lRoot * lRoot * lRoot
  const m = mRoot * mRoot * mRoot
  const s = sRoot * sRoot * sRoot

  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  out[0] = linearToSrgb(clamp01(red))
  out[1] = linearToSrgb(clamp01(green))
  out[2] = linearToSrgb(clamp01(blue))
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
