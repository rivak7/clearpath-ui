/* Minimal Node HTTP server for WebUI + /entrance (no external deps) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const SESSIONS_DIR = path.join(ROOT, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function send(res, code, body, headers = {}) {
  const h = { 'content-type': 'text/plain; charset=utf-8', ...headers };
  res.writeHead(code, h);
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });
}

function staticFile(res, p) {
  try {
    const data = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const map = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const ct = map[ext] || 'application/octet-stream';
    send(res, 200, data, { 'content-type': ct });
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

async function geocodePhoton(q) {
  const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=1';
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('bad_status:' + r.statusCode)); }
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => data += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function makeMapHtml({ lat, lon, name }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Map – ${escapeHtml(name)}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
  <style>html,body,#map{height:100%;margin:0} body{font:14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif}</style>
  <meta name="robots" content="noindex" />
  <link rel="icon" href="data:," />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  </head>
<body>
  <div id="map"></div>
  <script>
    const lat = ${lat};
    const lon = ${lon};
    const name = ${JSON.stringify(name)};
    const map = L.map('map').setView([lat, lon], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap' }).addTo(map);
    L.marker([lat, lon]).addTo(map).bindPopup(name).openPopup();
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Health
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
    // /entrance
    if (url.pathname === '/entrance') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, 400, { error: 'missing_query' });
      try {
        const geo = await geocodePhoton(q);
        const feat = (geo.features || [])[0];
        if (!feat || !feat.geometry || !feat.geometry.coordinates) return sendJson(res, 404, { error: 'not_found' });
        const [lon, lat] = feat.geometry.coordinates;
        const name = (feat.properties && (feat.properties.label || feat.properties.name)) || q;
        const id = Date.now() + '-' + Math.random().toString(16).slice(2, 10);
        const dir = path.join(SESSIONS_DIR, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'map.html'), makeMapHtml({ lat, lon, name }), 'utf8');
        return sendJson(res, 200, { query: q, name, entrance: { lat, lon }, mapUrl: `/sessions/${id}/map.html` });
      } catch (e) {
        return sendJson(res, 502, { error: 'geocode_failed' });
      }
    }
    // sessions static
    if (url.pathname.startsWith('/sessions/')) {
      const p = path.join(SESSIONS_DIR, url.pathname.replace('/sessions/', ''));
      return staticFile(res, p);
    }
    // root
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return staticFile(res, path.join(WEB_DIR, 'index.html'));
    }
    // 404
    sendJson(res, 404, { error: 'not_found' });
  } catch (e) {
    sendJson(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
