import { EnvValidationError } from "@apex/shared";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.ts";
import { loadConfig, type ApiConfig } from "./config.ts";
import { LogFormatUnavailableError } from "./lib/logger.ts";

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

/**
 * Builds the app with the configured logging. If the log format cannot be used (pretty output
 * where pino-pretty is not installed), prints why, without a stack trace, and exits with code 1,
 * as loadConfigOrExit does for invalid variables.
 */
async function buildAppOrExit(config: ApiConfig): Promise<FastifyInstance> {
  try {
    return await buildApp({ logLevel: config.logLevel, logFormat: config.logFormat });
  } catch (error) {
    if (!(error instanceof LogFormatUnavailableError)) {
      throw error;
    }
    console.error(error.message);
    process.exit(1);
  }
}

const config = loadConfigOrExit();
const app = await buildAppOrExit(config);

// An uncaught exception, or a promise rejection that nothing handles, still ends the process with
// code 1 as Node.js does by default, but goes through the logger first: one entry (a JSON line
// unless LOG_FORMAT=pretty) with secrets redacted and with the ID of the request whose code
// failed. Node.js's own report is plain text on stderr, unredacted and without the ID.
process.on("uncaughtException", (error, origin) => {
  app.log.fatal({ err: error, origin }, "uncaught exception");
  process.exit(1);
});

/** When the first SIGINT or SIGTERM arrived (performance.now()); undefined until then. */
let firstStopSignalAt: number | undefined;

/**
 * Runs the plugins' start-up work (Fastify's onReady hooks), then listens, unless a stop signal
 * arrived meanwhile. Fastify cannot stop a start that is under way: closing the app during it let
 * the server listen afterwards, and it never exited. So shutDown waits for this to finish, and then
 * closes the app. Rejects with the reason the app could not start.
 */
async function start(): Promise<void> {
  await app.ready();
  if (firstStopSignalAt === undefined) {
    await app.listen({ host: config.host, port: config.port });
  }
}

// Node.js handles signals on the event loop, so the handlers registered below are in place before
// any signal can interrupt the start.
const started = start();

async function shutDown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");

  const forceExit = setTimeout(() => {
    app.log.error("shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await started;
  } catch {
    // The end of this file reports why the app could not start, and exits.
    return;
  }
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
  // The app has closed, so nothing keeps the event loop alive and Node.js exits with code 0.
  clearTimeout(forceExit);
}

function onStopSignal(signal: NodeJS.Signals): void {
  const now = performance.now();
  if (firstStopSignalAt === undefined) {
    firstStopSignalAt = now;
    void shutDown(signal);
  } else if (now - firstStopSignalAt >= REPEATED_SIGNAL_WINDOW_MS) {
    app.log.warn({ signal }, "second signal; exiting without waiting for open requests");
    process.exit(1);
  }
}

// From here on, SIGINT and SIGTERM shut the app down. One that arrives earlier, while the modules
// load and the app is built, ends the process at once, as Node.js does by default: nothing has
// started yet.
process.on("SIGINT", onStopSignal);
process.on("SIGTERM", onStopSignal);

try {
  await started;
} catch (error) {
  app.log.fatal({ err: error }, "failed to start");
  process.exit(1);
}
