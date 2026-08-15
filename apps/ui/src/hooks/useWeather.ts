import { useQuery } from '@tanstack/react-query';
import { fetchWeather, searchLocations } from '../api/client';
import { useDebouncedValue } from './useDebouncedValue';

export interface SelectedLocation {
  label: string;
  latitude: number;
  longitude: number;
}

/**
 * Caching happens at three levels and they are tuned independently:
 * this in-memory client cache, the HTTP cache the server drives through
 * Cache-Control, and the server's own cache. The client's window is shorter
 * than the server's TTL on purpose — coming back to the BFF is cheap (a memory
 * read) and it is what lets a user see a refresh, whereas going upstream is the
 * expensive call we are protecting.
 */
const CLIENT_STALE_TIME_MS = 5 * 60 * 1000;

export function useWeather(location: SelectedLocation | null) {
  return useQuery({
    queryKey: ['weather', location?.latitude ?? null, location?.longitude ?? null],
    queryFn: ({ signal }) => {
      if (!location) throw new Error('useWeather ran without a location');
      return fetchWeather(location, signal);
    },
    enabled: location !== null,
    staleTime: CLIENT_STALE_TIME_MS,
    gcTime: 30 * 60 * 1000,
    // Retry policy is not set here: it is a cross-cutting decision that lives
    // on the QueryClient in main.tsx. Overriding it per query would also make
    // it unmockable from a test's own client, which is a good sign it belongs
    // one level up.
  });
}

const SEARCH_DEBOUNCE_MS = 300;
/** Matches the server's `minLength: 2`, so we never fire a request it will reject. */
export const MIN_QUERY_LENGTH = 2;

export function useLocationSearch(query: string) {
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const result = useQuery({
    queryKey: ['locations', debouncedQuery],
    queryFn: ({ signal }) => searchLocations(debouncedQuery, signal),
    enabled,
    // Place names do not change. Keeping them for the session means going back
    // over a previous search costs nothing at all.
    staleTime: 60 * 60 * 1000,
  });

  return {
    ...result,
    debouncedQuery,
    /** True while the user has typed something the debounce has not caught up with. */
    isPending: enabled && (result.isLoading || debouncedQuery !== query.trim()),
  };
}
