import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { UpstreamRateLimitedError, UpstreamUnavailableError } from './errors.js';
import { buildServer } from './server.js';
import type { WeatherService } from './services/weather-service.js';
import { toGeoLocations, toWeatherSnapshot, type WeatherProvider } from './upstream/open-meteo.js';
import { FORECAST_PAYLOAD, GEOCODING_PAYLOAD } from './upstream/__fixtures__/open-meteo.js';

/**
 * Integration tests through `app.inject`: the real router, the real schemas,
 * the real error handler and the real cache, with only the network replaced.
 *
 * That boundary is deliberate. Everything above it is code we wrote and can
 * break; below it is someone else's HTTP server, and testing that only proves
 * we have internet. These tests are fast and deterministic and still exercise
 * the paths that actually break in production.
 */

const SNAPSHOT = toWeatherSnapshot(FORECAST_PAYLOAD);
const LOCATIONS = toGeoLocations(GEOCODING_PAYLOAD);

function createClock(start = 1_700_000_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => void (current += ms) };
}

function createProvider(overrides: Partial<WeatherProvider> = {}): WeatherProvider {
  return {
    fetchWeather: vi.fn().mockResolvedValue(SNAPSHOT),
    searchLocations: vi.fn().mockResolvedValue(LOCATIONS),
    ...overrides,
  };
}

const open: FastifyInstance[] = [];

async function startServer(
  provider: WeatherProvider = createProvider(),
  clock = createClock(),
): Promise<{ app: FastifyInstance; service: WeatherService; provider: WeatherProvider; clock: ReturnType<typeof createClock> }> {
  const { app, service } = await buildServer({
    config: loadConfig({}),
    provider,
    logging: false,
    now: clock.now,
  });
  open.push(app);
  return { app, service, provider, clock };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('GET /api/weather', () => {
  it('returns the shaped snapshot with freshness metadata', async () => {
    const { app } = await startServer();

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.current.temperatureC).toBe(29.3);
    expect(body.data.forecast).toHaveLength(5);
    expect(body.meta.stale).toBe(false);
    expect(body.meta.fetchedAt).toEqual(expect.any(String));
  });

  it('serves a second caller from cache without touching the provider', async () => {
    const { app, provider } = await startServer();

    await app.inject({ url: '/api/weather?latitude=36.7201&longitude=-4.4203' });
    // Different coordinates, same grid cell: this must not be a second call.
    await app.inject({ url: '/api/weather?latitude=36.7234&longitude=-4.4241' });

    expect(provider.fetchWeather).toHaveBeenCalledTimes(1);
  });

  it('lets browsers and CDNs cache the response too', async () => {
    const { app } = await startServer();

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    expect(response.headers['cache-control']).toBe(
      'public, max-age=600, stale-while-revalidate=3600',
    );
  });

  it('keeps serving weather when the provider goes down', async () => {
    // The behaviour this whole architecture exists for.
    const provider = createProvider();
    const { app, service, clock } = await startServer(provider);

    await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    clock.advance(11 * 60 * 1000); // past the 10-minute TTL
    vi.mocked(provider.fetchWeather).mockRejectedValue(new UpstreamUnavailableError());

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.current.temperatureC).toBe(29.3);
    // Flagged, so the UI can say "updated 11 minutes ago" instead of lying.
    expect(body.meta.stale).toBe(true);
    // And a stale body is not pinned into downstream caches for a full TTL.
    expect(response.headers['cache-control']).toContain('max-age=60');

    await service.drain();
  });

  it('surfaces a provider outage as an error only when there is no cached fallback', async () => {
    const provider = createProvider({
      fetchWeather: vi.fn().mockRejectedValue(new UpstreamUnavailableError()),
    });
    const { app } = await startServer(provider);

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('passes a rate limit through as a rate limit, with a retry hint', async () => {
    const provider = createProvider({
      fetchWeather: vi.fn().mockRejectedValue(new UpstreamRateLimitedError()),
    });
    const { app } = await startServer(provider);

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('30');
  });

  it.each([
    ['no coordinates at all', '/api/weather'],
    ['only one coordinate', '/api/weather?latitude=36.72'],
    ['a latitude off the planet', '/api/weather?latitude=120&longitude=-4.42'],
    ['a non-numeric coordinate', '/api/weather?latitude=north&longitude=-4.42'],
  ])('rejects %s without calling the provider', async (_label, url) => {
    const { app, provider } = await startServer();

    const response = await app.inject({ url });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(provider.fetchWeather).not.toHaveBeenCalled();
  });

  it('never leaks internals when something unexpected breaks', async () => {
    const provider = createProvider({
      fetchWeather: vi.fn().mockRejectedValue(new Error('postgres://user:hunter2@db-prod')),
    });
    const { app } = await startServer(provider);

    const response = await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });
    const raw = response.body;

    expect(response.statusCode).toBe(500);
    expect(raw).not.toContain('hunter2');
    expect(response.json().error).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: expect.any(String),
    });
  });
});

