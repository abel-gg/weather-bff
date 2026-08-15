import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ApiResponse, GeoLocation, WeatherSnapshot } from './api/types';

/**
 * A fresh QueryClient per test, with retries off.
 *
 * Sharing one client would let cached data leak between tests and turn failures
 * into order-dependent mysteries. Retries off because a test asserting the
 * error state should not first sit through an exponential backoff.
 */
export function renderWithQuery(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

export const WEATHER_SNAPSHOT: WeatherSnapshot = {
  coordinates: { latitude: 36.75, longitude: -4.4375 },
  timezone: 'Europe/Madrid',
  current: {
    observedAt: '2026-08-15T11:15',
    temperatureC: 29.3,
    apparentTemperatureC: 33.4,
    humidityPct: 65,
    precipitationMm: 0,
    windSpeedKmh: 7.6,
    isDay: true,
    condition: { code: 1, label: 'Mainly clear', icon: '🌤️' },
  },
  forecast: [
    {
      date: '2026-08-15',
      minTemperatureC: 24.9,
      maxTemperatureC: 31.4,
      precipitationProbabilityPct: 45,
      condition: { code: 3, label: 'Overcast', icon: '☁️' },
    },
    {
      date: '2026-08-16',
      minTemperatureC: 25.4,
      maxTemperatureC: 31.2,
      precipitationProbabilityPct: 13,
      condition: { code: 3, label: 'Overcast', icon: '☁️' },
    },
  ],
};

export const LOCATIONS: GeoLocation[] = [
  {
    id: 2514256,
    name: 'Málaga',
    country: 'España',
    countryCode: 'ES',
    region: 'Andalucía',
    latitude: 36.72016,
    longitude: -4.42034,
    timezone: 'Europe/Madrid',
  },
];

export function apiResponse<T>(data: T, stale = false): ApiResponse<T> {
  return { data, meta: { fetchedAt: new Date().toISOString(), stale } };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
