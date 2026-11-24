const SEND_INTERVAL_MS = 250
const MAX_TEXT = 200
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'durationchange', 'emptied']

let attachedVideo = null
let observedBar = null
let trackKey = ''

function absoluteUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return new URL(value, location.href).toString()
  } catch {
    return null
  }
}

/** mediaSession exposes every size; the app wants the largest one. */
function largestArtwork(artwork) {
  let best = null
  let bestArea = -1
  for (const entry of artwork) {
    if (!entry || typeof entry.src !== 'string') continue
    let area = 0
    const match = typeof entry.sizes === 'string' ? /^(\d+)x(\d+)$/.exec(entry.sizes) : null
    if (match) area = Number(match[1]) * Number(match[2])
    if (area > bestArea) {
      bestArea = area
      best = entry.src
    }
  }
  if (best) return absoluteUrl(best)

  const image =
    document.querySelector('ytmusic-player-bar #song-image img') ||
    document.querySelector('#song-image img')
  return image ? absoluteUrl(image.currentSrc || image.src) : null
}

function readMetadata() {
  const metadata = navigator.mediaSession && navigator.mediaSession.metadata
  if (!metadata || typeof metadata.title !== 'string' || metadata.title.length === 0) return null
  return {
    title: metadata.title.slice(0, MAX_TEXT),
    artist: String(metadata.artist || '').slice(0, MAX_TEXT),
    album: String(metadata.album || '').slice(0, MAX_TEXT),
    artwork: Array.isArray(metadata.artwork) ? metadata.artwork : []
  }
}

function currentVideo() {
  const videos = document.querySelectorAll('video')
  let best = null
  for (const video of videos) {
    if (!best || (video.duration || 0) > (best.duration || 0)) best = video
  }
  return best
}

function buildUpdate() {
  const video = currentVideo()
  const metadata = readMetadata()
  if (!video || !metadata) return null

  return {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    durationMs: Math.max(0, Math.round((video.duration || 0) * 1000)),
    positionMs: Math.max(0, Math.round((video.currentTime || 0) * 1000)),
    isPlaying: !video.paused && !video.ended,
    artUrl: largestArtwork(metadata.artwork)
  }
}

function send() {
  const update = buildUpdate()
  if (!update) return
  trackKey = `${update.title}\u0000${update.artist}\u0000${update.artUrl || ''}`
  try {
    chrome.runtime.sendMessage({ type: 'glowverse:update', payload: update })
  } catch {
    // The extension was reloaded; the next tick reconnects.
  }
}

function attachVideo(video) {
  if (!video || video === attachedVideo) return
  attachedVideo = video
  for (const name of VIDEO_EVENTS) {
    video.addEventListener(name, send, { passive: true })
  }
}

/** A track change swaps the player-bar title before mediaSession catches up. */
function observePlayerBar() {
  const bar = document.querySelector('ytmusic-player-bar')
  if (!bar || bar === observedBar) return
  observedBar = bar
  const observer = new MutationObserver(() => {
    send()
    setTimeout(send, 200)
  })
  observer.observe(bar, { childList: true, subtree: true, characterData: true })
}

function tick() {
  attachVideo(currentVideo())
  observePlayerBar()
  send()
}

tick()
setInterval(tick, SEND_INTERVAL_MS)
