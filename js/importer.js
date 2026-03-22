// === Chord Builder — Tab/Chord Scraping & Import System ===
// Search: Genius API (public, no auth)
// Chord data: Ultimate Guitar → GuitarTabs.cc → CifraClub (fallback chain)

const Importer = (() => {
  const PROXY = 'http://localhost:3001/fetch?url=';

  let modal = null;
  let currentResults = [];
  let previewData = null;

  // ── Modal UI ──────────────────────────────────────────

  function createModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay importer-overlay';
    overlay.innerHTML = `
      <div class="modal importer-modal">
        <div class="importer-header">
          <h3>Import Tab</h3>
          <button class="importer-close">&times;</button>
        </div>
        <div class="importer-search-row">
          <input type="text" id="importer-query" placeholder="Search song name or artist..." />
          <button id="importer-search-btn" class="btn-primary">Search</button>
        </div>
        <div id="importer-status" class="importer-status"></div>
        <div id="importer-results" class="importer-results"></div>
        <div id="importer-preview" class="importer-preview" style="display:none">
          <div class="importer-preview-header">
            <button id="importer-back">&larr; Back</button>
            <div id="importer-preview-title"></div>
            <button id="importer-import-btn" class="btn-primary">Import</button>
          </div>
          <div id="importer-preview-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    modal = overlay;

    overlay.querySelector('.importer-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#importer-search-btn').addEventListener('click', doSearch);
    overlay.querySelector('#importer-query').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
    overlay.querySelector('#importer-back').addEventListener('click', showResults);
    overlay.querySelector('#importer-import-btn').addEventListener('click', doImport);
  }

  function open() {
    if (!modal) createModal();
    modal.style.display = 'flex';
    modal.querySelector('#importer-query').focus();
    modal.querySelector('#importer-results').style.display = '';
    modal.querySelector('#importer-preview').style.display = 'none';
    modal.querySelector('#importer-status').textContent = '';
  }

  function close() {
    if (modal) modal.style.display = 'none';
  }

  function showResults() {
    modal.querySelector('#importer-results').style.display = '';
    modal.querySelector('#importer-preview').style.display = 'none';
  }

  function setStatus(msg) {
    modal.querySelector('#importer-status').textContent = msg;
  }

  // ── Helpers ──────────────────────────────────────────

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Proxy Fetch Helper ────────────────────────────────

  async function proxyFetch(url) {
    const resp = await fetch(PROXY + encodeURIComponent(url));
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || 'Fetch failed');
    }
    return resp.text();
  }

  // ── Search via Genius API ─────────────────────────────

  async function doSearch() {
    const query = modal.querySelector('#importer-query').value.trim();
    if (!query) return;

    setStatus('Searching...');
    const resultsDiv = modal.querySelector('#importer-results');
    resultsDiv.innerHTML = '';
    currentResults = [];

    try {
      // Genius API — public search, no auth needed
      const geniusUrl = `https://genius.com/api/search/song?q=${encodeURIComponent(query)}`;
      const text = await proxyFetch(geniusUrl);
      const data = JSON.parse(text);

      const hits = data?.response?.sections?.[0]?.hits || [];

      // Filter out translations and non-English covers
      const translationPattern = /Çeviri|Tradução|Traduction|Перевод|翻訳|번역|Terjemahan|Oversættelse|Traducción/i;
      const titleLangPattern = /\((Türkçe|Português|Français|Deutsch|Español|Italiano|Русский|日本語|한국어|中文|العربية|हिन्दी)\s*(Çeviri|Tradução|Traduction)?\)/i;

      currentResults = hits
        .filter(hit => {
          const r = hit.result;
          const artist = r.primary_artist?.name || '';
          const title = r.full_title || r.title || '';
          // Skip if artist name suggests a translation account
          if (translationPattern.test(artist)) return false;
          if (/^Genius\s/.test(artist) && translationPattern.test(title)) return false;
          // Skip if title has a non-English language marker
          if (titleLangPattern.test(title)) return false;
          return true;
        })
        .slice(0, 15)
        .map(hit => {
          const r = hit.result;
          return {
            title: r.title || 'Unknown',
            artist: r.primary_artist?.name || r.artist_names || 'Unknown',
            thumbnail: r.song_art_image_thumbnail_url || null,
            geniusPath: r.path || null,
          };
        });

      if (!currentResults.length) {
        setStatus('No results found. Try a different search term.');
        return;
      }

      setStatus(`Found ${currentResults.length} result(s) — click to load chords`);
      renderResults();
    } catch (err) {
      setStatus('Search failed: ' + err.message);
      console.error('Search error:', err);
    }
  }

  // ── Results Rendering ─────────────────────────────────

  function renderResults() {
    const div = modal.querySelector('#importer-results');
    div.innerHTML = '';

    for (let i = 0; i < currentResults.length; i++) {
      const r = currentResults[i];
      const el = document.createElement('div');
      el.className = 'importer-result-item';
      el.innerHTML = `
        ${r.thumbnail ? `<img class="result-thumb" src="${escapeHtml(r.thumbnail)}" />` : ''}
        <span class="result-title">${escapeHtml(r.title)}</span>
        <span class="result-artist">${escapeHtml(r.artist)}</span>
        <span class="site-badge" style="background:#4fc3f7">Multi-source</span>
      `;
      el.addEventListener('click', () => loadPreview(i));
      div.appendChild(el);
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ── Ultimate Guitar Search + Parser ──────────────────

  async function searchUG(artist, title) {
    // Search UG for chord tabs matching this artist + title
    const query = `${artist} ${title}`;
    const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}&type=Chords`;
    const html = await proxyFetch(searchUrl);

    // UG stores data in a js-store div with JSON in data-content attribute
    const storeMatch = html.match(/class="js-store"\s+data-content="([^"]+)"/);
    if (!storeMatch) return null;

    const decoded = storeMatch[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    let storeData;
    try { storeData = JSON.parse(decoded); } catch { return null; }

    // Navigate to search results
    const results = storeData?.store?.page?.data?.results || [];
    // Filter for chord tabs only, prefer highest rating
    const chordTabs = results
      .filter(r => r.type === 'Chords' && r.tab_url)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));

    if (!chordTabs.length) return null;

    // Return the best match URL
    return chordTabs[0].tab_url;
  }

  async function fetchUGChords(tabUrl, title, artist) {
    await delay(1100); // respect proxy per-domain throttle
    const html = await proxyFetch(tabUrl);

    const storeMatch = html.match(/class="js-store"\s+data-content="([^"]+)"/);
    if (!storeMatch) return null;

    const decoded = storeMatch[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    let storeData;
    try { storeData = JSON.parse(decoded); } catch { return null; }

    const tabView = storeData?.store?.page?.data?.tab_view;
    if (!tabView) return null;

    const content = tabView?.wiki_tab?.content;
    if (!content) return null;

    const meta = tabView?.meta || {};
    const capo = meta.capo || 0;

    return parseUGContent(content, title, artist, capo);
  }

  function parseUGContent(content, title, artist, capo) {
    const normalized = {
      title, artist,
      key: null, capo: capo || 0, bpm: null,
      timeSignature: null, sections: [],
      strumPattern: null, source: 'ultimate-guitar',
    };

    // UG format: [ch]Chord[/ch] for chords, [tab]...[/tab] for tab blocks
    // Section headers like [Verse], [Chorus] etc.

    // Remove tab blocks (fingerpicking notation)
    const cleaned = content.replace(/\[tab\][\s\S]*?\[\/tab\]/gi, '');

    // Split into lines
    const lines = cleaned.split('\n');

    let currentSection = { name: 'Intro', lines: [] };

    function isChordLine(line) {
      // A chord line has [ch]...[/ch] markers and mostly whitespace otherwise
      if (!/\[ch\]/.test(line)) return false;
      const withoutChords = line.replace(/\[ch\][^\[]*\[\/ch\]/g, '');
      return /^\s*$/.test(withoutChords.trim());
    }

    function extractChords(line) {
      const chords = [];
      const regex = /\[ch\]([^\[]*)\[\/ch\]/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        const chord = m[1].trim();
        if (chord && /^[A-G]/.test(chord)) chords.push({ chord, position: m.index });
      }
      return chords;
    }

    function isTabNotation(line) {
      return /^[EADGBe]\|/.test(line.trim()) || /^\|[-0-9|hpbs\/\\~]+\|?\s*$/.test(line.trim());
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || isTabNotation(line)) { i++; continue; }

      // Section header: [Verse], [Chorus], [Bridge], etc.
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]\s*$/);
      if (sectionMatch && !/\[ch\]/.test(trimmed) && !/\[\/ch\]/.test(trimmed)) {
        if (currentSection.lines.length) normalized.sections.push(currentSection);
        currentSection = { name: sectionMatch[1].trim(), lines: [] };
        i++;
        continue;
      }

      if (isChordLine(line)) {
        const chords = extractChords(line);
        let lyrics = '';

        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextTrimmed = nextLine.trim();
          if (nextTrimmed && !isChordLine(nextLine) && !isTabNotation(nextLine) &&
              !nextTrimmed.match(/^\[/) && nextTrimmed.length > 1) {
            lyrics = nextTrimmed;
            i++;
          }
        }

        if (chords.length) {
          currentSection.lines.push({ chords, lyrics });
        }
        i++;
        continue;
      }

      // Lyric-only or other text
      if (trimmed.length > 1 && !/^\[/.test(trimmed)) {
        currentSection.lines.push({ chords: [], lyrics: trimmed });
      }
      i++;
    }
    if (currentSection.lines.length) normalized.sections.push(currentSection);

    // Detect key from first chord
    if (normalized.sections.length) {
      const firstChord = normalized.sections[0].lines.find(l => l.chords.length);
      if (firstChord) {
        const root = firstChord.chords[0].chord.match(/^[A-G][#b]?/);
        if (root) normalized.key = root[0];
      }
    }

    return normalized;
  }

  // ── GuitarTabs.cc Search + Parser ────────────────────

  async function searchGuitarTabs(artist, title) {
    const searchUrl = `https://www.guitartabs.cc/search.php?tabtype=chords&band=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`;
    const html = await proxyFetch(searchUrl);

    // Results are in table rows with links to /tabs/... URLs
    // Look for _crd type links (chord sheets, not tabs)
    const linkRegex = /href="(\/tabs\/[^"]*_crd[^"]*\.html)"/gi;
    const matches = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      matches.push(m[1]);
    }

    if (!matches.length) {
      // Try broader search with just the title
      const broadUrl = `https://www.guitartabs.cc/search.php?tabtype=chords&band=&song=${encodeURIComponent(title)}`;
      const broadHtml = await proxyFetch(broadUrl);
      while ((m = linkRegex.exec(broadHtml)) !== null) {
        matches.push(m[1]);
      }
    }

    if (!matches.length) return null;
    return 'https://www.guitartabs.cc' + matches[0];
  }

  async function fetchGuitarTabsChords(tabUrl, title, artist) {
    await delay(1100); // respect proxy per-domain throttle
    const html = await proxyFetch(tabUrl);

    // Find the last <pre> block (first is just the title)
    const preBlocks = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)];
    const preContent = preBlocks.length > 1 ? preBlocks[preBlocks.length - 1][1] : preBlocks[0]?.[1];
    if (!preContent) return null;

    // GuitarTabs.cc wraps chords in <a class='ch'>ChordName</a> and sometimes [brackets]
    // Replace chord anchor tags with bracket markers: [ChordName]
    const content = preContent
      .replace(/<a[^>]*class=['"]ch['"][^>]*>([^<]*)<\/a>/gi, '\x01$1\x01')
      .replace(/<[^>]+>/g, '')  // strip remaining HTML tags
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\[?\x01([^\x01]+)\x01\]?/g, '[$1]');  // normalize to [Chord], collapse double brackets

    return parseGuitarTabsContent(content, title, artist);
  }

  function parseGuitarTabsContent(content, title, artist) {
    const normalized = {
      title, artist,
      key: null, capo: 0, bpm: null,
      timeSignature: null, sections: [],
      strumPattern: null, source: 'guitartabs.cc',
    };

    // Extract capo
    const capoMatch = content.match(/capo[:\s]*(?:on\s*)?(?:fret\s*)?(\d+)/i);
    if (capoMatch) normalized.capo = parseInt(capoMatch[1]);

    const lines = content.split('\n');
    let currentSection = { name: 'Intro', lines: [] };

    // Chord pattern: line of chord names separated by spaces (Am, C, G7, F#m, etc.)
    // May use brackets: [Am] or just bare chord names
    const chordToken = /^[A-G][#b]?(?:m|min|maj|dim|aug|sus[24]|add[29])?(?:\d+)?(?:\/[A-G][#b]?)?$/;

    function isTabLine(line) {
      return /^[EADGBe]\|/.test(line.trim()) || /^[|][-0-9|hpbs\/\\~]+[|]?\s*$/.test(line.trim());
    }

    function extractBracketChords(line) {
      // Format: [Am]lyrics[C]more lyrics
      const chords = [];
      const regex = /\[([A-G][^\]]*)\]/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        const chord = m[1].trim();
        if (/^[A-G]/.test(chord)) chords.push({ chord, position: m.index });
      }
      return chords;
    }

    function isChordOnlyLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Check if most tokens are chord names
      const tokens = trimmed.split(/\s+/);
      if (tokens.length === 0) return false;
      const chordCount = tokens.filter(t => chordToken.test(t)).length;
      return chordCount > 0 && chordCount >= tokens.length * 0.6;
    }

    function extractLineChords(line) {
      const tokens = line.trim().split(/\s+/);
      return tokens
        .filter(t => chordToken.test(t))
        .map((chord, idx) => ({ chord, position: idx }));
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || isTabLine(line)) { i++; continue; }

      // Section header — but not lines that contain chord brackets like [Am]
      const hasBracketChords = extractBracketChords(trimmed).length > 0;
      const sectionMatch = !hasBracketChords && (
        trimmed.match(/^\[?([A-Za-z][A-Za-z\s\-]*(?:Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Solo|Interlude|Hook|Refrain|Break|Coda|Ending|Riff)(?:\s*\d*)?)\]?\s*:?\s*$/i)
        || trimmed.match(/^(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Solo|Interlude|Hook|Refrain|Break|Coda)\s*\d*\s*:?\s*$/i)
      );
      if (sectionMatch && !isChordOnlyLine(trimmed)) {
        if (currentSection.lines.length) normalized.sections.push(currentSection);
        currentSection = { name: sectionMatch[1].trim(), lines: [] };
        i++;
        continue;
      }

      // Bracket chord format: [Am]today is [C]gonna be...
      const bracketChords = extractBracketChords(line);
      if (bracketChords.length) {
        const lyrics = trimmed.replace(/\[[^\]]*\]/g, '').trim();
        currentSection.lines.push({ chords: bracketChords, lyrics });
        i++;
        continue;
      }

      // Chord-only line (bare chord names)
      if (isChordOnlyLine(trimmed)) {
        const chords = extractLineChords(line);
        let lyrics = '';

        if (i + 1 < lines.length) {
          const nextTrimmed = lines[i + 1].trim();
          if (nextTrimmed && !isChordOnlyLine(nextTrimmed) && !isTabLine(lines[i + 1]) &&
              !nextTrimmed.match(/^\[/) && nextTrimmed.length > 1) {
            lyrics = nextTrimmed;
            i++;
          }
        }

        if (chords.length) {
          currentSection.lines.push({ chords, lyrics });
        }
        i++;
        continue;
      }

      // Lyric-only
      if (trimmed.length > 1) {
        currentSection.lines.push({ chords: [], lyrics: trimmed });
      }
      i++;
    }
    if (currentSection.lines.length) normalized.sections.push(currentSection);

    // Detect key
    if (normalized.sections.length) {
      const firstChord = normalized.sections[0].lines.find(l => l.chords.length);
      if (firstChord) {
        const root = firstChord.chords[0].chord.match(/^[A-G][#b]?/);
        if (root) normalized.key = root[0];
      }
    }

    return normalized;
  }

  // ── Build CifraClub URL from artist + title ───────────

  function slugify(str) {
    return str
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9]+/g, '-')                       // non-alphanumeric → dash
      .replace(/^-+|-+$/g, '')                            // trim dashes
      .replace(/-{2,}/g, '-');                             // collapse doubles
  }

  function buildCifraUrl(artist, title) {
    return `https://www.cifraclub.com.br/${slugify(artist)}/${slugify(title)}/`;
  }

  // ── CifraClub Parser ─────────────────────────────────

  function parseCifraHtml(html, title, artist) {
    const normalized = {
      title, artist,
      key: null, capo: 0, bpm: null,
      timeSignature: null, sections: [],
      strumPattern: null, source: 'cifraclub',
    };

    // Extract capo info
    const capoMatch = html.match(/capo[:\s]*(\d+)/i);
    if (capoMatch) normalized.capo = parseInt(capoMatch[1]);

    // Find the <pre> block with chord data
    const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (!preMatch) return normalized;

    // CifraClub format: chord lines (with <b> tags) alternate with lyric lines.
    // Tab notation lines (E|--3--) should be skipped.
    const content = preMatch[1];

    // Replace <b>chord</b> with marker: \x01chord\x01
    const marked = content
      .replace(/<b>([^<]*)<\/b>/gi, '\x01$1\x01')
      .replace(/<[^>]+>/g, '')  // strip remaining HTML
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const rawLines = marked.split('\n');
    let currentSection = { name: 'Intro', lines: [] };

    // Helper: is this a tab notation line? (e.g., "E|--3--3--")
    function isTabLine(line) {
      return /^[EADGBe]\|/.test(line.trim()) || /^\|/.test(line.trim());
    }

    // Helper: is this a chord-only line? (has chord markers, remaining text is just whitespace/dashes/arrows)
    function isChordLine(line) {
      if (!/\x01/.test(line)) return false;
      const withoutChords = line.replace(/\x01[^\x01]*\x01/g, '');
      return /^\s*[>\s\-↓↑]*\s*$/.test(withoutChords);
    }

    // Helper: extract chords from a line
    function extractChords(line) {
      const chords = [];
      const regex = /\x01([^\x01]+)\x01/g;
      let m;
      while ((m = regex.exec(line)) !== null) {
        const chord = m[1].trim();
        if (chord && /^[A-G]/.test(chord)) chords.push({ chord, position: m.index });
      }
      return chords;
    }

    let i = 0;
    while (i < rawLines.length) {
      const line = rawLines[i];
      const trimmed = line.trim();

      // Skip empty lines and tab notation
      if (!trimmed || isTabLine(line)) { i++; continue; }

      // Section header: [Intro], [Verse], [Chorus], etc.
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]\s*$/);
      if (sectionMatch) {
        // Section header might have chords on the same line: "[Intro] Em7  G  D4  A7(4)"
        const afterBracket = trimmed.replace(/^\[[^\]]+\]\s*/, '');
        if (currentSection.lines.length) normalized.sections.push(currentSection);
        currentSection = { name: sectionMatch[1].trim(), lines: [] };
        if (afterBracket) {
          const headerChords = extractChords('\x01' + afterBracket.split(/\s+/).join('\x01 \x01') + '\x01');
          // Actually re-extract from original line after the bracket
          const inlineChords = extractChords(line.replace(/^\s*\[[^\]]+\]\s*/, ''));
          if (inlineChords.length) {
            currentSection.lines.push({ chords: inlineChords, lyrics: '' });
          }
        }
        i++;
        continue;
      }

      // Chord-only line: pair with following lyric line
      if (isChordLine(line)) {
        const chords = extractChords(line);
        let lyrics = '';

        // Check if the next line is a lyric line (not a chord line, not a section header, not tab)
        if (i + 1 < rawLines.length) {
          const nextLine = rawLines[i + 1];
          const nextTrimmed = nextLine.trim();
          if (nextTrimmed && !isChordLine(nextLine) && !isTabLine(nextLine) &&
              !nextTrimmed.match(/^\[/) && !nextTrimmed.match(/^(Intro|Verse|Chorus|Bridge|Outro|Pre-Chorus|Solo|Interlude|Refrão|Ponte)\s*:?\s*$/i)) {
            lyrics = nextTrimmed;
            i++; // consume the lyric line
          }
        }

        if (chords.length) {
          currentSection.lines.push({ chords, lyrics });
        }
        i++;
        continue;
      }

      // Lyric-only line or other text (skip descriptive text like "Parte 1 de 3")
      const isDescriptive = /^(Parte|Part|Repete|Repeat|x\d|\d+x)/i.test(trimmed);
      if (!isDescriptive && trimmed.length > 1) {
        currentSection.lines.push({ chords: [], lyrics: trimmed });
      }
      i++;
    }
    if (currentSection.lines.length) normalized.sections.push(currentSection);

    // Collapse repeated chord patterns within each section.
    // e.g., Em7 G D A Em7 G D A Em7 G D A → Em7 G D A (repeat x3)
    for (const section of normalized.sections) {
      const chordLines = section.lines.filter(l => l.chords.length > 0);
      if (chordLines.length <= 1) continue;

      // Build flat chord sequence from this section
      const flatChords = chordLines.flatMap(l => l.chords.map(c => c.chord));
      if (flatChords.length <= 4) continue;

      // Try pattern lengths from 2 to half the sequence
      const maxPattern = Math.floor(flatChords.length / 2);
      let bestLen = flatChords.length; // default: no dedup

      for (let pLen = 2; pLen <= maxPattern; pLen++) {
        if (flatChords.length % pLen !== 0) continue;
        const pattern = flatChords.slice(0, pLen);
        let repeats = true;
        for (let j = pLen; j < flatChords.length; j += pLen) {
          for (let k = 0; k < pLen; k++) {
            if (flatChords[j + k] !== pattern[k]) { repeats = false; break; }
          }
          if (!repeats) break;
        }
        if (repeats) { bestLen = pLen; break; } // smallest repeating pattern
      }

      if (bestLen < flatChords.length) {
        // Keep only the first cycle of chords, and preserve matching lyrics
        const keptChords = flatChords.slice(0, bestLen);
        const newLines = [];
        let idx = 0;
        for (const line of section.lines) {
          if (line.chords.length > 0 && idx < bestLen) {
            const take = Math.min(line.chords.length, bestLen - idx);
            newLines.push({
              chords: line.chords.slice(0, take),
              lyrics: line.lyrics,
            });
            idx += take;
            if (idx >= bestLen) { /* done */ }
          } else if (line.chords.length === 0 && idx < bestLen) {
            newLines.push(line); // keep lyric-only lines from first cycle
          }
        }
        section.lines = newLines;
      }
    }

    // Try to detect key from first chord
    if (normalized.sections.length) {
      const firstChord = normalized.sections[0].lines.find(l => l.chords.length);
      if (firstChord) {
        const root = firstChord.chords[0].chord.match(/^[A-G][#b]?/);
        if (root) normalized.key = root[0];
      }
    }

    return normalized;
  }

  // ── Preview ───────────────────────────────────────────

  async function loadPreview(index) {
    const r = currentResults[index];
    const sources = [
      {
        name: 'Ultimate Guitar',
        fetch: async () => {
          const tabUrl = await searchUG(r.artist, r.title);
          if (!tabUrl) return null;
          return fetchUGChords(tabUrl, r.title, r.artist);
        },
      },
      {
        name: 'GuitarTabs.cc',
        fetch: async () => {
          const tabUrl = await searchGuitarTabs(r.artist, r.title);
          if (!tabUrl) return null;
          return fetchGuitarTabsChords(tabUrl, r.title, r.artist);
        },
      },
      {
        name: 'CifraClub',
        fetch: async () => {
          const url = buildCifraUrl(r.artist, r.title);
          const html = await proxyFetch(url);
          if (!html.includes('<pre')) {
            const altArtist = r.artist.replace(/^The\s+/i, '');
            if (altArtist !== r.artist) {
              const altHtml = await proxyFetch(buildCifraUrl(altArtist, r.title));
              if (altHtml.includes('<pre')) return parseCifraHtml(altHtml, r.title, r.artist);
            }
            return null;
          }
          return parseCifraHtml(html, r.title, r.artist);
        },
      },
    ];

    for (const source of sources) {
      try {
        setStatus(`Trying ${source.name}...`);
        previewData = await source.fetch();
        if (previewData && previewData.sections.length) {
          renderPreview(previewData);
          setStatus(`Source: ${source.name}`);
          return;
        }
      } catch (err) {
        console.warn(`${source.name} failed:`, err.message);
      }
    }

    setStatus('No chord data found on any source. Try a different song.');
  }

  function renderPreview(data) {
    modal.querySelector('#importer-results').style.display = 'none';
    modal.querySelector('#importer-preview').style.display = '';

    // Detect key for preview display
    const allPreviewChords = data.sections.flatMap(s => s.lines.flatMap(l => l.chords.map(c => c.chord)));
    const detectedPreview = Theory.detectKeyFromChords(allPreviewChords.map(c => normalizeChordName(c)));
    const keyDisplay = detectedPreview ? `${detectedPreview.key} ${detectedPreview.mode}` : (data.key || '?');

    const titleDiv = modal.querySelector('#importer-preview-title');
    titleDiv.innerHTML = `
      <strong>${escapeHtml(data.title)}</strong> — ${escapeHtml(data.artist)}
       | Key: ${escapeHtml(keyDisplay)}
      ${data.capo ? ` | Capo: ${data.capo}` : ''}
    `;

    const body = modal.querySelector('#importer-preview-body');
    body.innerHTML = '';

    for (const section of data.sections) {
      const sDiv = document.createElement('div');
      sDiv.className = 'importer-preview-section';

      const allChords = section.lines.flatMap(l => l.chords.map(c => c.chord));
      const uniqueChords = [...new Set(allChords)];

      sDiv.innerHTML = `
        <div class="preview-section-name">${escapeHtml(section.name)}</div>
        <div class="preview-section-chords">${uniqueChords.map(c =>
          `<span class="preview-chord">${escapeHtml(c)}</span>`).join(' ')}</div>
        <div class="preview-section-lyrics">${section.lines
          .filter(l => l.lyrics)
          .slice(0, 4)
          .map(l => `<div class="preview-lyric-line">${escapeHtml(l.lyrics)}</div>`)
          .join('')}
        ${section.lines.filter(l => l.lyrics).length > 4 ? '<div class="preview-lyric-more">...</div>' : ''}
        </div>
      `;
      body.appendChild(sDiv);
    }
  }

  // ── Import: Normalized → App.state ────────────────────

  // ── Consolidate Repeated Sections ────────────────────
  // Detects sections with identical chord progressions and merges them.
  // Strategy:
  //   1. Group by base name (strip trailing numbers: "Verse 1","Verse 2" → "Verse")
  //   2. Within each group, if all share the same chord sequence, keep one + set repeat
  //   3. Also merge consecutive identical sections regardless of name

  function chordFingerprint(section) {
    return section.chords.map(c => c.chord + ':' + c.durationBeats).join('|');
  }

  function baseName(name) {
    return name.replace(/\s*\d+\s*$/, '').trim();
  }

  function consolidateRepeatedSections(sections) {
    if (sections.length <= 1) return sections;

    // Pass 1: merge consecutive runs of identical chord progressions
    const merged = [];
    let i = 0;
    while (i < sections.length) {
      const current = sections[i];
      const fp = chordFingerprint(current);
      let count = 1;

      // Count consecutive sections with same chords
      while (i + count < sections.length && chordFingerprint(sections[i + count]) === fp) {
        count++;
      }

      if (count > 1) {
        // Keep the first, set repeat, use base name
        current.name = baseName(current.name) || current.name;
        current.repeat = count;
        // Merge lyrics from all copies
        for (let j = 1; j < count; j++) {
          const other = sections[i + j];
          if (other.lyrics && other.lyrics.length) {
            if (!current.lyrics) current.lyrics = [];
            // Don't add duplicate lyrics
            const existing = current.lyrics.join('\n');
            const incoming = other.lyrics.join('\n');
            if (incoming !== existing) {
              current.lyrics.push('', `--- ${other.name || baseName(other.name)} ---`, ...other.lyrics);
            }
          }
        }
      }

      merged.push(current);
      i += count;
    }

    // Pass 2: merge non-consecutive sections with same base name AND same chords
    const result = [];
    const seen = new Map(); // baseName+fingerprint → index in result

    for (const section of merged) {
      const key = baseName(section.name) + '::' + chordFingerprint(section);
      if (seen.has(key)) {
        const existing = result[seen.get(key)];
        existing.repeat = (existing.repeat || 1) + (section.repeat || 1);
        // Merge lyrics
        if (section.lyrics && section.lyrics.length) {
          if (!existing.lyrics) existing.lyrics = [];
          const existingText = existing.lyrics.join('\n');
          const incomingText = section.lyrics.join('\n');
          if (incomingText !== existingText) {
            existing.lyrics.push('', `--- ${section.name} ---`, ...section.lyrics);
          }
        }
      } else {
        section.name = baseName(section.name) || section.name;
        seen.set(key, result.length);
        result.push(section);
      }
    }

    return result;
  }

  function doImport() {
    if (!previewData) return;

    if (App.state.sections.length > 0) {
      const hasChords = App.state.sections.some(s => s.chords.length > 0);
      if (hasChords && !confirm('This will replace your current project. Continue?')) return;
    }

    const data = previewData;

    // Auto-detect key + mode from all chords across sections
    const allChords = data.sections.flatMap(s => s.lines.flatMap(l => l.chords.map(c => c.chord)));
    const detected = Theory.detectKeyFromChords(allChords.map(c => normalizeChordName(c)));

    if (detected) {
      App.state.key = detected.key;
      App.state.mode = detected.mode;
      console.log(`Importer: detected key=${detected.key} mode=${detected.mode} (confidence=${detected.confidence.toFixed(1)})`);
    } else if (data.key) {
      App.state.key = data.key;
    }

    if (data.capo != null) App.state.capo = data.capo;
    if (data.bpm) App.state.bpm = data.bpm;
    if (data.timeSignature) App.state.timeSignature = data.timeSignature;
    App.state.projectName = `${data.title} - ${data.artist}`;

    const beatsPerBar = parseInt(App.state.timeSignature) || 4;
    const defaultChordBeats = beatsPerBar;

    App.state.sections = data.sections.map(section => {
      const chords = [];
      let beat = 0;

      for (const line of section.lines) {
        for (const c of line.chords) {
          const normalized = normalizeChordName(c.chord);
          const voicings = ChordsDB.getVoicings(normalized, 0);
          if (!voicings || voicings.length === 0) {
            console.warn(`Importer: no voicing found for "${c.chord}" (normalized: "${normalized}")`);
          }
          chords.push({
            chord: normalized,
            voicingIndex: 0,
            startBeat: beat,
            durationBeats: defaultChordBeats,
          });
          beat += defaultChordBeats;
        }
      }

      const totalBeats = Math.max(beat, beatsPerBar * 2);

      // Stamp one downstroke at the start of each chord
      const gridState = {};
      for (const chord of chords) {
        const col = chord.startBeat * 2; // subdivisions = 2
        for (let s = 1; s <= 6; s++) {
          gridState[s + ':' + col] = 1.0;
        }
      }

      return {
        name: section.name || 'Section',
        totalBeats,
        subdivisions: 2,
        chords,
        gridState,
        dynamics: 'mf',
        lyrics: section.lines.filter(l => l.lyrics).map(l => l.lyrics),
      };
    });

    App.state.sections = App.state.sections.filter(s => s.chords.length > 0);

    // Consolidate repeated sections: detect consecutive or same-named sections
    // with identical chord progressions and merge them using the repeat count
    App.state.sections = consolidateRepeatedSections(App.state.sections);

    if (!App.state.sections.length) {
      App.initDefaultSong();
    }

    App.state.selectedSlot = null;
    App.state.selectedChord = null;
    App.state.selectedVoicingIndex = 0;

    App.emit('stateLoaded');
    Timeline.render();
    Controls.renderPalette();
    App.emit('songChanged');

    close();
  }

  function normalizeChordName(name) {
    if (!name) return 'C';
    let c = name.replace(/\s+/g, '');

    // Brazilian "7M" → "maj7" (must come before other 7 replacements)
    c = c.replace(/7M/, 'maj7');

    // Strip parenthesized extensions: (4)→sus4, (9)→add9, others→drop
    c = c.replace(/\(4\+?\)/, 'sus4');
    c = c.replace(/\(9\)/, 'add9');
    c = c.replace(/\(\d[^)]*\)/, ''); // (11), (5+), etc. → drop

    // "4+" suffix → sus4
    c = c.replace(/4\+$/, 'sus4');

    // Bare "4" suffix → sus4 (D4 → Dsus4, B4/F# → Bsus4/F#)
    c = c.replace(/^([A-G][#b]?m?)4(?=[/$]|$)/, '$1sus4');

    // "6" chords → simplify to major (F6 → F)
    c = c.replace(/^([A-G][#b]?m?)6$/, '$1');

    // "11" chords → simplify to base (D11/F# → D/F#)
    c = c.replace(/^([A-G][#b]?m?)11/, '$1');

    // Common text normalization
    c = c.replace(/maj$/, '');
    c = c.replace(/minor|min/i, 'm');

    // If it's a slash chord, check if base chord exists — keep the slash
    // but if the full thing doesn't exist, try just the base
    c = c.trim() || 'C';

    return c;
  }

  // ── Lyrics Display ────────────────────────────────────

  function renderLyricsForSection(sectionEl, sectionData) {
    const existing = sectionEl.querySelector('.section-lyrics');
    if (existing) existing.remove();

    if (!sectionData.lyrics || !sectionData.lyrics.length) return;

    const lyricsDiv = document.createElement('div');
    lyricsDiv.className = 'section-lyrics collapsed';

    const toggle = document.createElement('button');
    toggle.className = 'lyrics-toggle';
    toggle.textContent = 'Lyrics';
    toggle.addEventListener('click', () => {
      lyricsDiv.classList.toggle('collapsed');
      toggle.textContent = lyricsDiv.classList.contains('collapsed') ? 'Lyrics' : 'Lyrics (hide)';
    });

    const content = document.createElement('div');
    content.className = 'lyrics-content';
    content.innerHTML = sectionData.lyrics.map(l => `<div>${escapeHtml(l)}</div>`).join('');

    lyricsDiv.appendChild(toggle);
    lyricsDiv.appendChild(content);
    sectionEl.appendChild(lyricsDiv);
  }

  // ── Init ──────────────────────────────────────────────

  function init() {
    const btn = document.getElementById('btn-import-tab');
    if (btn) btn.addEventListener('click', open);

    App.on('stateLoaded', attachLyrics);
    App.on('songChanged', attachLyrics);
  }

  function attachLyrics() {
    requestAnimationFrame(() => {
      const sectionEls = document.querySelectorAll('.timeline-section');
      sectionEls.forEach((el, i) => {
        if (App.state.sections[i]) {
          renderLyricsForSection(el, App.state.sections[i]);
        }
      });
    });
  }

  return { init, open, close, renderLyricsForSection };
})();
