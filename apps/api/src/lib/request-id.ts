import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { z } from "zod";

/** The header that carries a request's ID: read from requests and sent back in responses. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * An incoming request ID is reused only if it is 8 to 64 characters from A-Z, a-z, 0-9, "-" and
 * "_". That covers UUIDs, ULIDs, nanoids and the hex IDs that proxies generate. It keeps out
 * spaces, commas (Node.js joins repeated headers with ", "), quotes, control characters,
 * non-ASCII text and oversized values, so an ID is always safe to log and to echo in a header.
 */
const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/**
 * Returns the ID for an incoming request: its x-request-id header if that is well formed,
 * otherwise a new random UUID. Clients choose their own IDs, so an ID is only a label for
 * finding log lines: never use it for authorisation, rate limiting or idempotency.
 */
export function requestIdFor(headers: IncomingHttpHeaders): string {
  const incoming = requestIdSchema.safeParse(headers[REQUEST_ID_HEADER]);
  return incoming.success ? incoming.data : randomUUID();
}
