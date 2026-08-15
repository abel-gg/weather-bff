import type { GeoLocation } from '../api/types';
import type { SelectedLocation } from '../hooks/useWeather';

/**
 * "Málaga" alone is ambiguous — the geocoder returns one in Spain and one in
 * Colombia for that exact query. Region and country are what make a result
 * pickable, so they belong in the label rather than in a tooltip.
 */
export function formatLocationLabel(location: GeoLocation): string {
  return [location.name, location.region, location.country].filter(Boolean).join(', ');
}

export function toSelectedLocation(location: GeoLocation): SelectedLocation {
  return {
    label: formatLocationLabel(location),
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

const STORAGE_KEY = 'weather-bff:last-location';

/**
 * Remembering the last place turns the empty state into a one-time cost instead
 * of a toll on every visit. Storage can throw (Safari private mode, disabled
 * cookies), and a preference that cannot be saved must never break the app.
 */
export function loadLastLocation(): SelectedLocation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SelectedLocation>;
    if (
      typeof parsed.label !== 'string' ||
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number'
    ) {
      return null;
    }

    return { label: parsed.label, latitude: parsed.latitude, longitude: parsed.longitude };
  } catch {
    return null;
  }
}

export function saveLastLocation(location: SelectedLocation): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Not being able to remember the last city is not worth a broken render.
  }
}
