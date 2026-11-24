export const IPC = {
  settingsGet: 'glowverse:settings:get',
  settingsPatch: 'glowverse:settings:patch',
  settingsChanged: 'glowverse:settings:changed',
  tokenRegenerate: 'glowverse:token:regenerate',
  displaysGet: 'glowverse:displays:get',
  nowPlayingGet: 'glowverse:nowplaying:get',
  nowPlayingReport: 'glowverse:nowplaying:report',
  sourceStatusGet: 'glowverse:source:status:get',
  sourceStatus: 'glowverse:source:status',
  demoTracksGet: 'glowverse:demo:tracks',
  demoCommand: 'glowverse:demo:command'
} as const
