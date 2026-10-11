import { z } from "zod";

// Instruction 4 replaces this with the full typed environment loader. Until then the API only
// needs to know where to listen, so parallel checkouts can run on different ports.
const serverEnvSchema = z.object({
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: z
    .string()
    .regex(/^\d{1,5}$/, "must be a port number from 0 to 65535")
    .transform(Number)
    .pipe(z.number().max(65_535, "must be a port number from 0 to 65535"))
    .default(4000),
});

export interface ServerConfig {
  /** Interface to bind. Defaults to loopback so the API is never exposed by accident. */
  readonly host: string;
  /** TCP port. 0 asks the OS for a free port (used by tests). */
  readonly port: number;
}

/** Reads the listen address from environment variables; throws if a value is invalid. */
export function loadServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(result.error)}`);
  }
  return { host: result.data.API_HOST, port: result.data.API_PORT };
}
