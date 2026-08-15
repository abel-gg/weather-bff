/**
 * Mirror of the BFF contract.
 *
 * Hand-written on purpose at this size. The honest alternative for a real
 * product is generating these from an OpenAPI document produced by the Fastify
 * schemas, so the two sides cannot drift silently — noted in the README as the
 * next step rather than pretended away here.
 */

export interface WeatherCondition {
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

export interface ResponseMeta {
  fetchedAt: string;
  /** True when the server answered from cache because upstream was unreachable. */
  stale: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}
