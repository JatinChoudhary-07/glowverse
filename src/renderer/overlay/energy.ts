import type { MotionMode } from '../../shared/settings'

const DEMO_BPM = 96
const BEAT_PERIOD_MS = 60000 / DEMO_BPM
const ATTACK_MS = 40
const RELEASE_MS = 280
const SPRING_SMOOTH_TIME_S = 0.22
const IDLE_FLOOR = 0.26

/** Critically damped smoothing (Game Programming Gems smoothDamp), no overshoot. */
class CriticallyDamped {
  private value = 0
  private velocity = 0

  update(target: number, deltaSeconds: number, smoothTimeSeconds: number): number {
    const omega = 2 / smoothTimeSeconds
    const x = omega * deltaSeconds
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const change = this.value - target
    const impulse = (this.velocity + omega * change) * deltaSeconds
    this.velocity = (this.velocity - omega * impulse) * decay
    this.value = target + (change + impulse) * decay
    return this.value
  }
}

/**
 * One continuous energy signal. The 96 BPM demo supplies an impulse train which
 * is followed with a 40 ms attack / 280 ms release envelope, then smoothed by a
 * critically damped spring. Visuals never see raw beats.
 */
export class EnergySource {
  private readonly spring = new CriticallyDamped()
  private beatPhaseMs = 0
  private beatIndex = 0
  private envelope = IDLE_FLOOR
  private idlePhase = 0

  update(deltaSeconds: number, mode: MotionMode, reducedMotion: boolean): number {
    const effectiveMode: MotionMode = reducedMotion ? 'idle' : mode
    const deltaMs = deltaSeconds * 1000
    let target: number

    if (effectiveMode === 'off') {
      target = IDLE_FLOOR
    } else if (effectiveMode === 'idle') {
      this.idlePhase += deltaSeconds
      target = IDLE_FLOOR + 0.1 * (0.5 + 0.5 * Math.sin(this.idlePhase * 0.55))
    } else {
      this.beatPhaseMs += deltaMs
      while (this.beatPhaseMs >= BEAT_PERIOD_MS) {
        this.beatPhaseMs -= BEAT_PERIOD_MS
        this.beatIndex += 1
      }
      const beatPosition = this.beatPhaseMs / BEAT_PERIOD_MS
      const accent = this.beatIndex % 4 === 0 ? 1 : 0.62
      target = IDLE_FLOOR * 0.75 + 0.78 * accent * Math.exp(-beatPosition * 3.4)
    }

    const coefficient =
      target > this.envelope
        ? 1 - Math.exp(-deltaMs / ATTACK_MS)
        : 1 - Math.exp(-deltaMs / RELEASE_MS)
    this.envelope += (target - this.envelope) * coefficient

    const smoothed = this.spring.update(this.envelope, deltaSeconds, SPRING_SMOOTH_TIME_S)
    return Math.min(1.3, Math.max(0, smoothed))
  }
}
