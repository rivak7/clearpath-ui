import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { haversineDistance, boundingBox, bboxPolygon, centerFromPolygon, clampPointToPolygon, hashPlace, projectPointToLine } from './lib/geo.js';
import { TokenBucket } from './lib/throttle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const CONFIRM_FILE = path.join(DATA_DIR, 'confirmations.json');
const CORRECT_FILE = path.join(DATA_DIR, 'corrections.json');

const USER_AGENT = 'ClearPathApp/1.0 (for research; contact: example@clearpath.app)';

const geocodeCache = new Map();
const entranceCache = new Map();
const overpassCache = new Map();
const overpassBucket = new TokenBucket({ ratePerSecond: 0.5, burst: 1 });
const suggestBucket = new TokenBucket({ ratePerSecond: 1, burst: 2 });

async function ensureDataFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]', 'utf8');
  }
}

await ensureDataFile(CONFIRM_FILE);
await ensureDataFile(CORRECT_FILE);
await fs.mkdir(SESSIONS_DIR, { recursive: true });

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '32kb' }));

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
app.use('/api/', limiter);

app.use(express.static(PUBLIC_DIR, { maxAge: '1d', index: 'index.html' }));

app.get('/api/ping', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/health', async (req, res) => {
  const [confirmations, corrections] = await Promise.all([
    loadJson(CONFIRM_FILE),
    loadJson(CORRECT_FILE)
  ]);
  res.json({
    confirmations: confirmations.length,
    corrections: corrections.length
  });
});

app.get('/api/geocode/suggest', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    res.status(400).json({ error: 'Query q is required' });
    return;
  }
  const ip = req.ip || 'anon';
  if (!suggestBucket.take(ip)) {
    res.status(429).json({ error: 'Please wait a moment before searching again.' });
    return;
  }
  try {
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lon = req.query.lon ? Number(req.query.lon) : undefined;
    const suggestions = await fetchSuggestions(query);
    const enriched = suggestions.map((item) => ({
      ...item,
      distanceMeters: lat !== undefined && lon !== undefined ? Math.round(haversineDistance({ lat, lon }, { lat: item.lat, lon: item.lon })) : undefined
    }));
    res.json(enriched.slice(0, 7));
  } catch (error) {
    console.error('Suggest error', error);
    res.status(502).json({ error: 'Geocode service unavailable' });
  }
});

app.get('/api/entrance', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    res.status(400).json({ error: 'Query q is required' });
    return;
  }
  try {
    const cached = entranceCache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const geocode = await geocodeDetail(query);
    if (!geocode) {
      res.status(404).json({ error: 'No geocode match' });
      return;
    }

    const center = { lat: Number(geocode.lat), lon: Number(geocode.lon) };
    const bbox = geocode.boundingbox.map(Number); // [south, north, west, east]
    const shape = normalizePolygon(geocode.geojson);
    const centroid = centerFromPolygon(shape) || center;
    const searchBox = tightenBoundingBox(bbox, centroid);

    const overpass = await fetchOverpass(searchBox);
    const paths = extractPaths(overpass);
    const roads = extractRoads(overpass);

    const entranceGuess = computeEntrance({ shape, centroid, paths, center });
    const dropoff = computeDropoff(entranceGuess.point, roads);
    const method = entranceGuess.method;
    const confidence = entranceGuess.confidence;
    const entrancePoint = entranceGuess.point;

    const placeId = hashPlace(`${geocode.display_name}-${center.lat}-${center.lon}`);
    const corrections = await loadJson(CORRECT_FILE);
    const correctionMatches = corrections.filter((entry) => entry.placeId === placeId);
    const appliedCorrection = correctionMatches.length > 0 ? correctionMatches[correctionMatches.length - 1] : null;
    let entrance = {
      lat: entrancePoint.lat,
      lon: entrancePoint.lon,
      confidence,
      accessible: false
    };
    if (appliedCorrection) {
      entrance = {
        lat: appliedCorrection.entrance.lat,
        lon: appliedCorrection.entrance.lon,
        confidence: 'high',
        accessible: appliedCorrection.entrance.accessible
      };
    }

    const confirmations = await loadJson(CONFIRM_FILE);
    const verifiedCount = confirmations.filter((entry) => entry.placeId === placeId).length;
    const lastVerified = confirmations
      .filter((entry) => entry.placeId === placeId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]?.timestamp;

    const response = {
      id: placeId,
      name: geocode.display_name,
      center,
      bbox: [searchBox[2], searchBox[0], searchBox[3], searchBox[1]],
      method,
      entrance,
      dropoff,
      footprint: shape,
      paths: paths.map((line) => ({
        id: line.id,
        type: 'LineString',
        coordinates: line.points.map((point) => [point.lon, point.lat])
      })),
      verifiedCount,
      lastVerifiedAt: lastVerified || null
    };

    const cacheEntry = { data: response, expiresAt: Date.now() + 1000 * 60 * 10 };
    entranceCache.set(query, cacheEntry);
    entranceCache.set(response.id, cacheEntry);
    await logSession(placeId, { query, response });

    res.json(response);
  } catch (error) {
    console.error('Entrance error', error);
    res.status(502).json({ error: 'Entrance lookup failed' });
  }
});

