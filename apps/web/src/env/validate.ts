import { EnvValidationError, parseEnv, type EnvIssue, type EnvSource } from "@apex/shared";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import type { z } from "zod";

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
  const groups = [...(compiles ? [schemas.public] : []), ...(serves ? [schemas.server] : [])];
  // Each group is checked with its own schema, as publicEnv and getServerEnv check it, so a rule
  // about several of its variables (a refine on the whole object) is checked here too. The
  // problems of both groups go into one error.
  const issues = groups.flatMap((schema): readonly EnvIssue[] => {
    try {
      parseEnv(schema, source, webEnvMessages);
      return [];
    } catch (error) {
      if (error instanceof EnvValidationError) {
        return error.issues;
      }
      throw error;
    }
  });
  if (issues.length > 0) {
    throw new EnvValidationError(webEnvMessages, issues);
  }
}
