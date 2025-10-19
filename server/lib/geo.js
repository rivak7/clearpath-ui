import crypto from 'node:crypto';

const R = 6371e3;

export function haversineDistance(a, b) {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const sin = Math.sin;
  const hav = sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  return R * c;
}

export function projectPointToLine(point, line) {
  let best = null;
  for (let i = 0; i < line.length - 1; i += 1) {
    const start = line[i];
    const end = line[i + 1];
    const projection = nearestPointOnSegment(point, start, end);
    if (!best || projection.distance < best.distance) {
      best = projection;
    }
  }
  return best;
}

function nearestPointOnSegment(point, a, b) {
  const ax = a.lon;
  const ay = a.lat;
  const bx = b.lon;
  const by = b.lat;
  const tNumerator = (point.lon - ax) * (bx - ax) + (point.lat - ay) * (by - ay);
  const tDenominator = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = Math.max(0, Math.min(1, tNumerator / tDenominator || 0));
  const lon = ax + t * (bx - ax);
  const lat = ay + t * (by - ay);
  return {
    lat,
    lon,
    distance: haversineDistance(point, { lat, lon })
  };
}

export function boundingBox(center, meters = 60) {
  const delta = meters / R;
  const lat = (center.lat * Math.PI) / 180;
  const latMin = center.lat - (delta * 180) / Math.PI;
  const latMax = center.lat + (delta * 180) / Math.PI;
  const lonDelta = (delta * 180) / Math.PI / Math.cos(lat);
  return [center.lon - lonDelta, latMin, center.lon + lonDelta, latMax];
}

export function bboxPolygon(bbox) {
  const [w, s, e, n] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s]
      ]
    ]
  };
}

export function centerFromPolygon(polygon) {
  if (!polygon || !polygon.coordinates || polygon.coordinates.length === 0) return null;
  const ring = polygon.coordinates[0];
  const areaData = ring.reduce(
    (acc, coord, index) => {
      if (index === ring.length - 1) return acc;
      const [x1, y1] = coord;
      const [x2, y2] = ring[index + 1];
      const a = x1 * y2 - x2 * y1;
      acc.area += a;
      acc.x += (x1 + x2) * a;
      acc.y += (y1 + y2) * a;
      return acc;
    },
    { area: 0, x: 0, y: 0 }
  );
  if (!areaData.area) return null;
  const factor = 1 / (3 * areaData.area);
  return { lon: areaData.x * factor, lat: areaData.y * factor };
}

export function hashPlace(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function polygonFromBBox(bbox) {
  return bboxPolygon(bbox);
}

export function clampPointToPolygon(point, polygon) {
  if (!polygon || !polygon.coordinates || polygon.coordinates.length === 0) {
    return point;
  }
  const ring = polygon.coordinates[0];
  let best = { lat: point.lat, lon: point.lon, distance: Number.MAX_VALUE };
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = { lon: ring[i][0], lat: ring[i][1] };
    const b = { lon: ring[i + 1][0], lat: ring[i + 1][1] };
    const projection = nearestPointOnSegment(point, a, b);
    if (projection.distance < best.distance) {
      best = projection;
    }
  }
  return { lat: best.lat, lon: best.lon };
}
