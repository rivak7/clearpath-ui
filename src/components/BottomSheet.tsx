import { ReactNode, useMemo } from 'react';
import type { EntranceResult } from '../types';

interface BottomSheetProps {
  place: EntranceResult | null;
  status?: { tone: 'mint' | 'amber' | 'coral'; message: string } | null;
  children?: ReactNode;
  onLearnMore: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function distanceMeters(center: { lat: number; lon: number }, point: { lat: number; lon: number }) {
  const R = 6371e3;
  const phi1 = (center.lat * Math.PI) / 180;
  const phi2 = (point.lat * Math.PI) / 180;
  const dPhi = ((point.lat - center.lat) * Math.PI) / 180;
  const dLambda = ((point.lon - center.lon) * Math.PI) / 180;
  const sin = Math.sin;
  const hav = sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  return R * c;
}

export default function BottomSheet({ place, status, children, onLearnMore, collapsed, onToggleCollapse }: BottomSheetProps) {
  const distanceFromCenter = useMemo(() => {
    if (!place) return null;
    return Math.round(distanceMeters(place.center, place.entrance));
  }, [place]);

  if (!place) return null;

  const toneClass = status
    ? status.tone === 'mint'
      ? 'bg-mint-500/15 text-mint-400'
      : status.tone === 'amber'
      ? 'bg-amber-500/15 text-amber-500'
      : 'bg-coral-500/15 text-coral-500'
    : 'bg-white/5 text-textDark/60';

  return (
    <section
      aria-label="Arrival details"
      className={`pointer-events-auto mx-auto mb-6 mt-auto w-[min(96%,860px)] rounded-3xl bg-night/80 px-6 py-5 text-textDark shadow-glass backdrop-blur transition-all ${
        collapsed ? 'max-h-20 overflow-hidden py-3' : 'max-h-[72vh]'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`rounded-full px-4 py-2 text-sm ${toneClass}`}>{status?.message ?? 'Ready when you are'}</div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-full border border-white/20 px-3 py-1 text-xs text-textDark focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold text-textDark">Arrival details</h2>
            <p className="text-sm text-textDark/70">{place.name}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl bg-white/5 px-4 py-4 text-sm text-textDark">
              <header className="flex items-center justify-between text-xs uppercase tracking-wide text-textDark/60">
                Verified entrance
              </header>
              <div className="mt-2 space-y-1">
                <p>Lat {place.entrance.lat.toFixed(6)}</p>
                <p>Lon {place.entrance.lon.toFixed(6)}</p>
                <p>Method {place.method}</p>
                {distanceFromCenter !== null && <p>{distanceFromCenter} m from building centroid</p>}
                <p>{place.entrance.accessible ? 'Wheelchair accessible' : 'Accessibility unknown'}</p>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-textDark/60">
                <span>{place.verifiedCount} people confirmed</span>
                <span>
                  {place.lastVerifiedAt
                    ? new Date(place.lastVerifiedAt).toLocaleDateString()
                    : 'Awaiting first confirmation'}
                </span>
              </div>
            </article>
            <article className="rounded-2xl bg-white/5 px-4 py-4 text-sm text-textDark">
              <header className="flex items-center justify-between text-xs uppercase tracking-wide text-textDark/60">
                Drop-off suggestion
              </header>
              {place.dropoff ? (
                <div className="mt-2 space-y-1">
                  <p>Lat {place.dropoff.lat.toFixed(6)}</p>
                  <p>Lon {place.dropoff.lon.toFixed(6)}</p>
                  <p>Closest public roadway access</p>
                </div>
              ) : (
                <p className="mt-2 text-textDark/60">No drop-off suggestion available.</p>
              )}
              <details className="mt-3 text-xs text-textDark/70">
                <summary className="cursor-pointer text-textDark/80">How this pin was chosen</summary>
                <p className="mt-2">
                  We analyze building outlines and nearby sidewalks to project the entrance where arrivals meet the
                  public path. When data is sparse we lean on building edges with a lower confidence badge.
                </p>
                <button
                  type="button"
                  onClick={onLearnMore}
                  className="mt-2 inline-flex items-center text-mint-500 underline"
                >
                  Learn more
                </button>
              </details>
            </article>
          </div>
          {children}
        </div>
      )}
      <footer className="mt-5 text-center text-xs text-textDark/60">Map data © OpenStreetMap contributors</footer>
    </section>
  );
}
