import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// Instruction 4: the API's `dev` and `start` scripts read apps/api/.env when it exists, and a
// variable already set in the environment wins over the file. These tests run each real script
// from apps/api/package.json in a scratch folder laid out like apps/api, whose entrypoint is a
// stand-in that prints the variables it was given, so they need no build and no free port.

const scriptsSchema = z.object({ scripts: z.object({ dev: z.string(), start: z.string() }) });

const { scripts } = scriptsSchema.parse(
  JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")),
);

/** What the stand-in entrypoint prints: the variables it received, null for one not set. */
const seenSchema = z.object({ API_PORT: z.string().nullable(), LOG_LEVEL: z.string().nullable() });

/** Plain JavaScript, so it runs as `src/server.ts` in `dev` and as `dist/server.js` in `start`. */
const STAND_IN = `
const seen = { API_PORT: process.env.API_PORT ?? null, LOG_LEVEL: process.env.LOG_LEVEL ?? null };
console.log("seen " + JSON.stringify(seen));
`;

/**
 * Runs `script` with `sh -c`, as pnpm does, in a new scratch folder that holds the stand-in
 * entrypoints and, if `envFile` is given, a `.env` file with that content. The environment holds
 * only `env` and a PATH that finds Node.js. Resolves with what the stand-in printed. The script
 * runs in its own process group, which is killed when the test ends: `dev` keeps watching for
 * changes after the stand-in has exited.
 */
async function variablesSeenBy(
  script: string,
  envFile: string | undefined,
  env: Readonly<Record<string, string>> = {},
): Promise<z.output<typeof seenSchema>> {
  const folder = await mkdtemp(join(tmpdir(), "apex-env-file-"));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  for (const entrypoint of ["src/server.ts", "dist/server.js"]) {
    await mkdir(join(folder, dirname(entrypoint)), { recursive: true });
    await writeFile(join(folder, entrypoint), STAND_IN);
  }
  if (envFile !== undefined) {
    await writeFile(join(folder, ".env"), envFile);
  }

  const child = spawn("sh", ["-c", script], {
    cwd: folder,
    detached: true,
    env: { ...env, PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onTestFinished(() => {
    if (child.pid === undefined) {
      return;
    }
    try {
      // A negative ID signals the whole process group: the script's shell, Node.js and its child.
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The group has already exited.
    }
  });
  let output = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: string): void => {
      output += chunk;
      const match = /^seen (\{.*\})$/m.exec(output);
      if (match?.[1] !== undefined) {
        const seen = seenSchema.safeParse(JSON.parse(match[1]));
        if (seen.success) {
          resolve(seen.data);
        } else {
          reject(seen.error);
        }
      }
    };
    child.stdout.setEncoding("utf8").on("data", onData);
    child.stderr.setEncoding("utf8").on("data", onData);
    child.once("close", (code) => {
      reject(
        new Error(
          `the script exited with code ${String(code)} before the stand-in ran:\n${output}`,
        ),
      );
    });
  });
}

describe.for(["dev", "start"] as const)("the API's %s script", { timeout: 10_000 }, (name) => {
  const script = scripts[name];

  it("reads apps/api/.env", async () => {
    expect(await variablesSeenBy(script, "API_PORT=4321\nLOG_LEVEL=warn\n")).toEqual({
      API_PORT: "4321",
      LOG_LEVEL: "warn",
    });
  });

  it("lets a variable set in the environment win over the file", async () => {
    const seen = await variablesSeenBy(script, "API_PORT=4321\nLOG_LEVEL=warn\n", {
      LOG_LEVEL: "error",
    });

    expect(seen).toEqual({ API_PORT: "4321", LOG_LEVEL: "error" });
  });

  it("runs without apps/api/.env", async () => {
    expect(await variablesSeenBy(script, undefined)).toEqual({ API_PORT: null, LOG_LEVEL: null });
  });
});
