// === Chord Builder — Music Theory Engine (Tonal.js wrapper) ===

const Theory = (() => {
  const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const KEYS_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const ENHARMONIC_MAP = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };
  const ENHARMONIC_MAP_REVERSE = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };

  // Display a note using current enharmonic mode
  function displayNote(note) {
    if (App.state.enharmonicMode === 'flat' && ENHARMONIC_MAP[note]) {
      return ENHARMONIC_MAP[note];
    }
    return note;
  }

  // Display a chord name using current enharmonic mode
  function displayChord(chordName) {
    if (!chordName) return chordName;
    const rootMatch = chordName.match(/^([A-G]#?)(.*)/);
    if (!rootMatch) return chordName;
    return displayNote(rootMatch[1]) + rootMatch[2];
  }

  // Convert a displayed note back to internal sharp representation
  function internalNote(note) {
    if (ENHARMONIC_MAP_REVERSE[note]) {
      return ENHARMONIC_MAP_REVERSE[note];
    }
    return note;
  }

  const MODES = [
    { name: 'Major (Ionian)', value: 'major', tonal: 'major' },
    { name: 'Dorian', value: 'dorian', tonal: 'dorian' },
    { name: 'Phrygian', value: 'phrygian', tonal: 'phrygian' },
    { name: 'Lydian', value: 'lydian', tonal: 'lydian' },
    { name: 'Mixolydian', value: 'mixolydian', tonal: 'mixolydian' },
    { name: 'Minor (Aeolian)', value: 'minor', tonal: 'aeolian' },
    { name: 'Locrian', value: 'locrian', tonal: 'locrian' },
  ];

  // Roman numeral labels for scale degrees
  const NUMERALS_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Mode interval patterns (semitones from root)
  const MODE_INTERVALS = {
    major:      [0, 2, 4, 5, 7, 9, 11],
    dorian:     [0, 2, 3, 5, 7, 9, 10],
    phrygian:   [0, 1, 3, 5, 7, 8, 10],
    lydian:     [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    minor:      [0, 2, 3, 5, 7, 8, 10],  // aeolian
    locrian:    [0, 1, 3, 5, 6, 8, 10],
  };

  // Triad quality for each degree by mode
  const MODE_TRIAD_QUALITIES = {
    major:      ['', 'm', 'm', '', '', 'm', 'dim'],
    dorian:     ['m', 'm', '', '', 'm', 'dim', ''],
    phrygian:   ['m', '', '', 'm', 'dim', '', 'm'],
    lydian:     ['', '', 'm', 'dim', '', 'm', 'm'],
    mixolydian: ['', 'm', 'dim', '', 'm', 'm', ''],
    minor:      ['m', 'dim', '', 'm', 'm', '', ''],
    locrian:    ['dim', '', 'm', 'm', '', '', 'm'],
  };

  // Seventh chord quality for each degree by mode
  const MODE_SEVENTH_QUALITIES = {
    major:      ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'],
    dorian:     ['m7', 'm7', 'maj7', '7', 'm7', 'm7b5', 'maj7'],
    phrygian:   ['m7', 'maj7', '7', 'm7', 'm7b5', 'maj7', 'm7'],
    lydian:     ['maj7', '7', 'm7', 'm7b5', 'maj7', 'm7', 'm7'],
    mixolydian: ['7', 'm7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7'],
    minor:      ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', '7'],
    locrian:    ['m7b5', 'maj7', 'm7', 'm7', 'maj7', '7', 'm7'],
  };

  // Get scale notes for key + mode
  function getScaleNotes(key, mode) {
    const intervals = MODE_INTERVALS[mode];
    const rootMidi = KEYS.indexOf(key);
    return intervals.map(i => KEYS[(rootMidi + i) % 12]);
  }

  // Get diatonic chords for key + mode
  function getDiatonicChords(key, mode) {
    const notes = getScaleNotes(key, mode);
    const triadQ = MODE_TRIAD_QUALITIES[mode];
    const seventhQ = MODE_SEVENTH_QUALITIES[mode];
    const chords = [];

    notes.forEach((note, i) => {
      const triad = note + triadQ[i];
      const seventh = note + seventhQ[i];
      const numeral = triadQ[i].startsWith('m') || triadQ[i] === 'dim'
        ? NUMERALS_UPPER[i].toLowerCase()
        : NUMERALS_UPPER[i];
      const numeralSuffix = triadQ[i] === 'dim' ? '°' : '';

      const variants = [triad];
      // Add 7th variant
      variants.push(seventh);
      // Add sus2, sus4, add9 (only for major/minor triads, not dim)
      if (triadQ[i] !== 'dim') {
        variants.push(note + 'sus2');
        variants.push(note + 'sus4');
        variants.push(note + 'add9');
      }

      chords.push({
        root: note,
        triad,
        seventh,
        numeral: numeral + numeralSuffix,
        quality: triadQ[i] || 'major',
        variants,
        degree: i + 1,
      });
    });

    return chords;
  }

  // Chord suggestion engine
  // Maps scale degree -> likely next degrees with weights
  const PROGRESSION_WEIGHTS = {
    1: [{ deg: 4, w: 5, reason: 'I → IV' }, { deg: 5, w: 5, reason: 'I → V' }, { deg: 6, w: 4, reason: 'I → vi' }, { deg: 2, w: 3, reason: 'I → ii' }],
    2: [{ deg: 5, w: 6, reason: 'ii → V' }, { deg: 4, w: 3, reason: 'ii → IV' }, { deg: 7, w: 2, reason: 'ii → vii' }],
    3: [{ deg: 6, w: 5, reason: 'iii → vi' }, { deg: 4, w: 4, reason: 'iii → IV' }, { deg: 2, w: 3, reason: 'iii → ii' }],
    4: [{ deg: 5, w: 6, reason: 'IV → V' }, { deg: 1, w: 4, reason: 'IV → I' }, { deg: 2, w: 3, reason: 'IV → ii' }, { deg: 6, w: 3, reason: 'IV → vi' }],
    5: [{ deg: 1, w: 7, reason: 'V → I (resolution)' }, { deg: 6, w: 4, reason: 'V → vi (deceptive)' }, { deg: 4, w: 2, reason: 'V → IV (retrogression)' }],
    6: [{ deg: 4, w: 5, reason: 'vi → IV' }, { deg: 2, w: 4, reason: 'vi → ii' }, { deg: 5, w: 4, reason: 'vi → V' }, { deg: 1, w: 3, reason: 'vi → I' }],
    7: [{ deg: 1, w: 6, reason: 'vii → I (resolution)' }, { deg: 3, w: 3, reason: 'vii → iii' }, { deg: 6, w: 2, reason: 'vii → vi' }],
  };

  // Find which scale degree a chord corresponds to
  function findDegree(key, mode, chordName) {
    const diatonic = getDiatonicChords(key, mode);
    for (const ch of diatonic) {
      if (ch.variants.includes(chordName) || ch.triad === chordName || ch.seventh === chordName) {
        return ch.degree;
      }
    }
    // Try matching just the root
    const root = chordName.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
    const notes = getScaleNotes(key, mode);
    const idx = notes.indexOf(root);
    return idx >= 0 ? idx + 1 : null;
  }

  // Suggest next chords given current chord
  function suggestNextChords(key, mode, currentChord) {
    const degree = findDegree(key, mode, currentChord);
    if (!degree) return [];

    const weights = PROGRESSION_WEIGHTS[degree] || [];
    const diatonic = getDiatonicChords(key, mode);

    return weights
      .sort((a, b) => b.w - a.w)
      .slice(0, 4)
      .map(w => {
        const target = diatonic[w.deg - 1];
        return {
          chord: target.triad,
          numeral: target.numeral,
          reason: w.reason,
          degree: w.deg,
        };
      });
  }

  // Get chord notes (for audio playback)
  function getChordNotes(chordName) {
    try {
      // Try Tonal.js first
      if (typeof Tonal !== 'undefined' && Tonal.Chord) {
        const parsed = Tonal.Chord.get(chordName);
        if (parsed && parsed.notes && parsed.notes.length > 0) {
          return parsed.notes;
        }
      }
    } catch (e) {
      // fallback below
    }

    // Manual fallback for common chord types
    const root = chordName.match(/^[A-G]#?/)?.[0];
    if (!root) return [];
    const suffix = chordName.slice(root.length);
    const rootIdx = KEYS.indexOf(root);
    if (rootIdx < 0) return [];

    const intervals = {
      '':      [0, 4, 7],
      'm':     [0, 3, 7],
      '7':     [0, 4, 7, 10],
      'maj7':  [0, 4, 7, 11],
      'm7':    [0, 3, 7, 10],
      'm7b5':  [0, 3, 6, 10],
      'dim':   [0, 3, 6],
      'aug':   [0, 4, 8],
      'sus2':  [0, 2, 7],
      'sus4':  [0, 5, 7],
      'add9':  [0, 4, 7, 14],
    };

    const semitones = intervals[suffix] || intervals[''];
    return semitones.map(s => KEYS[(rootIdx + s) % 12]);
  }

  // Detect chord name from fretboard positions
  // positions: array of 6 fret values (index 0=low E, -1=muted, 0=open)
  // capo: capo fret position
  // Returns array of candidate chord names (first = best), or empty if unknown
  function detectChordFromPositions(positions, capo) {
    if (!positions || positions.length !== 6) return [];

    // Build a temporary voicing to use Tablature.stringToNote
    const tempVoicing = { positions, baseFret: 1 };
    const pitchClasses = new Set();

    for (let stringNum = 1; stringNum <= 6; stringNum++) {
      const note = Tablature.stringToNote(stringNum, tempVoicing, capo || 0);
      if (note) {
        // Strip octave to get pitch class (e.g., "C#3" → "C#")
        const pc = note.replace(/\d+$/, '');
        pitchClasses.add(pc);
      }
    }

    if (pitchClasses.size === 0) return [];

    const pcArray = Array.from(pitchClasses);

    // Try Tonal.js chord detection
    try {
      if (typeof Tonal !== 'undefined' && Tonal.Chord && Tonal.Chord.detect) {
        const candidates = Tonal.Chord.detect(pcArray);
        if (candidates && candidates.length > 0) {
          return candidates;
        }
      }
    } catch (e) {
      // fallback below
    }

    return [];
  }

  // Detect most likely key + mode from a list of chord names.
  // Scores each key/mode by how many chords are diatonic to it,
  // weighted by position (earlier chords matter more) and frequency.
  function detectKeyFromChords(chordNames) {
    if (!chordNames || !chordNames.length) return null;

    // Extract root from chord name
    function chordRoot(name) {
      const m = name.match(/^[A-G][#b]?/);
      return m ? m[0] : null;
    }

    // Normalize chord for matching: strip slash bass, keep quality
    function normalizeForMatch(name) {
      return name.split('/')[0].trim();
    }

    let bestScore = -1;
    let bestKey = 'C';
    let bestMode = 'major';

    // Only check major and minor — they cover ~95% of songs
    // and avoid false positives from modes with similar diatonic sets
    const modesToCheck = ['major', 'minor'];

    for (const key of KEYS) {
      for (const mode of modesToCheck) {
        const diatonic = getDiatonicChords(key, mode);
        const allVariants = new Set();
        const triadRoots = new Set();

        for (const ch of diatonic) {
          for (const v of ch.variants) allVariants.add(v);
          allVariants.add(ch.triad);
          allVariants.add(ch.seventh);
          triadRoots.add(ch.root);
        }

        let score = 0;
        const totalChords = chordNames.length;

        for (let i = 0; i < totalChords; i++) {
          const name = normalizeForMatch(chordNames[i]);
          const root = chordRoot(name);

          // Position weight: first chords matter more
          const posWeight = 1 + (totalChords - i) / totalChords;

          if (allVariants.has(name)) {
            // Exact diatonic match
            score += 3 * posWeight;
          } else if (root && triadRoots.has(root)) {
            // Root is in the scale (extension/alteration of a diatonic chord)
            score += 1.5 * posWeight;
          }
        }

        // Bonus: if first chord is the tonic
        const firstRoot = chordRoot(normalizeForMatch(chordNames[0]));
        if (firstRoot === key) score += 2;

        // Bonus: if last chord resolves to tonic
        const lastRoot = chordRoot(normalizeForMatch(chordNames[chordNames.length - 1]));
        if (lastRoot === key) score += 1.5;

        // Minor bonus: if first chord quality matches mode
        const firstName = normalizeForMatch(chordNames[0]);
        if (mode === 'minor' && /m(?!aj)/.test(firstName) && firstRoot === key) score += 1;
        if (mode === 'major' && !/m/.test(firstName) && firstRoot === key) score += 1;

        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
          bestMode = mode;
        }
      }
    }

    return { key: bestKey, mode: bestMode, confidence: bestScore };
  }

  // Classify a chord's harmonic function within a key
  function classifyChordFunction(key, mode, chordName) {
    const degree = findDegree(key, mode, chordName);
    if (degree) {
      if ([1, 3, 6].includes(degree)) return 'tonic';
      if ([2, 4].includes(degree)) return 'subdominant';
      if ([5, 7].includes(degree)) return 'dominant';
    }
    // Check parallel key (borrowed chord / modal interchange)
    const parallelMode = mode === 'minor' ? 'major' : 'minor';
    const parallelDegree = findDegree(key, parallelMode, chordName);
    if (parallelDegree) return 'borrowed';
    return 'chromatic';
  }

  // Detect known progression patterns from an array of degree numbers
  function detectProgressionPattern(degrees) {
    const KNOWN_PATTERNS = [
      { degrees: [1,5,6,4], name: 'I-V-vi-IV (Pop)' },
      { degrees: [1,4,5,4], name: 'I-IV-V-IV (Folk)' },
      { degrees: [6,4,1,5], name: 'vi-IV-I-V (Pop variant)' },
      { degrees: [2,5,1], name: 'ii-V-I (Jazz)' },
      { degrees: [1,4,5], name: 'I-IV-V (Blues/Rock)' },
      { degrees: [1,6,4,5], name: 'I-vi-IV-V (50s)' },
      { degrees: [1,5,6,3,4,1,4,5], name: 'Canon progression' },
      { degrees: [1,7,6,5], name: 'Andalusian cadence' },
    ];

    for (const pattern of KNOWN_PATTERNS) {
      const pLen = pattern.degrees.length;
      if (degrees.length < pLen) continue;
      // Check exact match
      if (degrees.length === pLen && degrees.every((d, i) => d === pattern.degrees[i])) {
        return pattern.name;
      }
      // Check circular rotations
      for (let rot = 0; rot < pLen; rot++) {
        const rotated = [...pattern.degrees.slice(rot), ...pattern.degrees.slice(0, rot)];
        if (degrees.length === pLen && degrees.every((d, i) => d === rotated[i])) {
          return pattern.name + ' (rotated)';
        }
      }
    }
    return null;
  }

  // Get diatonic chords of the parallel key (same root, opposite major/minor)
  function getParallelChords(key, mode) {
    const parallelMode = mode === 'minor' ? 'major' : 'minor';
    return getDiatonicChords(key, parallelMode);
  }

  // Get tritone substitution for a chord (root + 6 semitones, dom7 quality)
  function getTritoneSubstitution(key, mode, chordName) {
    const fn = classifyChordFunction(key, mode, chordName);
    if (fn !== 'dominant') return null;
    const root = chordName.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
    const rootIdx = KEYS.indexOf(root);
    if (rootIdx < 0) return null;
    const tritonRoot = KEYS[(rootIdx + 6) % 12];
    return tritonRoot + '7';
  }

  // Get relative swap: major→relative minor, minor→relative major
  function getRelativeSwap(chordName) {
    const root = chordName.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
    const suffix = chordName.slice(root.length);
    const rootIdx = KEYS.indexOf(root);
    if (rootIdx < 0) return null;
    // Check if minor
    if (suffix === 'm' || suffix === 'm7') {
      // Relative major: root + 3 semitones
      const newRoot = KEYS[(rootIdx + 3) % 12];
      return suffix === 'm7' ? newRoot + 'maj7' : newRoot;
    }
    // Major chord: relative minor: root - 3 semitones
    if (suffix === '' || suffix === 'maj7' || suffix === '7') {
      const newRoot = KEYS[(rootIdx + 9) % 12]; // -3 mod 12 = +9
      return suffix === 'maj7' ? newRoot + 'm7' : newRoot + 'm';
    }
    return null;
  }

  // Transpose a chord by semitones
  function transposeChord(chordName, semitones) {
    const root = chordName.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
    const suffix = chordName.slice(root.length);
    const rootIdx = KEYS.indexOf(root);
    if (rootIdx < 0) return chordName;
    const newRoot = KEYS[(rootIdx + semitones + 12) % 12];
    return newRoot + suffix;
  }

  return {
    KEYS,
    KEYS_FLAT,
    ENHARMONIC_MAP,
    ENHARMONIC_MAP_REVERSE,
    displayNote,
    displayChord,
    internalNote,
    MODES,
    MODE_INTERVALS,
    getScaleNotes,
    getDiatonicChords,
    suggestNextChords,
    findDegree,
    getChordNotes,
    detectChordFromPositions,
    detectKeyFromChords,
    classifyChordFunction,
    detectProgressionPattern,
    getParallelChords,
    getTritoneSubstitution,
    getRelativeSwap,
    transposeChord,
  };
})();
