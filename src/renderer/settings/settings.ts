import type { Settings } from '../../shared/settings'
import type { DisplayInfo } from '../../shared/display'

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const overlayToggle = element<HTMLInputElement>('overlayEnabled')
const displaysList = element<HTMLUListElement>('displays')
const status = element<HTMLSpanElement>('status')

interface SliderBinding {
  input: HTMLInputElement
  output: HTMLOutputElement
  key: 'thickness' | 'glow' | 'cornerRadius'
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

let pending: Partial<Settings> = {}
let flushScheduled = false

function applyTheme(settings: Settings): void {
  document.documentElement.style.setProperty('--accent', settings.primaryColor)
}

function render(settings: Settings): void {
  applyTheme(settings)
  // Never fight a control the user is currently touching.
  const active = document.activeElement
  if (active !== overlayToggle) overlayToggle.checked = settings.overlayEnabled
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

overlayToggle.addEventListener('change', () => {
  patch({ overlayEnabled: overlayToggle.checked })
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
    document.documentElement.style.setProperty(color.key === 'primaryColor' ? '--accent' : '--glow-secondary', value)
    patch({ [color.key]: value } as Partial<Settings>)
  })
}

window.glowverse.onSettings((settings) => render(settings))

void window.glowverse.getSettings().then((settings) => {
  render(settings)
  return renderDisplays()
})
