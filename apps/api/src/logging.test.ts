import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { buildApp, type BuildAppOptions } from "./app.ts";
import { REDACTED } from "./lib/redact.ts";

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

/** The fields these tests read from a JSON log line; other fields pass through unchecked. */
const logLineSchema = z.looseObject({
  level: z.number().int(),
  time: z.iso.datetime(),
  msg: z.string(),
  reqId: z.string().optional(),
});
type LogLine = z.infer<typeof logLineSchema>;

interface LoggedApp {
  readonly app: FastifyInstance;
  /** Everything written to the log so far. */
  readonly output: () => string;
  /** Every JSON line written so far, parsed. */
  readonly lines: () => LogLine[];
}

/** Builds the app with its log captured in memory. The app is closed when the test ends. */
async function buildLoggedApp(options: BuildAppOptions = {}): Promise<LoggedApp> {
  let output = "";
  const app = await buildApp({
    logLevel: "trace",
    logDestination: {
      write(line) {
        output += line;
      },
    },
    ...options,
  });
  onTestFinished(async () => {
    await app.close();
  });
  return {
    app,
    output: () => output,
    lines: () =>
      output
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => logLineSchema.parse(JSON.parse(line))),
  };
}

/**
 * Stands in for code deep inside the API: it is given a logger once, at startup, and never sees
 * the request it works for.
 */
function createGarageService(log: FastifyBaseLogger) {
  return {
    async saveCar(name: string, delayMs = 1): Promise<void> {
      await sleep(delayMs);
      log.info({ car: name }, "car saved");
    },
  };
}

const carBodySchema = z.object({ name: z.string() });

/** Sends a POST whose body arrives in pieces, `gapMs` apart, over a real connection. */
function postInPieces(
  url: URL,
  pieces: readonly string[],
  gapMs: number,
): Promise<{ status: number | undefined; requestId: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve({ status: response.statusCode, requestId: response.headers["x-request-id"] });
        });
      },
    );
    request.on("error", reject);
    void (async () => {
      for (const piece of pieces) {
        request.write(piece);
        await sleep(gapMs);
      }
      request.end();
    })();
  });
}

/** Writes raw bytes to the server and resolves with everything it sends back before closing. */
function sendRaw(url: URL, bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    let reply = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      reply += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => {
      resolve(reply);
    });
    socket.write(bytes);
  });
}

