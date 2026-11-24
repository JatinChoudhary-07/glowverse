import type { DisplayInfo } from '../../shared/display'
import type { DemoCommand, DemoTrackSummary, NowPlaying, SourceStatus } from '../../shared/nowPlaying'
import type { Settings } from '../../shared/settings'

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const overlayToggle = element<HTMLInputElement>('overlayEnabled')
const lyricsToggle = element<HTMLInputElement>('showLyrics')
const motionSelect = element<HTMLSelectElement>('motionMode')
const paletteModeSelect = element<HTMLSelectElement>('paletteMode')
const cyclePaletteButton = element<HTMLButtonElement>('cyclePalette')
const displaysList = element<HTMLUListElement>('displays')
const status = element<HTMLSpanElement>('status')

const sourceDot = element<HTMLSpanElement>('sourceDot')
const sourceDetail = element<HTMLElement>('sourceDetail')
const tokenCode = element<HTMLElement>('pairingToken')
const copyTokenButton = element<HTMLButtonElement>('copyToken')
const regenerateTokenButton = element<HTMLButtonElement>('regenerateToken')

const demoTrackSelect = element<HTMLSelectElement>('demoTrack')
const demoPlayButton = element<HTMLButtonElement>('demoPlay')
const demoTimeLabel = element<HTMLOutputElement>('demoTime')
const demoSeek = element<HTMLInputElement>('demoSeek')

// Temporary M1 palettes so the OKLab crossfade can be auditioned by hand.
const TEST_PALETTES: readonly { primary: string; secondary: string }[] = [
  { primary: '#FF5FA2', secondary: '#6F8BFF' },
  { primary: '#3BE0C8', secondary: '#7C5CFF' },
  { primary: '#FFB35C', secondary: '#FF4D6D' },
  { primary: '#8FE8FF', secondary: '#4A6BFF' }
]
let paletteIndex = 0

interface SliderBinding {
  input: HTMLInputElement
  output: HTMLOutputElement
  key: 'thickness' | 'glow' | 'cornerRadius' | 'lyricSize' | 'lyricOffsetMs'
  format(value: number): string
}

const sliders: SliderBinding[] = [
  {
    input: element<HTMLInputElement>('thickness'),
    output: element<HTMLOutputElement>('thicknessValue'),
    key: 'thickness',
    format: (value) => `${Math.round(value)} px`
  },
  {
    input: element<HTMLInputElement>('glow'),
    output: element<HTMLOutputElement>('glowValue'),
    key: 'glow',
    format: (value) => `${value.toFixed(2).replace(/0$/, '')}×`
  },
  {
    input: element<HTMLInputElement>('cornerRadius'),
    output: element<HTMLOutputElement>('cornerRadiusValue'),
    key: 'cornerRadius',
    format: (value) => `${Math.round(value)} px`
  },
  {
    input: element<HTMLInputElement>('lyricSize'),
    output: element<HTMLOutputElement>('lyricSizeValue'),
    key: 'lyricSize',
    format: (value) => `${Math.round(value)} px`
  },
  {
    input: element<HTMLInputElement>('lyricOffset'),
    output: element<HTMLOutputElement>('lyricOffsetValue'),
    key: 'lyricOffsetMs',
    format: (value) => `${value > 0 ? '+' : ''}${Math.round(value)} ms`
  }
]

const colorInputs: { input: HTMLInputElement; output: HTMLOutputElement; key: 'primaryColor' | 'secondaryColor' }[] = [
  {
    input: element<HTMLInputElement>('primaryColor'),
    output: element<HTMLOutputElement>('primaryValue'),
    key: 'primaryColor'
  },
  {
    input: element<HTMLInputElement>('secondaryColor'),
    output: element<HTMLOutputElement>('secondaryValue'),
    key: 'secondaryColor'
  }
]

let demoState: NowPlaying | null = null
let demoTracks: DemoTrackSummary[] = []
let seekDragging = false

let pending: Partial<Settings> = {}
let flushScheduled = false

function applyTheme(settings: Settings): void {
  document.documentElement.style.setProperty('--accent', settings.primaryColor)
}

function render(settings: Settings): void {
  applyTheme(settings)
  tokenCode.textContent = settings.pairingToken || '—'
  const active = document.activeElement
  if (active !== overlayToggle) overlayToggle.checked = settings.overlayEnabled
  if (active !== lyricsToggle) lyricsToggle.checked = settings.showLyrics
  if (active !== motionSelect) motionSelect.value = settings.motionMode
  if (active !== paletteModeSelect) paletteModeSelect.value = settings.paletteMode
  for (const slider of sliders) {
    if (active !== slider.input) slider.input.value = String(settings[slider.key])
    slider.output.textContent = slider.format(settings[slider.key])
  }
  for (const color of colorInputs) {
    if (active !== color.input) color.input.value = settings[color.key]
    color.output.textContent = settings[color.key]
  }
}

function flushPatch(): void {
  flushScheduled = false
  const payload = pending
  pending = {}
  if (Object.keys(payload).length === 0) return
  void window.glowverse
    .patchSettings(payload)
    .then((saved) => render(saved))
    .catch((error: unknown) => {
      console.error('[glowverse] settings update failed', error)
      status.textContent = 'Could not save settings'
    })
}

function patch(next: Partial<Settings>): void {
  pending = { ...pending, ...next }
  if (flushScheduled) return
  flushScheduled = true
  requestAnimationFrame(flushPatch)
}

