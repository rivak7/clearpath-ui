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
  hasShownInstallBanner: false,
  voteLayer: null,
  entranceOptions: [],
  selectedEntranceId: null,
  communitySummary: null,
  isVoting: false,
  voteMarker: null,
  voteHandler: null,
  voteInFlight: false,
  confirmationPrompt: null,
  sheet: {
    snapPoints: [],
    index: 0,
    translate: 0,
    baseline: null,
    observer: null,
    isAnimating: false,
    resizeRaf: null,
    viewportCleanup: null,
  },
  routeStops: [],
  routeStopCounter: 0,
  routeMode: 'drive',
  draggingStop: null,
  searchInFlight: false,
  pendingSearch: null,
  splashHideTimer: null,
  splashProgress: 0,
  splashResetTimer: null,
  searchCount: 0,
  lastConfirmationPromptAt: 0,
};

state.accessibility = new Set();
state.designTokens = null;
state.confirmationHistory = new Set();
state.splashTimeouts = new Set();
state.splashFrames = new Set();

const dom = {
  splash: document.getElementById('splash'),
  splashMessage: document.getElementById('splashMessage'),
  splashProgress: document.getElementById('splashProgress'),
  splashProgressBar: document.getElementById('splashProgressBar'),
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
  installBanner: document.getElementById('installBanner'),
  installBannerConfirm: document.getElementById('installBannerConfirm'),
  installBannerDismiss: document.getElementById('installBannerDismiss'),
  sheetHandle: document.getElementById('sheetHandle'),
  sheetContent: document.getElementById('sheetContent'),
  sheetReset: document.getElementById('sheetReset'),
  routePlanner: document.getElementById('routePlanner'),
  routeStops: document.getElementById('routeStops'),
  routeSummary: document.getElementById('routeSummary'),
  addRouteStop: document.getElementById('addRouteStop'),
  routeModes: Array.from(document.querySelectorAll('.route-mode')),
  entranceOptions: document.getElementById('entranceOptions'),
  entranceOptionList: document.getElementById('entranceOptionList'),
  entranceOptionsMeta: document.getElementById('entranceOptionsMeta'),
  startEntranceVote: document.getElementById('startEntranceVote'),
  entranceVoteHint: document.getElementById('entranceVoteHint'),
  entranceConfirm: document.getElementById('entranceConfirm'),
  entranceConfirmMessage: document.getElementById('entranceConfirmMessage'),
  entranceConfirmYes: document.getElementById('entranceConfirmYes'),
  entranceConfirmNo: document.getElementById('entranceConfirmNo'),
  entranceConfirmSuggest: document.getElementById('entranceConfirmSuggest'),
};

if (dom.splash) {
  dom.splash.setAttribute('aria-hidden', 'false');
}

if (dom.entranceOptions) {
  dom.entranceOptions.setAttribute('aria-hidden', dom.entranceOptions.hidden ? 'true' : 'false');
}

if (dom.installBanner) {
  dom.installBanner.setAttribute('aria-hidden', dom.installBanner.hidden ? 'true' : 'false');
}

const SPLASH_MESSAGES = {
  bootstrap: 'Preparing your experience...',
  search: 'Finding the best entrance...',
};

const STORAGE_KEYS = {
  installBannerDismissed: 'clearpath-ui:install-banner-dismissed',
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
    markerCommunityBorder: read('--marker-community-border', '#125e63'),
    markerCommunityFill: read('--marker-community-fill', '#69e3d4'),
    markerSelectedBorder: read('--marker-selected-border', '#114e4d'),
    markerSelectedFill: read('--marker-selected-fill', '#0ea5e9'),
    pathConnector: read('--path-connector', '#3dd6c1'),
  };
}

function getDesignTokens() {
  if (!state.designTokens) {
    state.designTokens = collectDesignTokens();
  }
  return state.designTokens;
}

function isStandaloneDisplayMode() {
  try {
    const matchMedia = window.matchMedia?.('(display-mode: standalone)');
    return Boolean(matchMedia?.matches || window.navigator?.standalone);
  } catch (error) {
    return false;
  }
}

function readInstallBannerDismissed() {
  try {
    return window.localStorage?.getItem(STORAGE_KEYS.installBannerDismissed) === '1';
  } catch (error) {
    return false;
  }
}

function rememberInstallBannerDismissed() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.installBannerDismissed, '1');
  } catch (error) {
    // noop
  }
}

function shouldShowInstallBanner() {
  if (!dom.installBanner) return false;
  if (state.hasShownInstallBanner) return false;
  if (isStandaloneDisplayMode()) return false;
  return !readInstallBannerDismissed();
}

function showInstallBanner() {
  if (!dom.installBanner) return;
  dom.installBanner.hidden = false;
  dom.installBanner.setAttribute('aria-hidden', 'false');
  state.hasShownInstallBanner = true;
}

function hideInstallBanner({ persistDismiss = false } = {}) {
  if (!dom.installBanner) return;
  dom.installBanner.hidden = true;
  dom.installBanner.setAttribute('aria-hidden', 'true');
  if (persistDismiss) {
    rememberInstallBannerDismissed();
  }
}

function shouldReduceMotion() {
  return state.accessibility.has(AccessibilityFeature.CALM);
}

function refreshDesignTokens({ preserveView = true } = {}) {
  state.designTokens = collectDesignTokens();
  if (state.voteMarker) {
    const tokens = state.designTokens;
    state.voteMarker.setStyle({
      color: tokens.markerSelectedBorder,
      fillColor: tokens.markerSelectedFill,
    });
  }
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
const MAX_SATELLITE_ZOOM = 18;

const DEFAULT_VIEW = { lat: 47.6036, lon: -122.3294, zoom: 13 }; // Seattle downtown default
const SHEET_BASELINE_FALLBACK = 208;
const SHEET_PEEK_MIN_VISIBLE = 72;
const SHEET_SNAP_TOLERANCE = 0.005;

function getViewportHeight() {
  const viewport = window.visualViewport;
  if (viewport && Number.isFinite(viewport.height)) {
    return viewport.height;
  }
  if (Number.isFinite(window.innerHeight)) {
    return window.innerHeight;
  }
  if (document.documentElement && Number.isFinite(document.documentElement.clientHeight)) {
    return document.documentElement.clientHeight;
  }
  if (document.body && Number.isFinite(document.body.clientHeight)) {
    return document.body.clientHeight;
  }
  return SHEET_BASELINE_FALLBACK * 3;
}

function computeSheetBaselineVisible() {
  const height = getViewportHeight();
  if (!Number.isFinite(height)) {
    return SHEET_BASELINE_FALLBACK;
  }
  if (height <= 600) {
    return Math.max(168, Math.round(height * 0.24));
  }
  if (height <= 780) {
    return Math.max(188, Math.round(height * 0.26));
  }
  if (height <= 920) {
    return Math.round(height * 0.28);
  }
  return Math.min(320, Math.round(height * 0.3));
}

function computeSheetSnapPoints() {
  const height = getViewportHeight();
  const isLandscape = typeof window.matchMedia === 'function' && window.matchMedia('(orientation: landscape)').matches;
  if (!Number.isFinite(height)) {
    return [0.3, 0.62, 0.92];
  }
  if (height <= 600) {
    return [0.36, 0.62, 0.92];
  }
  if (isLandscape && height <= 720) {
    return [0.32, 0.58, 0.9];
  }
  if (height >= 960) {
    return [0.24, 0.6, 0.96];
  }
  return [0.3, 0.62, 0.92];
}

function syncSheetSnapPoints() {
  const next = computeSheetSnapPoints();
  const current = state.sheet?.snapPoints || [];
  const changed = current.length !== next.length
    || current.some((value, idx) => Math.abs(value - next[idx]) > SHEET_SNAP_TOLERANCE);
  if (changed) {
    state.sheet.snapPoints = next;
  }
  return changed;
}

function initMap() {
  if (!dom.map) return;
  state.map = L.map(dom.map, {
    zoomControl: true,
    attributionControl: true,
    zoomSnap: 0.5,
    maxZoom: MAX_SATELLITE_ZOOM,
  });

  state.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: MAX_SATELLITE_ZOOM,
    maxNativeZoom: MAX_SATELLITE_ZOOM,
    attribution: 'Esri, Maxar, Earthstar Geographics, GIS User Community',
  });
  state.satelliteLayer.addTo(state.map);

  state.overlays = L.layerGroup().addTo(state.map);
  state.userLayer = L.layerGroup().addTo(state.map);

  state.map.setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
  attachLocateControl();
}

function attachLocateControl() {
  if (!state.map) return;
  const zoomControl = state.map.zoomControl;
  const container = typeof zoomControl?.getContainer === 'function'
    ? zoomControl.getContainer()
    : zoomControl?._container;
  if (!container) return;

  let button = container.querySelector('#locateMe');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'locateMe';
    button.className = 'map-locate';
    button.setAttribute('aria-label', 'Center on my location');
    button.setAttribute('title', 'Center on my location');
    button.innerHTML = '<span class="map-locate__icon" aria-hidden="true">◎</span>';
    container.appendChild(button);
  }

  dom.locateButton = button;

  if (typeof L !== 'undefined' && L?.DomEvent) {
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.disableScrollPropagation(button);
  }
}

