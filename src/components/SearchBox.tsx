import { useEffect, useRef, useState } from 'react';
import { PlaceSuggestion } from '../types';

interface SearchBoxProps {
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: PlaceSuggestion[];
  loading: boolean;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onClear: () => void;
  onFirstType: () => void;
}

export default function SearchBox({
  query,
  onQueryChange,
  suggestions,
  loading,
  onSelect,
  onClear,
  onFirstType
}: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [hasTyped, setHasTyped] = useState(false);

  useEffect(() => {
    const hasQuery = query.trim().length > 0;
    if (!hasQuery) {
      setPanelOpen(false);
      return;
    }
    if (loading || suggestions.length > 0) {
      setPanelOpen(true);
    } else {
      setPanelOpen(false);
    }
  }, [suggestions, loading, query]);

  const handleChange = (value: string) => {
    onQueryChange(value);
    if (!hasTyped && value.trim().length > 0) {
      setHasTyped(true);
      onFirstType();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isPanelOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestions.length === 0) {
        setPanelOpen(false);
        setHighlightedIndex(-1);
        return;
      }
      const choice = highlightedIndex >= 0 ? suggestions[highlightedIndex] : suggestions[0];
      if (!choice) return;
      onSelect(choice);
      setPanelOpen(false);
      setHighlightedIndex(-1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setPanelOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="relative" aria-expanded={isPanelOpen}>
      <div className="flex items-center rounded-full bg-white/10 px-4 py-2 shadow-sm focus-within:outline focus-within:outline-2 focus-within:outline-mint-500">
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="mr-3 text-mint-500"
        >
          <path
            d="M8.5 2a6.5 6.5 0 014.97 10.65l4.44 4.44-1.42 1.42-4.44-4.44A6.5 6.5 0 118.5 2zm0 2a4.5 4.5 0 100 9 4.5 4.5 0 000-9z"
            fill="currentColor"
          />
        </svg>
        <input
          ref={inputRef}
          className="h-12 w-full flex-1 bg-transparent text-base text-textDark placeholder:text-textDark/40 focus:outline-none"
          placeholder="Search entrances or places"
          value={query}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 || loading) {
              setPanelOpen(true);
            }
          }}
          aria-autocomplete="list"
          aria-controls="search-suggestions"
          aria-activedescendant={highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="ml-2 flex h-10 items-center justify-center rounded-full bg-white/10 px-3 text-textDark/70 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            Clear
          </button>
        )}
      </div>
      {isPanelOpen && (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute z-30 mt-3 w-full rounded-2xl bg-night/90 backdrop-blur px-2 py-2 shadow-lg"
        >
          {suggestions.map((suggestion, index) => {
            const isActive = index === highlightedIndex;
            const distance = suggestion.distanceMeters;
            const distanceLabel =
              typeof distance === 'number'
                ? distance >= 1000
                  ? `${(distance / 1000).toFixed(1)} km`
                  : `${Math.round(distance)} m`
                : undefined;
            return (
              <button
                key={suggestion.id}
                role="option"
                id={`suggestion-${index}`}
                aria-selected={isActive}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseLeave={() => setHighlightedIndex(-1)}
                onClick={() => {
                  onSelect(suggestion);
                  setPanelOpen(false);
                  setHighlightedIndex(-1);
                }}
                className={`flex h-14 w-full items-center justify-between rounded-2xl px-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500 focus-visible:ring-offset-2 ${
                  isActive ? 'bg-mint-500/15 text-mint-200' : 'text-textDark'
                }`}
              >
                <span>
                  <span className="block text-base font-semibold leading-tight">{suggestion.name}</span>
                  <span className="text-xs text-textDark/60">{suggestion.context}</span>
                </span>
                {distanceLabel && (
                  <span className="text-xs font-semibold text-textDark/60">{distanceLabel}</span>
                )}
              </button>
            );
          })}
          {loading && (
            <div className="px-4 py-3 text-sm text-textDark/60">Searching...</div>
          )}
          {!loading && suggestions.length === 0 && query.trim().length > 0 && (
            <div className="px-4 py-3 text-sm text-textDark/60">No matches yet. Try refining your search.</div>
          )}
        </div>
      )}
    </div>
  );
}

