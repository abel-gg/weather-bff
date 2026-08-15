import { AppError } from '../errors.js';
import type { Metrics } from '../observability/metrics.js';
import type { WeatherProvider } from './open-meteo.js';

/**
 * Wraps a provider in metrics without the provider knowing.
 *
 * Instrumentation as a decorator rather than calls sprinkled through the
 * adapter: the Open-Meteo client stays a pure translation layer, and this
 * measures *upstream* time specifically — which is the number that tells you
 * whether a latency spike is the provider's fault or ours. A single blended
 * "request duration" cannot answer that question, and answering it at 3am is
 * the entire point of having the metric.
 */
export function withMetrics(provider: WeatherProvider, metrics: Metrics): WeatherProvider {
  async function track<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const stopTimer = metrics.upstreamDuration.startTimer({ operation });
    try {
      const result = await run();
      metrics.upstreamRequests.inc({ operation, outcome: 'success' });
      return result;
    } catch (error) {
      // Labelled by our own error codes, which are a closed set — so this
      // label can never blow up Prometheus cardinality.
      metrics.upstreamRequests.inc({
        operation,
        outcome: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
      });
      throw error;
    } finally {
      stopTimer();
    }
  }

  return {
    fetchWeather: (coordinates) => track('forecast', () => provider.fetchWeather(coordinates)),
    searchLocations: (query, limit) =>
      track('geocoding', () => provider.searchLocations(query, limit)),
  };
}
