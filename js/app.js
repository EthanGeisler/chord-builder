// === Chord Builder — App State & Event Bus ===

const App = (() => {
  // Central state
  const state = {
    key: 'C',
    mode: 'major',
    capo: 0,
    bpm: 120,
    timeSignature: '4/4',
    sections: [],
    selectedSlot: null,     // { sectionIndex, measureIndex }
    selectedChord: null,    // chord name string
    selectedVoicingIndex: 0,
    isPlaying: false,
    isPaused: false,
    loopSection: false,
    playbackPosition: { section: 0, measure: 0 },
    projectName: 'Untitled',
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
    // Duration of one measure in seconds
    const beats = getBeatsPerMeasure();
    const beatUnit = parseInt(state.timeSignature.split('/')[1], 10);
    // For 6/8, dotted quarter = beat, so 2 dotted-quarter beats
    if (state.timeSignature === '6/8') {
      // 6/8 has 2 dotted-quarter beats per measure
      const dottedQuarterDuration = 60 / state.bpm; // each dotted quarter
      return dottedQuarterDuration * 2;
    }
    // For x/4 time signatures
    return (beats * 60) / state.bpm;
  }

  // Initialize default song structure
  function initDefaultSong() {
    state.sections = [
      {
        name: 'Verse',
        measures: Array.from({ length: 4 }, () => ({ chord: null, voicingIndex: 0 })),
        dynamics: 'mf',
        strumPattern: 'down-up',
      }
    ];
  }

  // Serialize state for save/export
  function serialize() {
    return JSON.stringify({
      key: state.key,
      mode: state.mode,
      capo: state.capo,
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      sections: state.sections,
      projectName: state.projectName,
    });
  }

  // Deserialize saved state
  function deserialize(json) {
    try {
      const data = JSON.parse(json);
      Object.assign(state, {
        key: data.key || 'C',
        mode: data.mode || 'major',
        capo: data.capo || 0,
        bpm: data.bpm || 120,
        timeSignature: data.timeSignature || '4/4',
        sections: data.sections || [],
        projectName: data.projectName || 'Untitled',
      });
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

  return { state, on, off, emit, getBeatsPerMeasure, getMeasureDuration, initDefaultSong, serialize, deserialize };
})();
