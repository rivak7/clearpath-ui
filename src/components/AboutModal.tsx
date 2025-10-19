interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-night/85 px-4" role="dialog" aria-modal="true">
      <div className="w-[min(560px,95%)] rounded-3xl bg-night px-6 py-7 text-textDark shadow-glass">
        <header className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Why this entrance</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
          >
            Close
          </button>
        </header>
        <div className="mt-4 space-y-4 text-sm text-textDark/80">
          <p>
            ClearPath analyses building footprints sourced from OpenStreetMap and intersects them with the closest
            public sidewalks and curb edges. We prefer walkable segments tagged as footway, sidewalk, or crossing, then
            project the entrance point to the building boundary.
          </p>
          <p>
            When a verified entrance already exists in our community data, we elevate the confidence badge to mint. If
            our heuristics guess from geometry alone, we mark it amber until neighbors like you confirm it.
          </p>
          <p>
            Adjustments stay private on your device until you reconnect. Once synced, we log anonymous confirmations
            only to show how trustworthy each entrance is.
          </p>
        </div>
      </div>
    </div>
  );
}
