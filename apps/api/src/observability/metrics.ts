import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { CacheEventType } from '../cache/ttl-cache.js';

/**
 * Prometheus instrumentation.
 *
 * Three questions this has to answer in production, in priority order:
 *
 *   1. Is the cache working? `cache_events_total` gives the hit ratio. If it
 *      drops, upstream load rises proportionally and an outage follows. This is
 *      the leading indicator; everything else is lagging.
 *   2. Is the provider healthy? Upstream latency and outcome are tracked
 *      separately from our own so a provider slowdown is never misread as our
 *      regression.
 *   3. Are users being served? RED metrics on the HTTP surface.
 *
 * The one rule that matters here: every label must have bounded cardinality.
 * Labelling by full request URL would create a new time series per coordinate
 * pair and take the Prometheus instance down faster than any traffic spike, so
 * the HTTP metric is labelled by route *pattern* only.
 */
export interface Metrics {
  registry: Registry;
  httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  cacheEvents: Counter<'cache' | 'event'>;
  upstreamRequests: Counter<'operation' | 'outcome'>;
  upstreamDuration: Histogram<'operation'>;
  recordCacheEvent: (event: CacheEventType, cacheName: string) => void;
}

export interface MetricsOptions {
  /** Off in tests: process-level collectors are noise there. */
  collectDefault?: boolean;
}

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const registry = new Registry();

  if (options.collectDefault ?? true) {
    collectDefaultMetrics({ register: registry });
  }

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration, labelled by route pattern to bound cardinality.',
    labelNames: ['method', 'route', 'status_code'] as const,
    // Weighted towards the fast end: a cache hit should be sub-millisecond and
    // we want to see that band degrade, not have it collapsed into one bucket.
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cacheEvents = new Counter({
    name: 'cache_events_total',
    help: 'Cache outcomes by kind. hit_fresh + hit_stale over total is the hit ratio.',
    labelNames: ['cache', 'event'] as const,
    registers: [registry],
  });

  const upstreamRequests = new Counter({
    name: 'upstream_requests_total',
    help: 'Calls actually sent to the weather provider, by outcome.',
    labelNames: ['operation', 'outcome'] as const,
    registers: [registry],
  });

  const upstreamDuration = new Histogram({
    name: 'upstream_duration_seconds',
    help: 'Weather provider latency, kept separate from our own response time.',
    labelNames: ['operation'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
    registers: [registry],
  });

  return {
    registry,
    httpRequestDuration,
    cacheEvents,
    upstreamRequests,
    upstreamDuration,
    recordCacheEvent: (event, cacheName) => {
      cacheEvents.inc({ cache: cacheName, event });
    },
  };
}
