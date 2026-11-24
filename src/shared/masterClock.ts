const IGNORE_DRIFT_MS = 120
const SEEK_THRESHOLD_MS = 800
const DRIFT_EASE_MS = 400

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/**
 * One interpolation clock: the last reported position plus the time elapsed since
 * that report while playing. Drift under 120 ms is ignored, 120-800 ms is eased
 * out over 400 ms, and above 800 ms the report is a seek.
 */
export class MasterClock {
  private basePositionMs = 0
  private baseAtMs = 0
  private playing = false
  private correctionFromMs = 0
  private correctionStartMs = 0
  private correctionDurationMs = 0

  get isPlaying(): boolean {
    return this.playing
  }

  reset(positionMs: number, isPlaying: boolean, nowMs: number): void {
    this.basePositionMs = positionMs
    this.baseAtMs = nowMs
    this.playing = isPlaying
    this.correctionFromMs = 0
    this.correctionDurationMs = 0
  }

  /** Feed a fresh position report. Returns true when it was treated as a seek. */
  report(positionMs: number, isPlaying: boolean, nowMs: number): boolean {
    const drift = this.timeMs(nowMs) - positionMs
    const playingChanged = isPlaying !== this.playing

    if (playingChanged) {
      this.reset(positionMs, isPlaying, nowMs)
      return false
    }

    if (Math.abs(drift) > SEEK_THRESHOLD_MS) {
      this.reset(positionMs, isPlaying, nowMs)
      return true
    }

    if (Math.abs(drift) < IGNORE_DRIFT_MS) return false

    // Absorb the drift: re-anchor on the report, then ease away the old offset.
    this.basePositionMs = positionMs
    this.baseAtMs = nowMs
    this.correctionFromMs = drift
    this.correctionStartMs = nowMs
    this.correctionDurationMs = DRIFT_EASE_MS
    return false
  }

  timeMs(nowMs: number): number {
    let time = this.basePositionMs + (this.playing ? nowMs - this.baseAtMs : 0)
    if (this.correctionDurationMs > 0) {
      const progress = clamp01((nowMs - this.correctionStartMs) / this.correctionDurationMs)
      time += this.correctionFromMs * (1 - smoothstep(progress))
    }
    return time
  }
}
