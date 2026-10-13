import { spawn } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// `pnpm typecheck` runs each package's `typecheck` script. These tests run the web app's script
// on a copy of the app, so they can put generated files in its .next folder without touching this
// checkout's.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = join(repoRoot, "apps", "web");

const webScripts = z
  .object({ scripts: z.object({ typecheck: z.string() }) })
  .parse(JSON.parse(await readFile(join(webRoot, "package.json"), "utf8"))).scripts;

/**
 * Whether a file or folder of the web app belongs in the copy: everything except installed
 * dependencies, generated files and local .env settings, as in a fresh checkout.
 */
function isCheckedIn(path: string): boolean {
  const name = basename(path);
  return (
    !["node_modules", ".next", "next-env.d.ts"].includes(name) &&
    (!name.startsWith(".env") || name === ".env.example")
  );
}

/**
 * Copies the web app (and the base tsconfig it extends) into a temporary folder, using this
 * checkout's installed dependencies, and writes `files` into the copy.
 */
async function copyWebApp(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "apex-typecheck-")));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const copy = join(dir, "apps", "web");
  await copyFile(join(repoRoot, "tsconfig.base.json"), join(dir, "tsconfig.base.json"));
  await cp(webRoot, copy, { recursive: true, filter: isCheckedIn });
  await symlink(join(webRoot, "node_modules"), join(copy, "node_modules"), "dir");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(copy, path)), { recursive: true });
    await writeFile(join(copy, path), content);
  }
  return copy;
}

/** Runs the web app's `typecheck` script in `cwd`; resolves with its exit code and output. */
function typecheck(cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", webScripts.typecheck], {
      cwd,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        PATH: [
          join(webRoot, "node_modules", ".bin"),
          dirname(process.execPath),
          process.env["PATH"],
        ]
          .filter((entry) => entry !== undefined)
          .join(delimiter),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: string): void => {
      output += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, output });
    });
  });
}

/**
 * What `next dev` leaves in .next/dev/types once the dev server has stopped and a route it served
 * has been deleted: a validator that imports the deleted page.
 */
const staleDevTypes = {
  ".next/dev/types/validator.ts":
    '// Validate ../../../src/app/garage/page.tsx\nimport type {} from "../../../src/app/garage/page.js";\n',
};

describe("the web app's type check", { timeout: 60_000 }, () => {
  it("passes when next dev's copy of the route types names a deleted page", async () => {
    const result = await typecheck(await copyWebApp(staleDevTypes));

    expect(result.code, result.output).toBe(0);
  });

  it("still reports a type error in the app's own code, and only that", async () => {
    const result = await typecheck(
      await copyWebApp({
        ...staleDevTypes,
        "src/app/broken.ts": 'export const port: number = "3000";\n',
      }),
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("src/app/broken.ts(1,14): error TS2322");
    expect(result.output).not.toContain(".next/dev");
  });
});
