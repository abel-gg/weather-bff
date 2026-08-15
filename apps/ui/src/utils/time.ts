const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * "11 minutes ago" beats an ISO timestamp when the point is freshness.
 *
 * The stale notice exists to let someone judge whether the number in front of
 * them is still worth trusting, and nobody does that arithmetic from
 * "2026-08-15T11:15:00Z" while glancing at a phone.
 */
export function formatRelativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) return 'unknown';

  const elapsedSeconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(elapsedSeconds);

  if (absolute < 45) return 'just now';
  if (absolute < 3600) return relativeFormatter.format(Math.round(elapsedSeconds / 60), 'minute');
  if (absolute < 86_400) return relativeFormatter.format(Math.round(elapsedSeconds / 3600), 'hour');
  return relativeFormatter.format(Math.round(elapsedSeconds / 86_400), 'day');
}

/** Short weekday for the forecast strip; "Today" reads better than the date itself. */
export function formatForecastDay(isoDate: string, index: number): string {
  if (index === 0) return 'Today';
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
}

export function formatTemperature(celsius: number): string {
  return `${Math.round(celsius)}°`;
}
