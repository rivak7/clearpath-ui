interface SettingsProps {
  open: boolean;
  onClose: () => void;
  onClearCache: () => Promise<void>;
  onExportCorrections: () => void;
}

export default function Settings({ open, onClose, onClearCache, onExportCorrections }: SettingsProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-night/80 px-4" role="dialog" aria-modal="true">
      <div className="w-[min(520px,95%)] rounded-3xl bg-night px-6 py-7 text-textDark shadow-glass">
        <header className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
          >
            Close
          </button>
        </header>
        <div className="mt-6 space-y-4 text-sm">
          <button
            type="button"
            className="w-full rounded-2xl border border-white/15 px-4 py-3 text-left transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
            onClick={onClearCache}
          >
            Clear cache
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-white/15 px-4 py-3 text-left transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
            onClick={onExportCorrections}
          >
            Export my corrections
          </button>
          <div className="rounded-2xl border border-white/15 px-4 py-3">
            <h3 className="text-sm font-semibold">About</h3>
            <p className="mt-2 text-xs text-textDark/70">
              ClearPath points every visitor to the right public entrance, keeping sidewalks clear and arrivals
              confident.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 px-4 py-3">
            <h3 className="text-sm font-semibold">Privacy</h3>
            <p className="mt-2 text-xs text-textDark/70">
              We do not track you. Corrections are stored locally and synced only when you choose to share them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