function renderSource(next: SourceStatus): void {
  sourceDot.classList.toggle('dot--on', next.connected)
  sourceDetail.textContent = next.connected
    ? `${next.title || 'YT Music'} — ${next.artist || 'Unknown artist'}`
    : 'Not connected — demo tracks available.'
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function renderDemo(report: NowPlaying): void {
  // Demo controls only ever reflect the demo player, never a streamed source.
  if (report.source !== 'demo') return
  demoState = report
  if (document.activeElement !== demoTrackSelect) demoTrackSelect.value = report.trackId
  demoSeek.max = String(report.durationMs)
  const shownPosition = seekDragging || document.activeElement === demoSeek ? Number(demoSeek.value) : report.positionMs
  if (!seekDragging && document.activeElement !== demoSeek) demoSeek.value = String(Math.round(report.positionMs))
  demoTimeLabel.textContent = `${formatTime(shownPosition)} / ${formatTime(report.durationMs)}`
  demoPlayButton.textContent = report.isPlaying ? 'Pause' : 'Play'
}

function sendDemo(command: DemoCommand): void {
  void window.glowverse
    .demoCommand(command)
    .then((report) => renderDemo(report))
    .catch((error: unknown) => {
      console.error('[glowverse] demo command failed', error)
    })
}

async function renderDisplays(): Promise<void> {
  let displays: DisplayInfo[] = []
  try {
    displays = await window.glowverse.getDisplays()
  } catch (error) {
    console.error('[glowverse] could not read displays', error)
    return
  }
  displaysList.replaceChildren(
    ...displays.map((display) => {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = display.label
      if (display.primary) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = 'Primary'
        name.append(badge)
      }
      const meta = document.createElement('span')
      meta.className = 'meta'
      meta.textContent = `${display.width} × ${display.height} · ${Math.round(display.scaleFactor * 100)}%`
      item.append(name, meta)
      return item
    })
  )
  status.textContent = displays.length === 1 ? '1 display' : `${displays.length} displays`
}

async function loadDemoTracks(): Promise<void> {
  try {
    demoTracks = await window.glowverse.getDemoTracks()
  } catch (error) {
    console.error('[glowverse] could not read demo tracks', error)
    return
  }
  demoTrackSelect.replaceChildren(
    ...demoTracks.map((track) => {
      const option = document.createElement('option')
      option.value = track.id
      option.textContent = `${track.title} · ${track.bpm} BPM`
      return option
    })
  )
}

overlayToggle.addEventListener('change', () => {
  patch({ overlayEnabled: overlayToggle.checked })
})

lyricsToggle.addEventListener('change', () => {
  patch({ showLyrics: lyricsToggle.checked })
})

motionSelect.addEventListener('change', () => {
  patch({ motionMode: motionSelect.value as Settings['motionMode'] })
})

paletteModeSelect.addEventListener('change', () => {
  patch({ paletteMode: paletteModeSelect.value as Settings['paletteMode'] })
})

demoPlayButton.addEventListener('click', () => {
  sendDemo({ action: demoState?.isPlaying ? 'pause' : 'play' })
})

demoSeek.addEventListener('input', () => {
  seekDragging = true
  const position = Number(demoSeek.value)
  demoTimeLabel.textContent = `${formatTime(position)} / ${formatTime(demoState?.durationMs ?? 0)}`
})

demoSeek.addEventListener('change', () => {
  seekDragging = false
  sendDemo({ action: 'seek', positionMs: Number(demoSeek.value) })
})

demoSeek.addEventListener('pointerup', () => {
  seekDragging = false
})

demoTrackSelect.addEventListener('change', () => {
  sendDemo({ action: 'select', trackId: demoTrackSelect.value })
})

copyTokenButton.addEventListener('click', () => {
  const token = tokenCode.textContent ?? ''
  if (!token) return
  void navigator.clipboard
    .writeText(token)
    .then(() => {
      status.textContent = 'Pairing token copied'
    })
    .catch((error: unknown) => {
      console.error('[glowverse] could not copy the token', error)
      status.textContent = 'Could not copy the token'
    })
})

regenerateTokenButton.addEventListener('click', () => {
  void window.glowverse
    .regeneratePairingToken()
    .then((saved) => {
      render(saved)
      status.textContent = 'New pairing token generated'
    })
    .catch((error: unknown) => {
      console.error('[glowverse] could not regenerate the token', error)
      status.textContent = 'Could not regenerate the token'
    })
})

cyclePaletteButton.addEventListener('click', () => {
  paletteIndex = (paletteIndex + 1) % TEST_PALETTES.length
  const palette = TEST_PALETTES[paletteIndex]
  patch({ paletteMode: 'custom', primaryColor: palette.primary, secondaryColor: palette.secondary })
})

for (const slider of sliders) {
  slider.input.addEventListener('input', () => {
    const value = Number(slider.input.value)
    slider.output.textContent = slider.format(value)
    patch({ [slider.key]: value } as Partial<Settings>)
  })
}

for (const color of colorInputs) {
  color.input.addEventListener('input', () => {
    const value = color.input.value.toUpperCase()
    color.output.textContent = value
    if (color.key === 'primaryColor') document.documentElement.style.setProperty('--accent', value)
    patch({ [color.key]: value } as Partial<Settings>)
  })
}

window.glowverse.onSettings((settings) => render(settings))
window.glowverse.onNowPlaying((report) => renderDemo(report))
window.glowverse.onSourceStatus((next) => renderSource(next))

void window.glowverse.getSettings().then((settings) => {
  render(settings)
  return Promise.all([renderDisplays(), loadDemoTracks()])
}).then(() => window.glowverse.getNowPlaying()).then((report) => renderDemo(report))

void window.glowverse.getSourceStatus().then((next) => renderSource(next))
