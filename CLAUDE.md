# Chord Builder — CLAUDE.md

## Project Overview

Guitar chord progression builder — vanilla HTML/CSS/JS web app with no build tools or framework. Dark-themed 3-panel layout served as static files.

## Architecture

### Module System

All JS uses the IIFE singleton pattern (`const X = (() => { ... })()`). No ES modules, no bundler. Modules communicate via the `App` event bus (`App.on`/`App.emit`), not direct imports.

### File Structure

```
chord-builder/
├── index.html              # Single page, loads CDN libs + all JS modules
├── css/
│   └── style.css           # All styles, CSS custom properties for theming
├── data/
│   └── voicings.json       # Chord voicing database (fret positions, fingers, barres)
└── js/
    ├── app.js              # Central state store + event bus + v1→v2 migration (load first)
    ├── theory.js           # Music theory engine (scales, modes, progressions)
    ├── chords-db.js        # Voicing lookup, barre generation, custom voicing registry
    ├── diagrams.js         # SVGuitar wrapper (full + mini chord diagrams)
    ├── tablature.js        # Stamp presets, arpeggio patterns, grid helpers, canvas tab renderer
    ├── chord-creator.js    # Modal: interactive fretboard for custom voicings
    ├── timeline.js         # Song timeline: chord row + inline step grid + stamp UI
    ├── controls.js         # Header controls, chord palette, detail panel, suggestions
    ├── audio.js            # Tone.js playback engine (grid-based column playback)
    └── storage.js          # localStorage persistence, JSON export/import, main init
```

### Script Load Order (matters — no module system)

Scripts load in `index.html` order. CDN libs first, then: `app.js` → `theory.js` → `chords-db.js` → `diagrams.js` → `tablature.js` → `chord-creator.js` → `timeline.js` → `controls.js` → `audio.js` → `storage.js`. The `main()` init function lives at the bottom of `storage.js`.

### CDN Dependencies

- **Tonal.js** — music theory (chord detection, note parsing)
- **SVGuitar** — chord diagram SVG rendering
- **Tone.js v14** — Web Audio synthesis and scheduling

### Event Bus Conventions

All cross-module communication goes through `App.emit()` / `App.on()`. Key events:

| Event | Payload | Emitted by |
|---|---|---|
| `stateLoaded` | none | App (deserialize), Storage (new/load) |
| `keyModeChanged` | none | Controls |
| `timeSignatureChanged` | none | Controls |
| `songChanged` | none | Any module that mutates state |
| `chordSelected` | chordName | Controls, Timeline |
| `slotSelected` | `{sIdx, cIdx, chord}` | Timeline |
| `chordPlaced` | `{sIdx, chord}` | Timeline |
| `customVoicingAdded` | entry object | ChordCreator |
| `customVoicingRemoved` | `{id}` | Controls |

### Data Model (v2)

`App.state` is the single source of truth. Serialized with `dataVersion: 2`.

```js
{
  key: 'C',
  mode: 'major',
  capo: 0,
  bpm: 120,
  timeSignature: '4/4',
  sections: [{
    name: 'Verse',
    totalBeats: 16,         // e.g. 4 measures × 4 beats
    subdivisions: 2,        // steps per beat (2=8th, 3=triplet, 4=16th)
    chords: [{              // ordered by startBeat, no overlaps
      chord: 'Am',
      voicingIndex: 0,
      startBeat: 0,
      durationBeats: 4,
    }],
    gridState: {},          // "rowId:col" → velocity (0.5 | 0.7 | 1.0)
    dynamics: 'mf',
  }],
  projectName: 'Untitled',
  customVoicings: [],
  customArpeggios: [],       // kept for serialization, loaded as stamp presets
  // UI state (not serialized):
  selectedSlot: null,        // {sectionIndex, chordIndex}
  selectedChord: null,
  selectedVoicingIndex: 0,
  isPlaying: false,
  isPaused: false,
  loopSection: false,
  playbackPosition: {section: 0, col: 0},
}
```

**Migration:** v1 data (measures-based) is auto-detected on deserialize (missing `dataVersion`) and converted by `migrateV1ToV2()` in app.js. Old strum/arpeggio patterns are stamped into `gridState`.

### Timeline Architecture

The timeline renders each section as:
1. **Section header** — name, dynamics, subdivisions, +/- beats, stamp all, move, delete
2. **Chord row** — horizontal bar where chord blocks are absolutely positioned (drag to place, drag handle to resize)
3. **Beat header** — column labels (1, &, 2, &, etc.)
4. **Step grid** — 8 rows (strings 1-6 + Bass + Alt-Bass) × totalBeats×subdivisions columns
5. **Playhead** — vertical green line during playback

Chord blocks: right-click opens stamp preset context menu. Grid cells: click toggles, shift+click cycles velocity, right-click removes.

### Playback Model

Grid-based: `audio.js` steps through columns one at a time, finds the active chord at each column, resolves strings via voicing, and schedules Tone.js notes. Column timing = `beatDuration / subdivisions`.

### Stamp Presets

`Tablature.STAMP_PRESETS` — unified format for strum and arpeggio patterns. Each preset defines steps relative to one beat (or a `beatsSpan`). `stampPresetToGrid()` tiles the pattern across a chord's column range.

### Voicing Data Format

```js
{
  positions: [fret, fret, fret, fret, fret, fret],  // index 0=low E (6th), 5=high e (1st). -1=muted, 0=open
  fingers:   [0, 0, 0, 0, 0, 0],
  barres:    [{fromString: 6, toString: 1, fret: 1}],
  baseFret:  1,
  label:     'Open C',
}
```

### Coding Conventions

- No TypeScript, no JSX, no build step
- All DOM creation is imperative (`document.createElement`)
- CSS uses custom properties in `:root` for theming (dark theme: `--bg: #1a1a2e`, `--accent: #e94560`)
- `requestAnimationFrame` used for post-DOM-insert rendering (diagrams)
- SVGuitar for chord diagrams (SVG)
- String numbering: 6 = low E, 1 = high e (standard guitar convention)
- Positions array indexing: index 0 = low E (6th string), index 5 = high e (1st string)
- Grid row IDs: 1-6 for strings, 'bass' and 'alt-bass' for special rows

### Deploy

Static files — no build. Serve `index.html` from any static host, local file, or `python -m http.server`. CDN libs loaded at runtime.

### Persistence

- **Auto-save:** every `songChanged` event writes to `localStorage` key `chord-builder-autosave`
- **Named projects:** stored in `localStorage` key `chord-builder-projects`
- **Export/Import:** JSON files with `.chord-builder.json` extension
- **Version migration:** v1 saves auto-migrate to v2 on load
