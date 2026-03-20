// === Chord Builder — SVGuitar Diagram Rendering ===

const Diagrams = (() => {

  // Render a chord diagram into a container element
  // voicing: { positions, fingers, barres, baseFret, label }
  // options: { width, height } for sizing
  function render(container, voicing, options = {}) {
    if (!voicing || !container) return;

    container.innerHTML = '';

    const width = options.width || container.clientWidth || 200;
    const height = options.height || container.clientHeight || 220;

    // Build SVGuitar config
    const chart = new svguitar.SVGuitarChord(container);

    const fingers = [];
    const barres = [];
    let tuning = [];

    // Convert positions array to SVGuitar format
    // SVGuitar strings: 1 = high E (rightmost), 6 = low E (leftmost)
    // Our positions: index 0 = low E (6th string), index 5 = high E (1st string)
    if (voicing.positions) {
      voicing.positions.forEach((fret, idx) => {
        const stringNum = 6 - idx; // Convert: idx 0 → string 6, idx 5 → string 1
        if (fret > 0) {
          const relativeFret = fret - (voicing.baseFret || 1) + 1;
          const finger = voicing.fingers ? voicing.fingers[idx] : undefined;
          if (finger && finger > 0) {
            fingers.push([stringNum, relativeFret, { text: String(finger) }]);
          } else {
            fingers.push([stringNum, relativeFret]);
          }
        }
      });

      // Build tuning array for open/muted strings
      // SVGuitar tuning goes from string 6 (leftmost) to string 1 (rightmost)
      for (let i = 0; i < 6; i++) {
        const fret = voicing.positions[i];
        if (fret === -1) {
          tuning.push('x');
        } else if (fret === 0) {
          tuning.push('o');
        } else {
          tuning.push('');
        }
      }
    }

    // Convert barres
    if (voicing.barres) {
      voicing.barres.forEach(b => {
        barres.push({
          fromString: b.fromString,
          toString: b.toString,
          fret: b.fret - (voicing.baseFret || 1) + 1,
        });
      });
    }

    const position = (voicing.baseFret || 1) > 1 ? voicing.baseFret : undefined;

    chart
      .configure({
        strings: 6,
        frets: 5,
        position: position,
        tuning: tuning,
        fretSize: 1.5,
        fingerSize: 0.6,
        fingerTextSize: 10,
        fingerColor: '#e94560',
        fingerTextColor: '#fff',
        barreChordRadius: 0.3,
        stringColor: '#8892a4',
        fretColor: '#8892a4',
        nutColor: '#e0e0e0',
        nutWidth: position ? 0 : 5,
        titleColor: '#e0e0e0',
        backgroundColor: 'transparent',
        fontFamily: 'system-ui, sans-serif',
        fixedDiagramPosition: true,
      })
      .chord({
        fingers: fingers,
        barres: barres,
      })
      .draw();
  }

  // Render a mini version for palette/timeline slots
  function renderMini(container, voicing) {
    render(container, voicing, { width: 60, height: 55 });
  }

  return { render, renderMini };
})();
