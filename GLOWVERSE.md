GLOWVERSE MASTER PROMPT

ROLE
You are a senior desktop engineer and motion designer. Build Glowverse, a desktop overlay for Windows (primary) and macOS (secondary). It draws an ambient rim glow around the screen edges that moves with the music, plus animated word by word lyrics in the center. Work through the milestones at the bottom. After each milestone, run the app, fix every error, test it, commit, and report in two lines what works. Ask me a question only if you are blocked.

LOOK AND FEEL
Quiet, clean, premium. A fully transparent overlay with thin glowing edges and large soft typography. No panels, borders or labels on the overlay. Only light and words. Every change on screen must ease in and out. Nothing snaps, flickers or pops.

STACK
Electron (latest stable), TypeScript, Vite. Vanilla TypeScript for the UI, no heavy framework. WebGL2 for the rim, Canvas 2D for lyrics. Folders: src/main, src/renderer/overlay, src/renderer/settings, src/shared, extension. Use camelCase file names. Save settings as JSON in the Electron userData folder.

OVERLAY WINDOWS
One frameless, transparent, mouse transparent, always on top overlay per display, sized to that display's bounds. Use setIgnoreMouseEvents(true), focusable false, skipTaskbar, no shadow, and the highest always on top level so it shows over fullscreen apps where the OS allows. React to displays being added, removed or changed. Respect the display scale factor and cap device pixel ratio at 2.

NOW PLAYING MODEL
Every source adapter emits: source, title, artist, album, durationMs, positionMs, isPlaying, artUrl, updatedAt. One master clock, songTimeMs(), equals the last reported position plus the time elapsed since that report while playing. Position reports arrive about every 250 ms. If the drift error is under 120 ms, ignore it. Between 120 and 800 ms, absorb it by easing over 400 ms. Above 800 ms treat it as a seek: snap and crossfade the lyric state. Add a per track lyric offset in 100 ms steps that resets on track change.

SOURCES, IN PRIORITY ORDER
1. YT Music (primary). Build a Chrome and Edge extension (Manifest V3) for music.youtube.com. A content script reads navigator.mediaSession.metadata and the page video element (currentTime, paused, duration) every 250 ms and on play, pause, seeked and track change events. It sends the data to the background worker, which posts it to a local HTTP endpoint inside the app. The endpoint binds to 127.0.0.1 only and accepts only requests carrying a pairing token. The app shows the token with a Copy button in settings. Download the largest available artwork in the main process and cache it.
2. Spotify. On Windows, read the System Media Transport Controls (SMTC) through a small native helper or a well maintained npm package (verify it exists and builds before using it). This covers the Spotify desktop app with no login. Also add an optional Spotify Web API adapter using OAuth with PKCE and a loopback redirect on 127.0.0.1 (never localhost), with the scopes for reading currently playing and playback state. Poll every 1 to 2 seconds and interpolate the position. The user supplies their own client ID in settings.
3. If the extension is not connected, an option called "Treat browser media as YT Music" lets the SMTC adapter supply YT Music from a browser session.
macOS note: SMTC is Windows only, and the private MediaRemote route is restricted on recent macOS. On Mac use the extension for YT Music and the Web API for Spotify.
Source choice: pick the highest priority adapter that is playing. The order is user configurable, default YT Music then Spotify. Switch sources only after the new candidate has been stable for 1500 ms. When nothing plays, hold the last track as paused and fade the overlay to a dim idle after 8 seconds.

LYRICS ENGINE
1. Use a provider interface with LRCLIB first (free, no key, send a proper User Agent header). Query by title, artist, album and duration, then fall back to search. Clean titles and artists first: strip feat tags, remaster, live, version and bracket suffixes.
2. Cache every result on disk, including misses, with an expiry. Never bundle real song lyrics in the repo, tests or screenshots.
3. LRCLIB gives line timing only, so estimate word timing. For line i, the end is the earlier of the next line start and the start plus 6 seconds. Split that window across words, weighted by syllable count (count vowel groups, minimum 1) plus a small extra weight after commas. Start each word highlight about 60 ms early so it feels in sync.
4. If a track has no synced lyrics, show only the rim glow. No error text on the overlay. Show the status in the settings window.
5. Keep the provider interface open so word level providers can be added later.
6. Demo mode: three built in tracks with original lyrics so everything can be tested with no music playing. Track 1 is "Neon Hours", 96 BPM, pink to blue, four lines at 3 second spacing: "The city hums beneath my skin", "We trade the dark for neon light", "Hold the chorus, let it in", "Everything is glowing tonight". Write two more tracks in the same format with new original lines.

AUDIO AND BEAT
Capture system output audio (loopback) in the renderer using getDisplayMedia, handled by setDisplayMediaRequestHandler with audio set to loopback. Windows first. Check the Electron docs for macOS support and permission needs. Never capture the microphone. Use an AnalyserNode with FFT 2048 and smoothing 0. Compute low band energy (40 to 150 Hz) and overall energy. A beat is low energy above 1.3 times its rolling one second mean, with at least 250 ms between beats. Do not drive visuals with raw beats. Produce one continuous energy value with fast attack (40 ms) and slower release (280 ms), then smooth it again with a damped spring. If loopback is unavailable, fall back to a slow breathing idle glow. Audio is never stored or sent anywhere.

