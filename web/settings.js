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
import {
  initAccount,
  onAccountChange,
  isAuthenticated,
  logout,
  saveFavorite,
  removeFavorite,
  setHome,
  setWork,
  clearHome,
  clearWork,
  touchPreference,
  updateCommutePlan,
} from './account.js';

initTheme();
initAccessibility();
initAccount();

const themeForm = document.getElementById('themeForm');
const themeStatusChip = document.getElementById('themeStatusChip');
const accessibilityContainer = document.getElementById('accessibilityOptions');
const accessibilityStatusChip = document.getElementById('accessibilityStatusChip');
const accountStatusChip = document.getElementById('accountStatusChip');
const accountStatusDetail = document.getElementById('accountStatusDetail');
const accountPrimaryAction = document.getElementById('accountPrimaryAction');
const accountAltAction = document.getElementById('accountAltAction');
const homeAddressInput = document.getElementById('homeAddress');
const workAddressInput = document.getElementById('workAddress');
const savedPlacesForm = document.getElementById('savedPlacesForm');
const favoriteNameInput = document.getElementById('favoriteName');
const favoriteAddressInput = document.getElementById('favoriteAddress');
const homeIconInput = document.getElementById('homeIcon');
const workIconInput = document.getElementById('workIcon');
const favoriteIconInput = document.getElementById('favoriteIcon');
const addFavoriteButton = document.getElementById('addFavoriteButton');
const favoriteList = document.getElementById('favoriteList');
const savedPlacesStatus = document.getElementById('savedPlacesStatus');
const preferencesForm = document.getElementById('preferencesForm');
const defaultTravelModeSelect = document.getElementById('defaultTravelMode');
const mapStylePreferenceSelect = document.getElementById('mapStylePreference');
const avoidTollsToggle = document.getElementById('avoidTolls');
const avoidHighwaysToggle = document.getElementById('avoidHighways');
const avoidFerriesToggle = document.getElementById('avoidFerries');
const arrivalRemindersToggle = document.getElementById('arrivalReminders');
const commuteInsightsToggle = document.getElementById('commuteInsights');
const savedPlaceUpdatesToggle = document.getElementById('savedPlaceUpdates');
const preferencesStatus = document.getElementById('preferencesStatus');
const commuteForm = document.getElementById('commuteForm');
const morningTimeInput = document.getElementById('morningTime');
const morningDestinationSelect = document.getElementById('morningDestination');
const morningModeSelect = document.getElementById('morningMode');
const eveningTimeInput = document.getElementById('eveningTime');
const eveningDestinationSelect = document.getElementById('eveningDestination');
const eveningModeSelect = document.getElementById('eveningMode');
const commuteStatus = document.getElementById('commuteStatus');
const themeOverview = document.getElementById('settingsThemeSummary');
const accessibilityOverview = document.getElementById('settingsAccessibilitySummary');
const commuteOverview = document.getElementById('settingsCommuteSummary');
const placesOverview = document.getElementById('settingsPlacesSummary');

const accessibilityControls = new Map();
const featureMeta = new Map(ACCESSIBILITY_FEATURES.map((feature) => [feature.id, feature]));
let autoHeartbeat = null;
let accountSnapshot = { user: null, ready: false };

const PENDING_AUTH_KEY = 'clearpath-ui:pending-auth-mode';
let commuteDebounce = null;
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const COMMUTE_DEFAULT_SUMMARY = 'Commute reminders are off.';
const SAVED_PLACES_DEFAULT_SUMMARY = 'Add home and work to jump back faster.';

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

