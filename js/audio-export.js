// === Chord Builder — Audio Export (WAV via Tone.Offline) ===

const AudioExport = (() => {
  const DYNAMICS_VELOCITY = {
    'pp': 0.15,
    'p':  0.3,
    'mp': 0.45,
    'mf': 0.6,
    'f':  0.8,
    'ff': 1.0,
  };

  function getSongDurationSeconds() {
    let totalBeats = 0;
    App.state.sections.forEach(s => {
      totalBeats += s.totalBeats * (s.repeat || 1);
    });
    return totalBeats * App.getBeatDuration();
  }

  function buildNoteSchedule() {
    const schedule = [];
    let timeOffset = 0;
    const beatDuration = App.getBeatDuration();
    const capo = App.state.capo || 0;

    App.state.sections.forEach(section => {
      const repeats = section.repeat || 1;
      const totalCols = section.totalBeats * section.subdivisions;
      const colDuration = beatDuration / section.subdivisions;
      const dynamicsVel = DYNAMICS_VELOCITY[section.dynamics] || 0.6;

      for (let r = 0; r < repeats; r++) {
        for (let col = 0; col < totalCols; col++) {
          const time = timeOffset + col * colDuration;

          // Find active chord at this column
          const activeChord = findChordAtCol(section, col);
          if (!activeChord) continue;

          const voicings = ChordsDB.getVoicings(activeChord.chord, capo);
          const voicing = voicings && voicings[activeChord.voicingIndex || 0] || (voicings && voicings[0]);
          if (!voicing) continue;

          let strumOffset = 0;
          Tablature.GRID_ROWS.forEach(row => {
            const key = row.id + ':' + col;
            const cellVel = section.gridState[key];
            if (!cellVel) return;

            const resolvedStrings = Tablature.resolveStrings([row.id], voicing);
            resolvedStrings.forEach(stringNum => {
              const note = Tablature.stringToNote(stringNum, voicing, capo);
              if (note) {
                schedule.push({
                  time: time + strumOffset,
                  note: note,
                  duration: colDuration * 0.9,
                  velocity: dynamicsVel * cellVel,
                });
                strumOffset += 0.008;
              }
            });
          });
        }
        timeOffset += totalCols * colDuration;
      }
    });

    return schedule;
  }

  // Replicate findChordAtCol from AudioEngine (private there)
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

  async function exportWAV() {
    const btn = document.getElementById('btn-export-wav');
    if (!btn) return;

    btn.textContent = 'Rendering...';
    btn.disabled = true;

    try {
      const schedule = buildNoteSchedule();
      const duration = getSongDurationSeconds() + 1; // +1s for release tail
      const safeDuration = Math.max(duration, 0.5); // minimum duration for empty songs

      const buffer = await Tone.Offline(({ transport }) => {
        const synth = new Tone.PolySynth(Tone.Synth, {
          maxPolyphony: 24,
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

        schedule.forEach(({ time, note, duration, velocity }) => {
          synth.triggerAttackRelease(note, duration, time, velocity);
        });
      }, safeDuration);

      // Tone.Offline in v14 returns ToneAudioBuffer; get raw AudioBuffer
      const rawBuffer = buffer instanceof AudioBuffer ? buffer : buffer.get();
      const wav = audioBufferToWav(rawBuffer);
      const filename = (App.state.projectName || 'untitled') + '.wav';
      downloadBlob(wav, filename);
    } catch (err) {
      console.error('WAV export failed:', err);
      alert('WAV export failed: ' + err.message);
    } finally {
      btn.textContent = 'WAV';
      btn.disabled = false;
    }
  }

  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels and write PCM data
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channels[ch][i];
        // Clamp to [-1, 1]
        sample = Math.max(-1, Math.min(1, sample));
        // Convert to 16-bit integer
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function init() {
    const btn = document.getElementById('btn-export-wav');
    if (btn) {
      btn.addEventListener('click', exportWAV);
    }
  }

  return { init, exportWAV, getSongDurationSeconds, buildNoteSchedule };
})();
