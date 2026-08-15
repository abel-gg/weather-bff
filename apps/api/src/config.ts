/**
 * Configuration is read once, validated once, at boot.
 *
 * A bad value crashes the process on startup instead of throwing on the first
 * request that happens to need it. Failing at deploy time is cheap; failing at
 * 3am under load, for one unlucky endpoint, is not.
 */

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  corsOrigins: string[];
  cache: {
    weatherTtlMs: number;
    weatherStaleMs: number;
    geocodingTtlMs: number;
    geocodingStaleMs: number;
    maxEntries: number;
  };
  upstream: {
    timeoutMs: number;
    forecastUrl: string;
    geocodingUrl: string;
  };
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid configuration: ${key} must be a positive integer, received "${raw}".`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const config: AppConfig = {
    port: readInt(env, 'PORT', 3001),
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cache: {
      // The provider recomputes current conditions every 15 minutes — it
      // reports "interval": 900 in the payload — which sets the scale: this
      // belongs in minutes, not seconds.
      //
      // It sits deliberately below that period rather than matching it. We
      // cannot see the provider's phase, so what we serve ages by (time since
      // its last recompute) + our TTL. Matching 15 would push the worst case to
      // 30 minutes, and would leave our refresh cycle running at exactly their
      // period — which can lock onto an unlucky phase and keep refreshing just
      // before each recompute, indefinitely. At 10 the phase rotates instead.
      //
      // The price is that roughly a third of refreshes return identical
      // numbers. That is the cost of bounding staleness, not an oversight.
      weatherTtlMs: readInt(env, 'WEATHER_TTL_MS', 10 * 60 * 1000),
      // An hour of stale tolerance. If the provider is down, an hour-old
      // temperature is still far more useful than an error screen.
      weatherStaleMs: readInt(env, 'WEATHER_STALE_MS', 60 * 60 * 1000),
      // Place names do not move. This cache exists purely to stop the
      // type-ahead from turning every keystroke into an upstream request.
      geocodingTtlMs: readInt(env, 'GEOCODING_TTL_MS', 24 * 60 * 60 * 1000),
      geocodingStaleMs: readInt(env, 'GEOCODING_STALE_MS', 7 * 24 * 60 * 60 * 1000),
      maxEntries: readInt(env, 'CACHE_MAX_ENTRIES', 5000),
    },
    upstream: {
      // Deliberately short. We would rather fall back to stale data fast than
      // hold a connection open and let latency propagate to the user.
      timeoutMs: readInt(env, 'UPSTREAM_TIMEOUT_MS', 4000),
      forecastUrl: env.OPEN_METEO_FORECAST_URL ?? 'https://api.open-meteo.com/v1/forecast',
      geocodingUrl:
        env.OPEN_METEO_GEOCODING_URL ?? 'https://geocoding-api.open-meteo.com/v1/search',
    },
  };

  if (config.cache.weatherStaleMs <= config.cache.weatherTtlMs) {
    throw new Error('Invalid configuration: WEATHER_STALE_MS must be greater than WEATHER_TTL_MS.');
  }
  if (config.cache.geocodingStaleMs <= config.cache.geocodingTtlMs) {
    throw new Error(
      'Invalid configuration: GEOCODING_STALE_MS must be greater than GEOCODING_TTL_MS.',
    );
  }

  return config;
}