function clearPendingSplashProgress() {
  if (state.splashTimeouts) {
    state.splashTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    state.splashTimeouts.clear();
  }
  if (state.splashFrames) {
    state.splashFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
    state.splashFrames.clear();
  }
}

function resetSplashProgress() {
  state.splashProgress = 0;
  if (dom.splashProgress) {
    dom.splashProgress.style.setProperty('--progress', '0%');
    dom.splashProgress.style.width = '0%';
    dom.splashProgress.style.opacity = '0';
    dom.splashProgress.classList.remove('splash__progressFill--complete');
  }
  if (dom.splashProgressBar) {
    dom.splashProgressBar.setAttribute('aria-valuenow', '0');
    dom.splashProgressBar.classList.remove('splash__progress--complete');
  }
}

function setSplashProgress(value) {
  const clamped = Math.max(0, Math.min(1, value));
  state.splashProgress = clamped;
  const widthPercent = clamped <= 0 ? 0 : Math.max(clamped * 100, 4);
  const width = `${widthPercent.toFixed(1)}%`;
  if (dom.splashProgress) {
    dom.splashProgress.style.setProperty('--progress', width);
    dom.splashProgress.style.width = width;
    dom.splashProgress.style.opacity = clamped <= 0 ? '0' : '1';
    dom.splashProgress.classList.toggle('splash__progressFill--complete', clamped >= 0.999);
  }
  if (dom.splashProgressBar) {
    dom.splashProgressBar.setAttribute('aria-valuenow', Math.round(clamped * 100).toString());
    dom.splashProgressBar.classList.toggle('splash__progress--complete', clamped >= 0.999);
    dom.splashProgressBar.setAttribute('aria-busy', clamped >= 1 ? 'false' : 'true');
  }
}

function advanceSplashProgress(value, delay = 0) {
  const clamped = Math.max(0, Math.min(1, value));
  if (delay > 0) {
    const timeoutId = window.setTimeout(() => {
      setSplashProgress(clamped);
      state.splashTimeouts?.delete(timeoutId);
    }, delay);
    state.splashTimeouts?.add(timeoutId);
  } else {
    const frameId = window.requestAnimationFrame(() => {
      setSplashProgress(clamped);
      state.splashFrames?.delete(frameId);
    });
    state.splashFrames?.add(frameId);
  }
}

function showSplash({ mode = 'bootstrap', message, progress } = {}) {
  if (!dom.splash) return;
  if (state.splashHideTimer) {
    clearTimeout(state.splashHideTimer);
    state.splashHideTimer = null;
  }
  if (state.splashResetTimer) {
    clearTimeout(state.splashResetTimer);
    state.splashResetTimer = null;
  }
  clearPendingSplashProgress();
  resetSplashProgress();
  dom.splash.classList.remove('splash--hidden');
  dom.splash.setAttribute('aria-hidden', 'false');
  dom.splash.classList.toggle('splash--search', mode === 'search');
  const resolvedMessage = message || SPLASH_MESSAGES[mode] || SPLASH_MESSAGES.bootstrap;
  if (dom.splashMessage) {
    dom.splashMessage.textContent = resolvedMessage;
  }
  if (dom.splashProgressBar) {
    dom.splashProgressBar.setAttribute('aria-valuetext', resolvedMessage);
    dom.splashProgressBar.setAttribute('aria-busy', 'true');
  }
  const baseProgress = typeof progress === 'number'
    ? Math.max(0, Math.min(1, progress))
    : mode === 'bootstrap'
      ? 0.18
      : 0.26;
  advanceSplashProgress(baseProgress);
}

function updateSplashMessage(message) {
  if (!message) return;
  if (dom.splashMessage) {
    dom.splashMessage.textContent = message;
  }
  if (dom.splashProgressBar) {
    dom.splashProgressBar.setAttribute('aria-valuetext', message);
  }
}

function hideSplash({ delay = 0 } = {}) {
  if (!dom.splash) return;
  const apply = () => {
    clearPendingSplashProgress();
    setSplashProgress(1);
    dom.splash.classList.add('splash--hidden');
    dom.splash.setAttribute('aria-hidden', 'true');
    dom.splash.classList.remove('splash--search');
    if (dom.splashProgressBar) {
      dom.splashProgressBar.setAttribute('aria-valuetext', 'Experience ready');
    }
    state.splashHideTimer = null;
    state.splashResetTimer = window.setTimeout(() => {
      resetSplashProgress();
      state.splashResetTimer = null;
    }, 420);
  };
  if (delay > 0) {
    state.splashHideTimer = window.setTimeout(apply, delay);
  } else {
    apply();
  }
}

function setStatus(message, type = 'info') {
  if (!dom.statusMessage) return;
  dom.statusMessage.textContent = message || '';
  dom.statusMessage.className = 'status';
  if (type === 'error') dom.statusMessage.classList.add('status--error');
  if (type === 'success') dom.statusMessage.classList.add('status--success');
}

function computeSheetPosition(fraction, { minVisible } = {}) {
  if (!dom.infoSheet) {
    const baseline = typeof minVisible === 'number' ? minVisible : computeSheetBaselineVisible();
    return { translate: 0, visible: baseline };
  }
  const sheet = dom.infoSheet;
  const sheetHeight = sheet.scrollHeight;
  const baseline = typeof minVisible === 'number' ? minVisible : computeSheetBaselineVisible();
  const viewportHeight = getViewportHeight();
  const visibleTarget = Math.round(viewportHeight * fraction);
  const clampedVisible = Math.min(sheetHeight, Math.max(baseline, visibleTarget));
  const translate = Math.max(0, sheetHeight - clampedVisible);
  return { translate, visible: clampedVisible };
}

function getSheetPeekVisibleHeight() {
  const handle = dom.sheetHandle;
  if (!handle) return SHEET_PEEK_MIN_VISIBLE;
  const rect = handle.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.height) || rect.height <= 0) {
    return SHEET_PEEK_MIN_VISIBLE;
  }
  return Math.max(SHEET_PEEK_MIN_VISIBLE, Math.round(rect.height + 24));
}

function clampSheetTranslate(value) {
  if (!dom.infoSheet) return 0;
  const sheetHeight = dom.infoSheet.scrollHeight;
  const peekVisible = Math.max(getSheetPeekVisibleHeight(), SHEET_PEEK_MIN_VISIBLE);
  const baseline = state.sheet?.baseline || computeSheetBaselineVisible();
  const minVisible = Math.min(baseline, peekVisible);
  const maxTranslate = Math.max(0, sheetHeight - minVisible);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), maxTranslate);
}

function updateSheetVisualState(index) {
  if (!dom.infoSheet) return;
  const snapPoints = state.sheet?.snapPoints || [];
  dom.infoSheet.classList.toggle('sheet--peek', index === 0);
  dom.infoSheet.classList.toggle('sheet--expanded', index === snapPoints.length - 1);
}

function applySheetSnap(index, { animate = true } = {}) {
  if (!dom.infoSheet) return;
  const snapPoints = state.sheet?.snapPoints || [0.3, 0.6, 0.9];
  const resolvedIndex = Math.max(0, Math.min(index, snapPoints.length - 1));
  const isPeek = resolvedIndex === 0;
  const peekVisible = Math.max(getSheetPeekVisibleHeight(), SHEET_PEEK_MIN_VISIBLE);
  const baseline = state.sheet?.baseline || computeSheetBaselineVisible();
  const minVisible = isPeek ? peekVisible : baseline;
  const { translate, visible } = computeSheetPosition(snapPoints[resolvedIndex], { minVisible });
  state.sheet.index = resolvedIndex;
  state.sheet.translate = translate;
  state.sheet.visible = visible;
  state.sheet.baseline = baseline;
  if (!animate) {
    dom.infoSheet.classList.add('sheet--dragging');
  } else {
    dom.infoSheet.classList.remove('sheet--dragging');
  }
  dom.infoSheet.style.setProperty('--sheet-translate', `${translate}px`);
  updateSheetVisualState(resolvedIndex);
  if (dom.sheetHandle) {
    const expanded = resolvedIndex !== 0;
    dom.sheetHandle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? 'Collapse arrival details' : 'Expand arrival details';
    dom.sheetHandle.setAttribute('aria-label', label);
  }
  if (!animate) {
    window.setTimeout(() => dom.infoSheet?.classList.remove('sheet--dragging'), 0);
  }
}

function refreshSheetSnap({ animate = false } = {}) {
  const changed = syncSheetSnapPoints();
  if (!state.sheet.snapPoints.length) {
    state.sheet.snapPoints = computeSheetSnapPoints();
  }
  state.sheet.baseline = computeSheetBaselineVisible();
  if (changed) {
    const maxIndex = state.sheet.snapPoints.length - 1;
    state.sheet.index = Math.max(0, Math.min(state.sheet.index ?? 0, maxIndex));
  }
  applySheetSnap(state.sheet.index ?? 0, { animate });
}

function cycleSheetSnap(direction = 1) {
  const snapPoints = state.sheet?.snapPoints || [];
  if (!snapPoints.length) return;
  const next = (state.sheet.index + direction + snapPoints.length) % snapPoints.length;
  applySheetSnap(next);
}

function onSheetHandleKeydown(evt) {
  if (!state.sheet?.snapPoints?.length) return;
  if (evt.key === ' ' || evt.key === 'Enter') {
    evt.preventDefault();
    cycleSheetSnap(1);
  } else if (evt.key === 'ArrowUp') {
    evt.preventDefault();
    cycleSheetSnap(1);
  } else if (evt.key === 'ArrowDown') {
    evt.preventDefault();
    cycleSheetSnap(-1);
  }
}

