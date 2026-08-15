import { describe, expect, it, vi } from 'vitest';
import {
  UpstreamRateLimitedError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
} from '../errors.js';
import {
  FORECAST_PAYLOAD,
  GEOCODING_EMPTY_PAYLOAD,
  GEOCODING_PAYLOAD,
  jsonResponse,
} from './__fixtures__/open-meteo.js';
import { createOpenMeteoProvider, toWeatherSnapshot } from './open-meteo.js';

const OPTIONS = {
  forecastUrl: 'https://example.test/v1/forecast',
  geocodingUrl: 'https://example.test/v1/search',
  timeoutMs: 1000,
};

function providerReturning(response: Response | Promise<Response>) {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  return { provider: createOpenMeteoProvider({ ...OPTIONS, fetchImpl }), fetchImpl };
}

describe('createOpenMeteoProvider.fetchWeather', () => {
  it('reshapes the captured provider payload into our own contract', async () => {
    const { provider } = providerReturning(jsonResponse(FORECAST_PAYLOAD));

    const snapshot = await provider.fetchWeather({ latitude: 36.72, longitude: -4.42 });

    expect(snapshot.timezone).toBe('Europe/Madrid');
    expect(snapshot.current).toMatchObject({
      temperatureC: 29.3,
      apparentTemperatureC: 33.4,
      humidityPct: 65,
      windSpeedKmh: 7.6,
      isDay: true,
    });
    expect(snapshot.current.condition).toEqual({
      code: 1,
      label: 'Mainly clear',
      icon: '🌤️',
    });
    expect(snapshot.forecast).toHaveLength(5);
    expect(snapshot.forecast[0]).toMatchObject({
      date: '2026-08-15',
      maxTemperatureC: 31.4,
      minTemperatureC: 24.9,
      precipitationProbabilityPct: 45,
    });
  });

  it('asks upstream for the rounded coordinates so proxies see one URL per grid cell', async () => {
    const { provider, fetchImpl } = providerReturning(jsonResponse(FORECAST_PAYLOAD));

    await provider.fetchWeather({ latitude: 36.720164, longitude: -4.420339 });

    const requestedUrl = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get('latitude')).toBe('36.72');
    expect(requestedUrl.searchParams.get('longitude')).toBe('-4.42');
  });

  it('picks the night icon when the provider reports darkness', async () => {
    const nightPayload = {
      ...FORECAST_PAYLOAD,
      current: { ...FORECAST_PAYLOAD.current, is_day: 0, weather_code: 0 },
    };
    const { provider } = providerReturning(jsonResponse(nightPayload));

    const snapshot = await provider.fetchWeather({ latitude: 36.72, longitude: -4.42 });

    expect(snapshot.current.condition.icon).toBe('🌙');
    expect(snapshot.current.isDay).toBe(false);
  });

  it.each([
    [429, UpstreamRateLimitedError],
    [500, UpstreamUnavailableError],
    [503, UpstreamUnavailableError],
  ])('maps HTTP %s to a typed domain error', async (status, expected) => {
    const { provider } = providerReturning(jsonResponse({ error: true }, status));

    await expect(provider.fetchWeather({ latitude: 36.72, longitude: -4.42 })).rejects.toBeInstanceOf(
      expected,
    );
  });

  it('distinguishes a timeout from an unreachable host', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    const timingOut = createOpenMeteoProvider({
      ...OPTIONS,
      fetchImpl: vi.fn().mockRejectedValue(timeout),
    });
    const unreachable = createOpenMeteoProvider({
      ...OPTIONS,
      fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await expect(timingOut.fetchWeather({ latitude: 0, longitude: 0 })).rejects.toBeInstanceOf(
      UpstreamTimeoutError,
    );
    await expect(unreachable.fetchWeather({ latitude: 0, longitude: 0 })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('rejects a malformed body rather than letting it reach the cache', async () => {
    // This is the important one: anything this function returns gets cached for
    // the whole TTL, so garbage must be stopped at the boundary.
    const { provider } = providerReturning(jsonResponse({ latitude: 36.75, daily: {} }));

    await expect(
      provider.fetchWeather({ latitude: 36.72, longitude: -4.42 }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});

describe('toWeatherSnapshot', () => {
  it('drops ragged forecast rows instead of emitting undefined temperatures', () => {
    const ragged = {
      ...FORECAST_PAYLOAD,
      daily: {
        time: ['2026-08-15', '2026-08-16', '2026-08-17'],
        weather_code: [3, 3, 3],
        temperature_2m_max: [31.4], // provider truncated the column
        temperature_2m_min: [24.9],
        precipitation_probability_max: [45, null, null],
      },
    };

    const snapshot = toWeatherSnapshot(ragged);

    expect(snapshot.forecast).toHaveLength(1);
    expect(snapshot.forecast[0]?.maxTemperatureC).toBe(31.4);
  });

  it('substitutes a null precipitation probability with zero', () => {
    const withNulls = {
      ...FORECAST_PAYLOAD,
      daily: { ...FORECAST_PAYLOAD.daily, precipitation_probability_max: [null, null, null, null, null] },
    };

    expect(toWeatherSnapshot(withNulls).forecast[0]?.precipitationProbabilityPct).toBe(0);
  });

  it('degrades gracefully on a weather code it has never seen', () => {
    const unknownCode = {
      ...FORECAST_PAYLOAD,
      current: { ...FORECAST_PAYLOAD.current, weather_code: 123 },
    };

    expect(toWeatherSnapshot(unknownCode).current.condition).toEqual({
      code: 123,
      label: 'Unknown conditions',
      icon: '❓',
    });
  });
});

describe('createOpenMeteoProvider.searchLocations', () => {
  it('maps the captured geocoding payload', async () => {
    const { provider } = providerReturning(jsonResponse(GEOCODING_PAYLOAD));

    const locations = await provider.searchLocations('Malaga', 5);

    expect(locations).toHaveLength(2);
    expect(locations[0]).toEqual({
      id: 2514256,
      name: 'Málaga',
      country: 'España',
      countryCode: 'ES',
      region: 'Andalucía',
      latitude: 36.72016,
      longitude: -4.42034,
      timezone: 'Europe/Madrid',
    });
  });

  it('returns an empty list when the payload omits the results key entirely', async () => {
    const { provider } = providerReturning(jsonResponse(GEOCODING_EMPTY_PAYLOAD));

    await expect(provider.searchLocations('asdfgh', 5)).resolves.toEqual([]);
  });
});
