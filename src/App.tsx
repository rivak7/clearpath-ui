import { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import SearchBox from './components/SearchBox';
import MapView, { MapViewHandle } from './components/MapView';
import BottomSheet from './components/BottomSheet';
import EntranceActions from './components/EntranceActions';
import ConfirmNudge from './components/ConfirmNudge';
import Toast from './components/Toast';
import AccessibilityProfile from './components/AccessibilityProfile';
import Settings from './components/Settings';
import AboutModal from './components/AboutModal';
import {
  fetchSuggestions,
  fetchEntrance,
  confirmEntrance,
  correctEntrance,
  replayQueuedActions
} from './lib/api';
import {
  readPrefs,
  writePrefs,
  getRecentSearches,
  clearCaches,
  getPersistedCorrections,
  saveRecentSearch
} from './lib/storage';
import { vibrateArrive, vibrateNear, vibrateSave } from './lib/haptics';
import type { EntranceResult, PlaceSuggestion, ToastMessage, UserPrefs } from './types';

const DEBOUNCE_MS = 180;
const FIRST_RUN_KEY = 'clearpath_seen';
const VISIT_COUNT = 'clearpath_visit_count';

export default function App() {
  const [prefs, setPrefs] = useState<UserPrefs>(() => readPrefs());
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>(() => getRecentSearches());
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [place, setPlace] = useState<EntranceResult | null>(null);
  const [status, setStatus] = useState<{ tone: 'mint' | 'amber' | 'coral'; message: string } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [adjustMode, setAdjustMode] = useState(false);
  const [accessibleDraft, setAccessibleDraft] = useState(false);
  const [draftEntrance, setDraftEntrance] = useState<{ lat: number; lon: number } | null>(null);
  const [shouldInitMap, setShouldInitMap] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [firstRunOpen, setFirstRunOpen] = useState(() => !localStorage.getItem(FIRST_RUN_KEY));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number; accuracy?: number } | null>(null);
  const [geolocationGranted, setGeolocationGranted] = useState<boolean | null>(null);

  const mapRef = useRef<MapViewHandle | null>(null);
  const debounceRef = useRef<number>();
  const lastVibration = useRef<{ near15: boolean; near5: boolean }>({ near15: false, near5: false });

  useEffect(() => {
    writePrefs(prefs);
    document.body.dataset.theme = prefs.highContrast ? 'light' : 'dark';
    document.body.dataset.contrast = prefs.highContrast ? 'high' : 'standard';
  }, [prefs]);

  useEffect(() => {
    const count = Number(localStorage.getItem(VISIT_COUNT) || '0');
    localStorage.setItem(VISIT_COUNT, String(count + 1));
  }, []);

  useEffect(() => {
    const handler = (event: any) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const onlineHandler = () => {
      setOffline(false);
      setStatus({ tone: 'mint', message: 'Back online, syncing updates' });
      replayQueuedActions();
    };
    const offlineHandler = () => {
      setOffline(true);
      setStatus({ tone: 'coral', message: 'Offline mode: actions queued' });
    };
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus({ tone: 'coral', message: 'Location unavailable, you can still search manually' });
      return;
    }
    let watchId: number | null = null;
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGeolocationGranted(true);
        const { latitude, longitude, accuracy } = position.coords;
        const location = { lat: latitude, lon: longitude, accuracy };
        setUserLocation(location);
        if (mapRef.current) {
          mapRef.current.setUserLocation(location);
        }
      },
      (error) => {
        console.warn('Geo error', error);
        setGeolocationGranted(false);
        setStatus({ tone: 'coral', message: 'You can still search manually' });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 }
    );
    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  useEffect(() => {
    if (!place || !userLocation) return;
    const distance = computeDistance(place.entrance, userLocation);
    if (distance < 5 && !lastVibration.current.near5) {
      vibrateArrive();
      lastVibration.current.near5 = true;
      lastVibration.current.near15 = true;
    } else if (distance < 15 && !lastVibration.current.near15) {
      vibrateNear();
      lastVibration.current.near15 = true;
    } else if (distance >= 15) {
      lastVibration.current = { near15: false, near5: false };
    }
  }, [place, userLocation]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setSuggestions(getRecentSearches());
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    window.clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await fetchSuggestions(query, userLocation ?? undefined, { signal: controller.signal });
        setSuggestions(results.length > 0 ? results : getRecentSearches());
      } catch (error) {
        console.error(error);
        setStatus({ tone: 'coral', message: 'Suggestion service unreachable' });
      } finally {
        setLoadingSuggestions(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(debounceRef.current);
    };
  }, [query, userLocation]);

  const notify = (message: string, tone: 'success' | 'warning' | 'error' | undefined = 'success') => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, message, tone }]);
  };

  const handleSelectSuggestion = async (suggestion: PlaceSuggestion) => {
    try {
      setShouldInitMap(true);
      setLoadingSuggestions(true);
      setQuery(suggestion.name);
      const result = await fetchEntrance(suggestion.id, suggestion.name);
      if (!result) {
        setStatus({ tone: 'coral', message: 'No entrance data available yet' });
        notify('No entrance data available yet', 'warning');
        return;
      }
      saveRecentSearch(suggestion);
      setPlace(result);
      setSheetCollapsed(false);
      setAdjustMode(false);
      setAccessibleDraft(result.entrance.accessible);
      setDraftEntrance(null);
      if (mapRef.current) {
        mapRef.current.focusOn(result);
      }
      setStatus({ tone: 'mint', message: 'Entrance located, ready to navigate' });
    } catch (error) {
      console.error(error);
      setStatus({ tone: 'coral', message: 'Could not locate entrance' });
      notify('Could not load entrance data', 'error');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleConfirm = async () => {
    if (!place) return;
    try {
      const response = await confirmEntrance(place.id, place.entrance);
      setPlace({ ...place, verifiedCount: place.verifiedCount + 1, lastVerifiedAt: new Date().toISOString() });
      notify('Saved for everyone, thank you', 'success');
      if (response.queued) {
        setStatus({ tone: 'amber', message: 'Confirmation queued for sync' });
      }
    } catch (error) {
      console.error(error);
      notify('Could not confirm door', 'error');
    }
  };

  const handleStartAdjust = () => {
    if (!place || !mapRef.current) return;
    setAdjustMode(true);
    setDraftEntrance(place.entrance);
    mapRef.current.setAdjustMode(true, {
      center: place.center,
      radius: 25,
      paths: place.paths
    });
    setStatus({ tone: 'amber', message: 'Drag within the ring and snap to sidewalks' });
  };

  const handleCancelAdjust = () => {
    if (!mapRef.current || !place) return;
    setAdjustMode(false);
    setDraftEntrance(null);
    setAccessibleDraft(place.entrance.accessible);
    mapRef.current.setAdjustMode(false);
    setStatus({ tone: 'mint', message: 'Adjust cancelled' });
  };

  const handleSaveAdjust = async () => {
    if (!place || !draftEntrance) return;
    try {
      const payload = { ...draftEntrance, accessible: accessibleDraft };
      const response = await correctEntrance(place.id, payload);
      const updated: EntranceResult = {
        ...place,
        entrance: {
          lat: draftEntrance.lat,
          lon: draftEntrance.lon,
          confidence: 'high',
          accessible: accessibleDraft
        }
      };
      setPlace(updated);
      setAdjustMode(false);
      mapRef.current?.setAdjustMode(false);
      mapRef.current?.updateEntrance(updated.entrance);
      mapRef.current?.flashSaved();
      vibrateSave();
      notify('Saved for everyone, thank you', 'success');
      if (response.queued) {
        setStatus({ tone: 'amber', message: 'Correction queued for sync' });
      } else {
        setStatus({ tone: 'mint', message: 'Correction synced' });
      }
    } catch (error) {
      console.error(error);
      notify('Could not save correction', 'error');
      setStatus({ tone: 'coral', message: 'Correction failed, retry later' });
    }
  };

  const handleAdjustDrag = (position: { lat: number; lon: number; snapped: boolean }) => {
    setDraftEntrance({ lat: position.lat, lon: position.lon });
    if (position.snapped) {
      setStatus({ tone: 'mint', message: 'Snapped to sidewalk' });
    }
  };

  const handleAdjustEnd = (position: { lat: number; lon: number; snapped: boolean }) => {
    setDraftEntrance({ lat: position.lat, lon: position.lon });
    const tone: 'mint' | 'amber' = position.snapped ? 'mint' : 'amber';
    setStatus({ tone, message: position.snapped ? 'Snapped to sidewalk' : 'Placed near building edge' });
  };

  const handlePrefsChange = (next: UserPrefs) => {
    setPrefs(next);
  };

  const handleClearCache = async () => {
    await clearCaches();
    notify('Cache cleared', 'success');
  };

  const handleExportCorrections = () => {
    const corrections = getPersistedCorrections();
    const blob = new Blob([JSON.stringify(corrections, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'clearpath-corrections.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleInstalled = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      notify('ClearPath installed', 'success');
    }
    setInstallPrompt(null);
  };

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setStatus({ tone: 'coral', message: 'Location unavailable on this device' });
      return;
    }
    setShouldInitMap(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        setUserLocation(location);
        mapRef.current?.setUserLocation(location);
        notify('Centered on you', 'success');
      },
      (error) => {
        console.error(error);
        setStatus({ tone: 'coral', message: 'Location permission denied' });
      },
      { enableHighAccuracy: true }
    );
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const canSaveAdjust = Boolean(draftEntrance);

  const themeForHeader = prefs.highContrast ? 'light' : 'dark';

  const showSheet = Boolean(place);

  const handleFirstType = () => {
    if (!shouldInitMap) {
      setShouldInitMap(true);
    }
  };

  useEffect(() => {
    if (place && mapRef.current) {
      mapRef.current.focusOn(place);
      mapRef.current.updateEntrance(place.entrance);
    }
  }, [place]);

  const statusForSheet = useMemo<{ tone: 'mint' | 'amber' | 'coral'; message: string }>(() => {
    if (status) {
      return status;
    }
    if (offline) {
      return { tone: 'amber', message: 'Offline mode: actions queued' };
    }
    if (geolocationGranted === false) {
      return { tone: 'coral', message: 'You can still search manually' };
    }
    return { tone: 'mint', message: 'Ready when you are' };
  }, [status, offline, geolocationGranted]);

  const toggleHeaderCollapse = () => {
    setHeaderCollapsed((prev) => !prev);
  };

  useEffect(() => {
    if (!firstRunOpen) {
      localStorage.setItem(FIRST_RUN_KEY, '1');
    }
  }, [firstRunOpen]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-night">
      <MapView
        ref={mapRef}
        shouldInit={shouldInitMap}
        highContrast={prefs.highContrast}
        onReady={() => {
          if (userLocation) {
            mapRef.current?.setUserLocation(userLocation);
          }
        }}
        onAdjustDrag={handleAdjustDrag}
        onAdjustEnd={handleAdjustEnd}
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center">
        <div className="mt-2 flex w-full justify-end pr-6">
          <button
            type="button"
            onClick={toggleHeaderCollapse}
            className="pointer-events-auto rounded-full bg-white/10 px-3 py-1 text-xs text-textDark focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
          >
            {headerCollapsed ? 'Show search' : 'Hide search'}
          </button>
        </div>
        {!headerCollapsed && (
          <div className="pointer-events-auto w-full">
            <Header
              theme={themeForHeader as 'light' | 'dark'}
              prefs={prefs}
              onPrefsChange={handlePrefsChange}
              onOpenSettings={() => setSettingsOpen(true)}
            >
              <SearchBox
                query={query}
                onQueryChange={setQuery}
                suggestions={suggestions}
                loading={loadingSuggestions}
                onSelect={handleSelectSuggestion}
                onClear={() => setQuery('')}
                onFirstType={handleFirstType}
              />
            </Header>
          </div>
        )}

        <div className="pointer-events-auto mt-auto flex w-full justify-center">
          {showSheet && (
            <BottomSheet
              place={place}
              status={statusForSheet}
              collapsed={sheetCollapsed}
              onToggleCollapse={() => setSheetCollapsed((prev) => !prev)}
              onLearnMore={() => setAboutOpen(true)}
            >
              <EntranceActions place={place} prefs={prefs} onToast={notify} />
              <ConfirmNudge
                place={place}
                prefs={prefs}
                adjustMode={adjustMode}
                accessibleDraft={accessibleDraft}
                canSave={canSaveAdjust}
                offline={offline}
                onConfirm={handleConfirm}
                onStartAdjust={handleStartAdjust}
                onCancelAdjust={handleCancelAdjust}
                onSave={handleSaveAdjust}
                onAccessibleToggle={setAccessibleDraft}
              />
            </BottomSheet>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="pointer-events-none relative flex-1">
          <div className="pointer-events-auto absolute bottom-32 right-5 flex flex-col items-end gap-3">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-night/85 text-mint-500 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
              onClick={handleLocateMe}
              aria-label="Locate me"
            >
              ⊙
            </button>
            {installPrompt && (
              <button
                type="button"
                className="flex items-center gap-2 rounded-full bg-mint-500 px-4 py-3 text-sm font-semibold text-night shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-night"
                onClick={handleInstalled}
              >
                Install
              </button>
            )}
          </div>
        </div>
      </div>

      <Toast toasts={toasts} onDismiss={removeToast} />

      <AccessibilityProfile
        open={firstRunOpen}
        prefs={prefs}
        onClose={() => setFirstRunOpen(false)}
        onChange={handlePrefsChange}
      />

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onClearCache={handleClearCache}
        onExportCorrections={handleExportCorrections}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

function computeDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371e3;
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const sin = Math.sin;
  const hav = sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  return R * c;
}
