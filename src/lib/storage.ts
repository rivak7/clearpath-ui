import { openDB, IDBPDatabase } from 'idb';
import { PlaceSuggestion, QueuedAction, UserPrefs } from '../types';

const PREFS_KEY = 'clearpath_prefs';
const RECENT_KEY = 'clearpath_recent';
const CORRECTIONS_KEY = 'clearpath_corrections_cache';

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB('clearpath-db', 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('queued')) {
          database.createObjectStore('queued', { keyPath: 'id', autoIncrement: false });
        }
        if (!database.objectStoreNames.contains('entrances')) {
          database.createObjectStore('entrances', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('tiles')) {
          database.createObjectStore('tiles', { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains('actions')) {
          database.createObjectStore('actions', { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
};

export function readPrefs(): UserPrefs {
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as UserPrefs;
    } catch (error) {
      console.error('Failed to parse preferences', error);
    }
  }
  return {
    requireAccessible: false,
    highContrast: false,
    largeButtons: false
  };
}

export function writePrefs(prefs: UserPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function getRecentSearches(): PlaceSuggestion[] {
  const raw = localStorage.getItem(RECENT_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PlaceSuggestion[];
  } catch (error) {
    console.error('Failed to parse recents', error);
    return [];
  }
}

export function saveRecentSearch(suggestion: PlaceSuggestion) {
  const recents = getRecentSearches().filter((item) => item.id !== suggestion.id);
  recents.unshift(suggestion);
  const trimmed = recents.slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
}

export async function cacheEntrance(result: any) {
  const db = await getDB();
  await db.put('entrances', result);
  const keys = await db.getAllKeys('entrances');
  if (keys.length > 5) {
    const excess = keys.slice(0, keys.length - 5);
    await Promise.all(excess.map((key) => db.delete('entrances', key)));
  }
}

export async function readEntrance(id: string) {
  const db = await getDB();
  return db.get('entrances', id);
}

export async function queueAction(action: QueuedAction) {
  const db = await getDB();
  await db.put('queued', { ...action, id: `${action.type}-${action.createdAt}` });
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
  const db = await getDB();
  const items = await db.getAll('queued');
  return items.sort((a, b) => (a.createdAt as number) - (b.createdAt as number));
}

export async function dequeueAction(id: string) {
  const db = await getDB();
  await db.delete('queued', id);
}

export async function clearCaches() {
  const db = await getDB();
  await Promise.all([
    db.clear('entrances'),
    db.clear('queued'),
    db.clear('tiles')
  ]);
  localStorage.removeItem(RECENT_KEY);
}

export function persistCorrection(payload: unknown) {
  const existing = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '[]');
  existing.push({ payload, savedAt: Date.now() });
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(existing));
}

export function getPersistedCorrections() {
  return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '[]');
}

export function clearPersistedCorrections() {
  localStorage.removeItem(CORRECTIONS_KEY);
}
