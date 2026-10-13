import { parseEnv, type EnvSource } from "@apex/shared";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { z } from "zod";

import { publicEnvSchema, webEnvMessages } from "./public-schema";
import { serverEnvSchema } from "./server-schema";

/** The two groups of variables that validateWebEnv checks. */
export interface WebEnvSchemas {
  readonly server: z.ZodObject;
  readonly public: z.ZodObject;
}

/**
 * Checks the variables that a Next.js phase depends on. Throws an EnvValidationError that names
 * every missing or invalid variable, never its value. next.config.ts calls this whenever Next.js
 * loads its config, so `next dev`, `next build` and `next start` stop before they use a bad value.
 *
 * - Public variables are checked when Next.js compiles the app (`next dev`, `next build`),
 *   because that is when it copies them into the bundles. `next start` serves bundles that already
 *   hold the values from the build, so it does not check them. `next typegen`, which
 *   `pnpm typecheck` runs, loads the config as a build does, so it checks them too.
 * - Server variables are checked when a server starts (`next dev`, `next start`). A production
 *   build does not check them, so it can run without the server's secrets, for example when a
 *   Docker image is built. A page that reads one while it is prerendered still fails the build.
 * - Other phases (`next info`, for example) check nothing.
 *
 * `schemas` exists for the tests: the app's own schemas are the default.
 *
 * @throws {EnvValidationError} if a variable is missing or invalid.
 */
export function validateWebEnv(
  phase: string,
  source: EnvSource,
  schemas: WebEnvSchemas = { server: serverEnvSchema, public: publicEnvSchema },
): void {
  const compiles = phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD;
  const serves = phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER;
  // One schema, so a single error lists every problem.
  const schema = z.object({
    ...(compiles ? schemas.public.shape : {}),
    ...(serves ? schemas.server.shape : {}),
  });
  parseEnv(schema, source, webEnvMessages);
}
