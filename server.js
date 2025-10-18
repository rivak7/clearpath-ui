const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const dotenv = require('dotenv');
const http = require('http');
const https = require('https');
const childProcess = require('child_process');

dotenv.config();

const app = express();

// Configuration with sensible defaults
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0'; // listen on all ifaces
const ENABLE_TUNNEL = String(process.env.ENABLE_TUNNEL || '').toLowerCase() === '1';
const TUNNEL_PROVIDER = (process.env.TUNNEL_PROVIDER || 'cloudflared').toLowerCase();
const TUNNEL_SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || undefined; // optional for localtunnel
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'GET_ONLY';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const BODY_LIMIT = process.env.BODY_LIMIT || '10kb';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY || '1';
// Fallback bbox size in meters when geocoder does not return bounding box
const DEFAULT_BBOX_METERS = Number(process.env.DEFAULT_BBOX_METERS || 60);
const ENTRYPOINT_DIR = path.resolve(__dirname, 'entrypoint');
const CNN_DEFAULT_WEIGHTS = path.join(ENTRYPOINT_DIR, 'checkpoints', 'best.pt');
const CNN_IMAGE_SIZE = Number(process.env.CNN_IMAGE_SIZE || 512);
const CNN_ZOOM = Number(process.env.CNN_ZOOM || 19);
const CNN_TIMEOUT_MS = Number(process.env.CNN_TIMEOUT_MS || 25000);
const CNN_FETCH_TIMEOUT_SEC = Number(process.env.CNN_FETCH_TIMEOUT_SEC || 15);
const PYTHON_BIN = pickPythonBinary();


// Security middlewares
app.disable('x-powered-by');
// Trust reverse proxies (like localtunnel) to get real client IP
// Accept numbers (hops) or truthy string
try {
  const asNumber = Number(TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(asNumber) ? true : asNumber);
} catch {
  app.set('trust proxy', true);
}
// Helmet hardens defaults. Disable CSP header so our inline script in
// web/index.html and the session map (which loads Leaflet from unpkg and
// Esri tiles) can run without being blocked. The map HTML ships its own
// <meta http-equiv="Content-Security-Policy"> tailored to its needs.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Rate limiting to mitigate abuse
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use(limiter);

// Logging: short format without request bodies
app.use(morgan('tiny'));

// Body parsers with small limits
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

// Optional bearer token auth for all routes if AUTH_TOKEN is set
if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const expected = `Bearer ${AUTH_TOKEN}`;
    if (header === expected) return next();
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'unauthorized' });
  });
}

// CORS configuration
let corsOptions;
if (CORS_ORIGIN === 'GET_ONLY') {
  // Allow GET/HEAD from anywhere, block other methods via CORS
  corsOptions = {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  };
} else if (CORS_ORIGIN === '*') {
  corsOptions = { origin: true };
} else {
  // Comma-separated list
  const origins = CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  corsOptions = { origin: origins };
}
app.use(cors(corsOptions));

// Compression after security/logging
app.use(compression());

// Serve session artifacts (HTML/JSON) for debugging
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');
try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}
app.use('/sessions', express.static(SESSIONS_DIR, { fallthrough: true, etag: true }));

