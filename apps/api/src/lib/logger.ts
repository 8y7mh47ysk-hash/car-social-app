import { writeSync } from "node:fs";

import {
  LogController,
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  type LogLevel,
} from "fastify";

import { REDACTED, isSensitiveKey, redactUrl, redactUrls } from "./redact.ts";
import { getRequestContext } from "./request-context.ts";
import { REQUEST_ID_HEADER, requestIdFor } from "./request-id.ts";

/**
 * "json" writes one JSON object per line: the format for production and for log tools. "pretty"
 * writes a readable line per entry for a developer's terminal (an error's details and stack
 * follow on the next lines); it needs pino-pretty, a development dependency that production
 * installs leave out.
 */
export const LOG_FORMATS = ["json", "pretty"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/**
 * Thrown when LOG_FORMAT=pretty is asked for but pino-pretty is not installed, as in production
 * installs, which leave development dependencies out. Its message says what to do, so the
 * entrypoint prints only the message, as it does for invalid environment variables. An installed
 * pino-pretty that fails to load throws its own error instead (see importPinoPretty).
 */
export class LogFormatUnavailableError extends Error {
  override readonly name = "LogFormatUnavailableError";
}

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

/** Any other string value in a log line is cut to this many characters (keys are not). */
export const MAX_LOGGED_STRING_LENGTH = 8192;

/** Cuts `text` to `max` characters, saying how much was left out. */
function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}... (${String(text.length - max)} more characters)`
    : text;
}

/**
 * A request URL as it is logged: everything after its first "?" or "#" hidden, because query
 * strings can carry tokens (for example in links from emails), and at most MAX_LOGGED_URL_LENGTH
 * characters, because the client chooses the URL. "/reset?token=abc" becomes "/reset?[Redacted]",
 * whatever characters the query string holds (see redactUrl).
 */
export function loggableUrl(url: string): string {
  return truncate(redactUrl(url), MAX_LOGGED_URL_LENGTH);
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
 * 2. hides URL credentials, query strings and fragments in every string value, the message
 *    included (see redactUrls), and cuts every string value to MAX_LOGGED_STRING_LENGTH
 *    characters. Object keys, and the number of keys and items, are left as they are;
 * 3. adds the ID of the request whose code is running to a line that has none. Lines from
 *    Fastify's per-request loggers (`request.log`) already carry their own request's ID; this
 *    covers every other logger (`app.log` and children made from it), so a service that is never
 *    handed the request still logs its request's ID.
 *
 * Apart from URL parts, a secret inside a string cannot be recognised, so never put one in a log
 * message. Log the fields you need from a client's data, not whole objects whose keys and size
 * the client chooses, such as a parsed query string or body. A line that is not a JSON object
 * (pino never writes one) is replaced by an error line. Parsing turns numbers into JavaScript
 * numbers, so an integer beyond 2^53 (a BigInt, which pino writes exactly) comes out rounded: log
 * such values as strings.
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
 *
 * pino applies it to every value logged under the key `req`, not only to Fastify's requests: also
 * to null, or to an outgoing request's object. So it logs only the fields that are strings and
 * never throws, because a log call that throws fails the request, or stops the API when it runs
 * in a timer or an event handler.
 */
function serializeRequest(value: unknown): {
  method?: string;
  url?: string;
  remoteAddress?: string;
} {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const method = "method" in value ? value.method : undefined;
  const url = "url" in value ? value.url : undefined;
  const ip = "ip" in value ? value.ip : undefined;
  return {
    ...(typeof method === "string" ? { method } : {}),
    ...(typeof url === "string" ? { url: loggableUrl(url) } : {}),
    ...(typeof ip === "string" ? { remoteAddress: ip } : {}),
  };
}

/**
 * The codes of the errors with which Fastify's router rejects a URL (see sendFrameworkError), and
 * the message logged for each instead of the error's own.
 */
const ROUTER_ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["FST_ERR_BAD_URL", "malformed URL"],
  ["FST_ERR_MAX_PARAM_LENGTH", "route parameter too long"],
]);

/**
 * Two of Fastify's lines repeat the raw URL, where finishLogLine would hide the query string but
 * cut the path only at MAX_LOGGED_STRING_LENGTH characters: the 404 line ("Route GET:<url> not
 * found") and the error line for a URL that the router rejects, which holds the path three times
 * (the message, err.message and err.stack), about 25 KB for a malformed 16 KB URL. These versions
 * leave the URL out: the "incoming request" line with the same request ID already records the
 * method and the shortened URL. Every other error is logged as Fastify logs it.
 */
class ApiLogController extends LogController {
  override routeNotFound(request: FastifyRequest): void {
    if (!this.isLogDisabled(request)) {
      request.log.info("route not found");
    }
  }

  override defaultErrorLog(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
    metadata?: Record<string, unknown>,
  ): void {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    const message = ROUTER_ERROR_MESSAGES.get(code);
    if (message === undefined) {
      super.defaultErrorLog(error, request, reply, metadata);
    } else if (!this.isLogDisabled(request)) {
      reply.log.info({ res: reply, err: { type: error.name, code } }, message);
    }
  }
}

/**
 * Fastify's router rejects a malformed URL (400) or an over-long route parameter (414) before any
 * hook runs, so enterRequestContext never sees those requests. Fastify hands them here with a
 * request ID from genReqId, having logged "incoming request" under it; this sends the ID back and
 * replies with the error as usual, which Fastify's error handler logs under the same ID (without
 * the URL: see ApiLogController).
 *
 * That error handler is always Fastify's default: these requests belong to a router context that
 * Fastify creates with the app, before `setErrorHandler` can run. The global error handler of
 * instruction 27 must therefore give these responses its error format here as well.
 */
function sendFrameworkError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  void reply.header(REQUEST_ID_HEADER, request.id).send(error);
}

/**
 * Loads pino-pretty. Only a pino-pretty that Node.js cannot find at all becomes a
 * LogFormatUnavailableError. Any other failure to load it, such as a broken install in which one
 * of its own dependencies is missing, is thrown as it is, so its real cause is printed instead of
 * advice about production installs.
 */
async function importPinoPretty() {
  try {
    import.meta.resolve("pino-pretty");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      throw new LogFormatUnavailableError(
        "LOG_FORMAT=pretty needs pino-pretty, a development dependency that production installs " +
          "leave out. Use LOG_FORMAT=json.",
        { cause: error },
      );
    }
    throw error;
  }
  return import("pino-pretty");
}

/** Memory for Atomics.wait, which pauses the thread without returning to the event loop. */
const pauseCell = new Int32Array(new SharedArrayBuffer(4));

/**
 * Writes all of `text` to the file descriptor `fd` before it returns. process.stdout.write()
 * only queues what a full pipe cannot take yet (on macOS, and `pnpm dev` reads the API's output
 * through a pipe), and the process.exit() with which the entrypoint stops after logging a crash
 * drops that queue, crash line included. So while the pipe is full this waits for its reader, as
 * pino's own destination (used for JSON) does when it flushes at exit. Once the reader has gone
 * (EPIPE) the text is dropped, as pino drops it.
 */
function writeAll(fd: number, text: string): void {
  let rest = Buffer.from(text);
  while (rest.length > 0) {
    try {
      rest = rest.subarray(writeSync(fd, rest));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "EPIPE") {
        return;
      }
      if (code !== "EAGAIN") {
        throw error;
      }
      Atomics.wait(pauseCell, 0, 0, 10);
    }
  }
}

/**
 * Formats lines with pino-pretty's synchronous formatter, after finishLogLine has redacted them.
 * Each log call then writes its formatted line straight to the destination, as in the JSON
 * format: no worker thread (pino-pretty's transport API runs one) and no extra stream pipeline
 * (its stream API builds one). Standard output is written synchronously (see writeAll), so no
 * line is lost when the process exits. pino-pretty is imported only here, so the JSON format
 * never loads it.
 */
async function prettyDestination(destination: LogDestination | undefined): Promise<LogDestination> {
  const pinoPretty = await importPinoPretty();
  const target: LogDestination = destination ?? {
    write(text) {
      writeAll(process.stdout.fd, text);
    },
  };
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
 * The Fastify factory options that set up logging and request IDs: pino writes one JSON object
 * (or one readable entry) per line, which finishLogLine redacts; genReqId gives each request that
 * reaches Fastify's router a validated or new ID, which every line logged while the request is
 * handled carries; and sendFrameworkError sends that ID in x-request-id with the router's 400 and
 * 414 responses. `buildApp` passes these to `fastify()` and registers enterRequestContext, which
 * sends the ID with the response of every request that reaches the hooks. The other responses
 * that go out before any hook runs carry no ID: docs/ARCHITECTURE.md ("Observability") lists them.
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
    frameworkErrors: sendFrameworkError,
  };
}
