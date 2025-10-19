import { useMemo, useState } from 'react';
import { EntranceResult, UserPrefs } from '../types';
import { openNavigation, shareDoor } from '../lib/nav';

interface EntranceActionsProps {
  place: EntranceResult | null;
  prefs: UserPrefs;
  onToast: (message: string, tone?: 'success' | 'warning' | 'error') => void;
}

export default function EntranceActions({ place, prefs, onToast }: EntranceActionsProps) {
  const [isSharing, setSharing] = useState(false);
  const deepLink = useMemo(() => {
    if (!place) return '';
    return `https://app.clearpath.local/#/place/${encodeURIComponent(place.id)}?elat=${place.entrance.lat}&elon=${place.entrance.lon}`;
  }, [place]);

  if (!place) return null;

  const buttonClasses = `flex-1 rounded-full bg-mint-500 px-6 font-semibold text-night shadow-md transition hover:bg-mint-500/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${
    prefs.largeButtons ? 'h-14 text-lg' : 'h-12 text-base'
  }`;

  const secondaryClasses = `flex-1 rounded-full bg-white/10 px-6 font-semibold text-textDark transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 ${
    prefs.largeButtons ? 'h-14 text-lg' : 'h-12 text-base'
  }`;

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        className={buttonClasses}
        onClick={() => {
          openNavigation(place.entrance.lat, place.entrance.lon);
          onToast('Opening directions…', 'success');
        }}
        aria-label="Navigate to entrance"
      >
        Navigate
      </button>
      <button
        type="button"
        className={secondaryClasses}
        onClick={async () => {
          if (!deepLink) return;
          try {
            setSharing(true);
            const shared = await shareDoor(deepLink);
            onToast(shared ? 'Shared with your app of choice' : 'Link copied to clipboard', 'success');
          } catch (error) {
            console.error(error);
            onToast('Could not share door link', 'error');
          } finally {
            setSharing(false);
          }
        }}
        aria-label="Share entrance link"
        disabled={isSharing}
      >
        {isSharing ? 'Sharing…' : 'Share door'}
      </button>
    </div>
  );
}
