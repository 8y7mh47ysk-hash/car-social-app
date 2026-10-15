import { spawn, type ChildProcessByStdio } from "node:child_process";
import { connect, createServer } from "node:net";
import type { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { REDACTED } from "./lib/redact.ts";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));

/** The fields the logging tests read from a JSON log line. */
const logLineSchema = z.looseObject({ msg: z.string(), reqId: z.string().optional() });

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ServerProcess {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  /** Settles once the process has exited and its output has been read. */
  readonly exited: Promise<Exit>;
  /** Everything the process has written to stdout and stderr so far. */
  readonly output: () => string;
}

/**
 * Runs the real entrypoint from source (Node strips the types, as in `pnpm dev`) on a port
 * picked by the OS. Its environment holds only the variables the API reads, so neither the
 * developer's shell (LOG_LEVEL, NODE_OPTIONS...) nor apps/api/.env, which only the package
 * scripts load, can change the result. `nodeArgs` go to Node.js before the entrypoint (see
 * `preload`). The process is killed when the test ends, even if the test failed or timed out
 * while waiting for it, so a hanging server can never outlive the run.
 */
function startServer(
  env: Readonly<Record<string, string>> = {},
  nodeArgs: readonly string[] = [],
): ServerProcess {
  const child = spawn(process.execPath, [...nodeArgs, "src/server.ts"], {
    cwd: apiRoot,
    env: { API_HOST: "127.0.0.1", API_PORT: "0", LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  let output = "";
  const collect = (chunk: string): void => {
    output += chunk;
  };
  child.stdout.setEncoding("utf8").on("data", collect);
  child.stderr.setEncoding("utf8").on("data", collect);
  const exited = new Promise<Exit>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return { child, exited, output: () => output };
}

/**
 * Node.js arguments that run `source`, an ES module, before the entrypoint, so a test can change
 * the real entrypoint's process without a fixture file (`--import` accepts a data: URL).
 */
function preload(source: string): string[] {
  return ["--import", `data:text/javascript,${encodeURIComponent(source)}`];
}

/**
 * Node.js arguments that make resolving `specifier` fail with an error that has `code` and
 * `message`, as Node.js fails for a package that is missing or broken. Only imports and requires
 * from a file whose URL contains `from` fail (by default, all of them).
 */
function failToResolve(specifier: string, code: string, message: string, from = ""): string[] {
  return preload(`
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (
          specifier === ${JSON.stringify(specifier)} &&
          String(context.parentURL).includes(${JSON.stringify(from)})
        ) {
          throw Object.assign(new Error(${JSON.stringify(message)}), {
            code: ${JSON.stringify(code)},
          });
        }
        return nextResolve(specifier, context);
      },
    });
  `);
}

/** Makes importing pino-pretty fail as it does in a production install, which leaves it out. */
const WITHOUT_PINO_PRETTY = failToResolve(
  "pino-pretty",
  "ERR_MODULE_NOT_FOUND",
  "Cannot find package 'pino-pretty'",
);

/**
 * Adds `GET /fail` to the entrypoint's app through the diagnostics channel on which Fastify
 * publishes every new instance, before the entrypoint registers anything. The route answers at
 * once and leaves a timer behind, as fire-and-forget code in a handler would; 10 ms later the
 * timer fails with an error whose message holds a connection URL's password: thrown ("throw") or
 * as a promise rejection that nothing handles ("reject").
 */
function failAfterRequest(kind: "throw" | "reject"): string[] {
  return preload(`
    import { subscribe } from "node:diagnostics_channel";
    subscribe("fastify.initialization", ({ fastify }) => {
      fastify.get("/fail", () => {
        setTimeout(() => {
          // Joined at run time: stack traces show this module's data: URL, which holds its source.
          const password = ["crash", "secret"].join("-");
          const error = new Error("lost postgres://apex:" + password + "@db:5432/apex");
          ${kind === "throw" ? "throw error;" : "void Promise.reject(error);"}
        }, 10);
        return { failing: true };
      });
    });
  `);
}

/** Resolves with the first match of `pattern` in the server's output, waiting for it if needed. */
function outputMatching(server: ServerProcess, pattern: RegExp): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const match = pattern.exec(server.output());
      if (match !== null) {
        stop();
        resolve(match);
      }
    };
    const onClose = (): void => {
      stop();
      reject(new Error(`server exited before printing ${String(pattern)}:\n${server.output()}`));
    };
    const stop = (): void => {
      server.child.stdout.off("data", check);
      server.child.off("close", onClose);
    };
    server.child.stdout.on("data", check);
    server.child.once("close", onClose);
    check();
  });
}

/** Resolves with the address from Fastify's "Server listening at ..." log line. */
async function listeningUrl(server: ServerProcess): Promise<URL> {
  const [, address = ""] = await outputMatching(server, /Server listening at (http:\/\/[\d.:]+)/);
  return new URL(address);
}