describe('GET /api/locations', () => {
  it('returns matches for a search term', async () => {
    const { app } = await startServer();

    const response = await app.inject({ url: '/api/locations?q=Malaga' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe('Málaga');
  });

  it('treats "nothing found" as an empty success, not an error', async () => {
    const provider = createProvider({ searchLocations: vi.fn().mockResolvedValue([]) });
    const { app } = await startServer(provider);

    const response = await app.inject({ url: '/api/locations?q=zzzzzz' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it('refuses a one-character query so type-ahead cannot hammer the provider', async () => {
    const { app, provider } = await startServer();

    const response = await app.inject({ url: '/api/locations?q=M' });

    expect(response.statusCode).toBe(400);
    expect(provider.searchLocations).not.toHaveBeenCalled();
  });
});

describe('operational surface', () => {
  it('answers liveness and readiness separately', async () => {
    const { app } = await startServer();

    const live = await app.inject({ url: '/health/live' });
    const ready = await app.inject({ url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', cache: { weatherEntries: 0 } });
  });

  it('stays ready while the provider is down, so a blip cannot empty the load balancer', async () => {
    const provider = createProvider({
      fetchWeather: vi.fn().mockRejectedValue(new UpstreamUnavailableError()),
    });
    const { app } = await startServer(provider);

    await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200);
  });

  it('exposes the cache counters that make the hit ratio observable', async () => {
    const { app } = await startServer();

    await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });
    await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });

    const metrics = await app.inject({ url: '/metrics' });

    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('cache_events_total');
    expect(metrics.body).toContain('cache="weather",event="miss"');
    expect(metrics.body).toContain('cache="weather",event="hit_fresh"');
    expect(metrics.body).toContain('upstream_duration_seconds');
    expect(metrics.body).toContain('http_request_duration_seconds');
  });

  it('labels HTTP metrics by route pattern, never by URL', async () => {
    const { app } = await startServer();

    await app.inject({ url: '/api/weather?latitude=36.72&longitude=-4.42' });
    await app.inject({ url: '/api/weather?latitude=52.52&longitude=13.40' });

    const body = (await app.inject({ url: '/metrics' })).body;

    // One series for both requests. The coordinates must not appear anywhere.
    expect(body).toContain('route="/api/weather"');
    expect(body).not.toContain('36.72');
  });

  it('echoes an inbound trace id so a request can be followed across services', async () => {
    const { app } = await startServer();

    const response = await app.inject({
      url: '/api/weather?latitude=36.72&longitude=-4.42',
      headers: { 'x-request-id': 'trace-from-the-edge' },
    });

    expect(response.headers['x-request-id']).toBe('trace-from-the-edge');
  });

  it('answers an unknown route in the same envelope as every other error', async () => {
    const { app } = await startServer();

    const response = await app.inject({ url: '/api/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: expect.any(String),
    });
  });
});
