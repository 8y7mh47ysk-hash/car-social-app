import { z } from "zod";

/**
 * Body of the API's GET /health smoke route. Instruction 33 replaces the route with real
 * health and readiness checks for Postgres, Redis and Ollama.
 */
export const healthResponseSchema = z.strictObject({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
