export type MotionMode = 'beat' | 'idle' | 'off'
export type PaletteMode = 'auto' | 'custom'
export type LyricStyleId = 'constellation' | 'fisheye' | 'kineticStack' | 'thread'
export type LyricPosition = 'center' | 'lowerThird'
export type SourceId = 'ytmusic' | 'spotify'

export interface Settings {
  overlayEnabled: boolean
  paused: boolean
  showLyrics: boolean
  motionMode: MotionMode
  paletteMode: PaletteMode
  primaryColor: string
  secondaryColor: string
  /** Core rim line width in CSS pixels. */
  thickness: number
  /** Glow spread multiplier. */
  glow: number
  /** Rim corner radius in CSS pixels. */
  cornerRadius: number
  /** Base lyric type size in CSS pixels. */
  lyricSize: number
  /** Per track lyric shift in 100 ms steps; resets when the track changes. */
  lyricOffsetMs: number
}

export const DEFAULT_SETTINGS: Settings = {
  overlayEnabled: true,
  paused: false,
  showLyrics: true,
  motionMode: 'beat',
  paletteMode: 'custom',
  primaryColor: '#FF5FA2',
  secondaryColor: '#6F8BFF',
  thickness: 14,
  glow: 1,
  cornerRadius: 14,
  lyricSize: 48,
  lyricOffsetMs: 0
}

const MOTION_MODES: readonly MotionMode[] = ['beat', 'idle', 'off']
const PALETTE_MODES: readonly PaletteMode[] = ['auto', 'custom']

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Merge unknown JSON onto defaults, clamping numbers and dropping unknown keys. */
export function normalizeSettings(input: unknown): Settings {
  const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    overlayEnabled: readBoolean(source.overlayEnabled, DEFAULT_SETTINGS.overlayEnabled),
    paused: readBoolean(source.paused, DEFAULT_SETTINGS.paused),
    showLyrics: readBoolean(source.showLyrics, DEFAULT_SETTINGS.showLyrics),
    motionMode: readEnum(source.motionMode, MOTION_MODES, DEFAULT_SETTINGS.motionMode),
    paletteMode: readEnum(source.paletteMode, PALETTE_MODES, DEFAULT_SETTINGS.paletteMode),
    primaryColor: readColor(source.primaryColor, DEFAULT_SETTINGS.primaryColor),
    secondaryColor: readColor(source.secondaryColor, DEFAULT_SETTINGS.secondaryColor),
    thickness: readNumber(source.thickness, 2, 40, DEFAULT_SETTINGS.thickness),
    glow: readNumber(source.glow, 0, 2, DEFAULT_SETTINGS.glow),
    cornerRadius: readNumber(source.cornerRadius, 0, 64, DEFAULT_SETTINGS.cornerRadius),
    lyricSize: readNumber(source.lyricSize, 20, 72, DEFAULT_SETTINGS.lyricSize),
    lyricOffsetMs: Math.round(readNumber(source.lyricOffsetMs, -2000, 2000, DEFAULT_SETTINGS.lyricOffsetMs) / 100) * 100
  }
}
