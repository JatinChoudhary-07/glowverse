const PORTS = [47654, 47655, 47656, 47657, 47658]
const TOKEN_KEY = 'glowverseToken'
const PORT_KEY = 'glowversePort'

let token = ''
let activePort = PORTS[0]
let lastSuccess = 0

const ready = chrome.storage.local
  .get([TOKEN_KEY, PORT_KEY])
  .then((stored) => {
    token = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : ''
    if (PORTS.includes(stored[PORT_KEY])) activePort = stored[PORT_KEY]
  })
  .catch(() => {})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'glowverse:update') {
    void forward(message.payload)
    return false
  }

  if (message.type === 'glowverse:pair') {
    token = typeof message.token === 'string' ? message.token.trim() : ''
    void ready.then(() => chrome.storage.local.set({ [TOKEN_KEY]: token }))
    void health().then(sendResponse)
    return true
  }

  if (message.type === 'glowverse:status') {
    void ready.then(() => health()).then(sendResponse)
    return true
  }

  return false
})

function orderedPorts() {
  return [activePort, ...PORTS.filter((port) => port !== activePort)]
}

async function forward(payload) {
  await ready
  if (!token || !payload) return
  for (const port of orderedPorts()) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/now-playing`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Glowverse-Token': token },
        body: JSON.stringify(payload)
      })
      if (response.status === 204) {
        if (port !== activePort) {
          activePort = port
          void chrome.storage.local.set({ [PORT_KEY]: port })
        }
        lastSuccess = Date.now()
        return
      }
      if (response.status === 401 || response.status === 403) return
    } catch {
      // App not listening on this port; try the next one.
    }
  }
}

async function health() {
  await ready
  if (!token) return { connected: false, hasToken: false, port: activePort, lastSuccess }
  for (const port of orderedPorts()) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1200)
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: { 'X-Glowverse-Token': token },
        signal: controller.signal
      })
      clearTimeout(timer)
      if (response.ok) {
        activePort = port
        return { connected: true, hasToken: true, port, lastSuccess }
      }
      if (response.status === 401 || response.status === 403) {
        return { connected: false, hasToken: true, port, lastSuccess }
      }
    } catch {
      // Try the next port.
    }
  }
  return { connected: false, hasToken: true, port: activePort, lastSuccess }
}