/**
 * Starts a request and leaves it unfinished: a POST whose headers have arrived (the server has
 * logged "incoming request") and whose body has not. `finish` sends the rest of the body and
 * resolves with everything the server sends back before it closes the connection.
 */
async function openRequest(
  server: ServerProcess,
  url: URL,
): Promise<{ finish: () => Promise<string> }> {
  const socket = connect(Number(url.port), url.hostname);
  onTestFinished(() => {
    socket.destroy();
  });
  let reply = "";
  socket.setEncoding("utf8").on("data", (chunk: string) => {
    reply += chunk;
  });
  // A dying server resets the connection; the close event follows and the test checks the reply.
  socket.on("error", () => undefined);
  const closed = new Promise<string>((resolve) => {
    socket.once("close", () => {
      resolve(reply);
    });
  });
  socket.write(
    "POST /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" +
      "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{",
  );
  await outputMatching(server, /"msg":"incoming request"/);
  return {
    finish: () => {
      socket.write("}");
      return closed;
    },
  };
}

/** Listens on a free loopback port until the test ends and returns that port. */
async function occupyPort(): Promise<number> {
  const blocker = createServer();
  await new Promise<void>((resolve) => {
    blocker.listen(0, "127.0.0.1", resolve);
  });
  onTestFinished(() => {
    blocker.close();
  });
  const address = blocker.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

describe("server entrypoint", { timeout: 20_000 }, () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "serves /health, then shuts down cleanly on %s",
    async (signal) => {
      const server = startServer();
      const url = await listeningUrl(server);

      const response = await fetch(new URL("/health", url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });

      server.child.kill(signal);
      expect(await server.exited).toEqual({ code: 0, signal: null });
      expect(server.output()).toContain("shutting down");
    },
  );

  // In `pnpm dev`, Ctrl+C reaches both `node --watch` and the server, and `node --watch` then
  // sends the server the same signal again, once the server has started shutting down.
  it("lets an open request finish when the stop signal arrives a second time at once", async () => {
    const server = startServer();
    const url = await listeningUrl(server);
    const request = await openRequest(server, url);

    server.child.kill("SIGINT");
    await outputMatching(server, /"msg":"shutting down"/);
    server.child.kill("SIGINT");

    expect(await request.finish()).toMatch(/^HTTP\/1\.1 404 /);
    expect(await server.exited).toEqual({ code: 0, signal: null });
  });

  it("stops without waiting for open requests on a second signal a second later", async () => {
    const server = startServer();
    const url = await listeningUrl(server);
    await openRequest(server, url);

    server.child.kill("SIGINT");
    await outputMatching(server, /"msg":"shutting down"/);
    // Signals within a second of the first count as the same one (REPEATED_SIGNAL_WINDOW_MS).
    await sleep(1250);
    server.child.kill("SIGINT");

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toContain(
      '"msg":"second signal; exiting without waiting for open requests"',
    );
  });

  it("exits with code 1 when the port is already in use", async () => {
    const server = startServer({ API_PORT: String(await occupyPort()) });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toContain("failed to start");
  });

  it("refuses to start with invalid variables, naming each one but never its value", async () => {
    const server = startServer({
      API_HOST: "http://host-value",
      API_PORT: "port-value",
      LOG_LEVEL: "level-value",
      LOG_FORMAT: "format-value",
    });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    // The whole output: no stack trace, no log lines and none of the values.
    expect(server.output()).toBe(
      [
        "Invalid environment variables for the API (values are not shown):",
        "  - API_HOST: must be an IP address such as 127.0.0.1, or a hostname such as localhost",
        "  - API_PORT: must be a whole number from 0 to 65535",
        "  - LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent",
        "  - LOG_FORMAT: must be one of json, pretty",
        "Set them in apps/api/.env (see apps/api/.env.example) or in the environment.",
        "",
      ].join("\n"),
    );
  });

  // A failed start logs one line at fatal level, so the output shows which level the logger got.
  it("applies LOG_LEVEL=fatal to the logger: only the fatal line is written", async () => {
    const server = startServer({ API_PORT: String(await occupyPort()), LOG_LEVEL: "fatal" });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    const lines = server.output().trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"msg":"failed to start"');
  });

  it("applies LOG_LEVEL=silent to the logger: nothing is written", async () => {
    const server = startServer({ API_PORT: String(await occupyPort()), LOG_LEVEL: "silent" });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toBe("");
  });

  it("logs JSON lines that carry the request ID it sends back", async () => {
    const server = startServer({ LOG_FORMAT: "json" });
    const url = await listeningUrl(server);

    const response = await fetch(new URL("/health?token=query-secret", url), {
      headers: { "x-request-id": "entrypoint-test-0001" },
    });
    expect(response.headers.get("x-request-id")).toBe("entrypoint-test-0001");
    server.child.kill("SIGTERM");
    expect(await server.exited).toEqual({ code: 0, signal: null });

    const lines = server
      .output()
      .trimEnd()
      .split("\n")
      .map((line) => logLineSchema.parse(JSON.parse(line)));
    expect(lines.map((line) => [line.msg, line.reqId])).toEqual([
      [`Server listening at ${url.origin}`, undefined],
      ["incoming request", "entrypoint-test-0001"],
      ["request completed", "entrypoint-test-0001"],
      ["shutting down", undefined],
    ]);
    expect(server.output()).not.toContain("query-secret");
  });

  it("logs readable lines with LOG_FORMAT=pretty", async () => {
    const server = startServer({ LOG_FORMAT: "pretty" });
    const url = await listeningUrl(server);

    await fetch(new URL("/health", url), { headers: { "x-request-id": "entrypoint-test-0002" } });
    server.child.kill("SIGTERM");
    expect(await server.exited).toEqual({ code: 0, signal: null });

    const lines = server.output().trimEnd().split("\n");
    const messages = lines.map(
      (line) => /^\[\d\d:\d\d:\d\d\.\d{3}\] INFO: (.+?)(?: \{.*\})?$/.exec(line)?.[1],
    );
    expect(messages).toEqual([
      `Server listening at ${url.origin}`,
      "incoming request",
      "request completed",
      "shutting down",
    ]);
    expect(lines[1]).toContain('"reqId":"entrypoint-test-0002"');
  });

  it("refuses to start with an invalid LOG_FORMAT", async () => {
    const server = startServer({ LOG_FORMAT: "fancy" });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toContain("LOG_FORMAT");
    expect(server.output()).toContain("must be one of json, pretty");
  });

  it("refuses LOG_FORMAT=pretty without pino-pretty, printing only what to do", async () => {
    const server = startServer({ LOG_FORMAT: "pretty" }, WITHOUT_PINO_PRETTY);

    expect(await server.exited).toEqual({ code: 1, signal: null });
    // The whole output: one line, no stack trace.
    expect(server.output()).toBe(
      "LOG_FORMAT=pretty needs pino-pretty, a development dependency that production installs " +
        "leave out. Use LOG_FORMAT=json.\n",
    );
  });

  // An installed pino-pretty that cannot load is a broken install, not a production one: the
  // advice to use JSON would hide what needs fixing.
  it.each([
    ["one of its own dependencies is missing", "colorette", "MODULE_NOT_FOUND", "/pino-pretty/"],
    ["its package.json is invalid", "pino-pretty", "ERR_INVALID_PACKAGE_CONFIG", ""],
  ])(
    "refuses LOG_FORMAT=pretty when %s, printing the real cause",
    async (_name, specifier, code, from) => {
      const cause = `${specifier} cannot be loaded (${code}, a broken install)`;
      const server = startServer(
        { LOG_FORMAT: "pretty" },
        failToResolve(specifier, code, cause, from),
      );

      expect(await server.exited).toEqual({ code: 1, signal: null });
      expect(server.output()).toContain(cause);
      expect(server.output()).not.toContain("production installs");
    },
  );

  it.each([
    ["an uncaught exception", "throw", "uncaughtException"],
    ["an unhandled promise rejection", "reject", "unhandledRejection"],
  ] as const)(
    "logs %s as a redacted JSON line with the failing request's ID, then exits with code 1",
    async (_name, kind, origin) => {
      const server = startServer({}, failAfterRequest(kind));
      const url = await listeningUrl(server);

      const response = await fetch(new URL("/fail", url), {
        headers: { "x-request-id": "entrypoint-crash-0001" },
      });
      expect(await response.json()).toEqual({ failing: true });
      expect(response.headers.get("x-request-id")).toBe("entrypoint-crash-0001");

      expect(await server.exited).toEqual({ code: 1, signal: null });
      // Every line is JSON (Node.js's own report would be plain text). The last one is the crash,
      // under the ID of the request that started the timer, although its response had gone.
      const lines = server
        .output()
        .trimEnd()
        .split("\n")
        .map((line) => logLineSchema.parse(JSON.parse(line)));
      expect(lines.at(-1)).toMatchObject({
        level: 60,
        msg: "uncaught exception",
        origin,
        reqId: "entrypoint-crash-0001",
        err: { message: `lost postgres://${REDACTED}@db:5432/apex` },
      });
      expect(server.output()).not.toContain("crash-secret");
    },
  );

  it("does not need pino-pretty to log JSON", async () => {
    const server = startServer({ LOG_FORMAT: "json" }, WITHOUT_PINO_PRETTY);
    const url = await listeningUrl(server);

    const response = await fetch(new URL("/health", url));
    expect(response.status).toBe(200);
    server.child.kill("SIGTERM");
    expect(await server.exited).toEqual({ code: 0, signal: null });
  });
});
