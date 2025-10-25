import {
  AUTO_BOUNDS,
  ThemeMode,
  computeAutoTheme,
  getThemeState,
  initTheme,
  onThemeChange,
  setThemeMode,
} from './theme.js';
import {
  ACCESSIBILITY_FEATURES,
  AccessibilityFeature,
  getAccessibilityState,
  initAccessibility,
  onAccessibilityChange,
  setFeatureState,
} from './accessibility.js';

initTheme();
initAccessibility();

const themeForm = document.getElementById('themeForm');
const themeStatusChip = document.getElementById('themeStatusChip');
const accessibilityContainer = document.getElementById('accessibilityOptions');
const accessibilityStatusChip = document.getElementById('accessibilityStatusChip');

const accessibilityControls = new Map();
const featureMeta = new Map(ACCESSIBILITY_FEATURES.map((feature) => [feature.id, feature]));
let autoHeartbeat = null;

function titleCase(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getNextAutoBoundary(reference = new Date()) {
  const hours = reference.getHours();
  const next = new Date(reference);
  let upcomingTheme;

  if (hours < AUTO_BOUNDS.dayStart) {
    next.setHours(AUTO_BOUNDS.dayStart, 0, 0, 0);
    upcomingTheme = ThemeMode.LIGHT;
  } else if (hours < AUTO_BOUNDS.nightStart) {
    next.setHours(AUTO_BOUNDS.nightStart, 0, 0, 0);
    upcomingTheme = ThemeMode.DARK;
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(AUTO_BOUNDS.dayStart, 0, 0, 0);
    upcomingTheme = ThemeMode.LIGHT;
  }

  return { next, upcomingTheme };
}

function updateThemeStatus({ mode, theme }) {
  if (!themeStatusChip) return;
  const readableTheme = titleCase(theme);
  if (mode === ThemeMode.AUTO) {
    const { next, upcomingTheme } = getNextAutoBoundary();
    const formattedTime = formatTime(next);
    const readableUpcoming = titleCase(upcomingTheme);
    themeStatusChip.textContent = `Auto · ${readableTheme} now → ${readableUpcoming} at ${formattedTime}.`;
  } else {
    themeStatusChip.textContent = `Locked to ${readableTheme}.`;
  }
}

function syncThemeSelection(mode) {
  if (!themeForm) return;
  const controls = themeForm.querySelectorAll('.theme-option__control');
  controls.forEach((control) => {
    control.checked = control.value === mode;
  });
}

function handleThemeChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== 'theme-mode') return;
  setThemeMode(target.value);
}

function startAutoHeartbeat() {
  if (autoHeartbeat) return;
  autoHeartbeat = window.setInterval(() => {
    if (computeAutoTheme() !== getThemeState().theme) {
      const state = setThemeMode(ThemeMode.AUTO, { persist: false });
      syncThemeSelection(state.mode);
      updateThemeStatus(state);
    }
  }, 15 * 60 * 1000);
}

function stopAutoHeartbeat() {
  if (!autoHeartbeat) return;
  window.clearInterval(autoHeartbeat);
  autoHeartbeat = null;
}

function createAccessibilityCard(feature) {
  const label = document.createElement('label');
  label.className = 'accessibility-card';
  label.dataset.featureId = feature.id;

  const control = document.createElement('input');
  control.type = 'checkbox';
  control.name = 'accessibility-profile';
  control.value = feature.id;
  control.className = 'accessibility-card__control';
  label.appendChild(control);

  const body = document.createElement('div');
  body.className = 'accessibility-card__body';
  label.appendChild(body);

  const header = document.createElement('div');
  header.className = 'accessibility-card__header';
  body.appendChild(header);

  const icon = document.createElement('span');
  icon.className = 'accessibility-card__icon';
  icon.textContent = feature.icon;
  header.appendChild(icon);

  const titles = document.createElement('div');
  titles.className = 'accessibility-card__titles';
  header.appendChild(titles);

  const title = document.createElement('span');
  title.className = 'accessibility-card__title';
  title.textContent = feature.label;
  titles.appendChild(title);

  const subtitle = document.createElement('span');
  subtitle.className = 'accessibility-card__subtitle';
  subtitle.textContent = feature.summary;
  titles.appendChild(subtitle);

  const stateBadge = document.createElement('span');
  stateBadge.className = 'accessibility-card__state';
  stateBadge.textContent = 'Active';
  header.appendChild(stateBadge);

  const details = document.createElement('ul');
  details.className = 'accessibility-card__details';
  feature.bullets.forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    details.appendChild(item);
  });
  body.appendChild(details);

  accessibilityControls.set(feature.id, control);
  return label;
}

