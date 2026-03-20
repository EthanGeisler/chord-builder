// === Chord Builder — Song Timeline & Drag-and-Drop ===

const Timeline = (() => {
  const container = () => document.getElementById('timeline-sections');

  function init() {
    render();
    setupDragFromPalette();

    document.getElementById('btn-add-section').addEventListener('click', addSection);

    App.on('stateLoaded', render);
    App.on('keyModeChanged', render);
    App.on('timeSignatureChanged', render);
  }

  function render() {
    const el = container();
    el.innerHTML = '';

    App.state.sections.forEach((section, sIdx) => {
      el.appendChild(createSectionElement(section, sIdx));
    });
  }

  function createSectionElement(section, sIdx) {
    const div = document.createElement('div');
    div.className = 'timeline-section';
    div.dataset.sectionIndex = sIdx;

    // Section header
    const header = document.createElement('div');
    header.className = 'section-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'section-name';
    nameInput.value = section.name;
    nameInput.addEventListener('change', () => {
      section.name = nameInput.value;
      App.emit('songChanged');
    });

    const controls = document.createElement('div');
    controls.className = 'section-controls';

    // Dynamics dropdown
    const dynLabel = document.createElement('label');
    dynLabel.textContent = 'Dyn:';
    dynLabel.style.fontSize = '0.7rem';
    dynLabel.style.color = 'var(--text-muted)';
    const dynSelect = document.createElement('select');
    ['pp', 'p', 'mp', 'mf', 'f', 'ff'].forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      if (d === section.dynamics) opt.selected = true;
      dynSelect.appendChild(opt);
    });
    dynSelect.addEventListener('change', () => {
      section.dynamics = dynSelect.value;
      App.emit('songChanged');
    });

    // Pattern dropdown (strum + arpeggio)
    const strumLabel = document.createElement('label');
    strumLabel.textContent = 'Pattern:';
    strumLabel.style.fontSize = '0.7rem';
    strumLabel.style.color = 'var(--text-muted)';
    const strumSelect = document.createElement('select');

    // Strum patterns group
    const strumGroup = document.createElement('optgroup');
    strumGroup.label = 'Strum Patterns';
    const strumPatterns = [
      { value: 'all-down', label: 'All Downstrokes' },
      { value: 'down-up', label: 'Down-Up' },
      { value: 'folk', label: 'Folk Fingerpick' },
      { value: 'pop', label: 'Pop Strum' },
      { value: 'reggae', label: 'Reggae Offbeat' },
      { value: 'arpeggio', label: 'Arpeggio' },
    ];
    strumPatterns.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      if (p.value === section.strumPattern) opt.selected = true;
      strumGroup.appendChild(opt);
    });
    strumSelect.appendChild(strumGroup);

    // Arpeggio patterns group (filtered by current time signature)
    const arpGroup = document.createElement('optgroup');
    arpGroup.label = 'Arpeggio Patterns';
    const arpPatterns = Tablature.getPatternsForTimeSig(App.state.timeSignature);
    arpPatterns.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.name;
      if (p.key === section.strumPattern) opt.selected = true;
      arpGroup.appendChild(opt);
    });
    if (arpPatterns.length > 0) strumSelect.appendChild(arpGroup);

    strumSelect.addEventListener('change', () => {
      section.strumPattern = strumSelect.value;
      render();
      App.emit('songChanged');
    });

    // Add/remove measure buttons
    const addMeasure = document.createElement('button');
    addMeasure.textContent = '+Bar';
    addMeasure.title = 'Add measure';
    addMeasure.addEventListener('click', () => {
      section.measures.push({ chord: null, voicingIndex: 0 });
      render();
      App.emit('songChanged');
    });

    const removeMeasure = document.createElement('button');
    removeMeasure.textContent = '-Bar';
    removeMeasure.title = 'Remove last measure';
    removeMeasure.addEventListener('click', () => {
      if (section.measures.length > 1) {
        section.measures.pop();
        render();
        App.emit('songChanged');
      }
    });

    // Move section up/down
    const moveUp = document.createElement('button');
    moveUp.textContent = '\u25B2';
    moveUp.title = 'Move section up';
    moveUp.addEventListener('click', () => {
      if (sIdx > 0) {
        const sections = App.state.sections;
        [sections[sIdx - 1], sections[sIdx]] = [sections[sIdx], sections[sIdx - 1]];
        render();
        App.emit('songChanged');
      }
    });

    const moveDown = document.createElement('button');
    moveDown.textContent = '\u25BC';
    moveDown.title = 'Move section down';
    moveDown.addEventListener('click', () => {
      if (sIdx < App.state.sections.length - 1) {
        const sections = App.state.sections;
        [sections[sIdx], sections[sIdx + 1]] = [sections[sIdx + 1], sections[sIdx]];
        render();
        App.emit('songChanged');
      }
    });

    // Delete section
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '\u2715';
    deleteBtn.title = 'Delete section';
    deleteBtn.style.color = 'var(--accent)';
    deleteBtn.addEventListener('click', () => {
      if (App.state.sections.length > 1 || confirm('Delete the only section?')) {
        App.state.sections.splice(sIdx, 1);
        if (App.state.sections.length === 0) {
          App.state.sections.push({
            name: 'Verse',
            measures: Array.from({ length: 4 }, () => ({ chord: null, voicingIndex: 0 })),
            dynamics: 'mf',
            strumPattern: 'down-up',
          });
        }
        render();
        App.emit('songChanged');
      }
    });

    controls.append(dynLabel, dynSelect, strumLabel, strumSelect, addMeasure, removeMeasure, moveUp, moveDown, deleteBtn);
    header.append(nameInput, controls);
    div.appendChild(header);

    // Measures
    const measuresDiv = document.createElement('div');
    measuresDiv.className = 'section-measures';

    const sectionPattern = section.strumPattern || 'down-up';
    // Insert gap before first slot
    measuresDiv.appendChild(createInsertGap(sIdx, 0));
    section.measures.forEach((measure, mIdx) => {
      measuresDiv.appendChild(createMeasureSlot(measure, sIdx, mIdx, sectionPattern));
      // Insert gap after each slot
      measuresDiv.appendChild(createInsertGap(sIdx, mIdx + 1));
    });

    div.appendChild(measuresDiv);
    return div;
  }

  function createMeasureSlot(measure, sIdx, mIdx, sectionPattern) {
    const isArpeggio = sectionPattern && !!Tablature.ARPEGGIO_PATTERNS[sectionPattern];
    const slot = document.createElement('div');
    slot.className = 'measure-slot' + (measure.chord ? ' filled' : '') + (isArpeggio ? ' has-tab' : '');
    slot.dataset.sectionIndex = sIdx;
    slot.dataset.measureIndex = mIdx;

    const numberLabel = document.createElement('span');
    numberLabel.className = 'slot-number';
    numberLabel.textContent = mIdx + 1;
    slot.appendChild(numberLabel);

    if (measure.chord) {
      const nameEl = document.createElement('div');
      nameEl.className = 'slot-chord-name';
      nameEl.textContent = measure.chord;
      slot.appendChild(nameEl);

      const diagramEl = document.createElement('div');
      diagramEl.className = 'slot-diagram';
      slot.appendChild(diagramEl);

      // Tablature canvas (only for arpeggio patterns)
      let tabCanvas = null;
      if (isArpeggio) {
        tabCanvas = document.createElement('canvas');
        tabCanvas.className = 'slot-tablature';
        slot.appendChild(tabCanvas);
      }

      // Render mini diagram (and tablature) after DOM insertion
      requestAnimationFrame(() => {
        const voicings = ChordsDB.getVoicings(measure.chord, App.state.capo);
        const voicing = voicings && voicings[measure.voicingIndex || 0] || (voicings && voicings[0]);
        if (voicing) {
          Diagrams.renderMini(diagramEl, voicing);
          if (tabCanvas && isArpeggio) {
            Tablature.render(tabCanvas, voicing, sectionPattern);
          }
        }
      });

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'slot-remove';
      removeBtn.textContent = '\u2715';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        measure.chord = null;
        measure.voicingIndex = 0;
        render();
        App.emit('songChanged');
      });
      slot.appendChild(removeBtn);
    } else {
      const emptyLabel = document.createElement('span');
      emptyLabel.className = 'slot-empty-label';
      emptyLabel.textContent = 'Drop chord';
      slot.appendChild(emptyLabel);
    }

    // Click to select slot
    slot.addEventListener('click', () => {
      App.state.selectedSlot = { sectionIndex: sIdx, measureIndex: mIdx };
      if (measure.chord) {
        App.state.selectedChord = measure.chord;
        App.state.selectedVoicingIndex = measure.voicingIndex || 0;
        App.emit('chordSelected', measure.chord);
      }
      App.emit('slotSelected', { sIdx, mIdx, chord: measure.chord });
      highlightSlot(sIdx, mIdx);
    });

    // Drop target
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });

    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const chordName = e.dataTransfer.getData('text/plain');
      if (chordName) {
        measure.chord = chordName;
        measure.voicingIndex = 0;
        render();
        App.emit('songChanged');
        App.emit('chordPlaced', { sIdx, mIdx, chord: chordName });
      }
    });

    return slot;
  }

  function createInsertGap(sIdx, insertAt) {
    const gap = document.createElement('div');
    gap.className = 'insert-gap';

    gap.addEventListener('dragover', (e) => {
      e.preventDefault();
      gap.classList.add('insert-gap-active');
    });

    gap.addEventListener('dragleave', () => {
      gap.classList.remove('insert-gap-active');
    });

    gap.addEventListener('drop', (e) => {
      e.preventDefault();
      gap.classList.remove('insert-gap-active');
      const chordName = e.dataTransfer.getData('text/plain');
      if (chordName) {
        const section = App.state.sections[sIdx];
        section.measures.splice(insertAt, 0, { chord: chordName, voicingIndex: 0 });
        render();
        App.emit('songChanged');
        App.emit('chordPlaced', { sIdx, mIdx: insertAt, chord: chordName });
      }
    });

    return gap;
  }

  function highlightSlot(sIdx, mIdx) {
    document.querySelectorAll('.measure-slot').forEach(s => s.style.outline = '');
    const slots = container().querySelectorAll('.measure-slot');
    slots.forEach(s => {
      if (parseInt(s.dataset.sectionIndex) === sIdx && parseInt(s.dataset.measureIndex) === mIdx) {
        s.style.outline = '2px solid var(--accent)';
      }
    });
  }

  function setupDragFromPalette() {
    // Palette chords get drag setup in the palette render (controls.js)
    // This just ensures timeline slots accept drops — already handled above
  }

  function addSection() {
    App.state.sections.push({
      name: 'Section ' + (App.state.sections.length + 1),
      measures: Array.from({ length: 4 }, () => ({ chord: null, voicingIndex: 0 })),
      dynamics: 'mf',
      strumPattern: 'down-up',
    });
    render();
    App.emit('songChanged');
  }

  // Highlight currently playing measure
  function setPlayingMeasure(sIdx, mIdx) {
    document.querySelectorAll('.measure-slot').forEach(s => s.classList.remove('playing'));
    if (sIdx < 0) return;
    const slots = container().querySelectorAll('.measure-slot');
    slots.forEach(s => {
      if (parseInt(s.dataset.sectionIndex) === sIdx && parseInt(s.dataset.measureIndex) === mIdx) {
        s.classList.add('playing');
      }
    });
  }

  return { init, render, setPlayingMeasure };
})();
