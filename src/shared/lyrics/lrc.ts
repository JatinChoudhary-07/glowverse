import type { TimedLyricLine } from './provider'

const TIMESTAMP = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{2,3}))?\]/g
const OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i

export interface ParsedLrc {
  lines: TimedLyricLine[]
  offsetMs: number
}

/**
 * Parses LRC text: several timestamps per line, two or three fraction digits,
 * an [offset] tag, and metadata/blank lines. Empty lines are dropped and the
 * result is sorted by time.
 */
export function parseLrc(text: string): ParsedLrc {
  let offsetMs = 0
  const lines: TimedLyricLine[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const offsetMatch = OFFSET.exec(rawLine)
    if (offsetMatch) offsetMs = Number(offsetMatch[1])

    const stamps: number[] = []
    let cursor = 0
    TIMESTAMP.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIMESTAMP.exec(rawLine)) !== null) {
      // Only timestamps at the start of the line count; anything before is metadata.
      if (match.index !== cursor) break
      stamps.push(toMilliseconds(match[1], match[2], match[3]))
      cursor = TIMESTAMP.lastIndex
    }
    if (stamps.length === 0) continue

    const content = rawLine.slice(cursor).trim()
    if (content.length === 0) continue

    for (const stamp of stamps) lines.push({ startMs: stamp, text: content })
  }

  const shifted = lines
    .map((line) => ({ startMs: Math.max(0, line.startMs - offsetMs), text: line.text }))
    .sort((left, right) => left.startMs - right.startMs)

  return { lines: shifted, offsetMs }
}

function toMilliseconds(minutes: string, seconds: string, fraction?: string): number {
  const base = Number(minutes) * 60000 + Number(seconds) * 1000
  if (!fraction) return base
  const value = Number(fraction)
  return base + (fraction.length === 2 ? value * 10 : value)
}
