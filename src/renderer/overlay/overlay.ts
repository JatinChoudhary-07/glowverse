import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { MasterClock } from '../../shared/masterClock'
import type { NowPlaying } from '../../shared/nowPlaying'
import { PaletteTransition } from './color'
import { EnergySource } from './energy'
import { FrameStats, QUALITY_TIERS } from './frameStats'
import { RimRenderer } from './glRim'
import { LyricStage } from './lyrics/lyricStage'

const rimCanvas = document.getElementById('rim')
if (!(rimCanvas instanceof HTMLCanvasElement)) throw new Error('Rim canvas missing')
const lyricsElement = document.getElementById('lyrics')
if (!(lyricsElement instanceof HTMLCanvasElement)) throw new Error('Lyric canvas missing')
const lyricCanvas: HTMLCanvasElement = lyricsElement
const lyricContext = lyricCanvas.getContext('2d', { alpha: true })
if (!lyricContext) throw new Error('Lyric canvas context unavailable')
const lyricCtx: CanvasRenderingContext2D = lyricContext

const renderer = new RimRenderer(rimCanvas)
const energy = new EnergySource()
const palette = new PaletteTransition()
const stats = new FrameStats()
const clock = new MasterClock()
const stage = new LyricStage()

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
let reducedMotion = reducedMotionQuery.matches

let settings: Settings | null = null
let nowPlaying: NowPlaying | null = null
let paletteReady = false
let lastTrackId = ''
let lastLinesKey = ''
let lastSeekToken = -1
let running = false
let frameHandle = 0
let lastTimestamp = 0
let elapsedSeconds = 0
let appliedTier = 0
let viewportWidth = 1
let viewportHeight = 1

function applyViewport(): void {
  const cap = QUALITY_TIERS[appliedTier].dprCap
  const dpr = Math.min(window.devicePixelRatio || 1, cap)
  viewportWidth = Math.max(1, window.innerWidth)
  viewportHeight = Math.max(1, window.innerHeight)

  renderer.resize(cap)
  lyricCanvas.width = Math.round(viewportWidth * dpr)
  lyricCanvas.height = Math.round(viewportHeight * dpr)
  lyricCanvas.style.width = `${viewportWidth}px`
  lyricCanvas.style.height = `${viewportHeight}px`
  lyricCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  stage.setMetrics(viewportWidth, viewportHeight, settings?.lyricSize ?? DEFAULT_SETTINGS.lyricSize)
}

function syncPalette(): void {
  const active = settings
  if (!active) return
  const report = nowPlaying
  const useAuto = active.paletteMode === 'auto' && report !== null
  const primary = useAuto && report ? report.palette.primary : active.primaryColor
  const secondary = useAuto && report ? report.palette.secondary : active.secondaryColor
  palette.setPalette(primary, secondary, !paletteReady)
  paletteReady = true
  stage.setAccent(primary)
}

function handleReport(report: NowPlaying): void {
  const now = performance.now()
  const trackChanged = report.trackId !== lastTrackId
  // Lyrics arrive after the first report of a track, so a stable signature tells
  // us when the line set changed without reconfiguring on every 250 ms frame.
  const linesKey = `${report.lines.length}:${report.lines[report.lines.length - 1]?.startMs ?? -1}`
  const linesChanged = linesKey !== lastLinesKey

  if (trackChanged) {
    lastTrackId = report.trackId
    clock.reset(report.positionMs, report.isPlaying, now)
  } else if (clock.report(report.positionMs, report.isPlaying, now)) {
    stage.clear()
  }

  if (trackChanged || linesChanged) {
    lastLinesKey = linesKey
    stage.configure(report.trackId, report.lines)
    // Counts only: lyric text stays out of logs.
    console.info(`[glowverse] overlay lyrics ${report.lines.length} lines`)
  }

  if (report.seekToken !== lastSeekToken && !trackChanged) stage.clear()
  lastSeekToken = report.seekToken

  nowPlaying = report
  syncPalette()
  syncRunning()
}

function frame(timestamp: number): void {
  if (!running) return
  frameHandle = requestAnimationFrame(frame)

  const deltaMs = lastTimestamp === 0 ? 16.7 : Math.min(64, timestamp - lastTimestamp)
  lastTimestamp = timestamp
  elapsedSeconds += deltaMs / 1000

  const active = settings
  if (!active) return

  const report = nowPlaying
  const bpm = report?.bpm ?? 96
  const isPlaying = report?.isPlaying ?? false

  const energyValue = energy.update(deltaMs / 1000, active.motionMode, reducedMotion, bpm, isPlaying)
  palette.update(deltaMs, reducedMotion)

  if (stats.sample(deltaMs) && stats.tier !== appliedTier) {
    appliedTier = stats.tier
    applyViewport()
  }

  renderer.render(
    elapsedSeconds,
    energyValue,
    energy.brightness,
    active.motionMode === 'off' || reducedMotion ? 0 : 1,
    active.thickness,
    active.glow,
    active.cornerRadius,
    palette.primaryRgb,
    palette.secondaryRgb
  )

  const lyricTimeMs = clock.timeMs(performance.now()) - active.lyricOffsetMs
  stage.render(lyricCtx, lyricTimeMs, deltaMs, active.showLyrics && active.overlayEnabled && !active.paused)
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

function applySettings(next: Settings): void {
  settings = next
  stage.setMetrics(viewportWidth, viewportHeight, next.lyricSize)
  syncPalette()
  syncRunning()
}

function watchPixelRatio(): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  query.addEventListener(
    'change',
    () => {
      watchPixelRatio()
      applyViewport()
    },
    { once: true }
  )
}

reducedMotionQuery.addEventListener('change', (event) => {
  reducedMotion = event.matches
})

document.addEventListener('visibilitychange', syncRunning)
window.addEventListener('resize', applyViewport)

watchPixelRatio()
applyViewport()
syncPalette()

window.glowverse.onSettings(applySettings)
window.glowverse.onNowPlaying(handleReport)

void window.glowverse.getSettings().then(applySettings)
void window.glowverse.getNowPlaying().then(handleReport)
