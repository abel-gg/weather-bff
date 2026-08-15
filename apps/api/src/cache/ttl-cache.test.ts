import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './ttl-cache.js';

/**
 * Time is injected rather than faked globally: these tests assert on cache
 * *policy*, and policy is a pure function of age. No timers, no flake.
 */
function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const POLICY = { ttlMs: 10_000, staleMs: 60_000, maxEntries: 100 };

function createCache<T>(clock: ReturnType<typeof createClock>, overrides = {}) {
  return new TtlCache<T>({ name: 'test', ...POLICY, now: clock.now, ...overrides });
}

describe('TtlCache', () => {
  it('calls the loader once on a miss and serves from memory within the TTL', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);
    const loader = vi.fn().mockResolvedValue('value-1');

    const first = await cache.fetch('k', loader);
    clock.advance(POLICY.ttlMs - 1);
    const second = await cache.fetch('k', loader);

    expect(first).toMatchObject({ value: 'value-1', state: 'fresh' });
    expect(second).toMatchObject({ value: 'value-1', state: 'fresh' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('collapses a stampede of concurrent misses into a single upstream call', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);

    let release!: (value: string) => void;
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    // 50 requests for a cold key, all in the same tick. This is the failure
    // mode that takes a provider down when a cache entry expires under load.
    const inflight = Promise.all(Array.from({ length: 50 }, () => cache.fetch('k', loader)));
    release('value-1');
    const results = await inflight;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(50);
    expect(results.every((r) => r.value === 'value-1')).toBe(true);
  });

  it('serves the stale value immediately past the TTL and refreshes behind the request', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);
    const loader = vi.fn().mockResolvedValue('value-1');

    await cache.fetch('k', loader);
    clock.advance(POLICY.ttlMs + 1);
    loader.mockResolvedValue('value-2');

    const stale = await cache.fetch('k', loader);
    expect(stale).toMatchObject({ value: 'value-1', state: 'stale' });

    await cache.idle();

    const refreshed = await cache.fetch('k', loader);
    expect(refreshed).toMatchObject({ value: 'value-2', state: 'fresh' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last good value when the provider is down', async () => {
    const clock = createClock();
    const onRevalidateError = vi.fn();
    const cache = createCache<string>(clock, { onRevalidateError });
    const loader = vi.fn().mockResolvedValue('value-1');

    await cache.fetch('k', loader);
    clock.advance(POLICY.ttlMs + 1);
    loader.mockRejectedValue(new Error('upstream exploded'));

    const first = await cache.fetch('k', loader);
    await cache.idle();
    const second = await cache.fetch('k', loader);
    await cache.idle();

    // Neither call rejects, and the user still sees weather.
    expect(first).toMatchObject({ value: 'value-1', state: 'stale' });
    expect(second).toMatchObject({ value: 'value-1', state: 'stale' });
    expect(onRevalidateError).toHaveBeenCalled();
  });

  it('stops serving a value once it is past the stale window', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);
    const loader = vi.fn().mockResolvedValue('value-1');

    await cache.fetch('k', loader);
    clock.advance(POLICY.staleMs + 1);
    loader.mockResolvedValue('value-2');

    // Too old to be worth serving: this caller waits for real data.
    const result = await cache.fetch('k', loader);
    expect(result).toMatchObject({ value: 'value-2', state: 'fresh' });
  });

  it('propagates the error when there is nothing cached to fall back to', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);
    const loader = vi.fn().mockRejectedValue(new Error('upstream exploded'));

    await expect(cache.fetch('k', loader)).rejects.toThrow('upstream exploded');
  });

  it('does not poison the cache after a failed cold load', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock);
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('value-1');

    await expect(cache.fetch('k', loader)).rejects.toThrow('transient');

    // The failed promise must not linger in the in-flight map.
    await expect(cache.fetch('k', loader)).resolves.toMatchObject({ value: 'value-1' });
  });

  it('evicts the least recently used entry when full', async () => {
    const clock = createClock();
    const cache = createCache<string>(clock, { maxEntries: 2 });
    const loads: string[] = [];
    const loaderFor = (key: string) => async () => {
      loads.push(key);
      return `value-${key}`;
    };

    await cache.fetch('a', loaderFor('a'));
    await cache.fetch('b', loaderFor('b'));
    await cache.fetch('a', loaderFor('a')); // 'a' is now the most recent
    await cache.fetch('c', loaderFor('c')); // evicts 'b', not 'a'

    expect(cache.size).toBe(2);

    await cache.fetch('a', loaderFor('a'));
    expect(loads).toEqual(['a', 'b', 'c']); // 'a' never reloaded

    await cache.fetch('b', loaderFor('b'));
    expect(loads).toEqual(['a', 'b', 'c', 'b']); // 'b' was the one evicted
  });

  it('reports what happened so metrics can be derived without coupling', async () => {
    const clock = createClock();
    const onEvent = vi.fn();
    const cache = createCache<string>(clock, { onEvent });
    const loader = vi.fn().mockResolvedValue('value-1');

    await cache.fetch('k', loader);
    await cache.fetch('k', loader);
    clock.advance(POLICY.ttlMs + 1);
    await cache.fetch('k', loader);
    await cache.idle();

    const events = onEvent.mock.calls.map(([type]) => type);
    expect(events).toContain('miss');
    expect(events).toContain('hit_fresh');
    expect(events).toContain('hit_stale');
  });

  it('refuses a configuration with no stale window', () => {
    expect(() => new TtlCache({ name: 'bad', ttlMs: 60_000, staleMs: 60_000, maxEntries: 10 }))
      .toThrow(/staleMs must be greater than ttlMs/);
  });
});
