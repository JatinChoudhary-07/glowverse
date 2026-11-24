import type { MotionMode } from '../../shared/settings'

const FALLBACK_BPM = 96
const ATTACK_MS = 40
const RELEASE_MS = 280
const SPRING_SMOOTH_TIME_S = 0.22
const IDLE_FLOOR = 0.26

/** Peak-to-trough overall brightness swing allowed by the photosensitivity rule. */
export const BRIGHTNESS_SWING = 0.09
const BRIGHTNESS_HALF_SWING = BRIGHTNESS_SWING / 2
/** Spec ceiling: at most three brightness changes per second. */
export const MAX_BRIGHTNESS_CHANGES_PER_SECOND = 3
/** Fast enough to reach the full swing within one beat at 180 BPM. */
const BRIGHTNESS_SLOPE_PER_SECOND = 1.1
/** Above this beat rate the pulse would exceed three per second. */
const MAX_PULSE_BPM = 180

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
 * Slew-limits brightness toward a target. The target itself is a one-pulse-per-beat
 * cosine capped at 180 BPM, so the pulse count can never exceed three per second
 * while the full 9% swing still lands on every beat.
 */
class BrightnessLimiter {
  value = 1

  update(target: number, deltaSeconds: number): number {
    const maxDelta = BRIGHTNESS_SLOPE_PER_SECOND * deltaSeconds
    const difference = target - this.value
    const step = difference > maxDelta ? maxDelta : difference < -maxDelta ? -maxDelta : difference
    this.value += step
    return this.value
  }
}

/**
 * One continuous energy signal. A 96 BPM impulse train (or the current track's
 * BPM) is followed with a 40 ms attack / 280 ms release envelope, smoothed by a
 * critically damped spring, then converted into a slow, capped brightness
 * modulation. Visuals never see raw beats.
 */
export class EnergySource {
  /** Overall brightness multiplier the shader applies, always within the safety cap. */
  brightness = 1

  private readonly spring = new CriticallyDamped()
  private readonly limiter = new BrightnessLimiter()
  private beatPhaseMs = 0
  private beatIndex = 0
  private envelope = IDLE_FLOOR
  private idlePhase = 0
  private pulsePhaseMs = 0

  update(deltaSeconds: number, mode: MotionMode, reducedMotion: boolean, bpm: number, isPlaying: boolean): number {
    const effectiveMode: MotionMode = reducedMotion || !isPlaying ? 'idle' : mode
    const deltaMs = deltaSeconds * 1000
    const beatPeriodMs = 60000 / Math.min(220, Math.max(40, bpm || FALLBACK_BPM))
    let target: number

    if (effectiveMode === 'off') {
      target = IDLE_FLOOR
    } else if (effectiveMode === 'idle') {
      this.idlePhase += deltaSeconds
      target = IDLE_FLOOR + 0.1 * (0.5 + 0.5 * Math.sin(this.idlePhase * 0.55))
    } else {
      this.beatPhaseMs += deltaMs
      while (this.beatPhaseMs >= beatPeriodMs) {
        this.beatPhaseMs -= beatPeriodMs
        this.beatIndex += 1
      }
      const beatPosition = this.beatPhaseMs / beatPeriodMs
      const accent = this.beatIndex % 4 === 0 ? 1 : 0.62
      target = IDLE_FLOOR * 0.75 + 0.78 * accent * Math.exp(-beatPosition * 3.4)
    }

    const coefficient =
      target > this.envelope
        ? 1 - Math.exp(-deltaMs / ATTACK_MS)
        : 1 - Math.exp(-deltaMs / RELEASE_MS)
    this.envelope += (target - this.envelope) * coefficient

    const smoothed = this.spring.update(this.envelope, deltaSeconds, SPRING_SMOOTH_TIME_S)
    const energy = Math.min(1.3, Math.max(0, smoothed))

    let brightnessTarget = 1
    if (effectiveMode === 'beat') {
      const pulseBpm = Math.min(MAX_PULSE_BPM, Math.max(40, bpm || FALLBACK_BPM))
      const pulsePeriodMs = 60000 / pulseBpm
      this.pulsePhaseMs = (this.pulsePhaseMs + deltaMs) % pulsePeriodMs
      const phase = (this.pulsePhaseMs / pulsePeriodMs) * Math.PI * 2
      brightnessTarget = 1 + BRIGHTNESS_HALF_SWING * Math.cos(phase)
    } else if (effectiveMode === 'idle') {
      brightnessTarget = 1 + BRIGHTNESS_HALF_SWING * 0.45 * Math.sin(this.idlePhase * 0.55)
    }
    this.brightness = this.limiter.update(brightnessTarget, deltaSeconds)

    return energy
  }
}
