import { useId, useState } from 'react';
import { describeError } from '../api/errors';
import type { GeoLocation } from '../api/types';
import { MIN_QUERY_LENGTH, useLocationSearch, type SelectedLocation } from '../hooks/useWeather';
import { formatLocationLabel, toSelectedLocation } from '../utils/location';

interface LocationSearchProps {
  onSelect: (location: SelectedLocation) => void;
}

export function LocationSearch({ onSelect }: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const listboxId = useId();
  const inputId = useId();

  const search = useLocationSearch(query);
  const results = search.data?.data ?? [];
  const trimmed = query.trim();

  const showResults = trimmed.length >= MIN_QUERY_LENGTH;
  const showNoMatches =
    showResults && !search.isPending && !search.isError && results.length === 0;

  function choose(location: GeoLocation) {
    onSelect(toSelectedLocation(location));
    setQuery('');
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('');
      setActiveIndex(-1);
      return;
    }
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex >= 0 ? activeIndex : 0];
      if (target) choose(target);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeolocationError('This browser cannot share your location.');
      return;
    }

    setGeolocationError(null);
    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        onSelect({
          label: 'Your location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        // Denying location access is a choice, not a fault. Say what happened
        // and leave the search box as the way forward.
        setIsLocating(false);
        setGeolocationError('We could not get your location. Search for a city instead.');
      },
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  return (
    <search className="search">
      <label className="visually-hidden" htmlFor={inputId}>
        Search for a city
      </label>

      <div className="search__row">
        <input
          id={inputId}
          className="search__input"
          type="search"
          role="combobox"
          autoComplete="off"
          aria-expanded={showResults}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 && results[activeIndex]
              ? `${listboxId}-option-${results[activeIndex]?.id}`
              : undefined
          }
          placeholder="Search for a city…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />

        <button type="button" className="button button--ghost" onClick={useMyLocation}>
          {isLocating ? 'Locating…' : 'Use my location'}
        </button>
      </div>

      {geolocationError && (
        <p className="search__message search__message--error" role="alert">
          {geolocationError}
        </p>
      )}

      {/*
        Every branch of the search is spoken for: too short to search, searching,
        found nothing, failed, found something. A dropdown that renders nothing
        while one of those is true is where users decide the app is broken.
      */}
      <div className="search__results">
        {showResults && search.isPending && (
          <p className="search__message" role="status">
            Searching…
          </p>
        )}

        {showResults && search.isError && (
          <p className="search__message search__message--error" role="alert">
            {describeError(search.error).title}.{' '}
            <button type="button" className="link" onClick={() => void search.refetch()}>
              Retry
            </button>
          </p>
        )}

        {showNoMatches && (
          <p className="search__message" role="status">
            No places match “{trimmed}”. Try a different spelling.
          </p>
        )}

        <ul className="search__list" id={listboxId} role="listbox" aria-label="Search results">
          {results.map((location, index) => (
            <li
              key={location.id}
              id={`${listboxId}-option-${location.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`search__option${index === activeIndex ? ' is-active' : ''}`}
            >
              <button type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(location)}>
                {formatLocationLabel(location)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </search>
  );
}
