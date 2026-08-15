import { COORD_DECIMALS, roundCoordinate } from '../domain/geo.js';

const SENSITIVE_COORDINATE_PARAMS = new Set(['latitude', 'longitude', 'lat', 'lon', 'lng']);

/**
 * Rounds coordinates out of a URL before it reaches a log line.
 *
 * A precise latitude/longitude pair is personal data — it is where a user
 * physically is. Logs get shipped, indexed and retained far longer than any
 * request, so full-precision coordinates in a log aggregator are a GDPR problem
 * waiting to be found in an audit, and for a European retailer that is not a
 * hypothetical.
 *
 * Rounding to the cache grid keeps the logs useful for debugging (you can still
 * see which cache key a request hit) while dropping the precision that
 * identifies a person. Same rounding as the cache, so a log line and a cache key
 * can still be correlated.
 */
export function redactCoordinatesInUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const params = new URLSearchParams(url.slice(queryStart + 1));

  let changed = false;
  for (const [key, value] of [...params.entries()]) {
    if (!SENSITIVE_COORDINATE_PARAMS.has(key.toLowerCase())) continue;

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;

    params.set(key, roundCoordinate(numeric).toFixed(COORD_DECIMALS));
    changed = true;
  }

  return changed ? `${path}?${params.toString()}` : url;
}
