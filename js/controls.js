// === Chord Builder — Controls & Palette UI ===

const Controls = (() => {

  function init() {
    setupKeySelect();
    setupModeSelect();
    setupCapoSelect();
    setupBPM();
    setupTimeSig();
    renderPalette();

    App.on('stateLoaded', () => {
      document.getElementById('key-select').value = App.state.key;
      document.getElementById('mode-select').value = App.state.mode;
      document.getElementById('capo-select').value = App.state.capo;
      document.getElementById('bpm-input').value = App.state.bpm;
      document.getElementById('time-sig-select').value = App.state.timeSignature;
      renderPalette();
    });

    App.on('slotSelected', (data) => {
      updateSuggestions(data.chord);
    });

    App.on('chordPlaced', (data) => {
      // After placing a chord, show suggestions for next
      updateSuggestions(data.chord);
    });

    App.on('chordSelected', (chordName) => {
      showChordDetail(chordName);
    });
  }

  function setupKeySelect() {
    const sel = document.getElementById('key-select');
    Theory.KEYS.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      sel.appendChild(opt);
    });
    sel.value = App.state.key;
    sel.addEventListener('change', () => {
      App.state.key = sel.value;
      renderPalette();
      App.emit('keyModeChanged');
      App.emit('songChanged');
    });
  }

  function setupModeSelect() {
    const sel = document.getElementById('mode-select');
    Theory.MODES.forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode.value;
      opt.textContent = mode.name;
      sel.appendChild(opt);
    });
    sel.value = App.state.mode;
    sel.addEventListener('change', () => {
      App.state.mode = sel.value;
      renderPalette();
      App.emit('keyModeChanged');
      App.emit('songChanged');
    });
  }

  function setupCapoSelect() {
    const sel = document.getElementById('capo-select');
    for (let i = 0; i <= 12; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i === 0 ? 'None' : `Fret ${i}`;
      sel.appendChild(opt);
    }
    sel.value = App.state.capo;
    sel.addEventListener('change', () => {
      App.state.capo = parseInt(sel.value, 10);
      renderPalette();
      // Re-render chord detail if one is shown
      if (App.state.selectedChord) {
        showChordDetail(App.state.selectedChord);
      }
      App.emit('songChanged');
    });
  }

  function setupBPM() {
    const input = document.getElementById('bpm-input');
    input.value = App.state.bpm;
    input.addEventListener('change', () => {
      let val = parseInt(input.value, 10);
      if (isNaN(val) || val < 40) val = 40;
      if (val > 240) val = 240;
      input.value = val;
      App.state.bpm = val;
      App.emit('songChanged');
    });
  }

  function setupTimeSig() {
    const sel = document.getElementById('time-sig-select');
    sel.value = App.state.timeSignature;
    sel.addEventListener('change', () => {
      App.state.timeSignature = sel.value;
      App.emit('timeSignatureChanged');
      App.emit('songChanged');
    });
  }

  function renderPalette() {
    const container = document.getElementById('palette-chords');
    container.innerHTML = '';

    const diatonic = Theory.getDiatonicChords(App.state.key, App.state.mode);

    diatonic.forEach(chord => {
      // Group label
      const groupLabel = document.createElement('div');
      groupLabel.className = 'palette-group-label';
      groupLabel.textContent = `${chord.numeral} — ${chord.root}`;
      container.appendChild(groupLabel);

      // Each variant
      chord.variants.forEach(variant => {
        const el = document.createElement('div');
        el.className = 'palette-chord';
        el.draggable = true;
        el.dataset.chord = variant;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chord-name';
        nameSpan.textContent = variant;

        const numeralSpan = document.createElement('span');
        numeralSpan.className = 'chord-numeral';
        numeralSpan.textContent = chord.numeral;

        el.append(nameSpan, numeralSpan);

        // Drag start
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', variant);
          el.classList.add('dragging');
        });

        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
        });

        // Click to preview
        el.addEventListener('click', () => {
          App.state.selectedChord = variant;
          App.state.selectedVoicingIndex = 0;
          App.emit('chordSelected', variant);
          showChordDetail(variant);
          // Play the chord
          if (typeof Audio !== 'undefined' && Audio.playChord) {
            Audio.playChord(variant);
          }
        });

        container.appendChild(el);
      });
    });
  }

  function showChordDetail(chordName) {
    document.getElementById('detail-chord-name').textContent = chordName;

    // Main diagram
    const diagramContainer = document.getElementById('detail-diagram');
    diagramContainer.innerHTML = '';
    const voicings = ChordsDB.getVoicings(chordName, App.state.capo);
    const selectedIdx = App.state.selectedVoicingIndex || 0;

    if (voicings.length > 0) {
      const mainDiagramDiv = document.createElement('div');
      mainDiagramDiv.style.width = '220px';
      mainDiagramDiv.style.height = '240px';
      diagramContainer.appendChild(mainDiagramDiv);
      Diagrams.render(mainDiagramDiv, voicings[Math.min(selectedIdx, voicings.length - 1)]);
    } else {
      diagramContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">No voicing available</p>';
    }

    // Alternative voicings
    const voicingOptions = document.getElementById('voicing-options');
    voicingOptions.innerHTML = '';

    if (voicings.length > 1) {
      voicings.forEach((v, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'voicing-thumb' + (i === selectedIdx ? ' active' : '');

        const thumbDiagram = document.createElement('div');
        thumbDiagram.style.width = '62px';
        thumbDiagram.style.height = '60px';
        thumb.appendChild(thumbDiagram);

        const label = document.createElement('div');
        label.className = 'voicing-label';
        label.textContent = v.label || `Voicing ${i + 1}`;
        thumb.appendChild(label);

        requestAnimationFrame(() => {
          Diagrams.renderMini(thumbDiagram, v);
        });

        thumb.addEventListener('click', () => {
          App.state.selectedVoicingIndex = i;
          // Update the slot's voicing too
          if (App.state.selectedSlot) {
            const slot = App.state.selectedSlot;
            const measure = App.state.sections[slot.sectionIndex]?.measures[slot.measureIndex];
            if (measure) measure.voicingIndex = i;
          }
          showChordDetail(chordName);
          App.emit('songChanged');
        });

        voicingOptions.appendChild(thumb);
      });
    }

    // Suggestions
    updateSuggestions(chordName);
  }

  function updateSuggestions(currentChord) {
    const listEl = document.getElementById('suggestion-list');
    listEl.innerHTML = '';

    // Clear previous suggested state
    document.querySelectorAll('.palette-chord.suggested').forEach(el => {
      el.classList.remove('suggested');
    });
    // Remove any existing suggestions group at top
    const oldGroup = document.getElementById('palette-suggestions-group');
    if (oldGroup) oldGroup.remove();

    if (!currentChord) return;

    const suggestions = Theory.suggestNextChords(App.state.key, App.state.mode, currentChord);
    if (suggestions.length === 0) return;

    const paletteContainer = document.getElementById('palette-chords');
    const suggestedNames = new Set(suggestions.map(s => s.chord));

    // Build a suggestions group to insert at the top of the palette
    const sugGroup = document.createElement('div');
    sugGroup.id = 'palette-suggestions-group';

    const sugLabel = document.createElement('div');
    sugLabel.className = 'palette-group-label suggested-label';
    sugLabel.textContent = 'Suggested Next';
    sugGroup.appendChild(sugLabel);

    suggestions.forEach(s => {
      // Detail panel chip
      const chip = document.createElement('div');
      chip.className = 'suggestion-chip';
      chip.innerHTML = `
        <span class="chip-name">${s.chord}</span>
        <span class="chip-reason">${s.reason}</span>
      `;

      chip.addEventListener('click', () => {
        if (App.state.selectedSlot) {
          const { sectionIndex, measureIndex } = App.state.selectedSlot;
          const section = App.state.sections[sectionIndex];
          if (section) {
            for (let i = measureIndex + 1; i < section.measures.length; i++) {
              if (!section.measures[i].chord) {
                section.measures[i].chord = s.chord;
                section.measures[i].voicingIndex = 0;
                App.state.selectedSlot = { sectionIndex, measureIndex: i };
                Timeline.render();
                App.emit('songChanged');
                updateSuggestions(s.chord);
                return;
              }
            }
          }
        }
        App.state.selectedChord = s.chord;
        showChordDetail(s.chord);
      });

      listEl.appendChild(chip);

      // Clone matching palette chord into the suggestions group at top
      const existing = paletteContainer.querySelector(`.palette-chord[data-chord="${s.chord}"]`);
      if (existing) {
        const clone = existing.cloneNode(true);
        clone.classList.add('suggested');
        // Re-attach event listeners on clone
        clone.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', s.chord);
          clone.classList.add('dragging');
        });
        clone.addEventListener('dragend', () => clone.classList.remove('dragging'));
        clone.addEventListener('click', () => {
          App.state.selectedChord = s.chord;
          App.state.selectedVoicingIndex = 0;
          App.emit('chordSelected', s.chord);
          showChordDetail(s.chord);
          if (typeof Audio !== 'undefined' && Audio.playChord) {
            Audio.playChord(s.chord);
          }
        });

        // Add reason tag
        const reasonTag = document.createElement('span');
        reasonTag.className = 'chord-reason';
        reasonTag.textContent = s.reason;
        clone.appendChild(reasonTag);

        sugGroup.appendChild(clone);
      }
    });

    // Insert suggestions group at the very top of the palette
    paletteContainer.insertBefore(sugGroup, paletteContainer.firstChild);
  }

  return { init, renderPalette, showChordDetail };
})();
