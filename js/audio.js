// === Chord Builder — Audio Playback Engine (Tone.js) ===

const AudioEngine = (() => {
  let currentInstrument = null;
  let instrumentReady = false;
  let currentType = 'acoustic';
  let toneStarted = false;

  const DYNAMICS_VELOCITY = {
    'pp': 0.15,
    'p':  0.3,
    'mp': 0.45,
    'mf': 0.6,
    'f':  0.8,
    'ff': 1.0,
  };

  const SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

  const SAMPLE_URLS = {
    'E2': 'E2.mp3', 'A2': 'A2.mp3', 'D3': 'D3.mp3',
    'G3': 'G3.mp3', 'B3': 'B3.mp3', 'E4': 'E4.mp3',
    'C3': 'C3.mp3', 'F3': 'F3.mp3', 'A3': 'A3.mp3',
    'C4': 'C4.mp3', 'F4': 'F4.mp3', 'A4': 'A4.mp3',
  };

  const INSTRUMENT_PATHS = {
    'acoustic': 'guitar-acoustic/',
    'electric': 'guitar-electric/',
    'nylon':    'guitar-nylon/',
  };

  async function ensureToneStarted() {
    if (!toneStarted && typeof Tone !== 'undefined') {
      await Tone.start();
      toneStarted = true;
    }
    if (!currentInstrument) loadInstrument(currentType);
  }

  function loadInstrument(type) {
    // Dispose old instrument
    if (currentInstrument) {
      currentInstrument.dispose();
      currentInstrument = null;
      instrumentReady = false;
    }

    currentType = type;

    if (type === 'synth') {
      currentInstrument = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 12,
        voice: Tone.Synth,
        options: {
          oscillator: { type: 'triangle8' },
          envelope: {
            attack: 0.01,
            decay: 0.3,
            sustain: 0.4,
            release: 0.8,
          },
        },
      }).toDestination();
      currentInstrument.volume.value = -6;
      instrumentReady = true;
      return;
    }

    // Sampler-based instruments
    const path = INSTRUMENT_PATHS[type] || INSTRUMENT_PATHS['acoustic'];
    currentInstrument = new Tone.Sampler({
      urls: SAMPLE_URLS,
      baseUrl: SAMPLE_BASE + path,
      onload: () => {
        instrumentReady = true;
        console.log(`${type} guitar samples loaded`);
      },
      release: 1.5,
    }).toDestination();
    currentInstrument.volume.value = -3;
  }

  function setInstrument(type) {
    if (type === currentType && currentInstrument) return;
    loadInstrument(type);
  }

  function getSynth() {
    return instrumentReady ? currentInstrument : null;
  }

  // Convert chord name to playable notes with octaves
  function chordToNotes(chordName) {
    if (chordName && chordName.startsWith('custom:')) {
      return customChordToNotes(chordName);
    }

    const noteNames = Theory.getChordNotes(chordName);
    if (!noteNames || noteNames.length === 0) {
      const custom = App.state.customVoicings.find(cv => cv.name === chordName);
      if (custom && custom.voicing) {
        return notesFromVoicing(custom.voicing);
      }
      return [];
    }

    return noteNames.map((note, i) => {
      const octave = i === 0 ? 3 : (i < 3 ? 4 : 5);
      return note + octave;
    });
  }

  function customChordToNotes(chordName) {
    const custom = App.state.customVoicings.find(cv => cv.name === chordName);
    if (!custom || !custom.voicing) return [];
    return notesFromVoicing(custom.voicing);
  }

  function notesFromVoicing(voicing) {
    const notes = [];
    const capo = App.state.capo || 0;
    for (let stringNum = 6; stringNum >= 1; stringNum--) {
      const note = Tablature.stringToNote(stringNum, voicing, capo);
      if (note) notes.push(note);
    }
    return notes;
  }

  // Play a single chord (click preview)
  async function playChord(chordName, velocity = 0.6) {
    await ensureToneStarted();
    const s = getSynth();
    if (!s) return;

    const notes = chordToNotes(chordName);
    if (notes.length === 0) return;

    const now = Tone.now();
    notes.forEach((note, i) => {
      s.triggerAttackRelease(note, '4n', now + i * 0.02, velocity);
    });
  }

  // === Grid-based playback ===
  let playbackState = {
    sectionIdx: 0,
    currentCol: 0,
    repeatIteration: 0,
    timer: null,
    stopped: false,
  };

  async function play() {
    await ensureToneStarted();

    if (App.state.isPaused) {
      App.state.isPaused = false;
      App.state.isPlaying = true;
      scheduleNextColumn();
      return;
    }

    App.state.isPlaying = true;
    App.state.isPaused = false;

    // If a section is selected in the timeline, start from it
    if (typeof Timeline !== 'undefined' && Timeline.getSelectedSectionIdx && Timeline.getSelectedSectionIdx() >= 0) {
      playbackState.sectionIdx = Timeline.getSelectedSectionIdx();
      playbackState.currentCol = 0;
    } else {
      playbackState.sectionIdx = App.state.playbackPosition.section;
      playbackState.currentCol = App.state.playbackPosition.col;
    }
    playbackState.repeatIteration = 0;
    playbackState.stopped = false;

    playCurrentColumn();
  }

  function pause() {
    App.state.isPaused = true;
    App.state.isPlaying = false;
    if (playbackState.timer) {
      clearTimeout(playbackState.timer);
      playbackState.timer = null;
    }
  }

  function stop() {
    App.state.isPlaying = false;
    App.state.isPaused = false;
    playbackState.stopped = true;
    if (playbackState.timer) {
      clearTimeout(playbackState.timer);
      playbackState.timer = null;
    }
    playbackState.sectionIdx = 0;
    playbackState.currentCol = 0;
    playbackState.repeatIteration = 0;
    App.state.playbackPosition = { section: 0, col: 0 };
    Timeline.setPlayingColumn(-1, -1);

    const s = getSynth();
    if (s) s.releaseAll();
  }

  // Find which chord is active at a given column
  function findChordAtCol(section, col) {
    const beat = col / section.subdivisions;
    for (let i = section.chords.length - 1; i >= 0; i--) {
      const chord = section.chords[i];
      if (beat >= chord.startBeat && beat < chord.startBeat + chord.durationBeats) {
        return chord;
      }
    }
    return null;
  }

  function playCurrentColumn() {
    if (playbackState.stopped || App.state.isPaused) return;

    const sections = App.state.sections;
    if (playbackState.sectionIdx >= sections.length) {
      stop();
      return;
    }

    const section = sections[playbackState.sectionIdx];
    const totalCols = section.totalBeats * section.subdivisions;

    if (playbackState.currentCol >= totalCols) {
      // Section ended
      if (App.state.loopSection) {
        playbackState.currentCol = 0;
      } else {
        const repeatTotal = section.repeat || 1;
        playbackState.repeatIteration++;
        if (playbackState.repeatIteration < repeatTotal) {
          // Repeat this section
          playbackState.currentCol = 0;
        } else {
          // Move to next section
          playbackState.sectionIdx++;
          playbackState.currentCol = 0;
          playbackState.repeatIteration = 0;
          if (playbackState.sectionIdx >= sections.length) {
            stop();
            return;
          }
        }
      }
    }

    const currentSection = sections[playbackState.sectionIdx];
    const col = playbackState.currentCol;

    // Update visual (pass column duration for smooth playhead)
    const _beatDur = App.getBeatDuration();
    const _colDurMs = (_beatDur / currentSection.subdivisions) * 1000;
    Timeline.setPlayingColumn(playbackState.sectionIdx, col, _colDurMs);
    App.state.playbackPosition = {
      section: playbackState.sectionIdx,
      col,
    };

    // Play notes for this column from gridState
    const s = getSynth();
    if (s) {
      const velocity = DYNAMICS_VELOCITY[currentSection.dynamics] || 0.6;
      const activeChord = findChordAtCol(currentSection, col);

      if (activeChord) {
        const voicings = ChordsDB.getVoicings(activeChord.chord, App.state.capo);
        const voicing = voicings && voicings[activeChord.voicingIndex || 0] || (voicings && voicings[0]);

        if (voicing) {
          const capo = App.state.capo || 0;
          const now = Tone.now();
          let strumOffset = 0;

          // Check each grid row for this column
          Tablature.GRID_ROWS.forEach(row => {
            const key = row.id + ':' + col;
            const cellVel = currentSection.gridState[key];
            if (!cellVel) return;

            const resolvedStrings = Tablature.resolveStrings([row.id], voicing);
            resolvedStrings.forEach(stringNum => {
              const note = Tablature.stringToNote(stringNum, voicing, capo);
              if (note) {
                s.triggerAttackRelease(note, '8n', now + strumOffset, velocity * cellVel);
                strumOffset += 0.008;
              }
            });
          });
        }
      }
    }

    scheduleNextColumn();
  }

  function scheduleNextColumn() {
    const sections = App.state.sections;
    const section = sections[playbackState.sectionIdx];
    if (!section) return;

    // Duration of one column in ms
    const beatDuration = App.getBeatDuration();
    const colDuration = (beatDuration / section.subdivisions) * 1000;

    playbackState.timer = setTimeout(() => {
      playbackState.currentCol++;
      playCurrentColumn();
    }, colDuration);
  }

  function init() {
    document.getElementById('btn-play').addEventListener('click', play);
    document.getElementById('btn-pause').addEventListener('click', pause);
    document.getElementById('btn-stop').addEventListener('click', stop);

    const loopBtn = document.getElementById('btn-loop');
    loopBtn.addEventListener('click', () => {
      App.state.loopSection = !App.state.loopSection;
      loopBtn.classList.toggle('active', App.state.loopSection);
    });

    // Instrument selector
    const instSel = document.getElementById('instrument-select');
    if (instSel) {
      instSel.addEventListener('change', () => {
        setInstrument(instSel.value);
      });
    }
  }

  return { init, playChord, play, pause, stop, findChordAtCol, setInstrument };
})();

// Alias for use in controls.js
const Audio = AudioEngine;
