import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  MAX_LOGGED_STRING_LENGTH,
  MAX_LOGGED_URL_LENGTH,
  finishLogLine,
  loggableUrl,
} from "./logger.ts";
import { REDACTED } from "./redact.ts";
import { runWithRequestContext } from "./request-context.ts";

/** Runs one entry through finishLogLine, checks it is still exactly one line, and parses it. */
function finish(entry: unknown): unknown {
  const output = finishLogLine(`${JSON.stringify(entry)}\n`);
  expect(output.indexOf("\n")).toBe(output.length - 1);
  return JSON.parse(output);
}

describe("finishLogLine", () => {
  it("leaves a line without secrets as it is", () => {
    const entry = {
      level: 30,
      time: "2026-10-11T09:30:00.000Z",
      component: "garage-service",
      car: { id: 7, make: "Mazda", tags: ["track", "daily"] },
      msg: "car saved",
    };

    expect(finish(entry)).toEqual(entry);
  });

  it("replaces sensitive values at any depth, inside arrays too", () => {
    const entry = {
      msg: "user loaded",
      user: { email: "driver@example.com", password: "hunter2" },
      sessions: [{ id: 1, refreshToken: "rt-1" }, { id: 2 }],
      err: { type: "Error", config: { headers: { Authorization: "Bearer abc" } } },
      headers: { "user-agent": "curl/8", cookie: "session=abc", "set-cookie": ["a=1", "b=2"] },
    };

    expect(finish(entry)).toEqual({
      msg: "user loaded",
      user: { email: "driver@example.com", password: REDACTED },
      sessions: [{ id: 1, refreshToken: REDACTED }, { id: 2 }],
      err: { type: "Error", config: { headers: { Authorization: REDACTED } } },
      headers: { "user-agent": "curl/8", cookie: REDACTED, "set-cookie": REDACTED },
    });
  });

  it("replaces the whole value of a sensitive key, even an object or an array", () => {
    const entry = { auth: { username: "owner", pass: "hunter2" }, recoveryCodes: ["a", "b"] };

    expect(finish(entry)).toEqual({ auth: REDACTED, recoveryCodes: REDACTED });
  });

  it("hides URL credentials and query strings in every string, the message included", () => {
    const entry = {
      msg: "connecting to postgres://apex:pw@db:5432/apex and redis://:pw2@cache:6379",
      config: { databaseUrl: "postgresql://apex:p%40ss@db/apex", cdn: "https://cdn.example.com" },
      link: "https://example.com/reset?token=abc",
    };

    expect(finish(entry)).toEqual({
      msg: `connecting to postgres://${REDACTED}@db:5432/apex and redis://${REDACTED}@cache:6379`,
      config: { databaseUrl: `postgresql://${REDACTED}@db/apex`, cdn: "https://cdn.example.com" },
      link: `https://example.com/reset?${REDACTED}`,
    });
  });

  it("cuts long strings, saying how much was left out", () => {
    const entry = { msg: "x".repeat(MAX_LOGGED_STRING_LENGTH + 10) };

    expect(finish(entry)).toEqual({
      msg: `${"x".repeat(MAX_LOGGED_STRING_LENGTH)}... (10 more characters)`,
    });
  });

  // Redacted, this string just fits. Cut first, it would end inside the password, before the "@"
  // that shows it to be one, and the start of the password would be logged.
  it("hides a URL's credentials before it cuts the string", () => {
    const start = "x".repeat(MAX_LOGGED_STRING_LENGTH - 30);
    const entry = { msg: `${start} postgres://apex:cut-secret-cut-secret@db/apex` };

    expect(finish(entry)).toEqual({ msg: `${start} postgres://${REDACTED}@db/apex` });
  });

  /**
   * DEL and the C1 controls, the Arabic letter mark, the left-to-right and right-to-left marks,
   * the line and paragraph separators with the bidirectional embeddings and overrides, and the
   * bidirectional isolates: every character that the logger must escape, built from code points.
   */
  const displayControlRanges: readonly (readonly [number, number])[] = [
    [0x7f, 0x9f],
    [0x61c, 0x61c],
    [0x200e, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
  ];
  const displayControls = displayControlRanges.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, offset) => String.fromCodePoint(first + offset)),
  );

  it("escapes every character a terminal or viewer could act on, in keys and values alike", () => {
    const text = `car${displayControls.join("x")}`;
    const entry = { msg: text, [text]: [text], ansi: "\u001b[2J" };

    const output = finishLogLine(`${JSON.stringify(entry)}\n`);

    expect(displayControls.filter((character) => output.includes(character))).toEqual([]);
    expect(output).not.toContain("\u001b");
    expect(output).toContain("\\u009b");
    expect(output).toContain("\\u202e");
    expect(output.indexOf("\n")).toBe(output.length - 1);
    // Escaped, not removed: the line still holds the same values.
    expect(JSON.parse(output)).toEqual(entry);
  });

  it("leaves other non-ASCII text as it is", () => {
    const entry = { msg: "Citroën 2CV, 雪佛兰, 🏎", owner: "Zoë" };

    expect(finishLogLine(`${JSON.stringify(entry)}\n`)).toBe(`${JSON.stringify(entry)}\n`);
  });

  it.each([
    ["text that is not JSON", "password=hunter2\n"],
    ["a JSON array", '["hunter2"]\n'],
    ["a JSON string", '"hunter2"\n'],
    ["JSON null", "null\n"],
  ])("replaces %s with an error line", (_name, line) => {
    const output = finishLogLine(line);

    expect(output).not.toContain("hunter2");
    const droppedLine = z.strictObject({
      level: z.literal(50),
      time: z.iso.datetime(),
      msg: z.literal("log line dropped: not a JSON object"),
    });
    expect(() => droppedLine.parse(JSON.parse(output))).not.toThrow();
  });

  it("adds the running request's ID to a line that has none", () => {
    const entry = runWithRequestContext({ requestId: "request-1" }, () =>
      finish({ component: "garage-service", msg: "car saved" }),
    );

    expect(entry).toEqual({ component: "garage-service", msg: "car saved", reqId: "request-1" });
  });

  it("keeps the request ID a line already has", () => {
    const entry = runWithRequestContext({ requestId: "request-1" }, () =>
      finish({ reqId: "request-2", msg: "incoming request" }),
    );

    expect(entry).toEqual({ reqId: "request-2", msg: "incoming request" });
  });

  it("adds no request ID outside a request", () => {
    expect(finish({ msg: "Server listening at http://127.0.0.1:4000" })).toEqual({
      msg: "Server listening at http://127.0.0.1:4000",
    });
  });
});

