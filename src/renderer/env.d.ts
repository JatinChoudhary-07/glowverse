import type { SettingsApi } from '../main/preload/glowverse'

declare global {
  interface Window {
    glowverse: SettingsApi
  }
}

export {}
