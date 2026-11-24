import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LyricsLookup } from '../../shared/lyrics/provider'

export const CACHE_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const CACHE_MISS_TTL_MS = 24 * 60 * 60 * 1000
export const CACHE_MAX_ENTRIES = 300

interface CacheRecord {
  key: string
  savedAt: number
  expiresAt: number
  lookup: LyricsLookup | null
}

/**
 * One JSON cache of lyric lookups, including misses and instrumentals. Hits live
 * 30 days, misses 24 hours, and the oldest entries are evicted past the cap.
 */
export class LyricsCache {
  private records = new Map<string, CacheRecord>()
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly maxEntries = CACHE_MAX_ENTRIES
  ) {}

  get(key: string): LyricsLookup | null | undefined {
    this.load()
    const record = this.records.get(key)
    if (!record) return undefined
    if (Date.now() >= record.expiresAt) {
      this.records.delete(key)
      this.save()
      return undefined
    }
    return record.lookup
  }

  set(key: string, lookup: LyricsLookup | null, ttlMs: number): void {
    this.load()
    this.records.delete(key)
    this.records.set(key, { key, savedAt: Date.now(), expiresAt: Date.now() + ttlMs, lookup })
    this.evict()
    this.save()
  }

  size(): number {
    this.load()
    return this.records.size
  }

  private evict(): void {
    if (this.records.size <= this.maxEntries) return
    const oldest = [...this.records.values()].sort((left, right) => left.savedAt - right.savedAt)
    for (const record of oldest.slice(0, this.records.size - this.maxEntries)) {
      this.records.delete(record.key)
    }
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const entry of raw as CacheRecord[]) {
        if (typeof entry?.key !== 'string' || typeof entry.expiresAt !== 'number') continue
        this.records.set(entry.key, entry)
      }
    } catch {
      // Missing or unreadable cache starts empty.
    }
  }

  private save(): void {
    const temporary = `${this.file}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(temporary, `${JSON.stringify([...this.records.values()])}\n`, 'utf8')
      renameSync(temporary, this.file)
    } catch (error) {
      console.warn('[glowverse] could not save the lyrics cache', error)
    }
  }
}