// Serve minimal web UI (static)
const WEB_DIR = path.resolve(__dirname, 'web');
try { fs.mkdirSync(WEB_DIR, { recursive: true }); } catch {}
app.use(express.static(WEB_DIR, { index: 'index.html', fallthrough: true, etag: true }));
app.get('/', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// Health check
app.get(['/health', '/_health', '/ping'], (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ping' });
});

// Geocode endpoint with optional footprint polygon
// GET /geocode/bbox?q=<human address>
// Returns: { query, provider, center: { lat, lon }, bbox: { south, west, north, east }, footprint?: GeoJSON }
const GEOCODER_BASE_URL = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org';

// Simple JSON fetcher using Node http/https with timeout
async function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 10_000 } = {}) {
  return await new Promise((resolve, reject) => {
    try {
      const u = new URL(url, 'http://localhost');
      const isHttps = u.protocol === 'https:';
      const transport = isHttps ? https : http;
      const options = { method, headers };
      const req = transport.request(u, options, (res) => {
        const status = res.statusCode || 0;
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (status < 200 || status >= 300) return reject(Object.assign(new Error('bad_status'), { status }));
          try { resolve(JSON.parse(data)); } catch (e) { reject(Object.assign(new Error('bad_json'), { cause: e })); }
        });
      });
      req.on('error', reject);
      if (timeoutMs) req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {} reject(Object.assign(new Error('timeout'), { code: 'ABORT_ERR' })); });
      if (body) req.write(typeof body === 'string' ? body : String(body));
      req.end();
    } catch (e) { reject(e); }
  });
}
app.get('/geocode/bbox', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'missing_query', message: 'Provide address with ?q=' });
    if (q.length > 256) return res.status(400).json({ error: 'query_too_long' });

    // Unified geocoder with fallback and footprint support
    const geo = await geocodeAddress(q);
    if (!geo) return res.status(404).json({ error: 'not_found' });
    const { lat, lon, bbox: { south, west, north, east }, footprint = null, raw } = geo;

    // Create a session folder per request and save artifacts
    const sessionId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch {}

    // Persist request + result JSON
    const sessionJson = {
      sessionId,
      receivedAt: new Date().toISOString(),
      request: {
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
        ip: req.ip,
        query: req.query,
        headers: req.headers,
      },
      result: {
        query: q,
        provider: raw && raw.__provider ? raw.__provider : 'nominatim',
        center: { lat, lon },
        bbox: { south, west, north, east },
        footprint,
        raw,
      },
    };
    try {
      fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(sessionJson, null, 2));
    } catch {}

    // Generate a minimal Leaflet-based HTML with Esri World Imagery and footprint overlay
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Session ${sessionId} – Geocode Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob: https://unpkg.com https://server.arcgisonline.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src * data: blob:;" />
  <meta name="robots" content="noindex" />
  <link rel="icon" href="data:," />
  </head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    const south = ${south};
    const west = ${west};
    const north = ${north};
    const east = ${east};
    const center = [${lat}, ${lon}];
    const footprint = ${JSON.stringify(footprint || null)};

    const map = L.map('map', { zoomControl: true });
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(map);
    if (footprint) {
      const layer = L.geoJSON(footprint, { style: { color: '#1e90ff', weight: 2, fillOpacity: 0.15 } }).addTo(map);
      try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch { map.setView(center, 19); }
    } else {
      const bounds = L.latLngBounds([ [south, west], [north, east] ]);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
    L.marker(center).addTo(map).bindPopup('Center').openPopup();
  </script>
</body>
</html>`;
    try {
      fs.writeFileSync(path.join(sessionDir, 'map.html'), html);
    } catch {}

    const mapUrl = `/sessions/${sessionId}/map.html`;
    return res.status(200).json({
      query: q,
      provider: raw && raw.__provider ? raw.__provider : 'nominatim',
      center: { lat, lon },
      bbox: { south, west, north, east },
      footprint,
      sessionId,
      sessionDir: `/sessions/${sessionId}/`,
      mapUrl,
    });
  } catch (e) {
    const isAbort = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    if (isAbort) return res.status(504).json({ error: 'timeout' });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Autocomplete suggestions endpoint using Photon (no API key) with small timeout
// GET /geocode/suggest?q=...&limit=8
app.get('/geocode/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = String(req.query.limit || '8');
    if (!q || q.length < 2) return res.status(200).json({ provider: 'photon', suggestions: [] });
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', limit);
    let suggestions = [];
    try {
      const j = await httpJson(url.toString(), { method: 'GET', headers: { 'User-Agent': 'rishabh-piyush/1.0 (+https://github.com/VerisimilitudeX/rishabh-piyush-placeholder)', 'Accept': 'application/json' }, timeoutMs: 6000 });
      suggestions = (j.features || [])
        .map((f) => (f && f.properties && (f.properties.label || f.properties.name)) || '')
        .filter(Boolean);
      const seen = new Set();
      suggestions = suggestions.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
    } catch {}
    return res.status(200).json({ provider: 'photon', suggestions });
  } catch {
    return res.status(200).json({ provider: 'photon', suggestions: [] });
  }
});

async function runCnnPrediction({ centerLat, centerLon, sessionDir }) {
  const weightsPath = process.env.CNN_WEIGHTS || CNN_DEFAULT_WEIGHTS;
  if (!weightsPath) return { ok: false, reason: 'weights_missing' };
  if (!fs.existsSync(weightsPath)) {
    return { ok: false, reason: 'weights_missing', message: 'Weights not found at ' + weightsPath };
  }

  const args = [
    '-m',
    'src.cnn_infer',
    '--center_lat',
    String(centerLat),
    '--center_lon',
    String(centerLon),
    '--zoom',
    String(CNN_ZOOM),
    '--img_size_px',
    String(CNN_IMAGE_SIZE),
    '--timeout',
    String(CNN_FETCH_TIMEOUT_SEC),
    '--weights',
    weightsPath,
  ];
  let imagePath = null;
  if (sessionDir) {
    imagePath = path.join(sessionDir, 'cnn_input.png');
    args.push('--image_out', imagePath);
  }

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = childProcess.spawn(PYTHON_BIN, args, { cwd: ENTRYPOINT_DIR });
    } catch (err) {
      const message = err && (err.message || String(err));
      return resolve({ ok: false, reason: 'spawn_failed', error: message });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, Math.max(1000, CNN_TIMEOUT_MS));
    child.stdout.on('data', (buf) => { stdout += buf.toString(); });
    child.stderr.on('data', (buf) => { stderr += buf.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      const message = err && (err.message || String(err));
      resolve({ ok: false, reason: 'spawn_error', error: message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return resolve({ ok: false, reason: 'timeout', stdout, stderr, exitCode: code });
      }
      let payload = null;
      const trimmed = stdout.trim();
      if (trimmed) {
        const lines = trimmed.split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1];
        try {
          payload = JSON.parse(last);
        } catch (err) {
          const message = err && (err.message || String(err));
          return resolve({ ok: false, reason: 'parse_error', stdout, stderr, exitCode: code, error: message });
        }
      }
      if (!payload) {
        return resolve({ ok: false, reason: 'no_output', stdout, stderr, exitCode: code });
      }
      if (payload.error) {
        return resolve({ ok: false, reason: 'script_error', payload, stdout, stderr, exitCode: code });
      }
      resolve({ ok: true, payload, stdout, stderr, exitCode: code, imagePath });
    });
  });
}

function pickPythonBinary() {
  const candidates = [
    process.env.CNN_PYTHON,
    process.env.PYTHON,
    process.env.PYTHON_BIN,
    path.join(ENTRYPOINT_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ENTRYPOINT_DIR, '.venv', 'bin', 'python'),
    'python',
    'python3',
    'python.exe',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const probe = childProcess.spawnSync(candidate, ['--version'], { stdio: 'ignore' });
      if (!probe.error && probe.status === 0) return candidate;
    } catch {
      continue;
    }
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

// Helper: clamp
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Helper: approximate meters between two lat/lon points (haversine)
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return R * c;
}

// Helper: project a lat/lon point to the nearest point on the bbox rectangle perimeter
function projectToBBoxEdge(lat, lon, bbox) {
  const { south, west, north, east } = bbox;
  const inside = lat >= south && lat <= north && lon >= west && lon <= east;
  let pLat = clamp(lat, south, north);
  let pLon = clamp(lon, west, east);
  if (!inside) {
    if (pLat > south && pLat < north && pLon > west && pLon < east) {
      const dS = Math.abs(pLat - south);
      const dN = Math.abs(north - pLat);
      const dW = Math.abs(pLon - west);
      const dE = Math.abs(east - pLon);
      const m = Math.min(dS, dN, dW, dE);
      if (m === dS) pLat = south; else if (m === dN) pLat = north; else if (m === dW) pLon = west; else pLon = east;
    }
    return { lat: pLat, lon: pLon };
  }
  const dS = Math.abs(lat - south);
  const dN = Math.abs(north - lat);
  const dW = Math.abs(lon - west);
  const dE = Math.abs(east - lon);
  const m = Math.min(dS, dN, dW, dE);
  if (m === dS) return { lat: south, lon };
  if (m === dN) return { lat: north, lon };
  if (m === dW) return { lat, lon: west };
  return { lat, lon: east };
}

// Helper: nearest point on a polyline segment list to a given lat/lon (planar approx)
function nearestPointOnPolyline(lat, lon, lines) {
  // Convert to local meters using equirectangular approximation near reference lat
  const refLat = lat;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * Math.PI * refLat / 180) + 1.175 * Math.cos(4 * Math.PI * refLat / 180) - 0.0023 * Math.cos(6 * Math.PI * refLat / 180);
  const mPerDegLon = 111412.84 * Math.cos(Math.PI * refLat / 180) - 93.5 * Math.cos(3 * Math.PI * refLat / 180) + 0.118 * Math.cos(5 * Math.PI * refLat / 180);
  const toXY = (la, lo) => ({ x: (lo - lon) * mPerDegLon, y: (la - lat) * mPerDegLat });
  const toLatLon = (x, y) => ({ lat: lat + y / mPerDegLat, lon: lon + x / mPerDegLon });

  let best = null;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = toXY(line[i][0], line[i][1]);
      const b = toXY(line[i + 1][0], line[i + 1][1]);
      const ap = { x: 0, y: 0 };
      const ab = { x: b.x - a.x, y: b.y - a.y };
      const ab2 = ab.x * ab.x + ab.y * ab.y || 1e-9;
      const t = Math.max(0, Math.min(1, (((ap.x - a.x) * ab.x + (ap.y - a.y) * ab.y) / ab2)));
      const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
      const d2 = proj.x * proj.x + proj.y * proj.y;
      if (!best || d2 < best.d2) {
        const ll = toLatLon(proj.x, proj.y);
        best = { d2, lat: ll.lat, lon: ll.lon };
      }
    }
  }
  return best;
}

// Helper: convert GeoJSON Polygon/MultiPolygon to array of polylines [[ [lat,lon], ... ], ...]
function footprintToPolylines(geojson) {
  if (!geojson) return [];
  const out = [];
  if (geojson.type === 'Polygon') {
    for (const ring of geojson.coordinates || []) {
      if (Array.isArray(ring) && ring.length >= 2) out.push(ring.map(([lo, la]) => [la, lo]));
    }
  } else if (geojson.type === 'MultiPolygon') {
    for (const poly of geojson.coordinates || []) {
      for (const ring of poly || []) {
        if (Array.isArray(ring) && ring.length >= 2) out.push(ring.map(([lo, la]) => [la, lo]));
      }
    }
  }
  return out;
}

// Find most-likely entrance by projecting nearest road point to bbox edge
// GET /entrance?q=<address>
// Returns: { center, bbox, roadPoint, entrance, candidates[], session artifacts }
app.get('/entrance', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'missing_query', message: 'Provide address with ?q=' });
    if (q.length > 256) return res.status(400).json({ error: 'query_too_long' });

    // Step 1: geocode robustly with fallback and footprint
    const geo = await geocodeAddress(q);
    if (!geo) return res.status(404).json({ error: 'not_found' });
    const { lat, lon, bbox: { south, west, north, east }, footprint = null, raw } = geo;

    // Step 2: query nearby roads via Overpass
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const ql = `[out:json][timeout:10];way(around:150,${lat},${lon})[highway];(._;>;);out geom;`;
    let roadPoint = null;
    try {
      const opTimer = setTimeout(() => {}, 12000);
      try {
        const data = await httpJson(overpassUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'rishabh-piyush/1.0 (+https://github.com/VerisimilitudeX/rishabh-piyush-placeholder)'
          },
          body: new URLSearchParams({ data: ql }).toString(),
          timeoutMs: 12000,
        });
        const ways = (data.elements || []).filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2);
        const polylines = ways.map((w) => w.geometry.map((g) => [g.lat, g.lon]));
        const nearest = polylines.length ? nearestPointOnPolyline(lat, lon, polylines) : null;
        if (nearest) roadPoint = { lat: nearest.lat, lon: nearest.lon };
      } finally { clearTimeout(opTimer); }
    } catch {
      // ignore overpass errors; fall back below
    }

    // Step 3: derive entrance candidate
    const bbox = { south, west, north, east };
    let entrance = null;
    let method = 'center_as_entrance';
    const fpLines = footprint ? footprintToPolylines(footprint) : [];
    if (roadPoint) {
      if (fpLines.length) {
        const p = nearestPointOnPolyline(roadPoint.lat, roadPoint.lon, fpLines);
        if (p) { entrance = { lat: p.lat, lon: p.lon }; method = 'nearest_road_projection_polygon'; }
      }
      if (!entrance) { entrance = projectToBBoxEdge(roadPoint.lat, roadPoint.lon, bbox); method = 'nearest_road_projection_bbox'; }
    } else {
      if (fpLines.length) {
        const p = nearestPointOnPolyline(lat, lon, fpLines);
        if (p) { entrance = { lat: p.lat, lon: p.lon }; method = 'center_projection_polygon'; }
      }
      if (!entrance) { entrance = projectToBBoxEdge(lat, lon, bbox); method = 'center_projection_bbox'; }
    }

    if (!entrance) { entrance = { lat, lon }; method = 'center_fallback'; }
    const distance_m = haversineMeters(lat, lon, entrance.lat, entrance.lon);

    // Persist a session with a richer map
    const sessionId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch {}

    const weightsPath = process.env.CNN_WEIGHTS || CNN_DEFAULT_WEIGHTS;
    const hasWeights = Boolean(weightsPath && fs.existsSync(weightsPath));
    const candidates = [ { ...entrance, score: 0.9, label: 'Projected entrance', source: 'heuristic' } ];
    let cnnSummary = null;
    let cnnDiagnostics = hasWeights ? { status: 'pending' } : { status: 'skipped', reason: 'weights_missing', weightsPath };
    if (hasWeights) {
      try {
        const cnnResult = await runCnnPrediction({ centerLat: lat, centerLon: lon, sessionDir });
        if (cnnResult && cnnResult.ok && cnnResult.payload && cnnResult.payload.prediction) {
          const payload = cnnResult.payload;
          const pred = payload.prediction;
          const cnnLat = Number(pred.lat);
          const cnnLon = Number(pred.lon);
          if (Number.isFinite(cnnLat) && Number.isFinite(cnnLon)) {
            const distanceCenter = haversineMeters(lat, lon, cnnLat, cnnLon);
            const distanceHeuristic = haversineMeters(entrance.lat, entrance.lon, cnnLat, cnnLon);
            const imageUrl = cnnResult.imagePath ? `/sessions/${sessionId}/${path.basename(cnnResult.imagePath)}` : null;
            cnnSummary = {
              lat: cnnLat,
              lon: cnnLon,
              method: 'cnn_regressor',
              runtime_ms: typeof payload.runtime_ms === 'number' ? payload.runtime_ms : null,
              distance_from_center_m: distanceCenter,
              difference_from_heuristic_m: distanceHeuristic,
              image_url: imageUrl,
              x_norm: pred.x_norm,
              y_norm: pred.y_norm,
              px: pred.px,
              py: pred.py,
              zoom: payload.zoom,
              img_size_px: payload.img_size_px,
            };
            candidates.push({ lat: cnnLat, lon: cnnLon, score: 0.92, label: 'CNN entrance', source: 'cnn' });
          }
          cnnDiagnostics = { status: 'ok', runtime_ms: payload.runtime_ms ?? null };
        } else if (cnnResult) {
          cnnDiagnostics = {
            status: 'error',
            reason: cnnResult.reason || 'unknown',
            error: cnnResult.error,
          };
          if (cnnResult.stdout) cnnDiagnostics.stdout = cnnResult.stdout;
          if (cnnResult.stderr) cnnDiagnostics.stderr = cnnResult.stderr;
          if (cnnResult.reason === 'weights_missing') cnnDiagnostics.weightsPath = weightsPath;
        }
      } catch (err) {
        const message = err && (err.message || String(err));
        cnnDiagnostics = { status: 'error', reason: 'exception', error: message };
      }
      if (cnnDiagnostics && cnnDiagnostics.status === 'pending') {
        cnnDiagnostics = { status: 'error', reason: 'no_output' };
      }
    }

    const sessionJson = {
      sessionId,
      receivedAt: new Date().toISOString(),
      request: { method: req.method, path: req.path, originalUrl: req.originalUrl, ip: req.ip, query: req.query, headers: req.headers },
      result: {
        query: q,
        provider: raw && raw.__provider ? raw.__provider : 'nominatim',
        center: { lat, lon },
        bbox,
        footprint,
        roadPoint,
        entrance: { ...entrance, method, distance_m },
        cnn: cnnSummary,
        cnnDiagnostics,
        candidates,
      },
    };
    try { fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(sessionJson, null, 2)); } catch {}

    // Build HTML map with markers
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Session ${sessionId} – Entrance Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob: https://unpkg.com https://server.arcgisonline.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src * data: blob:;" />
  <meta name="robots" content="noindex" />
  <link rel="icon" href="data:," />
  </head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <script>
    const south = ${south};
    const west = ${west};
    const north = ${north};
    const east = ${east};
    const center = [${lat}, ${lon}];
    const entrance = [${entrance.lat}, ${entrance.lon}];
    const cnn = ${cnnSummary ? `[${cnnSummary.lat}, ${cnnSummary.lon}]` : 'null'};
    ${roadPoint ? `const road = [${roadPoint.lat}, ${roadPoint.lon}];` : 'const road = null;'}

    const map = L.map('map', { zoomControl: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(map);
    const footprint = ${JSON.stringify(footprint || null)};
    if (footprint) {
      const layer = L.geoJSON(footprint, { style: { color: '#1e90ff', weight: 2, fillOpacity: 0.15 } }).addTo(map);
      try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch { map.setView(center, 19); }
    } else {
      const bounds = L.latLngBounds([ [south, west], [north, east] ]);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
    L.marker(center, { title: 'Center' }).addTo(map).bindPopup('Center');
    if (road) L.marker(road, { title: 'Nearest road', icon: L.divIcon({className:'', html:'<div style="width:12px;height:12px;background:gold;border:2px solid #333;border-radius:50%"></div>'}) }).addTo(map).bindPopup('Nearest road point');
    L.marker(entrance, { title: 'Entrance', icon: L.divIcon({className:'', html:'<div style="width:14px;height:14px;background:#e33;border:2px solid #600;border-radius:50%"></div>'}) }).addTo(map).bindPopup('Heuristic entrance');
    if (cnn) L.marker(cnn, { title: 'CNN entrance', icon: L.divIcon({className:'', html:'<div style="width:14px;height:14px;background:#2680ff;border:2px solid #063c9d;border-radius:50%"></div>'}) }).addTo(map).bindPopup('CNN entrance');
  </script>
 </body>
 </html>`;
    try { fs.writeFileSync(path.join(sessionDir, 'map.html'), html); } catch {}

    const mapUrl = `/sessions/${sessionId}/map.html`;
    return res.status(200).json({
      query: q,
      provider: raw && raw.__provider ? raw.__provider : 'nominatim',
      center: { lat, lon },
      bbox,
      roadPoint,
      entrance: { ...entrance, method, distance_m },
      cnnEntrance: cnnSummary,
      cnnDiagnostics,
      candidates,
      sessionId,
      sessionDir: `/sessions/${sessionId}/`,
      mapUrl,
    });
  } catch (e) {
    const isAbort = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    if (isAbort) return res.status(504).json({ error: 'timeout' });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Generic handler: respond "ping" for any route/method, echoing safe info
app.use((req, res) => {
  const safeQuery = { ...req.query };
  const safeHeaders = {
    'user-agent': req.get('user-agent') || undefined,
    'x-forwarded-for': req.get('x-forwarded-for') || undefined,
    'x-real-ip': req.get('x-real-ip') || undefined,
  };
  res.status(200).json({
    message: 'ping',
    method: req.method,
    path: req.path,
    query: safeQuery,
    headers: safeHeaders,
    timestamp: new Date().toISOString(),
  });
});

// Error handler (last)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: 'internal_error' });
});

