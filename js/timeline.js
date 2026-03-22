// === Chord Builder — Song Timeline with Chord Row + Inline Step Grid ===

const Timeline = (() => {
  let COL_WIDTH_PX = 28;
  const COL_WIDTH_DEFAULT = 28;
  const ZOOM_MIN = 10;
  const ZOOM_MAX = 60;
  const ZOOM_STEP = 4;

  // Default row heights (match CSS :root)
  const ROW_H_DEFAULT = 22;
  const CHORD_ROW_H_DEFAULT = 52;
  const CHORD_BLOCK_H_DEFAULT = 48;
  const BEAT_ROW_H_DEFAULT = 18;
  const container = () => document.getElementById('timeline-sections');

  // Smooth scroll state
  let _scrollTarget = 0;
  let _scrollWrapper = null;
  let _scrollRAF = null;

  function _startScrollLerp() {
    function tick() {
      if (!_scrollWrapper) { _scrollRAF = null; return; }
      const current = _scrollWrapper.scrollLeft;
      const diff = _scrollTarget - current;
      if (Math.abs(diff) < 0.5) {
        _scrollWrapper.scrollLeft = _scrollTarget;
        _scrollRAF = null;
        return;
      }
      _scrollWrapper.scrollLeft = current + diff * 0.15;
      _scrollRAF = requestAnimationFrame(tick);
    }
    _scrollRAF = requestAnimationFrame(tick);
  }

  function _stopScrollLerp() {
    if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
    _scrollWrapper = null;
  }

  // Resize/drag state
  let resizeState = null;
  let dragState = null;

  // Section width drag state
  let sectionResizeState = null;

  // Clipboard for chord copy/paste
  let clipboard = null; // { chord, voicingIndex, durationBeats, gridData: {"rowId:colOffset": vel} }

  // Clipboard for section copy/paste
  let sectionClipboard = null; // deep-cloned section object
  let selectedSectionIdx = -1; // currently selected section index

  // Multi-select state for grid cells
  let selectState = {
    sIdx: -1,
    cells: new Set(),       // selected "rowId:col" keys
    active: false,          // currently dragging a marquee
    anchorRow: null,         // row index in GRID_ROWS
    anchorCol: null,         // column number
    currentRow: null,
    currentCol: null,
    moved: false,
  };

  function init() {
    render();
    setupGlobalListeners();

    document.getElementById('btn-add-section').addEventListener('click', addSection);

    // Right-click on empty timeline space (sections container or parent panel)
    document.getElementById('timeline-sections').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.timeline-section')) return;
      e.preventDefault();
      showEmptyTimelineContextMenu(e.clientX, e.clientY);
    });
    document.getElementById('song-timeline').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.timeline-section') || e.target.closest('.context-menu')) return;
      if (e.target.closest('#timeline-sections') && e.target !== document.getElementById('timeline-sections')) return;
      e.preventDefault();
      showEmptyTimelineContextMenu(e.clientX, e.clientY);
    });

    // Zoom buttons
    document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(COL_WIDTH_PX + ZOOM_STEP));
    document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(COL_WIDTH_PX - ZOOM_STEP));
    applyZoom();

    // Ctrl+scroll to zoom
    document.getElementById('song-timeline').addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(COL_WIDTH_PX + delta);
    }, { passive: false });

    App.on('stateLoaded', render);
    App.on('keyModeChanged', render);
    App.on('timeSignatureChanged', render);
  }

  function setZoom(newWidth) {
    COL_WIDTH_PX = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newWidth));
    applyZoom();
    render();
  }

  function applyZoom() {
    const scale = COL_WIDTH_PX / COL_WIDTH_DEFAULT;
    const root = document.documentElement;
    root.style.setProperty('--row-h', Math.round(ROW_H_DEFAULT * scale) + 'px');
    root.style.setProperty('--chord-row-h', Math.round(CHORD_ROW_H_DEFAULT * scale) + 'px');
    root.style.setProperty('--chord-block-h', Math.round(CHORD_BLOCK_H_DEFAULT * scale) + 'px');
    root.style.setProperty('--beat-row-h', Math.round(BEAT_ROW_H_DEFAULT * scale) + 'px');

    const el = document.getElementById('zoom-level');
    if (el) el.textContent = Math.round(scale * 100) + '%';
  }

  function setupGlobalListeners() {
    // Global mousemove/mouseup for chord resize and drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Grid marquee select: mousemove
    document.addEventListener('mousemove', (e) => {
      if (!selectState.active) return;
      const cellEl = e.target.closest('.step-grid-cell');
      if (!cellEl) return;
      const rowIdx = parseInt(cellEl.dataset.rowIdx, 10);
      const col = parseInt(cellEl.dataset.col, 10);
      const cellSIdx = parseInt(cellEl.dataset.sIdx, 10);
      if (cellSIdx !== selectState.sIdx) return;
      if (rowIdx !== selectState.currentRow || col !== selectState.currentCol) {
        selectState.moved = true;
        selectState.currentRow = rowIdx;
        selectState.currentCol = col;
        updateMarqueeVisual(selectState.sIdx, App.state.sections[selectState.sIdx]);
      }
    });

    // Grid marquee select: mouseup
    document.addEventListener('mouseup', (e) => {
      if (!selectState.active) return;
      selectState.active = false;
      if (!selectState.moved) {
        // It was a single click — do toggle behavior
        const section = App.state.sections[selectState.sIdx];
        const rows = Tablature.GRID_ROWS;
        const row = rows[selectState.anchorRow];
        const col = selectState.anchorCol;
        const key = row.id + ':' + col;

        // Strum row: toggle all 6 string rows for this column
        if (row.id === 'alt-bass') {
          const stringRows = rows.filter(r => r.type === 'string');
          const anyActive = stringRows.some(r => section.gridState[r.id + ':' + col]);
          const vel = (col % section.subdivisions === 0) ? 1.0 : 0.7;
          stringRows.forEach(r => {
            const k = r.id + ':' + col;
            if (anyActive) {
              delete section.gridState[k];
            } else {
              section.gridState[k] = vel;
            }
          });
          clearSelection();
          render();
          App.emit('songChanged');
          return;
        }

        if (e.shiftKey && section.gridState[key]) {
          const v = section.gridState[key];
          if (v >= 0.9) section.gridState[key] = 0.7;
          else if (v >= 0.6) section.gridState[key] = 0.5;
          else section.gridState[key] = 1.0;
        } else if (section.gridState[key]) {
          delete section.gridState[key];
        } else {
          section.gridState[key] = (col % section.subdivisions === 0) ? 1.0 : 0.7;
        }
        clearSelection();
        render();
        App.emit('songChanged');
        return;
      }
      // Finalize marquee: collect active cells in rectangle
      finalizeMarqueeSelection();
      // Remove marquee visual, apply selected class
      document.querySelectorAll('.step-in-marquee').forEach(c => c.classList.remove('step-in-marquee'));
      render();
    });

    // Keyboard: Delete and arrow keys for selection
    document.addEventListener('keydown', handleSelectionKeydown);
    document.addEventListener('keydown', handleCopyPasteKeydown);

    // Close context menus on click + deselect section if clicking outside
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.context-menu').forEach(m => m.remove());
      if (!e.target.closest('.timeline-section') && !e.target.closest('.context-menu')) {
        selectedSectionIdx = -1;
        document.querySelectorAll('.timeline-section').forEach(s => s.classList.remove('section-selected'));
        hideSectionTheory();
      }
    });
  }

  function render() {
    const el = container();
    el.innerHTML = '';

    App.state.sections.forEach((section, sIdx) => {
      el.appendChild(createSectionElement(section, sIdx));
    });
  }

  // =============================================
  // Section element
  // =============================================
  function createSectionElement(section, sIdx) {
    const div = document.createElement('div');
    div.className = 'timeline-section';
    div.dataset.sectionIndex = sIdx;

    // Grid width for inner elements (scroll-inner gets explicit width, section itself flexes)
    const totalCols = section.totalBeats * section.subdivisions;
    const gridWidth = totalCols * COL_WIDTH_PX;
    div.style.minWidth = 'min(' + (gridWidth + 44 + 4) + 'px, 100%)';

    div.appendChild(createSectionHeader(section, sIdx));
    div.appendChild(createSectionBody(section, sIdx));

    // Drag-to-reorder via dragover/drop on the section itself
    div.setAttribute('draggable', 'false'); // header handles drag
    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = div.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      div.classList.remove('drag-over-left', 'drag-over-right');
      div.classList.add(e.clientX < midX ? 'drag-over-left' : 'drag-over-right');
    });
    div.addEventListener('dragleave', () => {
      div.classList.remove('drag-over-left', 'drag-over-right');
    });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      div.classList.remove('drag-over-left', 'drag-over-right');
      const fromIdx = parseInt(e.dataTransfer.getData('text/section-index'), 10);
      if (isNaN(fromIdx) || fromIdx === sIdx) return;

      const rect = div.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const dropBefore = e.clientX < midX;

      const sections = App.state.sections;
      const [moved] = sections.splice(fromIdx, 1);
      let toIdx = sIdx;
      if (fromIdx < sIdx) toIdx--;
      if (!dropBefore) toIdx++;
      sections.splice(toIdx, 0, moved);
      render();
      App.emit('songChanged');
    });

    return div;
  }

  // =============================================
  // Section header
  // =============================================
  function createSectionHeader(section, sIdx) {
    const header = document.createElement('div');
    header.className = 'section-header';

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'section-name';
    nameInput.value = section.name;
    nameInput.addEventListener('change', () => {
      section.name = nameInput.value;
      App.emit('songChanged');
    });

    // Prevent name input from triggering drag
    nameInput.setAttribute('draggable', 'false');
    nameInput.addEventListener('mousedown', (e) => e.stopPropagation());

    // Drag handle for section reorder
    header.setAttribute('draggable', 'true');
    header.style.cursor = 'grab';
    header.addEventListener('dragstart', (e) => {
      if (e.target === nameInput) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/section-index', String(sIdx));
      e.dataTransfer.effectAllowed = 'move';
      header.style.cursor = 'grabbing';
      // Dim the section while dragging
      setTimeout(() => {
        header.closest('.timeline-section').style.opacity = '0.4';
      }, 0);
    });
    header.addEventListener('dragend', () => {
      header.style.cursor = 'grab';
      document.querySelectorAll('.timeline-section').forEach(s => {
        s.style.opacity = '';
        s.classList.remove('drag-over-left', 'drag-over-right');
      });
    });

    // Repeat control
    const repeatWrap = document.createElement('div');
    repeatWrap.className = 'section-repeat-control';
    const repeatLabel = document.createElement('span');
    repeatLabel.textContent = '×';
    repeatLabel.className = 'repeat-label';
    const repeatInput = document.createElement('input');
    repeatInput.type = 'number';
    repeatInput.className = 'repeat-input';
    repeatInput.min = 1;
    repeatInput.max = 99;
    repeatInput.value = section.repeat || 1;
    repeatInput.title = 'Number of times to repeat this section';
    repeatInput.setAttribute('draggable', 'false');
    repeatInput.addEventListener('mousedown', (e) => e.stopPropagation());
    repeatInput.addEventListener('change', () => {
      const val = parseInt(repeatInput.value, 10);
      section.repeat = Math.max(1, isNaN(val) ? 1 : val);
      repeatInput.value = section.repeat;
      App.emit('songChanged');
    });
    repeatWrap.append(repeatLabel, repeatInput);

    // Click to select section (for keyboard copy/paste + theory panel)
    header.addEventListener('click', (e) => {
      if (e.target === nameInput) return;
      selectedSectionIdx = sIdx;
      document.querySelectorAll('.timeline-section').forEach(s => s.classList.remove('section-selected'));
      header.closest('.timeline-section').classList.add('section-selected');
      renderSectionTheory(section);
    });

    // Right-click context menu on section
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSectionContextMenu(e.clientX, e.clientY, sIdx);
    });

    header.append(nameInput, repeatWrap);
    return header;
  }

  // =============================================
  // Section body: chord row + step grid
  // =============================================
  function createSectionBody(section, sIdx) {
    const totalCols = section.totalBeats * section.subdivisions;
    const gridWidth = totalCols * COL_WIDTH_PX;

    const wrapper = document.createElement('div');
    wrapper.className = 'section-scroll-wrapper';

    const inner = document.createElement('div');
    inner.className = 'section-scroll-inner';
    inner.style.minWidth = '100%';

    // Row labels (fixed on left)
    const labelsDiv = document.createElement('div');
    labelsDiv.className = 'grid-row-labels';
    // Empty label for chord row
    const chordLabel = document.createElement('div');
    chordLabel.className = 'grid-label chord-row-label';
    chordLabel.textContent = 'Chords';
    labelsDiv.appendChild(chordLabel);
    // Empty label for beat header
    const beatLabel = document.createElement('div');
    beatLabel.className = 'grid-label beat-header-label';
    labelsDiv.appendChild(beatLabel);
    // String row labels
    Tablature.GRID_ROWS.forEach(row => {
      const label = document.createElement('div');
      label.className = 'grid-label' + (row.type === 'special' ? ' grid-label-special' : '');
      label.textContent = row.label;
      labelsDiv.appendChild(label);
    });

    // Scrollable area
    const scrollArea = document.createElement('div');
    scrollArea.className = 'section-scroll-area';

    // === Chord row ===
    const chordRow = document.createElement('div');
    chordRow.className = 'chord-row';
    chordRow.style.width = gridWidth + 'px';
    chordRow.style.height = '52px';

    // Render chord blocks
    section.chords.forEach((chord, cIdx) => {
      chordRow.appendChild(createChordBlock(chord, section, sIdx, cIdx));
    });

    // Drop target for chord row
    chordRow.addEventListener('dragover', (e) => {
      e.preventDefault();
      chordRow.classList.add('chord-row-dragover');
    });
    chordRow.addEventListener('dragleave', () => {
      chordRow.classList.remove('chord-row-dragover');
    });
    chordRow.addEventListener('drop', (e) => {
      e.preventDefault();
      chordRow.classList.remove('chord-row-dragover');
      const chordName = e.dataTransfer.getData('text/plain');
      if (!chordName) return;

      // Calculate startBeat from drop position
      const rect = chordRow.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollArea.scrollLeft;
      const col = Math.floor(x / COL_WIDTH_PX);
      const startBeat = Math.floor(col / section.subdivisions);
      const bpm = App.getBeatsPerMeasure();
      const durationBeats = Math.min(1, section.totalBeats - startBeat);

      if (durationBeats <= 0) return;

      // Check overlap
      if (hasOverlap(section.chords, startBeat, durationBeats, -1)) return;

      section.chords.push({
        chord: chordName,
        voicingIndex: 0,
        startBeat,
        durationBeats,
      });
      // Sort by startBeat
      section.chords.sort((a, b) => a.startBeat - b.startBeat);
      render();
      App.emit('songChanged');
      App.emit('chordPlaced', { sIdx, chord: chordName });
    });

    // Right-click empty chord row space for paste
    chordRow.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.chord-block')) return;
      e.preventDefault();
      const rect = chordRow.getBoundingClientRect();
      const x = e.clientX - rect.left + (scrollArea ? scrollArea.scrollLeft : 0);
      const col = Math.floor(x / COL_WIDTH_PX);
      const startBeat = Math.floor(col / section.subdivisions);
      showChordRowContextMenu(e.clientX, e.clientY, sIdx, startBeat);
    });

    scrollArea.appendChild(chordRow);

    // === Beat header row ===
    const beatHeader = document.createElement('div');
    beatHeader.className = 'beat-header-row';
    beatHeader.style.width = gridWidth + 'px';

    for (let col = 0; col < totalCols; col++) {
      const cell = document.createElement('div');
      cell.className = 'beat-header-cell';
      cell.style.width = COL_WIDTH_PX + 'px';
      const beatsPerMeasure = App.getBeatsPerMeasure();
      const stepsPerMeasure = beatsPerMeasure * section.subdivisions;
      const colInMeasure = col % stepsPerMeasure;
      const label = Tablature.getBeatLabel(colInMeasure, stepsPerMeasure, App.state.timeSignature);
      cell.textContent = label;

      const stepsPerBeat = section.subdivisions;
      if (col % stepsPerBeat === 0) cell.classList.add('beat-downbeat');

      // Chord boundary accent
      if (isChordBoundary(section, col)) cell.classList.add('beat-chord-boundary');

      beatHeader.appendChild(cell);
    }
    scrollArea.appendChild(beatHeader);

    // === Step grid ===
    const gridEl = document.createElement('div');
    gridEl.className = 'step-grid';
    gridEl.style.width = gridWidth + 'px';

    Tablature.GRID_ROWS.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'step-grid-row' + (row.type === 'special' ? ' step-grid-special-row' : '');

      for (let col = 0; col < totalCols; col++) {
        const cell = document.createElement('div');
        cell.className = 'step-grid-cell';
        cell.style.width = COL_WIDTH_PX + 'px';
        cell.dataset.rowIdx = rowIdx;
        cell.dataset.col = col;
        cell.dataset.rowId = row.id;
        cell.dataset.sIdx = sIdx;

        const stepsPerBeat = section.subdivisions;
        if (col % stepsPerBeat === 0) cell.classList.add('step-downbeat-col');
        if (isChordBoundary(section, col)) cell.classList.add('step-chord-boundary');

        const key = row.id + ':' + col;
        const vel = section.gridState[key];

        if (vel) {
          cell.classList.add('step-active');
          if (vel >= 0.9) cell.classList.add('vel-high');
          else if (vel >= 0.6) cell.classList.add('vel-med');
          else cell.classList.add('vel-low');
        }

        // Show selection highlight
        if (selectState.sIdx === sIdx && selectState.cells.has(key)) {
          cell.classList.add('step-selected');
        }

        // Mousedown: start marquee select
        cell.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          selectState = {
            sIdx, cells: new Set(), active: true,
            anchorRow: rowIdx, anchorCol: col,
            currentRow: rowIdx, currentCol: col,
            moved: false,
          };
          updateMarqueeVisual(sIdx, section);
        });

        // Right-click: remove
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (section.gridState[key]) {
            delete section.gridState[key];
            clearSelection();
            render();
            App.emit('songChanged');
          }
        });

        rowEl.appendChild(cell);
      }

      gridEl.appendChild(rowEl);
    });
    scrollArea.appendChild(gridEl);

    // Playhead lines — smooth (continuous) + step (per-column)
    const playheadSmooth = document.createElement('div');
    playheadSmooth.className = 'playhead-line playhead-smooth';
    playheadSmooth.style.display = 'none';
    playheadSmooth.dataset.sectionIndex = sIdx;
    scrollArea.appendChild(playheadSmooth);

    const playhead = document.createElement('div');
    playhead.className = 'playhead-line playhead-step';
    playhead.style.display = 'none';
    playhead.dataset.sectionIndex = sIdx;
    scrollArea.appendChild(playhead);

    // Endpoint handle — visually distinct draggable bar at grid boundary
    const sectionHandle = document.createElement('div');
    sectionHandle.className = 'section-endpoint-handle';
    sectionHandle.style.left = gridWidth + 'px';
    sectionHandle.title = 'Drag to resize section';
    sectionHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sectionResizeState = {
        sIdx,
        section,
        startX: e.clientX,
        origTotalBeats: section.totalBeats,
        scrollArea,
      };
      sectionHandle.classList.add('dragging');
    });
    scrollArea.appendChild(sectionHandle);

    inner.appendChild(labelsDiv);
    inner.appendChild(scrollArea);
    wrapper.appendChild(inner);
    return wrapper;
  }

  // =============================================
  // Chord block
  // =============================================
  function createChordBlock(chord, section, sIdx, cIdx) {
    const block = document.createElement('div');
    block.className = 'chord-block';
    block.style.left = (chord.startBeat * section.subdivisions * COL_WIDTH_PX) + 'px';
    block.style.width = (chord.durationBeats * section.subdivisions * COL_WIDTH_PX) + 'px';

    // Chord name
    const nameEl = document.createElement('div');
    nameEl.className = 'chord-block-name';
    nameEl.textContent = chord.chord;
    block.appendChild(nameEl);

    // Mini diagram container
    const diagramEl = document.createElement('div');
    diagramEl.className = 'chord-block-diagram';
    block.appendChild(diagramEl);

    // Render diagram after DOM insertion
    requestAnimationFrame(() => {
      const voicings = ChordsDB.getVoicings(chord.chord, App.state.capo);
      const voicing = voicings && voicings[chord.voicingIndex || 0] || (voicings && voicings[0]);
      if (voicing) {
        Diagrams.renderMini(diagramEl, voicing);
      }
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'chord-block-remove';
    removeBtn.textContent = '\u2715';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      section.chords.splice(cIdx, 1);
      render();
      App.emit('songChanged');
    });
    block.appendChild(removeBtn);

    // Left resize handle
    const leftHandle = document.createElement('div');
    leftHandle.className = 'chord-block-resize resize-left';
    leftHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearSelection();
      resizeState = {
        side: 'left',
        sIdx, cIdx, startX: e.clientX,
        origStartBeat: chord.startBeat,
        origDurationBeats: chord.durationBeats,
        section, chord,
      };
    });
    block.appendChild(leftHandle);

    // Right resize handle
    const rightHandle = document.createElement('div');
    rightHandle.className = 'chord-block-resize resize-right';
    rightHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearSelection();
      resizeState = {
        side: 'right',
        sIdx, cIdx, startX: e.clientX,
        origStartBeat: chord.startBeat,
        origDurationBeats: chord.durationBeats,
        section, chord,
      };
    });
    block.appendChild(rightHandle);

    // Drag to move (mousedown on the block body)
    block.addEventListener('mousedown', (e) => {
      if (e.target === removeBtn || e.target === leftHandle || e.target === rightHandle) return;
      if (e.button !== 0) return;
      e.preventDefault();
      clearSelection();
      dragState = {
        sIdx, cIdx, startX: e.clientX,
        origStartBeat: chord.startBeat,
        section, chord,
        moved: false,
      };
      block.classList.add('dragging');
    });

    // Click to select chord (only if not dragged)
    block.addEventListener('click', (e) => {
      if (e.target === removeBtn || e.target === leftHandle || e.target === rightHandle) return;
      if (dragState && dragState.moved) return;
      App.state.selectedSlot = { sectionIndex: sIdx, chordIndex: cIdx };
      App.state.selectedChord = chord.chord;
      App.state.selectedVoicingIndex = chord.voicingIndex || 0;
      App.emit('chordSelected', chord.chord);
      App.emit('slotSelected', { sIdx, cIdx, chord: chord.chord });
      highlightChordBlock(sIdx, cIdx);
    });

    // Double-click to edit chord in creator
    block.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (typeof ChordCreator !== 'undefined') {
        ChordCreator.openForChord(sIdx, cIdx);
      }
    });

    // Right-click for stamp context menu
    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showStampMenu(e.clientX, e.clientY, sIdx, cIdx);
    });

    return block;
  }

  // =============================================
  // Unified mouse move/up for resize + drag
  // =============================================
  function handleMouseMove(e) {
    if (resizeState) handleResizeMove(e);
    if (dragState) handleDragMove(e);
    if (sectionResizeState) handleSectionResizeMove(e);
  }

  function handleMouseUp(e) {
    if (resizeState) {
      resizeState = null;
      render();
      App.emit('songChanged');
    }
    if (dragState) {
      const wasMoved = dragState.moved;
      const ds = dragState;
      dragState = null;
      document.querySelectorAll('.chord-block.dragging').forEach(b => b.classList.remove('dragging'));
      if (wasMoved) {
        // Re-sort chords by startBeat
        ds.section.chords.sort((a, b) => a.startBeat - b.startBeat);
        render();
        App.emit('songChanged');
      }
    }
    if (sectionResizeState) {
      document.querySelectorAll('.section-endpoint-handle.dragging').forEach(h => h.classList.remove('dragging'));
      sectionResizeState = null;
      render();
      App.emit('songChanged');
    }
  }

  function handleSectionResizeMove(e) {
    const { section, startX, origTotalBeats, scrollArea } = sectionResizeState;
    const dx = e.clientX - startX;
    const colDelta = Math.round(dx / COL_WIDTH_PX);
    const beatDelta = colDelta / section.subdivisions;
    const bpm = App.getBeatsPerMeasure();

    // Snap to whole beats, minimum 1 measure
    let newBeats = origTotalBeats + beatDelta;
    newBeats = Math.round(newBeats);
    newBeats = Math.max(bpm, newBeats);

    if (newBeats !== section.totalBeats) {
      section.totalBeats = newBeats;

      // Clamp/remove chords that now exceed the section
      section.chords = section.chords.filter(c => c.startBeat < newBeats);
      section.chords.forEach(c => {
        if (c.startBeat + c.durationBeats > newBeats) {
          c.durationBeats = newBeats - c.startBeat;
        }
      });

      // Prune grid cells beyond new boundary
      const maxCol = newBeats * section.subdivisions;
      for (const key of Object.keys(section.gridState)) {
        const col = parseInt(key.split(':')[1], 10);
        if (col >= maxCol) delete section.gridState[key];
      }

      // Full re-render so grid cells match
      render();
    }
  }

  // --- Resize ---
  function handleResizeMove(e) {
    const { side, section, chord, startX, origStartBeat, origDurationBeats, cIdx } = resizeState;
    const dx = e.clientX - startX;
    const colDelta = Math.round(dx / COL_WIDTH_PX);
    const beatDelta = colDelta / section.subdivisions;

    if (side === 'right') {
      const minDuration = 1 / section.subdivisions;
      let newDuration = Math.max(minDuration, origDurationBeats + beatDelta);
      newDuration = Math.round(newDuration * section.subdivisions) / section.subdivisions;
      newDuration = Math.min(newDuration, section.totalBeats - chord.startBeat);
      // Don't overlap next chord
      const nextChord = section.chords[cIdx + 1];
      if (nextChord) newDuration = Math.min(newDuration, nextChord.startBeat - chord.startBeat);
      chord.durationBeats = Math.max(minDuration, newDuration);
    } else {
      // Left resize: move startBeat and adjust duration inversely
      let newStart = origStartBeat + beatDelta;
      newStart = Math.round(newStart * section.subdivisions) / section.subdivisions;
      // Clamp: can't go before 0
      newStart = Math.max(0, newStart);
      // Clamp: can't go past original end minus 1 beat
      const origEnd = origStartBeat + origDurationBeats;
      newStart = Math.min(newStart, origEnd - 1);
      // Don't overlap previous chord
      const prevChord = section.chords[cIdx - 1];
      if (prevChord) newStart = Math.max(newStart, prevChord.startBeat + prevChord.durationBeats);
      chord.startBeat = newStart;
      chord.durationBeats = origEnd - newStart;
    }

    // Live update block position/width
    updateBlockVisual(chord, section);
  }

  // --- Drag to move ---
  function handleDragMove(e) {
    const { section, chord, startX, origStartBeat, cIdx } = dragState;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 3) dragState.moved = true;
    if (!dragState.moved) return;

    const colDelta = Math.round(dx / COL_WIDTH_PX);
    const beatDelta = colDelta / section.subdivisions;
    let newStart = origStartBeat + beatDelta;
    newStart = Math.round(newStart * section.subdivisions) / section.subdivisions;

    // Clamp to section bounds
    newStart = Math.max(0, newStart);
    newStart = Math.min(newStart, section.totalBeats - chord.durationBeats);

    // Don't overlap neighbors
    const prevChord = section.chords[cIdx - 1];
    if (prevChord) newStart = Math.max(newStart, prevChord.startBeat + prevChord.durationBeats);
    const nextChord = section.chords[cIdx + 1];
    if (nextChord) newStart = Math.min(newStart, nextChord.startBeat - chord.durationBeats);

    chord.startBeat = newStart;
    updateBlockVisual(chord, section);
  }

  function updateBlockVisual(chord, section) {
    const leftPx = chord.startBeat * section.subdivisions * COL_WIDTH_PX;
    const widthPx = chord.durationBeats * section.subdivisions * COL_WIDTH_PX;
    // Find the block by iterating (safer than style-matching)
    const sectionEl = container().querySelectorAll('.timeline-section')[resizeState ? resizeState.sIdx : dragState.sIdx];
    if (!sectionEl) return;
    const blocks = sectionEl.querySelectorAll('.chord-block');
    const idx = resizeState ? resizeState.cIdx : dragState.cIdx;
    if (blocks[idx]) {
      blocks[idx].style.left = leftPx + 'px';
      blocks[idx].style.width = widthPx + 'px';
    }
  }

  // =============================================
  // Grid multi-select helpers
  // =============================================
  function updateMarqueeVisual(sIdx, section) {
    // Clear previous marquee
    document.querySelectorAll('.step-in-marquee').forEach(c => c.classList.remove('step-in-marquee'));
    if (!selectState.active) return;

    const minRow = Math.min(selectState.anchorRow, selectState.currentRow);
    const maxRow = Math.max(selectState.anchorRow, selectState.currentRow);
    const minCol = Math.min(selectState.anchorCol, selectState.currentCol);
    const maxCol = Math.max(selectState.anchorCol, selectState.currentCol);

    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (!sectionEl) return;
    sectionEl.querySelectorAll('.step-grid-cell').forEach(cell => {
      const r = parseInt(cell.dataset.rowIdx, 10);
      const c = parseInt(cell.dataset.col, 10);
      if (r >= minRow && r <= maxRow && c >= minCol && c <= maxCol) {
        cell.classList.add('step-in-marquee');
      }
    });
  }

  function finalizeMarqueeSelection() {
    const section = App.state.sections[selectState.sIdx];
    if (!section) return;
    const rows = Tablature.GRID_ROWS;
    const minRow = Math.min(selectState.anchorRow, selectState.currentRow);
    const maxRow = Math.max(selectState.anchorRow, selectState.currentRow);
    const minCol = Math.min(selectState.anchorCol, selectState.currentCol);
    const maxCol = Math.max(selectState.anchorCol, selectState.currentCol);

    selectState.cells = new Set();
    for (let r = minRow; r <= maxRow; r++) {
      const rowId = rows[r].id;
      for (let c = minCol; c <= maxCol; c++) {
        const key = rowId + ':' + c;
        if (section.gridState[key]) {
          selectState.cells.add(key);
        }
      }
    }
  }

  function clearSelection() {
    selectState = {
      sIdx: -1, cells: new Set(), active: false,
      anchorRow: null, anchorCol: null,
      currentRow: null, currentCol: null, moved: false,
    };
  }

  function handleSelectionKeydown(e) {
    if (selectState.cells.size === 0) return;
    const section = App.state.sections[selectState.sIdx];
    if (!section) return;
    const totalCols = section.totalBeats * section.subdivisions;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      for (const key of selectState.cells) {
        delete section.gridState[key];
      }
      clearSelection();
      render();
      App.emit('songChanged');
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;

      // Check bounds
      for (const key of selectState.cells) {
        const col = parseInt(key.split(':')[1], 10);
        const newCol = col + delta;
        if (newCol < 0 || newCol >= totalCols) return;
      }

      // Check destination doesn't conflict with non-selected active cells
      const newEntries = [];
      for (const key of selectState.cells) {
        const [rowId, colStr] = key.split(':');
        const col = parseInt(colStr, 10);
        const newCol = col + delta;
        const newKey = rowId + ':' + newCol;
        if (!selectState.cells.has(newKey) && section.gridState[newKey]) return; // blocked
        newEntries.push({ oldKey: key, newKey, vel: section.gridState[key] });
      }

      // Remove old, write new
      for (const { oldKey } of newEntries) {
        delete section.gridState[oldKey];
      }
      const newCells = new Set();
      for (const { newKey, vel } of newEntries) {
        section.gridState[newKey] = vel;
        newCells.add(newKey);
      }
      selectState.cells = newCells;
      render();
      App.emit('songChanged');
    }
  }

  // =============================================
  // Chord copy/paste
  // =============================================
  function handleCopyPasteKeydown(e) {
    // Only handle when not in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+C: copy selected section or chord
    if (ctrl && e.key === 'c') {
      // Section copy takes priority if a section is selected
      if (selectedSectionIdx >= 0 && selectedSectionIdx < App.state.sections.length) {
        e.preventDefault();
        copySection(selectedSectionIdx);
        return;
      }
      const slot = App.state.selectedSlot;
      if (!slot) return;
      const section = App.state.sections[slot.sectionIndex];
      if (!section) return;
      const chordEntry = section.chords[slot.chordIndex];
      if (!chordEntry) return;

      e.preventDefault();

      // Copy grid data as column offsets relative to chord start
      const startCol = chordEntry.startBeat * section.subdivisions;
      const numCols = chordEntry.durationBeats * section.subdivisions;
      const gridData = {};
      for (let col = startCol; col < startCol + numCols; col++) {
        for (const row of Tablature.GRID_ROWS) {
          const key = row.id + ':' + col;
          if (section.gridState[key]) {
            const offsetKey = row.id + ':' + (col - startCol);
            gridData[offsetKey] = section.gridState[key];
          }
        }
      }

      clipboard = {
        chord: chordEntry.chord,
        voicingIndex: chordEntry.voicingIndex || 0,
        durationBeats: chordEntry.durationBeats,
        gridData,
      };

      // Flash the block to confirm copy
      const sectionEl = container().querySelectorAll('.timeline-section')[slot.sectionIndex];
      if (sectionEl) {
        const block = sectionEl.querySelectorAll('.chord-block')[slot.chordIndex];
        if (block) {
          block.style.outline = '2px solid var(--success)';
          setTimeout(() => { block.style.outline = ''; }, 300);
        }
      }
      return;
    }

    // Ctrl+V: paste section or chord
    if (ctrl && e.key === 'v') {
      // Section paste if section clipboard has data
      if (sectionClipboard && selectedSectionIdx >= 0) {
        e.preventDefault();
        pasteSection(selectedSectionIdx);
        return;
      }
      if (!clipboard) return;
      e.preventDefault();
      enterPasteMode();
      return;
    }
  }

  let pasteMode = false;
  let pasteHandler = null;

  function enterPasteMode() {
    if (pasteMode) return;
    pasteMode = true;

    // Change cursor on all chord rows
    document.querySelectorAll('.chord-row').forEach(row => {
      row.style.cursor = 'copy';
    });

    // Listen for click on any chord row
    pasteHandler = (e) => {
      const chordRow = e.target.closest('.chord-row');
      if (!chordRow) {
        exitPasteMode();
        return;
      }

      const sectionEl = chordRow.closest('.timeline-section');
      if (!sectionEl) { exitPasteMode(); return; }
      const sIdx = parseInt(sectionEl.dataset.sectionIndex, 10);
      const section = App.state.sections[sIdx];
      if (!section) { exitPasteMode(); return; }

      const scrollArea = chordRow.closest('.section-scroll-area');
      const rect = chordRow.getBoundingClientRect();
      const x = e.clientX - rect.left + (scrollArea ? scrollArea.scrollLeft : 0);
      const col = Math.floor(x / COL_WIDTH_PX);
      const startBeat = Math.floor(col / section.subdivisions);
      const available = maxAvailableDuration(section.chords, startBeat, section.totalBeats - startBeat);
      const durationBeats = Math.min(clipboard.durationBeats, available);

      if (durationBeats <= 0) { exitPasteMode(); return; }

      // Place the chord
      section.chords.push({
        chord: clipboard.chord,
        voicingIndex: clipboard.voicingIndex,
        startBeat,
        durationBeats,
      });
      section.chords.sort((a, b) => a.startBeat - b.startBeat);

      // Paste grid data at new position
      const destStartCol = startBeat * section.subdivisions;
      const destNumCols = durationBeats * section.subdivisions;
      for (const [offsetKey, vel] of Object.entries(clipboard.gridData)) {
        const [rowId, offsetStr] = offsetKey.split(':');
        const offset = parseInt(offsetStr, 10);
        if (offset < destNumCols) {
          section.gridState[rowId + ':' + (destStartCol + offset)] = vel;
        }
      }

      exitPasteMode();
      render();
      App.emit('songChanged');
    };

    document.addEventListener('click', pasteHandler, { once: true });

    // Also allow Escape to cancel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        exitPasteMode();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function exitPasteMode() {
    pasteMode = false;
    document.querySelectorAll('.chord-row').forEach(row => {
      row.style.cursor = '';
    });
    if (pasteHandler) {
      document.removeEventListener('click', pasteHandler);
      pasteHandler = null;
    }
  }

  // =============================================
  // Helpers
  // =============================================
  function maxAvailableDuration(chords, startBeat, maxBeats) {
    let available = maxBeats;
    for (const c of chords) {
      const cEnd = c.startBeat + c.durationBeats;
      // If chord overlaps our start, no space
      if (startBeat >= c.startBeat && startBeat < cEnd) return 0;
      // If chord starts after us, clamp to its start
      if (c.startBeat > startBeat) {
        available = Math.min(available, c.startBeat - startBeat);
      }
    }
    return available;
  }

  function hasOverlap(chords, startBeat, durationBeats, excludeIdx) {
    const end = startBeat + durationBeats;
    return chords.some((c, i) => {
      if (i === excludeIdx) return false;
      const cEnd = c.startBeat + c.durationBeats;
      return startBeat < cEnd && end > c.startBeat;
    });
  }

  function isChordBoundary(section, col) {
    const beat = col / section.subdivisions;
    return section.chords.some(c => c.startBeat === beat || c.startBeat + c.durationBeats === beat);
  }

  function highlightChordBlock(sIdx, cIdx) {
    document.querySelectorAll('.chord-block').forEach(b => b.classList.remove('selected'));
    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (sectionEl) {
      const blocks = sectionEl.querySelectorAll('.chord-block');
      if (blocks[cIdx]) blocks[cIdx].classList.add('selected');
    }
  }

  // =============================================
  // Stamp context menu
  // =============================================
  function showStampMenu(x, y, sIdx, cIdx) {
    // Remove any existing menu
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const section = App.state.sections[sIdx];
    const presets = Tablature.getStampPresetsForTimeSig(App.state.timeSignature);

    // Group by category
    const strumPresets = presets.filter(p => p.category === 'strum');
    const arpPresets = presets.filter(p => p.category === 'arpeggio');

    // --- Copy / Paste buttons (only for single chord, not "Stamp All") ---
    if (cIdx !== null) {
      const copyItem = document.createElement('div');
      copyItem.className = 'context-menu-item';
      copyItem.textContent = 'Copy Chord';
      copyItem.addEventListener('click', (e) => {
        e.stopPropagation();
        // Select the chord first
        const chordEntry = section.chords[cIdx];
        if (!chordEntry) { menu.remove(); return; }
        App.state.selectedSlot = { sectionIndex: sIdx, chordIndex: cIdx };

        // Copy grid data
        const startCol = chordEntry.startBeat * section.subdivisions;
        const numCols = chordEntry.durationBeats * section.subdivisions;
        const gridData = {};
        for (let col = startCol; col < startCol + numCols; col++) {
          for (const row of Tablature.GRID_ROWS) {
            const key = row.id + ':' + col;
            if (section.gridState[key]) {
              gridData[row.id + ':' + (col - startCol)] = section.gridState[key];
            }
          }
        }
        clipboard = {
          chord: chordEntry.chord,
          voicingIndex: chordEntry.voicingIndex || 0,
          durationBeats: chordEntry.durationBeats,
          gridData,
        };
        menu.remove();
      });
      menu.appendChild(copyItem);

      const pasteItem = document.createElement('div');
      pasteItem.className = 'context-menu-item' + (!clipboard ? ' disabled' : '');
      pasteItem.textContent = 'Paste Chord';
      pasteItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!clipboard) return;
        menu.remove();
        enterPasteMode();
      });
      menu.appendChild(pasteItem);

      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
    }

    // --- Collapsible pattern categories ---
    const addCategory = (label, items, startCollapsed) => {
      if (items.length === 0) return;

      const header = document.createElement('div');
      header.className = 'context-menu-header' + (startCollapsed ? ' collapsed' : '');
      header.innerHTML = `<span>${label}</span><span class="submenu-arrow">\u25BC</span>`;

      const submenu = document.createElement('div');
      submenu.className = 'context-menu-submenu' + (startCollapsed ? ' collapsed' : '');

      header.addEventListener('click', (e) => {
        e.stopPropagation();
        header.classList.toggle('collapsed');
        submenu.classList.toggle('collapsed');
      });

      items.forEach(p => {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.textContent = p.name;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (cIdx !== null) {
            const chord = section.chords[cIdx];
            if (chord) {
              const startCol = chord.startBeat * section.subdivisions;
              const numCols = chord.durationBeats * section.subdivisions;
              clearGridRange(section.gridState, startCol, numCols);
              Tablature.stampPresetToGrid(p.key, startCol, numCols, section.subdivisions, section.gridState);
            }
          } else {
            section.chords.forEach(chord => {
              const startCol = chord.startBeat * section.subdivisions;
              const numCols = chord.durationBeats * section.subdivisions;
              clearGridRange(section.gridState, startCol, numCols);
              Tablature.stampPresetToGrid(p.key, startCol, numCols, section.subdivisions, section.gridState);
            });
          }
          menu.remove();
          render();
          App.emit('songChanged');
        });
        submenu.appendChild(item);
      });

      menu.appendChild(header);
      menu.appendChild(submenu);
    };

    addCategory('Strum Patterns', strumPresets, false);
    addCategory('Arpeggio Patterns', arpPresets, true);

    // --- Clear option ---
    const sep2 = document.createElement('div');
    sep2.className = 'context-menu-separator';
    menu.appendChild(sep2);

    const clearItem = document.createElement('div');
    clearItem.className = 'context-menu-item';
    clearItem.style.color = 'var(--accent)';
    clearItem.textContent = 'Clear Grid';
    clearItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cIdx !== null) {
        const chord = section.chords[cIdx];
        if (chord) {
          clearGridRange(section.gridState, chord.startBeat * section.subdivisions, chord.durationBeats * section.subdivisions);
        }
      } else {
        section.gridState = {};
      }
      menu.remove();
      render();
      App.emit('songChanged');
    });
    menu.appendChild(clearItem);

    document.body.appendChild(menu);

    // Adjust if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  function clearGridRange(gridState, startCol, numCols) {
    const endCol = startCol + numCols;
    for (const key of Object.keys(gridState)) {
      const col = parseInt(key.split(':')[1], 10);
      if (col >= startCol && col < endCol) {
        delete gridState[key];
      }
    }
  }

  // =============================================
  // Playhead
  // =============================================
  // Smooth playhead animation state
  let _smoothRAF = null;
  let _smoothStartX = 0;
  let _smoothEndX = 0;
  let _smoothStartTime = 0;
  let _smoothDuration = 0;
  let _smoothPlayhead = null;

  function _animateSmoothPlayhead(timestamp) {
    if (!_smoothPlayhead) { _smoothRAF = null; return; }
    const elapsed = timestamp - _smoothStartTime;
    const t = Math.min(elapsed / _smoothDuration, 1);
    const x = _smoothStartX + (_smoothEndX - _smoothStartX) * t;
    _smoothPlayhead.style.left = x + 'px';
    if (t < 1) {
      _smoothRAF = requestAnimationFrame(_animateSmoothPlayhead);
    } else {
      _smoothRAF = null;
    }
  }

  function _stopSmoothPlayhead() {
    if (_smoothRAF) { cancelAnimationFrame(_smoothRAF); _smoothRAF = null; }
    _smoothPlayhead = null;
  }

  function setPlayingColumn(sIdx, col, colDurationMs) {
    document.querySelectorAll('.playhead-line').forEach(line => {
      line.style.display = 'none';
    });
    if (sIdx < 0) { _stopScrollLerp(); _stopSmoothPlayhead(); return; }
    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (!sectionEl) return;

    const stepHead = sectionEl.querySelector('.playhead-step');
    const smoothHead = sectionEl.querySelector('.playhead-smooth');

    if (stepHead) {
      stepHead.style.display = 'block';
      stepHead.style.left = (col * COL_WIDTH_PX) + 'px';
    }

    // Animate smooth playhead from current col to next col
    if (smoothHead && colDurationMs) {
      smoothHead.style.display = 'block';
      _smoothPlayhead = smoothHead;
      _smoothStartX = col * COL_WIDTH_PX;
      _smoothEndX = (col + 1) * COL_WIDTH_PX;
      _smoothStartTime = performance.now();
      _smoothDuration = colDurationMs;
      if (!_smoothRAF) _smoothRAF = requestAnimationFrame(_animateSmoothPlayhead);
    }

    // Auto-scroll to center playhead horizontally
    const timelinePanel = document.getElementById('song-timeline');
    const scrollWrapper = sectionEl.querySelector('.section-scroll-wrapper');

    // Smooth scroll every bar (4 beats)
    const section = App.state.sections[sIdx];
    const subdivisions = section ? section.subdivisions : 2;
    const colsPerBar = 4 * subdivisions;
    if (col % colsPerBar === 0) {
      if (scrollWrapper) {
        const playheadLeft = col * COL_WIDTH_PX;
        const wrapperWidth = scrollWrapper.clientWidth;
        _scrollTarget = playheadLeft - (wrapperWidth / 2);
        _scrollWrapper = scrollWrapper;
        if (!_scrollRAF) _startScrollLerp();
      }
    }

    // Smoothly keep section vertically visible in the timeline panel
    if (timelinePanel && stepHead) {
      const playheadRect = stepHead.getBoundingClientRect();
      const panelRect = timelinePanel.getBoundingClientRect();
      if (playheadRect.top < panelRect.top || playheadRect.bottom > panelRect.bottom) {
        const target = timelinePanel.scrollTop + playheadRect.top - panelRect.top - (panelRect.height / 2);
        timelinePanel.scrollTo({ top: target, behavior: 'smooth' });
      }
    }
  }

  // =============================================
  // Add section
  // =============================================
  function addSection() {
    App.state.sections.push({
      name: 'Section ' + (App.state.sections.length + 1),
      totalBeats: 16,
      subdivisions: 2,
      chords: [],
      gridState: {},
      dynamics: 'mf',
    });
    render();
    App.emit('songChanged');
  }

  // =============================================
  // Section copy/paste
  // =============================================
  function deepCloneSection(section) {
    return {
      name: section.name,
      totalBeats: section.totalBeats,
      subdivisions: section.subdivisions,
      chords: section.chords.map(c => ({ ...c })),
      gridState: { ...section.gridState },
      dynamics: section.dynamics,
      repeat: section.repeat || 1,
    };
  }

  function copySection(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section) return;
    sectionClipboard = deepCloneSection(section);

    // Flash the section to confirm copy
    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (sectionEl) {
      sectionEl.style.outline = '2px solid var(--success)';
      setTimeout(() => { sectionEl.style.outline = ''; }, 300);
    }
  }

  function pasteSection(afterIdx) {
    if (!sectionClipboard) return;
    const clone = deepCloneSection(sectionClipboard);
    clone.name = clone.name + ' (copy)';
    const insertIdx = afterIdx + 1;
    App.state.sections.splice(insertIdx, 0, clone);
    render();
    App.emit('songChanged');
  }

  function deleteSection(sIdx) {
    if (App.state.sections.length > 1 || confirm('Delete the only section?')) {
      App.state.sections.splice(sIdx, 1);
      if (App.state.sections.length === 0) {
        App.state.sections.push({
          name: 'Verse',
          totalBeats: 16,
          subdivisions: 2,
          chords: [],
          gridState: {},
          dynamics: 'mf',
        });
      }
      selectedSectionIdx = -1;
      render();
      App.emit('songChanged');
    }
  }

  function showSectionContextMenu(x, y, sIdx) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.textContent = 'Copy Section';
    copyItem.addEventListener('click', (e) => {
      e.stopPropagation();
      copySection(sIdx);
      menu.remove();
    });
    menu.appendChild(copyItem);

    const pasteItem = document.createElement('div');
    pasteItem.className = 'context-menu-item' + (!sectionClipboard ? ' disabled' : '');
    pasteItem.textContent = 'Paste Section After';
    pasteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sectionClipboard) return;
      pasteSection(sIdx);
      menu.remove();
    });
    menu.appendChild(pasteItem);

    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.style.color = 'var(--accent)';
    deleteItem.textContent = 'Delete Section';
    deleteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      deleteSection(sIdx);
    });
    menu.appendChild(deleteItem);

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  function showChordRowContextMenu(x, y, sIdx, startBeat) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const section = App.state.sections[sIdx];

    const pasteItem = document.createElement('div');
    pasteItem.className = 'context-menu-item' + (!clipboard ? ' disabled' : '');
    pasteItem.textContent = 'Paste Chord';
    pasteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!clipboard || !section) { menu.remove(); return; }

      const available = maxAvailableDuration(section.chords, startBeat, section.totalBeats - startBeat);
      const durationBeats = Math.min(clipboard.durationBeats, available);
      if (durationBeats <= 0) { menu.remove(); return; }

      section.chords.push({
        chord: clipboard.chord,
        voicingIndex: clipboard.voicingIndex,
        startBeat,
        durationBeats,
      });
      section.chords.sort((a, b) => a.startBeat - b.startBeat);

      // Paste grid data
      const destStartCol = startBeat * section.subdivisions;
      const destNumCols = durationBeats * section.subdivisions;
      for (const [offsetKey, vel] of Object.entries(clipboard.gridData)) {
        const [rowId, offsetStr] = offsetKey.split(':');
        const offset = parseInt(offsetStr, 10);
        if (offset < destNumCols) {
          section.gridState[rowId + ':' + (destStartCol + offset)] = vel;
        }
      }

      menu.remove();
      render();
      App.emit('songChanged');
    });
    menu.appendChild(pasteItem);

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  function showEmptyTimelineContextMenu(x, y) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const pasteItem = document.createElement('div');
    pasteItem.className = 'context-menu-item' + (!sectionClipboard ? ' disabled' : '');
    pasteItem.textContent = 'Paste Section';
    pasteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sectionClipboard) return;
      pasteSection(App.state.sections.length - 1);
      menu.remove();
    });
    menu.appendChild(pasteItem);

    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);

    const addItem = document.createElement('div');
    addItem.className = 'context-menu-item';
    addItem.textContent = 'Add New Section';
    addItem.addEventListener('click', (e) => {
      e.stopPropagation();
      addSection();
      menu.remove();
    });
    menu.appendChild(addItem);

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }

  // =============================================
  // Section theory panel (roman numerals + circle of fifths)
  // =============================================
  const CIRCLE_OF_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

  function renderSectionTheory(section) {
    const panel = document.getElementById('section-theory');
    const numeralsDiv = document.getElementById('theory-numerals');
    const circleDiv = document.getElementById('theory-circle');
    if (!panel || !numeralsDiv || !circleDiv) return;

    if (!section) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = '';
    const key = App.state.key;
    const mode = App.state.mode;

    // Roman numeral analysis
    numeralsDiv.innerHTML = '';
    const analysisRow = document.createElement('div');
    analysisRow.className = 'theory-numeral-row';

    if (section.chords.length === 0) {
      // Show diatonic chords as suggestions
      const diatonic = Theory.getDiatonicChords(key, mode);
      diatonic.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'theory-numeral-item suggested';
        item.innerHTML = `<span class="numeral-symbol">${ch.numeral}</span><span class="numeral-chord">${ch.triad}</span>`;
        analysisRow.appendChild(item);
      });
      numeralsDiv.appendChild(analysisRow);

      const usedChordNames = new Set();
      renderCircleOfFifths(circleDiv, key, mode, usedChordNames, []);
      return;
    }

    const usedRoots = new Set();

    section.chords.forEach(c => {
      const degree = Theory.findDegree(key, mode, c.chord);
      const diatonic = Theory.getDiatonicChords(key, mode);
      let numeral = '?';
      if (degree) {
        numeral = diatonic[degree - 1].numeral;
        // Add quality suffixes for 7ths etc
        const root = c.chord.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
        const suffix = c.chord.slice(root.length);
        if (suffix === '7' || suffix === 'maj7' || suffix === 'm7' || suffix === 'm7b5') {
          numeral += suffix.replace('m7b5', 'ø7').replace('maj7', 'Δ7').replace('m7', '7').replace('7', '7');
        }
      }

      const item = document.createElement('div');
      item.className = 'theory-numeral-item' + (degree ? '' : ' non-diatonic');
      item.innerHTML = `<span class="numeral-symbol">${numeral}</span><span class="numeral-chord">${c.chord}</span>`;
      analysisRow.appendChild(item);

      // Track roots for circle highlighting
      const root = c.chord.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
      usedRoots.add(root);
    });

    numeralsDiv.appendChild(analysisRow);

    // Circle of fifths SVG
    renderCircleOfFifths(circleDiv, key, mode, usedRoots, section.chords);
  }

  function renderCircleOfFifths(container, key, mode, usedRoots, chords) {
    const size = 260;
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = 108;
    const innerRadius = 72;

    // Relative minor is 3 semitones below each major (same position on circle)
    const CIRCLE_MINORS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Fm', 'Cm', 'Gm', 'Dm'];

    const scaleNotes = Theory.getScaleNotes(key, mode);

    // Build set of used chord names (full, e.g. "Am", "C") for highlighting
    const usedChordNames = new Set();
    chords.forEach(c => usedChordNames.add(c.chord));

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;

    // Draw rings
    svg += `<circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="none" stroke="var(--border)" stroke-width="1.5"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="none" stroke="var(--border)" stroke-width="1"/>`;

    // Draw connecting lines between used chords in order
    const chordPositions = [];
    chords.forEach(c => {
      // Strip extensions to get base chord, then check minor
      const base = c.chord.replace(/(m7b5|maj7|m7|7|sus2|sus4|add9)$/, '');
      const isMinor = base.endsWith('m') || base.endsWith('dim') || base.endsWith('aug');
      const noteRoot = isMinor ? base.replace(/(m|dim|aug)$/, '') : base;
      const idx = CIRCLE_OF_FIFTHS.indexOf(noteRoot);
      if (idx >= 0) {
        const r = isMinor ? innerRadius : outerRadius;
        const angle = (idx * 30 - 90) * Math.PI / 180;
        chordPositions.push({
          x: cx + Math.cos(angle) * (r - 12),
          y: cy + Math.sin(angle) * (r - 12),
        });
      }
    });

    if (chordPositions.length > 1) {
      let pathD = `M ${chordPositions[0].x} ${chordPositions[0].y}`;
      for (let i = 1; i < chordPositions.length; i++) {
        pathD += ` L ${chordPositions[i].x} ${chordPositions[i].y}`;
      }
      svg += `<path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>`;

      // Arrow on last segment
      const last = chordPositions[chordPositions.length - 1];
      const prev = chordPositions[chordPositions.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const arrowLen = 8;
      const a1x = last.x - arrowLen * Math.cos(angle - 0.4);
      const a1y = last.y - arrowLen * Math.sin(angle - 0.4);
      const a2x = last.x - arrowLen * Math.cos(angle + 0.4);
      const a2y = last.y - arrowLen * Math.sin(angle + 0.4);
      svg += `<polygon points="${last.x},${last.y} ${a1x},${a1y} ${a2x},${a2y}" fill="var(--accent)" opacity="0.7"/>`;
    }

    // Helper to style a node
    function nodeStyle(note, isMinor) {
      const chordName = isMinor ? note + 'm' : note;
      const isInScale = scaleNotes.includes(note);
      // Only highlight if this specific chord type (major or minor) is used
      const isUsed = isMinor
        ? usedChordNames.has(note + 'm') || usedChordNames.has(note + 'm7')
        : usedChordNames.has(note) || usedChordNames.has(note + '7') || usedChordNames.has(note + 'maj7');
      const isRoot = note === key;

      const nodeR = isUsed ? 15 : (isInScale ? 12 : 9);
      let fill = 'var(--bg-card)';
      let stroke = 'var(--border)';
      let textColor = 'var(--text-muted)';
      let fontWeight = '400';
      let fontSize = isMinor ? '9' : '11';

      if (isRoot && ((mode === 'minor' && isMinor) || (mode !== 'minor' && !isMinor))) {
        fill = 'var(--accent)';
        stroke = 'var(--accent)';
        textColor = '#fff';
        fontWeight = '700';
      } else if (isUsed) {
        fill = 'rgba(233, 69, 96, 0.25)';
        stroke = 'var(--accent)';
        textColor = 'var(--text)';
        fontWeight = '600';
      } else if (isInScale) {
        fill = 'var(--bg-surface)';
        stroke = 'var(--text-muted)';
        textColor = 'var(--text)';
      }

      return { nodeR, fill, stroke, textColor, fontWeight, fontSize };
    }

    // Outer ring: major chords
    CIRCLE_OF_FIFTHS.forEach((note, i) => {
      const angle = (i * 30 - 90) * Math.PI / 180;
      const x = cx + Math.cos(angle) * outerRadius;
      const y = cy + Math.sin(angle) * outerRadius;
      const s = nodeStyle(note, false);

      svg += `<circle cx="${x}" cy="${y}" r="${s.nodeR}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`;
      svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${s.textColor}" font-size="${s.fontSize}" font-weight="${s.fontWeight}" font-family="inherit">${note}</text>`;
    });

    // Inner ring: relative minor chords
    CIRCLE_MINORS.forEach((minorChord, i) => {
      const angle = (i * 30 - 90) * Math.PI / 180;
      const x = cx + Math.cos(angle) * innerRadius;
      const y = cy + Math.sin(angle) * innerRadius;
      const note = minorChord.replace('m', '');
      const s = nodeStyle(note, true);

      svg += `<circle cx="${x}" cy="${y}" r="${s.nodeR}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/>`;
      svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${s.textColor}" font-size="${s.fontSize}" font-weight="${s.fontWeight}" font-family="inherit">${minorChord}</text>`;
    });

    // Center label
    svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="inherit">${key}</text>`;
    svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="inherit">${mode}</text>`;

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function hideSectionTheory() {
    const panel = document.getElementById('section-theory');
    if (panel) panel.style.display = 'none';
  }

  // =============================================
  // Drag from palette setup
  // =============================================
  function setupDragFromPalette() {
    // Handled by chord row drop listeners
  }

  return { init, render, setPlayingColumn, getSelectedSectionIdx: () => selectedSectionIdx };
})();