function startSheetDrag(evt) {
  if (!dom.sheetHandle || !dom.infoSheet) return;
  if (evt.pointerType === 'mouse' && evt.button !== 0) return;
  evt.preventDefault();
  const drag = {
    pointerId: evt.pointerId,
    startY: evt.clientY,
    startTranslate: state.sheet.translate || 0,
    moved: false,
  };
  drag.maxTranslate = clampSheetTranslate(Number.MAX_SAFE_INTEGER);
  drag.moveTarget = null;
  drag.usingPointerCapture = false;
  state.sheet.drag = drag;
  dom.infoSheet.classList.add('sheet--dragging');
  const handle = dom.sheetHandle;
  let moveTarget = handle;
  if (handle?.setPointerCapture) {
    try {
      handle.setPointerCapture(evt.pointerId);
      drag.usingPointerCapture = true;
    } catch (error) {
      drag.usingPointerCapture = false;
      moveTarget = window;
    }
  } else {
    moveTarget = window;
  }
  drag.moveTarget = moveTarget;
  moveTarget.addEventListener('pointermove', handleSheetDragMove);
  moveTarget.addEventListener('pointerup', finishSheetDrag);
  moveTarget.addEventListener('pointercancel', finishSheetDrag);
}

function handleSheetDragMove(evt) {
  const drag = state.sheet.drag;
  if (!drag || evt.pointerId !== drag.pointerId) return;
  const delta = evt.clientY - drag.startY;
  if (!drag.moved && Math.abs(delta) > 4) {
    drag.moved = true;
  }
  const next = clampSheetTranslate(drag.startTranslate + delta);
  state.sheet.translate = next;
  dom.infoSheet?.style.setProperty('--sheet-translate', `${next}px`);
}

function finishSheetDrag(evt) {
  const drag = state.sheet.drag;
  if (!drag || evt.pointerId !== drag.pointerId) return;
  const handle = dom.sheetHandle;
  if (drag.moveTarget) {
    drag.moveTarget.removeEventListener('pointermove', handleSheetDragMove);
    drag.moveTarget.removeEventListener('pointerup', finishSheetDrag);
    drag.moveTarget.removeEventListener('pointercancel', finishSheetDrag);
  }
  if (drag.usingPointerCapture && handle?.releasePointerCapture) {
    try {
      handle.releasePointerCapture(evt.pointerId);
    } catch (error) {
      // Ignore release failures; the pointer is already done.
    }
  }
  state.sheet.drag = null;
  dom.infoSheet?.classList.remove('sheet--dragging');
  const targetTranslate = state.sheet.translate;
  const wasTap = !drag.moved && Math.abs(targetTranslate - drag.startTranslate) < 6;
  if (wasTap) {
    cycleSheetSnap(1);
    return;
  }
  const snapPoints = state.sheet?.snapPoints || [0.3, 0.6, 0.9];
  let bestIndex = state.sheet.index;
  let bestDistance = Number.POSITIVE_INFINITY;
  const baseline = state.sheet?.baseline || computeSheetBaselineVisible();
  snapPoints.forEach((fraction, idx) => {
    const minVisible = idx === 0 ? Math.max(getSheetPeekVisibleHeight(), SHEET_PEEK_MIN_VISIBLE) : baseline;
    const { translate: candidate } = computeSheetPosition(fraction, { minVisible });
    const distance = Math.abs(candidate - targetTranslate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = idx;
    }
  });
  applySheetSnap(bestIndex);
}

function initSheetInteractions() {
  if (!dom.infoSheet) return;
  syncSheetSnapPoints();
  state.sheet.baseline = computeSheetBaselineVisible();
  refreshSheetSnap({ animate: false });
  const scheduleSheetRefresh = () => {
    if (state.sheet.resizeRaf) {
      window.cancelAnimationFrame(state.sheet.resizeRaf);
    }
    state.sheet.resizeRaf = window.requestAnimationFrame(() => {
      state.sheet.resizeRaf = null;
      refreshSheetSnap({ animate: false });
    });
  };
  if (dom.sheetHandle) {
    dom.sheetHandle.addEventListener('pointerdown', startSheetDrag, { passive: false });
    dom.sheetHandle.addEventListener('keydown', onSheetHandleKeydown);
  }
  if ('ResizeObserver' in window && dom.sheetContent) {
    state.sheet.observer = new ResizeObserver(() => scheduleSheetRefresh());
    state.sheet.observer.observe(dom.sheetContent);
  }
  window.addEventListener('resize', scheduleSheetRefresh);
  if (window.visualViewport) {
    const viewportRefresh = scheduleSheetRefresh;
    window.visualViewport.addEventListener('resize', viewportRefresh);
    window.visualViewport.addEventListener('scroll', viewportRefresh);
    state.sheet.viewportCleanup = () => {
      window.visualViewport.removeEventListener('resize', viewportRefresh);
      window.visualViewport.removeEventListener('scroll', viewportRefresh);
    };
    window.addEventListener('pagehide', () => {
      if (state.sheet.viewportCleanup) {
        state.sheet.viewportCleanup();
        state.sheet.viewportCleanup = null;
      }
    }, { once: true });
  }
}

function createRouteStop(role, value = '', meta = '') {
  state.routeStopCounter += 1;
  return {
    id: `route-stop-${state.routeStopCounter}`,
    role,
    value,
    meta,
  };
}

function normalizeRouteStopRoles() {
  if (!state.routeStops.length) return;
  state.routeStops.forEach((stop, index) => {
    if (index === 0) {
      stop.role = 'origin';
    } else if (index === state.routeStops.length - 1) {
      stop.role = 'destination';
    } else {
      stop.role = 'stop';
    }
  });
}

function getRouteStopLabel(index, role) {
  if (role === 'origin') return 'From';
  if (role === 'destination') return 'To';
  return `Stop ${index}`;
}

function getRouteStopPlaceholder(role) {
  if (role === 'origin') return 'Choose a starting point';
  if (role === 'destination') return 'Add a destination';
  return 'Add a stop';
}

function clearRouteDropIndicators() {
  if (!dom.routeStops) return;
  dom.routeStops.classList.remove('route-stops--drop-end');
  dom.routeStops.querySelectorAll('.route-stop--drop-before').forEach((node) => {
    node.classList.remove('route-stop--drop-before');
  });
}

function updateRouteDropIndicator(clientY) {
  if (!dom.routeStops || !state.draggingStop) return;
  clearRouteDropIndicators();
  const children = Array.from(dom.routeStops.children);
  let dropIndex = state.routeStops.length;
  for (let idx = 0; idx < children.length; idx += 1) {
    const child = children[idx];
    if (!child || child.dataset.id === state.draggingStop.id) continue;
    const rect = child.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      dropIndex = idx;
      child.classList.add('route-stop--drop-before');
      break;
    }
  }
  if (dropIndex === children.length) {
    dom.routeStops.classList.add('route-stops--drop-end');
  }
  state.draggingStop.dropIndex = dropIndex;
}

function clearRoutePlanner() {
  state.routeStops = [];
  state.routeStopCounter = 0;
  if (dom.routeStops) dom.routeStops.innerHTML = '';
  if (dom.routePlanner) dom.routePlanner.hidden = true;
  if (dom.routeSummary) dom.routeSummary.hidden = true;
  if (dom.sheetReset) dom.sheetReset.hidden = true;
}

function clearDestinationView() {
  stopEntranceVoting({ clearMarker: true });
  hideEntranceConfirmation({ mark: false });
  state.lastResult = null;
  state.selectedEntranceId = null;
  state.communitySummary = null;
  if (state.overlays) state.overlays.clearLayers();
  clearRoutePlanner();
  state.entranceOptions = [];
  if (dom.routeStops) {
    dom.routeStops.classList.remove('route-stops--dragging', 'route-stops--drop-end');
  }
  if (dom.insights) {
    dom.insights.innerHTML = '';
    dom.insights.hidden = true;
  }
  if (dom.directions) {
    dom.directions.innerHTML = '';
    dom.directions.hidden = true;
  }
  if (dom.navLinks) {
    dom.navLinks.innerHTML = '';
    dom.navLinks.hidden = true;
  }
  if (dom.entranceOptions) {
    dom.entranceOptions.hidden = true;
    dom.entranceOptions.setAttribute('aria-hidden', 'true');
  }
  if (dom.entranceOptionList) dom.entranceOptionList.innerHTML = '';
  if (dom.startEntranceVote) {
    dom.startEntranceVote.hidden = true;
    dom.startEntranceVote.disabled = false;
  }
  if (dom.entranceVoteHint) dom.entranceVoteHint.hidden = true;
  setStatus('');
  resetSheetHeadings();
  if (dom.infoSheet) {
    window.requestAnimationFrame(() => applySheetSnap(0, { animate: true }));
  }
}

