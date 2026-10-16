import { envHostSchema, envPortSchema, parseEnv, type EnvSource } from "@apex/shared";
import type { LogLevel } from "fastify";
import { z } from "zod";

import { LOG_FORMATS, type LogFormat } from "./lib/logger.ts";

/** The log levels pino understands, from most to least severe; "silent" turns logging off. */
const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const satisfies readonly LogLevel[];

/**
 * Every environment variable the API reads. Each one has a safe default today; the first
 * variable without one (for example the database URL in Phase 2) makes startup fail until it
 * is set. Document every variable in apps/api/.env.example (config.test.ts checks that).
 */
export const apiEnvSchema = z.object({
  API_HOST: envHostSchema.default("127.0.0.1"),
  API_PORT: envPortSchema.default(4000),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` })
    .default("info"),
  LOG_FORMAT: z
    .enum(LOG_FORMATS, { error: `must be one of ${LOG_FORMATS.join(", ")}` })
    .default("json"),
});

/** The API's settings, validated. The entrypoint reads them once, at startup. */
export interface ApiConfig {
  /** Interface to listen on. Defaults to loopback so the API is never exposed by accident. */
  readonly host: string;
  /** TCP port. 0 asks the operating system for a free port (used by tests). */
  readonly port: number;
  /** The lowest log level written. */
  readonly logLevel: LogLevel;
  /** "json" (the default) for production and log tools, "pretty" for a developer's terminal. */
  readonly logFormat: LogFormat;
}

/**
 * Reads the API's settings from environment variables, such as `process.env`.
 *
 * @throws {EnvValidationError} naming every missing or invalid variable, never their values.
 */
export function loadConfig(env: EnvSource): ApiConfig {
  const values = parseEnv(apiEnvSchema, env, {
    app: "the API",
    hint: "Set them in apps/api/.env (see apps/api/.env.example) or in the environment, which overrides the file.",
  });
  return {
    host: values.API_HOST,
    port: values.API_PORT,
    logLevel: values.LOG_LEVEL,
    logFormat: values.LOG_FORMAT,
  };
}