function renderAccessibilityOptions(state) {
  if (!accessibilityContainer) return;
  accessibilityContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  ACCESSIBILITY_FEATURES.forEach((feature) => {
    fragment.appendChild(createAccessibilityCard(feature));
  });
  accessibilityContainer.appendChild(fragment);
  if (!accessibilityContainer.dataset.bound) {
    accessibilityContainer.addEventListener('change', onAccessibilityToggle);
    accessibilityContainer.dataset.bound = 'true';
  }
  syncAccessibilitySelection(state);
}

function syncAccessibilitySelection(state) {
  const active = new Set(state?.features || []);
  accessibilityControls.forEach((control, featureId) => {
    control.checked = active.has(featureId);
  });
  applyThemeAccessibilityLocks(active);
}

function updateAccessibilityStatus(state) {
  if (!accessibilityStatusChip) return;
  const active = state?.features || [];
  if (!active.length) {
    accessibilityStatusChip.textContent = 'Pick the boosts you need.';
    return;
  }
  const labels = active
    .map((id) => featureMeta.get(id))
    .filter(Boolean)
    .map((feature) => feature.shortLabel || feature.label);
  if (active.length === ACCESSIBILITY_FEATURES.length) {
    accessibilityStatusChip.textContent = `All profiles on: ${labels.join(', ')}.`;
    return;
  }
  const readableList = labels.join(', ');
  accessibilityStatusChip.textContent = `${readableList} ${active.length === 1 ? 'profile' : 'profiles'} active.`;
}

function onAccessibilityToggle(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== 'accessibility-profile') return;
  const state = setFeatureState(target.value, target.checked);
  syncAccessibilitySelection(state);
  updateAccessibilityStatus(state);
}

function applyThemeAccessibilityLocks(activeSetOrState) {
  if (!themeForm) return;
  const active =
    activeSetOrState instanceof Set ? activeSetOrState : new Set(activeSetOrState?.features || []);
  const lowVisionActive = active.has(AccessibilityFeature.LOW_VISION);
  const lightControl = themeForm.querySelector('input[name="theme-mode"][value="light"]');
  if (!lightControl) return;
  const lightOption = lightControl.closest('.theme-option');
  lightControl.disabled = lowVisionActive;
  if (lightOption) {
    lightOption.classList.toggle('theme-option--disabled', lowVisionActive);
    if (lowVisionActive) {
      lightOption.setAttribute('aria-disabled', 'true');
    } else {
      lightOption.removeAttribute('aria-disabled');
    }
  }
  if (lowVisionActive && lightControl.checked) {
    setThemeMode(ThemeMode.DARK);
  }
}

const initialTheme = getThemeState();
syncThemeSelection(initialTheme.mode);
updateThemeStatus(initialTheme);

if (themeForm) {
  themeForm.addEventListener('change', handleThemeChange);
}

onThemeChange((state) => {
  syncThemeSelection(state.mode);
  updateThemeStatus(state);
  if (state.mode === ThemeMode.AUTO) {
    startAutoHeartbeat();
  } else {
    stopAutoHeartbeat();
  }
});

if (initialTheme.mode === ThemeMode.AUTO) {
  startAutoHeartbeat();
}

const initialAccessibility = getAccessibilityState();
renderAccessibilityOptions(initialAccessibility);
updateAccessibilityStatus(initialAccessibility);

onAccessibilityChange((state) => {
  syncAccessibilitySelection(state);
  updateAccessibilityStatus(state);
});
