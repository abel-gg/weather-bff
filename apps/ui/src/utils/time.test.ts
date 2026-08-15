import { describe, expect, it } from 'vitest';
import { formatForecastDay, formatRelativeTime, formatTemperature } from './time';

const NOW = Date.parse('2026-08-15T12:00:00Z');

describe('formatRelativeTime', () => {
  it('collapses the last few seconds into "just now"', () => {
    expect(formatRelativeTime('2026-08-15T11:59:40Z', NOW)).toBe('just now');
  });

  it('reports minutes and hours in the units a person would use', () => {
    expect(formatRelativeTime('2026-08-15T11:49:00Z', NOW)).toBe('11 minutes ago');
    expect(formatRelativeTime('2026-08-15T09:00:00Z', NOW)).toBe('3 hours ago');
  });

  it('degrades to a readable string rather than NaN on a malformed timestamp', () => {
    // This value comes off the network, so it has to be allowed to be wrong.
    expect(formatRelativeTime('not-a-date', NOW)).toBe('unknown');
  });
});

describe('formatForecastDay', () => {
  it('labels the first column Today instead of repeating the date', () => {
    expect(formatForecastDay('2026-08-15', 0)).toBe('Today');
  });

  it('uses a short weekday for the rest', () => {
    expect(formatForecastDay('2026-08-16', 1)).toBe('Sun');
  });

  it('falls back to the raw value if the date cannot be parsed', () => {
    expect(formatForecastDay('garbage', 2)).toBe('garbage');
  });
});

describe('formatTemperature', () => {
  it('rounds, because a tenth of a degree is noise the user did not ask for', () => {
    expect(formatTemperature(29.3)).toBe('29°');
  });

  it('never renders a temperature just below zero as "-0"', () => {
    // Math.round(-0.4) is negative zero, which would read as nonsense on screen.
    expect(formatTemperature(-0.4)).toBe('0°');
    expect(formatTemperature(-0.6)).toBe('-1°');
  });
});
