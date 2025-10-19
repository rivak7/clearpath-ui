import { UserPrefs } from '../types';

interface HighContrastToggleProps {
  prefs: UserPrefs;
  onChange: (prefs: UserPrefs) => void;
}

const toggleClasses = 'flex items-center gap-2 text-sm px-3 py-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-mint-500 focus-visible:ring-offset-transparent';

export default function HighContrastToggle({ prefs, onChange }: HighContrastToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={prefs.highContrast}
      aria-label="Toggle high contrast mode"
      onClick={() => onChange({ ...prefs, highContrast: !prefs.highContrast })}
      className={`${toggleClasses} ${prefs.highContrast ? 'bg-teal-500/30 text-mint-500' : 'bg-white/10 text-textDark/80'}`}
    >
      <span className="inline-flex h-2.5 w-2.5 rounded-full border border-current" />
      High contrast
    </button>
  );
}
