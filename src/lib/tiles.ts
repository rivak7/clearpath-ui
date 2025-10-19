export function createBaseStyle(highContrast: boolean) {
  const tint = highContrast ? '#0F1A2A' : '#0c273d';
  return {
    version: 8,
    name: 'ClearPath Raster',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      },
      tint: {
        type: 'raster',
        tiles: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR4AWOgGAUjFhAGhl4GMgXEMFGMGZgCEyXaEArFJiAjwQAANp0E1MyGmUBAAAAAElFTkSuQmCC'],
        tileSize: 16
      }
    },
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'osm-layer',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-opacity': highContrast ? 1 : 0.92,
          'raster-saturation': highContrast ? 0 : -0.1,
          'raster-brightness-min': highContrast ? 0.9 : 0.7,
          'raster-brightness-max': highContrast ? 1.1 : 1.05
        }
      },
      {
        id: 'tint-layer',
        type: 'raster',
        source: 'tint',
        paint: {
          'raster-opacity': highContrast ? 0.05 : 0.12,
          'raster-hue-rotate': highContrast ? 0 : -6,
          'raster-brightness-min': highContrast ? 0.95 : 0.88,
          'raster-brightness-max': 1.05
        }
      }
    ]
  };
}