app.post('/api/confirm', async (req, res) => {
  const { placeId, entrance } = req.body || {};
  if (!placeId || !entrance) {
    res.status(400).json({ error: 'placeId and entrance required' });
    return;
  }
  const confirmations = await loadJson(CONFIRM_FILE);
  const record = {
    placeId,
    entrance,
    timestamp: new Date().toISOString(),
    fingerprint: hashPlace(`${req.ip}-${req.headers['user-agent'] || ''}`)
  };
  confirmations.push(record);
  await saveJson(CONFIRM_FILE, confirmations);
  await logSession(placeId, { type: 'confirm', record });
  res.json({ ok: true });
});

app.post('/api/correct', async (req, res) => {
  const { placeId, entrance } = req.body || {};
  if (!placeId || !entrance) {
    res.status(400).json({ error: 'placeId and entrance required' });
    return;
  }
  const corrections = await loadJson(CORRECT_FILE);
  const record = {
    placeId,
    entrance,
    timestamp: new Date().toISOString()
  };
  corrections.push(record);
  await saveJson(CORRECT_FILE, corrections);
  await logSession(placeId, { type: 'correct', record });
  for (const [key, value] of [...entranceCache.entries()]) {
    if (value?.data?.id === placeId || key === placeId) {
      entranceCache.delete(key);
    }
  }
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ClearPath server running on http://localhost:${PORT}`);
});

async function loadJson(file) {
  try {
    const content = await fs.readFile(file, 'utf8');
    return JSON.parse(content || '[]');
  } catch (error) {
    console.error('Failed to read JSON', file, error);
    return [];
  }
}

async function saveJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchSuggestions(query) {
  const cacheKey = `suggest:${query}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '7');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en'
    }
  });
  if (!response.ok) {
    throw new Error(`Nominatim error ${response.status}`);
  }
  const data = await response.json();
  const suggestions = data.map((item) => ({
    id: hashPlace(`${item.display_name}-${item.lat}-${item.lon}`),
    name: item.display_name.split(',')[0],
    context: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon)
  }));
  geocodeCache.set(cacheKey, { data: suggestions, expiresAt: Date.now() + 1000 * 60 * 5 });
  return suggestions;
}

async function geocodeDetail(query) {
  const cacheKey = `detail:${query}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en'
    }
  });
  if (!response.ok) {
    throw new Error(`Nominatim detail error ${response.status}`);
  }
  const data = await response.json();
  const result = data[0] || null;
  if (result) {
    geocodeCache.set(cacheKey, { data: result, expiresAt: Date.now() + 1000 * 60 * 5 });
  }
  return result;
}

function tightenBoundingBox(bbox, centroid) {
  const south = bbox[0];
  const north = bbox[1];
  const west = bbox[2];
  const east = bbox[3];
  const width = Math.abs(east - west);
  const height = Math.abs(north - south);
  if (width * height > 0.01) {
    const custom = boundingBox(centroid, 60);
    return [custom[1], custom[3], custom[0], custom[2]];
  }
  return [south, north, west, east];
}

