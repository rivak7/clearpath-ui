import {
  AUTO_BOUNDS,
  ThemeMode,
  computeAutoTheme,
  getThemeState,
  initTheme,
  onThemeChange,
  setThemeMode,
} from './theme.js';

initTheme();

const form = document.getElementById('themeForm');
const statusChip = document.getElementById('themeStatusChip');
let autoHeartbeat = null;

function titleCase(value) {
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

function updateStatus({ mode, theme }) {
  if (!statusChip) return;
  const readableTheme = titleCase(theme);
  if (mode === ThemeMode.AUTO) {
    const { next, upcomingTheme } = getNextAutoBoundary();
    const formattedTime = formatTime(next);
    const readableUpcoming = titleCase(upcomingTheme);
    statusChip.textContent = `Auto is using the ${readableTheme} theme right now. It will switch to ${readableUpcoming} around ${formattedTime}.`;
  } else {
    statusChip.textContent = `You locked ClearPath to the ${readableTheme} theme.`;
  }
}

function syncSelection(mode) {
  if (!form) return;
  const controls = form.querySelectorAll('.theme-option__control');
  controls.forEach((control) => {
    control.checked = control.value === mode;
  });
}

function handleChange(event) {
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
      syncSelection(state.mode);
      updateStatus(state);
    }
  }, 15 * 60 * 1000);
}

function stopAutoHeartbeat() {
  if (!autoHeartbeat) return;
  window.clearInterval(autoHeartbeat);
  autoHeartbeat = null;
}

const initialState = getThemeState();
syncSelection(initialState.mode);
updateStatus(initialState);

if (form) {
  form.addEventListener('change', handleChange);
}

onThemeChange((state) => {
  syncSelection(state.mode);
  updateStatus(state);
  if (state.mode === ThemeMode.AUTO) {
    startAutoHeartbeat();
  } else {
    stopAutoHeartbeat();
  }
});

if (initialState.mode === ThemeMode.AUTO) {
  startAutoHeartbeat();
}
