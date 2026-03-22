const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Backup directory for project saves
const BACKUP_DIR = path.join(__dirname, '..', 'saves');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const ALLOWED_DOMAINS = [
  'genius.com',
  'cifraclub.com.br',
  'www.cifraclub.com.br',
  'ultimate-guitar.com',
  'www.ultimate-guitar.com',
  'tabs.ultimate-guitar.com',
  'www.guitartabs.cc',
  'guitartabs.cc',
];

// Per-domain throttle: 1 req/sec
const lastRequest = {};

function isDomainAllowed(hostname) {
  return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/fetch', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!isDomainAllowed(parsed.hostname)) {
    return res.status(403).json({ error: 'Domain not allowed: ' + parsed.hostname });
  }

  // Throttle: 1 req/sec per domain
  const domain = parsed.hostname;
  const now = Date.now();
  if (lastRequest[domain] && now - lastRequest[domain] < 1000) {
    return res.status(429).json({ error: 'Rate limited, try again in 1 second' });
  }
  lastRequest[domain] = now;

  const client = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  };

  const fetchUrl = (opts, depth, httpClient) => {
    if (depth > 3) return res.status(502).json({ error: 'Too many redirects' });

    httpClient.get(opts, (upstream) => {
      // Follow redirects
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        const redirect = new URL(upstream.headers.location, targetUrl);
        if (!isDomainAllowed(redirect.hostname)) {
          return res.status(403).json({ error: 'Redirect to disallowed domain' });
        }
        const c2 = redirect.protocol === 'https:' ? https : http;
        return fetchUrl({ hostname: redirect.hostname, path: redirect.pathname + redirect.search, headers: opts.headers }, depth + 1, c2);
      }

      let body = '';
      upstream.on('data', chunk => body += chunk);
      upstream.on('end', () => {
        res.set('Content-Type', upstream.headers['content-type'] || 'text/html');
        res.send(body);
      });
    }).on('error', e => res.status(502).json({ error: e.message }));
  };

  fetchUrl(options, 0, client);
});

// ── Disk Backup Endpoints ─────────────────────────────

app.use(express.json({ limit: '5mb' }));

// Save autosave + named project to disk
app.post('/save', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: 'Missing name or data' });

  // Sanitize filename
  const safeName = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'untitled';
  const filePath = path.join(BACKUP_DIR, safeName + '.chord-builder.json');

  try {
    fs.writeFileSync(filePath, JSON.stringify(JSON.parse(data), null, 2));
    res.json({ ok: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List all saved projects on disk
app.get('/saves', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.chord-builder.json'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f.replace('.chord-builder.json', '').replace(/_/g, ' '), file: f, modified: stat.mtime };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Load a specific save from disk
app.get('/saves/:file', (req, res) => {
  const filePath = path.join(BACKUP_DIR, req.params.file);
  if (!filePath.startsWith(BACKUP_DIR)) return res.status(403).json({ error: 'Invalid path' });
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    res.set('Content-Type', 'application/json');
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

app.listen(PORT, () => {
  console.log(`CORS proxy listening on http://localhost:${PORT}`);
  console.log('Allowed domains:', ALLOWED_DOMAINS.join(', '));
});
