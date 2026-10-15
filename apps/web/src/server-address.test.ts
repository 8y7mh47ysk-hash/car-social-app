// @vitest-environment node
// The package scripts run in a shell, not in a browser.

import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// The web app's dev and production servers listen on 127.0.0.1:3000 unless WEB_HOST or WEB_PORT
// says otherwise, so a development server is never reachable from other machines by accident.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

const { scripts } = z
  .object({ scripts: z.object({ dev: z.string(), start: z.string() }) })
  .parse(JSON.parse(await readFile(join(webRoot, "package.json"), "utf8")));

/**
 * Runs a package script with `sh -c`, as pnpm does, with a stand-in `next` that prints the
 * arguments it gets, and with only `extraEnv` set besides PATH and NODE_ENV. Resolves with what it
 * printed.
 */
async function nextArguments(
  script: string,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), "apex-web-scripts-"));
  onTestFinished(() => rm(bin, { recursive: true, force: true }));
  await writeFile(join(bin, "next"), '#!/bin/sh\nprintf "%s\\n" "$*"\n');
  await chmod(join(bin, "next"), 0o755);
  const { stdout } = await promisify(execFile)("sh", ["-c", script], {
    cwd: webRoot,
    env: { NODE_ENV: "test", PATH: [bin, "/usr/bin", "/bin"].join(delimiter), ...extraEnv },
  });
  return stdout.trim();
}

describe.for([
  ["dev", scripts.dev],
  ["start", scripts.start],
] as const)("the %s script", ([command, script]) => {
  it("listens on 127.0.0.1, port 3000, by default", async () => {
    expect(await nextArguments(script)).toBe(`${command} --hostname 127.0.0.1 --port 3000`);
  });

  it("listens where WEB_HOST and WEB_PORT say", async () => {
    expect(await nextArguments(script, { WEB_HOST: "0.0.0.0", WEB_PORT: "3010" })).toBe(
      `${command} --hostname 0.0.0.0 --port 3010`,
    );
  });
});
