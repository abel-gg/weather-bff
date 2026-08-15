import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { parseCoordinates } from '../domain/geo.js';
import type { ApiResponse, WeatherSnapshot } from '../domain/types.js';
import type { WeatherService } from '../services/weather-service.js';

/**
 * The JSON schema is the wire contract, enforced by Fastify before the handler
 * runs. It documents the endpoint, rejects malformed input with a 400 for free,
 * and lets Fastify compile a fast serializer.
 *
 * `parseCoordinates` still runs inside the handler. That is not redundancy for
 * its own sake: ajv type coercion has sharp edges (an empty string coerces to
 * 0, which is a valid latitude in the Gulf of Guinea), and this is a trust
 * boundary. The schema states the contract; the parser enforces the semantics.
 */
const weatherQuerySchema = {
  type: 'object',
  required: ['latitude', 'longitude'],
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
  },
} as const;

export function registerWeatherRoutes(
  app: FastifyInstance,
  service: WeatherService,
  config: AppConfig,
): void {
  const freshMaxAge = Math.floor(config.cache.weatherTtlMs / 1000);
  const staleWindow = Math.floor(config.cache.weatherStaleMs / 1000);

  app.get('/api/weather', { schema: { querystring: weatherQuerySchema } }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const coordinates = parseCoordinates(query.latitude, query.longitude);

    const result = await service.getWeather(coordinates);
    const isStale = result.state === 'stale';

    // Caching is layered: this header makes the browser and any CDN in front of
    // us hold the same value, so a hit never even reaches this process.
    //
    // A stale body gets a deliberately short max-age. Serving stale is a
    // recovery behaviour, and pinning it into every downstream cache for a full
    // TTL would turn a brief provider blip into an hour of stale data
    // everywhere.
    reply.header(
      'cache-control',
      `public, max-age=${isStale ? 60 : freshMaxAge}, stale-while-revalidate=${staleWindow}`,
    );

    const body: ApiResponse<WeatherSnapshot> = {
      data: result.value,
      meta: {
        fetchedAt: new Date(result.fetchedAt).toISOString(),
        stale: isStale,
      },
    };

    return body;
  });
}
