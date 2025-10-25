const STORAGE_KEY = 'clearpath-ui:theme-preference';
const ThemeMode = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto',
});

const DAY_START_HOUR = 7;
const NIGHT_START_HOUR = 19;
const MIN_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes safeguard
const THEME_COLORS = {
  light: '#f1f5fb',
  dark: '#030d18',
};

const AUTO_BOUNDS = Object.freeze({
  dayStart: DAY_START_HOUR,
  nightStart: NIGHT_START_HOUR,
});

let currentMode = ThemeMode.AUTO;
let resolvedTheme = 'light';
let autoTimerId = null;

const root = document.documentElement;

function clampMode(mode) {
  if (!mode) return null;
  const normalized = String(mode).toLowerCase();
  return Object.values(ThemeMode).includes(normalized) ? normalized : null;
}

function getStoredMode() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return clampMode(stored) || ThemeMode.AUTO;
  } catch (error) {
    return ThemeMode.AUTO;
  }
}

function updateMetaThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const fallback = theme === 'dark' ? '#030d18' : '#f1f5fb';
  meta.setAttribute('content', THEME_COLORS[theme] || fallback);
}

function dispatchThemeChange(mode, theme) {
  window.dispatchEvent(
    new CustomEvent('clearpath-themechange', {
      detail: { mode, theme },
    }),
  );
}

function applyTheme(theme, mode, { persist = true } = {}) {
  resolvedTheme = theme;
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  updateMetaThemeColor(theme);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
      // localStorage is optional; ignore failures
    }
  }
  dispatchThemeChange(mode, theme);
}

function clearAutoTimer() {
  if (autoTimerId) {
    clearTimeout(autoTimerId);
    autoTimerId = null;
  }
}

function getMillisToNextBoundary(reference = new Date()) {
  const hours = reference.getHours();
  const boundary = new Date(reference);

  if (hours < DAY_START_HOUR) {
    boundary.setHours(DAY_START_HOUR, 0, 0, 0);
  } else if (hours < NIGHT_START_HOUR) {
    boundary.setHours(NIGHT_START_HOUR, 0, 0, 0);
  } else {
    boundary.setDate(boundary.getDate() + 1);
    boundary.setHours(DAY_START_HOUR, 0, 0, 0);
  }

  const delta = boundary.getTime() - reference.getTime();
  return Math.max(delta, MIN_REFRESH_INTERVAL);
}

function scheduleAutoRefresh() {
  clearAutoTimer();
  autoTimerId = window.setTimeout(() => {
    autoTimerId = null;
    if (currentMode === ThemeMode.AUTO) {
      setThemeMode(ThemeMode.AUTO, { persist: false });
    }
  }, getMillisToNextBoundary());
}

function computeAutoTheme(date = new Date()) {
  const hours = date.getHours();
  const isNight = hours >= NIGHT_START_HOUR || hours < DAY_START_HOUR;
  return isNight ? ThemeMode.DARK : ThemeMode.LIGHT;
}

function setThemeMode(mode, { persist = true } = {}) {
  const nextMode = clampMode(mode) || ThemeMode.AUTO;
  currentMode = nextMode;
  const theme = nextMode === ThemeMode.AUTO ? computeAutoTheme() : nextMode;
  applyTheme(theme, nextMode, { persist });
  if (nextMode === ThemeMode.AUTO) {
    scheduleAutoRefresh();
  } else {
    clearAutoTimer();
  }
  return { mode: currentMode, theme: resolvedTheme };
}

function getThemeState() {
  return { mode: currentMode, theme: resolvedTheme };
}

function onThemeChange(callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = (event) => callback(event.detail);
  window.addEventListener('clearpath-themechange', handler);
  return () => window.removeEventListener('clearpath-themechange', handler);
}

function initTheme() {
  const storedMode = getStoredMode();
  setThemeMode(storedMode, { persist: false });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      const incoming = clampMode(event.newValue) || ThemeMode.AUTO;
      if (incoming !== currentMode) {
        setThemeMode(incoming, { persist: false });
      }
    }
  });
}

export {
  ThemeMode,
  initTheme,
  setThemeMode,
  computeAutoTheme,
  getThemeState,
  onThemeChange,
  AUTO_BOUNDS,
};