function renderRouteStops({ preserveFocus = true } = {}) {
  if (!dom.routeStops) return;
  if (dom.routePlanner) dom.routePlanner.hidden = false;
  normalizeRouteStopRoles();
  const activeStopId = preserveFocus && document.activeElement?.dataset?.stopId;
  dom.routeStops.innerHTML = '';
  state.routeStops.forEach((stop, index) => {
    const item = document.createElement('div');
    item.className = 'route-stop';
    item.dataset.id = stop.id;

    const dragButton = document.createElement('button');
    dragButton.type = 'button';
    dragButton.className = 'route-stop__drag';
    dragButton.innerHTML = '&#9776;';
    dragButton.setAttribute('aria-label', 'Reorder stop');
    dragButton.addEventListener('pointerdown', (evt) => startStopDrag(evt, stop.id, item));
    item.appendChild(dragButton);

    const marker = document.createElement('span');
    marker.className = `route-stop__marker route-stop__marker--${stop.role}`;
    marker.textContent = stop.role === 'origin' ? '●' : stop.role === 'destination' ? '◎' : '◆';
    item.appendChild(marker);

    const body = document.createElement('div');
    body.className = 'route-stop__body';

    const label = document.createElement('span');
    label.className = 'route-stop__label';
    label.textContent = getRouteStopLabel(index, stop.role);
    body.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'route-stop__input';
    input.value = stop.value || '';
    input.placeholder = getRouteStopPlaceholder(stop.role);
    input.dataset.stopId = stop.id;
    input.addEventListener('input', (evt) => onRouteStopInput(stop.id, evt.target.value));
    body.appendChild(input);

    if (stop.meta) {
      const meta = document.createElement('span');
      meta.className = 'route-stop__meta';
      meta.textContent = stop.meta;
      body.appendChild(meta);
    }

    item.appendChild(body);

    const canRemove = state.routeStops.length > 2 && stop.role === 'stop';
    if (canRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'route-stop__remove';
      remove.setAttribute('aria-label', `Remove ${label.textContent?.toLowerCase() || 'stop'}`);
      remove.innerHTML = '&times;';
      remove.addEventListener('click', () => removeRouteStop(stop.id));
      item.appendChild(remove);
    }

    dom.routeStops.appendChild(item);

    if (activeStopId && activeStopId === stop.id) {
      window.requestAnimationFrame(() => {
        const target = dom.routeStops?.querySelector(`.route-stop__input[data-stop-id="${stop.id}"]`);
        if (target) {
          target.focus({ preventScroll: true });
          const len = target.value.length;
          target.setSelectionRange(len, len);
        }
      });
    }
  });
  dom.routeStops.classList.remove('route-stops--dragging', 'route-stops--drop-end');
  clearRouteDropIndicators();
  updateRouteResetState();
  refreshSheetSnap({ animate: false });
}

function onRouteStopInput(id, value) {
  const stop = state.routeStops.find((candidate) => candidate.id === id);
  if (!stop) return;
  stop.value = value;
  if (stop.role === 'origin' && value && value !== 'My Location') {
    stop.meta = '';
  }
  updateRouteResetState();
  updateRouteSummary();
}

function updateRouteResetState() {
  if (!dom.sheetReset) return;
  const hasExtraStops = state.routeStops.length > 2;
  const hasCustomValues = state.routeStops.some((stop, index) => {
    if (index === 0) return stop.value && stop.value !== 'My Location';
    return Boolean(stop.value);
  });
  dom.sheetReset.hidden = !(hasExtraStops || hasCustomValues);
}

function resetRoutePlanner({ preserveFocus = false } = {}) {
  if (!state.lastResult) return;
  state.routeStopCounter = 0;
  const originMeta = state.userLocation && Number.isFinite(state.userLocation.accuracy)
    ? `Accuracy ±${formatDistance(state.userLocation.accuracy)}`
    : '';
  const entrance = state.lastResult.entrance;
  const methodLabel = entrance?.methodLabel || friendlyMethodLabel(entrance?.source, entrance?.method);
  const destinationMeta = entrance && methodLabel ? `Entrance ${methodLabel}` : '';
  state.routeStops = [
    createRouteStop('origin', state.userLocation ? 'My Location' : '', originMeta),
    createRouteStop('destination', state.lastResult?.query || '', destinationMeta),
  ];
  renderRouteStops({ preserveFocus });
  updateRouteSummary();
}

function ensureRouteStops({ preserveFocus = false } = {}) {
  if (!state.lastResult) return;
  if (!state.routeStops.length) {
    resetRoutePlanner({ preserveFocus });
  } else {
    renderRouteStops({ preserveFocus });
    updateRouteSummary();
  }
}

function addRouteStop() {
  if (!state.lastResult) return;
  ensureRouteStops({ preserveFocus: false });
  const insertIndex = Math.max(1, state.routeStops.length - 1);
  const stop = createRouteStop('stop', '');
  state.routeStops.splice(insertIndex, 0, stop);
  renderRouteStops({ preserveFocus: false });
  updateRouteSummary();
  window.requestAnimationFrame(() => {
    const target = dom.routeStops?.querySelector(`.route-stop__input[data-stop-id="${stop.id}"]`);
    target?.focus({ preventScroll: true });
  });
}

function removeRouteStop(id) {
  if (state.routeStops.length <= 2) return;
  const index = state.routeStops.findIndex((stop) => stop.id === id);
  if (index <= 0 || index === state.routeStops.length - 1) return;
  state.routeStops.splice(index, 1);
  renderRouteStops({ preserveFocus: false });
  updateRouteSummary();
}

function setRouteMode(mode) {
  if (!mode || mode === state.routeMode) {
    updateRouteModeButtons();
    return;
  }
  state.routeMode = mode;
  updateRouteModeButtons();
  updateRouteSummary();
}

