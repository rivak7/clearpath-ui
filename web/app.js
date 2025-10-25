import { initTheme, onThemeChange } from './theme.js';
import {
  AccessibilityFeature,
  getAccessibilityState,
  initAccessibility,
  onAccessibilityChange,
} from './accessibility.js';

initTheme();
initAccessibility();

const state = {
  map: null,
  satelliteLayer: null,
  overlays: null,
  userLayer: null,
  userMarker: null,
  userAccuracyCircle: null,
  userLocation: null,
  geolocationWatchId: null,
  hasCenteredOnUser: false,
  locateInFlight: null,
  suggestions: [],
  activeSuggestion: -1,
  pendingSuggest: null,
  lastResult: null,
  installPromptEvent: null,
  isSheetCollapsed: false,
};

state.accessibility = new Set();
state.designTokens = null;

const dom = {
  splash: document.getElementById('splash'),
  map: document.getElementById('map'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  suggestions: document.getElementById('suggestions'),
  infoSheet: document.getElementById('infoSheet'),
  insights: document.getElementById('insights'),
  directions: document.getElementById('directions'),
  navLinks: document.getElementById('navLinks'),
  statusMessage: document.getElementById('statusMessage'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetSubtitle: document.getElementById('sheetSubtitle'),
  locateButton: document.getElementById('locateMe'),
  installButton: document.getElementById('openInstall'),
  sheetToggle: document.getElementById('sheetToggle'),
};

function collectDesignTokens() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name);
    return value ? value.trim() || fallback : fallback;
  };
  return {
    accent: read('--accent', '#3dd6c1'),
    accentDark: read('--accent-dark', '#0b6f6b'),
    accentSoft: read('--accent-soft', 'rgba(61, 214, 193, 0.32)'),
    satOutline: read('--sat-outline', '#ffffff'),
    satFootprint: read('--sat-footprint', '#3dd6c1'),
    satFootprintFill: read('--sat-footprint-fill', 'rgba(61, 214, 193, 0.15)'),
    markerCentroidBorder: read('--marker-centroid-border', '#ffffff'),
    markerCentroidFill: read('--marker-centroid-fill', '#ffffff'),
    markerEntranceBorder: read('--marker-entrance-border', '#0b6f6b'),
    markerEntranceFill: read('--marker-entrance-fill', '#3dd6c1'),
    markerCnnBorder: read('--marker-cnn-border', '#0f3fd0'),
    markerCnnFill: read('--marker-cnn-fill', '#1c64f2'),
    markerDropoffBorder: read('--marker-dropoff-border', '#f9b234'),
    markerDropoffFill: read('--marker-dropoff-fill', '#faca61'),
    pathConnector: read('--path-connector', '#3dd6c1'),
  };
}

function getDesignTokens() {
  if (!state.designTokens) {
    state.designTokens = collectDesignTokens();
  }
  return state.designTokens;
}

function shouldReduceMotion() {
  return state.accessibility.has(AccessibilityFeature.CALM);
}

function refreshDesignTokens({ preserveView = true } = {}) {
  state.designTokens = collectDesignTokens();
  if (state.userLocation) {
    const { lat, lon, accuracy } = state.userLocation;
    updateUserMarker(lat, lon, accuracy);
  }
  if (state.lastResult) {
    renderResult(state.lastResult, { preserveView, skipStateUpdate: true });
  }
}

function updateAccessibilitySnapshot(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  state.accessibility = new Set(features);
  refreshDesignTokens();
}

updateAccessibilitySnapshot(getAccessibilityState());
onAccessibilityChange(updateAccessibilitySnapshot);
onThemeChange(() => refreshDesignTokens());

const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 15000,
};

const MIN_LOCATE_ZOOM = 17;

const DEFAULT_VIEW = { lat: 47.6036, lon: -122.3294, zoom: 13 }; // Seattle downtown default

function initMap() {
  if (!dom.map) return;
  state.map = L.map(dom.map, {
    zoomControl: true,
    attributionControl: true,
    zoomSnap: 0.5,
    maxZoom: 21,
  });

  state.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,
    attribution: 'Esri, Maxar, Earthstar Geographics, GIS User Community',
  });
  state.satelliteLayer.addTo(state.map);

  state.overlays = L.layerGroup().addTo(state.map);
  state.userLayer = L.layerGroup().addTo(state.map);

  state.map.setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
}

