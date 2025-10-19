import { useEffect, useState } from 'react';
import { EntranceResult, UserPrefs } from '../types';

interface ConfirmNudgeProps {
  place: EntranceResult | null;
  prefs: UserPrefs;
  adjustMode: boolean;
  accessibleDraft: boolean;
  canSave: boolean;
  offline: boolean;
  onConfirm: () => void;
  onStartAdjust: () => void;
  onCancelAdjust: () => void;
  onSave: () => void;
  onAccessibleToggle: (value: boolean) => void;
}

export default function ConfirmNudge({
  place,
  prefs,
  adjustMode,
  accessibleDraft,
  canSave,
  offline,
  onConfirm,
  onStartAdjust,
  onCancelAdjust,
  onSave,
  onAccessibleToggle
}: ConfirmNudgeProps) {
  const [didConfirm, setDidConfirm] = useState(false);

  useEffect(() => {
    setDidConfirm(false);
  }, [place?.id]);

  if (!place) return null;

  const buttonSize = prefs.largeButtons ? 'h-14 text-lg' : 'h-12 text-base';
  const bannerVisible = prefs.requireAccessible && !place.entrance.accessible;

  return (
    <div className="flex flex-col gap-4">
      {bannerVisible && !adjustMode && (
        <div className="rounded-2xl bg-amber-500/20 px-4 py-3 text-sm text-amber-500">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>No wheelchair entrance found, add one to help neighbors</span>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-night focus:outline-none focus-visible:ring-2 focus-visible:ring-night"
              onClick={() => {
                onAccessibleToggle(true);
                onStartAdjust();
              }}
            >
              Add accessible entrance
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className={`flex-1 rounded-full bg-mint-500 px-6 font-semibold text-night shadow-md transition hover:bg-mint-500/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${buttonSize}`}
          onClick={() => {
            onConfirm();
            setDidConfirm(true);
          }}
          disabled={didConfirm}
        >
          Confirm door
        </button>
        <button
          type="button"
          className={`flex-1 rounded-full border border-mint-500 px-6 font-semibold text-mint-500 transition hover:bg-mint-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${buttonSize}`}
          onClick={() => {
            if (adjustMode) {
              onCancelAdjust();
            } else {
              onAccessibleToggle(place.entrance.accessible);
              onStartAdjust();
            }
          }}
        >
          {adjustMode ? 'Cancel' : 'Adjust door'}
        </button>
      </div>

      {adjustMode && (
        <div className="rounded-2xl border border-white/10 px-4 py-4 text-sm text-textDark">
          <div className="flex items-center justify-between gap-3">
            <span>Draggable pin, stay within 25 meters.</span>
            <span className="text-xs text-textDark/60">{offline ? 'Queued offline' : 'Live update'}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={accessibleDraft}
                onChange={(event) => onAccessibleToggle(event.target.checked)}
                className="h-5 w-5 rounded border-mint-500 accent-mint-500"
              />
              Mark entrance as wheelchair accessible
            </label>
            <button
              type="button"
              className={`rounded-full bg-mint-500 px-5 font-semibold text-night shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${
                prefs.largeButtons ? 'h-12 text-base' : 'h-11 text-sm'
              } ${canSave ? '' : 'opacity-60'}`}
              onClick={onSave}
              disabled={!canSave}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
