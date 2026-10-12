import { parseEnv } from "@apex/shared";
import type { z } from "zod";

import { publicEnvSchema, webEnvMessages } from "./schema";

/**
 * Every public variable, read by its full name. Next.js copies a value into browser code only
 * where the code names the variable literally, so reading through a variable name or a
 * destructured `process.env` gives undefined in the browser. Use brackets, which TypeScript
 * requires for process.env (noPropertyAccessFromIndexSignature) and which Next.js 16 also
 * replaces. The `satisfies` type fails until each variable in publicEnvSchema is listed here,
 * for example:
 *
 *   NEXT_PUBLIC_API_URL: process.env["NEXT_PUBLIC_API_URL"],
 */
const source = {} satisfies {
  readonly [Name in keyof z.input<typeof publicEnvSchema>]-?: string | undefined;
};

/** Settings the browser may see (NEXT_PUBLIC_ variables), validated. Safe in any component. */
export const publicEnv = parseEnv(publicEnvSchema, source, webEnvMessages);
