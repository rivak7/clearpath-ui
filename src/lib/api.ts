import { PlaceSuggestion, EntranceResult, QueuedAction } from '../types';
import {
  cacheEntrance,
  readEntrance,
  queueAction,
  getQueuedActions,
  dequeueAction,
  saveRecentSearch,
  persistCorrection
} from './storage';

const SUGGEST_INTERVAL = 1100;
let lastSuggestTime = 0;
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

async function safeFetch(input: RequestInfo, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSuggestions(
  query: string,
  location?: { lat: number; lon: number },
  opts?: { signal?: AbortSignal }
): Promise<PlaceSuggestion[]> {
  const now = Date.now();
  const wait = Math.max(0, SUGGEST_INTERVAL - (now - lastSuggestTime));
  if (wait > 0) {
    await new Promise<void>((resolve) => {
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => resolve(), wait);
    });
  }
  lastSuggestTime = Date.now();

  const params = new URLSearchParams({ q: query.trim() });
  if (location) {
    params.set('lat', String(location.lat));
    params.set('lon', String(location.lon));
  }

  const response = await safeFetch(`/api/geocode/suggest?${params.toString()}`, {
    method: 'GET',
    signal: opts?.signal
  });
  const suggestions = (await response.json()) as PlaceSuggestion[];
  return suggestions;
}

export async function fetchEntrance(placeId: string, query?: string): Promise<EntranceResult | null> {
  try {
    const params = new URLSearchParams();
    params.set('q', query ?? placeId);
    const response = await safeFetch(`/api/entrance?${params.toString()}`);
    const result = (await response.json()) as EntranceResult;
    await cacheEntrance(result);
    saveRecentSearch({
      id: result.id,
      name: result.name,
      context: '',
      lat: result.entrance.lat,
      lon: result.entrance.lon
    });
    return result;
  } catch (error) {
    const cached = await readEntrance(placeId);
    if (cached) {
      return cached as EntranceResult;
    }
    throw error;
  }
}

async function postJson(path: string, body: unknown) {
  const response = await safeFetch(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return response.json();
}

export async function confirmEntrance(placeId: string, entrance: { lat: number; lon: number }) {
  const payload = { placeId, entrance };
  if (!navigator.onLine) {
    await queueAction({ type: 'confirm', payload, createdAt: Date.now() });
    return { queued: true };
  }
  try {
    const data = await postJson('/api/confirm', payload);
    return { queued: false, data };
  } catch (error) {
    await queueAction({ type: 'confirm', payload, createdAt: Date.now() });
    return { queued: true, error };
  }
}

export async function correctEntrance(
  placeId: string,
  entrance: { lat: number; lon: number; accessible: boolean }
) {
  const payload = { placeId, entrance };
  persistCorrection(payload);
  if (!navigator.onLine) {
    await queueAction({ type: 'correct', payload, createdAt: Date.now() });
    return { queued: true };
  }
  try {
    const data = await postJson('/api/correct', payload);
    return { queued: false, data };
  } catch (error) {
    await queueAction({ type: 'correct', payload, createdAt: Date.now() });
    return { queued: true, error };
  }
}

export async function replayQueuedActions() {
  if (!navigator.onLine) return;
  const queued = await getQueuedActions();
  for (const action of queued) {
    try {
      if (action.type === 'confirm') {
        await postJson('/api/confirm', action.payload);
      }
      if (action.type === 'correct') {
        await postJson('/api/correct', action.payload);
      }
      await dequeueAction(`${action.type}-${action.createdAt}`);
    } catch (error) {
      console.warn('Replay failed, will retry later', error);
      break;
    }
  }
}

export async function fetchHealth() {
  const response = await safeFetch('/api/health', { method: 'GET' });
  return response.json();
}

export async function pingServer() {
  const response = await safeFetch('/api/ping', { method: 'GET' });
  return response.json();
}
