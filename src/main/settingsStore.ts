import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeSettings, type Settings } from '../shared/settings'

export function generatePairingToken(): string {
  return randomBytes(24).toString('base64url')
}

export interface SettingsStore {
  get(): Settings
  patch(partial: Partial<Settings>): Settings
  onChange(listener: (settings: Settings) => void): () => void
  /** Write any pending change immediately (used on quit). */
  flush(): void
}

const SETTINGS_FILE = 'settings.json'
const SAVE_DELAY_MS = 150

function readSettings(file: string): Settings {
  try {
    const raw = readFileSync(file, 'utf8')
    return normalizeSettings(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[glowverse] settings unreadable, starting from defaults', error)
    }
    return normalizeSettings(null)
  }
}

export function createSettingsStore(): SettingsStore {
  const file = join(app.getPath('userData'), SETTINGS_FILE)
  const listeners = new Set<(settings: Settings) => void>()
  let current = readSettings(file)
  let timer: NodeJS.Timeout | null = null
  let dirty = false

  // First run: mint the bridge pairing token before anything can read it.
  if (!current.pairingToken) {
    current = { ...current, pairingToken: generatePairingToken() }
    dirty = true
  }

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!dirty) return
    dirty = false
    const temporary = `${file}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
      renameSync(temporary, file)
    } catch (error) {
      console.error('[glowverse] failed to save settings', error)
    }
  }

  const scheduleSave = (): void => {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, SAVE_DELAY_MS)
  }

  const emit = (): void => {
    for (const listener of listeners) listener(current)
  }

  const store: SettingsStore = {
    get: () => current,
    patch(partial: Partial<Settings>): Settings {
      current = normalizeSettings({ ...current, ...partial })
      scheduleSave()
      emit()
      return current
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    flush
  }

  if (dirty) flush()
  return store
}
