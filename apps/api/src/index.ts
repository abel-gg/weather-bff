import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * Process entrypoint: configuration, listen, and an orderly shutdown.
 *
 * Graceful shutdown matters more than it looks in a rolling deploy. Without it,
 * every release drops the requests that were in flight when the old container
 * got its SIGTERM — a small, constant error rate that only ever appears during
 * deploys and is miserable to diagnose after the fact.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { app, service } = await buildServer({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    try {
      // Stop accepting connections and let in-flight requests finish...
      await app.close();
      // ...then let background revalidations settle so nothing is killed mid-write.
      await service.drain();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Failed to shut down cleanly');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  // Nothing is listening yet, so there is no logger to use and no point
  // pretending the process can continue.
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
