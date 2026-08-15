import type { CacheResult } from '../cache/ttl-cache.js';
import { TtlCache } from '../cache/ttl-cache.js';
import type { AppConfig } from '../config.js';
import { geocodingCacheKey, weatherCacheKey, type Coordinates } from '../domain/geo.js';
import type { GeoLocation, WeatherSnapshot } from '../domain/types.js';
import type { Metrics } from '../observability/metrics.js';
import type { WeatherProvider } from '../upstream/open-meteo.js';

export interface WeatherService {
  getWeather(coordinates: Coordinates): Promise<CacheResult<WeatherSnapshot>>;
  searchLocations(query: string, limit: number): Promise<CacheResult<GeoLocation[]>>;
  stats(): { weatherEntries: number; geocodingEntries: number };
  drain(): Promise<void>;
}

export interface WeatherServiceOptions {
  provider: WeatherProvider;
  config: AppConfig;
  metrics: Metrics;
  logger: { warn: (details: Record<string, unknown>, message: string) => void };
  now?: () => number;
}

/**
 * Composes the cache with the provider.
 *
 * Two caches rather than one because the two resources have nothing in common
 * except being cached: weather is volatile and hot, place names are effectively
 * immutable and cold. One shared TTL would have to be wrong for one of them,
 * and a shared eviction bound would let a burst of type-ahead traffic evict
 * every weather entry in the process.
 */
export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { provider, config, metrics, logger } = options;

  const onRevalidateError = (error: unknown, key: string, cacheName: string): void => {
    // A background refresh failing is not a user-visible error — the user was
    // already served stale data. It is still an operational signal, so it is
    // logged at warn and counted, never swallowed.
    logger.warn(
      { key, cache: cacheName, err: error instanceof Error ? error.message : String(error) },
      'Background cache revalidation failed; continuing to serve stale data',
    );
  };

  const shared = {
    maxEntries: config.cache.maxEntries,
    onEvent: metrics.recordCacheEvent,
    onRevalidateError,
    ...(options.now ? { now: options.now } : {}),
  };

  const weatherCache = new TtlCache<WeatherSnapshot>({
    name: 'weather',
    ttlMs: config.cache.weatherTtlMs,
    staleMs: config.cache.weatherStaleMs,
    ...shared,
  });

  const geocodingCache = new TtlCache<GeoLocation[]>({
    name: 'geocoding',
    ttlMs: config.cache.geocodingTtlMs,
    staleMs: config.cache.geocodingStaleMs,
    ...shared,
  });

  return {
    getWeather(coordinates) {
      return weatherCache.fetch(weatherCacheKey(coordinates), () =>
        provider.fetchWeather(coordinates),
      );
    },

    searchLocations(query, limit) {
      // `limit` belongs in the key: the same term with a different count is a
      // different result set, and serving the short one for the long one would
      // silently truncate the dropdown.
      return geocodingCache.fetch(`${geocodingCacheKey(query)}:${limit}`, () =>
        provider.searchLocations(query, limit),
      );
    },

    stats() {
      return { weatherEntries: weatherCache.size, geocodingEntries: geocodingCache.size };
    },

    async drain() {
      await Promise.all([weatherCache.idle(), geocodingCache.idle()]);
    },
  };
}
