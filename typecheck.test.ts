import { execFile, spawn } from "node:child_process";
import {
  chmod,
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
import { promisify } from "node:util";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// `pnpm typecheck` checks the root files and then runs each package's `typecheck` script. These
// tests run the root script on a stand-in workspace, and the web app's script on a copy of the
// app, so they can put generated files in its .next folder without touching this checkout's.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = join(repoRoot, "apps", "web");

const typecheckScript = z.object({ scripts: z.object({ typecheck: z.string() }) });

const rootScripts = typecheckScript.parse(
  JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")),
).scripts;

const webScripts = typecheckScript.parse(
  JSON.parse(await readFile(join(webRoot, "package.json"), "utf8")),
).scripts;

/**
 * Runs a package.json script with `sh -c` in `cwd`, as pnpm does, with `bins` and the running
 * Node.js first on PATH; resolves with its exit code and output. Settings that an outer pnpm
 * exports to the scripts it runs are left out of the environment.
 */
function runScript(
  script: string,
  cwd: string,
  bins: readonly string[],
): Promise<{ code: number | null; output: string }> {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(npm|pnpm)_config_/i.test(name)) {
      env[name] = value;
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", script], {
      cwd,
      env: {
        ...env,
        NEXT_TELEMETRY_DISABLED: "1",
        PATH: [...bins, dirname(process.execPath), process.env["PATH"]]
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
 * Creates a pnpm workspace with two packages whose `typecheck` scripts stand in for type checks.
 * With `failingPackages`, "first" fails at once and "second" a second later; otherwise both pass.
 * Each writes its name to checks.log first, so the log shows which checks got that far. A
 * stand-in `tsc` in its bin folder checks the root files: it writes its arguments to checks.log
 * and passes, or fails with `failingRoot`.
 */
async function stubWorkspace({ failingPackages = false, failingRoot = false } = {}): Promise<{
  dir: string;
  bin: string;
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "apex-typecheck-root-")));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const exit = (fails: boolean): string => `exit ${fails ? "2" : "0"}`;
  const files = {
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "package.json": `${JSON.stringify({ name: "workspace", private: true })}\n`,
    "packages/first/package.json": `${JSON.stringify({
      name: "first",
      private: true,
      scripts: { typecheck: `echo first >> ../../checks.log; ${exit(failingPackages)}` },
    })}\n`,
    "packages/second/package.json": `${JSON.stringify({
      name: "second",
      private: true,
      scripts: { typecheck: `sleep 1; echo second >> ../../checks.log; ${exit(failingPackages)}` },
    })}\n`,
    "bin/tsc": `#!/bin/sh\necho "tsc $*" >> checks.log\n${exit(failingRoot)}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await chmod(join(dir, "bin", "tsc"), 0o755);
  return { dir, bin: join(dir, "bin") };
}

describe("the root type check", { timeout: 60_000 }, () => {
  // `pnpm --recursive` stops the other packages' checks when one fails, unless it runs with
  // --no-bail, and the hook and CI would then show only the first package's errors.
  it("runs every package's check when one fails, so one run shows all their errors", async () => {
    const workspace = await stubWorkspace({ failingPackages: true });

    const result = await runScript(rootScripts.typecheck, workspace.dir, [workspace.bin]);

    expect(result.code, result.output).not.toBe(0);
    const log = await readFile(join(workspace.dir, "checks.log"), "utf8");
    const finished = log.split("\n").filter((line) => line !== "" && !line.startsWith("tsc "));
    expect(finished.sort()).toEqual(["first", "second"]);
  });

  // The root project holds the files that are in no package: the root tests and tool configs,
  // infra/ and scripts/ (tsconfig.json).
  it("also checks the files outside the packages, and fails when they have errors", async () => {
    const workspace = await stubWorkspace({ failingRoot: true });

    const result = await runScript(rootScripts.typecheck, workspace.dir, [workspace.bin]);

    expect(result.code, result.output).not.toBe(0);
    const log = await readFile(join(workspace.dir, "checks.log"), "utf8");
    expect(log).toContain("tsc --project tsconfig.json\n");
  });
});

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
  return runScript(webScripts.typecheck, cwd, [join(webRoot, "node_modules", ".bin")]);
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

  // `next typegen`, which the script runs before tsc, writes .next/types/validator.ts, which checks
  // every page's and layout's exports against Next.js's route types, as `next build` does.
  it("checks each page's exports against Next.js's route types", async () => {
    const result = await typecheck(
      await copyWebApp({ "src/app/garage/page.tsx": 'export default "not a component";\n' }),
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/\.next\/types\/validator\.ts\(\d+,\d+\): error TS\d+/);
  });
});

/** The compiler options that make type checking strict here; tsconfig.base.json sets them all. */
const STRICT_OPTIONS = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  erasableSyntaxOnly: true,
  noUncheckedSideEffectImports: true,
};

const run = promisify(execFile);

/** Every tsconfig file in the repository except the base, which only the others use. */
const tsconfigs = (
  await run("git", ["ls-files", "-z", "*tsconfig*.json"], { cwd: repoRoot })
).stdout
  .split("\0")
  .filter((file) => file !== "" && file !== "tsconfig.base.json");

const resolvedConfigSchema = z.object({
  compilerOptions: z.looseObject({
    lib: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
  }),
});

/** The compiler options that `tsc` uses for a tsconfig file, after every `extends`. */
async function compilerOptions(
  tsconfig: string,
): Promise<z.infer<typeof resolvedConfigSchema>["compilerOptions"]> {
  const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
  const { stdout } = await run(tsc, ["--showConfig", "--project", tsconfig], { cwd: repoRoot });
  return resolvedConfigSchema.parse(JSON.parse(stdout)).compilerOptions;
}

describe("the TypeScript settings", () => {
  it("cover the root files and every package", () => {
    expect(tsconfigs).toEqual(
      expect.arrayContaining([
        "tsconfig.json",
        "apps/api/tsconfig.json",
        "apps/web/tsconfig.json",
        "packages/shared/tsconfig.json",
      ]),
    );
  });

  it.for(tsconfigs)("make %s check types strictly", async (tsconfig) => {
    expect(await compilerOptions(tsconfig)).toMatchObject(STRICT_OPTIONS);
  });

  // Shared code also runs in browsers, so it may use neither Node.js's globals nor the DOM's.
  it("give packages/shared no Node.js or DOM types", async () => {
    const { lib, types } = await compilerOptions("packages/shared/tsconfig.json");

    expect(types).toEqual([]);
    expect(lib).toBeDefined();
    expect(lib?.filter((name) => name.toLowerCase().startsWith("dom"))).toEqual([]);
  });
});
