const STORAGE_KEY = 'clearpath-ui:accessibility-profiles';
const EVENT_NAME = 'clearpath-accessibilitychange';
const root = document.documentElement;

const AccessibilityFeature = Object.freeze({
  SENIOR: 'senior',
  COLORBLIND: 'colorblind',
  DYSLEXIA: 'dyslexia',
  FOCUS: 'focus',
  CALM: 'calm',
});

const rawFeatures = [
  {
    id: AccessibilityFeature.SENIOR,
    label: 'Senior Comfort (65+)',
    shortLabel: 'Senior Comfort',
    icon: '65+',
    classes: ['accessibility-senior'],
    summary: 'Enlarged typography, high-legibility controls, steadier map motions.',
    bullets: [
      'Boosts type scale, line spacing, and contrast across the interface.',
      'Expands tap targets, buttons, and zoom controls for tremor-friendly input.',
      'Adds calmer map movements and context hints for longer decision windows.',
    ],
  },
  {
    id: AccessibilityFeature.COLORBLIND,
    label: 'Color Vision Assist',
    shortLabel: 'Color Vision',
    icon: 'CV',
    classes: ['accessibility-colorblind'],
    summary: 'Duo-tone palette with patterns and redundant cues that avoid color-only messaging.',
    bullets: [
      'Replaces greens/reds with a blue–amber palette tuned for the main CVD spectrums.',
      'Adds patterns and border styles to entrances, drop-offs, and guidance chips.',
      'Underlines semantic meaning with icons and labels anywhere color previously worked alone.',
    ],
  },
  {
    id: AccessibilityFeature.DYSLEXIA,
    label: 'Reading Ease (Dyslexia-friendly)',
    shortLabel: 'Reading Ease',
    icon: 'AE',
    classes: ['accessibility-dyslexia'],
    summary: 'Alternate font stack, generous letter-spacing, and sentence-case labels.',
    bullets: [
      'Swaps to a dyslexia-friendly font stack with softer, distinct letterforms.',
      'Reduces all-caps labels, increases spacing, and stabilises line length.',
      'Adds dotted underlines to actionable text to separate it from body copy.',
    ],
  },
  {
    id: AccessibilityFeature.FOCUS,
    label: 'Guided Focus & Wayfinding',
    shortLabel: 'Guided Focus',
    icon: '◇',
    classes: ['accessibility-focus'],
    summary: 'Persistent focus halos, spotlighted active regions, and calmer background noise.',
    bullets: [
      'Projector-yellow focus halos appear on every interactive element, keyboard or touch.',
      'Scroll snapping and focus waypoints keep the sheet content aligned at eye level.',
      'Adds subtle masking behind popovers to reduce peripheral distractions.',
    ],
  },
  {
    id: AccessibilityFeature.CALM,
    label: 'Calm Motion (Vestibular)',
    shortLabel: 'Calm Motion',
    icon: '≋',
    classes: ['accessibility-calm'],
    summary: 'Disables motion bursts, flattens parallax, and eases map transitions.',
    bullets: [
      'Suppresses non-essential animations, pulses, and parallax flourishes.',
      'Switches live map recentering to snap mode with zero glide duration.',
      'Prefers static feedback, replacing bounce states with gentle contrast shifts.',
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
