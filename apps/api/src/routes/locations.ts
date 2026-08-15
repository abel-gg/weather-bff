import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { ApiResponse, GeoLocation } from '../domain/types.js';
import type { WeatherService } from '../services/weather-service.js';

/**
 * `minLength: 2` is a cost control, not a UX preference. A one-character query
 * matches a large fraction of the gazetteer, and a type-ahead firing on the
 * first keystroke turns every user into a burst of near-useless upstream calls.
 * `maxLength` bounds what an abusive client can push into a cache key.
 */
const locationsQuerySchema = {
  type: 'object',
  required: ['q'],
  properties: {
    q: { type: 'string', minLength: 2, maxLength: 100 },
    limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
  },
} as const;

export function registerLocationRoutes(
  app: FastifyInstance,
  service: WeatherService,
  config: AppConfig,
): void {
  const freshMaxAge = Math.floor(config.cache.geocodingTtlMs / 1000);
  const staleWindow = Math.floor(config.cache.geocodingStaleMs / 1000);

  app.get(
    '/api/locations',
    { schema: { querystring: locationsQuerySchema } },
    async (request, reply) => {
      const { q, limit } = request.query as { q: string; limit?: number };

      const result = await service.searchLocations(q.trim(), limit ?? 5);

      reply.header(
        'cache-control',
        `public, max-age=${result.state === 'stale' ? 60 : freshMaxAge}, stale-while-revalidate=${staleWindow}`,
      );

      // An empty list is a 200. The search succeeded and found nothing, which
      // is an empty state for the UI to render, not an error to handle.
      const body: ApiResponse<GeoLocation[]> = {
        data: result.value,
        meta: {
          fetchedAt: new Date(result.fetchedAt).toISOString(),
          stale: result.state === 'stale',
        },
      };

      return body;
    },
  );
}
