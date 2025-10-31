const fs = require('fs');
const path = require('path');

const DEFAULT_LIMIT = 8;
const EARTH_RADIUS_METERS = 6371008.8;
const FALLBACK_SOURCE = path.resolve(__dirname, 'Training Data - Sheet1.csv');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(normalized) {
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_METERS * c;
}

function loadFallbackIndex() {
  const places = [];
  let raw;
  try {
    raw = fs.readFileSync(FALLBACK_SOURCE, 'utf8');
  } catch {
    return places;
  }
  const lines = raw.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const [building = '', address = '', coordRaw = ''] = parseCsvLine(line);
    if (!building && !address) continue;
    const coords = coordRaw.split(/\s*,\s*/);
    const lat = Number(coords[0]);
    const lon = Number(coords[1]);
    const label = building || address;
    const normalizedLabel = normalizeText(label);
    const normalizedAddress = normalizeText(address);
    const normalized = normalizeText(`${label} ${address}`);
    const tokens = new Set(tokenize(normalized));
    places.push({
      label,
      address,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      normalized,
      normalizedLabel,
      normalizedAddress,
      tokens,
    });
  }
  return places;
}

const FALLBACK_INDEX = loadFallbackIndex();

function scorePlace(place, queryTokens, normalizedQuery) {
  let tokenScore = 0;
  for (const token of queryTokens) {
    if (place.tokens.has(token)) {
      tokenScore += 4;
    } else if (place.normalized.includes(token)) {
      tokenScore += 1;
    }
  }
  if (!tokenScore) return 0;
  let prefixBonus = 0;
  if (place.normalizedLabel.startsWith(normalizedQuery)) prefixBonus += 3;
  if (place.normalizedAddress.startsWith(normalizedQuery)) prefixBonus += 1;
  return tokenScore + prefixBonus;
}

function searchFallbackSuggestions(query, { lat = null, lon = null, limit = DEFAULT_LIMIT } = {}) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(normalizedQuery);
  if (!normalizedQuery || !queryTokens.length || !FALLBACK_INDEX.length) return [];
  const cappedLimit = Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT));
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lon);

  const scored = [];
  for (const place of FALLBACK_INDEX) {
    const score = scorePlace(place, queryTokens, normalizedQuery);
    if (!score) continue;
    let distance = null;
    if (hasLocation && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      distance = haversineMeters(lat, lon, place.lat, place.lon);
    }
    const proximityBonus = Number.isFinite(distance) ? Math.max(0, 1 - distance / 5000) : 0;
    scored.push({
      label: place.label,
      context: place.address,
      lat: place.lat,
      lon: place.lon,
      distance,
      score: score + proximityBonus,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
    const db = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.label.localeCompare(b.label);
  });

  return scored.slice(0, cappedLimit).map(({ score, ...rest }) => rest);
}

module.exports = {
  searchFallbackSuggestions,
  _internal: {
    normalizeText,
    parseCsvLine,
    loadFallbackIndex,
    FALLBACK_SOURCE,
  },
};

