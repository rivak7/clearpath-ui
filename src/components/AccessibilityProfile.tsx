import { useEffect, useState } from 'react';
import type { UserPrefs } from '../types';

interface AccessibilityProfileProps {
  open: boolean;
  prefs: UserPrefs;
  onClose: () => void;
  onChange: (prefs: UserPrefs) => void;
}

export default function AccessibilityProfile({ open, prefs, onClose, onChange }: AccessibilityProfileProps) {
  const [draft, setDraft] = useState<UserPrefs>(prefs);

  useEffect(() => {
    setDraft(prefs);
  }, [prefs, open]);

  if (!open) return null;

  const handleToggle = (key: keyof UserPrefs) => {
    const updated = { ...draft, [key]: !draft[key] };
    setDraft(updated);
    onChange(updated);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-night/80 px-4"
    >
      <div className="w-[min(520px,95%)] rounded-3xl bg-night px-6 py-7 text-textDark shadow-glass">
        <h2 className="text-2xl font-semibold">Personalize ClearPath</h2>
        <p className="mt-2 text-sm text-textDark/70">
          Choose the comfort settings that fit you. You can always tweak them later in preferences.
        </p>
        <div className="mt-6 space-y-4">
          <label className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3">
            <div>
              <span className="text-sm font-semibold">Require wheelchair accessible entrances</span>
              <p className="text-xs text-textDark/60">Only show entrances marked accessible, prompt for missing ones.</p>
            </div>
            <input
              type="checkbox"
              className="h-6 w-6 rounded border-mint-500 accent-mint-500"
              checked={draft.requireAccessible}
              onChange={() => handleToggle('requireAccessible')}
            />
          </label>
          <label className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3">
            <div>
              <span className="text-sm font-semibold">High contrast mode</span>
              <p className="text-xs text-textDark/60">Boost contrast ratios for stronger legibility.</p>
            </div>
            <input
              type="checkbox"
              className="h-6 w-6 rounded border-mint-500 accent-mint-500"
              checked={draft.highContrast}
              onChange={() => handleToggle('highContrast')}
            />
          </label>
          <label className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3">
            <div>
              <span className="text-sm font-semibold">Larger buttons</span>
              <p className="text-xs text-textDark/60">Increase tap targets to 60px for easier reach.</p>
            </div>
            <input
              type="checkbox"
              className="h-6 w-6 rounded border-mint-500 accent-mint-500"
              checked={draft.largeButtons}
              onChange={() => handleToggle('largeButtons')}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-full border border-white/20 px-5 py-2 text-sm text-textDark focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
            onClick={onClose}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="rounded-full bg-mint-500 px-5 py-2 text-sm font-semibold text-night focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}
