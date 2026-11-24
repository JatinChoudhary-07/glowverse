export interface OklabColor {
  l: number
  a: number
  b: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)

export const linearToSrgb = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055

export function hexToOklab(hex: string, out: OklabColor): void {
  const value = hex.replace('#', '')
  const red = srgbToLinear(parseInt(value.slice(0, 2), 16) / 255)
  const green = srgbToLinear(parseInt(value.slice(2, 4), 16) / 255)
  const blue = srgbToLinear(parseInt(value.slice(4, 6), 16) / 255)
  rgbLinearToOklab(red, green, blue, out)
}

export function rgbToOklab(red: number, green: number, blue: number, out: OklabColor): void {
  rgbLinearToOklab(srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue), out)
}

function rgbLinearToOklab(red: number, green: number, blue: number, out: OklabColor): void {
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

/** Keeps a colour luminous but never white, preserving hue. */
export function clampLuminous(color: OklabColor, out: OklabColor): void {
  out.l = Math.min(0.78, Math.max(0.55, color.l))
  const chroma = Math.hypot(color.a, color.b)
  const maxChroma = 0.26
  if (chroma > maxChroma) {
    const scale = maxChroma / chroma
    out.a = color.a * scale
    out.b = color.b * scale
  } else {
    out.a = color.a
    out.b = color.b
  }
}

const rgbScratch = new Float32Array(3)

export function oklabToHex(color: OklabColor): string {
  oklabToRgb(color, rgbScratch)
  const channel = (value: number): string => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')
  return `#${channel(rgbScratch[0])}${channel(rgbScratch[1])}${channel(rgbScratch[2])}`.toUpperCase()
}
