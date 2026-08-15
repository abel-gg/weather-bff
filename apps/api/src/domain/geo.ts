import { ValidationError } from '../errors.js';

/**
 * Decimal places kept in a cache key.
 *
 * 2 decimals is ~1.1 km at the equator. That sounds aggressive until you look
 * at what the provider actually does: asking Open-Meteo for 36.72,-4.42 returns
 * a payload stamped 36.75,-4.4375 — it snaps every request onto its own model
 * grid of roughly 0.06 degrees (~6 km). We are rounding an order of magnitude
 * finer than the upstream already does, so this loses no information at all.
 *
 * What it buys is enormous: every user in the same neighbourhood collapses onto
 * one cache entry, and therefore one upstream request. Without this, raw GPS
 * coordinates from mobile clients would give a near-unique key per user and the
 * cache hit ratio would approach zero exactly when traffic is highest.
 */
export const COORD_DECIMALS = 2;

const LATITUDE_RANGE = { min: -90, max: 90 } as const;
const LONGITUDE_RANGE = { min: -180, max: 180 } as const;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Rounds to the cache grid, normalising -0 to 0 so keys never diverge on sign. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Parses coordinates coming off the wire. Query strings are always strings, and
 * `Number('')` is 0 — which would silently place the user off the coast of
 * Africa — so empty and non-finite input is rejected explicitly.
 */
export function parseCoordinates(latitude: unknown, longitude: unknown): Coordinates {
  return {
    latitude: parseCoordinate(latitude, 'latitude', LATITUDE_RANGE),
    longitude: parseCoordinate(longitude, 'longitude', LONGITUDE_RANGE),
  };
}

function parseCoordinate(
  raw: unknown,
  field: string,
  range: { min: number; max: number },
): number {
  if (raw === undefined || raw === null || raw === '') {
    throw new ValidationError(`Missing required query parameter "${field}".`);
  }

  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());

  if (!Number.isFinite(value)) {
    throw new ValidationError(`Query parameter "${field}" must be a number.`);
  }

  if (value < range.min || value > range.max) {
    throw new ValidationError(
      `Query parameter "${field}" must be between ${range.min} and ${range.max}.`,
    );
  }

  return value;
}

/**
 * Builds the cache key from rounded coordinates.
 *
 * The key is built from the fixed-decimal *string* rather than the number so
 * that 36.7 and 36.70 cannot produce two entries for one place.
 */
export function weatherCacheKey({ latitude, longitude }: Coordinates): string {
  const lat = roundCoordinate(latitude).toFixed(COORD_DECIMALS);
  const lon = roundCoordinate(longitude).toFixed(COORD_DECIMALS);
  return `weather:${lat},${lon}`;
}

/** Search terms are user input, so casing and padding must not fragment the cache. */
export function geocodingCacheKey(query: string): string {
  return `geocoding:${query.trim().toLowerCase()}`;
}
