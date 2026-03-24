// === Chord Builder — Music Theory Analysis Panel ===

const TheoryPanel = (() => {
  const CIRCLE_OF_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
  const CIRCLE_MINORS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Fm', 'Cm', 'Gm', 'Dm'];

  const FUNC_COLORS = {
    tonic: '#2a9d8f',
    subdominant: '#e9c46a',
    dominant: 'var(--accent)',
    borrowed: '#7b2cbf',
    chromatic: '#555',
  };

  let currentScope = 'section';
  let currentSectionIdx = -1;
  let currentSugFilter = 'all';

  // =============================================
  // Analysis Engine
  // =============================================

  function getChordRoot(chordName) {
    return chordName.replace(/(m7b5|maj7|m7|dim|aug|7|m|sus2|sus4|add9)$/, '');
  }

  function getNumeral(key, mode, chordName) {
    const degree = Theory.findDegree(key, mode, chordName);
    if (!degree) {
      // Check if borrowed
      const parallelMode = mode === 'minor' ? 'major' : 'minor';
      const pDeg = Theory.findDegree(key, parallelMode, chordName);
      if (pDeg) {
        const pDiatonic = Theory.getDiatonicChords(key, parallelMode);
        return 'b' + pDiatonic[pDeg - 1].numeral;
      }
      return '?';
    }
    const diatonic = Theory.getDiatonicChords(key, mode);
    let numeral = diatonic[degree - 1].numeral;
    const root = getChordRoot(chordName);
    const suffix = chordName.slice(root.length);
    if (['7', 'maj7', 'm7', 'm7b5'].includes(suffix)) {
      numeral += suffix.replace('m7b5', '\u00f87').replace('maj7', '\u03947').replace('m7', '7').replace('7', '7');
    }
    return numeral;
  }

  function analyzeSectionHarmony(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section) return null;
    const key = App.state.key;
    const mode = App.state.mode;

    const chords = section.chords.map(c => {
      const degree = Theory.findDegree(key, mode, c.chord);
      return {
        chord: c.chord,
        degree,
        numeral: getNumeral(key, mode, c.chord),
        function: Theory.classifyChordFunction(key, mode, c.chord),
        durationBeats: c.durationBeats,
        startBeat: c.startBeat,
      };
    });

    const degrees = chords.map(c => c.degree).filter(Boolean);
    const patternName = Theory.detectProgressionPattern(degrees);

    return {
      sectionName: section.name,
      chords,
      patternName,
      key, mode,
    };
  }

  function analyzeFullSong() {
    const sections = App.state.sections.map((_, i) => analyzeSectionHarmony(i)).filter(Boolean);
    const allChordRoots = new Set();
    sections.forEach(s => s.chords.forEach(c => allChordRoots.add(getChordRoot(c.chord))));

    const harmonicArc = sections.map(s => {
      const numerals = s.chords.map(c => c.numeral).join('-');
      return s.sectionName + ': ' + (numerals || '(empty)');
    }).join('. ');

    return { sections, allChordRoots, harmonicArc };
  }

  // =============================================
  // Suggestion Engine
  // =============================================

  function suggestNewSections() {
    const song = analyzeFullSong();
    const names = new Set(App.state.sections.map(s => s.name.toLowerCase()));
    const suggestions = [];
    const key = App.state.key;
    const mode = App.state.mode;
    const diatonic = Theory.getDiatonicChords(key, mode);

    const hasVerse = names.has('verse');
    const hasChorus = names.has('chorus');

    if (!names.has('bridge') && hasVerse && hasChorus) {
      const iv = diatonic[3].triad;
      const ii = diatonic[1].triad;
      const vi = diatonic[5].triad;
      const V = diatonic[4].triad;
      suggestions.push({
        type: 'new-section',
        label: 'Add a Bridge',
        detail: 'Subdominant-heavy bridge to contrast verse/chorus',
        chords: [iv, ii, vi, V],
        target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
        apply: function() { applySectionSuggestion('Bridge', this.chords); },
      });
    }

    if (!names.has('outro')) {
      const last = App.state.sections[App.state.sections.length - 1];
      const outroChords = last && last.chords.length > 0
        ? last.chords.map(c => c.chord)
        : [diatonic[0].triad];
      suggestions.push({
        type: 'new-section',
        label: 'Add an Outro',
        detail: 'Repeat final section chords with resolution ending',
        chords: outroChords,
        target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
        apply: function() { applySectionSuggestion('Outro', this.chords); },
      });
    }

    if (!names.has('pre-chorus') && hasVerse && hasChorus) {
      const ii = diatonic[1].triad;
      const V = diatonic[4].triad;
      suggestions.push({
        type: 'new-section',
        label: 'Add a Pre-Chorus',
        detail: 'Build tension before the chorus with ii-V',
        chords: [ii, V],
        target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
        apply: function() { applySectionSuggestion('Pre-Chorus', this.chords); },
      });
    }

    if (!names.has('intro')) {
      const introChords = App.state.sections[0] && App.state.sections[0].chords.length > 0
        ? App.state.sections[0].chords.map(c => c.chord)
        : [diatonic[0].triad];
      suggestions.push({
        type: 'new-section',
        label: 'Add an Intro',
        detail: 'Instrumental version of verse chords',
        chords: introChords,
        target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
        apply: function() { applySectionSuggestion('Intro', this.chords, 0); },
      });
    }

    return suggestions;
  }

  function applySectionSuggestion(name, chordNames, insertAt) {
    const newSection = {
      name,
      totalBeats: chordNames.length * 4,
      subdivisions: 2,
      chords: chordNames.map((ch, i) => ({
        chord: ch,
        voicingIndex: 0,
        startBeat: i * 4,
        durationBeats: 4,
      })),
      gridState: {},
      dynamics: 'mf',
    };
    if (typeof insertAt === 'number') {
      App.state.sections.splice(insertAt, 0, newSection);
    } else {
      App.state.sections.push(newSection);
    }
    App.emit('songChanged');
    Timeline.render();
    refresh();
  }

  function suggestModulations() {
    const key = App.state.key;
    const mode = App.state.mode;
    const lastSection = App.state.sections[App.state.sections.length - 1];
    if (!lastSection || lastSection.chords.length === 0) return [];

    const sourceChords = lastSection.chords.map(c => c.chord);
    const suggestions = [];

    // Half-step up
    const upOne = sourceChords.map(c => Theory.transposeChord(c, 1));
    suggestions.push({
      type: 'modulation',
      label: 'Half-step up modulation',
      detail: 'Classic energy boost for a final chorus',
      chords: upOne,
      target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applySectionSuggestion('Final Chorus (+1)', this.chords); },
    });

    // Relative major/minor
    const relSemitones = mode === 'minor' ? 3 : -3;
    const relChords = sourceChords.map(c => Theory.transposeChord(c, relSemitones));
    const relLabel = mode === 'minor' ? 'Relative major' : 'Relative minor';
    suggestions.push({
      type: 'modulation',
      label: relLabel + ' modulation',
      detail: 'Shift to ' + relLabel.toLowerCase() + ' key center',
      chords: relChords,
      target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applySectionSuggestion('Bridge (' + relLabel + ')', this.chords); },
    });

    // Whole-step up
    const upTwo = sourceChords.map(c => Theory.transposeChord(c, 2));
    suggestions.push({
      type: 'modulation',
      label: 'Whole-step up modulation',
      detail: 'Dramatic lift, common in pop ballads',
      chords: upTwo,
      target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applySectionSuggestion('Final Chorus (+2)', this.chords); },
    });

    // Modulation to dominant
    const domChords = sourceChords.map(c => Theory.transposeChord(c, 7));
    suggestions.push({
      type: 'modulation',
      label: 'Modulate to dominant key',
      detail: 'Move up a fifth for a bright lift',
      chords: domChords,
      target: { sectionIndex: null, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applySectionSuggestion('Bridge (dom key)', this.chords); },
    });

    return suggestions;
  }

  function suggestPassingChords(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section || section.chords.length < 2) return [];
    const key = App.state.key;
    const mode = App.state.mode;
    const suggestions = [];

    for (let i = 0; i < section.chords.length - 1; i++) {
      const curr = section.chords[i];
      const next = section.chords[i + 1];
      const currRoot = getChordRoot(curr.chord);
      const nextRoot = getChordRoot(next.chord);
      const currIdx = Theory.KEYS.indexOf(currRoot);
      const nextIdx = Theory.KEYS.indexOf(nextRoot);
      if (currIdx < 0 || nextIdx < 0) continue;

      const dist = (nextIdx - currIdx + 12) % 12;

      // Chromatic approach from below
      if (dist > 2) {
        const approachRoot = Theory.KEYS[(nextIdx - 1 + 12) % 12];
        const approachChord = approachRoot + '7';
        suggestions.push({
          type: 'passing-chord',
          label: 'Add ' + Theory.displayChord(approachChord) + ' between ' + Theory.displayChord(curr.chord) + ' and ' + Theory.displayChord(next.chord),
          detail: 'Chromatic approach chord leading to ' + Theory.displayChord(next.chord),
          chords: [approachChord],
          target: { sectionIndex: sIdx, insertAfterChordIndex: i, replaceChordIndex: null },
          apply: function() { applyPassingChord(sIdx, i, approachChord); },
        });
      }

      // Diatonic passing
      const currDeg = Theory.findDegree(key, mode, curr.chord);
      const nextDeg = Theory.findDegree(key, mode, next.chord);
      if (currDeg && nextDeg && Math.abs(currDeg - nextDeg) > 1) {
        const midDeg = Math.min(currDeg, nextDeg) + 1;
        const diatonic = Theory.getDiatonicChords(key, mode);
        if (midDeg >= 1 && midDeg <= 7) {
          const passingChord = diatonic[midDeg - 1].triad;
          const numeral = diatonic[midDeg - 1].numeral;
          suggestions.push({
            type: 'passing-chord',
            label: 'Add ' + Theory.displayChord(passingChord) + ' (' + numeral + ') between ' + Theory.displayChord(curr.chord) + ' and ' + Theory.displayChord(next.chord),
            detail: 'Diatonic passing chord for smoother voice leading',
            chords: [passingChord],
            target: { sectionIndex: sIdx, insertAfterChordIndex: i, replaceChordIndex: null },
            apply: function() { applyPassingChord(sIdx, i, passingChord); },
          });
        }
      }
    }
    return suggestions;
  }

  function applyPassingChord(sIdx, afterIdx, chordName) {
    const section = App.state.sections[sIdx];
    if (!section) return;
    const curr = section.chords[afterIdx];
    if (!curr || curr.durationBeats < 2) return;

    // Halve current chord duration
    const halfDur = Math.floor(curr.durationBeats / 2);
    curr.durationBeats = halfDur;

    // Insert passing chord in freed space
    const newChord = {
      chord: chordName,
      voicingIndex: 0,
      startBeat: curr.startBeat + halfDur,
      durationBeats: curr.durationBeats,
    };

    section.chords.splice(afterIdx + 1, 0, newChord);
    App.emit('songChanged');
    Timeline.render();
    refresh();
  }

  function suggestSubstitutions(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section) return [];
    const key = App.state.key;
    const mode = App.state.mode;
    const suggestions = [];

    section.chords.forEach((c, i) => {
      // Tritone sub
      const tritone = Theory.getTritoneSubstitution(key, mode, c.chord);
      if (tritone) {
        suggestions.push({
          type: 'substitution',
          label: 'Tritone sub: replace ' + Theory.displayChord(c.chord) + ' with ' + Theory.displayChord(tritone),
          detail: 'Shares the same guide tones, adds chromatic bass movement',
          chords: [tritone],
          target: { sectionIndex: sIdx, insertAfterChordIndex: null, replaceChordIndex: i },
          apply: function() { applySubstitution(sIdx, i, tritone); },
        });
      }

      // Relative swap
      const relSwap = Theory.getRelativeSwap(c.chord);
      if (relSwap) {
        const isMinor = c.chord.includes('m') && !c.chord.includes('maj');
        const swapLabel = isMinor ? 'Relative major' : 'Relative minor';
        suggestions.push({
          type: 'substitution',
          label: swapLabel + ' swap: ' + Theory.displayChord(c.chord) + ' \u2192 ' + Theory.displayChord(relSwap),
          detail: 'Same notes, different tonal center',
          chords: [relSwap],
          target: { sectionIndex: sIdx, insertAfterChordIndex: null, replaceChordIndex: i },
          apply: function() { applySubstitution(sIdx, i, relSwap); },
        });
      }

      // Modal interchange
      const parallel = Theory.getParallelChords(key, mode);
      const degree = Theory.findDegree(key, mode, c.chord);
      if (degree) {
        const borrowed = parallel[degree - 1];
        if (borrowed && borrowed.triad !== c.chord) {
          suggestions.push({
            type: 'substitution',
            label: 'Modal interchange: ' + Theory.displayChord(c.chord) + ' \u2192 ' + Theory.displayChord(borrowed.triad),
            detail: 'Borrowed from parallel ' + (mode === 'minor' ? 'major' : 'minor'),
            chords: [borrowed.triad],
            target: { sectionIndex: sIdx, insertAfterChordIndex: null, replaceChordIndex: i },
            apply: function() { applySubstitution(sIdx, i, borrowed.triad); },
          });
        }
      }
    });

    return suggestions;
  }

  function applySubstitution(sIdx, chordIdx, newChordName) {
    const section = App.state.sections[sIdx];
    if (!section || !section.chords[chordIdx]) return;
    section.chords[chordIdx].chord = newChordName;
    section.chords[chordIdx].voicingIndex = 0;
    App.emit('songChanged');
    Timeline.render();
    refresh();
  }

  function suggestTurnarounds(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section || section.chords.length === 0) return [];
    const key = App.state.key;
    const mode = App.state.mode;
    const diatonic = Theory.getDiatonicChords(key, mode);
    const suggestions = [];

    const lastChord = section.chords[section.chords.length - 1];
    const lastDeg = Theory.findDegree(key, mode, lastChord.chord);

    // If not ending on V/V7
    if (lastDeg !== 5) {
      const V7 = diatonic[4].root + '7';
      suggestions.push({
        type: 'turnaround',
        label: 'End with ' + Theory.displayChord(V7) + ' (V7)',
        detail: 'Creates dominant tension for resolution',
        chords: [V7],
        target: { sectionIndex: sIdx, insertAfterChordIndex: section.chords.length - 1, replaceChordIndex: null },
        apply: function() { applyTurnaround(sIdx, [V7]); },
      });
    }

    // Classic turnaround: I-vi-ii-V7
    const I = diatonic[0].triad;
    const vi = diatonic[5].triad;
    const ii = diatonic[1].triad;
    const V7 = diatonic[4].root + '7';
    suggestions.push({
      type: 'turnaround',
      label: 'Classic turnaround: ' + [I, vi, ii, V7].map(c => Theory.displayChord(c)).join('-'),
      detail: 'I-vi-ii-V7 turnaround at end of section',
      chords: [I, vi, ii, V7],
      target: { sectionIndex: sIdx, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applyTurnaround(sIdx, [I, vi, ii, V7]); },
    });

    // iii-vi-ii-V7
    const iii = diatonic[2].triad;
    suggestions.push({
      type: 'turnaround',
      label: 'Jazz turnaround: ' + [iii, vi, ii, V7].map(c => Theory.displayChord(c)).join('-'),
      detail: 'iii-vi-ii-V7 creates smooth circle-of-fifths motion',
      chords: [iii, vi, ii, V7],
      target: { sectionIndex: sIdx, insertAfterChordIndex: null, replaceChordIndex: null },
      apply: function() { applyTurnaround(sIdx, [iii, vi, ii, V7]); },
    });

    return suggestions;
  }

  function applyTurnaround(sIdx, chordNames) {
    const section = App.state.sections[sIdx];
    if (!section) return;

    // Replace last N beats with turnaround chords
    const totalNeeded = chordNames.length * 2; // 2 beats each
    const lastBeat = section.totalBeats;
    const startBeat = Math.max(0, lastBeat - totalNeeded);

    // Remove chords that overlap with turnaround area
    section.chords = section.chords.filter(c => c.startBeat + c.durationBeats <= startBeat);

    // Add turnaround chords
    chordNames.forEach((ch, i) => {
      section.chords.push({
        chord: ch,
        voicingIndex: 0,
        startBeat: startBeat + i * 2,
        durationBeats: 2,
      });
    });

    App.emit('songChanged');
    Timeline.render();
    refresh();
  }

  function suggestApproachChords(sIdx) {
    const section = App.state.sections[sIdx];
    if (!section || section.chords.length === 0) return [];
    const suggestions = [];

    section.chords.forEach((c, i) => {
      const root = getChordRoot(c.chord);
      const rootIdx = Theory.KEYS.indexOf(root);
      if (rootIdx < 0) return;

      // Chromatic from below
      const belowRoot = Theory.KEYS[(rootIdx - 1 + 12) % 12];
      const belowChord = belowRoot + '7';
      suggestions.push({
        type: 'approach-chord',
        label: 'Add ' + Theory.displayChord(belowChord) + ' before ' + Theory.displayChord(c.chord),
        detail: 'Chromatic approach from below (half-step resolution)',
        chords: [belowChord],
        target: { sectionIndex: sIdx, insertAfterChordIndex: i > 0 ? i - 1 : null, replaceChordIndex: null },
        apply: function() {
          if (i > 0) { applyPassingChord(sIdx, i - 1, belowChord); }
          else { applyPrependChord(sIdx, belowChord); }
        },
      });

      // Chromatic from above
      const aboveRoot = Theory.KEYS[(rootIdx + 1) % 12];
      const aboveChord = aboveRoot + '7';
      suggestions.push({
        type: 'approach-chord',
        label: 'Add ' + Theory.displayChord(aboveChord) + ' before ' + Theory.displayChord(c.chord),
        detail: 'Chromatic approach from above',
        chords: [aboveChord],
        target: { sectionIndex: sIdx, insertAfterChordIndex: i > 0 ? i - 1 : null, replaceChordIndex: null },
        apply: function() {
          if (i > 0) { applyPassingChord(sIdx, i - 1, aboveChord); }
          else { applyPrependChord(sIdx, aboveChord); }
        },
      });
    });

    return suggestions;
  }

  function applyPrependChord(sIdx, chordName) {
    const section = App.state.sections[sIdx];
    if (!section) return;
    // Shift all chords right by 2 beats, insert at start
    section.chords.forEach(c => { c.startBeat += 2; });
    section.totalBeats += 2;
    section.chords.unshift({
      chord: chordName,
      voicingIndex: 0,
      startBeat: 0,
      durationBeats: 2,
    });
    App.emit('songChanged');
    Timeline.render();
    refresh();
  }

  // =============================================
  // Visualizations
  // =============================================

  function renderFunctionTimeline(analysis) {
    const container = document.getElementById('theory-function-timeline');
    if (!container) return;
    container.innerHTML = '';

    if (!analysis || analysis.chords.length === 0) {
      container.innerHTML = '<div class="theory-empty">No chords in this section</div>';
      return;
    }

    const totalBeats = analysis.chords.reduce((sum, c) => sum + (c.durationBeats || 4), 0);
    const bar = document.createElement('div');
    bar.className = 'func-timeline-bar';

    analysis.chords.forEach(c => {
      const block = document.createElement('div');
      block.className = 'func-timeline-block';
      const pct = ((c.durationBeats || 4) / totalBeats) * 100;
      block.style.width = pct + '%';
      block.style.backgroundColor = FUNC_COLORS[c.function] || FUNC_COLORS.chromatic;
      if (c.function === 'borrowed' || c.function === 'chromatic') {
        block.style.borderStyle = 'dashed';
      }
      block.textContent = c.numeral;
      block.title = Theory.displayChord(c.chord) + ' (' + c.function + ')';
      bar.appendChild(block);
    });

    container.appendChild(bar);
  }

  function renderNumerals(analysis) {
    const container = document.getElementById('theory-numerals');
    if (!container) return;
    container.innerHTML = '';

    if (!analysis) return;

    if (analysis.chords.length === 0) {
      // Show diatonic chords as suggestions
      const diatonic = Theory.getDiatonicChords(analysis.key, analysis.mode);
      const row = document.createElement('div');
      row.className = 'theory-numeral-row';
      diatonic.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'theory-numeral-item suggested';
        item.innerHTML = '<span class="numeral-symbol">' + ch.numeral + '</span><span class="numeral-chord">' + Theory.displayChord(ch.triad) + '</span>';
        row.appendChild(item);
      });
      container.appendChild(row);
      return;
    }

    const row = document.createElement('div');
    row.className = 'theory-numeral-row';

    analysis.chords.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'theory-numeral-item';
      item.dataset.function = c.function;
      item.style.borderColor = FUNC_COLORS[c.function] || FUNC_COLORS.chromatic;
      if (c.function === 'borrowed' || c.function === 'chromatic') {
        item.style.borderStyle = 'dashed';
      }

      item.innerHTML = '<span class="numeral-symbol">' + c.numeral + '</span><span class="numeral-chord">' + Theory.displayChord(c.chord) + '</span>';

      // Click to select chord in timeline
      item.addEventListener('click', () => {
        App.state.selectedChord = c.chord;
        App.emit('chordSelected', c.chord);
      });
      item.style.cursor = 'pointer';

      row.appendChild(item);
    });

    container.appendChild(row);

    // Pattern name
    if (analysis.patternName) {
      const patLabel = document.createElement('div');
      patLabel.className = 'theory-pattern-label';
      patLabel.textContent = '\u266b ' + analysis.patternName;
      container.appendChild(patLabel);
    }
  }

  function renderCircle(containerId, key, mode, chordObjs) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const size = 280;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = 115;
    const innerR = 76;

    const scaleNotes = Theory.getScaleNotes(key, mode);
    const usedChordNames = new Set();
    const chordFunctions = {};
    (chordObjs || []).forEach(c => {
      usedChordNames.add(c.chord);
      chordFunctions[c.chord] = c.function || Theory.classifyChordFunction(key, mode, c.chord);
    });

    let svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">';

    // Diatonic arc shading
    const firstScaleIdx = CIRCLE_OF_FIFTHS.indexOf(scaleNotes[0]);
    if (firstScaleIdx >= 0) {
      // Find contiguous arc of diatonic notes on circle
      const diatonicIndices = scaleNotes.map(n => CIRCLE_OF_FIFTHS.indexOf(n)).filter(i => i >= 0).sort((a, b) => a - b);
      if (diatonicIndices.length >= 3) {
        const minAngle = (Math.min(...diatonicIndices) * 30 - 105) * Math.PI / 180;
        const maxAngle = (Math.max(...diatonicIndices) * 30 - 75) * Math.PI / 180;
        const x1 = cx + Math.cos(minAngle) * (outerR + 8);
        const y1 = cy + Math.sin(minAngle) * (outerR + 8);
        const x2 = cx + Math.cos(maxAngle) * (outerR + 8);
        const y2 = cy + Math.sin(maxAngle) * (outerR + 8);
        const largeArc = (maxAngle - minAngle > Math.PI) ? 1 : 0;
        svg += '<path d="M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + (outerR + 8) + ' ' + (outerR + 8) + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="rgba(42,157,143,0.08)" stroke="none"/>';
      }
    }

    // Rings
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + outerR + '" fill="none" stroke="var(--border)" stroke-width="1.5"/>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + innerR + '" fill="none" stroke="var(--border)" stroke-width="1"/>';

    // Chord path arrows
    const positions = [];
    (chordObjs || []).forEach(c => {
      const base = c.chord.replace(/(m7b5|maj7|m7|7|sus2|sus4|add9)$/, '');
      const isMinor = base.endsWith('m') || base.endsWith('dim');
      const noteRoot = isMinor ? base.replace(/(m|dim)$/, '') : base;
      const idx = CIRCLE_OF_FIFTHS.indexOf(noteRoot);
      if (idx >= 0) {
        const r = isMinor ? innerR : outerR;
        const angle = (idx * 30 - 90) * Math.PI / 180;
        positions.push({ x: cx + Math.cos(angle) * (r - 12), y: cy + Math.sin(angle) * (r - 12), idx: positions.length });
      }
    });

    if (positions.length > 1) {
      let pathD = 'M ' + positions[0].x + ' ' + positions[0].y;
      for (let i = 1; i < positions.length; i++) {
        pathD += ' L ' + positions[i].x + ' ' + positions[i].y;
      }
      svg += '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>';

      // Numbered labels on path
      positions.forEach((p, i) => {
        svg += '<circle cx="' + (p.x) + '" cy="' + (p.y - 18) + '" r="8" fill="var(--bg-surface)" stroke="var(--accent)" stroke-width="1"/>';
        svg += '<text x="' + (p.x) + '" y="' + (p.y - 18) + '" text-anchor="middle" dominant-baseline="central" fill="var(--accent)" font-size="9" font-weight="700">' + (i + 1) + '</text>';
      });
    }

    function nodeStyle(note, isMinor) {
      const chordName = isMinor ? note + 'm' : note;
      const isInScale = scaleNotes.includes(note);
      const isUsed = isMinor
        ? usedChordNames.has(note + 'm') || usedChordNames.has(note + 'm7')
        : usedChordNames.has(note) || usedChordNames.has(note + '7') || usedChordNames.has(note + 'maj7');
      const isRoot = note === key;

      const fn = chordFunctions[chordName] || chordFunctions[note] || null;
      const nodeR = isUsed ? 16 : (isInScale ? 12 : 9);
      let fill = 'var(--bg-card)';
      let stroke = 'var(--border)';
      let textColor = 'var(--text-muted)';
      let fontWeight = '400';
      let fontSize = isMinor ? '9' : '11';

      if (isRoot && ((mode === 'minor' && isMinor) || (mode !== 'minor' && !isMinor))) {
        fill = FUNC_COLORS.tonic;
        stroke = FUNC_COLORS.tonic;
        textColor = '#fff';
        fontWeight = '700';
      } else if (isUsed && fn) {
        fill = FUNC_COLORS[fn] + '40';
        stroke = FUNC_COLORS[fn];
        textColor = 'var(--text)';
        fontWeight = '600';
      } else if (isUsed) {
        fill = 'rgba(233,69,96,0.25)';
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

    // Outer ring: major chords (clickable)
    CIRCLE_OF_FIFTHS.forEach((note, i) => {
      const angle = (i * 30 - 90) * Math.PI / 180;
      const x = cx + Math.cos(angle) * outerR;
      const y = cy + Math.sin(angle) * outerR;
      const s = nodeStyle(note, false);
      const displayName = Theory.displayNote(note);

      svg += '<circle cx="' + x + '" cy="' + y + '" r="' + s.nodeR + '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.5" class="circle-node" data-chord="' + note + '" style="cursor:pointer"/>';
      svg += '<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="central" fill="' + s.textColor + '" font-size="' + s.fontSize + '" font-weight="' + s.fontWeight + '" font-family="inherit" class="circle-node-text" data-chord="' + note + '" style="cursor:pointer;pointer-events:none">' + displayName + '</text>';
    });

    // Inner ring: minor chords (clickable)
    CIRCLE_MINORS.forEach((minorChord, i) => {
      const angle = (i * 30 - 90) * Math.PI / 180;
      const x = cx + Math.cos(angle) * innerR;
      const y = cy + Math.sin(angle) * innerR;
      const note = minorChord.replace('m', '');
      const s = nodeStyle(note, true);
      const displayName = Theory.displayChord(minorChord);

      svg += '<circle cx="' + x + '" cy="' + y + '" r="' + s.nodeR + '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.5" class="circle-node" data-chord="' + minorChord + '" style="cursor:pointer"/>';
      svg += '<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="central" fill="' + s.textColor + '" font-size="' + s.fontSize + '" font-weight="' + s.fontWeight + '" font-family="inherit" class="circle-node-text" data-chord="' + minorChord + '" style="cursor:pointer;pointer-events:none">' + displayName + '</text>';
    });

    // Center label
    svg += '<text x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="inherit">' + Theory.displayNote(key) + '</text>';
    svg += '<text x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="inherit">' + mode + '</text>';

    svg += '</svg>';
    container.innerHTML = svg;

    // Add click handlers to circle nodes
    container.querySelectorAll('.circle-node').forEach(node => {
      node.addEventListener('click', () => {
        const chord = node.dataset.chord;
        if (chord) {
          App.state.selectedChord = chord;
          App.state.selectedVoicingIndex = 0;
          App.emit('chordSelected', chord);
          if (typeof Controls !== 'undefined') Controls.showChordDetail(chord);
        }
      });
    });
  }

  // =============================================
  // Suggestions UI
  // =============================================

  function gatherSuggestions() {
    const suggestions = [];

    if (currentScope === 'section' && currentSectionIdx >= 0) {
      suggestions.push(...suggestSubstitutions(currentSectionIdx));
      suggestions.push(...suggestPassingChords(currentSectionIdx));
      suggestions.push(...suggestTurnarounds(currentSectionIdx));
      suggestions.push(...suggestApproachChords(currentSectionIdx));
    }

    if (currentScope === 'song') {
      suggestions.push(...suggestNewSections());
      suggestions.push(...suggestModulations());
    }

    // Sort by how commonly used in music (most common first)
    const TYPE_PRIORITY = {
      'substitution': 0,
      'passing-chord': 1,
      'turnaround': 2,
      'new-section': 3,
      'approach-chord': 4,
      'modulation': 5,
    };
    suggestions.sort((a, b) => (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9));

    return suggestions;
  }

  function renderSuggestions() {
    const list = document.getElementById('theory-suggestion-list');
    if (!list) return;
    list.innerHTML = '';

    const suggestions = gatherSuggestions();
    const filtered = currentSugFilter === 'all'
      ? suggestions
      : suggestions.filter(s => s.type === currentSugFilter);

    if (filtered.length === 0) {
      list.innerHTML = '<div class="theory-empty">No suggestions for current selection</div>';
      return;
    }

    filtered.forEach(sug => {
      const card = document.createElement('div');
      card.className = 'theory-suggestion-card';
      card.dataset.type = sug.type;

      const header = document.createElement('div');
      header.className = 'suggestion-header';

      const badge = document.createElement('span');
      badge.className = 'suggestion-type-badge';
      badge.dataset.type = sug.type;
      badge.textContent = sug.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      const label = document.createElement('span');
      label.className = 'suggestion-label';
      label.textContent = sug.label;

      header.append(badge, label);

      const detail = document.createElement('div');
      detail.className = 'suggestion-detail';
      detail.textContent = sug.detail;

      const chordsDiv = document.createElement('div');
      chordsDiv.className = 'suggestion-chords';
      sug.chords.forEach(ch => {
        const chip = document.createElement('span');
        chip.className = 'suggestion-chord-chip';
        chip.textContent = Theory.displayChord(ch);
        chordsDiv.appendChild(chip);
      });

      const applyBtn = document.createElement('button');
      applyBtn.className = 'suggestion-apply-btn';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => {
        sug.apply();
      });

      card.append(header, detail, chordsDiv, applyBtn);
      list.appendChild(card);
    });
  }

  // =============================================
  // UI: Toggle, Scope, Rendering
  // =============================================

  function toggle() {
    const panel = document.getElementById('theory-panel');
    if (!panel) return;
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('btn-toggle-theory');
    if (btn) {
      btn.textContent = panel.classList.contains('collapsed') ? 'Theory Analysis \u25be' : 'Theory Analysis \u25b4';
    }
  }

  function setScope(scope) {
    currentScope = scope;
    document.querySelectorAll('.theory-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.scope === scope);
    });
    const sView = document.getElementById('theory-section-view');
    const fView = document.getElementById('theory-song-view');
    if (sView) sView.style.display = scope === 'section' ? '' : 'none';
    if (fView) fView.style.display = scope === 'song' ? '' : 'none';
    refresh();
  }

  function refresh() {
    if (currentScope === 'section') {
      renderSectionView();
    } else {
      renderSongView();
    }
    renderSuggestions();
  }

  function renderSectionView() {
    const labelEl = document.querySelector('.theory-section-label');

    if (currentSectionIdx < 0 || !App.state.sections[currentSectionIdx]) {
      if (labelEl) labelEl.textContent = 'Click a section header to analyze.';
      const ft = document.getElementById('theory-function-timeline');
      if (ft) ft.innerHTML = '';
      const tn = document.getElementById('theory-numerals');
      if (tn) tn.innerHTML = '';
      const tc = document.getElementById('theory-circle');
      if (tc) tc.innerHTML = '';
      return;
    }

    const analysis = analyzeSectionHarmony(currentSectionIdx);
    if (!analysis) return;

    if (labelEl) labelEl.textContent = analysis.sectionName + ' \u2014 ' + Theory.displayNote(analysis.key) + ' ' + analysis.mode;

    renderFunctionTimeline(analysis);
    renderNumerals(analysis);
    renderCircle('theory-circle', analysis.key, analysis.mode, analysis.chords);
  }

  function renderSongView() {
    const summary = document.getElementById('theory-song-summary');
    const circle = document.getElementById('theory-song-circle');
    if (!summary) return;

    const song = analyzeFullSong();

    let html = '<div class="theory-song-arc"><strong>Harmonic Arc:</strong> ' + song.harmonicArc + '</div>';

    song.sections.forEach(s => {
      if (s.patternName) {
        html += '<div class="theory-song-pattern">' + s.sectionName + ': <span class="theory-pattern-label">\u266b ' + s.patternName + '</span></div>';
      }
    });

    summary.innerHTML = html;

    // Aggregate all chord objects for circle
    const allChords = [];
    song.sections.forEach(s => allChords.push(...s.chords));
    renderCircle('theory-song-circle', App.state.key, App.state.mode, allChords);
  }

  // =============================================
  // Event Setup
  // =============================================

  function init() {
    // Toggle button
    const toggleBtn = document.getElementById('btn-toggle-theory');
    if (toggleBtn) toggleBtn.addEventListener('click', toggle);

    // Scope tabs
    document.querySelectorAll('.theory-tab').forEach(tab => {
      tab.addEventListener('click', () => setScope(tab.dataset.scope));
    });

    // Suggestion filter tabs
    document.querySelectorAll('.sug-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentSugFilter = tab.dataset.type;
        document.querySelectorAll('.sug-tab').forEach(t => t.classList.toggle('active', t === tab));
        renderSuggestions();
      });
    });

    // Events
    App.on('sectionSelected', (data) => {
      currentSectionIdx = data.sectionIndex;
      if (currentScope === 'section') refresh();
    });

    App.on('songChanged', () => refresh());
    App.on('stateLoaded', () => { currentSectionIdx = -1; refresh(); });
    App.on('keyModeChanged', () => refresh());
  }

  return { init };
})();
