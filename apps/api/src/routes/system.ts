import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../observability/metrics.js';
import type { WeatherService } from '../services/weather-service.js';

/**
 * Operational endpoints.
 *
 * Liveness and readiness are split because they answer different questions and
 * a failed probe has very different consequences:
 *
 *   /health/live  — is the process wedged? A failure here should restart the pod.
 *   /health/ready — should this instance receive traffic?
 *
 * Readiness deliberately does NOT probe the weather provider. It is tempting,
 * and it is a trap: this service is explicitly built to keep serving cached and
 * stale data through a provider outage. If readiness depended on the provider,
 * an upstream blip would pull every instance out of the load balancer at the
 * exact moment the fallback was doing its job — converting a degraded but
 * working service into a total outage. Probes must reflect *our* health.
 */
export function registerSystemRoutes(
  app: FastifyInstance,
  service: WeatherService,
  metrics: Metrics,
): void {
  const startedAt = Date.now();

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async () => ({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    cache: service.stats(),
  }));

  // In production this is bound to an internal port or protected at the
  // ingress. Cache sizes and latency histograms are operational data and do not
  // belong on the public internet.
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metrics.registry.contentType);
    return metrics.registry.metrics();
  });
}
