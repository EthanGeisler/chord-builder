# Chord Builder — Implementation Plan

> 6 remaining features, ordered by implementation priority. Each feature includes detailed steps, gotchas, and verification tests that MUST all pass before marking complete.

---

## Feature 1: Enharmonic Flats Display

### Overview
Currently sharps-only (C#, D#, F#, G#, A#). Add flat equivalents (Db, Eb, Gb, Ab, Bb) via a user toggle. Internal data stays sharps — flats are display-only.

### Files Affected
- `js/theory.js` — Add `KEYS_FLAT`, `displayNote()`, `displayChord()`, `internalNote()`
- `js/controls.js` — Key selector, palette groups, chord names, suggestions
- `js/timeline.js` — Chord block labels
- `js/app.js` — Add `enharmonicMode: 'sharp'` to state, serialize/deserialize
- `index.html` — Toggle select in header
- `css/style.css` — Toggle styling

### Implementation Steps

1. **Add enharmonic mapping to `theory.js`** after the existing `KEYS` array:
   ```js
   const KEYS_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
   const ENHARMONIC_MAP = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };
   const ENHARMONIC_MAP_REVERSE = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
   ```

2. **Add `displayNote(note)` to `theory.js`** — reads `App.state.enharmonicMode`. If `'flat'`, replaces sharp root with flat equivalent. If `'sharp'`, returns as-is.

3. **Add `displayChord(chordName)` to `theory.js`** — extracts root, runs through `displayNote`, reattaches suffix.

4. **Add `internalNote(displayedNote)` to `theory.js`** — converts flat back to sharp for internal storage.

5. **Add `enharmonicMode: 'sharp'` to `App.state`** in `app.js`. Include in `serialize()` and `deserialize()`.

6. **Add toggle in `index.html`** header `.controls-left` after capo:
   ```html
   <div class="control-group">
     <label for="enharmonic-toggle">♭/♯</label>
     <select id="enharmonic-toggle">
       <option value="sharp">Sharps (C#, F#)</option>
       <option value="flat">Flats (Db, Gb)</option>
     </select>
   </div>
   ```

7. **Wire toggle in `controls.js` `init()`** — on change: update `App.state.enharmonicMode`, call `renderPalette()`, emit `songChanged` + `keyModeChanged`. In `stateLoaded` handler, set toggle value.

8. **Update `setupKeySelect()`** in `controls.js` — use `Theory.displayNote(key)` for `opt.textContent`, keep `opt.value` as internal sharp.

9. **Update `renderPalette()`** in `controls.js` — group toggle button text uses `Theory.displayNote(root)`, chord name spans use `Theory.displayChord(variant)`.

10. **Update `showChordDetail()`** in `controls.js` — detail-chord-name uses `Theory.displayChord()`.

11. **Update `updateSuggestions()`** in `controls.js` — chip names use `Theory.displayChord()`.

12. **Update timeline chord block labels** in `timeline.js` — wrap chord name display with `Theory.displayChord()`.

13. **Export new functions** from `theory.js` return object: `displayNote`, `displayChord`, `internalNote`, `KEYS_FLAT`.

### Key Gotchas
- **Internal data stays sharps-only.** Never store flat names in `App.state.key` or `sections[].chords[].chord`.
- **`ChordsDB.getVoicings()` already handles enharmonic aliases** — voicing lookup works regardless.
- **Script load order:** `theory.js` loads before `controls.js` so `Theory.displayChord` is available.

### Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Open app fresh | Key selector shows C, C#, D, D#, E, F, F#, G, G#, A, A#, B |
| 2 | Toggle to "Flats" | Key selector shows C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, B |
| 3 | Check palette in flat mode | C# group header reads "Db", chords read "Db", "Dbm", "Db7", etc. |
| 4 | Place C# chord, toggle to flats | Timeline block label reads "Db" |
| 5 | Click C# chord in flat mode | Detail panel title reads "Db" |
| 6 | Select A#m, check suggestions | Suggestion chips show flat names |
| 7 | Select "Gb" in flat mode | `App.state.key` is `'F#'` internally. Palette shows correct diatonic chords |
| 8 | Toggle to flats, reload page | Flat mode is restored from autosave |
| 9 | Export JSON in flat mode | File contains sharp names internally. Import back → flat display works |
| 10 | Drag "Ebm" to timeline | Plays correct notes. `App.state.sections[0].chords[0].chord` is `'D#m'` |
| 11 | Toggle back to sharps | Everything reverts to sharp display |

---

## Feature 2: Chord Progression Templates

### Overview
Pre-built templates (12-bar blues, I-V-vi-IV pop, ii-V-I jazz, etc.) that populate a section with correct chords in the current key/mode, optionally with a default strum pattern.

### Files Affected
- **New: `js/templates.js`** — Template definitions and `applyTemplate()` logic
- `js/timeline.js` or `js/controls.js` — UI trigger
- `index.html` — Script tag (after `theory.js` + `tablature.js`, before `timeline.js`), UI button
- `css/style.css` — Template picker styles

### Implementation Steps

1. **Create `js/templates.js` as IIFE singleton** with `PROGRESSION_TEMPLATES`:
   ```js
   'pop-1564':      { name: 'I-V-vi-IV (Pop)',        degrees: [1,5,6,4],                    beatsPerChord: 4, totalBeats: 16, defaultStamp: 'down-up' }
   'blues-12bar':   { name: '12-Bar Blues',            degrees: [1,1,1,1,4,4,1,1,5,4,1,5],    beatsPerChord: 4, totalBeats: 48, defaultStamp: 'all-down', chordType: '7' }
   'jazz-251':      { name: 'ii-V-I (Jazz)',           degrees: [2,5,1],                       beatsPerChord: 4, totalBeats: 12, defaultStamp: null, chordType: '7th' }
   'folk-1454':     { name: 'I-IV-V-IV (Folk)',        degrees: [1,4,5,4],                     beatsPerChord: 4, totalBeats: 16, defaultStamp: 'travis-full' }
   'minor-1-6-3-7': { name: 'i-VI-III-VII (Minor)',   degrees: [1,6,3,7],                     beatsPerChord: 4, totalBeats: 16, defaultStamp: 'down-up' }
   'canon':         { name: 'I-V-vi-iii-IV-I-IV-V',   degrees: [1,5,6,3,4,1,4,5],            beatsPerChord: 4, totalBeats: 32, defaultStamp: 'pima-full' }
   'andalusian':    { name: 'i-VII-VI-V (Andalusian)', degrees: [1,7,6,5],                     beatsPerChord: 4, totalBeats: 16, defaultStamp: null }
   ```

2. **Implement `applyTemplate(templateKey, sectionIdx)`:**
   - Get diatonic chords via `Theory.getDiatonicChords(App.state.key, App.state.mode)`.
   - For each degree: lookup `diatonic[degree - 1]`. Use `.triad` default, `.seventh` if `chordType: '7th'`, or `root + '7'` if `chordType: '7'` (blues dominant 7th).
   - Build `chords[]` with correct `startBeat` and `durationBeats`.
   - Set `section.totalBeats`. Optionally stamp default pattern via `Tablature.stampPresetToGrid()`.

3. **Add "Templates" button** next to "+ Add Section" in timeline header. On click, show dropdown listing templates.

4. **Add script tag** in `index.html` after `tablature.js`, before `timeline.js`.

5. **Handle overwrite vs new section** — if a section is selected, `confirm()` replace or create new. If none selected, create new.

### Key Gotchas
- **Mode matters.** Minor mode degree 1 = minor chord. `getDiatonicChords()` handles this.
- **12-bar blues uses dominant 7ths** (A7, D7, E7), NOT diatonic sevenths. Template `chordType: '7'` means "root + '7'".
- **Script load order:** `templates.js` needs `Theory` and `Tablature`, must load after both.
- **Stamp preset names** must match keys in `Tablature.STAMP_PRESETS`.

### Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Key=C, major, apply "I-V-vi-IV" | Section has C, G, Am, F (4 beats each) |
| 2 | Key=G, major, apply same | G, D, Em, C |
| 3 | Key=A, minor, apply "I-V-vi-IV" | Am, Em, C, Dm |
| 4 | Key=E, apply 12-bar blues | 12 chords: E7,E7,E7,E7,A7,A7,E7,E7,B7,A7,E7,B7. totalBeats=48 |
| 5 | Key=A#, major, apply jazz ii-V-I | Cm7, F7, A#maj7 (seventh qualities) |
| 6 | Apply folk template | gridState populated with travis-full pattern |
| 7 | Apply jazz ii-V-I (null stamp) | gridState is empty |
| 8 | Select section with chords, apply template | Old chords replaced |
| 9 | No section selected, apply template | New section appended |
| 10 | Apply template → press Play | Correct notes at correct timing |
| 11 | Apply template → Ctrl+Z | Section reverts to previous state |

---

## Feature 3: MIDI Export

### Overview
Export song as Standard MIDI File (.mid). Walk grid columns, resolve voicings to MIDI notes, encode as SMF format 0.

### Files Affected
- **New: `js/midi-export.js`** — MIDI binary writer + export logic
- `js/tablature.js` — Read-only: `stringToNote()`, `OPEN_STRING_MIDI[]`, `resolveStrings()`
- `index.html` — Script tag, button
- `css/style.css` — Button styling

### Implementation Steps

1. **Create `js/midi-export.js` as IIFE singleton.**

2. **Implement MIDI binary writer utilities:**
   - `writeVarLen(value)` — variable-length quantity encoding
   - `writeUint16BE(val)` / `writeUint32BE(val)` — big-endian integers
   - These are well-documented standard algorithms.

3. **Implement `noteNameToMidi(name)` helper:**
   ```js
   function noteNameToMidi(name) {
     const NOTE_MAP = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
     const match = name.match(/^([A-G]#?)(\d+)$/);
     if (!match) return null;
     return (parseInt(match[2]) + 1) * 12 + NOTE_MAP[match[1]];
   }
   ```

4. **Implement `buildMidiFile()` function:**
   - Header chunk: format 0, 1 track, 480 PPQ.
   - Track chunk with:
     - Tempo meta event: `FF 51 03` + 3-byte microseconds-per-beat (`60000000 / bpm`).
     - Time signature meta event: `FF 58 04` + numerator, denominator power, clocks, 32nds.
     - Walk sections in order, respecting `section.repeat || 1`.
     - Per column: find active chord (match `AudioEngine.findChordAtCol` logic), resolve voicing, get MIDI notes via `Tablature.stringToNote()` + `noteNameToMidi()`.
     - Emit note-on/note-off events with velocity from `gridState` cell value × dynamics multiplier × 127.
     - End-of-track meta event.

5. **Handle column timing:**
   - Ticks per column = `480 / subdivisions`.
   - Delta times: 0 for simultaneous notes at same column, ticks_per_column to next column.

6. **Handle note duration:**
   - Default = 1 column duration (ticks_per_column). Note-off at that point.

7. **Handle bass/alt-bass rows:**
   - Resolve via `Tablature.resolveStrings(['bass'], voicing)` and `['alt-bass']` to get string numbers, then `stringToNote()`.

8. **Build binary Uint8Array** (header + track), create Blob type `audio/midi`, trigger download.

9. **Add button** `<button id="btn-export-midi">MIDI</button>` in `.controls-right`.

10. **Add script tag** after `audio.js`, before `storage.js`. Init wires click handler.

### Key Gotchas
- **String numbering inversion.** `stringToNote(stringNum, voicing, capo)` uses `idx = 6 - stringNum`. Grid row IDs 1-6 are string numbers directly. `'bass'`/`'alt-bass'` must go through `resolveStrings()` first.
- **Capo already handled.** `stringToNote()` adds capo. Do NOT add again in `noteNameToMidi()`.
- **`stringToNote` returns sharp names only.** `noteNameToMidi` must handle sharps only (which it does).
- **Section repeats.** `section.repeat` field must be respected.
- **Empty columns** — just advance delta time, no note events.
- **`DYNAMICS_VELOCITY` is private to AudioEngine.** Duplicate the mapping or expose it.

### Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Simple song (C chord, down-strum, 4 beats) → Export MIDI | File downloads as `.mid` |
| 2 | Open .mid in MIDI player | Plays without errors |
| 3 | C chord open position | MIDI notes include correct pitches (E2=40, C3=48, E3=52, G3=55, C4=60, E4=64 subset) |
| 4 | Capo=2, C shape | MIDI notes are D chord pitches (2 semitones higher than open C) |
| 5 | BPM=140 | Tempo meta event = 428571 µs/beat (60000000/140) |
| 6 | Verse + Chorus sections | MIDI plays both sequentially |
| 7 | Section repeat=2 | MIDI plays section twice |
| 8 | Dynamics pp vs ff | MIDI velocities differ proportionally |
| 9 | Cell velocity 0.5 vs 1.0 | MIDI velocities differ |
| 10 | Empty song (no chords/grid) | Valid .mid file with just header+tempo, no notes |
| 11 | Time signature 3/4 | MIDI time sig event reads 3/4 |
| 12 | Multi-section complex song | MIDI plays all sections correctly |

---

## Feature 4: Audio Export (WAV)

### Overview
Render song to downloadable WAV using `Tone.Offline`. Uses PolySynth for reliable offline rendering (sampled instruments have async loading issues in offline context).

### Files Affected
- **New: `js/audio-export.js`** — Offline rendering + WAV encoder
- `js/audio.js` — Reference for `findChordAtCol`, dynamics mapping
- `index.html` — Script tag, button
- `css/style.css` — Button/progress styles

### Implementation Steps

1. **Create `js/audio-export.js` as IIFE singleton.**

2. **Implement `getSongDurationSeconds()`:**
   ```js
   function getSongDurationSeconds() {
     let totalBeats = 0;
     App.state.sections.forEach(s => { totalBeats += s.totalBeats * (s.repeat || 1); });
     return totalBeats * App.getBeatDuration();
   }
   ```

3. **Implement `buildNoteSchedule()`** — pre-compute all notes before entering offline context:
   - Walk sections → repeats → columns → grid rows.
   - For each active cell: resolve voicing, get note name via `Tablature.stringToNote()`, compute time offset.
   - Return array of `{ time, note, duration, velocity }`.

4. **Implement `exportWAV()`:**
   ```js
   async function exportWAV() {
     const schedule = buildNoteSchedule();
     const duration = getSongDurationSeconds() + 1; // +1s release tail
     const buffer = await Tone.Offline(({ transport }) => {
       const synth = new Tone.PolySynth(Tone.Synth, {
         maxPolyphony: 24,
         options: { oscillator: { type: 'triangle8' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.8 } }
       }).toDestination();
       schedule.forEach(({ time, note, duration, velocity }) => {
         synth.triggerAttackRelease(note, duration, time, velocity);
       });
     }, duration);
     const wav = audioBufferToWav(buffer);
     downloadBlob(wav, (App.state.projectName || 'untitled') + '.wav');
   }
   ```

5. **Implement `audioBufferToWav(buffer)`** — standard WAV encoder (~50 lines): RIFF header + PCM 16-bit data from AudioBuffer channels.

6. **Implement `downloadBlob(blob, filename)`** — create object URL, click hidden `<a>`.

7. **Add button** `<button id="btn-export-wav">WAV</button>` in `.controls-right`. Show "Rendering..." during export, disable button.

8. **Add script tag** after `audio.js`, before `storage.js`.

### Key Gotchas
- **`Tone.Offline` creates separate audio context.** Must create instruments inside the callback.
- **Sampled instruments won't load reliably in offline context.** Use PolySynth for v1.
- **`DYNAMICS_VELOCITY` is private to AudioEngine.** Duplicate or expose.
- **Tone.js v14 `Tone.Offline`** returns `Promise<ToneAudioBuffer>`. Access raw AudioBuffer via `.get()`.
- **WAV file size:** 3 min at 44100Hz stereo 16-bit ≈ 30MB.

### Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Simple song → Export WAV | File downloads as `.wav` |
| 2 | Open WAV in audio player | Plays without errors |
| 3 | C chord | Audio sounds like C chord |
| 4 | Capo=3, C shape | Audio sounds like Eb chord |
| 5 | BPM=60, 4 beats | WAV ≈ 4-5 seconds long |
| 6 | 2 sections | WAV contains both in sequence |
| 7 | pp vs ff dynamics | Audibly different volume levels |
| 8 | Empty song | Valid silent WAV file |
| 9 | 4 sections, 32 beats each | Export completes, plays fully |
| 10 | During export | Button shows "Rendering...", disabled. Returns to normal after |

---

## Feature 5: Responsive/Mobile Layout

### Overview
3-panel layout → tab-based single panel on mobile, 2-panel on tablet. Touch-friendly grid controls.

### Files Affected
- `css/style.css` — Media queries, touch targets
- `index.html` — Mobile tab nav
- `js/timeline.js` — Touch event handlers, dynamic `COL_WIDTH_PX`
- `js/controls.js` — Panel toggle logic, touch chord placement

### Implementation Steps

1. **Define breakpoints:** mobile ≤768px (single panel + tabs), tablet 769-1024px (narrower palette), desktop 1025px+ (unchanged).

2. **Add mobile tab nav** in `index.html` before `<main>`:
   ```html
   <nav id="mobile-nav" class="mobile-only">
     <button class="mobile-tab active" data-panel="chord-palette">Chords</button>
     <button class="mobile-tab" data-panel="song-timeline">Timeline</button>
     <button class="mobile-tab" data-panel="chord-detail">Detail</button>
   </nav>
   ```

3. **Add mobile CSS** with `@media (max-width: 768px)`:
   - Show `#mobile-nav`, hide inactive panels via `.mobile-active` class
   - `#app-main` → single column
   - Header wraps, hide h1, reduce padding
   - Larger grid cells for touch

4. **Add tablet CSS** `@media (769px - 1024px)`:
   - Narrower palette (200px), keep 3-panel

5. **Wire tab switching** in `controls.js` init — click handler toggles `.mobile-active` on panels.

6. **Add touch events to grid** in `timeline.js`:
   - `touchstart` on grid cell → toggle (same as click)
   - Long-press (500ms) → enter selection mode
   - `touchmove` → extend selection
   - `touchend` → finalize

7. **Increase grid cell size on mobile** — detect via `matchMedia`, set `COL_WIDTH_PX = 40`.

8. **Replace drag-and-drop for mobile** — HTML5 DnD doesn't work on touch. Add tap-to-select chord in palette, tap-to-place on timeline chord row.

9. **Handle header overflow** — wrap controls, put less-used ones behind "More" button on small screens.

### Key Gotchas
- **HTML5 drag-and-drop does NOT work on mobile.** Must implement touch alternative for chord placement.
- **`COL_WIDTH_PX` is used everywhere** for positioning. Changing it must propagate to chord blocks, grid, playhead.
- **SVGuitar diagrams may overflow** — reduce size on mobile.
- **`mousedown`/`mousemove` in timeline.js** for marquee — must add parallel touch handlers.

### Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Desktop 1200px+ | Layout identical to current 3-panel |
| 2 | Mobile 375px: tabs visible | Three tabs: Chords, Timeline, Detail. Tap switches panels |
| 3 | Mobile: timeline scrolls | Horizontal scroll shows all columns |
| 4 | Mobile: tap grid cell | Toggles on/off |
| 5 | Mobile: long-press grid cell | Enters selection mode with visual feedback |
| 6 | Mobile: place chord | Tap chord in palette → switch to Timeline → tap chord row → chord placed |
| 7 | Tablet 900px | Palette narrower, all 3 panels visible |
| 8 | Mobile: header wraps | All controls accessible, no overflow |
| 9 | Mobile: playback | Play button works, playhead visible, audio plays |
| 10 | Mobile: chord diagram | Fits within screen width in Detail tab |
| 11 | Touch scroll vs grid | Can scroll timeline without triggering cell interactions |
| 12 | Orientation change | Layout adjusts, no overflow |

---

## Feature 6: Shareable Links / Cloud Storage

### Overview
Phase 1: URL-based sharing (compressed state in URL hash, no backend). Phase 2: cloud storage via proxy server with short IDs.

### Files Affected
- **New: `js/sharing.js`** — URL encode/decode, share UI
- `js/app.js` — serialize/deserialize hooks
- `js/storage.js` — Check hash on init
- `index.html` — Script tag, share button
- `css/style.css` — Share modal
- `proxy/server.js` — (Phase 2) API endpoints

### Implementation Steps

#### Phase 1: URL Sharing

1. **Create `js/sharing.js` as IIFE singleton.**

2. **Implement `encodeStateToHash()`:**
   - `App.serialize()` → gzip via `CompressionStream` → base64url encode → return string.

3. **Implement `decodeHashToState(hash)`:**
   - base64url decode → decompress via `DecompressionStream` → JSON string → `App.deserialize()`.

4. **Add "Share" button** in `.controls-right`. On click: generate URL with `#data=<encoded>`, show modal with copyable link.

5. **Wire URL loading** in `storage.js` `main()` — before autosave restore, check `window.location.hash` for `#data=`. If found, decode and load, then clear hash via `history.replaceState`.

6. **Handle URL length limits** — warn if > 2000 chars, suggest file export as fallback.

7. **Add script tag** before `storage.js` (must be available when `main()` runs).

#### Phase 2: Cloud Storage

8. **Add API endpoints** to `proxy/server.js`:
   - `POST /api/share` — store JSON, return short ID (8-char alphanumeric)
   - `GET /api/share/:id` — return stored JSON
   - Storage: SQLite or JSON files. 30-day expiration.

9. **Update sharing.js** — on Share, POST to API, get short URL `#s=<id>`. On load, detect `#s=`, fetch from API.

10. **Add rate limiting** (10/min) and max payload size (100KB).

### Key Gotchas
- **`CompressionStream` support:** Chrome 80+, Firefox 113+, Safari 16.4+. Consider `pako` CDN fallback.
- **URL hash** is better than query params — not sent to server, no page reload.
- **`main()` runs immediately.** Hash check must be inside `main()` before autosave restore. Since decompression is async, `main()` must await it.
- **Large songs exceed URL limits.** Detect and warn.
- **No auth for cloud storage** — add rate limiting and size limits to prevent abuse.

### Verification Tests

#### Phase 1

| # | Test | Expected |
|---|------|----------|
| 1 | Create song → click Share | Modal shows URL with `#data=...` |
| 2 | Click Copy in modal | URL copied to clipboard |
| 3 | Open shared URL in new tab | Song loads with all data (chords, grid, key, mode, capo, BPM) |
| 4 | After loading from hash | URL clears to clean path |
| 5 | Large song (10 sections) → Share | Warning if URL > 2000 chars |
| 6 | Loading shared URL | Existing autosave not destroyed (confirm dialog or load as temp) |
| 7 | Navigate to `#data=garbage` | Graceful error, loads autosave instead |
| 8 | Share empty project | URL works, loads default state |

#### Phase 2

| # | Test | Expected |
|---|------|----------|
| 9 | Share → short URL generated | URL like `#s=abc12345`, loads in new tab |
| 10 | Access 31-day-old share | Friendly error message |
| 11 | 10+ shares per minute | 429 rate limit error |
| 12 | Share 200KB song | Server rejects with size error |

---

## Implementation Order & Dependencies

```
Feature 1: Enharmonic Flats    (standalone, no deps)
    ↓
Feature 2: Chord Templates     (needs Theory from F1 working)
    ↓
Feature 3: MIDI Export          (standalone, needs Tablature understanding)
    ↓
Feature 4: Audio Export         (shares note scheduling logic with F3)
    ↓
Feature 5: Mobile Layout        (standalone, CSS-heavy, test with all above)
    ↓
Feature 6: Shareable Links      (needs all features stable first)
```

## Critical Cross-Cutting Concerns

- **String numbering inversion:** Array index 0 = string 6 (low E). Grid row IDs 1-6 = string numbers. `'bass'`/`'alt-bass'` resolve via `Tablature.resolveStrings()`.
- **Capo only affects audio:** `getVoicings()` returns raw shapes. `stringToNote()` adds capo. Never double-apply.
- **Guitar samples load async:** `getSynth()` returns null until ready. Audio export uses PolySynth to avoid this.
- **IIFE pattern:** No ES modules. All cross-module communication via `App.emit()`/`App.on()`.
- **Script load order matters:** New files must be placed correctly in `index.html`.
- **Undo/redo:** All features that mutate state must emit `songChanged` so History captures snapshots.
