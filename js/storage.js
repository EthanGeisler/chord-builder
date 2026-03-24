// === Chord Builder — Save/Load & Export/Import ===

const Storage = (() => {
  const AUTOSAVE_KEY = 'chord-builder-autosave';
  const PROJECTS_KEY = 'chord-builder-projects';
  const BACKUP_URL = 'http://localhost:3001';

  function init() {
    // Try to restore autosave
    restoreAutoSave();

    // Auto-save on any change
    App.on('songChanged', autoSave);

    // Button handlers
    document.getElementById('btn-new').addEventListener('click', newProject);
    document.getElementById('btn-save-as').addEventListener('click', saveAs);
    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', importJSON);

    // Populate load dropdown
    populateLoadDropdown();
    document.getElementById('load-select').addEventListener('change', loadProject);
  }

  function autoSave() {
    try {
      const data = App.serialize();
      localStorage.setItem(AUTOSAVE_KEY, data);
      // Also backup to disk via proxy
      backupToDisk(App.state.projectName || 'autosave', data);
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  function backupToDisk(name, data) {
    fetch(BACKUP_URL + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    }).catch(() => {}); // silent fail — disk backup is best-effort
  }

  function restoreAutoSave() {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        App.deserialize(saved);
        console.log('Restored auto-save');
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore auto-save:', e);
    }
    return false;
  }

  function getProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveProjects(projects) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  function populateLoadDropdown() {
    const sel = document.getElementById('load-select');
    // Clear all but first option
    while (sel.options.length > 1) sel.remove(1);

    const projects = getProjects();
    Object.keys(projects).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  function saveAs() {
    // Show modal for project name
    const name = prompt('Project name:', App.state.projectName);
    if (!name) return;

    App.state.projectName = name;
    const data = App.serialize();
    const projects = getProjects();
    projects[name] = data;
    saveProjects(projects);
    autoSave();
    populateLoadDropdown();
    backupToDisk(name, data);
  }

  function loadProject() {
    const sel = document.getElementById('load-select');
    const name = sel.value;
    if (!name) return;

    const projects = getProjects();
    if (projects[name]) {
      App.deserialize(projects[name]);
      Timeline.render();
      Controls.renderPalette();
    }
    sel.value = '';
  }

  function newProject() {
    if (!confirm('Start a new project? Unsaved changes will be lost.')) return;

    App.state.key = 'C';
    App.state.mode = 'major';
    App.state.capo = 0;
    App.state.bpm = 120;
    App.state.timeSignature = '4/4';
    App.state.projectName = 'Untitled';
    App.state.selectedSlot = null;
    App.state.selectedChord = null;
    App.state.selectedVoicingIndex = 0;
    App.initDefaultSong();
    App.emit('stateLoaded');
    Timeline.render();
    Controls.renderPalette();
    autoSave();
  }

  function exportJSON() {
    const data = App.serialize();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (App.state.projectName || 'untitled') + '.chord-builder.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        App.deserialize(evt.target.result);
        Timeline.render();
        Controls.renderPalette();
        autoSave();
      } catch (err) {
        alert('Failed to import file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  }

  return { init };
})();


// ============================================
// === MAIN INITIALIZATION ===
// ============================================

(async function main() {
  // Verify CDN libraries loaded
  console.log('Tonal.js loaded:', typeof Tonal !== 'undefined');
  console.log('SVGuitar loaded:', typeof svguitar !== 'undefined');
  console.log('Tone.js loaded:', typeof Tone !== 'undefined');

  // Load chord voicings database
  await ChordsDB.load();

  // Initialize default song if no autosave
  if (!App.state.sections || App.state.sections.length === 0) {
    App.initDefaultSong();
  }

  // Initialize all modules
  Controls.init();
  Timeline.init();
  AudioEngine.init();
  Importer.init();
  Storage.init();
  History.init();

  console.log('Chord Builder initialized.');
})();
