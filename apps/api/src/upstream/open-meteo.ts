import { roundCoordinate, type Coordinates } from '../domain/geo.js';
import type { ForecastDay, GeoLocation, WeatherSnapshot } from '../domain/types.js';
import { describeWeatherCode } from '../domain/weather-codes.js';
import { UpstreamRateLimitedError, UpstreamTimeoutError, UpstreamUnavailableError } from '../errors.js';

/**
 * The port the rest of the application depends on.
 *
 * Routes are written against this interface, never against Open-Meteo. Changing
 * provider — or putting a paid provider behind a contract, which is what any
 * commercial deployment would need — means writing one more adapter and
 * touching nothing else.
 */
export interface WeatherProvider {
  fetchWeather(coordinates: Coordinates): Promise<WeatherSnapshot>;
  searchLocations(query: string, limit: number): Promise<GeoLocation[]>;
}

export interface OpenMeteoOptions {
  forecastUrl: string;
  geocodingUrl: string;
  timeoutMs: number;
  /** Injected so the adapter can be tested without a network. */
  fetchImpl?: typeof fetch;
}

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
].join(',');

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
].join(',');

const FORECAST_DAYS = 7;

export function createOpenMeteoProvider(options: OpenMeteoOptions): WeatherProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson(url: URL): Promise<unknown> {
    let response: Response;

    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      // AbortSignal.timeout rejects with a TimeoutError DOMException; an
      // aborted request and a dead socket are different incidents and get
      // different codes so they can be alerted on separately.
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new UpstreamTimeoutError();
      }
      throw new UpstreamUnavailableError(
        `Could not reach the weather provider: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }

    // The failure mode that actually matters at scale gets its own class, so
    // "we are over quota" never hides inside a generic 502 on a dashboard.
    if (response.status === 429) {
      throw new UpstreamRateLimitedError();
    }
    if (!response.ok) {
      throw new UpstreamUnavailableError(
        `Weather provider responded with HTTP ${response.status}.`,
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamUnavailableError('Weather provider returned a malformed JSON body.');
    }
  }

  return {
    async fetchWeather(coordinates: Coordinates): Promise<WeatherSnapshot> {
      const url = new URL(options.forecastUrl);
      // Send the rounded coordinates, not the raw ones. Our cache key and the
      // upstream URL then agree, so any CDN or proxy in between sees the same
      // small set of URLs instead of one per user.
      url.searchParams.set('latitude', String(roundCoordinate(coordinates.latitude)));
      url.searchParams.set('longitude', String(roundCoordinate(coordinates.longitude)));
      url.searchParams.set('current', CURRENT_FIELDS);
      url.searchParams.set('daily', DAILY_FIELDS);
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('forecast_days', String(FORECAST_DAYS));

      return toWeatherSnapshot(await requestJson(url));
    },

    async searchLocations(query: string, limit: number): Promise<GeoLocation[]> {
      const url = new URL(options.geocodingUrl);
      url.searchParams.set('name', query);
      url.searchParams.set('count', String(limit));
      url.searchParams.set('format', 'json');

      return toGeoLocations(await requestJson(url));
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value);
}

/**
 * Validates and reshapes the provider payload.
 *
 * Validating here is not ceremony. Whatever comes out of this function gets
 * cached for the length of the TTL, so an unvalidated malformed response is not
 * one bad request — it is ten minutes of bad requests served at memory speed.
 * The boundary is the only place this can be caught.
 */
export function toWeatherSnapshot(raw: unknown): WeatherSnapshot {
  if (!isRecord(raw) || !isRecord(raw.current) || !isRecord(raw.daily)) {
    throw new UpstreamUnavailableError('Weather provider returned an unexpected payload shape.');
  }

  const current = raw.current;
  const daily = raw.daily;

  if (typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') {
    throw new UpstreamUnavailableError('Weather provider returned no usable current conditions.');
  }

  const isDay = current.is_day === 1;

  return {
    coordinates: {
      latitude: typeof raw.latitude === 'number' ? raw.latitude : 0,
      longitude: typeof raw.longitude === 'number' ? raw.longitude : 0,
    },
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'UTC',
    current: {
      observedAt: typeof current.time === 'string' ? current.time : new Date().toISOString(),
      temperatureC: current.temperature_2m,
      apparentTemperatureC: numberOr(current.apparent_temperature, current.temperature_2m),
      humidityPct: numberOr(current.relative_humidity_2m, 0),
      precipitationMm: numberOr(current.precipitation, 0),
      windSpeedKmh: numberOr(current.wind_speed_10m, 0),
      isDay,
      condition: describeWeatherCode(current.weather_code, isDay),
    },
    forecast: toForecastDays(daily),
  };
}

/**
 * Open-Meteo returns the forecast column-wise: parallel arrays keyed by field,
 * not a list of days. Zipping them defensively matters because a short or
 * ragged array would otherwise produce days with `undefined` temperatures that
 * only blow up once they reach the UI.
 */
function toForecastDays(daily: Record<string, unknown>): ForecastDay[] {
  const dates = daily.time;
  if (!Array.isArray(dates)) return [];

  const codes = isNumberArray(daily.weather_code) ? daily.weather_code : [];
  const maxima = isNumberArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
  const minima = isNumberArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
  const probabilities = isNumberArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];

  const days: ForecastDay[] = [];

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const max = maxima[index];
    const min = minima[index];
    const code = codes[index];

    if (typeof date !== 'string' || typeof max !== 'number' || typeof min !== 'number') {
      continue;
    }

    days.push({
      date,
      maxTemperatureC: max,
      minTemperatureC: min,
      // The provider sends null here when it has no probability for that day.
      precipitationProbabilityPct: numberOr(probabilities[index], 0),
      condition: describeWeatherCode(typeof code === 'number' ? code : -1, true),
    });
  }

  return days;
}

export function toGeoLocations(raw: unknown): GeoLocation[] {
  // No match omits the `results` key entirely rather than sending an empty
  // array. That is a successful search with nothing in it, not a failure.
  if (!isRecord(raw) || !Array.isArray(raw.results)) return [];

  return raw.results.flatMap((entry: unknown): GeoLocation[] => {
    if (!isRecord(entry)) return [];
    if (typeof entry.latitude !== 'number' || typeof entry.longitude !== 'number') return [];
    if (typeof entry.name !== 'string') return [];

    return [
      {
        id: typeof entry.id === 'number' ? entry.id : Number.NaN,
        name: entry.name,
        country: typeof entry.country === 'string' ? entry.country : '',
        countryCode: typeof entry.country_code === 'string' ? entry.country_code : '',
        region: typeof entry.admin1 === 'string' ? entry.admin1 : null,
        latitude: entry.latitude,
        longitude: entry.longitude,
        timezone: typeof entry.timezone === 'string' ? entry.timezone : 'UTC',
      },
    ];
  });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
