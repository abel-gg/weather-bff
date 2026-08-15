import type { WeatherCondition } from './types.js';

/**
 * WMO 4677 weather interpretation codes.
 *
 * Mapped on the server on purpose: the label is presentation, but the *grouping*
 * (which codes count as "rain") is domain knowledge. Keeping it here means web,
 * a future mobile client and any internal consumer agree on what code 82 means,
 * instead of each re-implementing a lookup table and drifting.
 *
 * Icons are emoji rather than an icon set: zero assets, zero licensing, renders
 * everywhere. A production build would swap these for the design system's own
 * icons — the shape of `WeatherCondition` does not change.
 */
const WMO_CODES: Record<number, { label: string; icon: string; nightIcon?: string }> = {
  0: { label: 'Clear sky', icon: '☀️', nightIcon: '🌙' },
  1: { label: 'Mainly clear', icon: '🌤️', nightIcon: '🌙' },
  2: { label: 'Partly cloudy', icon: '⛅', nightIcon: '☁️' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Depositing rime fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Moderate drizzle', icon: '🌦️' },
  55: { label: 'Dense drizzle', icon: '🌧️' },
  56: { label: 'Light freezing drizzle', icon: '🌧️' },
  57: { label: 'Dense freezing drizzle', icon: '🌧️' },
  61: { label: 'Slight rain', icon: '🌦️' },
  63: { label: 'Moderate rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  66: { label: 'Light freezing rain', icon: '🌧️' },
  67: { label: 'Heavy freezing rain', icon: '🌧️' },
  71: { label: 'Slight snowfall', icon: '🌨️' },
  73: { label: 'Moderate snowfall', icon: '🌨️' },
  75: { label: 'Heavy snowfall', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Slight rain showers', icon: '🌦️' },
  81: { label: 'Moderate rain showers', icon: '🌧️' },
  82: { label: 'Violent rain showers', icon: '⛈️' },
  85: { label: 'Slight snow showers', icon: '🌨️' },
  86: { label: 'Heavy snow showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with slight hail', icon: '⛈️' },
  99: { label: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

/**
 * Providers add codes. An unknown one must degrade to something renderable
 * rather than crash a request or render `undefined` in the UI.
 */
export function describeWeatherCode(code: number, isDay = true): WeatherCondition {
  const entry = WMO_CODES[code];

  if (!entry) {
    return { code, label: 'Unknown conditions', icon: '❓' };
  }

  return {
    code,
    label: entry.label,
    icon: !isDay && entry.nightIcon ? entry.nightIcon : entry.icon,
  };
}
