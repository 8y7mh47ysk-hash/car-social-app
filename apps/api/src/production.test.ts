import { spawn, type ChildProcessByStdio } from "node:child_process";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { healthResponseSchema } from "@apex/shared";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// The production path: `pnpm build` compiles packages/shared and the API to their dist/ folders,
// and `pnpm start` runs the compiled API, which loads packages/shared's compiled code through the
// "@apex/dist" export condition (docs/DECISIONS.md). These tests run both packages' build scripts,
// which replace their dist/ folders as `pnpm build` does, and then the API's start script.

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const sharedRoot = fileURLToPath(new URL("../../../packages/shared/", import.meta.url));

const packageScripts = z.object({ scripts: z.record(z.string(), z.string()) });

/** Reads one script from the package.json in `root`. */
async function script(root: string, name: string): Promise<string> {
  const { scripts } = packageScripts.parse(
    JSON.parse(await readFile(join(root, "package.json"), "utf8")),
  );
  const command = scripts[name];
  if (command === undefined) {
    throw new Error(`${join(root, "package.json")} has no "${name}" script`);
  }
  return command;
}

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ScriptProcess {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  /** Settles once the process has exited and its output has been read. */
  readonly exited: Promise<Exit>;
  /** Everything the process has written to stdout and stderr so far. */
  readonly output: () => string;
}

/**
 * Runs a package script with `sh -c` in the package's folder, as pnpm does, with the package's
 * own tools, Node.js and the system commands on PATH. `env` is the rest of its environment.
 */
function runScript(
  root: string,
  command: string,
  env: Readonly<Record<string, string>>,
): ScriptProcess {
  const path = [join(root, "node_modules", ".bin"), dirname(process.execPath), "/usr/bin", "/bin"];
  const child = spawn("sh", ["-c", command], {
    cwd: root,
    env: { ...env, PATH: path.join(delimiter) },
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

/** Runs a package's build script; throws with its output if it fails. */
async function build(root: string): Promise<void> {
  const run = runScript(root, await script(root, "build"), {});
  const exit = await run.exited;
  if (exit.code !== 0) {
    throw new Error(`the build in ${root} failed:\n${run.output()}`);
  }
}

/**
 * Starts the API with `command` as its start script, on a port picked by the OS. `exec` makes
 * Node.js replace the shell, so signals reach it directly. Every variable the API reads is set
 * here, so apps/api/.env, which the start script loads, cannot change the result. The process
 * is killed when the test ends, even if the test failed.
 */
function startApi(command: string): ScriptProcess {
  const api = runScript(apiRoot, `exec ${command}`, {
    API_HOST: "127.0.0.1",
    API_PORT: "0",
    LOG_LEVEL: "info",
    LOG_FORMAT: "json",
  });
  onTestFinished(() => {
    api.child.kill("SIGKILL");
  });
  return api;
}

/** Resolves with the address the API listens on, or undefined if it exits first. */
function listening(api: ScriptProcess): Promise<URL | undefined> {
  return new Promise((resolve) => {
    const check = (): void => {
      const match = /Server listening at (http:\/\/[\d.:]+)/.exec(api.output());
      if (match?.[1] !== undefined) {
        stop();
        resolve(new URL(match[1]));
      }
    };
    const onClose = (): void => {
      stop();
      resolve(undefined);
    };
    const stop = (): void => {
      api.child.stdout.off("data", check);
      api.child.off("close", onClose);
    };
    api.child.stdout.on("data", check);
    api.child.once("close", onClose);
    check();
  });
}

describe("the production build of the API", { timeout: 30_000 }, () => {
  // packages/shared first: the API's compiled code loads its dist/ output.
  beforeAll(async () => {
    await build(sharedRoot);
    await build(apiRoot);
  }, 120_000);

  it("serves the health contract from compiled code, then shuts down cleanly", async () => {
    const api = startApi(await script(apiRoot, "start"));
    const url = await listening(api);
    expect(url, api.output()).toBeDefined();

    const response = await fetch(new URL("/health", url));
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: "ok" });

    api.child.kill("SIGTERM");
    expect(await api.exited).toEqual({ code: 0, signal: null });
    expect(api.output()).toContain('"msg":"shutting down"');
  });
});
