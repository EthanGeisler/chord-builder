# Music Theory Analysis Panel — Implementation Plan

> A substantial, interactive theory analysis panel that replaces the existing hidden `#section-theory` div. Analyzes chord progressions per-section and whole-song, provides actionable suggestions with click-to-apply, and visualizes harmonic function via Roman numerals, circle of fifths, and a colored function timeline.

---

## 1. Architecture Overview

**Current state:** A hidden `#section-theory` div in the right-side `#chord-detail` aside, rendered by `renderSectionTheory()` and `renderCircleOfFifths()` inside `timeline.js`. Minimal, non-interactive, not toggleable.

**Target state:** A new `TheoryPanel` IIFE singleton module (`js/theory-panel.js`) that replaces `#section-theory` with a full, toggleable analysis panel in the chord detail aside. Toggled by a button, with section-level and song-level analysis tabs.

### Modules affected
- **`js/theory-panel.js`** — NEW — all analysis, suggestion, and visualization logic
- **`js/theory.js`** — MODIFIED — new helpers: chord function classification, pattern detection, substitution generators, transposition
- **`js/timeline.js`** — MODIFIED — remove old `renderSectionTheory`/`renderCircleOfFifths`, emit `sectionSelected` event instead
- **`js/controls.js`** — minor wiring if needed
- **`index.html`** — replace `#section-theory` div with `#theory-panel` markup, add script tag
- **`css/style.css`** — replace old theory styles with new panel styles
- **`js/storage.js`** — add `TheoryPanel.init()` to main()

### New events on App bus
| Event | Payload | Emitted by |
|---|---|---|
| `sectionSelected` | `{ sectionIndex }` | Timeline (section header click) |

### Script load order
`theory-panel.js` loads after `controls.js`, before `history.js`.

---

## 2. Analysis Engine

### 2a. New functions in `theory.js`

**`classifyChordFunction(key, mode, chordName)`**
Returns: `'tonic'` | `'subdominant'` | `'dominant'` | `'borrowed'` | `'chromatic'`

Logic:
- Use existing `findDegree(key, mode, chordName)` to get scale degree
- Degrees 1, 3, 6 → tonic function
- Degrees 2, 4 → subdominant function
- Degrees 5, 7 → dominant function
- If no match, check parallel key (opposite major/minor) → `'borrowed'`
- Otherwise → `'chromatic'`

**`detectProgressionPattern(degrees)`**
Takes array of degree numbers, returns matched pattern name or null.

Known patterns:
- `[1,5,6,4]` — "I-V-vi-IV (Pop)"
- `[1,4,5,4]` — "I-IV-V-IV (Folk)"
- `[6,4,1,5]` — "vi-IV-I-V (Pop variant)"
- `[2,5,1]` — "ii-V-I (Jazz)"
- `[1,4,5]` — "I-IV-V (Blues/Rock)"
- `[1,6,4,5]` — "I-vi-IV-V (50s)"
- `[1,5,6,3,4,1,4,5]` — "Canon progression"
- `[1,7,6,5]` — "Andalusian cadence"

Checks circular rotations (vi-IV-I-V matches I-V-vi-IV rotated).

**`getParallelChords(key, mode)`**
Returns diatonic chords of the parallel key (same root, opposite major/minor). For modal interchange suggestions.

**`getTritoneSubstitution(key, mode, chordName)`**
Returns tritone sub chord (root moved by tritone, dominant 7th quality). Only for dominant-function chords.

**`getRelativeSwap(chordName)`**
Returns relative minor of a major chord or relative major of a minor chord.

**`transposeChord(chordName, semitones)`**
Shift root by semitones using `KEYS` array, preserve quality suffix.

All new functions exported in theory.js return object.

### 2b. Analysis logic in `theory-panel.js`

**`analyzeSectionHarmony(sectionIndex)`** returns:
```js
{
  sectionName: 'Verse',
  chords: [{ chord: 'C', degree: 1, numeral: 'I', function: 'tonic' }, ...],
  patternName: 'I-V-vi-IV (Pop)' | null,
  key: 'C', mode: 'major',
}
```

**`analyzeFullSong()`** returns:
```js
{
  sections: [ ...per-section analyses ],
  allChordRoots: Set,
  harmonicArc: "Verse: I-V-vi-IV. Chorus: vi-IV-I-V. ...",
}
```

---

## 3. Suggestion Engine

Each suggestion is an object:
```js
{
  type: 'new-section' | 'modulation' | 'passing-chord' | 'substitution' | 'turnaround' | 'approach-chord',
  label: string,
  detail: string,
  chords: [string],
  target: {
    sectionIndex: number | null,
    insertAfterChordIndex: number | null,
    replaceChordIndex: number | null,
  },
  apply: Function,
}
```

### 3a. New section suggestions — `suggestNewSections(songAnalysis)`

