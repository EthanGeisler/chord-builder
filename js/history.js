// === Chord Builder — Undo/Redo History ===

const History = (() => {
  const MAX_STACK = 100;
  const stack = [];    // array of serialized state snapshots
  let pointer = -1;    // index into stack
  let restoring = false; // guard: true while applying undo/redo

  function snapshot() {
    if (restoring) return;
    // Trim any future states after pointer
    stack.length = pointer + 1;
    stack.push(App.serialize());
    if (stack.length > MAX_STACK) stack.shift();
    pointer = stack.length - 1;
    updateButtons();
  }

  function undo() {
    if (pointer <= 0) return;
    pointer--;
    restore();
  }

  function redo() {
    if (pointer >= stack.length - 1) return;
    pointer++;
    restore();
  }

  function restore() {
    restoring = true;
    App.deserialize(stack[pointer]);
    restoring = false;
    updateButtons();
  }

  function updateButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = pointer <= 0;
    if (redoBtn) redoBtn.disabled = pointer >= stack.length - 1;
  }

  function init() {
    // Take initial snapshot
    snapshot();

    // Snapshot on every song change
    App.on('songChanged', snapshot);

    // Wire up buttons
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Skip if user is typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
      }
    });

    // On project load/new, reset history
    App.on('stateLoaded', () => {
      if (restoring) return;
      stack.length = 0;
      pointer = -1;
      snapshot();
    });

    updateButtons();
  }

  return { init, undo, redo };
})();