describe("loggableUrl", () => {
  it.each([
    ["/health", "/health"],
    ["/cars/7?sort=name", `/cars/7?${REDACTED}`],
    ["/reset?token=abc#top", `/reset?${REDACTED}`],
    ["//evil.example/x?y=1", `//evil.example/x?${REDACTED}`],
    ["/reset?name=d'arcy&token=abc", `/reset?${REDACTED}`],
    ["*?token=abc", `*?${REDACTED}`],
  ])("logs %j as %j", (url, expected) => {
    expect(loggableUrl(url)).toBe(expected);
  });

  it("cuts a long URL, saying how much was left out", () => {
    const url = `/${"a".repeat(MAX_LOGGED_URL_LENGTH + 99)}`;

    expect(loggableUrl(url)).toBe(
      `/${"a".repeat(MAX_LOGGED_URL_LENGTH - 1)}... (100 more characters)`,
    );
  });
});

// Whether pino-pretty is installed at all is decided by Node.js's module resolution, which only a
// separate process can change: server.test.ts checks the entrypoint's message for a production
// install, which leaves pino-pretty out. Here pino-pretty is installed but fails to load.
describe("loggingServerOptions when pino-pretty fails to load", () => {
  async function loadWithBrokenPinoPretty() {
    vi.resetModules();
    vi.doMock("pino-pretty", () => {
      throw new Error("pino-pretty failed to load");
    });
    return import("./logger.ts");
  }

  afterEach(() => {
    vi.doUnmock("pino-pretty");
    vi.resetModules();
  });

  it("passes the failure on instead of blaming production installs", async () => {
    const { loggingServerOptions, LogFormatUnavailableError } = await loadWithBrokenPinoPretty();

    const options = loggingServerOptions({ level: "info", format: "pretty" });

    // The entrypoint prints only the message of a LogFormatUnavailableError and would hide this.
    await expect(options).rejects.toThrow();
    await expect(options).rejects.not.toBeInstanceOf(LogFormatUnavailableError);
  });

  it("does not load it for JSON output", async () => {
    const { loggingServerOptions } = await loadWithBrokenPinoPretty();

    await expect(loggingServerOptions({ level: "info", format: "json" })).resolves.toMatchObject({
      requestIdHeader: false,
    });
  });
});
