/**
 * Captured verbatim from the live Open-Meteo API (Málaga, 2026-08-15).
 *
 * Hand-written fixtures test the shape you *imagined*; captured ones test the
 * shape you were actually sent. Note the details invention would have missed:
 * the coordinates come back snapped to the model grid (36.75 / -4.4375, not the
 * 36.72 / -4.42 that was requested), and `current.interval` is 900 — the
 * evidence behind the 10-minute TTL.
 */
export const FORECAST_PAYLOAD = {
  latitude: 36.75,
  longitude: -4.4375,
  generationtime_ms: 0.34332275390625,
  utc_offset_seconds: 7200,
  timezone: 'Europe/Madrid',
  timezone_abbreviation: 'GMT+2',
  elevation: 20.0,
  current_units: {
    time: 'iso8601',
    interval: 'seconds',
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    apparent_temperature: '°C',
    is_day: '',
    precipitation: 'mm',
    weather_code: 'wmo code',
    wind_speed_10m: 'km/h',
  },
  current: {
    time: '2026-08-15T11:15',
    interval: 900,
    temperature_2m: 29.3,
    relative_humidity_2m: 65,
    apparent_temperature: 33.4,
    is_day: 1,
    precipitation: 0.0,
    weather_code: 1,
    wind_speed_10m: 7.6,
  },
  daily_units: {
    time: 'iso8601',
    weather_code: 'wmo code',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_probability_max: '%',
  },
  daily: {
    time: ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'],
    weather_code: [3, 3, 3, 2, 2],
    temperature_2m_max: [31.4, 31.2, 33.7, 33.3, 33.2],
    temperature_2m_min: [24.9, 25.4, 25.8, 25.0, 24.4],
    precipitation_probability_max: [45, 13, 3, 0, 3],
  },
};

/** Captured from the geocoding endpoint for the query "Malaga". */
export const GEOCODING_PAYLOAD = {
  results: [
    {
      id: 2514256,
      name: 'Málaga',
      latitude: 36.72016,
      longitude: -4.42034,
      elevation: 22.0,
      feature_code: 'PPLA2',
      country_code: 'ES',
      timezone: 'Europe/Madrid',
      population: 592346,
      country: 'España',
      admin1: 'Andalucía',
      admin2: 'Provincia de Málaga',
    },
    {
      id: 3675605,
      name: 'Málaga',
      latitude: 6.69903,
      longitude: -72.73233,
      elevation: 2210.0,
      feature_code: 'PPLA2',
      country_code: 'CO',
      timezone: 'America/Bogota',
      population: 19884,
      country: 'Colombia',
      admin1: 'Santander',
    },
  ],
  generationtime_ms: 0.4364252,
};

/** What the geocoding endpoint really returns for a query that matches nothing. */
export const GEOCODING_EMPTY_PAYLOAD = {
  generationtime_ms: 0.31,
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
