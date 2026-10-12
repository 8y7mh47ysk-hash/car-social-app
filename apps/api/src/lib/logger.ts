import {
  LogController,
  type FastifyRequest,
  type FastifyServerOptions,
  type LogLevel,
} from "fastify";

import { REDACTED, isSensitiveKey, redactUrls } from "./redact.ts";
import { getRequestContext } from "./request-context.ts";
import { requestIdFor } from "./request-id.ts";

/**
 * "json" writes one JSON object per line: the format for production and for log tools. "pretty"
 * writes readable single lines for a developer's terminal; it needs pino-pretty, a development
 * dependency that production installs leave out.
 */
export const LOG_FORMATS = ["json", "pretty"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Somewhere log lines can go, one line per call. Tests pass an in-memory sink. */
export interface LogDestination {
  write(line: string): void;
}

export interface LoggingSettings {
  /** The lowest level that is written; "silent" writes nothing. */
  readonly level: LogLevel;
  readonly format: LogFormat;
  /** Where lines go. Defaults to standard output. */
  readonly destination?: LogDestination | undefined;
}

/** The log field that holds the request ID (Fastify's default name, set explicitly). */
const REQUEST_ID_LOG_KEY = "reqId";

/** Request URLs are logged with at most this many characters. */
export const MAX_LOGGED_URL_LENGTH = 256;

/** Any other string in a log line is cut to this many characters. */
export const MAX_LOGGED_STRING_LENGTH = 8192;

/** Cuts `text` to `max` characters, saying how much was left out. */
function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}... (${String(text.length - max)} more characters)`
    : text;
}

/**
 * A request URL as it is logged: the query string and fragment hidden, because they can carry
 * tokens (for example in links from emails), and at most MAX_LOGGED_URL_LENGTH characters, because
 * the client chooses the URL. "/reset?token=abc" becomes "/reset?[Redacted]".
 */
export function loggableUrl(url: string): string {
  return truncate(redactUrls(url), MAX_LOGGED_URL_LENGTH);
}

/** A JSON.parse reviver: called for every key and value, innermost first. */
function sanitizeJsonValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  return typeof value === "string" ? truncate(redactUrls(value), MAX_LOGGED_STRING_LENGTH) : value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Written instead of a line that is not a JSON object, so nothing unredacted gets through. */
function droppedLine(): string {
  const entry = {
    level: 50,
    time: new Date().toISOString(),
    msg: "log line dropped: not a JSON object",
  };
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Finishes each line just before pino writes it (pino's streamWrite hook), so it sees exactly
 * what would be written: serialized errors, child logger bindings and class instances as well as
 * plain objects, from our code and from Fastify's. It:
 *
 * 1. replaces the value of every sensitive key, at any depth, with "[Redacted]", even when the
 *    value is an object or an array (see isSensitiveKey);
 * 2. hides URL credentials, query strings and fragments in every string, the message included
 *    (see redactUrls), and cuts every string to MAX_LOGGED_STRING_LENGTH characters;
 * 3. adds the ID of the request whose code is running to a line that has none. Lines from
 *    Fastify's per-request loggers (`request.log`) already carry their own request's ID; this
 *    covers every other logger (`app.log` and children made from it), so a service that is never
 *    handed the request still logs its request's ID.
 *
 * Apart from URL parts, a secret inside a string cannot be recognised, so never put one in a log
 * message. A line that is not a JSON object (pino never writes one) is replaced by an error line.
 */
export function finishLogLine(line: string): string {
  let entry: unknown;
  try {
    entry = JSON.parse(line, sanitizeJsonValue);
  } catch {
    return droppedLine();
  }
  if (!isJsonObject(entry)) {
    return droppedLine();
  }
  const context = getRequestContext();
  if (context !== undefined && entry[REQUEST_ID_LOG_KEY] === undefined) {
    entry[REQUEST_ID_LOG_KEY] = context.requestId;
  }
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Replaces Fastify's default `req` serializer, which logs the full URL (query string included),
 * the client-supplied Host and Accept-Version headers and the client's port. Headers and bodies
 * are never logged. `remoteAddress` is the direct peer; behind a proxy it is the proxy until
 * trusted proxies are configured.
 */
function serializeRequest(request: FastifyRequest) {
  return { method: request.method, url: loggableUrl(request.url), remoteAddress: request.ip };
}

/**
 * Fastify's 404 line repeats the raw URL in its message, where finishLogLine would hide the query
 * string but cut the path only at MAX_LOGGED_STRING_LENGTH characters. This line leaves the URL
 * out: the "incoming request" line with the same request ID already records the method and the
 * shortened URL.
 */
class ApiLogController extends LogController {
  override routeNotFound(request: FastifyRequest): void {
    if (!this.isLogDisabled(request)) {
      request.log.info("route not found");
    }
  }
}

/**
 * Formats lines with pino-pretty's synchronous formatter, after finishLogLine has redacted them.
 * Each log call then writes its line straight away, exactly as in the JSON format, with no extra
 * stream or worker thread (pino-pretty's stream and transport APIs add one), and tests can read
 * the output as soon as a request ends. pino-pretty is imported only here, so the JSON format
 * never loads it.
 */
async function prettyDestination(destination: LogDestination | undefined): Promise<LogDestination> {
  const pinoPretty = await import("pino-pretty").catch((error: unknown) => {
    throw new Error(
      "LOG_FORMAT=pretty needs pino-pretty, a development dependency that production installs " +
        "leave out. Use LOG_FORMAT=json.",
      { cause: error },
    );
  });
  const target: LogDestination = destination ?? process.stdout;
  const prettify = pinoPretty.prettyFactory({
    // Colour only on a terminal, never in output that tests or files read back.
    colorize: destination === undefined && pinoPretty.isColorSupported,
    translateTime: "SYS:HH:MM:ss.l",
    ignore: "pid,hostname",
    singleLine: true,
  });
  return {
    write(line) {
      target.write(prettify(line));
    },
  };
}

/**
 * The Fastify factory options that set up logging and request IDs: pino writing one JSON object
 * (or one pretty line) per entry; a request ID that is validated or generated for every request
 * and appears on every line logged while that request is handled; and no secrets, query strings
 * or unbounded client input in the output. `buildApp` passes these to `fastify()`.
 */
export async function loggingServerOptions(
  settings: LoggingSettings,
): Promise<FastifyServerOptions> {
  const destination =
    settings.format === "pretty"
      ? await prettyDestination(settings.destination)
      : settings.destination;
  return {
    logger: {
      level: settings.level,
      ...(destination === undefined ? {} : { stream: destination }),
      // ISO 8601 in UTC ("2026-10-11T09:30:00.000Z") instead of pino's epoch milliseconds, so the
      // owner can read `docker compose logs` directly. pino's stdTimeFunctions.isoTime does the
      // same, but pino is Fastify's dependency, not ours.
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      serializers: { req: serializeRequest },
      hooks: { streamWrite: finishLogLine },
    },
    // Fastify's own requestIdHeader option trusts any value; requestIdFor validates it.
    requestIdHeader: false,
    genReqId: (request) => requestIdFor(request.headers),
    logController: new ApiLogController({ requestIdLogLabel: REQUEST_ID_LOG_KEY }),
  };
}