function formatClock(value) {
  if (!value || typeof value !== 'string') return '';
  const [hourString, minuteString = '0'] = value.split(':');
  const hour = Number.parseInt(hourString, 10);
  const minute = Number.parseInt(minuteString, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  const period = hour >= 12 ? 'PM' : 'AM';
  const normalizedHour = hour % 12 || 12;
  const paddedMinute = minute.toString().padStart(2, '0');
  return `${normalizedHour}:${paddedMinute} ${period}`;
}

function formatDaySummary(days) {
  if (!Array.isArray(days) || !days.length) return '';
  const normalized = Array.from(new Set(days.map((day) => (day || '').toLowerCase()))).filter((day) => DAY_ORDER.includes(day));
  if (!normalized.length) return '';
  if (normalized.length === DAY_ORDER.length) return 'Every day';
  const weekdays = DAY_ORDER.slice(0, 5);
  if (normalized.length === 5 && weekdays.every((day) => normalized.includes(day))) return 'Weekdays';
  if (normalized.length === 2 && normalized.includes('sat') && normalized.includes('sun')) return 'Weekends';
  return normalized.map((day) => DAY_LABELS[day] || titleCase(day)).join(' · ');
}

function describeCommuteLeg(leg, fallbackDestination) {
  if (!leg) return null;
  const destinationKey = (leg.destinationKey || leg.placeId || '').toLowerCase();
  const destinationLabel = leg.destinationLabel || fallbackDestination || '';
  const enabled = leg.enabled !== false && destinationKey !== 'off' && destinationLabel.toLowerCase() !== 'off';
  if (!enabled) return null;
  const destination = destinationKey === 'home'
    ? 'Home'
    : destinationKey === 'work'
      ? 'Work'
      : destinationLabel
        ? destinationLabel
        : 'Destination';
  const timeFragment = formatClock(leg.time) || 'Any time';
  const modeFragment = leg.travelMode ? titleCase(String(leg.travelMode)) : '';
  const descriptor = `${timeFragment} → ${destination}`;
  return modeFragment ? `${descriptor} (${modeFragment})` : descriptor;
}

function summarizeCommutePlan(plan) {
  if (!plan) return COMMUTE_DEFAULT_SUMMARY;
  const parts = [];
  const morningPart = describeCommuteLeg(plan.morning, 'Work');
  if (morningPart) parts.push(morningPart);
  const eveningPart = describeCommuteLeg(plan.evening, 'Home');
  if (eveningPart) parts.push(eveningPart);
  if (!parts.length) return COMMUTE_DEFAULT_SUMMARY;
  const daySummary = formatDaySummary(plan.days || []);
  return daySummary ? `${daySummary} · ${parts.join(' | ')}` : parts.join(' | ');
}

function summarizeSavedPlaces(savedPlaces) {
  if (!savedPlaces) return SAVED_PLACES_DEFAULT_SUMMARY;
  const { home, work, favorites } = savedPlaces;
  const pieces = [];
  pieces.push(home?.address ? 'Home saved' : 'Add home');
  pieces.push(work?.address ? 'Work saved' : 'Add work');
  const favoriteCount = Array.isArray(favorites) ? favorites.length : 0;
  if (favoriteCount) {
    pieces.push(`${favoriteCount} favorite${favoriteCount > 1 ? 's' : ''}`);
  }
  return pieces.join(' • ');
}

function updateThemeStatus({ mode, theme }) {
  const readableTheme = titleCase(theme);
  let chipText = '';
  let summaryText = '';
  if (mode === ThemeMode.AUTO) {
    const { next, upcomingTheme } = getNextAutoBoundary();
    const formattedTime = formatTime(next);
    const readableUpcoming = titleCase(upcomingTheme);
    chipText = `Auto · ${readableTheme} now → ${readableUpcoming} at ${formattedTime}.`;
    summaryText = `Auto • ${readableTheme} now, ${readableUpcoming} at ${formattedTime}`;
  } else {
    chipText = `Locked to ${readableTheme}.`;
    summaryText = `Locked to ${readableTheme}`;
  }
  if (themeStatusChip) themeStatusChip.textContent = chipText;
  if (themeOverview) setSummary(themeOverview, summaryText);
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
  const active = state?.features || [];
  let chipText = 'Pick the boosts you need.';
  let summaryText = 'No profiles active.';
  if (active.length) {
    const labels = active
      .map((id) => featureMeta.get(id))
      .filter(Boolean)
      .map((feature) => feature.shortLabel || feature.label);
    if (active.length === ACCESSIBILITY_FEATURES.length) {
      chipText = `All profiles on: ${labels.join(', ')}.`;
      summaryText = 'All assistive profiles active.';
    } else {
      const readableList = labels.join(', ');
      const suffix = active.length === 1 ? 'profile active' : 'profiles active';
      chipText = `${readableList} ${suffix}.`;
      summaryText = `Active: ${readableList}`;
    }
  }
  if (accessibilityStatusChip) accessibilityStatusChip.textContent = chipText;
  if (accessibilityOverview) setSummary(accessibilityOverview, summaryText);
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

function setSummary(element, message) {
  if (!element) return;
  element.textContent = message && message.trim() ? message : '—';
}

function showStatus(element, message, type = 'info') {
  if (!element) return;
  element.textContent = message || '';
  element.className = 'settings-status';
  if (!message) return;
  if (type === 'success') element.classList.add('settings-status--success');
  if (type === 'error') element.classList.add('settings-status--error');
}

function setSavedPlacesDisabled(disabled) {
  [homeIconInput, homeAddressInput, workIconInput, workAddressInput, favoriteIconInput, favoriteNameInput, favoriteAddressInput, addFavoriteButton]
    .filter(Boolean)
    .forEach((el) => {
      el.disabled = disabled;
    });
  if (savedPlacesForm) {
    savedPlacesForm.querySelectorAll('button').forEach((btn) => {
      if (btn === accountPrimaryAction || btn === accountAltAction) return;
      btn.disabled = disabled;
    });
  }
}

function setPreferencesDisabled(disabled) {
  [defaultTravelModeSelect, mapStylePreferenceSelect, avoidTollsToggle, avoidHighwaysToggle, avoidFerriesToggle, arrivalRemindersToggle, commuteInsightsToggle, savedPlaceUpdatesToggle]
    .filter(Boolean)
    .forEach((control) => {
      control.disabled = disabled;
    });
}

function setCommuteDisabled(disabled) {
  if (!commuteForm) return;
  commuteForm.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = disabled;
  });
}

