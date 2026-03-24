// === Chord Builder — Chord Progression Templates ===

const Templates = (() => {
  const PROGRESSION_TEMPLATES = {
    'pop-1564': {
      name: 'I-V-vi-IV (Pop)',
      degrees: [1, 5, 6, 4],
      beatsPerChord: 4,
      totalBeats: 16,
      defaultStamp: 'down-up',
    },
    'blues-12bar': {
      name: '12-Bar Blues',
      degrees: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5],
      beatsPerChord: 4,
      totalBeats: 48,
      defaultStamp: 'all-down',
      chordType: '7',
    },
    'jazz-251': {
      name: 'ii-V-I (Jazz)',
      degrees: [2, 5, 1],
      beatsPerChord: 4,
      totalBeats: 12,
      defaultStamp: null,
      chordType: '7th',
    },
    'folk-1454': {
      name: 'I-IV-V-IV (Folk)',
      degrees: [1, 4, 5, 4],
      beatsPerChord: 4,
      totalBeats: 16,
      defaultStamp: 'travis-full',
    },
    'minor-1-6-3-7': {
      name: 'i-VI-III-VII (Minor)',
      degrees: [1, 6, 3, 7],
      beatsPerChord: 4,
      totalBeats: 16,
      defaultStamp: 'down-up',
    },
    'canon': {
      name: 'I-V-vi-iii-IV-I-IV-V',
      degrees: [1, 5, 6, 3, 4, 1, 4, 5],
      beatsPerChord: 4,
      totalBeats: 32,
      defaultStamp: 'pima-full',
    },
    'andalusian': {
      name: 'i-VII-VI-V (Andalusian)',
      degrees: [1, 7, 6, 5],
      beatsPerChord: 4,
      totalBeats: 16,
      defaultStamp: null,
    },
  };

  function applyTemplate(templateKey, sectionIdx) {
    const template = PROGRESSION_TEMPLATES[templateKey];
    if (!template) return;

    const diatonic = Theory.getDiatonicChords(App.state.key, App.state.mode);

    const chords = [];
    template.degrees.forEach((deg, i) => {
      const dc = diatonic[deg - 1];
      let chordName;

      if (template.chordType === '7') {
        // Blues: dominant 7th (root + '7')
        chordName = dc.root + '7';
      } else if (template.chordType === '7th') {
        // Jazz: diatonic seventh quality
        chordName = dc.seventh;
      } else {
        // Default: triad
        chordName = dc.triad;
      }

      chords.push({
        chord: chordName,
        voicingIndex: 0,
        startBeat: i * template.beatsPerChord,
        durationBeats: template.beatsPerChord,
      });
    });

    const section = App.state.sections[sectionIdx];
    section.chords = chords;
    section.totalBeats = template.totalBeats;
    section.gridState = {};

    // Stamp default pattern if specified
    if (template.defaultStamp && Tablature.STAMP_PRESETS[template.defaultStamp]) {
      const subdiv = section.subdivisions || 2;
      chords.forEach(c => {
        const startCol = c.startBeat * subdiv;
        const numCols = c.durationBeats * subdiv;
        Tablature.stampPresetToGrid(template.defaultStamp, startCol, numCols, subdiv, section.gridState);
      });
    }

    App.emit('songChanged');
  }

  function getTemplateList() {
    return Object.keys(PROGRESSION_TEMPLATES).map(key => ({
      key,
      name: PROGRESSION_TEMPLATES[key].name,
    }));
  }

  function showTemplatePicker(buttonEl) {
    // Remove any existing picker
    const existing = document.querySelector('.template-picker');
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.className = 'template-picker';

    getTemplateList().forEach(t => {
      const item = document.createElement('div');
      item.className = 'template-picker-item';
      item.textContent = t.name;
      item.addEventListener('click', () => {
        picker.remove();
        handleTemplateSelect(t.key);
      });
      picker.appendChild(item);
    });

    // Position below button
    const rect = buttonEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = rect.left + 'px';
    picker.style.zIndex = '9999';

    document.body.appendChild(picker);

    // Close on outside click
    const closeHandler = (e) => {
      if (!picker.contains(e.target) && e.target !== buttonEl) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  function handleTemplateSelect(templateKey) {
    const selectedIdx = Timeline.getSelectedSectionIdx();

    if (selectedIdx >= 0) {
      const section = App.state.sections[selectedIdx];
      const hasContent = section.chords.length > 0 || Object.keys(section.gridState || {}).length > 0;
      if (hasContent) {
        if (!confirm('Replace existing content in "' + section.name + '"?')) return;
      }
      applyTemplate(templateKey, selectedIdx);
    } else {
      // Create new section
      const newIdx = App.state.sections.length;
      App.state.sections.push({
        name: 'Section ' + (newIdx + 1),
        totalBeats: 16,
        subdivisions: 2,
        chords: [],
        gridState: {},
        dynamics: 'mf',
      });
      applyTemplate(templateKey, newIdx);
    }

    Timeline.render();
  }

  function init() {
    const btn = document.getElementById('btn-templates');
    if (btn) {
      btn.addEventListener('click', () => showTemplatePicker(btn));
    }
  }

  return {
    init,
    applyTemplate,
    getTemplateList,
    PROGRESSION_TEMPLATES,
  };
})();
