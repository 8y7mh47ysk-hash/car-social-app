import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

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
 * picked by the OS. The process is killed when the test ends, even if the test failed or timed
 * out while waiting for it, so a hanging server can never outlive the test run.
 */
function startServer(env: Readonly<Record<string, string>> = {}): ServerProcess {
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: apiRoot,
    env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: "0", ...env },
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

/** Resolves with the address from Fastify's "Server listening at ..." log line. */
function listeningUrl(server: ServerProcess): Promise<URL> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const match = /Server listening at (http:\/\/[\d.:]+)/.exec(server.output());
      if (match?.[1] !== undefined) {
        stop();
        resolve(new URL(match[1]));
      }
    };
    const onClose = (): void => {
      stop();
      reject(new Error(`server exited before listening:\n${server.output()}`));
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

  it("exits with code 1 when the port is already in use", async () => {
    const server = startServer({ API_PORT: String(await occupyPort()) });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toContain("failed to start");
  });

  it("refuses to start with an invalid API_PORT", async () => {
    const server = startServer({ API_PORT: "not-a-port" });

    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(server.output()).toContain("API_PORT");
  });

  it("logs JSON lines that carry the request ID it sends back", async () => {
    const server = startServer();
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
});
