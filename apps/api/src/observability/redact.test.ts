import { describe, expect, it } from 'vitest';
import { redactCoordinatesInUrl } from './redact.js';

describe('redactCoordinatesInUrl', () => {
  it('strips the personally identifying precision out of coordinates', () => {
    // A GPS fix from a phone locates a person to within metres. That must not
    // be what gets shipped to a log aggregator and retained for 30 days.
    expect(redactCoordinatesInUrl('/api/weather?latitude=36.7201643&longitude=-4.4203391')).toBe(
      '/api/weather?latitude=36.72&longitude=-4.42',
    );
  });

  it('leaves the resulting precision aligned with the cache key so logs stay debuggable', () => {
    expect(redactCoordinatesInUrl('/api/weather?latitude=36.7&longitude=-4.4')).toContain(
      'latitude=36.70',
    );
  });

  it('handles the short parameter spellings too', () => {
    expect(redactCoordinatesInUrl('/x?lat=36.7201643&lon=-4.4203391&lng=1.23456')).toBe(
      '/x?lat=36.72&lon=-4.42&lng=1.23',
    );
  });

  it('leaves unrelated query parameters untouched', () => {
    expect(redactCoordinatesInUrl('/api/locations?q=M%C3%A1laga&limit=5')).toBe(
      '/api/locations?q=M%C3%A1laga&limit=5',
    );
  });

  it('passes through URLs with no query string', () => {
    expect(redactCoordinatesInUrl('/health/live')).toBe('/health/live');
  });

  it('ignores values that are not numbers instead of throwing inside a log serializer', () => {
    // A serializer that throws takes down the request it was trying to describe.
    expect(redactCoordinatesInUrl('/api/weather?latitude=north')).toBe(
      '/api/weather?latitude=north',
    );
  });
});
