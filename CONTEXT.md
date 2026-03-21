# Chord Builder — CONTEXT.md

Read this file at the start of every session to understand current project state.

## Current State

The app is functional with a DAW-style continuous step grid timeline (v2 data model). Old measure-based saves auto-migrate on load. No build system, test suite, or CI/CD pipeline exists.

## Feature Progress

| Feature | Status | Module(s) | Notes |
|---|---|---|---|
| Key/mode/capo selection | Done | Controls, Theory | All 7 modes, 12 keys, capo 0-12 |
| Diatonic chord palette | Done | Controls, Theory | Triads + 7ths + sus2/sus4/add9 variants |
| Chord suggestion engine | Done | Theory, Controls | Weighted progression rules per scale degree |
| Chord row (variable duration) | Done | Timeline | Drag from palette, resize handle, positioned by beat |
| Inline step grid | Done | Timeline | 8 rows (strings 1-6 + Bass + Alt-Bass), click/shift/right-click |
| Stamp presets | Done | Tablature, Timeline | Right-click chord → stamp pattern, section-level "Stamp All" |
| Section management | Done | Timeline | Add/delete/reorder sections, +/- beats, subdivisions selector |
| Chord diagram rendering | Done | Diagrams | SVGuitar, full + mini sizes |
| Voicing database | Done | ChordsDB | `voicings.json` + barre chord generation + fallback set |
| Multiple voicings | Done | Controls, ChordsDB | Selectable alt voicings in detail panel |
| Custom chord creator | Done | ChordCreator | Fretboard editor (0-15 frets), auto-detection via Tonal.js |
| Grid-based playback | Done | AudioEngine | Column-by-column from gridState, playhead visualization |
| Transport controls | Done | AudioEngine | Play/pause/stop/loop section |
| Auto-save | Done | Storage | localStorage on every change |
| Named project save/load | Done | Storage | localStorage, dropdown selector |
| JSON export/import | Done | Storage | `.chord-builder.json` files, v1→v2 migration |

## What's Not Built Yet

- No test suite
- No responsive/mobile layout (3-panel grid assumes wide screen)
- No undo/redo system
- No MIDI export
- No sheet music / standard notation view
- No chord progression templates (e.g., "12-bar blues")
- No audio export (WAV/MP3)
- No shareable links or cloud storage
- Enharmonic display is sharps-only (no flats like Db, Eb, etc.)

## Workflow

### Starting a session
1. Read this file and `CLAUDE.md`
2. Check git status for any in-progress work
3. Ask what the user wants to work on

### Making changes
1. Identify which module(s) are affected
2. Respect the IIFE pattern — don't introduce ES modules or a build step
3. Follow the event bus pattern for cross-module communication
4. Test by opening `index.html` in a browser (or local server for voicings.json fetch)

### Testing
No automated tests. Manual testing by opening the app in a browser. For `voicings.json` to load, serve via HTTP (not `file://`) due to fetch API restrictions.

### Key gotchas
- **Script order matters** — adding a new module requires placing the `<script>` tag in the right position in `index.html`
- **String numbering vs array indexing** — positions array index 0 = string 6 (low E). This inversion is a common source of bugs.
- **`Audio` alias** — `AudioEngine` is aliased as `Audio` at the bottom of `audio.js` for use in `controls.js`. Don't shadow the browser's native `Audio` constructor elsewhere.
- **CDN availability** — the app won't work offline; Tonal, SVGuitar, and Tone.js load from jsdelivr CDN
- **Data version** — v2 format uses `chords[]` + `gridState{}` instead of `measures[]`. Old v1 saves are auto-migrated by `migrateV1ToV2()` in app.js.
- **Grid column math** — column = beat × subdivisions. `COL_WIDTH_PX = 28` in timeline.js for pixel positioning.