function updateRouteModeButtons() {
  if (!Array.isArray(dom.routeModes)) return;
  dom.routeModes.forEach((btn) => {
    const mode = btn?.dataset?.mode || 'drive';
    const isActive = mode === state.routeMode;
    btn.classList.toggle('route-mode--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function startStopDrag(evt, stopId, element) {
  if (!dom.routeStops || (evt.pointerType === 'mouse' && evt.button !== 0)) return;
  evt.preventDefault();
  const startIndex = state.routeStops.findIndex((stop) => stop.id === stopId);
  if (startIndex < 0) return;
  state.draggingStop = {
    id: stopId,
    pointerId: evt.pointerId,
    startY: evt.clientY,
    startIndex,
    dropIndex: startIndex,
    element,
  };
  element.classList.add('route-stop--dragging');
  element.style.transition = 'none';
  dom.routeStops.classList.add('route-stops--dragging');
  element.setPointerCapture(evt.pointerId);
  element.addEventListener('pointermove', handleStopDragMove);
  element.addEventListener('pointerup', finishStopDrag);
  element.addEventListener('pointercancel', finishStopDrag);
}

function handleStopDragMove(evt) {
  const drag = state.draggingStop;
  if (!drag || evt.pointerId !== drag.pointerId) return;
  const delta = evt.clientY - drag.startY;
  drag.element.style.transform = `translateY(${delta}px)`;
  updateRouteDropIndicator(evt.clientY);
}

function finishStopDrag(evt) {
  const drag = state.draggingStop;
  if (!drag || evt.pointerId !== drag.pointerId) return;
  drag.element.releasePointerCapture(evt.pointerId);
  drag.element.removeEventListener('pointermove', handleStopDragMove);
  drag.element.removeEventListener('pointerup', finishStopDrag);
  drag.element.removeEventListener('pointercancel', finishStopDrag);
  drag.element.classList.remove('route-stop--dragging');
  drag.element.style.transition = '';
  drag.element.style.transform = '';
  dom.routeStops?.classList.remove('route-stops--dragging', 'route-stops--drop-end');
  clearRouteDropIndicators();

  const fromIndex = drag.startIndex;
  let toIndex = drag.dropIndex ?? fromIndex;
  if (toIndex > fromIndex) toIndex -= 1;
  toIndex = Math.max(0, Math.min(toIndex, state.routeStops.length - 1));
  state.draggingStop = null;
  if (toIndex !== fromIndex) {
    const [moved] = state.routeStops.splice(fromIndex, 1);
    state.routeStops.splice(toIndex, 0, moved);
    renderRouteStops({ preserveFocus: false });
    updateRouteSummary();
  }
}

function updateOriginStopFromLocation() {
  if (!state.routeStops.length || !state.userLocation) return;
  const origin = state.routeStops[0];
  if (!origin.value || origin.value === 'My Location') {
    origin.value = 'My Location';
  }
  if (Number.isFinite(state.userLocation.accuracy)) {
    origin.meta = `Accuracy ±${formatDistance(state.userLocation.accuracy)}`;
  }
  renderRouteStops();
}

function updateDestinationStopFromResult(data) {
  if (!state.routeStops.length) return;
  const destination = state.routeStops[state.routeStops.length - 1];
  const query = data?.query;
  if (query) {
    destination.value = query;
  }
  if (data?.entrance) {
    const methodLabel = data.entrance.methodLabel || friendlyMethodLabel(data.entrance.source, data.entrance.method);
    destination.meta = methodLabel ? `Entrance ${methodLabel}` : '';
  }
  renderRouteStops();
  updateRouteSummary();
}

function focusOnRouteHighlights() {
  if (!state.map || !state.lastResult) return;
  const points = [];
  if (state.lastResult.roadPoint) {
    points.push([state.lastResult.roadPoint.lat, state.lastResult.roadPoint.lon]);
  }
  if (state.lastResult.entrance) {
    points.push([state.lastResult.entrance.lat, state.lastResult.entrance.lon]);
  }
  if (!points.length) return;
  const reduceMotion = shouldReduceMotion();
  if (points.length === 1) {
    const currentZoom = typeof state.map.getZoom === 'function' ? state.map.getZoom() : MIN_LOCATE_ZOOM;
    const targetZoom = Math.min(MAX_SATELLITE_ZOOM, Math.max(currentZoom, MIN_LOCATE_ZOOM + 1));
    state.map.setView(points[0], targetZoom, { animate: !reduceMotion });
  } else {
    const bounds = L.latLngBounds(points);
    state.map.fitBounds(bounds, { padding: [56, 56], maxZoom: MAX_SATELLITE_ZOOM, animate: !reduceMotion });
  }
}

function updateRouteSummary() {
  if (!dom.routeSummary) return;
  dom.routeSummary.innerHTML = '';
  const result = state.lastResult;
  if (!result || !state.routeStops.length) {
    dom.routeSummary.hidden = true;
    return;
  }
  const card = document.createElement('div');
  card.className = 'route-summary__card';

  const meta = document.createElement('div');
  meta.className = 'route-summary__meta';
  const title = document.createElement('div');
  title.className = 'route-summary__title';
  if (state.routeMode === 'walk') {
    title.textContent = 'Seamless walk';
  } else if (state.routeMode === 'bike') {
    title.textContent = 'Bike-friendly route';
  } else if (state.routeMode === 'transit') {
    title.textContent = 'Transit handoff';
  } else {
    title.textContent = 'Smart arrival';
  }

  const detail = document.createElement('div');
  detail.className = 'route-summary__detail';
  const detailParts = [];
  if (result.roadPoint && state.userLocation) {
    const driveDistance = haversine(state.userLocation, result.roadPoint);
    if (driveDistance) detailParts.push(`Drive ${formatDistance(driveDistance)}`);
  }
  if (result.roadPoint && result.entrance) {
    const walkDistance = haversine(result.roadPoint, result.entrance);
    if (walkDistance) detailParts.push(`Walk ${formatDistance(walkDistance)}`);
  } else if (result.entrance && state.userLocation) {
    const approachDistance = haversine(state.userLocation, result.entrance);
    if (approachDistance) detailParts.push(`Approach ${formatDistance(approachDistance)}`);
  }
  if (!detailParts.length) {
    detailParts.push('Optimized for the verified entrance');
  }
  detail.textContent = detailParts.join(' • ');

  meta.appendChild(title);
  meta.appendChild(detail);
  card.appendChild(meta);

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'route-summary__cta';
  cta.textContent = 'Go';
  cta.addEventListener('click', () => {
    focusOnRouteHighlights();
    cycleSheetSnap(-1);
  });
  card.appendChild(cta);

  dom.routeSummary.appendChild(card);
  dom.routeSummary.hidden = false;
  refreshSheetSnap({ animate: false });
}

function initRoutePlanner() {
  clearRoutePlanner();
  updateRouteModeButtons();
  if (dom.addRouteStop) {
    dom.addRouteStop.addEventListener('click', addRouteStop);
  }
  if (dom.sheetReset) {
    dom.sheetReset.addEventListener('click', resetRoutePlanner);
  }
  if (Array.isArray(dom.routeModes)) {
    dom.routeModes.forEach((btn) => {
      btn.addEventListener('click', () => setRouteMode(btn.dataset.mode || 'drive'));
    });
  }
  updateRouteSummary();
}

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
  updateOriginStopFromLocation();
  const shouldCenter = centerOnUser || !state.hasCenteredOnUser;
  if (state.map && shouldCenter) {
    const mapZoom = typeof state.map.getZoom === 'function' ? state.map.getZoom() : MIN_LOCATE_ZOOM;
    const targetZoom = centerOnUser ? Math.max(mapZoom, MIN_LOCATE_ZOOM + 1) : Math.max(mapZoom, MIN_LOCATE_ZOOM);
    const zoom = Math.min(MAX_SATELLITE_ZOOM, targetZoom);
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
  updateRouteSummary();
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
    dom.locateButton.classList.add('map-locate--error');
    window.setTimeout(() => {
      dom.locateButton?.classList.remove('map-locate--error');
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
    dom.locateButton.classList.add('map-locate--loading');
  } else {
    dom.locateButton.removeAttribute('aria-busy');
    dom.locateButton.disabled = false;
    dom.locateButton.classList.remove('map-locate--loading');
  }
}

function focusOnUserLocation({ animate = true, useFly = true, zoom = MIN_LOCATE_ZOOM + 1 } = {}) {
  if (!state.map || !state.userLocation) return;
  const latLng = [state.userLocation.lat, state.userLocation.lon];
  const mapZoom = typeof state.map.getZoom === 'function' ? state.map.getZoom() : MIN_LOCATE_ZOOM;
  const targetZoom = Math.min(MAX_SATELLITE_ZOOM, Math.max(mapZoom, zoom));
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
  if (!item || !dom.searchInput) return;
  const label = item.label || '';
  dom.searchInput.value = label;
  dom.searchInput.focus();
  renderSuggestions([]);
  dom.clearSearch.hidden = !label;
  updateNavigationLinks();
  const query = label.trim();
  if (query) {
    performSearch(query);
  }
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

function friendlyMethodLabel(source, method) {
  const sourceKey = String(source || '').toLowerCase();
  const methodKey = String(method || '').toLowerCase();
  if (sourceKey === 'community' || methodKey === 'community_votes') return 'Community favorite';
  if (sourceKey === 'cnn' || methodKey === 'cnn_regressor') return 'CNN inference';
  if (methodKey.startsWith('nearest_road_projection_polygon')) return 'Footprint projection';
  if (methodKey.startsWith('nearest_road_projection_bbox')) return 'Road projection';
  if (methodKey.startsWith('center_projection_polygon')) return 'Footprint projection';
  if (methodKey.startsWith('center_projection_bbox')) return 'Centroid projection';
  if (methodKey === 'center_fallback') return 'Geocoded center';
  return 'Model projection';
}

function normalizeEntranceResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.entrance && typeof result.entrance === 'object') {
    const source = result.entrance.source || (String(result.entrance.method || '').includes('cnn') ? 'cnn' : 'heuristic');
    result.entrance.source = source;
    if (!result.entrance.label) {
      result.entrance.label = source === 'community' ? 'Community entrance' : source === 'cnn' ? 'CNN entrance' : 'Projected entrance';
    }
    if (!result.entrance.methodLabel) {
      result.entrance.methodLabel = friendlyMethodLabel(source, result.entrance.method);
    }
  }
  if (result.communityEntrances && !Array.isArray(result.communityEntrances.clusters)) {
    result.communityEntrances.clusters = [];
  }
  return result;
}

function normalizePromptKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 256);
}

function updateEntranceConfirmationMessage(result) {
  if (!dom.entranceConfirmMessage) return;
  const raw = String(result?.query || '').trim();
  const label = raw ? (raw.length > 62 ? `${raw.slice(0, 59)}…` : raw) : 'this destination';
  const votes = Number(result?.communityEntrances?.totalVotes) || 0;
  const suffix = votes
    ? `You’d be joining ${votes} neighbor${votes === 1 ? '' : 's'} who have already confirmed.`
    : 'A quick thumbs-up helps future riders arrive with confidence.';
  dom.entranceConfirmMessage.textContent = `We’re double-checking the entrance for “${label}”. Does it look right? ${suffix}`;
}

function hideEntranceConfirmation({ mark = false } = {}) {
  const key = state.confirmationPrompt?.key;
  if (mark && key) state.confirmationHistory.add(key);
  state.confirmationPrompt = null;
  if (dom.entranceConfirm) dom.entranceConfirm.hidden = true;
  if (dom.entranceConfirmYes) dom.entranceConfirmYes.disabled = false;
  if (dom.entranceConfirmNo) dom.entranceConfirmNo.disabled = false;
}

function showEntranceConfirmation(result) {
  if (!dom.entranceConfirm) return;
  const key = normalizePromptKey(result?.query);
  const entrance = result?.entrance;
  if (!key || !entrance || !Number.isFinite(entrance.lat) || !Number.isFinite(entrance.lon)) return;
  state.confirmationPrompt = {
    key,
    query: result.query,
    entrance: { lat: entrance.lat, lon: entrance.lon },
  };
  updateEntranceConfirmationMessage(result);
  dom.entranceConfirm.hidden = false;
  if (dom.entranceConfirmYes) dom.entranceConfirmYes.disabled = false;
  if (dom.entranceConfirmNo) dom.entranceConfirmNo.disabled = false;
  state.lastConfirmationPromptAt = Date.now();
}

function maybePromptEntranceConfirmation(result, { allowRandom = false } = {}) {
  if (!dom.entranceConfirm) return;
  if (!allowRandom) {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  const entrance = result?.entrance;
  const query = result?.query;
  if (!entrance || !Number.isFinite(entrance.lat) || !Number.isFinite(entrance.lon) || !query) {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  const methodKey = String(entrance.method || '').toLowerCase();
  if (!methodKey || methodKey === 'center_fallback') {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  if (state.isVoting || state.voteInFlight) {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  if ((state.searchCount || 0) < 1) {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  const key = normalizePromptKey(query);
  if (!key) {
    hideEntranceConfirmation({ mark: false });
    return;
  }
  if (state.confirmationPrompt && state.confirmationPrompt.key === key) {
    updateEntranceConfirmationMessage(result);
    return;
  }
  if (state.confirmationHistory.has(key)) {
    hideEntranceConfirmation({ mark: true });
    return;
  }
  const now = Date.now();
  if (state.lastConfirmationPromptAt && now - state.lastConfirmationPromptAt < 45000) {
    return;
  }
  if (Math.random() >= 0.1) {
    return;
  }
  showEntranceConfirmation(result);
}

async function performSearch(query) {
  if (!query) return;
  stopEntranceVoting({ clearMarker: true });
  hideEntranceConfirmation({ mark: false });
  state.selectedEntranceId = null;
  state.entranceOptions = [];
  renderEntranceOptions({});
  renderSuggestions([]);
  dom.clearSearch.hidden = !query;
  setStatus('Finding satellite entrance...');

  if (state.pendingSearch) {
    state.pendingSearch.abort();
  }
  const controller = new AbortController();
  state.pendingSearch = controller;
  state.searchInFlight = true;
  if (dom.searchInput) {
    dom.searchInput.setAttribute('aria-busy', 'true');
    dom.searchInput.disabled = true;
  }
  showSplash({ mode: 'search', message: 'Scanning satellite imagery for entrances...', progress: 0.14 });
  advanceSplashProgress(0.32, 140);

  try {
    const resp = await fetch(`/entrance?q=${encodeURIComponent(query)}`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error || 'search_failed');
    }
    if (state.pendingSearch !== controller) return;
    advanceSplashProgress(0.62);
    updateSplashMessage('Aligning entrance guidance...');
    normalizeEntranceResult(data);
    if (data.entrance) {
      data.baseEntrance = { ...data.entrance };
    }
    data.promptEligible = true;
    state.lastResult = data;
    state.searchCount = (state.searchCount || 0) + 1;
    renderResult(data, { seedRouteStops: true });
    updateSplashMessage('Finalizing route view...');
    advanceSplashProgress(0.9);
    setStatus('Entrance updated with current imagery.', 'success');
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }
    if (state.pendingSearch !== controller) return;
    setSplashProgress(1);
    updateSplashMessage('We hit a snag finding that entrance.');
    const message = error?.message === 'search_failed' ? 'Unable to locate that address right now.' : error?.message || 'Entrance lookup failed.';
    setStatus(message, 'error');
  } finally {
    if (state.pendingSearch === controller) {
      state.pendingSearch = null;
      state.searchInFlight = false;
      if (dom.searchInput) {
        dom.searchInput.removeAttribute('aria-busy');
        dom.searchInput.disabled = false;
      }
      renderEntranceOptions(state.lastResult || {});
      hideSplash({ delay: 220 });
    }
  }
}

function renderResult(data, options = {}) {
  if (!state.map || !state.overlays) return;
  const { preserveView = false, skipStateUpdate = false, seedRouteStops = false } = options;
  if (!skipStateUpdate) {
    state.lastResult = data;
  }
  state.overlays.clearLayers();
  const tokens = getDesignTokens();
  const reduceMotion = shouldReduceMotion();
  const { bbox, center, entrance, cnnEntrance, roadPoint, footprint } = data;
  const community = data?.communityEntrances || null;
  state.communitySummary = community;
  const entrancePoint = entrance ? { lat: entrance.lat, lon: entrance.lon } : null;

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
        state.map.flyToBounds(bounds, { padding: [48, 48], maxZoom: MAX_SATELLITE_ZOOM, duration: 0.8 });
      } else {
        state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: MAX_SATELLITE_ZOOM, animate: !reduceMotion });
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
    const isCommunity = entrance.source === 'community' || entrance.method === 'community_votes';
    const marker = L.circleMarker([entrance.lat, entrance.lon], {
      radius: entrance.userSelected ? 9 : 8,
      color: isCommunity ? tokens.markerCommunityBorder : tokens.markerEntranceBorder,
      fillColor: isCommunity ? tokens.markerCommunityFill : tokens.markerEntranceFill,
      fillOpacity: 0.9,
      weight: entrance.userSelected ? 3.5 : 3,
    });
    const label = entrance.methodLabel || entrance.label || (isCommunity ? 'Community entrance' : 'Verified entrance');
    marker.addTo(state.overlays).bindTooltip(label);
  }

  if (community && Array.isArray(community.clusters)) {
    community.clusters.forEach((cluster) => {
      if (!Number.isFinite(cluster?.lat) || !Number.isFinite(cluster?.lon)) return;
      if (entrancePoint) {
        const d = haversine(entrancePoint, cluster);
        if (Number.isFinite(d) && d < 1.5) return;
      }
      const isSelected = state.selectedEntranceId === `community-${cluster.id}`;
      const voteText = `${cluster.count} community vote${cluster.count === 1 ? '' : 's'}`;
      const tooltip = cluster.label ? `${cluster.label} • ${voteText}` : voteText;
      L.circleMarker([cluster.lat, cluster.lon], {
        radius: isSelected ? 7.5 : 6,
        color: tokens.markerCommunityBorder,
        fillColor: tokens.markerCommunityFill,
        fillOpacity: isSelected ? 0.95 : 0.65,
        weight: isSelected ? 3 : 2,
        opacity: 0.95,
      }).addTo(state.overlays).bindTooltip(tooltip);
    });
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
  renderEntranceOptions(data);
  const allowPrompt = Boolean(data?.promptEligible);
  if (data) data.promptEligible = false;
  maybePromptEntranceConfirmation(data, { allowRandom: allowPrompt });

  const shouldSeedStops = seedRouteStops || (!state.routeStops.length && Boolean(state.lastResult));
  if (shouldSeedStops) {
    resetRoutePlanner({ preserveFocus: false });
  } else {
    updateDestinationStopFromResult(data);
  }

  if (dom.infoSheet) {
    dom.infoSheet.hidden = false;
    dom.infoSheet.setAttribute('aria-hidden', 'false');
    const shouldRevealSheet = shouldSeedStops || (!skipStateUpdate && state.sheet.index === 0);
    window.requestAnimationFrame(() => {
      if (shouldRevealSheet) {
        applySheetSnap(1, { animate: true });
      } else {
        refreshSheetSnap({ animate: false });
      }
    });
  }
}

function buildEntranceOptions(result) {
  const options = [];
  const seen = new Set();
  const addOption = (option) => {
    if (!option || !Number.isFinite(option.lat) || !Number.isFinite(option.lon)) return;
    const key = option.id || `${option.source || 'option'}:${option.clusterId || ''}:${option.lat.toFixed(6)}:${option.lon.toFixed(6)}`;
    const id = option.id || key;
    if (seen.has(id)) return;
    option.id = id;
    seen.add(id);
    options.push(option);
  };

  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  if (candidates.length) {
    candidates.forEach((candidate, index) => {
      if (!Number.isFinite(candidate?.lat) || !Number.isFinite(candidate?.lon)) return;
      const source = candidate.source || (index === 0 ? 'heuristic' : 'candidate');
      const id = candidate.communityClusterId ? `community-${candidate.communityClusterId}` : `${source}-${index}`;
      addOption({
        id,
        lat: candidate.lat,
        lon: candidate.lon,
        label: candidate.label || (source === 'community' ? 'Community entrance' : source === 'cnn' ? 'CNN entrance' : 'Projected entrance'),
        detail: source === 'community'
          ? `${candidate.votes || 1} community vote${candidate.votes === 1 ? '' : 's'}`
          : source === 'cnn'
            ? 'AI vision pick'
            : 'Model projection',
        source,
        votes: candidate.votes || null,
        clusterId: candidate.communityClusterId || null,
        score: candidate.score || null,
      });
    });
  } else if (result?.entrance && Number.isFinite(result.entrance.lat) && Number.isFinite(result.entrance.lon)) {
    addOption({
      id: 'projected',
      lat: result.entrance.lat,
      lon: result.entrance.lon,
      label: 'Projected entrance',
      detail: 'Model projection',
      source: 'heuristic',
      votes: null,
      clusterId: null,
      score: 0.9,
    });
  }

  const community = result?.communityEntrances;
  if (community && Array.isArray(community.clusters)) {
    community.clusters.forEach((cluster) => {
      if (!Number.isFinite(cluster?.lat) || !Number.isFinite(cluster?.lon)) return;
      addOption({
        id: `community-${cluster.id}`,
        lat: cluster.lat,
        lon: cluster.lon,
        label: cluster.label || 'Community entrance',
        detail: `${cluster.count} community vote${cluster.count === 1 ? '' : 's'}`,
        source: 'community',
        votes: cluster.count,
        clusterId: cluster.id,
        updatedAt: cluster.updatedAt || null,
      });
    });
  }

  const priority = { heuristic: 0, community: 1, cnn: 2, candidate: 3 };
  options.sort((a, b) => {
    const diff = (priority[a.source] ?? 5) - (priority[b.source] ?? 5);
    if (diff !== 0) return diff;
    if (a.source === 'community' && b.source === 'community') {
      return (b.votes || 0) - (a.votes || 0);
    }
    return (b.score || 0) - (a.score || 0);
  });

  return options;
}

function renderEntranceOptions(result) {
  if (!dom.entranceOptions || !dom.entranceOptionList) return;
  const options = buildEntranceOptions(result);
  state.entranceOptions = options;

  if (state.searchInFlight) {
    dom.entranceOptionList.innerHTML = '';
    dom.entranceOptions.hidden = true;
    dom.entranceOptions.setAttribute('aria-hidden', 'true');
    if (dom.entranceOptionsMeta) dom.entranceOptionsMeta.textContent = '';
    if (dom.startEntranceVote) {
      dom.startEntranceVote.hidden = true;
      dom.startEntranceVote.disabled = false;
    }
    if (dom.entranceVoteHint) dom.entranceVoteHint.hidden = true;
    dom.entranceOptions.classList.remove('entrance-options--voting');
    return;
  }

  if (!options.length) {
    dom.entranceOptionList.innerHTML = '';
    dom.entranceOptions.hidden = true;
    dom.entranceOptions.setAttribute('aria-hidden', 'true');
    if (dom.entranceOptionsMeta) dom.entranceOptionsMeta.textContent = '';
    if (dom.startEntranceVote) {
      dom.startEntranceVote.hidden = true;
      dom.startEntranceVote.disabled = false;
    }
    if (dom.entranceVoteHint) dom.entranceVoteHint.hidden = true;
    dom.entranceOptions.classList.remove('entrance-options--voting');
    return;
  }

  dom.entranceOptions.hidden = false;
  dom.entranceOptions.setAttribute('aria-hidden', 'false');
  dom.entranceOptionList.innerHTML = '';

  const currentEntrance = result?.entrance;
  if (currentEntrance) {
    const match = options.find((option) => {
      const distance = haversine({ lat: option.lat, lon: option.lon }, currentEntrance);
      return Number.isFinite(distance) && distance < 1.2;
    });
    if (match) {
      state.selectedEntranceId = match.id;
    }
  }
  if (!state.selectedEntranceId && options[0]) {
    state.selectedEntranceId = options[0].id;
  }

  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entrance-option';
    button.dataset.optionId = option.id;
    button.setAttribute('role', 'listitem');
    if (option.id === state.selectedEntranceId) {
      button.classList.add('entrance-option--active');
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'entrance-option__text';

    const labelNode = document.createElement('span');
    labelNode.className = 'entrance-option__label';
    labelNode.textContent = option.label;
    textWrap.appendChild(labelNode);

    const detailNode = document.createElement('span');
    detailNode.className = 'entrance-option__detail';
    detailNode.textContent = option.detail || '';
    textWrap.appendChild(detailNode);

    button.appendChild(textWrap);

    if (option.votes) {
      const badge = document.createElement('span');
      badge.className = 'entrance-option__badge';
      badge.textContent = `${option.votes} vote${option.votes === 1 ? '' : 's'}`;
      button.appendChild(badge);
    } else if (option.source === 'cnn') {
      const badge = document.createElement('span');
      badge.className = 'entrance-option__badge';
      badge.textContent = 'AI';
      button.appendChild(badge);
    }

    button.addEventListener('click', () => {
      applyEntranceSelection(option);
    });

    dom.entranceOptionList.appendChild(button);
  });

  if (dom.entranceOptionsMeta) {
    const totalVotes = state.communitySummary?.totalVotes || 0;
    dom.entranceOptionsMeta.textContent = totalVotes ? `${totalVotes} community vote${totalVotes === 1 ? '' : 's'}` : '';
  }
  if (dom.startEntranceVote) {
    dom.startEntranceVote.hidden = false;
    dom.startEntranceVote.disabled = state.voteInFlight;
    dom.startEntranceVote.textContent = state.isVoting ? 'Finish placement' : 'Suggest another entrance';
  }
  if (dom.entranceVoteHint) {
    dom.entranceVoteHint.hidden = !state.isVoting;
  }
  dom.entranceOptions.classList.toggle('entrance-options--voting', state.isVoting);
}

function applyEntranceSelection(option, { silent = false } = {}) {
  if (!option || !state.lastResult) return;
  hideEntranceConfirmation({ mark: true });
  const result = state.lastResult;
  const center = result.center && Number.isFinite(result.center.lat) && Number.isFinite(result.center.lon)
    ? { lat: result.center.lat, lon: result.center.lon }
    : null;
  const baseMethod = result.baseEntrance?.method || result.entrance?.method || null;
  const method = option.source === 'community'
    ? 'community_votes'
    : option.source === 'cnn'
      ? 'cnn_regressor'
      : baseMethod;
  const entrance = {
    lat: option.lat,
    lon: option.lon,
    label: option.label,
    source: option.source || null,
    communityClusterId: option.clusterId || null,
    votes: option.votes || null,
    method,
    methodLabel: friendlyMethodLabel(option.source, method),
    userSelected: option.source === 'community',
  };
  if (center) {
    const distance = haversine(center, entrance);
    if (Number.isFinite(distance)) entrance.distance_m = distance;
  } else if (Number.isFinite(result.entrance?.distance_m)) {
    entrance.distance_m = result.entrance.distance_m;
  }
  if (result.entrance && !result.baseEntrance) {
    result.baseEntrance = { ...result.entrance };
  }
  result.entrance = entrance;
  state.selectedEntranceId = option.id;
  state.lastResult = result;
  renderResult(state.lastResult, { preserveView: true, skipStateUpdate: true });
  if (!silent) {
    const descriptor = option.source === 'community' ? 'community entrance' : option.source === 'cnn' ? 'CNN candidate' : 'projected entrance';
    setStatus(`Entrance updated to the ${descriptor}.`, 'success');
  }
}

function startEntranceVoting() {
  if (!state.map || state.isVoting) return;
  hideEntranceConfirmation({ mark: true });
  state.isVoting = true;
  if (state.voteLayer) state.voteLayer.clearLayers();
  state.voteMarker = null;
  if (state.voteHandler) {
    state.map.off('click', state.voteHandler);
  }
  state.voteHandler = (evt) => handleVoteMapClick(evt);
  state.map.on('click', state.voteHandler);
  if (dom.entranceVoteHint) dom.entranceVoteHint.hidden = false;
  setStatus('Tap the entrance on the map to share it with others.', 'info');
  renderEntranceOptions(state.lastResult || {});
}

function stopEntranceVoting({ clearMarker = true } = {}) {
  if (state.map && state.voteHandler) {
    state.map.off('click', state.voteHandler);
    state.voteHandler = null;
  }
  if (clearMarker && state.voteLayer) state.voteLayer.clearLayers();
  state.voteMarker = null;
  state.isVoting = false;
  if (dom.entranceVoteHint) dom.entranceVoteHint.hidden = true;
  renderEntranceOptions(state.lastResult || {});
}

function handleVoteMapClick(evt) {
  if (!state.isVoting || state.voteInFlight) return;
  const lat = Number(evt?.latlng?.lat);
  const lon = Number(evt?.latlng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const tokens = getDesignTokens();
  if (!state.voteLayer) {
    state.voteLayer = L.layerGroup().addTo(state.map);
  }
  if (!state.voteMarker) {
    state.voteMarker = L.circleMarker([lat, lon], {
      radius: 7,
      color: tokens.markerSelectedBorder,
      fillColor: tokens.markerSelectedFill,
      fillOpacity: 0.92,
      weight: 3,
    }).addTo(state.voteLayer);
  } else {
    state.voteMarker.setLatLng([lat, lon]);
    state.voteMarker.setStyle({
      color: tokens.markerSelectedBorder,
      fillColor: tokens.markerSelectedFill,
    });
  }
  const confirmPlacement = window.confirm('Use this location as a community entrance?');
  if (!confirmPlacement) return;
  submitCommunityVote(lat, lon);
}

async function submitCommunityVote(lat, lon, options = {}) {
  if (state.voteInFlight) return;
  const query = state.lastResult?.query;
  if (!query) {
    setStatus('Search for a destination before suggesting an entrance.', 'error');
    return;
  }
  state.voteInFlight = true;
  if (dom.startEntranceVote) dom.startEntranceVote.disabled = true;
  const statusMessage = typeof options.statusMessage === 'string' && options.statusMessage.trim()
    ? options.statusMessage.trim()
    : 'Recording your entrance...';
  setStatus(statusMessage, 'info');
  const labelInput = typeof options.label === 'string' ? options.label.trim() : '';
  const label = labelInput ? labelInput.slice(0, 120) : 'Community entrance';
  try {
    const resp = await fetch('/entrance/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, lat, lon, label }),
    });
    const payload = await resp.json();
    if (!resp.ok) {
      throw new Error(payload?.error || 'vote_failed');
    }
    if (payload?.summary) {
      state.lastResult.communityEntrances = payload.summary;
      state.communitySummary = payload.summary;
      if (Array.isArray(state.lastResult.candidates)) {
        state.lastResult.candidates = state.lastResult.candidates.filter((candidate) => candidate.source !== 'community');
        const clusters = payload.summary.clusters || [];
        if (clusters.length) {
          const top = clusters[0];
          state.lastResult.candidates.push({
            lat: top.lat,
            lon: top.lon,
            score: 0.88,
            label: `${top.count} community vote${top.count === 1 ? '' : 's'}`,
            source: 'community',
            communityClusterId: top.id,
            votes: top.count,
          });
        }
      }
      if (payload.cluster) {
        const option = {
          id: `community-${payload.cluster.id}`,
          lat: payload.cluster.lat,
          lon: payload.cluster.lon,
          label: payload.cluster.label || 'Community entrance',
          detail: `${payload.cluster.count} community vote${payload.cluster.count === 1 ? '' : 's'}`,
          source: 'community',
          votes: payload.cluster.count,
          clusterId: payload.cluster.id,
        };
        applyEntranceSelection(option, { silent: true });
      } else {
        renderResult(state.lastResult, { preserveView: true, skipStateUpdate: true });
      }
    }
    setStatus('Thanks! Your entrance will help others.', 'success');
  } catch (error) {
    const message = error?.message === 'vote_failed' ? 'Unable to save that entrance right now.' : error?.message || 'Entrance vote failed.';
    setStatus(message, 'error');
  } finally {
    state.voteInFlight = false;
    if (dom.startEntranceVote) dom.startEntranceVote.disabled = false;
    stopEntranceVoting({ clearMarker: true });
  }
}

function resetSheetHeadings() {
  if (dom.sheetTitle) {
    dom.sheetTitle.textContent = 'Directions';
  }
  if (dom.sheetSubtitle) {
    dom.sheetSubtitle.textContent = 'Set your origin, add stops, and glide to the verified entrance.';
  }
}

function updateSheetHeadings(data) {
  if (!data) {
    resetSheetHeadings();
    return;
  }
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
    const lines = [`Lat: ${formatCoord(entrance.lat)}, Lon: ${formatCoord(entrance.lon)}`];
    const meta = [];
    if (entrance.methodLabel) meta.push(entrance.methodLabel);
    if (Number.isFinite(entrance.distance_m)) meta.push(`${formatDistance(entrance.distance_m)} from center`);
    if (entrance.votes) meta.push(`${entrance.votes} community vote${entrance.votes === 1 ? '' : 's'}`);
    if (meta.length) lines.push(meta.join(' • '));
    items.push({
      title: 'Selected entrance',
      lines,
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
  if (data?.communityEntrances?.totalVotes) {
    const total = data.communityEntrances.totalVotes;
    const radius = Number.isFinite(data.communityEntrances.clusterRadius) ? formatDistance(data.communityEntrances.clusterRadius) : null;
    const lines = [`${total} community vote${total === 1 ? '' : 's'} recorded.`];
    if (radius) lines.push(`Grouped within ~${radius}.`);
    items.push({
      title: 'Community activity',
      lines,
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
    const card = {
      title: 'Glide to drop-off',
      description: 'Follow the map highlight to the best curbside handoff.',
      meta: [],
      icon: '🚗',
    };
    if (user && Number.isFinite(dropDistance)) {
      card.meta.push(`Drive ${formatDistance(dropDistance)}`);
    }
    card.meta.push(`Pin ${formatCoord(roadPoint.lat)}, ${formatCoord(roadPoint.lon)}`);
    if (user && dropDistance !== null && dropDistance <= 30) {
      card.className = 'direction-step--primary';
    }
    steps.push(card);
  }
  if (entrance) {
    const walkDistance = roadPoint ? haversine(roadPoint, entrance) : null;
    const directDistance = user ? haversine(user, entrance) : null;
    const origin = roadPoint || user;
    const card = {
      title: 'Final approach',
      description: 'Leave the vehicle and follow on-premise cues to the entrance.',
      meta: [],
      icon: '🚶',
      className: 'direction-step--primary',
    };
    if (origin) {
      const bearing = computeBearing(origin.lat, origin.lon, entrance.lat, entrance.lon);
      if (walkDistance || directDistance) {
        card.meta.push(`Walk ${formatDistance(walkDistance || directDistance)}`);
      }
      card.meta.push(bearingToText(bearing));
    }
    steps.push(card);
  }
  if (user && !isInsideBBox(user, result.bbox)) {
    steps.unshift({
      title: 'Outside the site',
      description: 'Make your way toward the campus boundary to pick up the guided arrival.',
      meta: ['Zoom to the highlighted area'],
      icon: '⚠️',
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
    const headingRow = document.createElement('div');
    headingRow.className = 'direction-step__heading';
    if (step.icon) {
      const icon = document.createElement('span');
      icon.className = 'direction-step__icon';
      icon.textContent = step.icon;
      headingRow.appendChild(icon);
    }
    const heading = document.createElement('strong');
    heading.textContent = step.title;
    headingRow.appendChild(heading);
    node.appendChild(headingRow);
    const body = document.createElement('div');
    body.textContent = step.description;
    node.appendChild(body);
    if (Array.isArray(step.meta) && step.meta.length) {
      const meta = document.createElement('div');
      meta.className = 'direction-step__meta';
      step.meta.forEach((value) => {
        const chip = document.createElement('span');
        chip.textContent = value;
        meta.appendChild(chip);
      });
      node.appendChild(meta);
    }
    dom.directions.appendChild(node);
  });
  dom.directions.hidden = false;
  refreshSheetSnap({ animate: false });
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
      clearDestinationView();
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

function wireEntranceConfirmation() {
  if (dom.entranceConfirmYes) {
    dom.entranceConfirmYes.addEventListener('click', () => {
      if (state.voteInFlight) return;
      const prompt = state.confirmationPrompt;
      if (!prompt || !prompt.entrance) {
        hideEntranceConfirmation({ mark: true });
        return;
      }
      const { entrance } = prompt;
      if (dom.entranceConfirmYes) dom.entranceConfirmYes.disabled = true;
      if (dom.entranceConfirmNo) dom.entranceConfirmNo.disabled = true;
      hideEntranceConfirmation({ mark: true });
      if (Number.isFinite(entrance.lat) && Number.isFinite(entrance.lon)) {
        submitCommunityVote(entrance.lat, entrance.lon, {
          label: 'Entrance confirmation',
          statusMessage: 'Thanks for confirming! Saving your check-in...',
        });
      }
    });
  }
  if (dom.entranceConfirmNo) {
    dom.entranceConfirmNo.addEventListener('click', () => {
      hideEntranceConfirmation({ mark: true });
    });
  }
  if (dom.entranceConfirmSuggest) {
    dom.entranceConfirmSuggest.addEventListener('click', () => {
      hideEntranceConfirmation({ mark: true });
      startEntranceVoting();
    });
  }
}

function wireCommunityEntranceControls() {
  if (!dom.startEntranceVote) return;
  dom.startEntranceVote.addEventListener('click', () => {
    if (state.isVoting) {
      stopEntranceVoting({ clearMarker: true });
    } else {
      startEntranceVoting();
    }
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

async function requestAppInstall(cta) {
  if (!state.installPromptEvent) return;
  if (cta) {
    cta.disabled = true;
    cta.setAttribute('aria-busy', 'true');
  }
  try {
    await state.installPromptEvent.prompt();
    const choice = await state.installPromptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      setStatus('ClearPath added to your device.', 'success');
      hideInstallBanner({ persistDismiss: true });
      rememberInstallBannerDismissed();
    } else if (choice?.outcome === 'dismissed' && cta === dom.installBannerConfirm) {
      hideInstallBanner({ persistDismiss: true });
    }
  } catch (error) {
    console.warn('Install prompt failed', error);
  } finally {
    if (cta) {
      cta.removeAttribute('aria-busy');
      cta.disabled = false;
    }
    if (cta === dom.installButton || cta === dom.installBannerConfirm) {
      hideInstallBanner({ persistDismiss: true });
    }
    dom.installButton.hidden = true;
    state.installPromptEvent = null;
  }
}

function setupInstallPrompt() {
  if (!dom.installButton) return;

  if (isStandaloneDisplayMode()) {
    rememberInstallBannerDismissed();
  }

  window.addEventListener('beforeinstallprompt', (evt) => {
    evt.preventDefault();
    state.installPromptEvent = evt;
    dom.installButton.hidden = false;
    dom.installButton.disabled = false;
    if (shouldShowInstallBanner()) {
      showInstallBanner();
    }
  });

  dom.installButton.addEventListener('click', () => {
    if (!state.installPromptEvent) return;
    requestAppInstall(dom.installButton);
  });

  if (dom.installBannerConfirm) {
    dom.installBannerConfirm.addEventListener('click', () => {
      if (!state.installPromptEvent) {
        hideInstallBanner({ persistDismiss: true });
        return;
      }
      requestAppInstall(dom.installBannerConfirm);
    });
  }

  if (dom.installBannerDismiss) {
    dom.installBannerDismiss.addEventListener('click', () => {
      hideInstallBanner({ persistDismiss: true });
    });
  }
}

function init() {
  showSplash({ mode: 'bootstrap', progress: 0.12 });
  initMap();
  advanceSplashProgress(0.28);
  wireSearch();
  wireLocateButton();
  wireEntranceConfirmation();
  wireCommunityEntranceControls();
  initSheetInteractions();
  initRoutePlanner();
  resetSheetHeadings();
  advanceSplashProgress(0.55);
  if (isStandaloneDisplayMode()) {
    hideInstallBanner({ persistDismiss: true });
  }
  setupInstallPrompt();
  registerServiceWorker();
  primeGeolocation();
  advanceSplashProgress(0.82, 120);
  hideSplash({ delay: 360 });
}

document.addEventListener('DOMContentLoaded', init);

window.addEventListener('pagehide', () => {
  stopEntranceVoting({ clearMarker: false });
  if (state.geolocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geolocationWatchId);
    state.geolocationWatchId = null;
  }
  if (state.sheet?.observer) {
    state.sheet.observer.disconnect();
    state.sheet.observer = null;
  }
});
