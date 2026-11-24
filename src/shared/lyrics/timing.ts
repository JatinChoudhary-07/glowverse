export interface LyricLine {
  text: string
  startMs: number
}

export interface TimedWord {
  text: string
  startMs: number
  endMs: number
}

export interface TimedLine {
  text: string
  startMs: number
  endMs: number
  words: TimedWord[]
}

/** A word highlight starts this much before its computed slot so it feels in sync. */
export const WORD_HIGHLIGHT_LEAD_MS = 60

const MAX_LINE_MS = 6000
const COMMA_WEIGHT = 0.75

/** Vowel groups, minimum one, as a cheap syllable estimate. */
export function countSyllables(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouy]+/g)
  return groups ? groups.length : 1
}

function weightForWord(word: string): number {
  const pause = /[,;:]$/.test(word) ? COMMA_WEIGHT : 0
  return countSyllables(word) + pause
}

/**
 * Line timing from line starts: a line ends at the earlier of the next line start
 * and its own start plus 6 s. Words split that window by syllable weight, with a
 * small extra weight after commas.
 */
export function buildTimedLines(lines: readonly LyricLine[], maxLineMs = MAX_LINE_MS): TimedLine[] {
  const timed: TimedLine[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const next = lines[index + 1]
    const endMs = Math.min(next ? next.startMs : line.startMs + maxLineMs, line.startMs + maxLineMs)
    const span = Math.max(200, endMs - line.startMs)
    const tokens = line.text.trim().split(/\s+/).filter(Boolean)
    let totalWeight = 0
    for (const token of tokens) totalWeight += weightForWord(token)
    if (totalWeight <= 0) totalWeight = 1

    const words: TimedWord[] = []
    let cursor = line.startMs
    for (const token of tokens) {
      const durationMs = (weightForWord(token) / totalWeight) * span
      words.push({
        text: token,
        startMs: Math.max(line.startMs, cursor - WORD_HIGHLIGHT_LEAD_MS),
        endMs: cursor + durationMs
      })
      cursor += durationMs
    }

    timed.push({ text: line.text, startMs: line.startMs, endMs, words })
  }

  return timed
}
