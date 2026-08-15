import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors.js';
import {
  geocodingCacheKey,
  parseCoordinates,
  roundCoordinate,
  weatherCacheKey,
} from './geo.js';

describe('roundCoordinate', () => {
  it('rounds to the two-decimal cache grid', () => {
    expect(roundCoordinate(36.72016)).toBe(36.72);
    expect(roundCoordinate(-4.42034)).toBe(-4.42);
  });

  it('normalises negative zero so it cannot produce a second key for one place', () => {
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true);
  });
});

describe('weatherCacheKey', () => {
  it('collapses every coordinate inside one grid cell onto a single key', () => {
    // Roughly 400 m apart: different users, same weather, must be one upstream call.
    const a = weatherCacheKey({ latitude: 36.7201, longitude: -4.4203 });
    const b = weatherCacheKey({ latitude: 36.7234, longitude: -4.4241 });
    expect(a).toBe(b);
  });

  it('keeps genuinely different places apart', () => {
    const malaga = weatherCacheKey({ latitude: 36.72, longitude: -4.42 });
    const berlin = weatherCacheKey({ latitude: 52.52, longitude: 13.4 });
    expect(malaga).not.toBe(berlin);
  });

  it('produces the same key regardless of trailing-decimal representation', () => {
    expect(weatherCacheKey({ latitude: 36.7, longitude: -4.4 })).toBe(
      weatherCacheKey({ latitude: 36.7, longitude: -4.4 }),
    );
    expect(weatherCacheKey({ latitude: 36.7, longitude: -4.4 })).toContain('36.70,-4.40');
  });
});

describe('geocodingCacheKey', () => {
  it('is insensitive to casing and padding', () => {
    expect(geocodingCacheKey('  MÁLAGA ')).toBe(geocodingCacheKey('málaga'));
  });
});

describe('parseCoordinates', () => {
  it('accepts numeric strings from the query string', () => {
    expect(parseCoordinates('36.72', '-4.42')).toEqual({ latitude: 36.72, longitude: -4.42 });
  });

  it('rejects an empty string instead of silently reading it as zero', () => {
    // Number('') === 0, which would put the user in the Gulf of Guinea.
    expect(() => parseCoordinates('', '-4.42')).toThrow(ValidationError);
  });

  it.each([
    ['missing latitude', undefined, -4.42],
    ['non-numeric latitude', 'north', -4.42],
    ['latitude out of range', 91, -4.42],
    ['longitude out of range', 36.72, 181],
  ])('rejects %s', (_label, latitude, longitude) => {
    expect(() => parseCoordinates(latitude, longitude)).toThrow(ValidationError);
  });

  it('accepts the exact boundaries of the coordinate system', () => {
    expect(() => parseCoordinates(-90, -180)).not.toThrow();
    expect(() => parseCoordinates(90, 180)).not.toThrow();
  });
});
