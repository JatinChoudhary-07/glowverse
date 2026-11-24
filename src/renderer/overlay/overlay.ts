import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { PaletteTransition } from './color'
import { EnergySource } from './energy'
import { FrameStats, QUALITY_TIERS } from './frameStats'
import { RimRenderer } from './glRim'

const canvas = document.getElementById('rim')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Rim canvas missing')

const renderer = new RimRenderer(canvas)
const energy = new EnergySource()
const palette = new PaletteTransition()
const stats = new FrameStats()

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let reducedMotion = reducedMotionQuery.matches

let settings: Settings | null = null
let paletteReady = false
let running = false
let frameHandle = 0
let lastTimestamp = 0
let elapsedSeconds = 0
let appliedTier = 0

function frame(timestamp: number): void {
  if (!running) return
  frameHandle = requestAnimationFrame(frame)

  const deltaMs = lastTimestamp === 0 ? 16.7 : Math.min(64, timestamp - lastTimestamp)
  lastTimestamp = timestamp
  elapsedSeconds += deltaMs / 1000

  const active = settings
  if (!active) return

  const energyValue = energy.update(deltaMs / 1000, active.motionMode, reducedMotion)
  palette.update(deltaMs, reducedMotion)

  if (stats.sample(deltaMs) && stats.tier !== appliedTier) {
    appliedTier = stats.tier
    renderer.resize(QUALITY_TIERS[appliedTier].dprCap)
  }

  renderer.render(
    elapsedSeconds,
    energyValue,
    active.motionMode === 'off' || reducedMotion ? 0 : 1,
    active.thickness,
    active.glow,
    active.cornerRadius,
    palette.primaryRgb,
    palette.secondaryRgb
  )
}

function start(): void {
  if (running) return
  running = true
  lastTimestamp = 0
  frameHandle = requestAnimationFrame(frame)
}

function stop(): void {
  if (!running) return
  running = false
  cancelAnimationFrame(frameHandle)
}

function syncRunning(): void {
  const active = settings
  const shouldRun = active !== null && active.overlayEnabled && !active.paused && !document.hidden
  if (shouldRun) start()
  else stop()
}

function handleResize(): void {
  renderer.resize(QUALITY_TIERS[appliedTier].dprCap)
}

function applySettings(next: Settings): void {
  settings = next
  palette.setPalette(next.primaryColor, next.secondaryColor, !paletteReady)
  paletteReady = true
  syncRunning()
}

window.addEventListener('resize', handleResize)

reducedMotionQuery.addEventListener('change', (event) => {
  reducedMotion = event.matches
})

document.addEventListener('visibilitychange', () => {
  syncRunning()
})

renderer.resize(QUALITY_TIERS[0].dprCap)
palette.setPalette(DEFAULT_SETTINGS.primaryColor, DEFAULT_SETTINGS.secondaryColor, true)

window.glowverse.onSettings(applySettings)

void window.glowverse.getSettings().then(applySettings)
