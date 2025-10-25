const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
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
const COMMUNITY_DATA_DIR = path.resolve(__dirname, 'data');
const COMMUNITY_DATA_FILE = path.join(COMMUNITY_DATA_DIR, 'community-entrances.json');
const COMMUNITY_CLUSTER_METERS = Number(process.env.COMMUNITY_CLUSTER_METERS || 12);
const USER_DATA_FILE = path.join(COMMUNITY_DATA_DIR, 'user-profiles.json');
const SESSION_COOKIE = 'clearpath_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const MAX_RECENTS = Number(process.env.USER_MAX_RECENTS || 40);
const MAX_FAVORITES = Number(process.env.USER_MAX_FAVORITES || 40);
const SUPPORTED_TRAVEL_MODES = new Set(['drive', 'walk', 'transit', 'bike']);
const SUPPORTED_MAP_STYLES = new Set(['auto', 'light', 'dark', 'satellite', 'terrain']);
const WALKING_PACES = new Set(['slow', 'normal', 'brisk']);
const WEEKDAY_CODES = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function createDefaultPreferences() {
  return {
    defaultTravelMode: 'drive',
    mapStyle: 'auto',
    avoids: { tolls: false, highways: false, ferries: false },
    accessibilityProfiles: [],
    walkingSpeed: 'normal',
    liveTransitAlerts: true,
    proactiveSuggestions: true,
    notifications: {
      arrivalReminders: true,
      commuteInsights: false,
      savedPlaceUpdates: true,
    },
    voiceGuidance: true,
    haptics: true,
    units: 'imperial',
  };
}

function createDefaultCommutePlan() {
  return {
    morning: { time: '08:30', destinationLabel: 'Work', travelMode: 'drive' },
    evening: { time: '17:30', destinationLabel: 'Home', travelMode: 'drive' },
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  };
}

function createInitialSavedPlaces() {
  return {
    home: null,
    work: null,
    favorites: [],
    pinned: [],
  };
}

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session && typeof session.expiresAt === 'number' && session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref?.();

try { fs.mkdirSync(COMMUNITY_DATA_DIR, { recursive: true }); } catch {}
ensureCommunityStore();
ensureUserStore();


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