Logic:
- Check which section types exist (Verse, Chorus, Bridge, Intro, Outro, Pre-Chorus)
- If no Bridge + has Verse + Chorus: suggest Bridge with subdominant-heavy or relative minor center chords
- If no Outro: suggest Outro (repeat last section chords with turnaround ending)
- If no Pre-Chorus + has Verse + Chorus: suggest Pre-Chorus (ii-V or IV-V tension builders)
- If no Intro: suggest Intro (instrumental version of verse chords, or just I chord)

Apply: creates new section with suggested chords, each 4 beats, emits `songChanged`.

### 3b. Modulation suggestions — `suggestModulations(songAnalysis)`

Types:
- Half-step up for final chorus (transpose +1)
- Relative major/minor shift
- Whole-step up (+2)
- Modulation to dominant key (up a fifth, +7 semitones)

Apply: creates new section with transposed chords.

### 3c. Passing chord suggestions — `suggestPassingChords(sectionIndex)`

For each consecutive chord pair:
- If root distance > 2 semitones: suggest chromatic approach chord (1 semitone below target, dom7 quality)
- If degrees non-adjacent (e.g., IV to V): suggest diatonic passing chord between them

Apply: halves duration of preceding chord, inserts passing chord in freed space.

### 3d. Chord substitution suggestions — `suggestSubstitutions(sectionIndex)`

For each chord:
- **Tritone sub:** If dominant (V or V7), suggest bII7
- **Relative minor/major swap:** Major → relative minor, minor → relative major
- **Modal interchange:** Suggest parallel-key equivalent (e.g., in C major, Fm from C minor instead of F)

Apply: replaces chord in place.

### 3e. Turnaround suggestions — `suggestTurnarounds(sectionIndex)`

Logic:
- If section doesn't end on V/V7: suggest adding V7 as final chord
- Classic turnarounds: I-vi-ii-V7, iii-vi-ii-V7
- If followed by section starting on I: specifically suggest V7→I resolution

Apply: replaces last N beats with turnaround chords.

### 3f. Approach chord suggestions — `suggestApproachChords(sectionIndex)`

For each chord:
- Chromatic from below: root - 1 semitone, dom7
- Chromatic from above: root + 1 semitone, dom7
- Diatonic approach: nearest diatonic chord stepping down

Apply: same as passing chords.

---

## 4. Visualizations

### 4a. Roman Numeral Overlay (enhanced)
- Color-coded by harmonic function: tonic=teal, subdominant=amber, dominant=red, borrowed=purple dashed, chromatic=gray dashed
- Clickable: clicking a numeral selects that chord in timeline
- Shows progression pattern name when detected

### 4b. Circle of Fifths (enhanced)
- Interactive SVG with all 12 notes arranged in circle of fifths
- Current key's diatonic region shown as shaded arc (7 consecutive notes)
- Active chords highlighted with colored fills matching function
- Numbered path arrows showing chord order
- Clickable: clicking a node selects that chord for the palette

### 4c. Harmonic Function Timeline (NEW)
- Horizontal bar of colored blocks: tonic=teal, subdominant=amber, dominant=red, borrowed=purple, chromatic=gray
- Width proportional to `durationBeats`
- Roman numeral label inside each block
- Shows tension/resolution flow at a glance

---

## 5. UI/UX Design

### 5a. Panel HTML structure
```html
<div id="theory-panel" class="theory-panel collapsed">
  <button id="btn-toggle-theory" class="theory-toggle-btn">
    Theory Analysis ▾
  </button>
  <div class="theory-panel-content">
    <div class="theory-scope-tabs">
      <button class="theory-tab active" data-scope="section">This Section</button>
      <button class="theory-tab" data-scope="song">Full Song</button>
    </div>
    <div id="theory-section-view" class="theory-view">
      <div class="theory-section-label"></div>
      <div id="theory-function-timeline"></div>
      <div id="theory-numerals"></div>
      <div id="theory-circle"></div>
    </div>
    <div id="theory-song-view" class="theory-view" style="display:none;">
      <div id="theory-song-summary"></div>
      <div id="theory-song-circle"></div>
    </div>
    <div id="theory-suggestions">
      <h4>Suggestions</h4>
      <div class="suggestion-type-tabs">
        <button class="sug-tab active" data-type="all">All</button>
        <button class="sug-tab" data-type="new-section">Sections</button>
        <button class="sug-tab" data-type="substitution">Subs</button>
        <button class="sug-tab" data-type="passing-chord">Passing</button>
        <button class="sug-tab" data-type="turnaround">Turnarounds</button>
        <button class="sug-tab" data-type="modulation">Modulation</button>
      </div>
      <div id="theory-suggestion-list"></div>
    </div>
  </div>
</div>
```

### 5b. Toggle button
At bottom of `#chord-detail`, below `#detail-suggestions`. Click expands/collapses `.theory-panel-content`. Starts collapsed.

