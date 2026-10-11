import { fastify, type FastifyInstance, type FastifyServerOptions } from "fastify";

import { healthRoutes } from "./routes/health.ts";

export interface BuildAppOptions {
  /**
   * Fastify's logger setting. Defaults to false so tests stay quiet; the server entrypoint
   * turns logging on. Instruction 8 replaces this with structured pino logging.
   */
  readonly logger?: FastifyServerOptions["logger"];
}

/**
 * Creates the Fastify application without starting it. The server entrypoint listens on it;
 * tests call `app.inject()` instead, so no port is needed.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });

  await app.register(healthRoutes);

  return app;
}
