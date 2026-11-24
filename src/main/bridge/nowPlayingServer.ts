import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { parseYtMusicPayload, type YtMusicPayload } from '../../shared/nowPlaying'

/** Fixed port, then a short fallback range when something else holds it. */
const PORTS = [47654, 47655, 47656, 47657, 47658] as const
const MAX_BODY_BYTES = 32 * 1024
const RATE_WINDOW_MS = 1000
const RATE_MAX_REQUESTS = 24
const TOKEN_HEADER = 'x-glowverse-token'
const ALLOWED_HEADERS = 'Content-Type, X-Glowverse-Token'

export interface BridgeServer {
  port: number
  close(): void
  /** Forget the pinned extension origin (used when the token is regenerated). */
  unpair(): void
}

export interface BridgeOptions {
  getToken: () => string
  onUpdate: (payload: YtMusicPayload) => void
}

/**
 * Loopback-only HTTP bridge for the browser extension. Every request needs the
 * pairing token (constant-time compare) and, when an Origin header is present,
 * an extension origin. Bodies are size-limited and requests are rate-limited.
 */
export async function startBridge(options: BridgeOptions): Promise<BridgeServer> {
  const rateTimes: number[] = []
  // The first extension origin that presents the right token is pinned; every
  // other extension origin is rejected until the token is regenerated.
  let pairedOrigin: string | null = null

  const tokenMatches = (provided: string | undefined): boolean => {
    const expected = options.getToken()
    if (!expected || typeof provided !== 'string' || provided.length === 0) return false
    const a = createHash('sha256').update(expected).digest()
    const b = createHash('sha256').update(provided).digest()
    return timingSafeEqual(a, b)
  }

  const originAllowed = (request: IncomingMessage): boolean => {
    const origin = request.headers.origin
    // Browsers always send Origin on cross-origin POSTs; an absent header means a
    // non-browser client, which still has to present the token.
    if (origin === undefined) return true
    return typeof origin === 'string' && origin.startsWith('chrome-extension://')
  }

  const corsHeaders = (request: IncomingMessage): Record<string, string> => {
    const origin = request.headers.origin
    if (typeof origin !== 'string' || !origin.startsWith('chrome-extension://')) return {}
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    }
  }

  const send = (request: IncomingMessage, response: ServerResponse, status: number, body?: unknown): void => {
    const headers: Record<string, string> = { ...corsHeaders(request) }
    if (body === undefined) {
      response.writeHead(status, headers)
      response.end()
      return
    }
    headers['Content-Type'] = 'application/json; charset=utf-8'
    headers['Cache-Control'] = 'no-store'
    response.writeHead(status, headers)
    response.end(JSON.stringify(body))
  }

  const readBody = (request: IncomingMessage, response: ServerResponse): Promise<Buffer | null> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (value: Buffer | null): void => {
        if (settled) return
        settled = true
        resolve(value)
      }
      request.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          send(request, response, 413, { error: 'payload too large' })
          finish(null)
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => finish(Buffer.concat(chunks)))
      request.on('error', () => finish(null))
    })

  const rateLimited = (): boolean => {
    const now = Date.now()
    while (rateTimes.length > 0 && now - rateTimes[0] > RATE_WINDOW_MS) rateTimes.shift()
    if (rateTimes.length >= RATE_MAX_REQUESTS) return true
    rateTimes.push(now)
    return false
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!originAllowed(request)) {
      send(request, response, 403, { error: 'origin not allowed' })
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(request))
      response.end()
      return
    }
    if (rateLimited()) {
      send(request, response, 429, { error: 'too many requests' })
      return
    }
    if (!tokenMatches(request.headers[TOKEN_HEADER] as string | undefined)) {
      send(request, response, 401, { error: 'invalid pairing token' })
      return
    }

    const origin = request.headers.origin
    if (typeof origin === 'string' && origin.startsWith('chrome-extension://')) {
      if (pairedOrigin === null) pairedOrigin = origin
      else if (pairedOrigin !== origin) {
        send(request, response, 403, { error: 'extension origin not paired' })
        return
      }
    }

    const path = (request.url ?? '').split('?')[0]

    if (path === '/v1/health' && request.method === 'GET') {
      send(request, response, 200, { ok: true, app: 'glowverse' })
      return
    }

    if (path !== '/v1/now-playing') {
      send(request, response, 404, { error: 'not found' })
      return
    }
    if (request.method !== 'POST') {
      send(request, response, 405, { error: 'method not allowed' })
      return
    }

    const body = await readBody(request, response)
    if (!body) return

    let parsed: unknown
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      send(request, response, 400, { error: 'invalid JSON' })
      return
    }

    const payload = parseYtMusicPayload(parsed)
    if (!payload) {
      send(request, response, 422, { error: 'invalid now playing payload' })
      return
    }

    options.onUpdate(payload)
    send(request, response, 204)
  }

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('[glowverse] bridge request failed', error)
      if (!response.headersSent) send(request, response, 500, { error: 'bridge error' })
      else response.end()
    })
  })
  server.keepAliveTimeout = 5000

  for (const port of PORTS) {
    if (await listen(server, port)) {
      return {
        port,
        close: () => {
          server.close()
        },
        unpair: () => {
          pairedOrigin = null
        }
      }
    }
  }
  throw new Error(`could not bind the bridge on ports ${PORTS.join(', ')}`)
}

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (): void => {
      server.removeListener('listening', onListening)
      resolve(false)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}