const server = app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

// Optional public tunnel
if (ENABLE_TUNNEL) {
  if (TUNNEL_PROVIDER === 'localtunnel') {
    // Defer requiring to avoid cost when disabled
    const localtunnel = require('localtunnel');
    (async () => {
      try {
        const tunnel = await localtunnel({ port: PORT, subdomain: TUNNEL_SUBDOMAIN });
        // eslint-disable-next-line no-console
        console.log(`Public URL: ${tunnel.url}`);
        tunnel.on('close', () => {
          // eslint-disable-next-line no-console
          console.log('Tunnel closed');
        });
        process.on('SIGINT', () => {
          tunnel.close();
          server.close(() => process.exit(0));
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to start localtunnel:', e.message || e);
      }
    })();
  } else if (TUNNEL_PROVIDER === 'cloudflared') {
    // Launch a Cloudflare Quick Tunnel (no auth, no interstitial)
    // Requires 'cloudflared' binary in PATH (./run ensures this)
    const { spawn } = require('child_process');
    const args = ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'];
    let child;
    try {
      child = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to start cloudflared:', e && (e.message || e));
      child = null;
    }
    if (child) {
      let printed = false;
      const re = /https?:\/\/[^\s]*trycloudflare\.com/gi;
      function onData(buf) {
        const s = String(buf);
        const matches = s.match(re);
        if (!printed && matches && matches.length) {
          printed = true;
          // eslint-disable-next-line no-console
          console.log(`Public URL: ${matches[0]}`);
        }
      }
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('cloudflared error:', err && (err.message || err));
      });
      child.on('exit', (code, sig) => {
        // eslint-disable-next-line no-console
        console.log(`cloudflared exited (${sig || code})`);
      });
      process.on('SIGINT', () => {
        try { child.kill('SIGINT'); } catch {}
        server.close(() => process.exit(0));
      });
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(`Unknown TUNNEL_PROVIDER=${TUNNEL_PROVIDER}. No tunnel started.`);
  }
}

// Compute a small bbox centered on a point when missing from providers
function computeFallbackBBox(lat, lon, meters) {
  const m = Math.max(5, Number(meters) || DEFAULT_BBOX_METERS);
  const dLat = m / 111320; // degrees per meter latitude
  const dLon = m / (111320 * Math.cos((lat * Math.PI) / 180) || 1e-6);
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

// Unified geocoder with Nominatim primary (with polygon), Photon fallback, guaranteed bbox
async function geocodeAddress(query) {
  const headers = { 'User-Agent': 'rishabh-piyush/1.0 (+https://github.com/VerisimilitudeX/rishabh-piyush-placeholder)', 'Accept': 'application/json' };

  // Try Nominatim
  try {
    const url = new URL('/search', GEOCODER_BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('polygon_geojson', '1'); // request footprint
    try {
      const arr = await httpJson(url.toString(), { method: 'GET', headers, timeoutMs: 8000 });
      if (Array.isArray(arr) && arr.length) {
        const first = arr[0];
        const lat = Number(first.lat);
        const lon = Number(first.lon);
        let bbox = null;
        const bb = first.boundingbox || [];
        if (Array.isArray(bb) && bb.length >= 4) {
          const south = Number(bb[0]);
          const north = Number(bb[1]);
          const west = Number(bb[2]);
          const east = Number(bb[3]);
          if (![south, west, north, east].some((v) => Number.isNaN(v))) bbox = { south, west, north, east };
        }
        if (!bbox && Number.isFinite(lat) && Number.isFinite(lon)) bbox = computeFallbackBBox(lat, lon, DEFAULT_BBOX_METERS);
        const footprint = (first && first.geojson && (first.geojson.type === 'Polygon' || first.geojson.type === 'MultiPolygon')) ? first.geojson : null;
        if (bbox) return { lat, lon, bbox, footprint, raw: { ...first, __provider: 'nominatim' } };
      }
    } catch {}
  } catch {}

  // Fallback: Photon (Komoot)
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '1');
    try {
      const j = await httpJson(url.toString(), { method: 'GET', headers, timeoutMs: 8000 });
      const f = (j.features || [])[0];
      if (f && f.geometry && Array.isArray(f.geometry.coordinates)) {
        const [lon, lat] = f.geometry.coordinates;
        let bbox = null;
        const b = f.bbox || (f.properties && f.properties.extent);
        if (Array.isArray(b) && b.length >= 4) {
          const west = Number(b[0]);
          const south = Number(b[1]);
          const east = Number(b[2]);
          const north = Number(b[3]);
          if (![south, west, north, east].some((v) => Number.isNaN(v))) bbox = { south, west, north, east };
        }
        if (!bbox && Number.isFinite(lat) && Number.isFinite(lon)) bbox = computeFallbackBBox(lat, lon, DEFAULT_BBOX_METERS);
        if (bbox) return { lat, lon, bbox, footprint: null, raw: { ...f, __provider: 'photon' } };
      }
    } catch {}
  } catch {}

  return null;
}