function requestAuthFromMap(mode) {
  try {
    window.localStorage.setItem(PENDING_AUTH_KEY, mode);
  } catch {}
  window.location.href = '/';
}

function requestAccountViewOnMap() {
  try {
    window.localStorage.setItem('clearpath-ui:pending-account-open', '1');
  } catch {}
  window.location.href = '/';
}

function buildPlacePayload(result, labelOverride) {
  if (!result) return null;
  const center = result.entrance || result.roadPoint || result.center;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null;
  const label = labelOverride || result.query || 'Saved place';
  return {
    label,
    address: result.formatted || result.query || label,
    lat: Number(center.lat),
    lon: Number(center.lon),
    metadata: {
      query: result.query || label,
      signature: `${(result.query || label).toLowerCase()}:${Number(center.lat).toFixed(5)}:${Number(center.lon).toFixed(5)}`,
      snapshot: {
        query: result.query || label,
        center,
        bbox: result.bbox || null,
        entrance: result.entrance || null,
        roadPoint: result.roadPoint || null,
      },
    },
  };
}

async function lookupPlace(query) {
  const response = await fetch(`/entrance?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error('lookup_failed');
  }
  return response.json();
}

function renderFavoriteList(favorites) {
  if (!favoriteList) return;
  favoriteList.innerHTML = '';
  if (!favorites || !favorites.length) {
    const empty = document.createElement('li');
    empty.className = 'settings-favoriteList__empty';
    empty.textContent = 'No favorites yet. Add the spots you visit often.';
    favoriteList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  favorites.forEach((fav) => {
    const item = document.createElement('li');
    item.dataset.favoriteId = fav.id || fav.label;
    const meta = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = fav.label || 'Favorite';
    const address = document.createElement('small');
    address.textContent = fav.address || '';
    const icon = document.createElement('span');
    icon.className = 'settings-favoriteIcon';
    icon.textContent = fav.icon || '⭐';
    meta.appendChild(icon);
    meta.appendChild(title);
    meta.appendChild(address);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'remove-favorite';
    remove.textContent = 'Remove';
    item.appendChild(meta);
    item.appendChild(remove);
    fragment.appendChild(item);
  });
  favoriteList.appendChild(fragment);
}

function renderPreferences(preferences) {
  if (!preferences) return;
  if (defaultTravelModeSelect) defaultTravelModeSelect.value = preferences.defaultTravelMode || 'drive';
  if (mapStylePreferenceSelect) mapStylePreferenceSelect.value = preferences.mapStyle || 'auto';
  if (avoidTollsToggle) avoidTollsToggle.checked = Boolean(preferences.avoids?.tolls);
  if (avoidHighwaysToggle) avoidHighwaysToggle.checked = Boolean(preferences.avoids?.highways);
  if (avoidFerriesToggle) avoidFerriesToggle.checked = Boolean(preferences.avoids?.ferries);
  if (arrivalRemindersToggle) arrivalRemindersToggle.checked = Boolean(preferences.notifications?.arrivalReminders);
  if (commuteInsightsToggle) commuteInsightsToggle.checked = Boolean(preferences.notifications?.commuteInsights);
  if (savedPlaceUpdatesToggle) savedPlaceUpdatesToggle.checked = Boolean(preferences.notifications?.savedPlaceUpdates);
}

function renderCommutePlan(plan) {
  if (morningTimeInput) morningTimeInput.value = '';
  if (eveningTimeInput) eveningTimeInput.value = '';
  if (morningDestinationSelect) morningDestinationSelect.value = 'off';
  if (eveningDestinationSelect) eveningDestinationSelect.value = 'off';
  if (morningModeSelect) morningModeSelect.value = 'drive';
  if (eveningModeSelect) eveningModeSelect.value = 'drive';
  if (!commuteForm) return;

  const morning = plan?.morning || {};
  const evening = plan?.evening || {};
  const morningEnabled = morning.enabled !== false && (morning.destinationKey || morning.placeId || '').toLowerCase() !== 'off';
  const morningKey = (morning.destinationKey || morning.placeId || (morning.destinationLabel || '')).toLowerCase();
  if (morningDestinationSelect) {
    morningDestinationSelect.value = morningEnabled ? (morningKey === 'home' ? 'home' : 'work') : 'off';
  }
  if (morningTimeInput) {
    morningTimeInput.value = morningEnabled && morning.time ? morning.time : '';
  }
  if (morningModeSelect) {
    morningModeSelect.value = morning.travelMode || 'drive';
  }

  const eveningEnabled = evening.enabled !== false && (evening.destinationKey || evening.placeId || '').toLowerCase() !== 'off';
  const eveningKey = (evening.destinationKey || evening.placeId || (evening.destinationLabel || '')).toLowerCase();
  if (eveningDestinationSelect) {
    eveningDestinationSelect.value = eveningEnabled ? (eveningKey === 'work' ? 'work' : 'home') : 'off';
  }
  if (eveningTimeInput) {
    eveningTimeInput.value = eveningEnabled && evening.time ? evening.time : '';
  }
  if (eveningModeSelect) {
    eveningModeSelect.value = evening.travelMode || 'drive';
  }

  const checkboxes = commuteForm.querySelectorAll('input[name="commuteDays"]');
  const days = new Set(Array.isArray(plan?.days) ? plan.days : []);
  checkboxes.forEach((box) => {
    box.checked = days.has(box.value);
  });

  if (commuteOverview) {
    setSummary(commuteOverview, summarizeCommutePlan(plan));
  }
}

function renderAccountSettings(snapshot) {
  const user = snapshot?.user || null;
  accountSnapshot = { user, ready: true };
  const signedIn = Boolean(user);
  if (accountStatusChip) {
    accountStatusChip.textContent = signedIn ? 'Signed in' : 'Signed out';
  }
  if (accountStatusDetail) {
    accountStatusDetail.textContent = signedIn
      ? `Hi ${user?.name || user?.email || 'there'} — changes sync instantly across devices.`
      : 'Personalization is paused. Sign in to unlock saved places and preferences.';
  }
  if (accountPrimaryAction) {
    accountPrimaryAction.textContent = signedIn ? 'Open map view' : 'Sign in';
  }
  if (accountAltAction) {
    accountAltAction.textContent = signedIn ? 'Sign out' : 'Create account';
  }
  setSavedPlacesDisabled(!signedIn);
  setPreferencesDisabled(!signedIn);
  setCommuteDisabled(!signedIn);
  if (!signedIn) {
    if (homeAddressInput) homeAddressInput.value = '';
    if (workAddressInput) workAddressInput.value = '';
    if (homeIconInput) homeIconInput.value = '';
    if (workIconInput) workIconInput.value = '';
    if (favoriteIconInput) favoriteIconInput.value = '';
    renderFavoriteList([]);
    if (defaultTravelModeSelect) defaultTravelModeSelect.value = 'drive';
    if (mapStylePreferenceSelect) mapStylePreferenceSelect.value = 'auto';
    if (savedPlacesStatus) showStatus(savedPlacesStatus, 'Sign in to update saved places.');
    if (preferencesStatus) showStatus(preferencesStatus, 'Sign in to change travel preferences.');
    if (commuteStatus) showStatus(commuteStatus, 'Sign in to schedule your commute.');
    renderCommutePlan(null);
    if (commuteOverview) setSummary(commuteOverview, 'Sign in to schedule your commute.');
    if (placesOverview) setSummary(placesOverview, 'Sign in to sync your entrances.');
    return;
  }

  if (homeAddressInput) homeAddressInput.value = user.savedPlaces?.home?.address || '';
  if (workAddressInput) workAddressInput.value = user.savedPlaces?.work?.address || '';
  if (homeIconInput) homeIconInput.value = user.savedPlaces?.home?.icon || '';
  if (workIconInput) workIconInput.value = user.savedPlaces?.work?.icon || '';
  if (favoriteIconInput) favoriteIconInput.value = '';
  renderFavoriteList(user.savedPlaces?.favorites || []);
  renderPreferences(user.preferences || {});
  renderCommutePlan(user.commutePlan || {});
  if (savedPlacesStatus) showStatus(savedPlacesStatus, '');
  if (preferencesStatus) showStatus(preferencesStatus, '');
  if (commuteStatus) {
    const morningEnabled = user.commutePlan?.morning?.enabled !== false && (user.commutePlan?.morning?.destinationKey || '').toLowerCase() !== 'off';
    const eveningEnabled = user.commutePlan?.evening?.enabled !== false && (user.commutePlan?.evening?.destinationKey || '').toLowerCase() !== 'off';
    const message = morningEnabled || eveningEnabled
      ? 'Commute reminders will surface before your scheduled departures.'
      : 'Set a time and destination to unlock commute reminders.';
    showStatus(commuteStatus, message);
  }
  if (placesOverview) {
    setSummary(placesOverview, summarizeSavedPlaces(user.savedPlaces));
  }
}

async function handleSavedPlaceAction(action) {
  if (!isAuthenticated()) {
    showStatus(savedPlacesStatus, 'Sign in to update saved places.', 'error');
    return;
  }
  let input;
  let iconInput;
  if (action === 'save-home') input = homeAddressInput;
  if (action === 'save-work') input = workAddressInput;
  if (action === 'save-home') iconInput = homeIconInput;
  if (action === 'save-work') iconInput = workIconInput;
  if (!input) return;
  const query = input.value.trim();
  if (!query) {
    showStatus(savedPlacesStatus, 'Enter an address before saving.', 'error');
    input.focus();
    return;
  }
  showStatus(savedPlacesStatus, 'Finding the precise entrance…');
  setSavedPlacesDisabled(true);
  try {
    const result = await lookupPlace(query);
    const payload = buildPlacePayload(result, query);
    if (!payload) throw new Error('invalid_location');
    if (iconInput) {
      const fallbackIcon = action === 'save-home' ? '🏠' : '🏢';
      payload.icon = iconInput.value.trim() || fallbackIcon;
    }
    if (action === 'save-home') {
      await setHome(payload);
      showStatus(savedPlacesStatus, 'Home updated with this entrance.', 'success');
    } else {
      await setWork(payload);
      showStatus(savedPlacesStatus, 'Work updated with this entrance.', 'success');
    }
  } catch (error) {
    console.warn('Failed to save home/work', error);
    showStatus(savedPlacesStatus, 'Unable to save that address. Try a more specific search.', 'error');
  } finally {
    setSavedPlacesDisabled(false);
  }
}

async function handleSavedPlaceClear(action) {
  if (!isAuthenticated()) {
    showStatus(savedPlacesStatus, 'Sign in to update saved places.', 'error');
    return;
  }
  try {
    if (action === 'clear-home') {
      await clearHome();
      if (homeAddressInput) homeAddressInput.value = '';
      if (homeIconInput) homeIconInput.value = '';
      showStatus(savedPlacesStatus, 'Home cleared.', 'success');
    } else if (action === 'clear-work') {
      await clearWork();
      if (workAddressInput) workAddressInput.value = '';
      if (workIconInput) workIconInput.value = '';
      showStatus(savedPlacesStatus, 'Work cleared.', 'success');
    }
  } catch (error) {
    console.warn('Failed to clear saved place', error);
    showStatus(savedPlacesStatus, 'Unable to clear that saved place right now.', 'error');
  }
}

async function handleAddFavorite() {
  if (!isAuthenticated()) {
    showStatus(savedPlacesStatus, 'Sign in to add favorites.', 'error');
    return;
  }
  const label = favoriteNameInput?.value.trim();
  const query = favoriteAddressInput?.value.trim();
  const icon = favoriteIconInput?.value.trim() || '⭐';
  if (!label || !query) {
    showStatus(savedPlacesStatus, 'Provide both a label and address.', 'error');
    return;
  }
  showStatus(savedPlacesStatus, 'Saving favorite…');
  setSavedPlacesDisabled(true);
  try {
    const result = await lookupPlace(query);
    const payload = buildPlacePayload(result, label);
    if (!payload) throw new Error('invalid_location');
    payload.category = 'favorite';
    payload.icon = icon;
    await saveFavorite(payload);
    favoriteNameInput.value = '';
    favoriteAddressInput.value = '';
    if (favoriteIconInput) favoriteIconInput.value = '';
    showStatus(savedPlacesStatus, 'Favorite added.', 'success');
  } catch (error) {
    console.warn('Failed to add favorite', error);
    showStatus(savedPlacesStatus, 'Unable to add that favorite. Try refining the address.', 'error');
  } finally {
    setSavedPlacesDisabled(false);
  }
}

async function handleFavoriteRemove(button) {
  if (!isAuthenticated()) {
    showStatus(savedPlacesStatus, 'Sign in to manage favorites.', 'error');
    return;
  }
  const item = button.closest('li');
  if (!item) return;
  const favoriteId = item.dataset.favoriteId;
  if (!favoriteId) return;
  button.disabled = true;
  try {
    await removeFavorite(favoriteId);
    showStatus(savedPlacesStatus, 'Favorite removed.', 'success');
  } catch (error) {
    console.warn('Failed to remove favorite', error);
    showStatus(savedPlacesStatus, 'Unable to remove that favorite right now.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function handlePreferenceChange() {
  if (!isAuthenticated()) {
    showStatus(preferencesStatus, 'Sign in to adjust preferences.', 'error');
    return;
  }
  const payload = {
    defaultTravelMode: defaultTravelModeSelect?.value,
    mapStyle: mapStylePreferenceSelect?.value,
    avoids: {
      tolls: Boolean(avoidTollsToggle?.checked),
      highways: Boolean(avoidHighwaysToggle?.checked),
      ferries: Boolean(avoidFerriesToggle?.checked),
    },
    notifications: {
      arrivalReminders: Boolean(arrivalRemindersToggle?.checked),
      commuteInsights: Boolean(commuteInsightsToggle?.checked),
      savedPlaceUpdates: Boolean(savedPlaceUpdatesToggle?.checked),
    },
  };
  try {
    await touchPreference(payload);
    showStatus(preferencesStatus, 'Preferences saved.', 'success');
  } catch (error) {
    console.warn('Failed to update preferences', error);
    showStatus(preferencesStatus, 'Unable to update preferences right now.', 'error');
  }
}

function collectCommutePlan() {
  if (!commuteForm) return null;
  const selectedDays = Array.from(commuteForm.querySelectorAll('input[name="commuteDays"]:checked')).map((input) => input.value);
  const days = selectedDays.length ? selectedDays : ['mon', 'tue', 'wed', 'thu', 'fri'];

  const buildLeg = (timeInput, destinationSelect, modeSelect, fallbackKey) => {
    const key = destinationSelect ? destinationSelect.value : fallbackKey;
    const timeValue = timeInput?.value || '';
    const travelMode = modeSelect?.value || 'drive';
    if (!key || key === 'off' || !timeValue) {
      return {
        time: timeValue || '08:30',
        destinationLabel: 'Off',
        travelMode,
        placeId: null,
        destinationKey: 'off',
        enabled: false,
      };
    }
    const label = key === 'home' ? 'Home' : key === 'work' ? 'Work' : key;
    return {
      time: timeValue,
      destinationLabel: label,
      travelMode,
      placeId: key,
      destinationKey: key,
      enabled: true,
    };
  };

  return {
    days,
    morning: buildLeg(morningTimeInput, morningDestinationSelect, morningModeSelect, 'work'),
    evening: buildLeg(eveningTimeInput, eveningDestinationSelect, eveningModeSelect, 'home'),
  };
}

async function submitCommutePlan() {
  if (!isAuthenticated()) return;
  const plan = collectCommutePlan();
  if (!plan) return;
  try {
    await updateCommutePlan(plan);
    showStatus(commuteStatus, 'Commute schedule saved.', 'success');
  } catch (error) {
    console.warn('Failed to update commute plan', error);
    showStatus(commuteStatus, 'Unable to update commute schedule right now.', 'error');
  }
}

function handleCommuteChange() {
  if (!isAuthenticated()) {
    showStatus(commuteStatus, 'Sign in to schedule your commute.', 'error');
    return;
  }
  if (commuteStatus) showStatus(commuteStatus, 'Saving commute…');
  if (commuteDebounce) window.clearTimeout(commuteDebounce);
  commuteDebounce = window.setTimeout(() => {
    commuteDebounce = null;
    submitCommutePlan();
  }, 400);
}

function handleAccountPrimaryAction() {
  if (isAuthenticated()) {
    requestAccountViewOnMap();
  } else {
    requestAuthFromMap('login');
  }
}

function handleAccountAltAction() {
  if (isAuthenticated()) {
    logout().catch((error) => {
      console.warn('Sign out failed', error);
    });
  } else {
    requestAuthFromMap('signup');
  }
}

function handleSavedPlacesFormClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const action = target.dataset.action;
  if (!action) return;
  if (action.startsWith('save-')) {
    handleSavedPlaceAction(action);
  } else if (action.startsWith('clear-')) {
    handleSavedPlaceClear(action);
  }
}

function handleFavoriteListClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (target.dataset.action === 'remove-favorite') {
    handleFavoriteRemove(target);
  }
}

function wireAccountSettings() {
  if (accountPrimaryAction) accountPrimaryAction.addEventListener('click', handleAccountPrimaryAction);
  if (accountAltAction) accountAltAction.addEventListener('click', handleAccountAltAction);
  if (savedPlacesForm) savedPlacesForm.addEventListener('click', handleSavedPlacesFormClick);
  if (addFavoriteButton) addFavoriteButton.addEventListener('click', handleAddFavorite);
  if (favoriteList) favoriteList.addEventListener('click', handleFavoriteListClick);
  if (preferencesForm) {
    preferencesForm.addEventListener('change', handlePreferenceChange);
  }
  if (commuteForm) {
    commuteForm.addEventListener('change', handleCommuteChange);
  }
  if (placesOverview) {
    setSummary(placesOverview, SAVED_PLACES_DEFAULT_SUMMARY);
  }
  onAccountChange((snapshot) => {
    renderAccountSettings(snapshot);
  });
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

wireAccountSettings();
