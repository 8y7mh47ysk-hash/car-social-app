import type { HealthResponse } from "@apex/shared";
import type { FastifyPluginCallback } from "fastify";

/**
 * GET /health: a smoke check that only proves the process answers HTTP. Instruction 33 adds
 * real health and readiness checks for Postgres, Redis and Ollama.
 */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get("/health", (): HealthResponse => ({ status: "ok" }));
  done();
};
