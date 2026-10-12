import { parseEnv, type EnvSource, type ParseEnvOptions } from "@apex/shared";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { z } from "zod";

/**
 * Variables that only the web server reads, such as secrets and internal URLs. Their names must
 * not start with NEXT_PUBLIC_. Code reads them through `serverEnv` (./server.ts), which a Client
 * Component cannot import.
 *
 * The web app reads none yet. Add each one with a test, and document it in apps/web/.env.example.
 */
export const serverEnvSchema = z.object({});

/**
 * Variables the browser may see. When Next.js compiles the app (`next dev`, `next build`), it
 * copies their values into the JavaScript it sends to every visitor, so they must never hold a
 * secret, and a changed value needs a new build. Their names must start with NEXT_PUBLIC_ (the
 * `satisfies` type below rejects any other name). Code reads them through `publicEnv`
 * (./public.ts).
 *
 * The web app reads none yet. Add each one with a test, and document it in apps/web/.env.example.
 */
export const publicEnvSchema = z.object({} satisfies Record<`NEXT_PUBLIC_${string}`, z.ZodType>);

/** How the web app's environment errors name the app and say where to fix them. */
export const webEnvMessages: ParseEnvOptions = {
  app: "the web app",
  hint: "Set them in apps/web/.env (see apps/web/.env.example) or in the environment.",
};

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
