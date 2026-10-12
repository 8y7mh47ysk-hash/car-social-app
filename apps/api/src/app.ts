import { fastify, type FastifyInstance, type LogLevel } from "fastify";

import { loggingServerOptions, type LogDestination } from "./lib/logger.ts";
import { enterRequestContext } from "./lib/request-context.ts";
import { healthRoutes } from "./routes/health.ts";

export interface BuildAppOptions {
  /**
   * The lowest level that is logged. The server entrypoint passes the configured level; the
   * default, "silent", keeps tests quiet unless they ask for logs.
   */
  readonly logLevel?: LogLevel;
  /** Where log lines go instead of standard output. Tests pass a sink and read the lines back. */
  readonly logDestination?: LogDestination;
}

/**
 * Creates the Fastify application without starting it. The server entrypoint listens on it;
 * tests call `app.inject()` instead, so no port is needed.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = fastify(
    loggingServerOptions({
      level: options.logLevel ?? "silent",
      destination: options.logDestination,
    }),
  );

  // Keep this the first onRequest hook: everything after it runs inside the request's context,
  // which is how log lines from code that never sees the request get its ID.
  app.addHook("onRequest", enterRequestContext);

  await app.register(healthRoutes);

  return app;
}
