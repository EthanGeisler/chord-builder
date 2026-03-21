// === Chord Builder — Chord Creator Modal ===

const ChordCreator = (() => {
  // Current fretboard state: 6 fret values (index 0=low E, -1=muted, 0=open)
  let positions = [-1, -1, -1, -1, -1, -1];
  let overlayEl = null;

  // Target chord context (set when opened via double-click from timeline)
  let targetSectionIdx = null;
  let targetChordIdx = null;

  // Open for a specific chord in a section
  function openForChord(sIdx, cIdx) {
    targetSectionIdx = sIdx;
    targetChordIdx = cIdx;

    const section = App.state.sections[sIdx];
    const chordEntry = section?.chords[cIdx];
    if (!chordEntry || !chordEntry.chord) return;

    open();

    // Pre-load the chord's current voicing positions into the fretboard
    const voicings = ChordsDB.getVoicings(chordEntry.chord, App.state.capo);
    const voicing = voicings && voicings[chordEntry.voicingIndex || 0] || (voicings && voicings[0]);
    if (voicing && voicing.positions) {
      positions = voicing.positions.slice();
      renderFretboard();
      updateDetection();
      updatePreview();
    }

    // Update modal title and save button for chord context
    const h3 = overlayEl && overlayEl.querySelector('h3');
    if (h3) {
      h3.textContent = `Edit Chord — ${chordEntry.chord} (${section.name})`;
    }
    const saveBtn = document.getElementById('creator-save-btn');
    if (saveBtn) saveBtn.textContent = 'Apply to Chord';

    // Build chord palette selector
    buildChordSelector(chordEntry);
  }

  function buildChordSelector(chordEntry) {
    const container = document.getElementById('creator-chord-select');
    if (!container) return;
    container.style.display = '';
    container.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'chord-select-label';
    label.textContent = 'Change chord:';
    container.appendChild(label);

    const diatonic = Theory.getDiatonicChords(App.state.key, App.state.mode);
    const paletteWrap = document.createElement('div');
    paletteWrap.className = 'chord-select-palette';

    // Group by scale degree
    diatonic.forEach(deg => {
      const group = document.createElement('div');
      group.className = 'chord-select-group';

      const groupHeader = document.createElement('button');
      groupHeader.className = 'chord-select-group-toggle';
      groupHeader.textContent = deg.root;
      groupHeader.addEventListener('click', () => {
        group.classList.toggle('expanded');
      });
      group.appendChild(groupHeader);

      const variants = document.createElement('div');
      variants.className = 'chord-select-variants';

      deg.variants.forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'chord-select-btn' + (v === chordEntry.chord ? ' active' : '');
        btn.textContent = v;
        btn.addEventListener('click', () => {
          // Update the chord entry
          chordEntry.chord = v;
          chordEntry.voicingIndex = 0;

          // Load new voicing into fretboard
          const voicings = ChordsDB.getVoicings(v, App.state.capo);
          const voicing = voicings && voicings[0];
          if (voicing && voicing.positions) {
            positions = voicing.positions.slice();
            renderFretboard();
            updateDetection();
            updatePreview();
          }

          // Update active state
          container.querySelectorAll('.chord-select-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // Update title
          const section = App.state.sections[targetSectionIdx];
          const h3 = overlayEl && overlayEl.querySelector('h3');
          if (h3 && section) h3.textContent = `Edit Chord — ${v} (${section.name})`;

          App.emit('songChanged');
          Timeline.render();
        });
        variants.appendChild(btn);
      });

      group.appendChild(variants);
      paletteWrap.appendChild(group);
    });

    container.appendChild(paletteWrap);
  }

  function open() {
    if (overlayEl) return; // already open

    positions = [-1, -1, -1, -1, -1, -1];

    // Build modal
    overlayEl = document.createElement('div');
    overlayEl.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal chord-creator-modal';

    modal.innerHTML = `
      <h3>Create Custom Chord</h3>
      <div class="creator-chord-select" id="creator-chord-select" style="display:none;"></div>
      <div class="creator-detected" id="creator-detected">Detected: <span>—</span></div>
      <div class="creator-body">
        <div class="creator-fretboard-wrapper">
          <div class="fretboard-grid" id="creator-fretboard"></div>
        </div>
        <div class="creator-preview" id="creator-preview"></div>
      </div>
      <div class="creator-label-row">
        <label for="creator-label-input">Label</label>
        <input type="text" id="creator-label-input" placeholder="Optional display name">
      </div>
      <div class="modal-actions">
        <button id="creator-clear-btn">Clear</button>
        <div style="flex:1"></div>
        <button id="creator-cancel-btn">Cancel</button>
        <button id="creator-save-btn" class="btn-primary">Save to Palette</button>
      </div>
    `;

    overlayEl.appendChild(modal);
    document.body.appendChild(overlayEl);

    // Close on overlay click (not modal)
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });

    // Buttons
    document.getElementById('creator-cancel-btn').addEventListener('click', close);
    document.getElementById('creator-clear-btn').addEventListener('click', () => {
      positions = [-1, -1, -1, -1, -1, -1];
      renderFretboard();
      updateDetection();
      updatePreview();
    });
    document.getElementById('creator-save-btn').addEventListener('click', handleSave);

    renderFretboard();
    updateDetection();
    updatePreview();
  }

  // String labels from low E (index 0) to high e (index 5)
  const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

  function renderFretboard() {
    const container = document.getElementById('creator-fretboard');
    if (!container) return;
    container.innerHTML = '';

    // Build table: 6 rows (strings, top=high e, bottom=low E) × 17 cols (label + frets 0-15)
    const table = document.createElement('table');
    table.className = 'fretboard-table';

    // Header row with fret numbers
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th></th>'; // empty corner
    for (let f = 0; f <= 15; f++) {
      const th = document.createElement('th');
      th.textContent = f === 0 ? '0' : f;
      th.className = f === 0 ? 'fretboard-nut-header' : '';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Render strings from high e (index 5) at top to low E (index 0) at bottom
    for (let row = 0; row < 6; row++) {
      const stringIdx = 5 - row; // index into positions array
      const tr = document.createElement('tr');

      // String label
      const labelTd = document.createElement('td');
      labelTd.className = 'fretboard-string-label';
      labelTd.textContent = STRING_LABELS[stringIdx];
      tr.appendChild(labelTd);

      // Status indicator (X or O) shown in the state
      const currentFret = positions[stringIdx];

      for (let fret = 0; fret <= 15; fret++) {
        const td = document.createElement('td');
        td.className = 'fret-cell';
        if (fret === 0) td.classList.add('fretboard-nut');

        if (currentFret === fret) {
          if (fret === 0) {
            td.classList.add('open');
            td.textContent = 'O';
          } else {
            td.classList.add('fretted');
          }
        } else if (currentFret === -1 && fret === 0) {
          td.classList.add('muted');
          td.textContent = 'X';
        }

        // Click handler
        td.addEventListener('click', () => {
          if (positions[stringIdx] === fret) {
            // Clicking already-selected cell clears it (set to muted)
            positions[stringIdx] = -1;
          } else {
            positions[stringIdx] = fret;
          }
          renderFretboard();
          updateDetection();
          updatePreview();
        });

        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function updateDetection() {
    const el = document.getElementById('creator-detected');
    if (!el) return;

    const candidates = Theory.detectChordFromPositions(positions, App.state.capo);
    const span = el.querySelector('span');

    if (candidates.length > 0) {
      span.textContent = candidates[0];
      span.className = '';
    } else {
      // Check if any strings are fretted
      const hasFrets = positions.some(f => f >= 0);
      span.textContent = hasFrets ? 'Unknown — name it below' : '—';
      span.className = hasFrets ? 'unknown' : '';
    }
  }

  function updatePreview() {
    const container = document.getElementById('creator-preview');
    if (!container) return;

    const hasFrets = positions.some(f => f >= 0);
    if (!hasFrets) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Place notes on the fretboard</p>';
      return;
    }

    const baseFret = computeBaseFret(positions);
    const tempVoicing = {
      positions: positions.slice(),
      fingers: [0, 0, 0, 0, 0, 0],
      barres: [],
      baseFret: baseFret,
      label: '',
    };

    container.innerHTML = '';
    const diagramDiv = document.createElement('div');
    diagramDiv.style.width = '180px';
    diagramDiv.style.height = '200px';
    container.appendChild(diagramDiv);
    Diagrams.render(diagramDiv, tempVoicing);
  }

  function computeBaseFret(pos) {
    let minFret = Infinity;
    for (const f of pos) {
      if (f > 0 && f < minFret) minFret = f;
    }
    if (minFret === Infinity) return 1;
    // If all frets fit within 5 frets of baseFret, use that
    let maxFret = 0;
    for (const f of pos) {
      if (f > maxFret) maxFret = f;
    }
    // If range fits in 5 frets starting from minFret, use minFret
    if (maxFret - minFret < 5) return minFret;
    return 1;
  }

  function handleSave() {
    const hasFrets = positions.some(f => f >= 0);
    if (!hasFrets) return; // nothing to save

    const candidates = Theory.detectChordFromPositions(positions, App.state.capo);
    const labelInput = document.getElementById('creator-label-input');
    const userLabel = (labelInput && labelInput.value.trim()) || '';

    let chordName;
    if (candidates.length > 0) {
      chordName = candidates[0];
    } else if (userLabel) {
      chordName = 'custom:' + userLabel;
    } else {
      // Prompt user for a name
      const name = prompt('Could not detect chord name. Enter a name:');
      if (!name) return;
      chordName = 'custom:' + name.trim();
    }

    const baseFret = computeBaseFret(positions);
    const id = 'custom-' + Date.now();
    const voicing = {
      positions: positions.slice(),
      fingers: [0, 0, 0, 0, 0, 0],
      barres: [],
      baseFret: baseFret,
      label: userLabel || chordName,
    };

    const entry = { id, name: chordName, label: userLabel || chordName, voicing };

    // Register with ChordsDB
    ChordsDB.registerCustomVoicing(id, chordName, voicing);

    // Add to app state
    App.state.customVoicings.push(entry);

    // If opened for a specific chord, assign the voicing to it
    if (targetSectionIdx !== null && targetChordIdx !== null) {
      const section = App.state.sections[targetSectionIdx];
      const chordEntry = section?.chords[targetChordIdx];
      if (chordEntry) {
        chordEntry.chord = chordName;
        const allVoicings = ChordsDB.getVoicings(chordName, App.state.capo);
        const idx = allVoicings.indexOf(voicing);
        chordEntry.voicingIndex = idx >= 0 ? idx : allVoicings.length - 1;
      }
    }

    // Emit events
    App.emit('customVoicingAdded', entry);
    App.emit('songChanged');

    close();

    // Re-render timeline
    if (typeof Timeline !== 'undefined') Timeline.render();
  }

  function close() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    // Reset target context
    targetSectionIdx = null;
    targetChordIdx = null;
  }

  return { open, openForChord, close };
})();
