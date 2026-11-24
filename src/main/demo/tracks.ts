import type { LyricLine } from '../../shared/lyrics/timing'

export interface DemoTrack {
  id: string
  title: string
  artist: string
  album: string
  bpm: number
  durationMs: number
  primaryColor: string
  secondaryColor: string
  lines: LyricLine[]
}

const LINE_START_MS = 2000
const LINE_SPACING_MS = 3000

/** Three demo tracks with original lyrics so the app can be tested silently. */
export const DEMO_TRACKS: readonly DemoTrack[] = [
  {
    id: 'demo-neon-hours',
    title: 'Neon Hours',
    artist: 'Glowverse Demo',
    album: 'Demo Session',
    bpm: 96,
    durationMs: 20000,
    primaryColor: '#FF5FA2',
    secondaryColor: '#6F8BFF',
    lines: [
      'The city hums beneath my skin',
      'We trade the dark for neon light',
      'Hold the chorus, let it in',
      'Everything is glowing tonight'
    ].map((text, index) => ({ text, startMs: LINE_START_MS + index * LINE_SPACING_MS }))
  },
  {
    id: 'demo-slow-orbit',
    title: 'Slow Orbit',
    artist: 'Glowverse Demo',
    album: 'Demo Session',
    bpm: 84,
    durationMs: 20000,
    primaryColor: '#3BE0C8',
    secondaryColor: '#7C5CFF',
    lines: [
      'We drift in circles, soft and slow',
      'Gravity is only a suggestion',
      'Every star we pass is someone\'s home',
      'Let the quiet hold us in its orbit'
    ].map((text, index) => ({ text, startMs: LINE_START_MS + index * LINE_SPACING_MS }))
  },
  {
    id: 'demo-paper-satellites',
    title: 'Paper Satellites',
    artist: 'Glowverse Demo',
    album: 'Demo Session',
    bpm: 112,
    durationMs: 20000,
    primaryColor: '#FFB35C',
    secondaryColor: '#FF4D6D',
    lines: [
      'Paper satellites above the street',
      'Folded wings that catch the morning',
      'Send them up with everything we mean',
      'Watch them disappear into the blue'
    ].map((text, index) => ({ text, startMs: LINE_START_MS + index * LINE_SPACING_MS }))
  }
]

export function findDemoTrack(trackId: string): DemoTrack | undefined {
  return DEMO_TRACKS.find((track) => track.id === trackId)
}
