import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { healthResponseSchema } from "@apex/shared";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// The production path: `pnpm build` compiles packages/shared and the API to their dist/ folders,
// and `pnpm start` runs the compiled API, which loads packages/shared's compiled code through the
// "@apex/dist" export condition (docs/DECISIONS.md). These tests copy both packages to a temporary
// folder, run their build scripts there and then the API's start script. They never touch this
// checkout's dist/ folders, which a `pnpm build` or `pnpm start` running meanwhile may be using.

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

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

/**
 * Whether a file or folder of a package belongs in the copy: everything except installed
 * dependencies, build output and local .env settings, as in a fresh checkout.
 */
function isCheckedIn(path: string): boolean {
  const name = basename(path);
  return (
    !["node_modules", "dist"].includes(name) &&
    (!name.startsWith(".env") || name === ".env.example")
  );
}

/**
 * Copies packages/shared and apps/api, and the base tsconfig they extend, into `dir` with the
 * repository's layout. Each copy uses this checkout's installed dependencies, except that the
 * API's @apex/shared is the copy of packages/shared.
 */
async function copyPackages(dir: string): Promise<{ sharedRoot: string; apiRoot: string }> {
  const sharedRoot = join(dir, "packages", "shared");
  const apiRoot = join(dir, "apps", "api");
  await cp(join(repoRoot, "tsconfig.base.json"), join(dir, "tsconfig.base.json"));
  for (const root of [sharedRoot, apiRoot]) {
    const source = join(repoRoot, root.slice(dir.length + 1));
    await cp(source, root, { recursive: true, filter: isCheckedIn });
  }
  await symlink(
    join(repoRoot, "packages", "shared", "node_modules"),
    join(sharedRoot, "node_modules"),
  );
  const apiModules = join(repoRoot, "apps", "api", "node_modules");
  for (const name of await readdir(apiModules)) {
    if (name !== "@apex") {
      await mkdir(join(apiRoot, "node_modules"), { recursive: true });
      await symlink(join(apiModules, name), join(apiRoot, "node_modules", name));
    }
  }
  await mkdir(join(apiRoot, "node_modules", "@apex"), { recursive: true });
  await symlink(sharedRoot, join(apiRoot, "node_modules", "@apex", "shared"));
  return { sharedRoot, apiRoot };
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
 * Starts the API in `apiRoot` with `command` as its start script, on a port picked by the OS.
 * `exec` makes Node.js replace the shell, so signals reach it directly. Every variable the API
 * reads is set here. The process is killed when the test ends, even if the test failed.
 */
function startApi(apiRoot: string, command: string): ScriptProcess {
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
  let dir = "";
  let sharedRoot = "";
  let apiRoot = "";

  // packages/shared first: the API's compiled code loads its dist/ output.
  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "apex-production-")));
    ({ sharedRoot, apiRoot } = await copyPackages(dir));
    // What an earlier build left of a source file that has since been deleted or renamed.
    for (const root of [sharedRoot, apiRoot]) {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist", "removed.js"), "export {};\n");
    }
    await build(sharedRoot);
    await build(apiRoot);
  }, 120_000);

  afterAll(async () => {
    // Empty if beforeAll failed before it made the folder; there is nothing to remove then.
    if (dir !== "") {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves the health contract from compiled code, then shuts down cleanly", async () => {
    const api = startApi(apiRoot, await script(apiRoot, "start"));
    const url = await listening(api);
    expect(url, api.output()).toBeDefined();

    const response = await fetch(new URL("/health", url));
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: "ok" });

    api.child.kill("SIGTERM");
    expect(await api.exited).toEqual({ code: 0, signal: null });
    expect(api.output()).toContain('"msg":"shutting down"');
  });

  it("builds each package into an empty dist/ folder, so nothing from an earlier build stays", () => {
    expect(existsSync(join(sharedRoot, "dist", "removed.js"))).toBe(false);
    expect(existsSync(join(apiRoot, "dist", "removed.js"))).toBe(false);
  });

  // The start script loads apps/api/.env (variables set in the environment win over it).
  it("reads its settings from apps/api/.env", async () => {
    await writeFile(join(apiRoot, ".env"), "LOG_FORMAT=yaml\n");
    onTestFinished(() => rm(join(apiRoot, ".env"), { force: true }));
    const api = runScript(apiRoot, `exec ${await script(apiRoot, "start")}`, { API_PORT: "0" });
    onTestFinished(() => {
      api.child.kill("SIGKILL");
    });

    expect(await listening(api), api.output()).toBeUndefined();
    expect(await api.exited).toEqual({ code: 1, signal: null });
    expect(api.output()).toContain("LOG_FORMAT: must be one of json, pretty");
  });

  // Stack traces in the production log point at the TypeScript source rather than the compiled
  // JavaScript: the builds write source maps and the start script turns them on. A module that
  // NODE_OPTIONS preloads into the start script's Node.js calls compiled code that throws, through
  // both packages, and prints the stack trace.
  it("maps stack traces from the compiled code to the TypeScript source", async () => {
    const config = pathToFileURL(join(apiRoot, "dist", "config.js")).href;
    const preload = [
      `const { loadConfig } = await import(${JSON.stringify(config)});`,
      'try { loadConfig({ API_PORT: "not a port" }); }',
      "catch (error) { console.log(error.stack); process.exit(0); }",
    ].join("\n");
    const api = runScript(apiRoot, `exec ${await script(apiRoot, "start")}`, {
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}`,
    });
    onTestFinished(() => {
      api.child.kill("SIGKILL");
    });

    expect(await api.exited, api.output()).toEqual({ code: 0, signal: null });
    expect(api.output()).toMatch(/at parseEnv \(\S+\/packages\/shared\/src\/env\.ts:\d+:\d+\)/);
    expect(api.output()).toMatch(/at loadConfig \(\S+\/apps\/api\/src\/config\.ts:\d+:\d+\)/);
  });

  // Without the condition, Node.js would resolve packages/shared's default export, its
  // TypeScript source, and strip the types: the API would start, and nobody would notice. The
  // start script turns type stripping off, so it fails instead.
  it("refuses to run TypeScript source when the export condition is missing", async () => {
    const start = await script(apiRoot, "start");
    const withoutCondition = start.replace(" --conditions=@apex/dist", "");
    expect(withoutCondition).not.toBe(start);

    const api = startApi(apiRoot, withoutCondition);

    expect(await listening(api)).toBeUndefined();
    expect(await api.exited).toEqual({ code: 1, signal: null });
    expect(api.output()).toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(api.output()).toContain(join("packages", "shared", "src", "index.ts"));
  });
});
