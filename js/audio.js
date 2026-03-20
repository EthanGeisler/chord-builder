// === Chord Builder — Audio Playback Engine (Tone.js) ===

const AudioEngine = (() => {
  let synth = null;
  let playbackInterval = null;
  let toneStarted = false;

  const DYNAMICS_VELOCITY = {
    'pp': 0.15,
    'p':  0.3,
    'mp': 0.45,
    'mf': 0.6,
    'f':  0.8,
    'ff': 1.0,
  };

  // Strum patterns: arrays of { beat, direction, velocity_mult }
  // Beat is fraction of measure (0-1)
  const STRUM_PATTERNS = {
    'all-down': (beats) => {
      const hits = [];
      for (let i = 0; i < beats; i++) {
        hits.push({ beat: i / beats, dir: 'down', vel: 1.0 });
      }
      return hits;
    },
    'down-up': (beats) => {
      const hits = [];
      for (let i = 0; i < beats; i++) {
        hits.push({ beat: i / beats, dir: 'down', vel: 1.0 });
        hits.push({ beat: (i + 0.5) / beats, dir: 'up', vel: 0.7 });
      }
      return hits;
    },
    'folk': (beats) => {
      const hits = [];
      for (let i = 0; i < beats; i++) {
        hits.push({ beat: i / beats, dir: i === 0 ? 'bass' : 'up', vel: i === 0 ? 1.0 : 0.6 });
      }
      return hits;
    },
    'pop': (beats) => {
      // D - DU-UDU pattern
      const pattern = [
        { beat: 0, dir: 'down', vel: 1.0 },
        { beat: 0.25, dir: 'down', vel: 0.8 },
        { beat: 0.375, dir: 'up', vel: 0.6 },
        { beat: 0.625, dir: 'up', vel: 0.6 },
        { beat: 0.75, dir: 'down', vel: 0.8 },
        { beat: 0.875, dir: 'up', vel: 0.6 },
      ];
      return pattern;
    },
    'reggae': (beats) => {
      const hits = [];
      for (let i = 0; i < beats; i++) {
        hits.push({ beat: (i + 0.5) / beats, dir: 'up', vel: 0.8 });
      }
      return hits;
    },
    'arpeggio': (beats) => {
      const hits = [];
      const notesPerBeat = 4;
      for (let i = 0; i < beats; i++) {
        for (let n = 0; n < notesPerBeat; n++) {
          hits.push({ beat: (i + n / notesPerBeat) / beats, dir: 'arp', vel: 0.7, noteIndex: n });
        }
      }
      return hits;
    },
  };

  async function ensureToneStarted() {
    if (!toneStarted && typeof Tone !== 'undefined') {
      await Tone.start();
      toneStarted = true;
    }
  }

  function getSynth() {
    if (!synth && typeof Tone !== 'undefined') {
      synth = new Tone.PolySynth(Tone.Synth, {
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
      synth.volume.value = -6;
    }
    return synth;
  }

  // Convert chord name to playable notes with octaves
  function chordToNotes(chordName) {
    const noteNames = Theory.getChordNotes(chordName);
    if (!noteNames || noteNames.length === 0) return [];

    // Assign octaves — root at octave 3, stack upward
    return noteNames.map((note, i) => {
      const octave = i === 0 ? 3 : (i < 3 ? 4 : 5);
      return note + octave;
    });
  }

  // Play a single chord (click preview)
  async function playChord(chordName, velocity = 0.6) {
    await ensureToneStarted();
    const s = getSynth();
    if (!s) return;

    const notes = chordToNotes(chordName);
    if (notes.length === 0) return;

    // Stagger notes slightly for strum feel
    const now = Tone.now();
    notes.forEach((note, i) => {
      s.triggerAttackRelease(note, '4n', now + i * 0.02, velocity);
    });
  }

  // Full song playback
  let playbackState = {
    sectionIdx: 0,
    measureIdx: 0,
    timer: null,
    stopped: false,
  };

  async function play() {
    await ensureToneStarted();

    if (App.state.isPaused) {
      // Resume from paused position
      App.state.isPaused = false;
      App.state.isPlaying = true;
      scheduleNextMeasure();
      return;
    }

    App.state.isPlaying = true;
    App.state.isPaused = false;
    playbackState.sectionIdx = App.state.playbackPosition.section;
    playbackState.measureIdx = App.state.playbackPosition.measure;
    playbackState.stopped = false;

    playCurrentMeasure();
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
    playbackState.measureIdx = 0;
    App.state.playbackPosition = { section: 0, measure: 0 };
    Timeline.setPlayingMeasure(-1, -1);

    // Release all notes
    const s = getSynth();
    if (s) s.releaseAll();
  }

  function playCurrentMeasure() {
    if (playbackState.stopped || App.state.isPaused) return;

    const sections = App.state.sections;
    if (playbackState.sectionIdx >= sections.length) {
      // Song ended
      stop();
      return;
    }

    const section = sections[playbackState.sectionIdx];
    if (playbackState.measureIdx >= section.measures.length) {
      // Section ended
      if (App.state.loopSection) {
        playbackState.measureIdx = 0;
      } else {
        playbackState.sectionIdx++;
        playbackState.measureIdx = 0;
        if (playbackState.sectionIdx >= sections.length) {
          stop();
          return;
        }
      }
    }

    const currentSection = sections[playbackState.sectionIdx];
    const measure = currentSection.measures[playbackState.measureIdx];

    // Update visual
    Timeline.setPlayingMeasure(playbackState.sectionIdx, playbackState.measureIdx);
    App.state.playbackPosition = {
      section: playbackState.sectionIdx,
      measure: playbackState.measureIdx,
    };

    // Play chord if present
    if (measure && measure.chord) {
      const velocity = DYNAMICS_VELOCITY[currentSection.dynamics] || 0.6;
      const pattern = currentSection.strumPattern || 'down-up';
      const voicings = ChordsDB.getVoicings(measure.chord, App.state.capo);
      const voicing = voicings && voicings[measure.voicingIndex || 0] || (voicings && voicings[0]);
      playMeasureWithPattern(measure.chord, pattern, velocity, voicing);
    }

    // Schedule next measure
    scheduleNextMeasure();
  }

  function scheduleNextMeasure() {
    const duration = App.getMeasureDuration() * 1000; // ms
    playbackState.timer = setTimeout(() => {
      playbackState.measureIdx++;
      playCurrentMeasure();
    }, duration);
  }

  function playMeasureWithPattern(chordName, pattern, velocity, voicing) {
    const s = getSynth();
    if (!s) return;

    const measureDuration = App.getMeasureDuration();
    const now = Tone.now();

    // Check if this is a string-based arpeggio pattern
    const arpPattern = typeof Tablature !== 'undefined' && Tablature.ARPEGGIO_PATTERNS[pattern];
    if (arpPattern && voicing) {
      const capo = App.state.capo || 0;
      arpPattern.steps.forEach(step => {
        const time = now + step.beat * measureDuration;
        const vel = velocity * step.vel;
        const resolvedStrings = Tablature.resolveStrings(step.strings, voicing);

        resolvedStrings.forEach(stringNum => {
          const note = Tablature.stringToNote(stringNum, voicing, capo);
          if (note) {
            s.triggerAttackRelease(note, '8n', time, vel);
          }
        });
      });
      return;
    }

    // Fallback to existing strum pattern logic
    const notes = chordToNotes(chordName);
    if (notes.length === 0) return;

    const beats = App.getBeatsPerMeasure();
    const patternFn = STRUM_PATTERNS[pattern] || STRUM_PATTERNS['down-up'];
    const hits = patternFn(beats);

    hits.forEach(hit => {
      const time = now + hit.beat * measureDuration;
      const vel = velocity * hit.vel;

      if (hit.dir === 'arp' && hit.noteIndex !== undefined) {
        // Arpeggio — play individual notes
        const noteIdx = hit.noteIndex % notes.length;
        s.triggerAttackRelease(notes[noteIdx], '8n', time, vel);
      } else if (hit.dir === 'bass') {
        // Bass note only
        s.triggerAttackRelease(notes[0], '4n', time, vel);
      } else {
        // Full chord strum
        const strumNotes = hit.dir === 'up' ? [...notes].reverse() : notes;
        strumNotes.forEach((note, i) => {
          s.triggerAttackRelease(note, '8n', time + i * 0.015, vel);
        });
      }
    });
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
  }

  return { init, playChord, play, pause, stop };
})();

// Alias for use in controls.js
const Audio = AudioEngine;
