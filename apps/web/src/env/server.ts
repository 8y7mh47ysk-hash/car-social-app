// Marks this module as server-only: if a Client Component imports it, directly or through other
// modules, `next build` and `next dev` fail with an error that names the import chain, so server
// values can never be bundled for the browser. Outside Next.js (Vitest, for example), importing
// it throws.
import "server-only";

import { parseEnv } from "@apex/shared";
import type { z } from "zod";

import { webEnvMessages } from "./public-schema";
import { serverEnvSchema } from "./server-schema";

/** The web server's settings. */
export type ServerEnv = z.output<typeof serverEnvSchema>;

/**
 * Returns the web server's settings, validated. Server Components, Route Handlers and Server
 * Actions read environment variables only through this.
 *
 * It reads them when it is called, not when this module loads: `next build` loads the modules of
 * every route while it collects page data, so reading them on load would make every build need
 * the server's secrets, even for routes that only run on request. A page that `next build`
 * prerenders and that calls this still needs them at build time. `next dev` and `next start`
 * check these variables as they start (see next.config.ts), so a missing one stops the server
 * before it serves a request.
 *
 * @throws {EnvValidationError} if a variable is missing or invalid; it never shows a value.
 */
export function getServerEnv(): ServerEnv {
  return parseEnv(serverEnvSchema, process.env, webEnvMessages);
}
