import { z } from "zod";

import { LOG_FORMATS, type LogFormat } from "./lib/logger.ts";

// Instruction 4 replaces this with the full typed environment loader. Until then the API only
// needs to know where to listen, so parallel checkouts can run on different ports, and how to
// format its logs.
const serverEnvSchema = z.object({
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: z
    .string()
    .regex(/^\d{1,5}$/, "must be a port number from 0 to 65535")
    .transform(Number)
    .pipe(z.number().max(65_535, "must be a port number from 0 to 65535"))
    .default(4000),
  LOG_FORMAT: z
    .enum(LOG_FORMATS, { error: `must be one of ${LOG_FORMATS.join(", ")}` })
    .default("json"),
});

export interface ServerConfig {
  /** Interface to bind. Defaults to loopback so the API is never exposed by accident. */
  readonly host: string;
  /** TCP port. 0 asks the OS for a free port (used by tests). */
  readonly port: number;
  /** "json" (the default) for production and log tools, "pretty" for a developer's terminal. */
  readonly logFormat: LogFormat;
}

/** Reads the server settings from environment variables; throws if a value is invalid. */
export function loadServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(result.error)}`);
  }
  return {
    host: result.data.API_HOST,
    port: result.data.API_PORT,
    logFormat: result.data.LOG_FORMAT,
  };
}
