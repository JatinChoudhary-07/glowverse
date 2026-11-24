const SEND_INTERVAL_MS = 250
const MAX_TEXT = 200
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'timeupdate', 'ratechange', 'loadedmetadata', 'durationchange', 'emptied']

let attachedVideo = null
let observedBar = null
let lastUpdate = null

function absoluteUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return new URL(value, location.href).toString()
  } catch {
    return null
  }
}

/** YT Music serves several sizes; ask the image CDN for the biggest one. */
function upgradeArtwork(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const allowed =
      parsed.hostname.endsWith('googleusercontent.com') ||
      parsed.hostname.endsWith('ggpht.com') ||
      parsed.hostname.endsWith('ytimg.com')
    if (!allowed) return parsed.toString()

    if (parsed.hostname === 'i.ytimg.com' && /\/hqdefault\.jpg$/.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/hqdefault\.jpg$/, '/maxresdefault.jpg')
      return parsed.toString()
    }

    parsed.search = parsed.search
      .replace(/([=])w\d+-h\d+/, '$1w1400-h1400')
      .replace(/=s\d+/, '=s1400')
      .replace(/=w\d+-h\d+/, '=w1400-h1400')
    return parsed.toString()
  } catch {
    return null
  }
}

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
  if (best) return upgradeArtwork(absoluteUrl(best))

  const image =
    document.querySelector('ytmusic-player-bar #song-image img') ||
    document.querySelector('#song-image img')
  return image ? upgradeArtwork(absoluteUrl(image.currentSrc || image.src)) : null
}

function readMetadata() {
  const metadata = navigator.mediaSession && navigator.mediaSession.metadata
  if (!metadata || typeof metadata.title !== 'string' || metadata.title.trim().length === 0) return null
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

/** Ads play in the same video element; they are not tracks. */
function isAdPlaying() {
  if (document.querySelector('#movie_player.ad-showing')) return true
  if (document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text.ytp-ad-preview-text')) return true
  const bar = document.querySelector('ytmusic-player-bar')
  return Boolean(bar && bar.hasAttribute('is-ad'))
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

function post(payload) {
  try {
    chrome.runtime.sendMessage({ type: 'glowverse:update', payload })
  } catch {
    // The extension was reloaded; the next tick reconnects.
  }
}

function send() {
  if (isAdPlaying()) {
    // Hold the last real track so an ad never becomes the current track.
    if (lastUpdate) post({ ...lastUpdate, isPlaying: false })
    return
  }

  const update = buildUpdate()
  if (!update) return
  lastUpdate = update
  post(update)
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
