import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { RimRenderer } from './rim'

const canvas = document.getElementById('rim')
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Rim canvas missing')

const renderer = new RimRenderer(canvas)
let settings: Settings = DEFAULT_SETTINGS

function draw(): void {
  renderer.render(settings)
}

function handleResize(): void {
  renderer.resize()
  draw()
}

function watchPixelRatio(): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  query.addEventListener(
    'change',
    () => {
      // Rebind to the new ratio, then resize the backing store.
      watchPixelRatio()
      handleResize()
    },
    { once: true }
  )
}

window.addEventListener('resize', handleResize)

watchPixelRatio()
draw()

void window.glowverse.getSettings().then((next) => {
  settings = next
  draw()
})

window.glowverse.onSettings((next) => {
  settings = next
  draw()
})
