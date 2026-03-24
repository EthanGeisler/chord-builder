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

  // Clipboard for grid cell (tab pattern) copy/paste
  let gridClipboard = null; // { data: {"rowId:colOffset": vel}, rowSpan, colSpan }

  // Clipboard for tab pattern copy/paste (gridState only, across sections)
  let tabClipboard = null; // { gridState: {...}, subdivisions, totalBeats }

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

  // Mobile detection
  const _mobileQuery = window.matchMedia('(max-width: 768px)');
  const MOBILE_COL_WIDTH = 40;

  // Touch state for long-press selection
  let _touchLongPressTimer = null;
  let _touchSelecting = false;
  let _touchStartCell = null;

  function _isMobile() { return _mobileQuery.matches; }

  function _applyMobileColWidth() {
    if (_isMobile()) {
      COL_WIDTH_PX = Math.max(COL_WIDTH_PX, MOBILE_COL_WIDTH);
    }
    applyZoom();
  }

  function init() {
    // Set mobile col width before first render
    if (_isMobile()) COL_WIDTH_PX = MOBILE_COL_WIDTH;

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
    const timelineEl = document.getElementById('song-timeline');
    timelineEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(COL_WIDTH_PX + delta);
        return;
      }
      // Ensure vertical scroll always reaches the timeline panel
      // even when mouse is over absolutely-positioned elements
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        timelineEl.scrollTop += e.deltaY;
      }
    }, { passive: false });

    // Respond to orientation / breakpoint changes
    _mobileQuery.addEventListener('change', () => {
      if (_isMobile()) {
        COL_WIDTH_PX = Math.max(COL_WIDTH_PX, MOBILE_COL_WIDTH);
      } else {
        if (COL_WIDTH_PX === MOBILE_COL_WIDTH) COL_WIDTH_PX = COL_WIDTH_DEFAULT;
      }
      applyZoom();
      render();
    });

    // Re-render on window resize so wrapping recalculates
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(render, 150);
    });

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
      }
    });
  }

  function render() {
    // Preserve scroll positions across DOM rebuild
    const timelineEl = document.getElementById('song-timeline');
    const savedTlScroll = timelineEl ? timelineEl.scrollTop : 0;
    const savedWinScroll = window.scrollY;

    const el = container();
    el.innerHTML = '';

    App.state.sections.forEach((section, sIdx) => {
      el.appendChild(createSectionElement(section, sIdx));
    });

    // Restore scroll after DOM is rebuilt
    if (timelineEl) timelineEl.scrollTop = savedTlScroll;
    window.scrollTo(window.scrollX, savedWinScroll);
  }

  // =============================================
  // Section element
  // =============================================
  function createSectionElement(section, sIdx) {
    const div = document.createElement('div');
    div.className = 'timeline-section';
    div.dataset.sectionIndex = sIdx;

    // Section width: constrained to container (wrapping handles overflow)
    div.style.minWidth = '100%';

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
      App.emit('sectionSelected', { sectionIndex: sIdx });
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
  // Section body: chord row + step grid (with wrapping)
  // =============================================

  // Helper: create row labels column for a segment
  function _createRowLabels() {
    const labelsDiv = document.createElement('div');
    labelsDiv.className = 'grid-row-labels';
    const chordLabel = document.createElement('div');
    chordLabel.className = 'grid-label chord-row-label';
    chordLabel.textContent = 'Chords';
    labelsDiv.appendChild(chordLabel);
    const beatLabel = document.createElement('div');
    beatLabel.className = 'grid-label beat-header-label';
    labelsDiv.appendChild(beatLabel);
    Tablature.GRID_ROWS.forEach(row => {
      const label = document.createElement('div');
      label.className = 'grid-label' + (row.type === 'special' ? ' grid-label-special' : '');
      label.textContent = row.label;
      labelsDiv.appendChild(label);
    });
    return labelsDiv;
  }

  // Helper: create chord row for a column segment
  function _createChordRowSegment(section, sIdx, colStart, colEnd, segmentWidth) {
    const chordRow = document.createElement('div');
    chordRow.className = 'chord-row';
    chordRow.style.width = segmentWidth + 'px';
    chordRow.dataset.colStart = colStart;

    // Render chord blocks that overlap this segment
    section.chords.forEach((chord, cIdx) => {
      const chordColStart = chord.startBeat * section.subdivisions;
      const chordColEnd = (chord.startBeat + chord.durationBeats) * section.subdivisions;
      // Does this chord overlap [colStart, colEnd)?
      if (chordColEnd <= colStart || chordColStart >= colEnd) return;

      const clippedStart = Math.max(chordColStart, colStart);
      const clippedEnd = Math.min(chordColEnd, colEnd);
      const block = createChordBlock(chord, section, sIdx, cIdx);
      // Position relative to segment start
      block.style.left = ((clippedStart - colStart) * COL_WIDTH_PX) + 'px';
      block.style.width = ((clippedEnd - clippedStart) * COL_WIDTH_PX) + 'px';
      // Mark if clipped so we can style differently
      if (clippedStart > chordColStart) block.classList.add('chord-block-clipped-left');
      if (clippedEnd < chordColEnd) block.classList.add('chord-block-clipped-right');
      chordRow.appendChild(block);
    });

    // Helper to compute absolute col from click position in this chord row
    function _absColFromEvent(e) {
      const rect = chordRow.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return colStart + Math.floor(x / COL_WIDTH_PX);
    }

    // Drop target
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

      const col = _absColFromEvent(e);
      const startBeat = Math.floor(col / section.subdivisions);
      const beatsPerMeasure = App.getBeatsPerMeasure();
      const nextChord = section.chords.filter(c => c.startBeat > startBeat).sort((a, b) => a.startBeat - b.startBeat)[0];
      const maxBeforeNext = nextChord ? nextChord.startBeat - startBeat : Infinity;
      const durationBeats = Math.min(beatsPerMeasure, section.totalBeats - startBeat, maxBeforeNext);

      if (durationBeats <= 0) return;
      if (hasOverlap(section.chords, startBeat, durationBeats, -1)) return;

      section.chords.push({ chord: chordName, voicingIndex: 0, startBeat, durationBeats });
      section.chords.sort((a, b) => a.startBeat - b.startBeat);
      render();
      App.emit('songChanged');
      App.emit('chordPlaced', { sIdx, chord: chordName });
    });

    // Right-click empty chord row space
    chordRow.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.chord-block')) return;
      e.preventDefault();
      const col = _absColFromEvent(e);
      const startBeat = Math.floor(col / section.subdivisions);
      showChordRowContextMenu(e.clientX, e.clientY, sIdx, startBeat);
    });

    // Mobile tap-to-place
    if (_isMobile() && typeof Controls !== 'undefined' && Controls.getTouchSelectedChord()) {
      chordRow.classList.add('touch-place-target');
    }
    chordRow.addEventListener('click', (e) => {
      if (!_isMobile()) return;
      if (e.target.closest('.chord-block')) return;
      if (typeof Controls === 'undefined') return;
      const chordName = Controls.getTouchSelectedChord();
      if (!chordName) return;

      const col = _absColFromEvent(e);
      const startBeat = Math.floor(col / section.subdivisions);
      const beatsPerMeasure = App.getBeatsPerMeasure();
      const nextChord = section.chords.filter(c => c.startBeat > startBeat).sort((a, b) => a.startBeat - b.startBeat)[0];
      const maxBeforeNext = nextChord ? nextChord.startBeat - startBeat : Infinity;
      const durationBeats = Math.min(beatsPerMeasure, section.totalBeats - startBeat, maxBeforeNext);

      if (durationBeats <= 0) return;
      if (hasOverlap(section.chords, startBeat, durationBeats, -1)) return;

      section.chords.push({ chord: chordName, voicingIndex: 0, startBeat, durationBeats });
      section.chords.sort((a, b) => a.startBeat - b.startBeat);
      Controls.setTouchSelectedChord(null);
      render();
      App.emit('songChanged');
      App.emit('chordPlaced', { sIdx, chord: chordName });
    });

    return chordRow;
  }

  // Helper: create beat header for a column segment
  function _createBeatHeaderSegment(section, colStart, colEnd, segmentWidth) {
    const beatHeader = document.createElement('div');
    beatHeader.className = 'beat-header-row';
    beatHeader.style.width = segmentWidth + 'px';

    const beatsPerMeasure = App.getBeatsPerMeasure();
    const stepsPerMeasure = beatsPerMeasure * section.subdivisions;

    for (let col = colStart; col < colEnd; col++) {
      const cell = document.createElement('div');
      cell.className = 'beat-header-cell';
      cell.style.width = COL_WIDTH_PX + 'px';
      const colInMeasure = col % stepsPerMeasure;
      const label = Tablature.getBeatLabel(colInMeasure, stepsPerMeasure, App.state.timeSignature);
      cell.textContent = label;

      const stepsPerBeat = section.subdivisions;
      if (col % stepsPerBeat === 0) cell.classList.add('beat-downbeat');
      if (isChordBoundary(section, col)) cell.classList.add('beat-chord-boundary');

      beatHeader.appendChild(cell);
    }
    return beatHeader;
  }

  // Helper: create step grid for a column segment
  function _createStepGridSegment(section, sIdx, colStart, colEnd, segmentWidth) {
    const gridEl = document.createElement('div');
    gridEl.className = 'step-grid';
    gridEl.style.width = segmentWidth + 'px';

    Tablature.GRID_ROWS.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'step-grid-row' + (row.type === 'special' ? ' step-grid-special-row' : '');

      for (let col = colStart; col < colEnd; col++) {
        const cell = document.createElement('div');
        cell.className = 'step-grid-cell';
        cell.style.width = COL_WIDTH_PX + 'px';
        cell.dataset.rowIdx = rowIdx;
        cell.dataset.col = col;  // ABSOLUTE column number
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

        // Right-click
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if ((selectState.cells.size > 0 && selectState.sIdx === sIdx) || gridClipboard) {
            showGridContextMenu(e, sIdx, section);
            return;
          }
          if (section.gridState[key]) {
            delete section.gridState[key];
            clearSelection();
            render();
            App.emit('songChanged');
          }
        });

        // Touch events
        cell.addEventListener('touchstart', (e) => {
          if (!_isMobile()) return;
          const touch = e.touches[0];
          _touchStartCell = { sIdx, rowIdx, col, key, row, section, x: touch.clientX, y: touch.clientY };
          _touchSelecting = false;

          _touchLongPressTimer = setTimeout(() => {
            _touchSelecting = true;
            cell.classList.add('touch-selecting');
            selectState = {
              sIdx, cells: new Set(), active: true,
              anchorRow: rowIdx, anchorCol: col,
              currentRow: rowIdx, currentCol: col,
              moved: false,
            };
            updateMarqueeVisual(sIdx, section);
          }, 500);
        }, { passive: true });

        cell.addEventListener('touchmove', (e) => {
          if (!_touchStartCell) return;
          const touch = e.touches[0];
          const dx = Math.abs(touch.clientX - _touchStartCell.x);
          const dy = Math.abs(touch.clientY - _touchStartCell.y);
          if (!_touchSelecting && (dx > 10 || dy > 10)) {
            clearTimeout(_touchLongPressTimer);
            _touchStartCell = null;
            return;
          }
          if (_touchSelecting) {
            e.preventDefault();
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && el.classList.contains('step-grid-cell')) {
              const r = parseInt(el.dataset.rowIdx, 10);
              const c = parseInt(el.dataset.col, 10);
              const s = parseInt(el.dataset.sIdx, 10);
              if (s === selectState.sIdx && (r !== selectState.currentRow || c !== selectState.currentCol)) {
                selectState.moved = true;
                selectState.currentRow = r;
                selectState.currentCol = c;
                updateMarqueeVisual(selectState.sIdx, App.state.sections[selectState.sIdx]);
              }
            }
          }
        }, { passive: false });

        cell.addEventListener('touchend', (e) => {
          clearTimeout(_touchLongPressTimer);
          if (!_touchStartCell) return;
          if (_touchSelecting) {
            _touchSelecting = false;
            selectState.active = false;
            _touchStartCell = null;
            return;
          }
          const tc = _touchStartCell;
          _touchStartCell = null;
          e.preventDefault();

          if (tc.row.id === 'alt-bass') {
            const rows = Tablature.GRID_ROWS;
            const stringRows = rows.filter(r => r.type === 'string');
            const anyActive = stringRows.some(r => tc.section.gridState[r.id + ':' + tc.col]);
            const v = (tc.col % tc.section.subdivisions === 0) ? 1.0 : 0.7;
            stringRows.forEach(r => {
              const k = r.id + ':' + tc.col;
              if (anyActive) delete tc.section.gridState[k];
              else tc.section.gridState[k] = v;
            });
          } else {
            if (tc.section.gridState[tc.key]) {
              delete tc.section.gridState[tc.key];
            } else {
              tc.section.gridState[tc.key] = (tc.col % tc.section.subdivisions === 0) ? 1.0 : 0.7;
            }
          }
          clearSelection();
          render();
          App.emit('songChanged');
        });

        rowEl.appendChild(cell);
      }

      gridEl.appendChild(rowEl);
    });
    return gridEl;
  }

  function createSectionBody(section, sIdx) {
    const totalCols = section.totalBeats * section.subdivisions;
    const gridWidth = totalCols * COL_WIDTH_PX;
    const ROW_LABELS_WIDTH = 44;

    const wrapper = document.createElement('div');
    wrapper.className = 'section-scroll-wrapper';

    // Determine if wrapping is needed
    // Use the timeline panel width as reference (wrapper isn't in DOM yet)
    const timelinePanel = document.getElementById('song-timeline');
    const availableWidth = timelinePanel ? (timelinePanel.clientWidth - 32) : 9999; // 32 for padding
    const contentWidth = gridWidth + ROW_LABELS_WIDTH + 4;
    const colsFit = Math.floor((availableWidth - ROW_LABELS_WIDTH) / COL_WIDTH_PX);
    const needsWrapping = contentWidth > availableWidth && colsFit > 0 && colsFit < totalCols;

    if (!needsWrapping) {
      // Original single-row layout with horizontal scroll
      wrapper.classList.add('section-scroll-no-wrap');

      const inner = document.createElement('div');
      inner.className = 'section-scroll-inner';
      inner.style.minWidth = '100%';

      const labelsDiv = _createRowLabels();
      const scrollArea = document.createElement('div');
      scrollArea.className = 'section-scroll-area';

      scrollArea.appendChild(_createChordRowSegment(section, sIdx, 0, totalCols, gridWidth));
      scrollArea.appendChild(_createBeatHeaderSegment(section, 0, totalCols, gridWidth));
      scrollArea.appendChild(_createStepGridSegment(section, sIdx, 0, totalCols, gridWidth));

      // Playheads
      const playheadSmooth = document.createElement('div');
      playheadSmooth.className = 'playhead-line playhead-smooth';
      playheadSmooth.style.display = 'none';
      playheadSmooth.dataset.sectionIndex = sIdx;
      playheadSmooth.dataset.segColStart = '0';
      scrollArea.appendChild(playheadSmooth);

      const playhead = document.createElement('div');
      playhead.className = 'playhead-line playhead-step';
      playhead.style.display = 'none';
      playhead.dataset.sectionIndex = sIdx;
      playhead.dataset.segColStart = '0';
      scrollArea.appendChild(playhead);

      // Endpoint handle
      const sectionHandle = document.createElement('div');
      sectionHandle.className = 'section-endpoint-handle';
      sectionHandle.style.left = gridWidth + 'px';
      sectionHandle.title = 'Drag to resize section';
      sectionHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sectionResizeState = {
          sIdx, section,
          startX: e.clientX,
          origTotalBeats: section.totalBeats,
        };
        sectionHandle.classList.add('dragging');
      });
      scrollArea.appendChild(sectionHandle);

      inner.appendChild(labelsDiv);
      inner.appendChild(scrollArea);
      wrapper.appendChild(inner);
      return wrapper;
    }

    // === Wrapped layout: split into segments ===
    wrapper.classList.add('section-scroll-wrapped');

    // Snap colsPerRow to beat boundary for cleaner wrapping
    let colsPerRow = colsFit;
    const stepsPerBeat = section.subdivisions;
    colsPerRow = Math.floor(colsPerRow / stepsPerBeat) * stepsPerBeat;
    if (colsPerRow < stepsPerBeat) colsPerRow = stepsPerBeat;

    const numSegments = Math.ceil(totalCols / colsPerRow);

    for (let seg = 0; seg < numSegments; seg++) {
      const colStart = seg * colsPerRow;
      const colEnd = Math.min(colStart + colsPerRow, totalCols);
      const segCols = colEnd - colStart;
      const segWidth = segCols * COL_WIDTH_PX;

      const group = document.createElement('div');
      group.className = 'grid-row-group';
      group.dataset.segIndex = seg;
      group.dataset.colStart = colStart;
      group.dataset.colEnd = colEnd;

      // Row labels
      group.appendChild(_createRowLabels());

      // Content area
      const content = document.createElement('div');
      content.className = 'grid-row-group-content';

      content.appendChild(_createChordRowSegment(section, sIdx, colStart, colEnd, segWidth));
      content.appendChild(_createBeatHeaderSegment(section, colStart, colEnd, segWidth));
      content.appendChild(_createStepGridSegment(section, sIdx, colStart, colEnd, segWidth));

      // Playheads for this segment
      const playheadSmooth = document.createElement('div');
      playheadSmooth.className = 'playhead-line playhead-smooth';
      playheadSmooth.style.display = 'none';
      playheadSmooth.dataset.sectionIndex = sIdx;
      playheadSmooth.dataset.segColStart = colStart;
      playheadSmooth.dataset.segColEnd = colEnd;
      content.appendChild(playheadSmooth);

      const playhead = document.createElement('div');
      playhead.className = 'playhead-line playhead-step';
      playhead.style.display = 'none';
      playhead.dataset.sectionIndex = sIdx;
      playhead.dataset.segColStart = colStart;
      playhead.dataset.segColEnd = colEnd;
      content.appendChild(playhead);

      // Endpoint handle only on last segment
      if (seg === numSegments - 1) {
        const sectionHandle = document.createElement('div');
        sectionHandle.className = 'section-endpoint-handle';
        sectionHandle.style.left = segWidth + 'px';
        sectionHandle.title = 'Drag to resize section';
        sectionHandle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          sectionResizeState = {
            sIdx, section,
            startX: e.clientX,
            origTotalBeats: section.totalBeats,
          };
          sectionHandle.classList.add('dragging');
        });
        content.appendChild(sectionHandle);
      }

      group.appendChild(content);
      wrapper.appendChild(group);
    }

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
    nameEl.textContent = Theory.displayChord(chord.chord);
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
    const { section, startX, origTotalBeats } = sectionResizeState;
    const dx = e.clientX - startX;

    // Horizontal: each column of mouse movement = 1 beat delta
    const colDelta = Math.round(dx / COL_WIDTH_PX);
    const beatDelta = colDelta / section.subdivisions;

    const beatsPerMeasure = App.getBeatsPerMeasure();
    const bpm = beatsPerMeasure;

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
    const sIdx = resizeState ? resizeState.sIdx : dragState.sIdx;
    const cIdx = resizeState ? resizeState.cIdx : dragState.cIdx;
    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (!sectionEl) return;

    const wrapper = sectionEl.querySelector('.section-scroll-wrapper');
    if (wrapper && wrapper.classList.contains('section-scroll-wrapped')) {
      // With wrapping, blocks are split across segments — full re-render needed
      render();
      return;
    }

    // Non-wrapped: update the block directly
    const leftPx = chord.startBeat * section.subdivisions * COL_WIDTH_PX;
    const widthPx = chord.durationBeats * section.subdivisions * COL_WIDTH_PX;
    const blocks = sectionEl.querySelectorAll('.chord-block');
    if (blocks[cIdx]) {
      blocks[cIdx].style.left = leftPx + 'px';
      blocks[cIdx].style.width = widthPx + 'px';
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

  function copyGridSelection(sIdx, section) {
    if (selectState.cells.size === 0) return;
    // Find bounds of selection
    let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
    const rows = Tablature.GRID_ROWS;
    for (const key of selectState.cells) {
      const [rowId, colStr] = key.split(':');
      const col = parseInt(colStr, 10);
      const rowIdx = rows.findIndex(r => r.id === rowId);
      if (rowIdx < minRow) minRow = rowIdx;
      if (rowIdx > maxRow) maxRow = rowIdx;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
    // Store as offsets from top-left of selection
    const data = {};
    for (const key of selectState.cells) {
      const [rowId, colStr] = key.split(':');
      const col = parseInt(colStr, 10);
      const rowIdx = rows.findIndex(r => r.id === rowId);
      const vel = section.gridState[key];
      if (vel) {
        const offsetKey = (rowIdx - minRow) + ':' + (col - minCol);
        data[offsetKey] = { vel, rowId };
      }
    }
    gridClipboard = {
      data,
      rowSpan: maxRow - minRow + 1,
      colSpan: maxCol - minCol + 1,
    };
    // Flash selected cells to confirm
    document.querySelectorAll('.step-grid-cell.step-selected').forEach(c => {
      c.style.outline = '2px solid var(--success)';
      setTimeout(() => { c.style.outline = ''; }, 300);
    });
  }

  function pasteGridAtClick(sIdx, section, e) {
    if (!gridClipboard) return;
    // Find the cell under the click
    const cellEl = e.target.closest('.step-grid-cell');
    if (!cellEl) return;
    const targetRowIdx = parseInt(cellEl.dataset.rowIdx, 10);
    const targetCol = parseInt(cellEl.dataset.col, 10);
    const rows = Tablature.GRID_ROWS;
    const totalCols = section.totalBeats * section.subdivisions;

    for (const [offsetKey, entry] of Object.entries(gridClipboard.data)) {
      const colOffset = parseInt(offsetKey.split(':')[1], 10);
      const destCol = targetCol + colOffset;
      if (destCol >= totalCols || destCol < 0) continue;
      const destKey = entry.rowId + ':' + destCol;
      section.gridState[destKey] = entry.vel;
    }
    clearSelection();
    render();
    App.emit('songChanged');
  }

  function showGridContextMenu(e, sIdx, section) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const hasSelection = selectState.cells.size > 0 && selectState.sIdx === sIdx;

    // Copy
    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item' + (!hasSelection ? ' disabled' : '');
    copyItem.textContent = 'Copy Pattern';
    copyItem.addEventListener('click', () => {
      if (!hasSelection) { menu.remove(); return; }
      copyGridSelection(sIdx, section);
      menu.remove();
    });
    menu.appendChild(copyItem);

    // Paste
    const pasteItem = document.createElement('div');
    pasteItem.className = 'context-menu-item' + (!gridClipboard ? ' disabled' : '');
    pasteItem.textContent = 'Paste Pattern';
    pasteItem.addEventListener('click', () => {
      if (!gridClipboard) { menu.remove(); return; }
      pasteGridAtClick(sIdx, section, e);
      menu.remove();
    });
    menu.appendChild(pasteItem);

    // Delete
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item' + (!hasSelection ? ' disabled' : '');
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
      if (!hasSelection) { menu.remove(); return; }
      for (const key of selectState.cells) {
        delete section.gridState[key];
      }
      clearSelection();
      render();
      App.emit('songChanged');
      menu.remove();
    });
    menu.appendChild(deleteItem);

    document.body.appendChild(menu);
  }

  function handleSelectionKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Grid cells selected — delete them
      if (selectState.cells.size > 0) {
        e.preventDefault();
        const section = App.state.sections[selectState.sIdx];
        if (!section) return;
        for (const key of selectState.cells) {
          delete section.gridState[key];
        }
        clearSelection();
        render();
        App.emit('songChanged');
        return;
      }
      // Chord selected — delete it
      const slot = App.state.selectedSlot;
      if (slot) {
        e.preventDefault();
        const section = App.state.sections[slot.sectionIndex];
        if (section && section.chords[slot.chordIndex]) {
          section.chords.splice(slot.chordIndex, 1);
          App.state.selectedSlot = null;
          render();
          App.emit('songChanged');
        }
        return;
      }
      // Section selected — delete it (but keep at least one)
      if (selectedSectionIdx >= 0 && App.state.sections.length > 1) {
        e.preventDefault();
        deleteSection(selectedSectionIdx);
        return;
      }
      return;
    }

    if (selectState.cells.size === 0) return;
    const section = App.state.sections[selectState.sIdx];
    if (!section) return;
    const totalCols = section.totalBeats * section.subdivisions;

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

    // Ctrl+C: copy grid selection, section, or chord
    if (ctrl && e.key === 'c') {
      // Grid cell selection takes priority
      if (selectState.cells.size > 0 && selectState.sIdx >= 0) {
        e.preventDefault();
        copyGridSelection(selectState.sIdx, App.state.sections[selectState.sIdx]);
        return;
      }
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

    // Ctrl+V: paste grid pattern, section, or chord
    if (ctrl && e.key === 'v') {
      // Grid paste if grid clipboard has data and cells are selected (paste at selection anchor)
      if (gridClipboard && selectState.cells.size > 0 && selectState.sIdx >= 0) {
        e.preventDefault();
        const section = App.state.sections[selectState.sIdx];
        const rows = Tablature.GRID_ROWS;
        const totalCols = section.totalBeats * section.subdivisions;
        // Find top-left of current selection as paste target
        let minRowIdx = Infinity, minCol = Infinity;
        for (const key of selectState.cells) {
          const [rowId, colStr] = key.split(':');
          const col = parseInt(colStr, 10);
          const rowIdx = rows.findIndex(r => r.id === rowId);
          if (rowIdx < minRowIdx) minRowIdx = rowIdx;
          if (col < minCol) minCol = col;
        }
        for (const [offsetKey, entry] of Object.entries(gridClipboard.data)) {
          const [rowOffset, colOffset] = offsetKey.split(':').map(Number);
          const destRowIdx = minRowIdx + rowOffset;
          const destCol = minCol + colOffset;
          if (destRowIdx >= rows.length || destCol >= totalCols) continue;
          section.gridState[rows[destRowIdx].id + ':' + destCol] = entry.vel;
        }
        clearSelection();
        render();
        App.emit('songChanged');
        return;
      }
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

      const rect = chordRow.getBoundingClientRect();
      const segColStart = parseInt(chordRow.dataset.colStart || '0', 10);
      const scrollArea = chordRow.closest('.section-scroll-area');
      const scrollLeft = scrollArea ? scrollArea.scrollLeft : 0;
      const x = e.clientX - rect.left + scrollLeft;
      const col = segColStart + Math.floor(x / COL_WIDTH_PX);
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
    if (!sectionEl) return;
    // With wrapping, a chord may appear in multiple segments — highlight all instances
    // Each chord block stores cIdx in its click handler closure, but we can match by data
    const section = App.state.sections[sIdx];
    if (!section || !section.chords[cIdx]) return;
    const chord = section.chords[cIdx];
    const chordColStart = chord.startBeat * section.subdivisions;
    sectionEl.querySelectorAll('.chord-block').forEach(b => {
      // Match by checking if the block's name matches and overlaps chord's column range
      // Simplest: just highlight all blocks for this chord name at this position
      const blockLeft = parseFloat(b.style.left);
      const parent = b.closest('.chord-row');
      if (!parent) return;
      const parentColStart = parseInt(parent.dataset.colStart || '0', 10);
      const absLeft = parentColStart * COL_WIDTH_PX + blockLeft;
      const chordAbsLeft = chordColStart * COL_WIDTH_PX;
      // Check if this block is part of the same chord (its absolute left overlaps the chord's range)
      const chordAbsRight = (chord.startBeat + chord.durationBeats) * section.subdivisions * COL_WIDTH_PX;
      if (absLeft >= chordAbsLeft && absLeft < chordAbsRight) {
        b.classList.add('selected');
      }
    });
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

    // Find the correct playhead(s) for this column — may be in a segment
    const allStepHeads = sectionEl.querySelectorAll('.playhead-step');
    const allSmoothHeads = sectionEl.querySelectorAll('.playhead-smooth');
    let stepHead = null;
    let smoothHead = null;
    let localCol = col;

    for (let i = 0; i < allStepHeads.length; i++) {
      const sh = allStepHeads[i];
      const segStart = parseInt(sh.dataset.segColStart || '0', 10);
      const segEnd = parseInt(sh.dataset.segColEnd || '999999', 10);
      if (col >= segStart && col < segEnd) {
        stepHead = sh;
        smoothHead = allSmoothHeads[i] || null;
        localCol = col - segStart;
        break;
      }
    }

    if (stepHead) {
      stepHead.style.display = 'block';
      stepHead.style.left = (localCol * COL_WIDTH_PX) + 'px';
    }

    // Animate smooth playhead
    if (smoothHead && colDurationMs) {
      smoothHead.style.display = 'block';
      _smoothPlayhead = smoothHead;
      _smoothStartX = localCol * COL_WIDTH_PX;
      _smoothEndX = (localCol + 1) * COL_WIDTH_PX;
      _smoothStartTime = performance.now();
      _smoothDuration = colDurationMs;
      if (!_smoothRAF) _smoothRAF = requestAnimationFrame(_animateSmoothPlayhead);
    }

    const timelinePanel = document.getElementById('song-timeline');
    const scrollWrapper = sectionEl.querySelector('.section-scroll-wrapper');

    // For non-wrapped: horizontal auto-scroll
    if (scrollWrapper && !scrollWrapper.classList.contains('section-scroll-wrapped')) {
      const section = App.state.sections[sIdx];
      const subdivisions = section ? section.subdivisions : 2;
      const colsPerBar = 4 * subdivisions;
      if (col % colsPerBar === 0) {
        const playheadLeft = col * COL_WIDTH_PX;
        const wrapperWidth = scrollWrapper.clientWidth;
        _scrollTarget = playheadLeft - (wrapperWidth / 2);
        _scrollWrapper = scrollWrapper;
        if (!_scrollRAF) _startScrollLerp();
      }
    }

    // Smoothly keep playhead vertically visible in the timeline panel
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

  function copyTabPattern(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section) return;
    tabClipboard = {
      gridState: { ...section.gridState },
      subdivisions: section.subdivisions,
      totalBeats: section.totalBeats,
    };
    // Flash grid area to confirm
    const sectionEl = container().querySelectorAll('.timeline-section')[sIdx];
    if (sectionEl) {
      const grid = sectionEl.querySelector('.step-grid');
      if (grid) {
        grid.style.outline = '2px solid var(--success)';
        setTimeout(() => { grid.style.outline = ''; }, 300);
      }
    }
  }

  function pasteTabPattern(sIdx) {
    if (!tabClipboard) return;
    const section = App.state.sections[sIdx];
    if (!section) return;

    const srcSubs = tabClipboard.subdivisions;
    const dstSubs = section.subdivisions;
    const dstTotalCols = section.totalBeats * dstSubs;

    // Clear existing grid
    section.gridState = {};

    // Paste, rescaling columns if subdivisions differ
    for (const [key, vel] of Object.entries(tabClipboard.gridState)) {
      const [rowId, colStr] = key.split(':');
      let col = parseInt(colStr, 10);

      if (srcSubs !== dstSubs) {
        // Convert: srcCol is at beat (col / srcSubs), map to dstCol
        const beat = col / srcSubs;
        col = Math.round(beat * dstSubs);
      }

      if (col < dstTotalCols) {
        section.gridState[rowId + ':' + col] = vel;
      }
    }

    render();
    App.emit('songChanged');
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

    const sep0 = document.createElement('div');
    sep0.className = 'context-menu-separator';
    menu.appendChild(sep0);

    const copyTabItem = document.createElement('div');
    copyTabItem.className = 'context-menu-item';
    copyTabItem.textContent = 'Copy Tab Pattern';
    copyTabItem.addEventListener('click', (e) => {
      e.stopPropagation();
      copyTabPattern(sIdx);
      menu.remove();
    });
    menu.appendChild(copyTabItem);

    const pasteTabItem = document.createElement('div');
    pasteTabItem.className = 'context-menu-item' + (!tabClipboard ? ' disabled' : '');
    pasteTabItem.textContent = 'Paste Tab Pattern';
    pasteTabItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!tabClipboard) return;
      pasteTabPattern(sIdx);
      menu.remove();
    });
    menu.appendChild(pasteTabItem);

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
  // Drag from palette setup
  // =============================================
  function setupDragFromPalette() {
    // Handled by chord row drop listeners
  }

  return { init, render, setPlayingColumn, getSelectedSectionIdx: () => selectedSectionIdx };
})();
