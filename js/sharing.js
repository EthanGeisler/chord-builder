// === Chord Builder — Shareable Links (Phase 1: URL-based) ===

const Sharing = (() => {
  // base64url encode (URL-safe, no padding)
  function base64urlEncode(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // base64url decode
  function base64urlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Compress via CompressionStream (gzip)
  async function gzipCompress(str) {
    const encoder = new TextEncoder();
    const input = encoder.encode(str);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let totalLength = 0;
    for (const chunk of chunks) totalLength += chunk.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Decompress via DecompressionStream (gzip)
  async function gzipDecompress(compressedBytes) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let totalLength = 0;
    for (const chunk of chunks) totalLength += chunk.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    const decoder = new TextDecoder();
    return decoder.decode(result);
  }

  // Encode current state to a URL hash string
  async function encodeStateToHash() {
    const json = App.serialize();
    const compressed = await gzipCompress(json);
    return base64urlEncode(compressed);
  }

  // Decode hash string and load into App state
  async function decodeHashToState(hash) {
    const bytes = base64urlDecode(hash);
    const json = await gzipDecompress(bytes);
    App.deserialize(json);
  }

  // Check URL hash on startup. Returns true if hash was found and loaded.
  async function checkHash() {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith('#data=')) return false;

    const encoded = hash.slice(6); // remove '#data='
    if (!encoded) return false;

    try {
      await decodeHashToState(encoded);
      // Clear hash from URL without triggering reload
      history.replaceState(null, '', window.location.pathname + window.location.search);
      console.log('Loaded song from shared URL');
      return true;
    } catch (e) {
      console.error('Failed to decode shared URL:', e);
      return false;
    }
  }

  // Show share modal
  async function showShareModal() {
    const encoded = await encodeStateToHash();
    const url = window.location.origin + window.location.pathname + '#data=' + encoded;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'share-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'share-modal';

    const title = document.createElement('h3');
    title.textContent = 'Share Link';
    modal.appendChild(title);

    if (url.length > 2000) {
      const warning = document.createElement('p');
      warning.className = 'share-warning';
      warning.textContent = 'Warning: This URL is very long (' + url.length + ' chars) and may not work in all browsers. Consider using File > Export instead.';
      modal.appendChild(warning);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'share-url-input';
    input.value = url;
    modal.appendChild(input);

    const buttons = document.createElement('div');
    buttons.className = 'share-modal-buttons';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'share-btn-copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {
        input.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'share-btn-close';
    closeBtn.addEventListener('click', () => {
      overlay.remove();
    });

    buttons.appendChild(copyBtn);
    buttons.appendChild(closeBtn);
    modal.appendChild(buttons);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
    input.select();
  }

  function init() {
    const shareBtn = document.getElementById('btn-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', showShareModal);
    }
  }

  return { init, checkHash, encodeStateToHash, decodeHashToState };
})();
