// === Chord Builder — MIDI Export ===

const MidiExport = (() => {
  const PPQ = 480; // pulses per quarter note

  // Duplicate from AudioEngine (private there)
  const DYNAMICS_VELOCITY = {
    'pp': 0.15,
    'p':  0.3,
    'mp': 0.45,
    'mf': 0.6,
    'f':  0.8,
    'ff': 1.0,
  };

  const NOTE_MAP = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };

  function noteNameToMidi(name) {
    const match = name.match(/^([A-G]#?)(\d+)$/);
    if (!match) return null;
    return (parseInt(match[2]) + 1) * 12 + NOTE_MAP[match[1]];
  }

  // Variable-length quantity encoding
  function writeVarLen(value) {
    const bytes = [];
    bytes.push(value & 0x7F);
    value >>= 7;
    while (value > 0) {
      bytes.push((value & 0x7F) | 0x80);
      value >>= 7;
    }
    bytes.reverse();
    return bytes;
  }

  function writeUint16BE(val) {
    return [(val >> 8) & 0xFF, val & 0xFF];
  }

  function writeUint32BE(val) {
    return [(val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF];
  }

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

  function buildMidiFileProper() {
    const state = App.state;
    const bpm = state.bpm || 120;
    const timeSig = state.timeSignature || '4/4';
    const [tsNum, tsDenom] = timeSig.split('/').map(Number);
    const capo = state.capo || 0;

    // Collect all MIDI events as { tick, type, data }
    const events = [];

    // Tempo meta event at tick 0
    const usPerBeat = Math.round(60000000 / bpm);
    events.push({ tick: 0, bytes: [0xFF, 0x51, 0x03,
      (usPerBeat >> 16) & 0xFF, (usPerBeat >> 8) & 0xFF, usPerBeat & 0xFF] });

    // Time signature meta event at tick 0
    const denomPower = Math.log2(tsDenom);
    events.push({ tick: 0, bytes: [0xFF, 0x58, 0x04,
      tsNum, denomPower, 24, 8] });

    // Walk sections
    let currentTick = 0;

    for (const section of state.sections) {
      const repeatCount = section.repeat || 1;
      const totalCols = section.totalBeats * section.subdivisions;
      const ticksPerCol = PPQ / section.subdivisions;
      const dynamicsMultiplier = DYNAMICS_VELOCITY[section.dynamics] || 0.6;

      for (let rep = 0; rep < repeatCount; rep++) {
        for (let col = 0; col < totalCols; col++) {
          const colTick = currentTick + col * ticksPerCol;
          const activeChord = findChordAtCol(section, col);

          if (!activeChord) continue;

          const voicings = ChordsDB.getVoicings(activeChord.chord, capo);
          const voicing = voicings && voicings[activeChord.voicingIndex || 0] || (voicings && voicings[0]);
          if (!voicing) continue;

          Tablature.GRID_ROWS.forEach(row => {
            const key = row.id + ':' + col;
            const cellVel = section.gridState[key];
            if (!cellVel) return;

            const resolvedStrings = Tablature.resolveStrings([row.id], voicing);
            resolvedStrings.forEach(stringNum => {
              const noteName = Tablature.stringToNote(stringNum, voicing, capo);
              if (!noteName) return;
              const midi = noteNameToMidi(noteName);
              if (midi === null) return;

              const velocity = Math.min(127, Math.max(1, Math.round(cellVel * dynamicsMultiplier * 127)));
              const noteOffTick = colTick + ticksPerCol;

              // Note on (channel 0)
              events.push({ tick: colTick, bytes: [0x90, midi, velocity] });
              // Note off
              events.push({ tick: noteOffTick, bytes: [0x80, midi, 0] });
            });
          });
        }
        currentTick += totalCols * ticksPerCol;
      }
    }

    // Sort events by tick, then note-off before note-on at same tick
    events.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      // Meta events first, then note-off before note-on
      const aType = a.bytes[0] === 0xFF ? 0 : (a.bytes[0] === 0x80 ? 1 : 2);
      const bType = b.bytes[0] === 0xFF ? 0 : (b.bytes[0] === 0x80 ? 1 : 2);
      return aType - bType;
    });

    // End of track at the end
    events.push({ tick: currentTick, bytes: [0xFF, 0x2F, 0x00] });

    // Serialize track data with delta times
    const trackBytes = [];
    let lastTick = 0;
    for (const evt of events) {
      const delta = evt.tick - lastTick;
      trackBytes.push(...writeVarLen(delta));
      trackBytes.push(...evt.bytes);
      lastTick = evt.tick;
    }

    // Build full MIDI file
    const output = [];

    // Header chunk: MThd
    output.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
    output.push(...writeUint32BE(6));      // header length
    output.push(...writeUint16BE(0));      // format 0
    output.push(...writeUint16BE(1));      // 1 track
    output.push(...writeUint16BE(PPQ));    // ticks per quarter

    // Track chunk: MTrk
    output.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
    output.push(...writeUint32BE(trackBytes.length));
    output.push(...trackBytes);

    return new Uint8Array(output);
  }

  function exportMidi() {
    const data = buildMidiFileProper();
    const blob = new Blob([data], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (App.state.projectName || 'untitled') + '.mid';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function init() {
    const btn = document.getElementById('btn-export-midi');
    if (btn) {
      btn.addEventListener('click', exportMidi);
    }
  }

  return { init, exportMidi, buildMidiFile: buildMidiFileProper, noteNameToMidi };
})();
