import {
  ForwardedRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  StyleSpecification,
  GeoJSONSource
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Feature } from 'geojson';
import type { EntranceResult } from '../types';
import { createBaseStyle } from '../lib/tiles';

interface MapViewProps {
  shouldInit: boolean;
  highContrast: boolean;
  onReady?: () => void;
  onAdjustDrag?: (position: { lat: number; lon: number; snapped: boolean }) => void;
  onAdjustEnd?: (position: { lat: number; lon: number; snapped: boolean }) => void;
}

export interface MapViewHandle {
  focusOn: (result: EntranceResult) => void;
  updateEntrance: (entrance: EntranceResult['entrance']) => void;
  setAdjustMode: (enabled: boolean, options?: { center: { lat: number; lon: number }; radius: number; paths?: EntranceResult['paths'] }) => void;
  setHighContrast: (highContrast: boolean) => void;
  setUserLocation: (location: { lat: number; lon: number; accuracy?: number } | null) => void;
  flashSaved: () => void;
}

const R = 6371e3;

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const sin = Math.sin;
  const hav = sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  return R * c;
}

function bearingBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return Math.atan2(y, x);
}

function destinationPoint(origin: { lat: number; lon: number }, bearing: number, distance: number) {
  const delta = distance / R;
  const phi1 = (origin.lat * Math.PI) / 180;
  const lambda1 = (origin.lon * Math.PI) / 180;
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(bearing);
  const phi2 = Math.asin(sinPhi2);
  const y = Math.sin(bearing) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: (phi2 * 180) / Math.PI,
    lon: ((lambda2 * 180) / Math.PI + 540) % 360 - 180
  };
}

function clampToRadius(
  origin: { lat: number; lon: number },
  candidate: { lat: number; lon: number },
  radiusMeters: number
) {
  const distance = distanceMeters(origin, candidate);
  if (distance <= radiusMeters) return candidate;
  const bearing = bearingBetween(origin, candidate);
  return destinationPoint(origin, bearing, radiusMeters);
}

function nearestPointOnLine(
  point: { lat: number; lon: number },
  line?: { coordinates: [number, number][] }
): { lat: number; lon: number; distance: number } | null {
  if (!line) return null;
  let best: { lat: number; lon: number; distance: number } | null = null;
  for (let i = 0; i < line.coordinates.length - 1; i += 1) {
    const [lon1, lat1] = line.coordinates[i];
    const [lon2, lat2] = line.coordinates[i + 1];
    const ax = lon1;
    const ay = lat1;
    const bx = lon2;
    const by = lat2;
    const tNumerator = (point.lon - ax) * (bx - ax) + (point.lat - ay) * (by - ay);
    const tDenominator = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = Math.max(0, Math.min(1, tNumerator / tDenominator));
    const projLon = ax + t * (bx - ax);
    const projLat = ay + t * (by - ay);
    const distance = distanceMeters(point, { lat: projLat, lon: projLon });
    if (!best || distance < best.distance) {
      best = { lat: projLat, lon: projLon, distance };
    }
  }
  return best;
}

const helperLine: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: []
};

const emptyFeatureCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: []
};

function createMarkerElement() {
  const container = document.createElement('div');
  container.className = 'relative flex flex-col items-center';

  const badge = document.createElement('div');
  badge.className =
    'confidence-badge mb-2 rounded-full px-3 py-1 text-xs font-semibold text-night shadow-lg transition-colors';
  badge.textContent = 'Medium confidence';
  container.appendChild(badge);

  const ring = document.createElement('div');
  ring.className = 'relative flex h-10 w-10 items-center justify-center';

  const glow = document.createElement('div');
  glow.className =
    'absolute h-10 w-10 rounded-full border-4 border-teal-500/60 opacity-0 transition-all duration-200 ease-out';
  glow.style.boxShadow = '0 0 0 0 rgba(38, 208, 164, 0.45)';
  ring.appendChild(glow);

  const dot = document.createElement('div');
  dot.className = 'entrance-dot h-4 w-4 rounded-full border-[6px] border-teal-500 bg-mint-500 shadow-lg';
  ring.appendChild(dot);

  container.appendChild(ring);

  return { container, badge, glow, dot };
}

