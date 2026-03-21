// === Chord Builder — Arpeggio Patterns, Stamp Presets & Tablature Renderer ===

const Tablature = (() => {
  // Standard tuning: string 6 (low E) to string 1 (high e)
  const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64]; // E2, A2, D3, G3, B3, E4
  const OPEN_STRING_NOTES = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // low to high (index 0=6th string)

  // Grid row definitions (shared with inline step grid)
  const GRID_ROWS = [
    { id: 1, label: 'e', type: 'string' },
    { id: 2, label: 'B', type: 'string' },
    { id: 3, label: 'G', type: 'string' },
    { id: 4, label: 'D', type: 'string' },
    { id: 5, label: 'A', type: 'string' },
    { id: 6, label: 'E', type: 'string' },
    { id: 'bass', label: 'Bass', type: 'special' },
    { id: 'alt-bass', label: 'Alt', type: 'special' },
  ];

  // Arpeggio patterns (legacy, kept for backward compat during migration)
  const ARPEGGIO_PATTERNS = {
    'travis-4/4': {
      name: 'Travis Picking',
      timeSignatures: ['4/4'],
      steps: [
        { beat: 0,      strings: ['bass'],  vel: 1.0 },
        { beat: 0.125,  strings: [2],       vel: 0.5 },
        { beat: 0.25,   strings: ['alt-bass'], vel: 0.8 },
        { beat: 0.375,  strings: [1],       vel: 0.5 },
        { beat: 0.5,    strings: ['bass'],  vel: 0.9 },
        { beat: 0.625,  strings: [3],       vel: 0.5 },
        { beat: 0.75,   strings: ['alt-bass'], vel: 0.8 },
        { beat: 0.875,  strings: [2],       vel: 0.5 },
      ],
    },
    'pima-4/4': {
      name: 'p-i-m-a Fingerpick',
      timeSignatures: ['4/4', '3/4'],
      steps: [
        { beat: 0,      strings: ['bass'],  vel: 1.0 },
        { beat: 0.25,   strings: [3],       vel: 0.7 },
        { beat: 0.5,    strings: [2],       vel: 0.7 },
        { beat: 0.75,   strings: [1],       vel: 0.7 },
      ],
    },
    'folk-arp-4/4': {
      name: 'Folk Arpeggio',
      timeSignatures: ['4/4'],
      steps: [
        { beat: 0,      strings: ['bass'],  vel: 1.0 },
        { beat: 0.125,  strings: [3],       vel: 0.6 },
        { beat: 0.25,   strings: [2],       vel: 0.6 },
        { beat: 0.375,  strings: [1],       vel: 0.7 },
        { beat: 0.5,    strings: [2],       vel: 0.6 },
        { beat: 0.625,  strings: [3],       vel: 0.6 },
        { beat: 0.75,   strings: [2],       vel: 0.6 },
        { beat: 0.875,  strings: [1],       vel: 0.7 },
      ],
    },
    'waltz-3/4': {
      name: 'Waltz Arpeggio',
      timeSignatures: ['3/4'],
      steps: [
        { beat: 0,         strings: ['bass'],     vel: 1.0 },
        { beat: 1 / 3,     strings: [3, 2, 1],    vel: 0.7 },
        { beat: 2 / 3,     strings: [3, 2, 1],    vel: 0.6 },
      ],
    },
    'pinch-4/4': {
      name: 'Pinch Pattern',
      timeSignatures: ['4/4'],
      steps: [
        { beat: 0,      strings: ['bass', 1], vel: 1.0 },
        { beat: 0.25,   strings: [3],         vel: 0.6 },
        { beat: 0.5,    strings: ['alt-bass', 2], vel: 0.8 },
        { beat: 0.75,   strings: [3],         vel: 0.6 },
      ],
    },
    'inside-out-4/4': {
      name: 'Inside-Out',
      timeSignatures: ['4/4'],
      steps: [
        { beat: 0,           strings: ['bass'],  vel: 1.0 },
        { beat: 1 / 6,       strings: [3],       vel: 0.6 },
        { beat: 2 / 6,       strings: [2],       vel: 0.7 },
        { beat: 3 / 6,       strings: [1],       vel: 0.8 },
        { beat: 4 / 6,       strings: [2],       vel: 0.7 },
        { beat: 5 / 6,       strings: [3],       vel: 0.6 },
      ],
    },
  };

  // === STAMP PRESETS ===
  // Unified preset format: each step is relative within one beat
  // col is 0-based within one beat (0 to stepsPerBeat-1)
  const STAMP_PRESETS = {
    // --- Strum presets ---
    'all-down': {
      name: 'All Downstrokes',
      category: 'strum',
      timeSignatures: ['4/4', '3/4', '2/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: [6, 5, 4, 3, 2, 1], vel: 1.0 },
      ],
    },
    'down-up': {
      name: 'Down-Up',
      category: 'strum',
      timeSignatures: ['4/4', '3/4', '2/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: [6, 5, 4, 3, 2, 1], vel: 1.0 },
        { col: 1, strings: [1, 2, 3, 4, 5, 6], vel: 0.7 },
      ],
    },
    'folk': {
      name: 'Folk Strum',
      category: 'strum',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: ['bass'], vel: 1.0 },
      ],
    },
    'pop': {
      name: 'Pop Strum (D-DU-UDU)',
      category: 'strum',
      timeSignatures: ['4/4'],
      stepsPerBeat: 4,
      steps: [
        { col: 0, strings: [6, 5, 4, 3, 2, 1], vel: 1.0 },
        { col: 2, strings: [6, 5, 4, 3, 2, 1], vel: 0.8 },
        { col: 3, strings: [1, 2, 3, 4, 5, 6], vel: 0.6 },
      ],
    },
    'reggae': {
      name: 'Reggae Offbeat',
      category: 'strum',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 1, strings: [6, 5, 4, 3, 2, 1], vel: 0.8 },
      ],
    },

    // --- Arpeggio presets (converted from ARPEGGIO_PATTERNS) ---
    'travis': {
      name: 'Travis Picking',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: ['bass'],     vel: 1.0 },
        { col: 1, strings: [2],          vel: 0.5 },
      ],
    },
    'pima': {
      name: 'p-i-m-a Fingerpick',
      category: 'arpeggio',
      timeSignatures: ['4/4', '3/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: ['bass'],  vel: 1.0 },
        { col: 1, strings: [3],       vel: 0.7 },
      ],
    },
    'folk-arp': {
      name: 'Folk Arpeggio',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      steps: [
        { col: 0, strings: ['bass'],  vel: 1.0 },
        { col: 1, strings: [3],       vel: 0.6 },
      ],
    },
    'travis-full': {
      name: 'Travis Full (4-beat)',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      // Full 4-beat travis pattern — uses absolute columns within a 4-beat span
      // col values here go 0-7 for 4 beats × 2 steps/beat
      beatsSpan: 4,
      steps: [
        { col: 0, strings: ['bass'],     vel: 1.0 },
        { col: 1, strings: [2],          vel: 0.5 },
        { col: 2, strings: ['alt-bass'], vel: 0.8 },
        { col: 3, strings: [1],          vel: 0.5 },
        { col: 4, strings: ['bass'],     vel: 0.9 },
        { col: 5, strings: [3],          vel: 0.5 },
        { col: 6, strings: ['alt-bass'], vel: 0.8 },
        { col: 7, strings: [2],          vel: 0.5 },
      ],
    },
    'pima-full': {
      name: 'p-i-m-a Full (4-beat)',
      category: 'arpeggio',
      timeSignatures: ['4/4', '3/4'],
      stepsPerBeat: 2,
      beatsSpan: 4,
      steps: [
        { col: 0, strings: ['bass'],  vel: 1.0 },
        { col: 2, strings: [3],       vel: 0.7 },
        { col: 4, strings: [2],       vel: 0.7 },
        { col: 6, strings: [1],       vel: 0.7 },
      ],
    },
    'folk-arp-full': {
      name: 'Folk Arpeggio Full (4-beat)',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      beatsSpan: 4,
      steps: [
        { col: 0, strings: ['bass'],  vel: 1.0 },
        { col: 1, strings: [3],       vel: 0.6 },
        { col: 2, strings: [2],       vel: 0.6 },
        { col: 3, strings: [1],       vel: 0.7 },
        { col: 4, strings: [2],       vel: 0.6 },
        { col: 5, strings: [3],       vel: 0.6 },
        { col: 6, strings: [2],       vel: 0.6 },
        { col: 7, strings: [1],       vel: 0.7 },
      ],
    },
    'waltz': {
      name: 'Waltz Arpeggio',
      category: 'arpeggio',
      timeSignatures: ['3/4'],
      stepsPerBeat: 2,
      beatsSpan: 3,
      steps: [
        { col: 0, strings: ['bass'],     vel: 1.0 },
        { col: 2, strings: [3, 2, 1],    vel: 0.7 },
        { col: 4, strings: [3, 2, 1],    vel: 0.6 },
      ],
    },
    'pinch': {
      name: 'Pinch Pattern',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 2,
      beatsSpan: 4,
      steps: [
        { col: 0, strings: ['bass', 1],      vel: 1.0 },
        { col: 2, strings: [3],              vel: 0.6 },
        { col: 4, strings: ['alt-bass', 2],  vel: 0.8 },
        { col: 6, strings: [3],              vel: 0.6 },
      ],
    },
    'inside-out': {
      name: 'Inside-Out',
      category: 'arpeggio',
      timeSignatures: ['4/4'],
      stepsPerBeat: 3,
      beatsSpan: 2,
      steps: [
        { col: 0, strings: ['bass'],  vel: 1.0 },
        { col: 1, strings: [3],       vel: 0.6 },
        { col: 2, strings: [2],       vel: 0.7 },
        { col: 3, strings: [1],       vel: 0.8 },
        { col: 4, strings: [2],       vel: 0.7 },
        { col: 5, strings: [3],       vel: 0.6 },
      ],
    },
  };

  // Stamp a preset pattern into gridState over a column range
  // Repeats the pattern to fill [startCol, startCol+numCols)
  function stampPresetToGrid(presetKey, startCol, numCols, sectionSubdivisions, gridState) {
    const preset = STAMP_PRESETS[presetKey];
    if (!preset) return gridState;

    const presetStepsPerBeat = preset.stepsPerBeat;
    const scale = sectionSubdivisions / presetStepsPerBeat;
    const beatsSpan = preset.beatsSpan || 1;
    const patternCols = beatsSpan * sectionSubdivisions;

    // Tile the pattern across the range
    for (let offset = 0; offset < numCols; offset += patternCols) {
      preset.steps.forEach(step => {
        const localCol = Math.round(step.col * scale);
        const absCol = startCol + offset + localCol;
        if (absCol >= startCol + numCols) return;

        step.strings.forEach(s => {
          gridState[s + ':' + absCol] = step.vel;
        });
      });
    }

    return gridState;
  }

  // Get beat label for a column index (shared between inline grid and arpeggio creator)
  function getBeatLabel(col, subdiv, timeSig) {
    const beats = timeSig === '6/8' ? 6 : parseInt(timeSig.split('/')[0], 10);
    const stepsPerBeat = subdiv / beats;
    const beatNum = Math.floor(col / stepsPerBeat) + 1;
    const subBeat = col % stepsPerBeat;
    if (subBeat === 0) return String(beatNum);
    if (stepsPerBeat === 2 && subBeat === 1) return '&';
    if (stepsPerBeat === 3) return ['', 'e', '&'][subBeat] || '';
    if (stepsPerBeat === 4) return ['', 'e', '&', 'a'][subBeat] || '';
    return '';
  }

  // Resolve 'bass' keyword to the lowest non-muted string number
  function resolveBassString(voicing) {
    const positions = voicing.positions;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= 0) return 6 - i;
    }
    return 6;
  }

  // Resolve 'alt-bass' keyword to the second-lowest non-muted string
  function resolveAltBassString(voicing) {
    const positions = voicing.positions;
    let found = 0;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= 0) {
        found++;
        if (found === 2) return 6 - i;
      }
    }
    return resolveBassString(voicing);
  }

  // Convert a string number (1-6) + voicing → note name with octave, or null if muted
  function stringToNote(stringNum, voicing, capo) {
    const idx = 6 - stringNum;
    if (idx < 0 || idx > 5) return null;
    const fret = voicing.positions[idx];
    if (fret < 0) return null;

    const effectiveFret = fret + (capo || 0);
    const midi = OPEN_STRING_MIDI[idx] + effectiveFret;
    return midiToNoteName(midi);
  }

  // Get the fret number for a string in a voicing (for tab display)
  function stringToFret(stringNum, voicing) {
    const idx = 6 - stringNum;
    if (idx < 0 || idx > 5) return null;
    const fret = voicing.positions[idx];
    return fret >= 0 ? fret : null;
  }

  // MIDI number to note name
  function midiToNoteName(midi) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const note = noteNames[midi % 12];
    return note + octave;
  }

  // Resolve a step's string references to actual string numbers
  function resolveStrings(strings, voicing) {
    return strings.map(s => {
      if (s === 'bass') return resolveBassString(voicing);
      if (s === 'alt-bass') return resolveAltBassString(voicing);
      return s;
    });
  }

  // Get patterns filtered by time signature
  function getPatternsForTimeSig(timeSig) {
    const result = [];
    for (const [key, pattern] of Object.entries(ARPEGGIO_PATTERNS)) {
      if (pattern.timeSignatures.includes(timeSig)) {
        result.push({ key, name: pattern.name });
      }
    }
    return result;
  }

  // Get stamp presets filtered by time signature
  function getStampPresetsForTimeSig(timeSig) {
    const result = [];
    for (const [key, preset] of Object.entries(STAMP_PRESETS)) {
      if (preset.timeSignatures.includes(timeSig)) {
        result.push({ key, name: preset.name, category: preset.category });
      }
    }
    return result;
  }

  // === Canvas Tablature Renderer ===
  function render(canvas, voicing, patternKey) {
    const pattern = ARPEGGIO_PATTERNS[patternKey];
    if (!canvas || !voicing || !pattern) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 166;
    const h = 50;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#1b2a4a';
    ctx.fillRect(0, 0, w, h);

    const leftMargin = 16;
    const rightMargin = 4;
    const topPad = 5;
    const lineSpacing = 7;
    const playableWidth = w - leftMargin - rightMargin;

    ctx.font = '6px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 6; i++) {
      const y = topPad + i * lineSpacing;
      const label = STRING_LABELS[5 - i];

      ctx.fillStyle = '#8892a4';
      ctx.fillText(label, leftMargin - 3, y);

      ctx.strokeStyle = '#3a4a6c';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(w - rightMargin, y);
      ctx.stroke();
    }

    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const steps = pattern.steps;
    steps.forEach(step => {
      const x = leftMargin + step.beat * playableWidth;
      const resolvedStrs = resolveStrings(step.strings, voicing);

      resolvedStrs.forEach(stringNum => {
        const fret = stringToFret(stringNum, voicing);
        if (fret === null) return;

        const rowIdx = stringNum - 1;
        const y = topPad + rowIdx * lineSpacing;
        const text = String(fret);
        const textWidth = ctx.measureText(text).width;

        ctx.fillStyle = '#1b2a4a';
        ctx.fillRect(x - textWidth / 2 - 1, y - 4, textWidth + 2, 8);

        ctx.fillStyle = '#e0e0e0';
        ctx.fillText(text, x, y);
      });
    });
  }

  // Register a custom arpeggio pattern
  function registerCustomArpeggio(key, pattern) {
    ARPEGGIO_PATTERNS[key] = pattern;
  }

  function removeCustomArpeggio(key) {
    delete ARPEGGIO_PATTERNS[key];
  }

  function loadCustomArpeggios(arr) {
    for (const key of Object.keys(ARPEGGIO_PATTERNS)) {
      if (key.startsWith('custom-')) delete ARPEGGIO_PATTERNS[key];
    }
    if (!arr) return;
    arr.forEach(ca => {
      ARPEGGIO_PATTERNS[ca.key] = {
        name: ca.name,
        timeSignatures: ca.timeSignatures,
        steps: ca.steps,
      };
    });
  }

  return {
    ARPEGGIO_PATTERNS,
    STAMP_PRESETS,
    GRID_ROWS,
    resolveBassString,
    resolveAltBassString,
    stringToNote,
    stringToFret,
    resolveStrings,
    getPatternsForTimeSig,
    getStampPresetsForTimeSig,
    stampPresetToGrid,
    getBeatLabel,
    render,
    registerCustomArpeggio,
    removeCustomArpeggio,
    loadCustomArpeggios,
  };
})();