function normalizePolygon(geojson) {
  if (!geojson) return null;
  if (geojson.type === 'Polygon') return geojson;
  if (geojson.type === 'MultiPolygon') {
    const first = geojson.coordinates[0];
    return {
      type: 'Polygon',
      coordinates: first
    };
  }
  return null;
}

async function fetchOverpass(bbox) {
  const key = bbox.join(',');
  const cached = overpassCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  if (!overpassBucket.take('global')) {
    return cached?.data || { elements: [] };
  }
  const [south, north, west, east] = bbox;
  const query = `
    [out:json][timeout:25];
    (
      way["highway"]["area"!="yes"](${south},${west},${north},${east});
      way["footway"](${south},${west},${north},${east});
      way["sidewalk"](${south},${west},${north},${east});
    );
    out geom;
  `;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain',
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    console.warn('Overpass error', response.status);
    return { elements: [] };
  }
  const data = await response.json();
  overpassCache.set(key, { data, expiresAt: Date.now() + 1000 * 60 * 10 });
  return data;
}

function extractPaths(overpass) {
  const elements = overpass?.elements || [];
  return elements
    .filter((el) => el.type === 'way' && el.geometry && el.tags)
    .filter((el) => {
      const highway = el.tags.highway;
      return highway === 'footway' || highway === 'path' || el.tags.sidewalk === 'yes' || el.tags.footway;
    })
    .map((el) => ({
      id: el.id,
      points: el.geometry.map((node) => ({ lat: node.lat, lon: node.lon }))
    }));
}

function extractRoads(overpass) {
  const drivable = new Set([
    'residential',
    'tertiary',
    'secondary',
    'primary',
    'service',
    'living_street'
  ]);
  const elements = overpass?.elements || [];
  return elements
    .filter((el) => el.type === 'way' && el.geometry && el.tags)
    .filter((el) => drivable.has(el.tags.highway))
    .map((el) => ({
      id: el.id,
      points: el.geometry.map((node) => ({ lat: node.lat, lon: node.lon }))
    }));
}

function computeEntrance({ shape, centroid, paths, center }) {
  if (shape) {
    const clamp = clampPointToPolygon(centroid, shape);
    centroid = clamp;
  }
  let best = null;
  if (paths.length > 0) {
    for (const path of paths) {
      const projection = projectPointToLine(centroid, path.points);
      if (!best || projection.distance < best.distance) {
        best = { ...projection, source: path };
      }
    }
  }
  if (best) {
    const pointOnBuilding = shape ? clampPointToPolygon(best, shape) : best;
    const confidence = best.distance < 8 ? 'high' : 'medium';
    return { point: pointOnBuilding, method: 'nearest_road_projection_polygon', confidence };
  }
  const fallbackPolygon = shape || bboxPolygon(boundingBox(center, 30));
  const fallback = clampPointToPolygon(center, fallbackPolygon);
  return { point: fallback, method: 'nearest_road_projection_bbox', confidence: 'low' };
}

function computeDropoff(entrance, roads) {
  if (!roads || roads.length === 0) return null;
  let best = null;
  for (const road of roads) {
    const projection = projectPointToLine(entrance, road.points);
    if (!best || projection.distance < best.distance) {
      best = { lat: projection.lat, lon: projection.lon, distance: projection.distance };
    }
  }
  return best ? { lat: best.lat, lon: best.lon } : null;
}

async function logSession(placeId, payload) {
  const dir = path.join(SESSIONS_DIR, placeId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'session.json');
  let entries = [];
  try {
    const existing = await fs.readFile(file, 'utf8');
    entries = JSON.parse(existing || '[]');
  } catch {
    entries = [];
  }
  entries.push({ ...payload, timestamp: new Date().toISOString() });
  if (entries.length > 20) {
    entries = entries.slice(-20);
  }
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf8');
}
