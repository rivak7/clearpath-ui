# ClearPath

ClearPath is a production-ready Progressive Web App that helps every visitor find the correct public entrance and curbside drop-off for any building. It combines a MapLibre map, accessible UI, offline support, and an Express API that respects OpenStreetMap data providers.

## Requirements

- Node.js 20+
- npm 9+

## Run it locally

```bash
bash run.sh
```

The script installs dependencies, builds the frontend, then starts the development servers:

- Vite dev server: http://localhost:5173
- API + static server: http://localhost:8080

The Express server serves the production build from `server/public` and proxies the API when you run `npm start`.

## Production build

```bash
npm run build
npm start
```

`npm run build` runs type-checks, compiles the service worker, and outputs the PWA to `server/public`. `npm start` serves that bundle on port 8080 with compression, Helmet, CORS, and rate limiting enabled.

## Installing the PWA

Load http://localhost:5173 (or the production server URL) in a compatible browser. The floating “Install” button appears when the browser fires `beforeinstallprompt`. Click it to add ClearPath to your device.

## Offline testing

1. Visit a place so the app caches tiles and entrance data.
2. In dev tools, toggle “Offline”.
3. Confirm and adjust doors—requests are queued and replayed automatically when the connection returns.

The service worker precaches the app shell, last five tiles, and last five entrance responses. Background sync queues POST requests to `/api/confirm` and `/api/correct` while offline.

## Exporting corrections

Open Preferences → Settings → “Export my corrections” to download every correction stored locally. A JSON file is generated without contacting any external service.

## Data sources and etiquette

- Geocoding: Nominatim with polite User-Agent and 1 request/sec throttle per IP.
- Sidewalk/Road snapping: Overpass API with tight bounding boxes and caching.
- Tiles: OpenStreetMap raster tiles via `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.

The server caches geocode and Overpass responses in memory, stores confirmations/corrections on disk, and mirrors anonymous sessions under `server/sessions/` for transparency.

## Testing notes

- `npm run lint` runs TypeScript type-checking.
- The build step (`npm run build`) validates the service worker and bundles the UI.

## License

[MIT](LICENSE)
