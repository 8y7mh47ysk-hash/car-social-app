import { buildApp } from "./app.ts";
import { loadServerConfig } from "./config.ts";

/** How long in-flight requests get to finish after SIGINT/SIGTERM before the process exits. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadServerConfig(process.env);
// Info level, as before instruction 8; the typed environment loader (instruction 4) supplies
// LOG_LEVEL.
const app = await buildApp({ logLevel: "info" });

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

// `once`: a second Ctrl+C falls through to Node's default handler and exits immediately.
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "failed to start");
  process.exit(1);
}
