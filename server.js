/*
  Minimal secure Express API that responds with "ping" for any route/method.
  - Security: Helmet, CORS (configurable), rate limiting, tiny body limits, logging, compression
  - Config via env: see .env.example
  - Optional public exposure using Localtunnel when ENABLE_TUNNEL=1
*/

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

dotenv.config();

const app = express();

// Configuration with sensible defaults
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0'; // listen on all ifaces
const ENABLE_TUNNEL = String(process.env.ENABLE_TUNNEL || '').toLowerCase() === '1';
const TUNNEL_SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || undefined; // optional preferred subdomain
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'GET_ONLY';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const BODY_LIMIT = process.env.BODY_LIMIT || '10kb';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY || '1';

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
app.use(helmet({
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

// Health check
app.get(['/health', '/_health', '/ping'], (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ping' });
});

// Geocode bounding box endpoint
// GET /geocode/bbox?q=<human address>
// Returns: { query, provider, center: { lat, lon }, bbox: { south, west, north, east } }
const GEOCODER_BASE_URL = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org';
app.get('/geocode/bbox', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'missing_query', message: 'Provide address with ?q=' });
    if (q.length > 256) return res.status(400).json({ error: 'query_too_long' });

    const url = new URL('/search', GEOCODER_BASE_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');

    const headers = {
      'User-Agent': 'rishabh-piyush/1.0 (+https://github.com/VerisimilitudeX/rishabh-piyush-placeholder)',
      'Accept': 'application/json',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      if (typeof fetch !== 'function') throw new Error('fetch_unavailable');
      response = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response || !response.ok) {
      return res.status(502).json({ error: 'geocoder_unavailable' });
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const first = data[0];
    // Nominatim boundingbox is [south, north, west, east] as strings
    const bb = first.boundingbox || [];
    const south = Number(bb[0]);
    const north = Number(bb[1]);
    const west = Number(bb[2]);
    const east = Number(bb[3]);

    if ([south, west, north, east].some((v) => Number.isNaN(v))) {
      return res.status(500).json({ error: 'invalid_bbox' });
    }

    const lat = Number(first.lat);
    const lon = Number(first.lon);

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
        provider: 'nominatim',
        center: { lat, lon },
        bbox: { south, west, north, east },
        raw: first,
      },
    };
    try {
      fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(sessionJson, null, 2));
    } catch {}

    // Generate a minimal Leaflet-based HTML with Esri World Imagery and bbox overlay
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

    const map = L.map('map', { zoomControl: true });
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(map);
    const bounds = L.latLngBounds([ [south, west], [north, east] ]);
    map.fitBounds(bounds, { padding: [20, 20] });
    L.rectangle(bounds, { color: 'blue', weight: 2, fillOpacity: 0.15 }).addTo(map);
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
      provider: 'nominatim',
      center: { lat, lon },
      bbox: { south, west, north, east },
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
      console.error('Failed to start tunnel:', e.message || e);
    }
  })();
}

