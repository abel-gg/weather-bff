/**
 * The contract the frontend consumes.
 *
 * This is deliberately NOT the provider's payload reshaped a little. It is our
 * own model, which means swapping Open-Meteo for another provider is a change
 * in one adapter file and nothing else moves. It also lets us drop everything
 * the UI does not render — the raw forecast response is roughly 4x the size of
 * what we send, and at high traffic that difference is bandwidth, parse time
 * and battery on every client.
 *
 * Units live in the field names. `temperature: 29.3` is a question;
 * `temperatureC: 29.3` is an answer.
 */

export interface WeatherCondition {
  /** WMO weather interpretation code, kept so clients can re-map if they want. */
  code: number;
  label: string;
  icon: string;
}

export interface CurrentConditions {
  observedAt: string;
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  windSpeedKmh: number;
  isDay: boolean;
  condition: WeatherCondition;
}

export interface ForecastDay {
  date: string;
  minTemperatureC: number;
  maxTemperatureC: number;
  precipitationProbabilityPct: number;
  condition: WeatherCondition;
}

export interface WeatherSnapshot {
  /** The grid point the provider actually answered for, not what we asked. */
  coordinates: { latitude: number; longitude: number };
  timezone: string;
  current: CurrentConditions;
  forecast: ForecastDay[];
}

export interface GeoLocation {
  id: number;
  name: string;
  country: string;
  countryCode: string;
  region: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
}

/**
 * Every payload carries its own freshness.
 *
 * `stale: true` is not an error — it means the provider is slow or down and we
 * chose to answer from cache anyway. The UI shows a discreet "updated N minutes
 * ago" badge instead of blowing away a working screen. This one boolean is the
 * seam between the caching strategy and the UX.
 */
export interface ResponseMeta {
  fetchedAt: string;
  stale: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}