RIM GLOW (WebGL2)
One full screen quad per overlay. In the fragment shader compute the signed distance to a rounded rectangle (corner radius setting, default 14 px). The core line has the thickness setting (default 14 px) with a soft edge. The glow is an exponential falloff inward, with spread scaled by the glow setting and by energy. Color is a mix of primary (60 percent) and secondary (40 percent) that drifts slowly around the perimeter over time. Add small dithering noise to prevent banding in dark gradients. Output premultiplied alpha.
Colors come from the album art: downsample to 64 px and take the two most vivid and distinct dominant colors. Clamp saturation and lightness so they stay luminous but never white. Crossfade to new colors over 800 ms, interpolating in OKLab. Options: custom color override, idle glow mode, beat sync mode.

LYRIC STYLES
Common interface: LyricStyle with enter(line), update(songTimeMs, wordProgress), exit(). Render on a separate Canvas 2D layer above the rim, clearing only the dirty rectangle each frame. Word highlight is never a binary switch. Each word fills left to right across its own duration with a soft edge and a faint glow. Ship these four, hero first:
1. Constellation (hero). Each line becomes a constellation. Words are stars on a loose left to right path with gentle vertical variation, seeded by a hash of the line so it is stable, fitted to 70 percent of the width and the central 35 percent of the height, with no overlaps. The current word is large, with a small four point star node beside it and a soft glow in the primary color. Upcoming words are tiny dim labels (about 25 percent opacity) with small star nodes. As a word is sung, its label grows to full size over 220 ms, then a thin 1 px line draws from the previous node to it over the word's duration with an ease out curve. Sung words settle to a small size at about 55 percent opacity. At line end the whole constellation fades and drifts 12 px over 350 ms while the next line's nodes fade in with a 25 ms stagger. Idle motion: stars float 1 to 2 px on slow sine waves.
2. Fisheye. A three word stack in the center, middle word largest, scale falling off smoothly with distance from center like a lens, words gliding through.
3. Kinetic Stack. The line is broken into balanced rows in large bold type. Sung words brighten, upcoming words dim. Entrance uses an 8 px rise, opacity, and a light blur that resolves.
4. Thread. Each line arrives as a message bubble in a column. Older bubbles scroll up and fade. Words fill as sung.
Settings: style, size slider, font, position (center or lower third), and which display shows lyrics.

MOTION RULES
1. One requestAnimationFrame loop per overlay, using real delta time. No setInterval for visuals.
2. Everything that changes (energy, colors, positions, opacity, scale) goes through critically damped springs (smoothDamp) or easeOutCubic and easeInOutCubic curves. No overshoot, except at most 3 percent on word entrances.
3. Durations: line enter 350 to 450 ms, exit 250 to 350 ms, track change crossfade 800 ms, source switch crossfade 600 ms.
4. No allocations inside the render loop. Reuse arrays and objects.
5. Track frame time. If the average over 2 seconds is above 18 ms, step quality down one tier (lower pixel ratio cap, fewer text glow passes, fewer star glows). Step back up only after 10 stable seconds.
6. Pause rendering entirely when the overlay is hidden or fully idle.
7. Respect the OS reduced motion setting: switch to idle glow and plain fades.
8. Photosensitivity safety: never change overall brightness by more than 10 percent more than 3 times per second.

DESIGN LANGUAGE
Black and transparent. Text near white (#F2F2F5), dimmed text at 30 to 55 percent opacity. Fonts: bundled Inter variable (OFL license), weights 600 to 800 for lyrics, falling back to Segoe UI Variable or SF Pro. Settings window: dark, calm, one column of sections with generous spacing, compact sliders, no icon clutter, accent color follows the current album art. Tray menu: Open Glowverse, pinned styles, Show lyrics, Pause overlay, Quit.

SETTINGS
Source order, pairing token, Spotify client ID, palette (auto from art or custom two colors), glow, thickness, corner radius, motion mode (beat sync, idle, off), lyric style, size, font, position, displays for the rim, display for lyrics, lyric offset, start at login, a global hotkey to toggle the overlay, and a live preview that plays the demo track.

MILESTONES (each ends with a test)
M0 Scaffold: app, tray, settings window, overlay per display. Test: a static rim shows on every display and clicks pass through.
M1 Rim shader with demo energy at 96 BPM and palette crossfades. Test: smooth at 60 fps, no banding.
M2 Master clock, lyric timing, Constellation style on the demo track. Test: words fill in time with no jumps.
M3 YT Music extension and local bridge, now playing, album art colors. Test: play a song on music.youtube.com and see its colors on the rim.
M4 LRCLIB lyrics with cache and title cleaning. Test: real synced lyrics appear for three different songs.
M5 Loopback beat detection replaces demo energy. Test: the glow follows a bass heavy song.
M6 Source manager with priority and the SMTC adapter. Test: pausing YT Music while Spotify plays switches sources smoothly.
M7 Spotify Web API adapter.
M8 Fisheye, Kinetic Stack and Thread styles.
M9 Settings polish, hotkey, start at login, Windows installer, Mac dmg.
M10 Performance and QA pass, README with install and run steps.

DONE MEANS
Runs on Windows with no console errors, steady 60 fps on a mid range laptop, under 5 percent CPU while playing, no visible jank at any transition, and the Constellation style matches the reference look described above.