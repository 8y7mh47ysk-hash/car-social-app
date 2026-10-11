import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer, type Server } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));

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
 * picked by the OS.
 */
function startServer(env: Readonly<Record<string, string>> = {}): ServerProcess {
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: apiRoot,
    env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
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

async function occupyPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { server, port: address.port };
}

describe("server entrypoint", { timeout: 20_000 }, () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "serves /health, then shuts down cleanly on %s",
    async (signal) => {
      const server = startServer();
      try {
        const url = await listeningUrl(server);

        const response = await fetch(new URL("/health", url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ok" });

        server.child.kill(signal);
        expect(await server.exited).toEqual({ code: 0, signal: null });
        expect(server.output()).toContain("shutting down");
      } finally {
        server.child.kill("SIGKILL");
      }
    },
  );

  it("exits with code 1 when the port is already in use", async () => {
    const blocker = await occupyPort();
    const server = startServer({ API_PORT: String(blocker.port) });
    try {
      expect(await server.exited).toEqual({ code: 1, signal: null });
      expect(server.output()).toContain("failed to start");
    } finally {
      server.child.kill("SIGKILL");
      blocker.server.close();
    }
  });

  it("refuses to start with an invalid API_PORT", async () => {
    const server = startServer({ API_PORT: "not-a-port" });
    try {
      expect(await server.exited).toEqual({ code: 1, signal: null });
      expect(server.output()).toContain("API_PORT");
    } finally {
      server.child.kill("SIGKILL");
    }
  });
});