const MapView = forwardRef(function MapView(
  { shouldInit, highContrast, onReady, onAdjustDrag, onAdjustEnd }: MapViewProps,
  ref: ForwardedRef<MapViewHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<any>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const dropoffRef = useRef<MapLibreMarker | null>(null);
  const helperSnapRef = useRef<{ lat: number; lon: number; distance: number } | null>(null);
  const markerElements = useRef<ReturnType<typeof createMarkerElement> | null>(null);
  const adjustState = useRef<{
    enabled: boolean;
    center: { lat: number; lon: number } | null;
    radius: number;
    paths?: EntranceResult['paths'];
  }>({ enabled: false, center: null, radius: 25 });
  const lastEntrance = useRef<EntranceResult['entrance'] | null>(null);
  const lastPlace = useRef<EntranceResult | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!shouldInit || mapRef.current || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      const maplibre = (await import('maplibre-gl')) as typeof import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;
      maplibreRef.current = maplibre;
      const map = new maplibre.Map({
        container,
        style: createBaseStyle(highContrast) as StyleSpecification,
        center: [-73.985664, 40.748514],
        zoom: 16,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: true
      });

      map.addControl(new maplibre.AttributionControl({
        compact: true,
        customAttribution: 'Map data © OpenStreetMap contributors'
      }), 'bottom-left');

      map.on('load', () => {
        ensureOverlays();
        setIsReady(true);
        onReady?.();
      });

      map.on('styledata', () => {
        ensureOverlays();
        if (lastPlace.current) {
          updateOverlays(lastPlace.current);
        }
        if (lastEntrance.current) {
          updateMarker(lastEntrance.current);
        }
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      dropoffRef.current = null;
    };
  }, [shouldInit, highContrast, onReady]);

  useEffect(() => {
    if (mapRef.current && isReady) {
      setStyle(highContrast);
    }
  }, [highContrast, isReady]);

  const setStyle = (contrast: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const style = createBaseStyle(contrast) as StyleSpecification;
    map.setStyle(style);
  };

  const ensureOverlays = () => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getSource('footprint')) {
      map.addSource('footprint', {
        type: 'geojson',
        data: emptyFeatureCollection
      });
      map.addLayer({
        id: 'footprint-fill',
        type: 'fill',
        source: 'footprint',
        paint: {
          'fill-color': '#1AA5A0',
          'fill-opacity': 0.2
        }
      });
      map.addLayer({
        id: 'footprint-outline',
        type: 'line',
        source: 'footprint',
        paint: {
          'line-color': '#1AA5A0',
          'line-width': 2
        }
      });
    }
    if (!map.getSource('paths')) {
      map.addSource('paths', {
        type: 'geojson',
        data: emptyFeatureCollection
      });
      map.addLayer({
        id: 'paths-line',
        type: 'line',
        source: 'paths',
        paint: {
          'line-color': '#26D0A4',
          'line-width': 2,
          'line-dasharray': [1.5, 1.5],
          'line-opacity': 0.65
        }
      });
    }
    if (!map.getSource('connection')) {
      map.addSource('connection', { type: 'geojson', data: emptyFeatureCollection });
      map.addLayer({
        id: 'connection-line',
        type: 'line',
        source: 'connection',
        paint: {
          'line-color': '#26D0A4',
          'line-width': 2,
          'line-dasharray': [0.5, 1.2]
        }
      });
    }
    if (!map.getSource('helper-line')) {
      map.addSource('helper-line', { type: 'geojson', data: helperLine });
      map.addLayer({
        id: 'helper-line-layer',
        type: 'line',
        source: 'helper-line',
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#E8A74B',
          'line-width': 2,
          'line-dasharray': [0.5, 1.2]
        }
      });
    }
    if (!map.getSource('user-location')) {
      map.addSource('user-location', { type: 'geojson', data: emptyFeatureCollection });
      map.addLayer({
        id: 'user-location-circle',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            6,
            20,
            12
          ],
          'circle-color': '#26D0A4',
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#1AA5A0'
        }
      });
      map.addLayer({
        id: 'user-location-accuracy',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': ['get', 'accuracyRadius'],
          'circle-color': '#26D0A4',
          'circle-opacity': 0.08
        }
      });
    }
  };

  const updateMarker = (entrance: EntranceResult['entrance']) => {
    const maplibre = maplibreRef.current;
    const map = mapRef.current;
    if (!map || !maplibre) return;
    if (!markerElements.current) {
      markerElements.current = createMarkerElement();
    }
    const { container, badge, glow, dot } = markerElements.current;
    badge.textContent =
      entrance.confidence === 'high'
        ? 'High confidence'
        : entrance.confidence === 'medium'
        ? 'Medium confidence'
        : 'Low confidence';
    if (entrance.confidence === 'high') {
      badge.style.background = '#26D0A4';
      badge.style.color = '#0F1A2A';
    } else if (entrance.confidence === 'medium') {
      badge.style.background = '#E8A74B';
      badge.style.color = '#0F1A2A';
    } else {
      badge.style.background = '#E85D5A';
      badge.style.color = '#0F1A2A';
    }
    dot.className = `entrance-dot h-4 w-4 rounded-full border-[6px] ${
      entrance.accessible ? 'border-teal-500 bg-mint-500 shadow-[0_0_12px_rgba(38,208,164,0.8)]' : 'border-teal-500 bg-mint-500'
    }`;

    if (!markerRef.current) {
      markerRef.current = new maplibre.Marker({
        element: container,
        anchor: 'bottom'
      }).setLngLat([entrance.lon, entrance.lat]).addTo(map);
    } else {
      markerRef.current.setLngLat([entrance.lon, entrance.lat]);
    }
    lastEntrance.current = entrance;

    const connection = map.getSource('connection') as GeoJSONSource | undefined;
    if (connection && dropoffRef.current) {
      connection.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [entrance.lon, entrance.lat],
                dropoffRef.current.getLngLat().toArray()
              ]
            },
            properties: {}
          }
        ]
      } as FeatureCollection<LineString>);
    }

    glow.style.opacity = '1';
    glow.style.transform = 'scale(1)';
    glow.style.boxShadow = '0 0 0 12px rgba(38, 208, 164, 0.25)';
    setTimeout(() => {
      if (glow) {
        glow.style.opacity = '0';
        glow.style.boxShadow = '0 0 0 0 rgba(38, 208, 164, 0.0)';
      }
    }, 450);
  };

  const updateOverlays = (result: EntranceResult) => {
    const map = mapRef.current;
    if (!map) return;
    lastPlace.current = result;
    const footprint = map.getSource('footprint') as GeoJSONSource | undefined;
    if (footprint) {
      if (result.footprint) {
        footprint.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: result.footprint,
              properties: {}
            }
          ]
        } as FeatureCollection);
      } else {
        footprint.setData(emptyFeatureCollection);
      }
    }
    const pathsSource = map.getSource('paths') as GeoJSONSource | undefined;
    if (pathsSource) {
      if (result.paths && result.paths.length > 0) {
        pathsSource.setData({
          type: 'FeatureCollection',
          features: result.paths.map((line) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: line.coordinates },
            properties: { id: line.id }
          }))
        } as FeatureCollection<LineString>);
      } else {
        pathsSource.setData(emptyFeatureCollection);
      }
    }
    if (result.dropoff) {
      const maplibre = maplibreRef.current;
      if (maplibre) {
        if (!dropoffRef.current) {
          const dropEl = document.createElement('div');
          dropEl.className = 'h-3 w-3 rounded-full border-4 border-amber-500 bg-transparent';
          dropoffRef.current = new maplibre.Marker({ element: dropEl, anchor: 'bottom' })
            .setLngLat([result.dropoff.lon, result.dropoff.lat])
            .addTo(map);
        } else {
          dropoffRef.current.setLngLat([result.dropoff.lon, result.dropoff.lat]);
        }
      }
    }
    map.fitBounds(result.bbox, { padding: 120, duration: 650, maxZoom: 18 });
    updateMarker(result.entrance);
  };

  const setUserLocation = (location: { lat: number; lon: number; accuracy?: number } | null) => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('user-location') as GeoJSONSource | undefined;
    if (!source) return;
    if (!location) {
      source.setData(emptyFeatureCollection);
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [location.lon, location.lat]
          },
          properties: {
            accuracyRadius: location.accuracy ? Math.max(location.accuracy / 2, 10) : 12
          }
        }
      ]
    } as FeatureCollection);
  };

  const flashSaved = () => {
    if (!markerElements.current) return;
    const { glow } = markerElements.current;
    glow.style.opacity = '1';
    glow.style.boxShadow = '0 0 0 14px rgba(38,208,164,0.6)';
    setTimeout(() => {
      glow.style.opacity = '0';
      glow.style.boxShadow = '0 0 0 0 rgba(38,208,164,0)';
    }, 300);
  };

  const setAdjustMode = (
    enabled: boolean,
    options?: { center: { lat: number; lon: number }; radius: number; paths?: EntranceResult['paths'] }
  ) => {
    const maplibre = maplibreRef.current;
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!maplibre || !map || !marker) return;
    adjustState.current = {
      enabled,
      center: options?.center ?? adjustState.current.center,
      radius: options?.radius ?? adjustState.current.radius,
      paths: options?.paths ?? adjustState.current.paths
    };

    marker.setDraggable(enabled);
    if (enabled) {
      map.getCanvas().style.cursor = 'grab';
      marker.on('drag', handleDrag);
      marker.on('dragend', handleDragEnd);
      if (map.getLayer('helper-line-layer')) {
        map.setLayoutProperty('helper-line-layer', 'visibility', 'visible');
      }
    } else {
      map.getCanvas().style.cursor = '';
      marker.off('drag', handleDrag);
      marker.off('dragend', handleDragEnd);
      helperSnapRef.current = null;
      const helperSource = map.getSource('helper-line') as GeoJSONSource | undefined;
      helperSource?.setData(helperLine);
      if (map.getLayer('helper-line-layer')) {
        map.setLayoutProperty('helper-line-layer', 'visibility', 'none');
      }
    }
  };

  const handleDrag = () => {
    const marker = markerRef.current;
    const map = mapRef.current;
    const state = adjustState.current;
    if (!marker || !map || !state.center) return;
    const lngLat = marker.getLngLat();
    let candidate = { lat: lngLat.lat, lon: lngLat.lng };
    const clamped = clampToRadius(state.center, candidate, state.radius);
    const exceeded = clamped.lat !== candidate.lat || clamped.lon !== candidate.lon;
    if (exceeded) {
      marker.setLngLat([clamped.lon, clamped.lat]);
      if (markerElements.current) {
        markerElements.current.dot.classList.add('animate-pulse');
        setTimeout(() => markerElements.current?.dot.classList.remove('animate-pulse'), 300);
      }
    }
    candidate = clamped;

    const helperSource = map.getSource('helper-line') as GeoJSONSource | undefined;
    let snapped = false;
    if (state.paths && state.paths.length > 0) {
      let best: { lat: number; lon: number; distance: number } | null = null;
      for (const line of state.paths) {
        const snap = nearestPointOnLine(candidate, line);
        if (!snap) continue;
        if (!best || snap.distance < best.distance) {
          best = snap;
        }
      }
      helperSnapRef.current = best;
      if (best) {
        helperSource?.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [candidate.lon, candidate.lat],
                  [best.lon, best.lat]
                ]
              },
              properties: {}
            }
          ]
        } as FeatureCollection<LineString>);
        if (best.distance < 1.5) {
          marker.setLngLat([best.lon, best.lat]);
          snapped = true;
          helperSource?.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [best.lon, best.lat],
                    [best.lon, best.lat]
                  ]
                },
                properties: {}
              }
            ]
          } as FeatureCollection<LineString>);
          if (markerElements.current) {
            markerElements.current.glow.classList.add('animate-breathe');
            setTimeout(() => markerElements.current?.glow.classList.remove('animate-breathe'), 800);
          }
        }
      } else {
        helperSource?.setData(helperLine);
      }
    }
    onAdjustDrag?.({ lat: candidate.lat, lon: candidate.lon, snapped });
  };

  const handleDragEnd = () => {
    const marker = markerRef.current;
    const state = adjustState.current;
    if (!marker || !state.center) return;
    const lngLat = marker.getLngLat();
    let final = { lat: lngLat.lat, lon: lngLat.lng };
    if (helperSnapRef.current && helperSnapRef.current.distance < 1.5) {
      final = { lat: helperSnapRef.current.lat, lon: helperSnapRef.current.lon };
      marker.setLngLat([final.lon, final.lat]);
      onAdjustEnd?.({ lat: final.lat, lon: final.lon, snapped: true });
    } else {
      onAdjustEnd?.({ lat: final.lat, lon: final.lon, snapped: false });
    }
  };

  useImperativeHandle(
    ref,
    (): MapViewHandle => ({
      focusOn: (result) => {
        if (!mapRef.current) return;
        ensureOverlays();
        updateOverlays(result);
      },
      updateEntrance: (entrance) => {
        updateMarker(entrance);
      },
      setAdjustMode,
      setHighContrast: setStyle,
      setUserLocation,
      flashSaved
    }),
    []
  );

  return <div ref={containerRef} className="map-gradient-overlay absolute inset-0" role="presentation" />;
});

export default MapView;
