import { ReactNode } from 'react';
import HighContrastToggle from './HighContrastToggle';
import { UserPrefs } from '../types';

interface HeaderProps {
  theme: 'light' | 'dark';
  prefs: UserPrefs;
  onPrefsChange: (prefs: UserPrefs) => void;
  onOpenSettings: () => void;
  children?: ReactNode;
}

export default function Header({ theme, prefs, onPrefsChange, onOpenSettings, children }: HeaderProps) {
  const shellTone = theme === 'dark' ? 'glass-dark text-textDark' : 'glass-light text-textLight';
  return (
    <header
      className={`${shellTone} pointer-events-auto mx-auto mt-6 w-[min(92%,680px)] rounded-3xl px-6 pb-6 pt-5 shadow-shell`}
      role="banner"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-textDark">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-teal-500 text-lg font-semibold text-white">
            CP
          </span>
          <div className="leading-tight">
            <div className="text-base font-semibold uppercase tracking-[0.2em] text-mint-500">ClearPath</div>
            <div className="text-sm text-textDark/80">Right door, right away.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs text-textDark/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2">
              Preferences
              <span aria-hidden="true" className="text-lg leading-none">⋯</span>
            </summary>
            <div className={`${shellTone} absolute right-0 top-12 z-20 w-56 rounded-2xl px-4 py-3 text-sm shadow-lg`}>
              <HighContrastToggle prefs={prefs} onChange={onPrefsChange} />
              <button
                type="button"
                className="mt-3 w-full rounded-full bg-white/5 px-4 py-2 text-left text-sm text-textDark/90 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2"
                onClick={onOpenSettings}
              >
                Settings & privacy
              </button>
            </div>
          </details>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </header>
  );
}
