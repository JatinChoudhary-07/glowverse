// Run with: node scripts/testBrightness.ts
// Sweeps 60 to 180 BPM and reports the worst brightness change and change rate
// produced by the demo energy signal (the same value the shader uses).
import {
  BRIGHTNESS_SWING,
  EnergySource,
  MAX_BRIGHTNESS_CHANGES_PER_SECOND
} from '../src/renderer/overlay/energy.ts'

const FRAME_MS = 1000 / 120
const MEASURE_MS = 12000
const WARMUP_FRAMES = 120
const CHANGE_THRESHOLD = 0.01

interface Result {
  bpm: number
  maxChangePercent: number
  changesPerSecond: number
}

function measure(bpm: number): Result {
  const energy = new EnergySource()

  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    energy.update(FRAME_MS / 1000, 'beat', false, bpm, true)
  }

  let previous = energy.brightness
  let lastExtreme = previous
  let direction = 0
  let maxChange = 0
  let changesThisSecond = 0
  let maxChangesInSecond = 0
  let secondIndex = 0

  const frames = Math.round(MEASURE_MS / FRAME_MS)
  for (let frame = 0; frame < frames; frame += 1) {
    energy.update(FRAME_MS / 1000, 'beat', false, bpm, true)
    const value = energy.brightness
    const relativeChange = Math.abs(value - previous) / previous
    if (relativeChange > maxChange) maxChange = relativeChange

    const step = value - previous
    if (step !== 0) {
      const nextDirection = step > 0 ? 1 : -1
      if (direction !== 0 && nextDirection !== direction) {
        const swing = Math.abs(value - lastExtreme) / lastExtreme
        if (swing >= CHANGE_THRESHOLD) {
          changesThisSecond += 1
          lastExtreme = value
        }
      }
      direction = nextDirection
    }

    const second = Math.floor((frame * FRAME_MS) / 1000)
    if (second !== secondIndex) {
      if (changesThisSecond > maxChangesInSecond) maxChangesInSecond = changesThisSecond
      changesThisSecond = 0
      secondIndex = second
    }

    previous = value
  }

  if (changesThisSecond > maxChangesInSecond) maxChangesInSecond = changesThisSecond

  return { bpm, maxChangePercent: maxChange * 100, changesPerSecond: maxChangesInSecond }
}

const results: Result[] = []
for (let bpm = 60; bpm <= 180; bpm += 10) results.push(measure(bpm))

console.log('BPM | max change per frame | brightness changes / s')
for (const result of results) {
  console.log(
    `${String(result.bpm).padStart(3)} | ${result.maxChangePercent.toFixed(2).padStart(18)}% | ${String(result.changesPerSecond).padStart(3)}`
  )
}

const worstChange = results.reduce((worst, result) => Math.max(worst, result.maxChangePercent), 0)
const worstRate = results.reduce((worst, result) => Math.max(worst, result.changesPerSecond), 0)
const limitChange = BRIGHTNESS_SWING * 100 + 1

console.log(
  `worst: ${worstChange.toFixed(2)}% change (limit 10%), ${worstRate} changes/s (limit ${MAX_BRIGHTNESS_CHANGES_PER_SECOND})`
)

if (worstChange > limitChange || worstRate > MAX_BRIGHTNESS_CHANGES_PER_SECOND) {
  console.error('brightness safety limits exceeded')
  process.exit(1)
}
console.log('ok: brightness stays within the photosensitivity limits')
