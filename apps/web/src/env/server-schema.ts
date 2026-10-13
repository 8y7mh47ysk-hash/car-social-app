import { z } from "zod";

/**
 * Variables that only the web server reads, such as secrets and internal URLs. Their names must
 * not start with NEXT_PUBLIC_. Code reads them through `getServerEnv()` (./server.ts), which a
 * Client Component cannot import.
 *
 * The schema itself (names, rules and defaults) must not reach the browser either, so only
 * ./server.ts and ./validate.ts may import this module. It cannot import "server-only" to enforce
 * that, because next.config.ts loads it outside React Server Components; public.test.ts checks
 * instead that browser code never loads it.
 *
 * The web app reads none yet. Add each one with a test, and document it in apps/web/.env.example.
 */
export const serverEnvSchema = z.object({});