// Account + personalization APIs (JSON store backed)
app.post('/api/users/signup', async (req, res) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) {
      return res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters.' });
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';

    const store = await readUserStore();
    if (store.users.some((user) => user.email === email)) {
      return res.status(409).json({ error: 'email_in_use' });
    }

    const { hash, salt } = hashPassword(password);
    const nowIso = new Date().toISOString();
    const userRecord = normalizeUserRecord({
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
      email,
      name: name || email.split('@')[0],
      passwordHash: hash,
      salt,
      createdAt: nowIso,
      updatedAt: nowIso,
      preferences: body.preferences || {},
      savedPlaces: body.savedPlaces || {},
      commutePlan: body.commutePlan || {},
      recents: [],
      metrics: { searches: 0, lastLoginAt: nowIso, lastActiveAt: nowIso },
    });

    store.users.push(userRecord);
    await writeUserStore(store);

    const token = createSession(userRecord.id);
    setSessionCookie(res, token, req);

    return res.status(201).json({ token, user: sanitizeUser(userRecord) });
  } catch (error) {
    console.error('Signup failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'invalid_credentials' });
    }

    const user = await loadUserByEmail(email);
    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const token = createSession(user.id);
    setSessionCookie(res, token, req);
    const nowIso = new Date().toISOString();
    const updated = await updateUserRecord(user.id, (record) => {
      if (!record.metrics) record.metrics = {};
      record.metrics.lastLoginAt = nowIso;
      record.metrics.lastActiveAt = nowIso;
    });

    return res.status(200).json({ token, user: updated || sanitizeUser(user) });
  } catch (error) {
    console.error('Login failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/users/logout', authenticate, (req, res) => {
  try {
    if (req.authToken) destroySession(req.authToken);
    clearSessionCookie(res);
    return res.status(204).end();
  } catch (error) {
    console.error('Logout failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/users/me', authenticate, async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    const updated = await updateUserRecord(req.user.id, (record) => {
      if (!record.metrics) record.metrics = {};
      record.metrics.lastActiveAt = nowIso;
    });
    return res.status(200).json({ user: updated || req.user });
  } catch (error) {
    console.error('Profile load failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.patch('/api/users/me', authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const updated = await updateUserRecord(req.user.id, (record) => {
      if (typeof body.name === 'string') {
        const trimmed = body.name.trim().slice(0, 80);
        if (trimmed) record.name = trimmed;
      }

      if (body.preferences && typeof body.preferences === 'object') {
        record.preferences = mergePreferences(record.preferences, body.preferences);
      }

      if (body.savedPlaces && typeof body.savedPlaces === 'object') {
        if (!record.savedPlaces) record.savedPlaces = createInitialSavedPlaces();
        if (Object.prototype.hasOwnProperty.call(body.savedPlaces, 'home')) {
          record.savedPlaces.home = body.savedPlaces.home ? normalizePlace(body.savedPlaces.home, 'home') : null;
        }
        if (Object.prototype.hasOwnProperty.call(body.savedPlaces, 'work')) {
          record.savedPlaces.work = body.savedPlaces.work ? normalizePlace(body.savedPlaces.work, 'work') : null;
        }
        if (Array.isArray(body.savedPlaces.favorites)) {
          record.savedPlaces.favorites = body.savedPlaces.favorites
            .map((place) => normalizePlace(place, place?.category || 'favorite'))
            .filter(Boolean)
            .slice(0, MAX_FAVORITES);
        }
      }

      if (body.commutePlan && typeof body.commutePlan === 'object') {
        const nextPlan = {
          ...record.commutePlan,
          ...body.commutePlan,
          morning: { ...(record.commutePlan?.morning || {}), ...(body.commutePlan.morning || {}) },
          evening: { ...(record.commutePlan?.evening || {}), ...(body.commutePlan.evening || {}) },
        };
        record.commutePlan = mergeCommutePlan(nextPlan);
      }

      if (!record.metrics) record.metrics = {};
      record.metrics.lastActiveAt = new Date().toISOString();
    });

    if (!updated) {
      return res.status(404).json({ error: 'not_found' });
    }

    return res.status(200).json({ user: updated });
  } catch (error) {
    console.error('Profile update failed', error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'invalid_request' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/users/me/saved-places', authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const placePayload = body.place && typeof body.place === 'object' ? body.place : body;
    let favorite = null;
    const updated = await updateUserRecord(req.user.id, (record) => {
      if (!record.savedPlaces) record.savedPlaces = createInitialSavedPlaces();
      favorite = addFavoriteToUser(record, { ...placePayload, category: placePayload?.category || body.category || 'favorite' });
      if (!favorite) {
        const err = new Error('invalid_place');
        err.statusCode = 400;
        throw err;
      }
      if (!record.metrics) record.metrics = {};
      record.metrics.lastActiveAt = new Date().toISOString();
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.status(201).json({ user: updated, favorite });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ error: 'invalid_place' });
    }
    console.error('Favorite add failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.delete('/api/users/me/saved-places/:placeId', authenticate, async (req, res) => {
  try {
    const { placeId } = req.params;
    if (!placeId) {
      return res.status(400).json({ error: 'missing_place_id' });
    }
    let removed = false;
    const updated = await updateUserRecord(req.user.id, (record) => {
      removed = removeFavoriteFromUser(record, placeId);
      if (!removed) return;
      if (!record.metrics) record.metrics = {};
      record.metrics.lastActiveAt = new Date().toISOString();
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (!removed) {
      return res.status(404).json({ error: 'favorite_not_found' });
    }
    return res.status(200).json({ user: updated });
  } catch (error) {
    console.error('Favorite removal failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/users/me/recents', authenticate, async (req, res) => {
  try {
    const payload = req.body || {};
    let recentEntry = null;
    const updated = await updateUserRecord(req.user.id, (record) => {
      recentEntry = addRecentToUser(record, payload);
      if (!recentEntry) {
        const err = new Error('invalid_recent');
        err.statusCode = 400;
        throw err;
      }
      if (!record.metrics) record.metrics = {};
      record.metrics.searches = Number.isFinite(record.metrics.searches) ? Number(record.metrics.searches) + 1 : 1;
      record.metrics.lastActiveAt = new Date().toISOString();
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.status(201).json({ user: updated, recent: recentEntry });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ error: 'invalid_recent' });
    }
    console.error('Recent add failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
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
    const latParam = Number(req.query.lat);
    const lonParam = Number(req.query.lon);
    if (!q || q.length < 2) {
      return res.status(200).json({ provider: 'photon', suggestions: [], results: [] });
    }
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', limit);
    if (Number.isFinite(latParam) && Number.isFinite(lonParam)) {
      url.searchParams.set('lat', latParam.toFixed(6));
      url.searchParams.set('lon', lonParam.toFixed(6));
    }

    let suggestions = [];
    let results = [];
    try {
      const responseHeaders = {
        'User-Agent': 'rishabh-piyush/1.0 (+https://github.com/VerisimilitudeX/rishabh-piyush-placeholder)',
        'Accept': 'application/json',
      };
      const j = await httpJson(url.toString(), { method: 'GET', headers: responseHeaders, timeoutMs: 6000 });
      const features = (j.features || [])
        .map((f) => {
          if (!f || !f.properties) return null;
          const label = f.properties.label || f.properties.name;
          if (!label) return null;
          const coords = Array.isArray(f.geometry && f.geometry.coordinates) ? f.geometry.coordinates : null;
          const lon = coords ? Number(coords[0]) : null;
          const lat = coords ? Number(coords[1]) : null;
          const context = [f.properties.city, f.properties.state, f.properties.country]
            .filter(Boolean)
            .join(', ');
          let distance = null;
          if (Number.isFinite(latParam) && Number.isFinite(lonParam) && Number.isFinite(lat) && Number.isFinite(lon)) {
            distance = haversineMeters(latParam, lonParam, lat, lon);
          }
          return { label, lat, lon, context, distance };
        })
        .filter(Boolean);

      if (Number.isFinite(latParam) && Number.isFinite(lonParam)) {
        features.sort((a, b) => {
          const da = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
          const db = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
          if (da === db) return 0;
          return da < db ? -1 : 1;
        });
      }

      const seen = new Set();
      for (const feature of features) {
        if (seen.has(feature.label)) continue;
        seen.add(feature.label);
        suggestions.push(feature.label);
        results.push(feature);
      }
    } catch {}
    return res.status(200).json({ provider: 'photon', suggestions, results });
  } catch {
    return res.status(200).json({ provider: 'photon', suggestions: [], results: [] });
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

function ensureUserStore() {
  try {
    if (!fs.existsSync(USER_DATA_FILE)) {
      const seed = { version: 1, updatedAt: new Date().toISOString(), users: [] };
      fs.writeFileSync(USER_DATA_FILE, JSON.stringify(seed, null, 2));
      return;
    }
    const raw = fs.readFileSync(USER_DATA_FILE, 'utf8');
    if (!raw) {
      const seed = { version: 1, updatedAt: new Date().toISOString(), users: [] };
      fs.writeFileSync(USER_DATA_FILE, JSON.stringify(seed, null, 2));
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users)) {
      const seed = { version: 1, updatedAt: new Date().toISOString(), users: [] };
      fs.writeFileSync(USER_DATA_FILE, JSON.stringify(seed, null, 2));
    }
  } catch (error) {
    console.warn('Unable to initialize user store, resetting to blank store.', error?.message || error);
    try {
      const seed = { version: 1, updatedAt: new Date().toISOString(), users: [] };
      fs.writeFileSync(USER_DATA_FILE, JSON.stringify(seed, null, 2));
    } catch (writeError) {
      console.error('Failed to reset user store', writeError);
    }
  }
}

async function readUserStore() {
  try {
    const raw = await fsp.readFile(USER_DATA_FILE, 'utf8');
    if (!raw) {
      return { version: 1, updatedAt: null, users: [] };
    }
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed.users) ? parsed.users.map(normalizeUserRecord).filter(Boolean) : [];
    return { version: parsed.version || 1, updatedAt: parsed.updatedAt || null, users };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await writeUserStore({ version: 1, users: [] });
      return { version: 1, updatedAt: null, users: [] };
    }
    console.warn('Unable to read user store, returning empty store.', error?.message || error);
    return { version: 1, updatedAt: null, users: [] };
  }
}

async function writeUserStore(store) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    users: Array.isArray(store?.users) ? store.users.map(normalizeUserRecord).filter(Boolean) : [],
  };
  await fsp.writeFile(USER_DATA_FILE, JSON.stringify(payload, null, 2));
}

function normalizeUserRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const nowIso = new Date().toISOString();
  const id = record.id || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'));
  const email = String(record.email || '').trim().toLowerCase();
  if (!email) return null;
  const name = record.name && typeof record.name === 'string' ? record.name.trim().slice(0, 80) : 'Explorer';
  const passwordHash = typeof record.passwordHash === 'string' ? record.passwordHash : '';
  const salt = typeof record.salt === 'string' ? record.salt : '';
  const createdAt = record.createdAt && typeof record.createdAt === 'string' ? record.createdAt : nowIso;
  const updatedAt = record.updatedAt && typeof record.updatedAt === 'string' ? record.updatedAt : createdAt;
  const metrics = mergeMetrics(record.metrics);

  return {
    id,
    email,
    name,
    passwordHash,
    salt,
    createdAt,
    updatedAt,
    preferences: mergePreferences(record.preferences),
    savedPlaces: mergeSavedPlaces(record.savedPlaces),
    commutePlan: mergeCommutePlan(record.commutePlan),
    recents: mergeRecents(record.recents),
    metrics,
  };
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const { passwordHash, salt, ...rest } = user;
  try {
    return JSON.parse(JSON.stringify(rest));
  } catch {
    return { ...rest };
  }
}

function mergeMetrics(metrics = {}) {
  const searches = Number.isFinite(metrics.searches) ? Number(metrics.searches) : 0;
  const lastLoginAt = metrics.lastLoginAt && typeof metrics.lastLoginAt === 'string' ? metrics.lastLoginAt : null;
  const lastActiveAt = metrics.lastActiveAt && typeof metrics.lastActiveAt === 'string' ? metrics.lastActiveAt : null;
  return { searches, lastLoginAt, lastActiveAt };
}

function mergePreferences(current = {}, updates = {}) {
  const base = createDefaultPreferences();
  const seed = { ...base, ...current };
  const result = { ...seed };

  if (updates.defaultTravelMode !== undefined) {
    if (isValidTravelMode(updates.defaultTravelMode)) {
      result.defaultTravelMode = updates.defaultTravelMode;
    }
  }
  if (updates.mapStyle !== undefined) {
    if (isValidMapStyle(updates.mapStyle)) {
      result.mapStyle = updates.mapStyle;
    }
  }
  if (updates.walkingSpeed !== undefined) {
    if (WALKING_PACES.has(updates.walkingSpeed)) {
      result.walkingSpeed = updates.walkingSpeed;
    }
  }
  if (updates.liveTransitAlerts !== undefined) {
    result.liveTransitAlerts = Boolean(updates.liveTransitAlerts);
  }
  if (updates.proactiveSuggestions !== undefined) {
    result.proactiveSuggestions = Boolean(updates.proactiveSuggestions);
  }
  if (updates.voiceGuidance !== undefined) {
    result.voiceGuidance = Boolean(updates.voiceGuidance);
  }
  if (updates.haptics !== undefined) {
    result.haptics = Boolean(updates.haptics);
  }
  if (updates.units !== undefined && ['imperial', 'metric'].includes(updates.units)) {
    result.units = updates.units;
  }
  if (updates.accessibilityProfiles !== undefined) {
    if (Array.isArray(updates.accessibilityProfiles)) {
      const normalized = Array.from(new Set(updates.accessibilityProfiles.map((id) => String(id).trim()).filter(Boolean)));
      result.accessibilityProfiles = normalized;
    }
  }
  if (updates.avoids !== undefined) {
    result.avoids = {
      tolls: Boolean(updates.avoids?.tolls ?? seed.avoids.tolls),
      highways: Boolean(updates.avoids?.highways ?? seed.avoids.highways),
      ferries: Boolean(updates.avoids?.ferries ?? seed.avoids.ferries),
    };
  }
  if (updates.notifications !== undefined) {
    const incoming = updates.notifications || {};
    result.notifications = {
      arrivalReminders: Boolean(incoming.arrivalReminders ?? seed.notifications.arrivalReminders),
      commuteInsights: Boolean(incoming.commuteInsights ?? seed.notifications.commuteInsights),
      savedPlaceUpdates: Boolean(incoming.savedPlaceUpdates ?? seed.notifications.savedPlaceUpdates),
    };
  }

  return result;
}

function mergeSavedPlaces(raw = {}) {
  const result = createInitialSavedPlaces();
  if (raw.home) result.home = normalizePlace(raw.home, 'home');
  if (raw.work) result.work = normalizePlace(raw.work, 'work');
  if (Array.isArray(raw.favorites)) {
    result.favorites = raw.favorites
      .map((place) => normalizePlace(place, place?.category || 'favorite'))
      .filter(Boolean)
      .slice(0, MAX_FAVORITES);
  }
  if (Array.isArray(raw.pinned)) {
    result.pinned = raw.pinned
      .map((place) => normalizePlace(place, place?.category || 'pinned'))
      .filter(Boolean)
      .slice(0, 12);
  }
  return result;
}

function mergeRecents(raw = []) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const normalized = normalizeRecent(entry);
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
    if (out.length >= MAX_RECENTS) break;
  }
  return out;
}

function mergeCommutePlan(raw = {}) {
  const base = createDefaultCommutePlan();
  const days = Array.isArray(raw.days)
    ? raw.days.map((day) => String(day).trim().toLowerCase()).filter((day) => WEEKDAY_CODES.has(day))
    : base.days;
  const morning = normalizeCommuteLeg(raw.morning, base.morning);
  const evening = normalizeCommuteLeg(raw.evening, base.evening);
  return { days: days.length ? days : base.days, morning, evening };
}

function normalizeCommuteLeg(leg, fallback) {
  const defaults = fallback || { time: '08:30', destinationLabel: 'Work', travelMode: 'drive', placeId: null };
  if (!leg || typeof leg !== 'object') return { ...defaults };
  const time = typeof leg.time === 'string' && /^\d{2}:\d{2}$/.test(leg.time) ? leg.time : defaults.time;
  const destinationLabel = leg.destinationLabel && typeof leg.destinationLabel === 'string'
    ? leg.destinationLabel.trim().slice(0, 80)
    : defaults.destinationLabel;
  const travelMode = isValidTravelMode(leg.travelMode) ? leg.travelMode : defaults.travelMode;
  const placeId = leg.placeId && typeof leg.placeId === 'string' ? leg.placeId : null;
  return { time, destinationLabel, travelMode, placeId };
}

function normalizePlace(place, category = 'favorite') {
  if (!place || typeof place !== 'object') return null;
  const id = place.id && typeof place.id === 'string'
    ? place.id
    : (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'));
  const label = place.label && typeof place.label === 'string' ? place.label.trim().slice(0, 120) : 'Saved place';
  const address = place.address && typeof place.address === 'string' ? place.address.trim().slice(0, 200) : '';
  const lat = Number.isFinite(place.lat) ? Number(place.lat) : null;
  const lon = Number.isFinite(place.lon) ? Number(place.lon) : null;
  const note = place.note && typeof place.note === 'string' ? place.note.trim().slice(0, 160) : null;
  const color = place.color && typeof place.color === 'string' ? place.color.trim().slice(0, 24) : null;
  const icon = place.icon && typeof place.icon === 'string' ? place.icon.trim().slice(0, 24) : null;
  const tags = Array.isArray(place.tags)
    ? Array.from(new Set(place.tags.map((tag) => String(tag).trim().slice(0, 32)).filter(Boolean)))
    : [];
  const nowIso = new Date().toISOString();
  const createdAt = place.createdAt && typeof place.createdAt === 'string' ? place.createdAt : nowIso;
  const updatedAt = place.updatedAt && typeof place.updatedAt === 'string' ? place.updatedAt : nowIso;
  const metadata = place.metadata && typeof place.metadata === 'object' ? place.metadata : {};
  const source = place.source && typeof place.source === 'string' ? place.source.trim().slice(0, 40) : 'user';
  return { id, label, address, lat, lon, note, category, color, icon, tags, createdAt, updatedAt, metadata, source };
}

function normalizeRecent(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = entry.id && typeof entry.id === 'string'
    ? entry.id
    : (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex'));
  const label = entry.label && typeof entry.label === 'string' ? entry.label.trim().slice(0, 120) : 'Recent search';
  const address = entry.address && typeof entry.address === 'string' ? entry.address.trim().slice(0, 200) : '';
  const query = entry.query && typeof entry.query === 'string' ? entry.query.trim().slice(0, 256) : null;
  const lat = Number.isFinite(entry.lat) ? Number(entry.lat) : null;
  const lon = Number.isFinite(entry.lon) ? Number(entry.lon) : null;
  const type = entry.type && typeof entry.type === 'string' ? entry.type.trim().slice(0, 40) : 'search';
  const savedAt = entry.savedAt && typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString();
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
  return { id, label, address, query, lat, lon, type, savedAt, metadata };
}

function addRecentToUser(user, payload) {
  if (!user) return null;
  const entry = normalizeRecent(payload);
  if (!entry) return null;
  if (!Array.isArray(user.recents)) user.recents = [];
  user.recents = user.recents.filter((item) => item.id !== entry.id && item.query !== entry.query);
  user.recents.unshift(entry);
  user.recents = user.recents.slice(0, MAX_RECENTS);
  return entry;
}

function addFavoriteToUser(user, place) {
  if (!user) return null;
  if (!user.savedPlaces) user.savedPlaces = createInitialSavedPlaces();
  const normalized = normalizePlace(place, place?.category || 'favorite');
  if (!normalized) return null;
  const favorites = Array.isArray(user.savedPlaces.favorites) ? user.savedPlaces.favorites : [];
  const withoutExisting = favorites.filter((fav) => fav.id !== normalized.id);
  withoutExisting.unshift(normalized);
  user.savedPlaces.favorites = withoutExisting.slice(0, MAX_FAVORITES);
  return normalized;
}

function removeFavoriteFromUser(user, placeId) {
  if (!user || !user.savedPlaces || !Array.isArray(user.savedPlaces.favorites)) return false;
  const before = user.savedPlaces.favorites.length;
  user.savedPlaces.favorites = user.savedPlaces.favorites.filter((fav) => fav.id !== placeId);
  return user.savedPlaces.favorites.length !== before;
}

function isValidTravelMode(mode) {
  return typeof mode === 'string' && SUPPORTED_TRAVEL_MODES.has(mode);
}

function isValidMapStyle(style) {
  return typeof style === 'string' && SUPPORTED_MAP_STYLES.has(style);
}

function isValidEmail(email) {
  return typeof email === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(email);
}

function hashPassword(password, salt) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('invalid_password');
  }
  const resolvedSalt = salt || crypto.randomBytes(16).toString('hex');
  const buffer = crypto.scryptSync(password, resolvedSalt, 64);
  return { salt: resolvedSalt, hash: buffer.toString('hex') };
}

function verifyPassword(password, user) {
  if (!user || typeof password !== 'string' || !user.passwordHash || !user.salt) return false;
  try {
    const derived = crypto.scryptSync(password, user.salt, 64);
    const stored = Buffer.from(user.passwordHash, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

async function loadUserByEmail(email) {
  if (!isValidEmail(email)) return null;
  const normalized = email.trim().toLowerCase();
  const store = await readUserStore();
  return store.users.find((user) => user.email === normalized) || null;
}

async function loadUserById(userId) {
  if (!userId) return null;
  const store = await readUserStore();
  return store.users.find((user) => user.id === userId) || null;
}

async function updateUserRecord(userId, mutator) {
  if (!userId) return null;
  const store = await readUserStore();
  const index = store.users.findIndex((user) => user.id === userId);
  if (index === -1) return null;
  const record = store.users[index];
  await mutator(record, store);
  record.updatedAt = new Date().toISOString();
  store.users[index] = normalizeUserRecord(record);
  await writeUserStore(store);
  return sanitizeUser(store.users[index]);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { userId, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  if (!token) return;
  sessions.delete(token);
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function parseCookies(header) {
  if (!header || typeof header !== 'string') return {};
  return header.split(';').map((chunk) => chunk.trim()).filter(Boolean).reduce((acc, chunk) => {
    const eqIndex = chunk.indexOf('=');
    if (eqIndex === -1) return acc;
    const key = chunk.slice(0, eqIndex).trim();
    const value = chunk.slice(eqIndex + 1);
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const cookies = parseCookies(req.get('cookie'));
  if (cookies[SESSION_COOKIE]) {
    return cookies[SESSION_COOKIE];
  }
  return null;
}

function setSessionCookie(res, token, req) {
  if (!token) return;
  const secure = Boolean(req.secure || (req.get('x-forwarded-proto') || '').toLowerCase().startsWith('https'));
  if (typeof res.cookie === 'function') {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  } else {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
}

function clearSessionCookie(res) {
  if (typeof res.clearCookie === 'function') {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  } else {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  }
}

async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const session = getSession(token);
    if (!session) {
      return res.status(401).json({ error: 'invalid_session' });
    }
    const user = await loadUserById(session.userId);
    if (!user) {
      destroySession(token);
      return res.status(401).json({ error: 'invalid_session' });
    }
    req.authToken = token;
    req.user = sanitizeUser(user);
    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + SESSION_TTL_MS;
    return next();
  } catch (error) {
    console.error('Authentication failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
}

function incrementUserSearches(userId) {
  return updateUserRecord(userId, (record) => {
    if (!record.metrics) record.metrics = {};
    record.metrics.searches = Number.isFinite(record.metrics.searches) ? Number(record.metrics.searches) + 1 : 1;
    record.metrics.lastActiveAt = new Date().toISOString();
  });
}


function ensureCommunityStore() {
  if (!fs.existsSync(COMMUNITY_DATA_FILE)) {
    const seed = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
    try {
      fs.writeFileSync(COMMUNITY_DATA_FILE, JSON.stringify(seed, null, 2));
    } catch {
      // best-effort persistence; failures are surfaced on next write
    }
  }
}

function ensureUserStore() {
  if (!fs.existsSync(USER_DATA_FILE)) {
    const seed = { version: 1, updatedAt: new Date().toISOString(), profiles: {} };
    try {
      fs.writeFileSync(USER_DATA_FILE, JSON.stringify(seed, null, 2));
    } catch {
      // same best-effort persistence approach as community store
    }
  }
}

function readCommunityStore() {
  try {
    const raw = fs.readFileSync(COMMUNITY_DATA_FILE, 'utf8');
    if (!raw) return { version: 1, updatedAt: null, entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, updatedAt: null, entries: {} };
    if (!parsed.entries || typeof parsed.entries !== 'object') parsed.entries = {};
    return parsed;
  } catch {
    return { version: 1, updatedAt: null, entries: {} };
  }
}

function writeCommunityStore(store) {
  const payload = {
    version: 1,
    updatedAt: store?.updatedAt || new Date().toISOString(),
    entries: store?.entries || {},
  };
  try {
    fs.writeFileSync(COMMUNITY_DATA_FILE, JSON.stringify(payload, null, 2));
  } catch {
    console.warn('Unable to persist community entrance data');
  }
}

function normalizeQueryKey(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 256);
}

function buildCommunitySummaryFromStore(store, key) {
  const entry = store?.entries?.[key];
  if (!entry || !Array.isArray(entry.clusters) || !entry.clusters.length) {
    return {
      key,
      totalVotes: 0,
      clusters: [],
      clusterRadius: COMMUNITY_CLUSTER_METERS,
      updatedAt: entry?.updatedAt || null,
    };
  }
  const clusters = entry.clusters
    .map((cluster) => ({
      id: cluster.id,
      lat: cluster.lat,
      lon: cluster.lon,
      count: cluster.count,
      label: cluster.label || null,
      createdAt: cluster.createdAt || null,
      updatedAt: cluster.updatedAt || entry.updatedAt || store.updatedAt || null,
    }))
    .filter((cluster) => Number.isFinite(cluster.lat) && Number.isFinite(cluster.lon) && Number(cluster.count) > 0);
  clusters.sort((a, b) => {
    const diff = Number(b.count) - Number(a.count);
    if (diff !== 0) return diff;
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0;
    return bTime - aTime;
  });
  const totalVotes = clusters.reduce((sum, cluster) => sum + (Number(cluster.count) || 0), 0);
  return {
    key,
    totalVotes,
    clusters,
    clusterRadius: COMMUNITY_CLUSTER_METERS,
    updatedAt: entry.updatedAt || store.updatedAt || null,
  };
}

function summarizeCommunityEntrances(query) {
  const key = normalizeQueryKey(query);
  if (!key) {
    return { key, totalVotes: 0, clusters: [], clusterRadius: COMMUNITY_CLUSTER_METERS, updatedAt: null };
  }
  const store = readCommunityStore();
  return buildCommunitySummaryFromStore(store, key);
}

function recordCommunityVote({ query, lat, lon, label }) {
  const key = normalizeQueryKey(query);
  if (!key) throw new Error('invalid_query_key');
  const store = readCommunityStore();
  if (!store.entries || typeof store.entries !== 'object') store.entries = {};
  const now = new Date().toISOString();
  let entry = store.entries[key];
  if (!entry) {
    entry = { query, createdAt: now, updatedAt: now, clusters: [] };
    store.entries[key] = entry;
  }
  if (!Array.isArray(entry.clusters)) entry.clusters = [];

  let best = null;
  for (const cluster of entry.clusters) {
    if (!Number.isFinite(cluster.lat) || !Number.isFinite(cluster.lon) || !Number.isFinite(cluster.count)) continue;
    const distance = haversineMeters(lat, lon, cluster.lat, cluster.lon);
    if (distance <= COMMUNITY_CLUSTER_METERS) {
      if (!best || distance < best.distance) {
        best = { cluster, distance };
      }
    }
  }

  if (best) {
    const target = best.cluster;
    const existingCount = Number(target.count) || 0;
    const newCount = existingCount + 1;
    target.lat = ((target.lat * existingCount) + lat) / newCount;
    target.lon = ((target.lon * existingCount) + lon) / newCount;
    target.count = newCount;
    if (label && typeof label === 'string' && label.trim()) {
      target.label = label.trim().slice(0, 120);
    }
    target.updatedAt = now;
  } else {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex');
    const cluster = {
      id,
      lat,
      lon,
      count: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (label && typeof label === 'string' && label.trim()) {
      cluster.label = label.trim().slice(0, 120);
    }
    entry.clusters.push(cluster);
  }

  entry.updatedAt = now;
  store.updatedAt = now;
  writeCommunityStore(store);

  const summary = buildCommunitySummaryFromStore(store, key);
  const targetId = best ? best.cluster.id : entry.clusters[entry.clusters.length - 1].id;
  const cluster = summary.clusters.find((c) => c.id === targetId) || null;
  return { cluster, summary };
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

    const communitySummary = summarizeCommunityEntrances(q);
    if (communitySummary && Array.isArray(communitySummary.clusters) && communitySummary.clusters.length) {
      const topCluster = communitySummary.clusters[0];
      candidates.push({
        lat: topCluster.lat,
        lon: topCluster.lon,
        score: 0.88,
        label: `${topCluster.count} community vote${topCluster.count === 1 ? '' : 's'}`,
        source: 'community',
        communityClusterId: topCluster.id,
        votes: topCluster.count,
      });
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
        communityEntrances: communitySummary,
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
      footprint,
      roadPoint,
      entrance: { ...entrance, method, distance_m },
      cnnEntrance: cnnSummary,
      cnnDiagnostics,
      candidates,
      communityEntrances: communitySummary,
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

app.post('/entrance/community', (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) return res.status(400).json({ error: 'missing_query', message: 'Provide address text in body.query' });
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'invalid_lat' });
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'invalid_lon' });
    }
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const result = recordCommunityVote({ query, lat, lon, label });
    return res.status(200).json({ ok: true, cluster: result.cluster, summary: result.summary });
  } catch (error) {
    console.warn('Failed to record community entrance vote', error);
    return res.status(500).json({ error: 'vote_failed' });
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
