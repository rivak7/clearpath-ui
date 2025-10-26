const STORAGE_KEY = 'clearpath-ui:accessibility-profiles';
const EVENT_NAME = 'clearpath-accessibilitychange';
const root = document.documentElement;

const AccessibilityFeature = Object.freeze({
  SENIOR: 'senior',
  COLORBLIND: 'colorblind',
  DYSLEXIA: 'dyslexia',
  FOCUS: 'focus',
  CALM: 'calm',
  LOW_VISION: 'lowvision',
});

const rawFeatures = [
  {
    id: AccessibilityFeature.SENIOR,
    label: 'Senior Comfort (65+)',
    shortLabel: 'Senior Comfort',
    classes: ['accessibility-senior'],
    summary: 'Relaxed type and steadier controls.',
    bullets: [
      'Upsizes text, spacing, and overlays.',
      'Widens tap targets and softens motion.',
    ],
  },
  {
    id: AccessibilityFeature.COLORBLIND,
    label: 'Color Vision Assist',
    shortLabel: 'Color Vision',
    classes: ['accessibility-colorblind'],
    summary: 'High-contrast palette for risky hues.',
    bullets: [
      'Swaps tricky reds/greens for blue-amber pairs.',
      'Adds patterns wherever color does the heavy lifting.',
    ],
  },
  {
    id: AccessibilityFeature.DYSLEXIA,
    label: 'Reading Ease (Dyslexia-friendly)',
    shortLabel: 'Reading Ease',
    classes: ['accessibility-dyslexia'],
    summary: 'Gentler font stack with calmer spacing.',
    bullets: [
      'Switches headings and labels to sentence case.',
      'Adds subtle spacing cues and dotted link markers.',
    ],
  },
  {
    id: AccessibilityFeature.FOCUS,
    label: 'Guided Focus & Wayfinding',
    shortLabel: 'Guided Focus',
    classes: ['accessibility-focus'],
    summary: 'Bold focus halos with dimmed background noise.',
    bullets: [
      'Highlights every interactive element.',
      'Dims surrounding chrome so the active card pops.',
    ],
  },
  {
    id: AccessibilityFeature.CALM,
    label: 'Calm Motion (Vestibular)',
    shortLabel: 'Calm Motion',
    classes: ['accessibility-calm'],
    summary: 'Keeps motion minimal for sensitive riders.',
    bullets: [
      'Disables non-essential animations and pulses.',
      'Snaps map recentering without the flyover glide.',
    ],
  },
  {
    id: AccessibilityFeature.LOW_VISION,
    label: 'Low Vision Beacon',
    shortLabel: 'Low Vision',
    classes: ['accessibility-lowvision'],
    summary: 'Ultra-bold contrast and outlines you can track fast.',
    bullets: [
      'Layers black-and-gold contrast across the UI.',
      'Thickens borders and marker halos for quick scanning.',
    ],
  },
];

const ACCESSIBILITY_FEATURES = Object.freeze(
  rawFeatures.map((feature) =>
    Object.freeze({
      ...feature,
      bullets: Object.freeze([...feature.bullets]),
      classes: Object.freeze([...feature.classes]),
    }),
  ),
);

const featureIndex = ACCESSIBILITY_FEATURES.reduce((acc, feature) => {
  acc[feature.id] = feature;
  return acc;
}, {});

let initialized = false;
let activeFeatures = new Set();

function parseStored(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter((id) => featureIndex[id]);
    }
  } catch (error) {
    // ignore malformed storage values
  }
  return [];
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseStored(raw);
  } catch (error) {
    return [];
  }
}

function writeStored(featureIds) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(featureIds));
  } catch (error) {
    // localStorage may fail; ignore
  }
}

function setDatasetToken() {
  if (!root) return;
  if (activeFeatures.size) {
    root.dataset.accessibility = Array.from(activeFeatures).join(' ');
  } else {
    delete root.dataset.accessibility;
  }
}

function applyFeatureClasses() {
  ACCESSIBILITY_FEATURES.forEach((feature) => {
    feature.classes.forEach((className) => {
      root.classList.toggle(className, activeFeatures.has(feature.id));
    });
  });
  setDatasetToken();
}

function dispatchChange() {
  const detail = { features: Array.from(activeFeatures) };
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

function getActiveFeatureList() {
  return Array.from(activeFeatures);
}

function syncFeatures(nextFeatures, { persist = true, silent = false } = {}) {
  activeFeatures = new Set(nextFeatures);
  applyFeatureClasses();
  if (persist) {
    writeStored(getActiveFeatureList());
  }
  if (!silent) {
    dispatchChange();
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function handleStorage(event) {
  if (event.key !== STORAGE_KEY) return;
  const incoming = new Set(parseStored(event.newValue));
  if (setsEqual(incoming, activeFeatures)) return;
  syncFeatures(incoming, { persist: false });
}

function initAccessibility() {
  if (initialized) {
    return getAccessibilityState();
  }
  initialized = true;
  activeFeatures = new Set(readStored());
  applyFeatureClasses();
  window.addEventListener('storage', handleStorage);
  return getAccessibilityState();
}

function getAccessibilityState() {
  return { features: getActiveFeatureList() };
}

function isFeatureEnabled(featureId) {
  return activeFeatures.has(featureId);
}

function setFeatureState(featureId, enabled) {
  if (!featureIndex[featureId]) return getAccessibilityState();
  const next = new Set(activeFeatures);
  if (enabled) {
    next.add(featureId);
  } else {
    next.delete(featureId);
  }
  if (setsEqual(next, activeFeatures)) return getAccessibilityState();
  syncFeatures(next);
  return getAccessibilityState();
}

function setFeatures(featureIds) {
  const filtered = (featureIds || []).map((id) => String(id)).filter((id) => featureIndex[id]);
  const next = new Set(filtered);
  if (setsEqual(next, activeFeatures)) return getAccessibilityState();
  syncFeatures(next);
  return getAccessibilityState();
}

function getFeature(featureId) {
  return featureIndex[featureId] || null;
}

function onAccessibilityChange(callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = (event) => callback(event.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

export {
  ACCESSIBILITY_FEATURES,
  AccessibilityFeature,
  getAccessibilityState,
  getFeature,
  initAccessibility,
  isFeatureEnabled,
  onAccessibilityChange,
  setFeatureState,
  setFeatures,
};
