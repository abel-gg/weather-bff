import cors from '@fastify/cors';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import { AppError, ValidationError, toErrorResponse } from './errors.js';
import { createMetrics, type Metrics } from './observability/metrics.js';
import { redactCoordinatesInUrl } from './observability/redact.js';
import { registerLocationRoutes } from './routes/locations.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerWeatherRoutes } from './routes/weather.js';
import { createWeatherService, type WeatherService } from './services/weather-service.js';
import { withMetrics } from './upstream/instrumented.js';
import { createOpenMeteoProvider, type WeatherProvider } from './upstream/open-meteo.js';

export interface BuildServerOptions {
  config: AppConfig;
  /** Injected by the integration tests so no network is touched. */
  provider?: WeatherProvider;
  metrics?: Metrics;
  /** Set false in tests to keep the output readable. */
  logging?: boolean;
  now?: () => number;
}

export interface BuiltServer {
  app: FastifyInstance;
  service: WeatherService;
  metrics: Metrics;
}

export async function buildServer(options: BuildServerOptions): Promise<BuiltServer> {
  const { config } = options;
  const metrics = options.metrics ?? createMetrics({ collectDefault: options.logging !== false });

  const app = Fastify({
    // Behind a load balancer, the client IP lives in X-Forwarded-For. Without
    // this every request appears to come from the balancer.
    trustProxy: true,
    // Honour an inbound request id so a trace started at the edge survives
    // across service hops; generate one when we are the entry point.
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : randomUUID();
    },
    logger: options.logging === false
      ? false
      : {
          level: config.logLevel,
          serializers: {
            req: (request: FastifyRequest) => ({
              method: request.method,
              // Coordinates are personal data; they never reach a log line at
              // full precision. See observability/redact.ts.
              url: redactCoordinatesInUrl(request.url),
              remoteAddress: request.ip,
            }),
          },
        },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET'],
  });

  const provider = withMetrics(
    options.provider ?? createOpenMeteoProvider(config.upstream),
    metrics,
  );

  const service = createWeatherService({
    provider,
    config,
    metrics,
    logger: app.log,
    ...(options.now ? { now: options.now } : {}),
  });

  // Every response carries its request id, so a user can quote the one number
  // that finds the exact log line for their failure.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    metrics.httpRequestDuration.observe(
      {
        method: request.method,
        // The route *pattern*, never the URL. `/api/weather` is one time
        // series; `/api/weather?latitude=36.72...` would be a new series per
        // user and would take the Prometheus server down long before traffic
        // took us down.
        route: request.routeOptions.url ?? 'unmatched',
        status_code: reply.statusCode,
      },
      reply.elapsedTime / 1000,
    );
  });

  registerWeatherRoutes(app, service, config);
  registerLocationRoutes(app, service, config);
  registerSystemRoutes(app, service, metrics);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} does not exist.`,
        requestId: request.id,
      },
    });
  });

  /**
   * One place decides how a failure becomes a response.
   *
   * Two rules: the client always receives the same envelope, and an unexpected
   * error never leaks its message. A stack trace or a database string in a 500
   * body is an information disclosure bug, so internals go to the log and the
   * client gets a request id to quote.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      const failure = new ValidationError(error.message);
      request.log.info({ err: error.message }, 'Rejected a malformed request');
      reply.status(failure.statusCode).send(toErrorResponse(failure, request.id));
      return;
    }

    if (error instanceof AppError) {
      // Expected failures are warnings, not errors: they are the system
      // behaving as designed. Keeping them out of the error stream is what
      // makes the error stream worth alerting on.
      request.log.warn(
        { err: error.message, code: error.code },
        'Request failed with a known condition',
      );
      if (error.retryable) reply.header('retry-after', '30');
      reply.status(error.statusCode).send(toErrorResponse(error, request.id));
      return;
    }

    request.log.error({ err: error }, 'Unhandled error while serving a request');
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        requestId: request.id,
      },
    });
  });

  return { app, service, metrics };
}
