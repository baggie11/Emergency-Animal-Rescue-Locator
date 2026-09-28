import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { cx } from '../lib/format.js';
import { CrosshairIcon, SearchIcon, SpinnerIcon, CloseIcon } from './icons.jsx';

/**
 * Where are you? GPS first, manual search as an equal-status fallback.
 *
 * A user who denied location permission is not an edge case to be shamed with a
 * dialog — they are often indoors or on a restricted browser, and they still
 * need help. The manual path is a first-class input, not a "Settings" link.
 */
export default function LocationPicker({ error, locating, onLocate, onPickLocality }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const debounce = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchLocalities(query.trim());
        setResults(res.localities || []);
        setSearchError(null);
      } catch (err) {
        setSearchError(err.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query]);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onLocate}
        disabled={locating}
        className="btn-primary w-full"
      >
        {locating ? <SpinnerIcon size={22} /> : <CrosshairIcon size={22} />}
        {locating ? 'Finding your location…' : 'Use my current location'}
      </button>

      {error && (
        <p
          role="status"
          className="rounded-xl bg-ink-800 p-3 text-sm font-medium text-white"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-ink-200" />
        <span className="text-xs font-semibold text-ink-600 uppercase">or</span>
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <div>
        <label htmlFor="area-search" className="mb-1.5 block text-sm font-semibold text-ink-800">
          Search your city or area
        </label>
        <div className="relative">
          <SearchIcon
            size={20}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-600"
          />
          <input
            ref={inputRef}
            id="area-search"
            type="search"
            inputMode="search"
            autoComplete="address-level2"
            placeholder="e.g. Chennai, Anna Nagar, Madurai"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field pr-11 pl-11"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-600"
            >
              <CloseIcon size={20} />
            </button>
          )}
        </div>

        {searching && (
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-600">
            <SpinnerIcon size={16} /> Searching…
          </p>
        )}

        {searchError && <p className="mt-2 text-sm text-vet">{searchError}</p>}

        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-ink-200 overflow-hidden rounded-xl bg-white ring-1 ring-ink-200">
            {results.map((r) => (
              <li key={r.value}>
              <button
                type="button"
                onClick={() => onPickLocality(r)}
                className={cx(
                  'flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left',
                  'hover:bg-ink-100 active:bg-ink-200',
                )}
              >
                  <span className="font-semibold">{r.label}</span>
                  <span className="shrink-0 text-sm text-ink-600">
                    {r.count} contact{r.count === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.trim().length >= 2 && !searching && results.length === 0 && !searchError && (
          <p className="mt-2 text-sm text-ink-600">
            No area matching “{query}” in the directory yet. Try a nearby major city.
          </p>
        )}
      </div>
    </div>
  );
}