function hideSplash() {
  if (dom.splash) {
    dom.splash.style.opacity = '0';
    setTimeout(() => {
      dom.splash?.remove();
    }, 500);
  }
}

function setStatus(message, type = 'info') {
  if (!dom.statusMessage) return;
  dom.statusMessage.textContent = message || '';
  dom.statusMessage.className = 'status';
  if (type === 'error') dom.statusMessage.classList.add('status--error');
  if (type === 'success') dom.statusMessage.classList.add('status--success');
}

function setSheetCollapsed(collapsed) {
  state.isSheetCollapsed = collapsed;
  dom.infoSheet?.classList.toggle('sheet--collapsed', collapsed);
  if (dom.sheetToggle) {
    dom.sheetToggle.setAttribute('aria-expanded', String(!collapsed));
    dom.sheetToggle.setAttribute('aria-label', collapsed ? 'Expand details' : 'Collapse details');
  }
}

setSheetCollapsed(state.isSheetCollapsed);

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return 'n/a';
  if (meters < 1) return `${(meters * 100).toFixed(0)} cm`;
  if (meters < 1000) return `${meters.toFixed(meters < 20 ? 1 : 0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatCoord(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toFixed(6);
}

function computeBearing(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

function bearingToText(bearing) {
  if (!Number.isFinite(bearing)) return 'head to the entrance';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return `head ${directions[index]}`;
}

function isInsideBBox(point, bbox) {
  if (!point || !bbox) return false;
  return point.lat >= bbox.south && point.lat <= bbox.north && point.lon >= bbox.west && point.lon <= bbox.east;
}

function haversine(a, b) {
  if (!a || !b) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371008.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return R * c;
}

function updateUserMarker(lat, lon, accuracy) {
  if (!state.map || !state.userLayer) return;
  const tokens = getDesignTokens();
  const hasSeniorComfort = state.accessibility.has(AccessibilityFeature.SENIOR);
  const markerRadius = hasSeniorComfort ? 9 : 7;
  const accuracyOpacity = hasSeniorComfort ? 0.18 : 0.12;
  const minAccuracyRadius = hasSeniorComfort ? 20 : 12;
  const latLng = [lat, lon];
  if (!state.userMarker) {
    state.userMarker = L.circleMarker(latLng, {
      radius: markerRadius,
      weight: 2,
      color: tokens.accentDark,
      fillColor: tokens.accent,
      fillOpacity: 0.85,
    }).addTo(state.userLayer);
  } else {
    state.userMarker.setLatLng(latLng);
    state.userMarker.setStyle({
      radius: markerRadius,
      color: tokens.accentDark,
      fillColor: tokens.accent,
      fillOpacity: 0.85,
    });
  }
  if (Number.isFinite(accuracy)) {
    if (!state.userAccuracyCircle) {
      state.userAccuracyCircle = L.circle(latLng, {
        radius: Math.max(accuracy, minAccuracyRadius),
        color: tokens.accentDark,
        fillColor: tokens.accentSoft,
        fillOpacity: accuracyOpacity,
        weight: 1,
        opacity: 0.4,
      }).addTo(state.userLayer);
    } else {
      state.userAccuracyCircle.setLatLng(latLng);
      state.userAccuracyCircle.setRadius(Math.max(accuracy, minAccuracyRadius));
      state.userAccuracyCircle.setStyle({
        color: tokens.accentDark,
        fillColor: tokens.accentSoft,
        fillOpacity: accuracyOpacity,
        opacity: 0.4,
      });
    }
  }
}

function onGeolocation(position, { centerOnUser = false, preferFly = false } = {}) {
  const { latitude, longitude, accuracy } = position.coords;
  state.userLocation = {
    lat: latitude,
    lon: longitude,
    accuracy,
    timestamp: position.timestamp,
  };
  updateUserMarker(latitude, longitude, accuracy);
  const shouldCenter = centerOnUser || !state.hasCenteredOnUser;
  if (state.map && shouldCenter) {
    const mapZoom = typeof state.map.getZoom === 'function' ? state.map.getZoom() : MIN_LOCATE_ZOOM;
    const zoom = centerOnUser ? Math.max(mapZoom, MIN_LOCATE_ZOOM + 1) : Math.max(mapZoom, MIN_LOCATE_ZOOM);
    const latLng = [latitude, longitude];
    const reduceMotion = shouldReduceMotion();
    const canFly = preferFly && typeof state.map.flyTo === 'function' && !reduceMotion;
    if (canFly) {
      state.map.flyTo(latLng, zoom, { duration: reduceMotion ? 0 : 0.6 });
    } else {
      state.map.setView(latLng, zoom, { animate: !reduceMotion });
    }
    state.hasCenteredOnUser = true;
  }
  updateDirections();
}

function onGeolocationError(error, { userInitiated = false } = {}) {
  if (!error) return;
  let message = 'Unable to retrieve your location.';
  if (error.code === error.PERMISSION_DENIED) {
    message = 'Location permission denied. You can still search manually.';
  } else if (error.code === error.POSITION_UNAVAILABLE) {
    message = 'Position unavailable. Try moving outdoors or check your signal.';
  } else if (error.code === error.TIMEOUT) {
    message = 'Locating you took too long. Please try again.';
  }
  setStatus(message, 'error');
  if (userInitiated && dom.locateButton) {
    dom.locateButton.classList.add('fab--error');
    window.setTimeout(() => {
      dom.locateButton?.classList.remove('fab--error');
    }, 1200);
  }
  if (error.code === error.PERMISSION_DENIED && state.geolocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geolocationWatchId);
    state.geolocationWatchId = null;
    state.hasCenteredOnUser = false;
  }
}

function ensureGeolocationWatch() {
  if (state.geolocationWatchId !== null || !('geolocation' in navigator)) return;
  state.geolocationWatchId = navigator.geolocation.watchPosition(
    (pos) => onGeolocation(pos),
    (error) => onGeolocationError(error),
    GEOLOCATION_OPTIONS,
  );
}

function toggleLocateButtonBusy(isBusy) {
  if (!dom.locateButton) return;
  if (isBusy) {
    dom.locateButton.setAttribute('aria-busy', 'true');
    dom.locateButton.disabled = true;
    dom.locateButton.classList.add('fab--loading');
  } else {
    dom.locateButton.removeAttribute('aria-busy');
    dom.locateButton.disabled = false;
    dom.locateButton.classList.remove('fab--loading');
  }
}

function focusOnUserLocation({ animate = true, useFly = true, zoom = MIN_LOCATE_ZOOM + 1 } = {}) {
  if (!state.map || !state.userLocation) return;
  const latLng = [state.userLocation.lat, state.userLocation.lon];
  const mapZoom = typeof state.map.getZoom === 'function' ? state.map.getZoom() : MIN_LOCATE_ZOOM;
  const targetZoom = Math.max(mapZoom, zoom);
  const reduceMotion = shouldReduceMotion();
  const allowAnimation = animate && !reduceMotion;
  const allowFly = useFly && typeof state.map.flyTo === 'function' && !reduceMotion;
  if (allowFly) {
    state.map.flyTo(latLng, targetZoom, { duration: allowAnimation ? 0.6 : 0 });
  } else {
    state.map.setView(latLng, targetZoom, { animate: allowAnimation });
  }
}

function startGeolocation({ centerOnSuccess = false, userInitiated = false } = {}) {
  if (!('geolocation' in navigator)) {
    setStatus('Geolocation unavailable in this browser.', 'error');
    return Promise.resolve(false);
  }
  if (state.locateInFlight) return state.locateInFlight;

  if (userInitiated) {
    setStatus('Locating you...');
  }
  toggleLocateButtonBusy(true);

  state.locateInFlight = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onGeolocation(position, { centerOnUser: centerOnSuccess, preferFly: userInitiated });
        ensureGeolocationWatch();
        if (userInitiated) {
          setStatus('Centered on your position.', 'success');
        }
        resolve(true);
      },
      (error) => {
        onGeolocationError(error, { userInitiated });
        resolve(false);
      },
      GEOLOCATION_OPTIONS,
    );
  }).finally(() => {
    toggleLocateButtonBusy(false);
    state.locateInFlight = null;
  });

  return state.locateInFlight;
}

function buildSuggestionNode(item, index) {
  const node = document.createElement('div');
  node.className = 'suggestion';
  node.setAttribute('role', 'option');
  node.dataset.index = String(index);
  const primary = document.createElement('div');
  primary.className = 'suggestion__primary';
  primary.textContent = item.label;
  node.appendChild(primary);
  if (item.context) {
    const context = document.createElement('div');
    context.className = 'suggestion__context';
    context.textContent = item.context;
    node.appendChild(context);
  }
  if (Number.isFinite(item.distance)) {
    const distance = document.createElement('div');
    distance.className = 'suggestion__distance';
    distance.textContent = `${formatDistance(item.distance)} away`;
    node.appendChild(distance);
  }
  node.addEventListener('mousedown', (evt) => {
    evt.preventDefault();
    applySuggestion(index);
  });
  return node;
}

function renderSuggestions(items) {
  state.suggestions = items || [];
  state.activeSuggestion = -1;
  if (!dom.suggestions) return;
  dom.suggestions.innerHTML = '';
  if (!items || !items.length) {
    dom.suggestions.hidden = true;
    dom.searchInput?.setAttribute('aria-expanded', 'false');
    return;
  }
  items.forEach((item, index) => {
    dom.suggestions.appendChild(buildSuggestionNode(item, index));
  });
  dom.suggestions.hidden = false;
  dom.searchInput?.setAttribute('aria-expanded', 'true');
}

function highlightSuggestion(index) {
  state.activeSuggestion = index;
  const children = dom.suggestions ? Array.from(dom.suggestions.children) : [];
  children.forEach((child, idx) => {
    if (idx === index) {
      child.setAttribute('aria-selected', 'true');
      child.scrollIntoView({ block: 'nearest' });
    } else {
      child.removeAttribute('aria-selected');
    }
  });
}

function applySuggestion(index) {
  const item = state.suggestions[index];
  if (!item) return;
  dom.searchInput.value = item.label;
  dom.searchInput.focus();
  renderSuggestions([]);
  dom.clearSearch.hidden = false;
}

function debounce(fn, delay) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const requestSuggestions = debounce(async () => {
  const query = dom.searchInput.value.trim();
  if (query.length < 3) {
    renderSuggestions([]);
    return;
  }
  if (state.pendingSuggest) {
    state.pendingSuggest.abort();
  }
  const controller = new AbortController();
  state.pendingSuggest = controller;
  const params = new URLSearchParams({ q: query, limit: '6' });
  if (state.userLocation) {
    params.set('lat', state.userLocation.lat.toFixed(6));
    params.set('lon', state.userLocation.lon.toFixed(6));
  }
  try {
    const resp = await fetch(`/geocode/suggest?${params.toString()}`, { signal: controller.signal });
    if (!resp.ok) throw new Error('suggest_failed');
    const data = await resp.json();
    renderSuggestions(data.results || []);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    renderSuggestions([]);
  } finally {
    if (state.pendingSuggest === controller) state.pendingSuggest = null;
  }
}, 180);

async function performSearch(query) {
  if (!query) return;
  renderSuggestions([]);
  dom.clearSearch.hidden = !query;
  setStatus('Finding satellite entrance...');
  try {
    const resp = await fetch(`/entrance?q=${encodeURIComponent(query)}`, { headers: { 'Accept': 'application/json' } });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error || 'search_failed');
    }
    state.lastResult = data;
    renderResult(data);
    setStatus('Entrance updated with current imagery.', 'success');
  } catch (error) {
    const message = error?.message === 'search_failed' ? 'Unable to locate that address right now.' : error?.message || 'Entrance lookup failed.';
    setStatus(message, 'error');
  }
}

function renderResult(data, options = {}) {
  if (!state.map || !state.overlays) return;
  const { preserveView = false, skipStateUpdate = false } = options;
  if (!skipStateUpdate) {
    state.lastResult = data;
  }
  state.overlays.clearLayers();
  const tokens = getDesignTokens();
  const reduceMotion = shouldReduceMotion();
  const { bbox, center, entrance, cnnEntrance, roadPoint, footprint } = data;
  if (bbox) {
    const bounds = L.latLngBounds([
      [bbox.south, bbox.west],
      [bbox.north, bbox.east],
    ]);
    const rectangle = L.rectangle(bounds, {
      color: tokens.satOutline,
      weight: 1.5,
      opacity: 0.7,
      fillOpacity: 0,
      dashArray: '6 4',
    });
    rectangle.addTo(state.overlays);
    if (!preserveView) {
      if (!reduceMotion && typeof state.map.flyToBounds === 'function') {
        state.map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 20, duration: 0.8 });
      } else {
        state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 20, animate: !reduceMotion });
      }
    }
  }
  if (footprint) {
    try {
      L.geoJSON(footprint, {
        style: {
          color: tokens.satFootprint,
          weight: 2,
          fillColor: tokens.satFootprintFill,
          fillOpacity: 0.25,
        },
      }).addTo(state.overlays);
    } catch (error) {
      // ignore malformed geometry
    }
  }
  if (center) {
    L.circleMarker([center.lat, center.lon], {
      radius: 5,
      color: tokens.markerCentroidBorder,
      fillColor: tokens.markerCentroidFill,
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(state.overlays).bindTooltip('Building centroid');
  }
  if (entrance) {
    L.circleMarker([entrance.lat, entrance.lon], {
      radius: 8,
      color: tokens.markerEntranceBorder,
      fillColor: tokens.markerEntranceFill,
      fillOpacity: 0.85,
      weight: 3,
    }).addTo(state.overlays).bindTooltip('Heuristic entrance');
  }
  if (cnnEntrance) {
    L.circleMarker([cnnEntrance.lat, cnnEntrance.lon], {
      radius: 8,
      color: tokens.markerCnnBorder,
      fillColor: tokens.markerCnnFill,
      fillOpacity: 0.85,
      weight: 3,
    }).addTo(state.overlays).bindTooltip('CNN entrance');
  }
  if (roadPoint) {
    L.circleMarker([roadPoint.lat, roadPoint.lon], {
      radius: 6,
      color: tokens.markerDropoffBorder,
      fillColor: tokens.markerDropoffFill,
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(state.overlays).bindTooltip('Recommended drop-off');
  }
  if (roadPoint && entrance) {
    L.polyline(
      [
        [roadPoint.lat, roadPoint.lon],
        [entrance.lat, entrance.lon],
      ],
      {
        color: tokens.pathConnector,
        weight: 2,
        dashArray: '8 6',
      }
    ).addTo(state.overlays);
  }

  updateInsights(data);
  updateDirections();
  updateNavigationLinks();
  updateSheetHeadings(data);
}

function updateSheetHeadings(data) {
  const query = data?.query || 'Plan your arrival';
  if (dom.sheetTitle) {
    dom.sheetTitle.textContent = 'Arrival details';
  }
  if (dom.sheetSubtitle) {
    dom.sheetSubtitle.textContent = `Destination: ${query}`;
  }
}

function updateInsights(data) {
  if (!dom.insights) return;
  dom.insights.innerHTML = '';
  const items = [];
  const entrance = data?.entrance;
  if (entrance) {
    items.push({
      title: 'Verified entrance',
      lines: [
        `Lat: ${formatCoord(entrance.lat)}, Lon: ${formatCoord(entrance.lon)}`,
        `Method: ${entrance.method || 'projected'} • ${formatDistance(entrance.distance_m)} from center`,
      ],
    });
  }
  if (data?.cnnEntrance) {
    const cnn = data.cnnEntrance;
    items.push({
      title: 'CNN entrance candidate',
      className: 'insight--cnn',
      lines: [
        `Lat: ${formatCoord(cnn.lat)}, Lon: ${formatCoord(cnn.lon)}`,
        `∆ heuristic: ${formatDistance(cnn.difference_from_heuristic_m)} • ∆ center: ${formatDistance(cnn.distance_from_center_m)}`,
        cnn.image_url ? { text: 'Open inference tile', href: cnn.image_url } : null,
      ].filter(Boolean),
    });
  } else if (data?.cnnDiagnostics) {
    const diag = data.cnnDiagnostics;
    items.push({
      title: 'CNN status',
      lines: [diag.reason || diag.status || 'Unavailable'],
    });
  }
  if (data?.roadPoint) {
    items.push({
      title: 'Drop-off suggestion',
      lines: [
        `Lat: ${formatCoord(data.roadPoint.lat)}, Lon: ${formatCoord(data.roadPoint.lon)}`,
        'Closest public roadway access',
      ],
    });
  }

  if (!items.length) {
    dom.insights.hidden = true;
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'insight';
    if (item.className) card.classList.add(item.className);
    const title = document.createElement('div');
    title.className = 'insight__title';
    title.textContent = item.title;
    card.appendChild(title);
    item.lines.forEach((line) => {
      const meta = document.createElement('div');
      meta.className = 'insight__meta';
      if (line && typeof line === 'object' && line.href) {
        const link = document.createElement('a');
        link.href = line.href;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = line.text || line.href;
        meta.appendChild(link);
      } else {
        meta.textContent = typeof line === 'string' ? line : '';
      }
      card.appendChild(meta);
    });
    dom.insights.appendChild(card);
  });
  dom.insights.hidden = false;
}

function updateDirections() {
  if (!dom.directions) return;
  dom.directions.innerHTML = '';
  const result = state.lastResult;
  if (!result) {
    dom.directions.hidden = true;
    return;
  }
  const entrance = result.entrance;
  const roadPoint = result.roadPoint;
  const user = state.userLocation;
  const steps = [];
  if (roadPoint) {
    const dropDistance = user ? haversine(user, roadPoint) : null;
    let description = 'Navigate to the highlighted drop-off point shown on the map.';
    if (user && Number.isFinite(dropDistance)) {
      description = `Drive to the drop-off at ${formatCoord(roadPoint.lat)}, ${formatCoord(roadPoint.lon)} (${formatDistance(dropDistance)} from you).`;
    }
    steps.push({
      title: 'Vehicle drop-off',
      description,
      className: user && dropDistance <= 30 ? 'direction-step--primary' : '',
    });
  }
  if (entrance) {
    const walkDistance = roadPoint ? haversine(roadPoint, entrance) : null;
    const directDistance = user ? haversine(user, entrance) : null;
    const origin = roadPoint || user;
    let directionText = 'Follow on-premise signage to the entrance.';
    if (origin) {
      const bearing = computeBearing(origin.lat, origin.lon, entrance.lat, entrance.lon);
      const fromText = roadPoint ? 'from drop-off' : 'from your position';
      directionText = `From ${fromText}, ${bearingToText(bearing)} for ${formatDistance(walkDistance || directDistance)}.`;
    }
    steps.push({
      title: 'Final approach',
      description: directionText,
      className: 'direction-step--primary',
    });
  }
  if (user && !isInsideBBox(user, result.bbox)) {
    steps.unshift({
      title: 'You are outside the site',
      description: 'Follow the map to reach the recommended drop-off zone before heading to the entrance.',
    });
  }
  if (!steps.length) {
    dom.directions.hidden = true;
    return;
  }
  steps.forEach((step) => {
    const node = document.createElement('div');
    node.className = 'direction-step';
    if (step.className) node.classList.add(step.className);
    const heading = document.createElement('strong');
    heading.textContent = step.title;
    node.appendChild(heading);
    const body = document.createElement('div');
    body.textContent = step.description;
    node.appendChild(body);
    dom.directions.appendChild(node);
  });
  dom.directions.hidden = false;
}

function updateNavigationLinks() {
  if (!dom.navLinks) return;
  dom.navLinks.innerHTML = '';
  const hasQuery = Boolean(dom.searchInput?.value.trim());
  const entrance = state.lastResult?.entrance;
  if (!hasQuery || !entrance || !Number.isFinite(entrance.lat) || !Number.isFinite(entrance.lon)) {
    dom.navLinks.hidden = true;
    return;
  }
  const destination = `${entrance.lat},${entrance.lon}`;
  const links = [
    {
      id: 'google',
      label: 'Open in Google Maps',
      href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
    },
    {
      id: 'apple',
      label: 'Open in Apple Maps',
      href: `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`,
    },
  ];
  links.forEach((link) => {
    const anchor = document.createElement('a');
    anchor.className = 'nav-linkButton';
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.textContent = link.label;
    dom.navLinks.appendChild(anchor);
  });
  dom.navLinks.hidden = false;
}

function wireSearch() {
  if (!dom.searchInput || !dom.searchForm) return;
  dom.searchInput.addEventListener('input', () => {
    const value = dom.searchInput.value.trim();
    dom.clearSearch.hidden = !value;
    requestSuggestions();
    updateNavigationLinks();
  });
  dom.searchInput.addEventListener('focus', () => {
    requestSuggestions();
  });
  dom.searchInput.addEventListener('blur', () => {
    setTimeout(() => renderSuggestions([]), 150);
  });
  dom.searchInput.addEventListener('keydown', (evt) => {
    if (!state.suggestions.length) return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      const next = (state.activeSuggestion + 1) % state.suggestions.length;
      highlightSuggestion(next);
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      const prev = (state.activeSuggestion - 1 + state.suggestions.length) % state.suggestions.length;
      highlightSuggestion(prev);
    } else if (evt.key === 'Enter' && state.activeSuggestion >= 0) {
      evt.preventDefault();
      applySuggestion(state.activeSuggestion);
    } else if (evt.key === 'Escape') {
      renderSuggestions([]);
    }
  });
  if (dom.clearSearch) {
    dom.clearSearch.addEventListener('click', () => {
      if (!dom.searchInput) return;
      dom.searchInput.value = '';
      dom.clearSearch.hidden = true;
      renderSuggestions([]);
      dom.searchInput.focus();
      updateNavigationLinks();
    });
  }
  dom.searchForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    if (!dom.searchInput) return;
    const query = dom.searchInput.value.trim();
    performSearch(query);
  });
}

function wireLocateButton() {
  if (!dom.locateButton) return;
  dom.locateButton.addEventListener('click', () => {
    if (state.userLocation) {
      focusOnUserLocation({ animate: true, useFly: true });
    }
    startGeolocation({ centerOnSuccess: true, userInitiated: true });
  });
}

function wireSheetToggle() {
  if (!dom.sheetToggle) return;
  dom.sheetToggle.addEventListener('click', () => {
    setSheetCollapsed(!state.isSheetCollapsed);
  });
}

async function primeGeolocation() {
  if (!('geolocation' in navigator)) {
    setStatus('Geolocation unavailable in this browser.', 'error');
    return;
  }

  if (!navigator.permissions?.query) {
    startGeolocation({ centerOnSuccess: true });
    return;
  }

  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted') {
      startGeolocation({ centerOnSuccess: true });
    } else if (status.state === 'denied') {
      setStatus('Location permission denied. Enable it in your browser settings to center the map.', 'error');
    } else if (status.state === 'prompt') {
      setStatus('Tap the locate button to center on your position.');
    }
    status.onchange = () => {
      if (status.state === 'granted') {
        startGeolocation({ centerOnSuccess: true });
      }
    };
  } catch (error) {
    console.warn('Unable to query geolocation permission', error);
    startGeolocation({ centerOnSuccess: true });
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/service-worker.js').catch(() => {
    setStatus('Service worker registration failed.', 'error');
  });
}

function setupInstallPrompt() {
  if (!dom.installButton) return;
  window.addEventListener('beforeinstallprompt', (evt) => {
    evt.preventDefault();
    state.installPromptEvent = evt;
    dom.installButton.hidden = false;
  });
  dom.installButton.addEventListener('click', async () => {
    if (!state.installPromptEvent) return;
    dom.installButton.disabled = true;
    await state.installPromptEvent.prompt();
    const choice = await state.installPromptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setStatus('ClearPath added to your device.', 'success');
    }
    dom.installButton.hidden = true;
    dom.installButton.disabled = false;
    state.installPromptEvent = null;
  });
}

function init() {
  initMap();
  wireSearch();
  wireLocateButton();
  wireSheetToggle();
  setupInstallPrompt();
  registerServiceWorker();
  primeGeolocation();
  hideSplash();
}

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('pagehide', () => {
  if (state.geolocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geolocationWatchId);
    state.geolocationWatchId = null;
  }
});
