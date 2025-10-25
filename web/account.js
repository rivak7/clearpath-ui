const STORAGE_KEY = 'clearpath-ui:session';
const API_PREFIX = '/api';

let authToken = null;
let currentUser = null;
let refreshPromise = null;
const listeners = new Set();

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function notify() {
  const snapshot = { user: currentUser, token: authToken };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('account listener error', error);
    }
  });
}

function persistSession() {
  try {
    if (!authToken) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload = {
      token: authToken,
      user: currentUser,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist session', error);
  }
}

function setSession(token, user, { silent = false } = {}) {
  authToken = token || null;
  currentUser = user || null;
  persistSession();
  if (!silent) notify();
}

function clearSession({ silent = false } = {}) {
  authToken = null;
  currentUser = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
  if (!silent) notify();
}

async function request(path, { method = 'GET', body = undefined, auth = true, signal } = {}) {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth && authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal,
  });
  let payload = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.status === 401) {
    clearSession();
    const error = new Error('unauthorized');
    error.status = 401;
    error.payload = payload;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('request_failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function onAccountChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener({ user: currentUser, token: authToken });
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentUser() {
  return currentUser;
}

export function getAuthToken() {
  return authToken;
}

export function isAuthenticated() {
  return Boolean(authToken && currentUser);
}

export function initAccount() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = safeParse(raw);
    if (!data || typeof data !== 'object') return;
    if (data.token) {
      authToken = data.token;
      currentUser = data.user || null;
      notify();
      refreshProfile().catch((error) => {
        console.warn('Unable to refresh profile', error);
      });
    }
  } catch (error) {
    console.warn('Failed to restore session', error);
  }
}

export async function signup({ email, password, name, preferences, savedPlaces, commutePlan }) {
  const payload = await request('/users/signup', {
    method: 'POST',
    body: { email, password, name, preferences, savedPlaces, commutePlan },
    auth: false,
  });
  if (!payload || !payload.token) {
    throw new Error('invalid_signup_response');
  }
  setSession(payload.token, payload.user);
  return payload.user;
}

export async function login({ email, password }) {
  const payload = await request('/users/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  if (!payload || !payload.token) {
    throw new Error('invalid_login_response');
  }
  setSession(payload.token, payload.user);
  return payload.user;
}

export async function logout() {
  try {
    await request('/users/logout', { method: 'POST' });
  } catch (error) {
    // swallow network errors; session will be cleared locally
  }
  clearSession();
}

export async function refreshProfile() {
  if (!authToken) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = request('/users/me', { method: 'GET' })
    .then((payload) => {
      if (payload && payload.user) {
        setSession(authToken, payload.user, { silent: false });
        return payload.user;
      }
      return null;
    })
    .catch((error) => {
      if (error && error.status === 401) {
        return null;
      }
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function updateProfile(updates) {
  if (!authToken) throw new Error('not_authenticated');
  const payload = await request('/users/me', { method: 'PATCH', body: updates });
  if (payload && payload.user) {
    setSession(authToken, payload.user);
    return payload.user;
  }
  return currentUser;
}

export async function saveFavorite(place) {
  if (!authToken) throw new Error('not_authenticated');
  const payload = await request('/users/me/saved-places', { method: 'POST', body: { place } });
  if (payload && payload.user) {
    setSession(authToken, payload.user);
  }
  return payload;
}

export async function removeFavorite(placeId) {
  if (!authToken) throw new Error('not_authenticated');
  const payload = await request(`/users/me/saved-places/${encodeURIComponent(placeId)}`, { method: 'DELETE' });
  if (payload && payload.user) {
    setSession(authToken, payload.user);
  }
  return payload;
}

export async function recordRecent(entry) {
  if (!authToken) return null;
  try {
    const payload = await request('/users/me/recents', { method: 'POST', body: entry });
    if (payload && payload.user) {
      setSession(authToken, payload.user);
    }
    return payload;
  } catch (error) {
    if (error && error.status === 400) {
      return null;
    }
    throw error;
  }
}

export async function setHome(place) {
  if (!authToken) throw new Error('not_authenticated');
  const payload = await updateProfile({ savedPlaces: { home: place } });
  return payload;
}

export async function clearHome() {
  if (!authToken) throw new Error('not_authenticated');
  return updateProfile({ savedPlaces: { home: null } });
}

export async function setWork(place) {
  if (!authToken) throw new Error('not_authenticated');
  return updateProfile({ savedPlaces: { work: place } });
}

export async function clearWork() {
  if (!authToken) throw new Error('not_authenticated');
  return updateProfile({ savedPlaces: { work: null } });
}

export function getSavedPlaces() {
  if (!currentUser || !currentUser.savedPlaces) return createInitialSavedPlaces();
  return currentUser.savedPlaces;
}

function createInitialSavedPlaces() {
  return {
    home: null,
    work: null,
    favorites: [],
    pinned: [],
  };
}

export function getRecents() {
  return currentUser?.recents || [];
}

export function getPreferences() {
  return currentUser?.preferences || {};
}

export async function touchPreference(changes) {
  if (!authToken) throw new Error('not_authenticated');
  const merged = await updateProfile({ preferences: changes });
  return merged;
}
