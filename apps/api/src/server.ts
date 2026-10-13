import { EnvValidationError } from "@apex/shared";

import { buildApp } from "./app.ts";
import { loadConfig, type ApiConfig } from "./config.ts";

/** How long in-flight requests get to finish after SIGINT/SIGTERM before the process exits. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * A stop signal this soon after the first is the same request to stop, delivered twice: in
 * `pnpm dev`, Ctrl+C reaches both `node --watch` and this process, and `node --watch` passes it
 * on. A later one is a second Ctrl+C, which stops the process without waiting.
 */
const REPEATED_SIGNAL_WINDOW_MS = 1000;

/**
 * Reads the settings from the environment, which only this entrypoint touches. If a variable is
 * missing or invalid, prints every problem (never a value) and exits with code 1 before anything
 * starts. The message goes straight to stderr because the logger is configured from these
 * settings.
 */
function loadConfigOrExit(): ApiConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) {
      throw error;
    }
    console.error(error.message);
    process.exit(1);
  }
}

const config = loadConfigOrExit();
const app = await buildApp({ logLevel: config.logLevel, logFormat: config.logFormat });

function shutDown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, "shutting down");

  const forceExit = setTimeout(() => {
    app.log.error("shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Once the server has closed, nothing keeps the event loop alive and Node exits with code 0.
  app.close().then(
    () => {
      clearTimeout(forceExit);
    },
    (error: unknown) => {
      app.log.error({ err: error }, "shutdown failed");
      process.exit(1);
    },
  );
}

/** When the first SIGINT or SIGTERM arrived (performance.now()); undefined until then. */
let firstStopSignalAt: number | undefined;

function onStopSignal(signal: NodeJS.Signals): void {
  const now = performance.now();
  if (firstStopSignalAt === undefined) {
    firstStopSignalAt = now;
    shutDown(signal);
  } else if (now - firstStopSignalAt >= REPEATED_SIGNAL_WINDOW_MS) {
    app.log.warn({ signal }, "second signal; exiting without waiting for open requests");
    process.exit(1);
  }
}

process.on("SIGINT", onStopSignal);
process.on("SIGTERM", onStopSignal);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "failed to start");
  process.exit(1);
}