describe("request IDs in the logs", () => {
  it("gives every line of a request its ID, also a service log made without the request", async () => {
    const { app, lines } = await buildLoggedApp();
    const garage = createGarageService(app.log.child({ component: "garage-service" }));
    app.addHook("preHandler", (request, _reply, done) => {
      request.log.debug("checking access");
      done();
    });
    app.post("/cars", async (request) => {
      const { name } = carBodySchema.parse(request.body);
      await garage.saveCar(name);
      return { saved: name };
    });

    const response = await app.inject({ method: "POST", url: "/cars", payload: { name: "MX-5" } });

    expect(response.statusCode).toBe(200);
    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(UUID_V4);
    expect(lines().map((line) => [line.msg, line.reqId])).toEqual([
      ["incoming request", requestId],
      ["checking access", requestId],
      ["car saved", requestId],
      ["request completed", requestId],
    ]);
    expect(lines()[2]).toMatchObject({ component: "garage-service", car: "MX-5" });
  });

  it("keeps the lines of concurrent requests apart", async () => {
    const { app, lines } = await buildLoggedApp({ logLevel: "info" });
    const garage = createGarageService(app.log);
    const paramsSchema = z.object({ name: z.string(), delayMs: z.coerce.number().int().min(0) });
    app.get("/cars/:name/:delayMs", async (request) => {
      const { name, delayMs } = paramsSchema.parse(request.params);
      await garage.saveCar(name, delayMs);
      return { saved: name };
    });
    const names = Array.from({ length: 10 }, (_, index) => `car-${String(index)}`);

    // The first request waits longest, so the requests finish in reverse order and interleave.
    const responses = await Promise.all(
      names.map((name, index) =>
        app.inject({ url: `/cars/${name}/${String((names.length - index) * 3)}` }),
      ),
    );

    const requestIds = responses.map((response) => response.headers["x-request-id"]);
    expect(new Set(requestIds).size).toBe(names.length);
    const savedBy = new Map(
      lines()
        .filter((line) => line.msg === "car saved")
        .map((line) => [line["car"], line.reqId]),
    );
    expect(names.map((name) => savedBy.get(name))).toEqual(requestIds);
  });

  it("reuses a well-formed x-request-id header and sends it back", async () => {
    const { app, lines } = await buildLoggedApp();

    const response = await app.inject({
      url: "/health",
      headers: { "x-request-id": "edge-0123456789abcdef" },
    });

    expect(response.headers["x-request-id"]).toBe("edge-0123456789abcdef");
    expect(lines().map((line) => line.reqId)).toEqual([
      "edge-0123456789abcdef",
      "edge-0123456789abcdef",
    ]);
  });

  it.each([
    ["too short", "MALFORM"],
    ["too long", "MALFORMED".repeat(8)],
    ["a space", "MALFORMED id"],
    ["a quote that could forge JSON", 'MALFORMED","msg":"forged'],
    ["two IDs joined from repeated headers", "MALFORMED-1, MALFORMED-2"],
    ["non-ASCII letters", "MALFORMÉD-id"],
  ])(
    "replaces a malformed x-request-id (%s) with a new UUID and never logs it",
    async (_name, malformed) => {
      const { app, output, lines } = await buildLoggedApp();

      const response = await app.inject({ url: "/health", headers: { "x-request-id": malformed } });

      const requestId = response.headers["x-request-id"];
      expect(requestId).toMatch(UUID_V4);
      expect(lines().map((line) => line.reqId)).toEqual([requestId, requestId]);
      expect(output()).not.toContain("MALFORM");
    },
  );

  it("sends the ID back and logs it for a route that does not exist", async () => {
    const { app, output, lines } = await buildLoggedApp();

    const response = await app.inject({ url: "/no-such-page?token=query-secret" });

    expect(response.statusCode).toBe(404);
    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(UUID_V4);
    expect(lines().map((line) => [line.msg, line.reqId])).toEqual([
      ["incoming request", requestId],
      ["route not found", requestId],
      ["request completed", requestId],
    ]);
    expect(output()).not.toContain("query-secret");
  });

  it("logs a failing request at error level with its ID, and still sends the ID back", async () => {
    const { app, lines } = await buildLoggedApp();
    app.get("/boom", () => {
      throw new Error("engine failure");
    });

    const response = await app.inject({ url: "/boom" });

    expect(response.statusCode).toBe(500);
    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(UUID_V4);
    expect(lines().find((line) => line.msg === "engine failure")).toMatchObject({
      level: 50,
      reqId: requestId,
      err: { type: "Error", message: "engine failure" },
    });
  });

  it("logs a request as its method, a bounded URL and the client address only", async () => {
    const { app, lines } = await buildLoggedApp({ logLevel: "info" });
    const longPath = `/${"a".repeat(300)}`;

    await app.inject({
      url: `${longPath}?token=query-secret`,
      headers: { host: "attacker.example", "accept-version": "1.0" },
    });

    expect(lines()[0]).toMatchObject({ msg: "incoming request" });
    expect(lines()[0]?.["req"]).toEqual({
      method: "GET",
      // 301 characters of path plus "?[Redacted]" is 312, cut to 256.
      url: `${longPath.slice(0, 256)}... (56 more characters)`,
      remoteAddress: "127.0.0.1",
    });
  });

  it("writes lines from outside any request without a request ID", async () => {
    const { app, lines } = await buildLoggedApp({ logLevel: "info" });

    app.log.info("starting up");
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    expect(lines().map((line) => [line.msg, line.reqId])).toEqual([
      ["starting up", undefined],
      [`Server listening at ${address}`, undefined],
    ]);
  });

  it("writes nothing when no log level is given", async () => {
    let output = "";
    const app = await buildApp({
      logDestination: {
        write(line) {
          output += line;
        },
      },
    });
    onTestFinished(async () => {
      await app.close();
    });

    await app.inject({ url: "/health" });

    expect(output).toBe("");
  });
});

