// === Chord Builder — Arpeggio Patterns & Tablature Renderer ===

const Tablature = (() => {
  // Standard tuning: string 6 (low E) to string 1 (high e)
  // Index 0 = string 6, index 5 = string 1
  const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64]; // E2, A2, D3, G3, B3, E4
  const OPEN_STRING_NOTES = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // low to high (index 0=6th string)

  // Arpeggio patterns defined by string numbers (6=low E, 1=high e)
  // 'bass' = lowest non-muted string, 'alt-bass' = second-lowest non-muted string
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

  // Resolve 'bass' keyword to the lowest non-muted string number
  function resolveBassString(voicing) {
    const positions = voicing.positions;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= 0) return 6 - i; // string number (6=low E)
    }
    return 6; // fallback
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
    // Fallback to bass string if only one non-muted string
    return resolveBassString(voicing);
  }

  // Convert a string number (1-6) + voicing → note name with octave, or null if muted
  // capo shifts the effective fret
  function stringToNote(stringNum, voicing, capo) {
    const idx = 6 - stringNum; // positions array index (0=6th string)
    if (idx < 0 || idx > 5) return null;
    const fret = voicing.positions[idx];
    if (fret < 0) return null; // muted string

    const effectiveFret = fret + (capo || 0);
    const midi = OPEN_STRING_MIDI[idx] + effectiveFret;
    return midiToNoteName(midi);
  }

  // Get the fret number for a string in a voicing (for tab display)
  function stringToFret(stringNum, voicing) {
    const idx = 6 - stringNum;
    if (idx < 0 || idx > 5) return null;
    const fret = voicing.positions[idx];
    return fret >= 0 ? fret : null; // null if muted
  }

  // MIDI number to note name (e.g., 40 → "E2")
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
      return s; // numeric string number
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

    // Clear
    ctx.fillStyle = '#1b2a4a';
    ctx.fillRect(0, 0, w, h);

    const leftMargin = 16;
    const rightMargin = 4;
    const topPad = 5;
    const lineSpacing = 7;
    const playableWidth = w - leftMargin - rightMargin;

    // Draw string labels on left
    ctx.font = '6px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Draw from string 1 (high e, top) to string 6 (low E, bottom)
    for (let i = 0; i < 6; i++) {
      const stringNum = 1 + i; // 1 at top, 6 at bottom — wait, tab convention: high e on top
      // Tab convention: string 1 (high e) is at the TOP
      const y = topPad + i * lineSpacing;
      const label = STRING_LABELS[5 - i]; // index 5=high e, 4=B, ... 0=low E

      // Label
      ctx.fillStyle = '#8892a4';
      ctx.fillText(label, leftMargin - 3, y);

      // String line
      ctx.strokeStyle = '#3a4a6c';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(w - rightMargin, y);
      ctx.stroke();
    }

    // Place fret numbers at beat positions
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const steps = pattern.steps;
    steps.forEach(step => {
      const x = leftMargin + step.beat * playableWidth;
      const resolvedStrings = resolveStrings(step.strings, voicing);

      resolvedStrings.forEach(stringNum => {
        const fret = stringToFret(stringNum, voicing);
        if (fret === null) return; // muted, skip

        // Row 0 (top) = string 1 (high e), Row 5 (bottom) = string 6 (low E)
        const rowIdx = stringNum - 1;
        const y = topPad + rowIdx * lineSpacing;

        const text = String(fret);
        const textWidth = ctx.measureText(text).width;

        // Background rect to clear string line behind number
        ctx.fillStyle = '#1b2a4a';
        ctx.fillRect(x - textWidth / 2 - 1, y - 4, textWidth + 2, 8);

        // Fret number
        ctx.fillStyle = '#e0e0e0';
        ctx.fillText(text, x, y);
      });
    });
  }

  return {
    ARPEGGIO_PATTERNS,
    resolveBassString,
    resolveAltBassString,
    stringToNote,
    stringToFret,
    resolveStrings,
    getPatternsForTimeSig,
    render,
  };
})();
