export interface QualityTier {
  readonly label: string
  /** Device pixel ratio cap for this tier. */
  readonly dprCap: number
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { label: 'high', dprCap: 2 },
  { label: 'medium', dprCap: 1.5 },
  { label: 'low', dprCap: 1 }
]

const WINDOW_MS = 2000
const STEP_DOWN_AVG_MS = 18
const STEP_UP_AVG_MS = 15
const STABLE_BEFORE_STEP_UP_MS = 10000

export class FrameStats {
  tier = 0
  averageMs = 0
  private windowMs = 0
  private windowFrames = 0
  private windowTotalMs = 0
  private stableMs = 0

  /** Returns true when the quality tier changed and the renderer must resize. */
  sample(deltaMs: number): boolean {
    this.windowMs += deltaMs
    this.windowFrames += 1
    this.windowTotalMs += deltaMs
    if (this.windowMs < WINDOW_MS) return false

    this.averageMs = this.windowTotalMs / this.windowFrames
    let changed = false

    if (this.averageMs > STEP_DOWN_AVG_MS && this.tier < QUALITY_TIERS.length - 1) {
      this.tier += 1
      changed = true
      this.stableMs = 0
    } else if (this.averageMs < STEP_UP_AVG_MS) {
      this.stableMs += this.windowMs
      if (this.stableMs >= STABLE_BEFORE_STEP_UP_MS && this.tier > 0) {
        this.tier -= 1
        changed = true
        this.stableMs = 0
      }
    } else {
      this.stableMs = 0
    }

    const fps = this.averageMs > 0 ? 1000 / this.averageMs : 0
    console.log(
      `[glowverse] frame avg ${this.averageMs.toFixed(1)} ms · ${fps.toFixed(0)} fps · tier ${QUALITY_TIERS[this.tier].label}`
    )

    this.windowMs = 0
    this.windowFrames = 0
    this.windowTotalMs = 0
    return changed
  }
}