describe("request IDs over a real connection", () => {
  // app.inject() hands the body over at once; a real client's body arrives in network packets,
  // and Fastify parses it in later callbacks. The service log must still get the request's ID.
  it("keeps a request's context while its body arrives in pieces", async () => {
    const { app, lines } = await buildLoggedApp({ logLevel: "info" });
    const garage = createGarageService(app.log);
    app.post("/cars", async (request) => {
      const { name } = carBodySchema.parse(request.body);
      await garage.saveCar(name);
      return { saved: name };
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const response = await postInPieces(new URL("/cars", address), ['{"name":', '"MX-5"}'], 20);

    expect(response.status).toBe(200);
    expect(response.requestId).toMatch(UUID_V4);
    expect(lines().find((line) => line.msg === "car saved")?.reqId).toBe(response.requestId);
  });
});

describe("secrets in the logs", () => {
  it("keeps credentials, cookies, tokens and query strings out of every line", async () => {
    const { app, output, lines } = await buildLoggedApp();
    app.post("/login", (request, reply) => {
      // Careless logging on purpose: whole headers and bodies.
      request.log.info({ headers: request.headers, body: request.body }, "login attempt");
      app.log.info("connecting to postgres://apex:db-secret@db:5432/apex");
      void reply.header("set-cookie", "session=reply-cookie-secret; HttpOnly");
      request.log.info({ headers: reply.getHeaders() }, "reply headers");
      return { ok: true };
    });

    const response = await app.inject({
      method: "POST",
      url: "/login?token=query-secret&next=/garage",
      headers: {
        authorization: "Bearer header-secret",
        cookie: "session=cookie-secret",
        "x-api-key": "key-secret",
      },
      payload: { email: "driver@example.com", password: "body-secret" },
    });

    expect(response.statusCode).toBe(200);
    for (const secret of [
      "query-secret",
      "header-secret",
      "cookie-secret",
      "key-secret",
      "body-secret",
      "db-secret",
      "reply-cookie-secret",
    ]) {
      expect(output()).not.toContain(secret);
    }
    const line = (msg: string) => lines().find((entry) => entry.msg === msg);
    expect(line("incoming request")).toMatchObject({
      req: { method: "POST", url: `/login?${REDACTED}` },
    });
    expect(line("login attempt")).toMatchObject({
      headers: { authorization: REDACTED, cookie: REDACTED, "x-api-key": REDACTED },
      body: { email: "driver@example.com", password: REDACTED },
    });
    expect(line(`connecting to postgres://${REDACTED}@db:5432/apex`)).toBeDefined();
    expect(line("reply headers")).toMatchObject({ headers: { "set-cookie": REDACTED } });
  });

  // Node.js attaches the raw bytes of a request it cannot parse to the error that Fastify logs at
  // trace level, so they hold every header the client sent, cookies included.
  it("hides the raw bytes of a malformed request", async () => {
    const { app, lines } = await buildLoggedApp();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const reply = await sendRaw(
      new URL(address),
      "GET / HTTP/1.1\r\nHost: x\r\nCookie: session=cookie-secret\r\nBad Header: y\r\n\r\n",
    );

    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(lines().find((line) => line.msg === "client error")).toMatchObject({
      level: 10,
      err: { code: "HPE_INVALID_HEADER_TOKEN", rawPacket: REDACTED },
    });
  });
});

describe("pretty format", () => {
  it("writes one readable line per entry, with the request ID and the same redaction", async () => {
    const { app, output } = await buildLoggedApp({ logFormat: "pretty", logLevel: "info" });

    const response = await app.inject({
      url: "/health?token=query-secret",
      headers: { "x-request-id": "pretty-0123456789" },
    });

    expect(response.statusCode).toBe(200);
    const written = output().trimEnd().split("\n");
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/^\[\d\d:\d\d:\d\d\.\d{3}\] INFO: incoming request /);
    expect(written[1]).toMatch(/^\[\d\d:\d\d:\d\d\.\d{3}\] INFO: request completed /);
    for (const line of written) {
      expect(line).toContain('"reqId":"pretty-0123456789"');
    }
    expect(output()).toContain(`"url":"/health?${REDACTED}"`);
    expect(output()).not.toContain("query-secret");
  });
});
