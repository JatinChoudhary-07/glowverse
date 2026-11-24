// Run with: npm run test:brightness
// Sweeps 60 to 180 BPM and reports the brightness swing and pulse rate produced
// by the demo energy signal (the same value the shader uses).
import {
  BRIGHTNESS_SWING,
  EnergySource,
  MAX_BRIGHTNESS_CHANGES_PER_SECOND
} from '../src/renderer/overlay/energy.ts'

const FRAME_MS = 1000 / 120
const MEASURE_MS = 12000
const WARMUP_MS = 3000
const PULSE_THRESHOLD = 0.02

const MIN_SWING_PERCENT = 8
const MAX_SWING_PERCENT = 10

interface Result {
  bpm: number
  swingPercent: number
  pulsesPerSecond: number
  maxFrameChangePercent: number
}

function measure(bpm: number): Result {
  const energy = new EnergySource()
  const warmupFrames = Math.round(WARMUP_MS / FRAME_MS)
  for (let frame = 0; frame < warmupFrames; frame += 1) {
    energy.update(FRAME_MS / 1000, 'beat', false, bpm, true)
  }

  const frames = Math.round(MEASURE_MS / FRAME_MS)

  let previous = energy.brightness
  let minimum = previous
  let maximum = previous
  let trough = previous
  let maxFrameChange = 0
  let highest = previous
  let direction = 0

  let pulses = 0
  let pulsesThisSecond = 0
  let maxPulsesInSecond = 0
  let secondIndex = 0

  for (let frame = 0; frame < frames; frame += 1) {
    energy.update(FRAME_MS / 1000, 'beat', false, bpm, true)
    const value = energy.brightness

    if (value < minimum) minimum = value
    if (value > maximum) maximum = value

    const frameChange = Math.abs(value - previous) / previous
    if (frameChange > maxFrameChange) maxFrameChange = frameChange

    const step = value - previous
    if (step > 0) {
      direction = 1
      if (value > highest) highest = value
    } else if (step < 0) {
      if (direction === 1 && (highest - trough) / trough >= PULSE_THRESHOLD) {
        pulses += 1
        pulsesThisSecond += 1
        trough = value
      }
      direction = -1
      if (value < trough) trough = value
      highest = value
    }

    const second = Math.floor((frame * FRAME_MS) / 1000)
    if (second !== secondIndex) {
      if (pulsesThisSecond > maxPulsesInSecond) maxPulsesInSecond = pulsesThisSecond
      pulsesThisSecond = 0
      secondIndex = second
    }

    previous = value
  }

  if (pulsesThisSecond > maxPulsesInSecond) maxPulsesInSecond = pulsesThisSecond

  return {
    bpm,
    swingPercent: ((maximum - minimum) / minimum) * 100,
    pulsesPerSecond: maxPulsesInSecond,
    maxFrameChangePercent: maxFrameChange * 100
  }
}

const results: Result[] = []
for (let bpm = 60; bpm <= 180; bpm += 10) results.push(measure(bpm))

console.log('BPM | swing | pulses / s | max change per frame')
for (const result of results) {
  console.log(
    `${String(result.bpm).padStart(3)} | ${result.swingPercent.toFixed(1).padStart(5)}% | ${result.pulsesPerSecond
      .toFixed(1)
      .padStart(10)} | ${result.maxFrameChangePercent.toFixed(2).padStart(20)}%`
  )
}

const swing = results.reduce((sum, result) => sum + result.swingPercent, 0) / results.length
const worstPulseRate = results.reduce((worst, result) => Math.max(worst, result.pulsesPerSecond), 0)
const minSwing = results.reduce((least, result) => Math.min(least, result.swingPercent), Infinity)
const maxSwing = results.reduce((most, result) => Math.max(most, result.swingPercent), 0)
const maxFrameChange = results.reduce((worst, result) => Math.max(worst, result.maxFrameChangePercent), 0)

console.log(
  `swing: ${swing.toFixed(1)}% (${minSwing.toFixed(1)}-${maxSwing.toFixed(1)}%, target ${MIN_SWING_PERCENT}-${MAX_SWING_PERCENT}%)`
)
console.log(
  `pulses: ${worstPulseRate.toFixed(1)}/s (limit ${MAX_BRIGHTNESS_CHANGES_PER_SECOND}/s) · max change per frame ${maxFrameChange.toFixed(2)}% (cap ${(BRIGHTNESS_SWING * 100).toFixed(0)}%)`
)

const swingOk = swing >= MIN_SWING_PERCENT - 0.5 && swing <= MAX_SWING_PERCENT + 0.5
if (!swingOk || worstPulseRate > MAX_BRIGHTNESS_CHANGES_PER_SECOND) {
  console.error('brightness safety limits exceeded')
  process.exit(1)
}
console.log(`ok: ${swing.toFixed(1)}% swing at ${worstPulseRate.toFixed(1)} pulses/s across 60-180 BPM`)
