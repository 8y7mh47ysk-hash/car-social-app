import type { ParseEnvOptions } from "@apex/shared";
import { z } from "zod";

// Browser code loads this module through ./public.ts, so everything it builds or imports is sent
// to every visitor. It must never import ./server-schema.ts or ./validate.ts, which would add the
// server variables' names, rules and defaults to the bundle (public.test.ts checks this).

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

/**
 * How the web app's environment errors name the app and say where to fix them. Browser code
 * needs it too, and it holds nothing secret.
 */
export const webEnvMessages: ParseEnvOptions = {
  app: "the web app",
  hint: "Set them in apps/web/.env (see apps/web/.env.example) or in the environment, which overrides the .env files.",
};
