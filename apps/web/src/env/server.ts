// Marks this module as server-only: if a Client Component imports it, directly or through other
// modules, `next build` and `next dev` fail with an error that names the import chain, so server
// values can never be bundled for the browser. Outside Next.js (Vitest, for example), importing
// it throws.
import "server-only";

import { parseEnv } from "@apex/shared";

import { serverEnvSchema, webEnvMessages } from "./schema";

/**
 * The web server's settings, validated. Server Components, Route Handlers and Server Actions read
 * environment variables only through this.
 */
export const serverEnv = parseEnv(serverEnvSchema, process.env, webEnvMessages);
