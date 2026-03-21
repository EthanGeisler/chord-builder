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
      renderCustomVoicings();
    });

    App.on('customVoicingAdded', () => renderCustomVoicings());
    App.on('customVoicingRemoved', () => renderCustomVoicings());

    App.on('slotSelected', (data) => {
      updateSuggestions(data.chord);
    });

    App.on('chordPlaced', (data) => {
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

  // Track which note groups are collapsed
  const collapsedGroups = new Set();

  function renderPalette() {
    const container = document.getElementById('palette-chords');
    container.innerHTML = '';

    const diatonic = Theory.getDiatonicChords(App.state.key, App.state.mode);

    // Build a lookup of diatonic roots for numeral display
    const diatonicMap = {};
    diatonic.forEach(chord => {
      chord.variants.forEach(v => { diatonicMap[v] = chord.numeral; });
    });

    // Group all 12 chromatic roots with common chord types
    const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const groups = {};

    noteOrder.forEach(root => {
      // Standard chord variants for every root
      const variants = [
        root, root + 'm', root + '7', root + 'maj7', root + 'm7',
        root + 'sus2', root + 'sus4', root + 'add9', root + 'dim', root + 'aug',
      ];
      groups[root] = variants.map(variant => ({
        variant,
        numeral: diatonicMap[variant] || '',
        isDiatonic: !!diatonicMap[variant],
      }));
    });

    // Determine which roots are diatonic (have at least one diatonic chord)
    const diatonicRoots = new Set(diatonic.map(c => c.root));

    noteOrder.forEach(letter => {
      if (!groups[letter] || groups[letter].length === 0) return;

      const isDiatonicRoot = diatonicRoots.has(letter);

      const groupDiv = document.createElement('div');
      groupDiv.className = 'palette-group';
      if (!isDiatonicRoot) groupDiv.classList.add('non-diatonic');
      // All groups start collapsed unless user explicitly opened them
      const isCollapsed = !collapsedGroups.has('_opened_' + letter);
      if (isCollapsed) groupDiv.classList.add('collapsed');

      const toggle = document.createElement('button');
      toggle.className = 'palette-group-toggle';
      toggle.innerHTML = `<span>${letter}</span><span class="toggle-arrow">\u25BC</span>`;
      toggle.addEventListener('click', () => {
        const wasCollapsed = groupDiv.classList.contains('collapsed');
        if (wasCollapsed) {
          collapsedGroups.delete(letter);
          if (!isDiatonicRoot) collapsedGroups.add('_opened_' + letter);
        } else {
          collapsedGroups.add(letter);
          collapsedGroups.delete('_opened_' + letter);
        }
        groupDiv.classList.toggle('collapsed');
      });
      groupDiv.appendChild(toggle);

      const contents = document.createElement('div');
      contents.className = 'palette-group-contents';

      groups[letter].forEach(({ variant, numeral, isDiatonic }) => {
        const el = document.createElement('div');
        el.className = 'palette-chord' + (isDiatonic ? ' diatonic' : '');
        el.draggable = true;
        el.dataset.chord = variant;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chord-name';
        nameSpan.textContent = variant;

        const numeralSpan = document.createElement('span');
        numeralSpan.className = 'chord-numeral';
        numeralSpan.textContent = numeral;

        el.append(nameSpan, numeralSpan);

        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', variant);
          el.classList.add('dragging');
        });

        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
        });

        el.addEventListener('click', () => {
          App.state.selectedChord = variant;
          App.state.selectedVoicingIndex = 0;
          App.emit('chordSelected', variant);
          showChordDetail(variant);
          if (typeof Audio !== 'undefined' && Audio.playChord) {
            Audio.playChord(variant);
          }
        });

        contents.appendChild(el);
      });

      groupDiv.appendChild(contents);
      container.appendChild(groupDiv);
    });

    // Creator button at bottom of palette
    const creatorsDiv = document.createElement('div');
    creatorsDiv.className = 'palette-creators';

    const createChordBtn = document.createElement('button');
    createChordBtn.className = 'btn-create-chord';
    createChordBtn.textContent = '+ Create Chord';
    createChordBtn.addEventListener('click', () => {
      if (typeof ChordCreator !== 'undefined') ChordCreator.open();
    });
    creatorsDiv.appendChild(createChordBtn);

    container.appendChild(creatorsDiv);

    renderCustomVoicings();
  }

  function renderCustomVoicings() {
    const container = document.getElementById('palette-chords');
    if (!container) return;

    const oldGroup = container.querySelector('.custom-voicings-group');
    if (oldGroup) oldGroup.remove();

    const customs = App.state.customVoicings;
    if (!customs || customs.length === 0) return;

    const group = document.createElement('div');
    group.className = 'custom-voicings-group';

    const groupLabel = document.createElement('div');
    groupLabel.className = 'palette-group-label';
    groupLabel.textContent = 'Custom Voicings';
    group.appendChild(groupLabel);

    customs.forEach(cv => {
      const el = document.createElement('div');
      el.className = 'palette-chord custom-voicing-chip';
      el.draggable = true;
      el.dataset.chord = cv.name;
      el.dataset.customId = cv.id;

      const miniDiv = document.createElement('div');
      miniDiv.className = 'mini-diagram';
      el.appendChild(miniDiv);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chord-name';
      nameSpan.textContent = cv.label || cv.name;
      el.appendChild(nameSpan);

      const delBtn = document.createElement('span');
      delBtn.className = 'custom-voicing-delete';
      delBtn.textContent = '\u00d7';
      delBtn.title = 'Remove custom voicing';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomVoicing(cv.id);
      });
      el.appendChild(delBtn);

      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', cv.name);
        e.dataTransfer.setData('application/x-custom-voicing-id', cv.id);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      el.addEventListener('click', () => {
        App.state.selectedChord = cv.name;
        App.state.selectedVoicingIndex = 0;
        App.emit('chordSelected', cv.name);
        showChordDetail(cv.name);
        if (typeof Audio !== 'undefined' && Audio.playChord) {
          Audio.playChord(cv.name);
        }
      });

      group.appendChild(el);

      requestAnimationFrame(() => {
        if (cv.voicing) Diagrams.renderMini(miniDiv, cv.voicing);
      });
    });

    container.appendChild(group);
  }

  function removeCustomVoicing(id) {
    App.state.customVoicings = App.state.customVoicings.filter(cv => cv.id !== id);
    ChordsDB.removeCustomVoicing(id);
    App.emit('customVoicingRemoved', { id });
    App.emit('songChanged');
  }

  function showChordDetail(chordName) {
    document.getElementById('detail-chord-name').textContent = chordName;

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
          // Update the selected chord's voicing in the section
          if (App.state.selectedSlot) {
            const slot = App.state.selectedSlot;
            const section = App.state.sections[slot.sectionIndex];
            if (section && section.chords[slot.chordIndex]) {
              section.chords[slot.chordIndex].voicingIndex = i;
            }
          }
          showChordDetail(chordName);
          App.emit('songChanged');
        });

        voicingOptions.appendChild(thumb);
      });
    }

    updateSuggestions(chordName);
  }

  function updateSuggestions(currentChord) {
    const listEl = document.getElementById('suggestion-list');
    listEl.innerHTML = '';

    document.querySelectorAll('.palette-chord.suggested').forEach(el => {
      el.classList.remove('suggested');
    });
    const oldGroup = document.getElementById('palette-suggestions-group');
    if (oldGroup) oldGroup.remove();

    if (!currentChord) return;

    const suggestions = Theory.suggestNextChords(App.state.key, App.state.mode, currentChord);
    if (suggestions.length === 0) return;

    const paletteContainer = document.getElementById('palette-chords');

    const sugGroup = document.createElement('div');
    sugGroup.id = 'palette-suggestions-group';

    const sugLabel = document.createElement('div');
    sugLabel.className = 'palette-group-label suggested-label';
    sugLabel.textContent = 'Suggested Next';
    sugGroup.appendChild(sugLabel);

    suggestions.forEach(s => {
      const chip = document.createElement('div');
      chip.className = 'suggestion-chip';
      chip.innerHTML = `
        <span class="chip-name">${s.chord}</span>
        <span class="chip-reason">${s.reason}</span>
      `;

      chip.addEventListener('click', () => {
        App.state.selectedChord = s.chord;
        showChordDetail(s.chord);
      });

      listEl.appendChild(chip);

      const existing = paletteContainer.querySelector(`.palette-chord[data-chord="${s.chord}"]`);
      if (existing) {
        const clone = existing.cloneNode(true);
        clone.classList.add('suggested');
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

        const reasonTag = document.createElement('span');
        reasonTag.className = 'chord-reason';
        reasonTag.textContent = s.reason;
        clone.appendChild(reasonTag);

        sugGroup.appendChild(clone);
      }
    });

    paletteContainer.insertBefore(sugGroup, paletteContainer.firstChild);
  }

  return { init, renderPalette, showChordDetail, renderCustomVoicings };
})();
