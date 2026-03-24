// === Chord Builder — App State & Event Bus ===

const App = (() => {
  // Current data format version
  const DATA_VERSION = 2;

  // Central state
  const state = {
    key: 'C',
    mode: 'major',
    capo: 0,
    bpm: 120,
    timeSignature: '4/4',
    sections: [],
    selectedSlot: null,     // { sectionIndex, chordIndex }
    selectedChord: null,    // chord name string
    selectedVoicingIndex: 0,
    isPlaying: false,
    isPaused: false,
    loopSection: false,
    playbackPosition: { section: 0, col: 0 },
    projectName: 'Untitled',
    customVoicings: [],
    customArpeggios: [],
    enharmonicMode: 'sharp',
  };

  // Event bus
  const listeners = {};

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }

  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  }

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(fn => fn(data));
    }
  }

  // State helpers
  function getBeatsPerMeasure() {
    const sig = state.timeSignature;
    if (sig === '6/8') return 6;
    return parseInt(sig.split('/')[0], 10);
  }

  function getMeasureDuration() {
    const beats = getBeatsPerMeasure();
    if (state.timeSignature === '6/8') {
      const dottedQuarterDuration = 60 / state.bpm;
      return dottedQuarterDuration * 2;
    }
    return (beats * 60) / state.bpm;
  }

  // Duration of a single beat in seconds
  function getBeatDuration() {
    return 60 / state.bpm;
  }

  // Initialize default song structure (v2 format)
  function initDefaultSong() {
    state.sections = [
      {
        name: 'Verse',
        totalBeats: 16,
        subdivisions: 2,
        chords: [],
        gridState: {},
        dynamics: 'mf',
      }
    ];
  }

  // Serialize state for save/export
  function serialize() {
    return JSON.stringify({
      dataVersion: DATA_VERSION,
      key: state.key,
      mode: state.mode,
      capo: state.capo,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      sections: state.sections,
      projectName: state.projectName,
      customVoicings: state.customVoicings,
      customArpeggios: state.customArpeggios,
      enharmonicMode: state.enharmonicMode,
    });
  }

  // Migrate v1 data (measures-based) to v2 (chords + gridState)
  function migrateV1ToV2(data) {
    const beatsPerMeasure = data.timeSignature === '6/8' ? 6
      : parseInt((data.timeSignature || '4/4').split('/')[0], 10);
    const subdivisions = 2; // eighth notes

    const newSections = (data.sections || []).map(section => {
      const measures = section.measures || [];
      const totalBeats = measures.length * beatsPerMeasure;
      const chords = [];
      const gridState = {};

      measures.forEach((measure, mIdx) => {
        if (measure.chord) {
          const startBeat = mIdx * beatsPerMeasure;
          chords.push({
            chord: measure.chord,
            voicingIndex: measure.voicingIndex || 0,
            startBeat,
            durationBeats: beatsPerMeasure,
          });

          // Stamp arpeggio pattern into grid if measure had one
          const patternKey = measure.strumPattern || section.strumPattern;
          if (patternKey && typeof Tablature !== 'undefined') {
            const startCol = startBeat * subdivisions;
            const numCols = beatsPerMeasure * subdivisions;
            // Try stamp preset first, then legacy arpeggio
            if (Tablature.STAMP_PRESETS && Tablature.STAMP_PRESETS[patternKey]) {
              Tablature.stampPresetToGrid(patternKey, startCol, numCols, subdivisions, gridState);
            } else if (Tablature.ARPEGGIO_PATTERNS && Tablature.ARPEGGIO_PATTERNS[patternKey]) {
              // Convert legacy arpeggio pattern steps into grid cells
              const pattern = Tablature.ARPEGGIO_PATTERNS[patternKey];
              pattern.steps.forEach(step => {
                const col = startCol + Math.round(step.beat * numCols);
                if (col < startCol + numCols) {
                  step.strings.forEach(s => {
                    gridState[s + ':' + col] = step.vel || 0.7;
                  });
                }
              });
            }
          }
        }
      });

      return {
        name: section.name || 'Section',
        totalBeats: totalBeats || 16,
        subdivisions,
        chords,
        gridState,
        dynamics: section.dynamics || 'mf',
      };
    });

    return newSections;
  }

  // Deserialize saved state
  function deserialize(json) {
    try {
      const data = JSON.parse(json);

      // Detect version and migrate if needed
      let sections = data.sections || [];
      if (!data.dataVersion || data.dataVersion < 2) {
        sections = migrateV1ToV2(data);
      }

      Object.assign(state, {
        key: data.key || 'C',
        mode: data.mode || 'major',
        capo: data.capo || 0,
        bpm: data.bpm || 120,
        timeSignature: data.timeSignature || '4/4',
        sections,
        projectName: data.projectName || 'Untitled',
        customVoicings: data.customVoicings || [],
        customArpeggios: data.customArpeggios || [],
        enharmonicMode: data.enharmonicMode || 'sharp',
      });

      // Re-register custom voicings with ChordsDB
      if (typeof ChordsDB !== 'undefined' && ChordsDB.loadCustomVoicings) {
        ChordsDB.loadCustomVoicings(state.customVoicings);
      }
      // Re-register custom arpeggios with Tablature
      if (typeof Tablature !== 'undefined' && Tablature.loadCustomArpeggios) {
        Tablature.loadCustomArpeggios(state.customArpeggios);
      }

      state.selectedSlot = null;
      state.selectedChord = null;
      state.selectedVoicingIndex = 0;
      state.isPlaying = false;
      state.isPaused = false;
      emit('stateLoaded');
    } catch (e) {
      console.error('Failed to deserialize state:', e);
    }
  }

  return {
    state, on, off, emit,
    getBeatsPerMeasure, getMeasureDuration, getBeatDuration,
    initDefaultSong, serialize, deserialize,
    DATA_VERSION,
  };
})();
