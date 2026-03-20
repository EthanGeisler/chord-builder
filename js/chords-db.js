// === Chord Builder — Chord Voicing Database ===

const ChordsDB = (() => {
  let voicingsData = {};

  // Load voicings from JSON file
  async function load() {
    try {
      const resp = await fetch('data/voicings.json');
      voicingsData = await resp.json();
      console.log(`ChordsDB: Loaded ${Object.keys(voicingsData).length} chords`);
    } catch (e) {
      console.warn('ChordsDB: Failed to load voicings.json, using built-in fallback');
      voicingsData = FALLBACK_VOICINGS;
    }
  }

  // Look up voicings for a chord name
  // Returns array of voicing objects, or empty array
  function getVoicings(chordName, capo = 0) {
    // Direct lookup
    let voicings = voicingsData[chordName];
    if (voicings && voicings.length > 0) {
      if (capo > 0) return adjustForCapo(voicings, capo);
      return voicings;
    }

    // Try normalizing: Tonal uses different naming sometimes
    const aliases = getAliases(chordName);
    for (const alias of aliases) {
      voicings = voicingsData[alias];
      if (voicings && voicings.length > 0) {
        if (capo > 0) return adjustForCapo(voicings, capo);
        return voicings;
      }
    }

    // Generate barre chord from shape templates if no voicing found
    const generated = generateBarreVoicing(chordName);
    if (generated) return capo > 0 ? adjustForCapo([generated], capo) : [generated];

    return [];
  }

  function getAliases(chordName) {
    const aliases = [];
    // Handle enharmonic equivalents
    const enharmonic = {
      'C#': 'Db', 'Db': 'C#',
      'D#': 'Eb', 'Eb': 'D#',
      'F#': 'Gb', 'Gb': 'F#',
      'G#': 'Ab', 'Ab': 'G#',
      'A#': 'Bb', 'Bb': 'A#',
    };
    const root = chordName.match(/^[A-G][#b]?/)?.[0];
    const suffix = chordName.slice(root?.length || 0);
    if (root && enharmonic[root]) {
      aliases.push(enharmonic[root] + suffix);
    }
    return aliases;
  }

  // Adjust voicings for capo — shift fret positions
  function adjustForCapo(voicings, capo) {
    return voicings.map(v => {
      const adjusted = { ...v };
      adjusted.positions = v.positions.map(f => {
        if (f <= 0) return f; // muted or open stays
        const newFret = f - capo;
        return newFret > 0 ? newFret : -1; // if goes below capo, mute
      });
      adjusted.baseFret = Math.max(1, (v.baseFret || 1) - capo);
      if (v.barres) {
        adjusted.barres = v.barres.map(b => ({
          ...b,
          fret: Math.max(1, b.fret - capo),
        }));
      }
      adjusted.label = (v.label || '') + ` (capo ${capo})`;
      return adjusted;
    });
  }

  // Generate a barre chord voicing from E-form or A-form templates
  function generateBarreVoicing(chordName) {
    const root = chordName.match(/^[A-G]#?/)?.[0];
    const suffix = chordName.slice(root?.length || 0);
    if (!root) return null;

    const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootIdx = KEYS.indexOf(root);
    if (rootIdx < 0) return null;

    // E-form barre shapes (root on 6th string)
    const eFormFret = (rootIdx - KEYS.indexOf('E') + 12) % 12;
    // A-form barre shapes (root on 5th string)
    const aFormFret = (rootIdx - KEYS.indexOf('A') + 12) % 12;

    const templates = {
      '':     { e: [0, 0, 1, 2, 2, 0], a: [-1, 0, 2, 2, 2, 0] },
      'm':    { e: [0, 0, 1, 2, 2, 0], a: [-1, 0, 2, 2, 1, 0] },
      '7':    { e: [0, 0, 1, 0, 2, 0], a: [-1, 0, 2, 0, 2, 0] },
      'm7':   { e: [0, 0, 0, 0, 2, 0], a: [-1, 0, 2, 0, 1, 0] },
      'maj7': { e: [0, 0, 1, 1, 2, 0], a: [-1, 0, 2, 1, 2, 0] },
    };

    // For major barre: E-form uses fret as barre
    if (suffix === '' || suffix === 'm') {
      const baseFret = eFormFret || 12;
      if (baseFret === 0) return null; // Would be open chord, should be in DB

      const isMinor = suffix === 'm';
      return {
        positions: isMinor
          ? [baseFret, baseFret + 3, baseFret + 3, baseFret, baseFret, baseFret]
          : [baseFret, baseFret + 3, baseFret + 3, baseFret + 1, baseFret, baseFret],
        fingers: isMinor ? [1, 3, 4, 1, 1, 1] : [1, 3, 4, 2, 1, 1],
        barres: [{ fromString: 6, toString: 1, fret: baseFret }],
        baseFret: 1,
        label: `Barre E-form (fret ${baseFret})`,
      };
    }

    return null;
  }

  // Get the first/default voicing for quick display
  function getDefaultVoicing(chordName, capo = 0) {
    const voicings = getVoicings(chordName, capo);
    return voicings.length > 0 ? voicings[0] : null;
  }

  const FALLBACK_VOICINGS = {
    'C':  [{ positions: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], barres: [], baseFret: 1, label: 'Open C' }],
    'D':  [{ positions: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], barres: [], baseFret: 1, label: 'Open D' }],
    'E':  [{ positions: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], barres: [], baseFret: 1, label: 'Open E' }],
    'F':  [{ positions: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barres: [{ fromString: 6, toString: 1, fret: 1 }], baseFret: 1, label: 'Barre F' }],
    'G':  [{ positions: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], barres: [], baseFret: 1, label: 'Open G' }],
    'A':  [{ positions: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], barres: [], baseFret: 1, label: 'Open A' }],
    'B':  [{ positions: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 2, 3, 4, 1], barres: [{ fromString: 5, toString: 1, fret: 2 }], baseFret: 1, label: 'Barre B' }],
    'Am': [{ positions: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], barres: [], baseFret: 1, label: 'Open Am' }],
    'Em': [{ positions: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], barres: [], baseFret: 1, label: 'Open Em' }],
    'Dm': [{ positions: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], barres: [], baseFret: 1, label: 'Open Dm' }],
  };

  return { load, getVoicings, getDefaultVoicing };
})();