### 5c. Suggestion cards
```html
<div class="theory-suggestion-card" data-type="substitution">
  <div class="suggestion-header">
    <span class="suggestion-type-badge" data-type="substitution">Substitution</span>
    <span class="suggestion-label">Tritone sub: replace G7 with Db7</span>
  </div>
  <div class="suggestion-detail">Shares the same guide tones (B and F)...</div>
  <div class="suggestion-chords">
    <span class="suggestion-chord-chip">Db7</span>
  </div>
  <button class="suggestion-apply-btn">Apply</button>
</div>
```

### 5d. Scope toggle
- "This Section": analysis for selected section. If none selected: "Click a section header to analyze."
- "Full Song": aggregate analysis, harmonic arc summary, song-level suggestions.

---

## 6. Implementation Steps

1. **Add new Theory functions to `theory.js`** — `classifyChordFunction`, `detectProgressionPattern`, `getParallelChords`, `getTritoneSubstitution`, `getRelativeSwap`, `transposeChord`. Export all.

2. **Emit `sectionSelected` from Timeline** — In `timeline.js` section header click handler, add `App.emit('sectionSelected', { sectionIndex: sIdx })`.

3. **Create `js/theory-panel.js`** — Full IIFE module with analysis engine, suggestion engine, all visualizations, UI rendering, event handlers.

4. **Update `index.html`** — Replace `#section-theory` div with `#theory-panel` markup. Add `<script src="js/theory-panel.js"></script>` after `controls.js`, before `history.js`.

5. **Remove old theory rendering from `timeline.js`** — Delete `renderSectionTheory()`, `renderCircleOfFifths()`, `hideSectionTheory()`, `CIRCLE_OF_FIFTHS` constant. Remove their calls.

6. **Add `TheoryPanel.init()` to `storage.js`** — In main() init sequence after `Controls.init()`.

7. **Add CSS styles to `style.css`** — Remove old `#section-theory` styles. Add all new panel styles (toggle button, scope tabs, function timeline, suggestion cards, circle of fifths, type badges, mobile responsiveness).

---

## 7. Verification Tests

| # | Test | Expected |
|---|------|----------|
| 1 | Click "Theory Analysis" button | Panel content expands. Click again → collapses |
| 2 | Empty section, click header | Panel shows empty state with diatonic chord suggestions |
| 3 | Section C-G-Am-F in C major, click header | Numerals: I, V, vi, IV. Function timeline: tonic, dominant, tonic, subdominant. Circle highlights C, G, A, F |
| 4 | Same C-G-Am-F progression | Pattern detected: "I-V-vi-IV (Pop)" label shown |
| 5 | Add Bb to section in C major | Numeral shows "bVII" with borrowed/purple styling |
| 6 | Verse (C-G-Am-F) + Chorus (Am-F-C-G), Full Song tab | Summary: "Verse: I-V-vi-IV. Chorus: vi-IV-I-V." Combined circle |
| 7 | Full Song suggestions with Verse+Chorus | "Add a Bridge" card appears. Click Apply → new Bridge section created |
| 8 | Modulation suggestion | "Half-step up" card with transposed chords. Click Apply → new section with +1 semitone chords |
| 9 | Section with C then G, Passing suggestions | "Add Dm (ii) between C and G" card. Click Apply → C halved, Dm inserted |
| 10 | Section with G7, Substitution suggestions | "Tritone sub: replace G7 with Db7". Click Apply → G7 replaced |
| 11 | Section with C, Substitution suggestions | "Relative minor swap: C → Am". Click Apply → C replaced |
| 12 | Section ending on Am, Turnaround suggestions | "End with G7 (V7)" card. Click Apply → G7 appended |
| 13 | Section C then F, Approach suggestions | "Add E7 before F" card. Click Apply → E7 inserted |
| 14 | Click "Substitutions" filter tab | Only substitution cards shown. Click "All" → all types |
| 15 | Click "Full Song" scope tab | Song-level analysis. Click "This Section" → returns to section view |
| 16 | Click "D" on circle of fifths | D chord selected in palette, detail panel updates |
| 17 | Change key C → G | Theory panel re-analyzes, numerals update, circle shifts |
| 18 | Switch to flat mode | Panel shows Db not C#, Bb not A# everywhere |
| 19 | No section selected, open panel | Section view: "Click a section header to analyze." |
| 20 | Load saved project | Panel re-renders correctly with loaded data |
| 21 | Mobile viewport | Panel accessible in Detail tab, scrollable |

---

## Color Legend (Harmonic Function)

| Function | Color | Hex | Usage |
|----------|-------|-----|-------|
| Tonic (I, iii, vi) | Teal | `#2a9d8f` | Stable/home chords |
| Subdominant (ii, IV) | Amber | `#e9c46a` | Departure/movement |
| Dominant (V, vii°) | Red | `var(--accent)` | Tension/resolution |
| Borrowed | Purple | `#7b2cbf` | Modal interchange |
| Chromatic | Gray | `#555` | Outside the key |
