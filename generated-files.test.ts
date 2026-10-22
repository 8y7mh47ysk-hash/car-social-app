import { execFile, spawnSync } from "node:child_process";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Instruction 1 keeps generated files out of the repository (docs/DECISIONS.md, "Next.js app
// configuration"). If git stopped ignoring one of them, `git add --all` would commit it, and the
// pre-commit hook would set it aside and put it back on every commit, as it does with every
// untracked file. CI starts from a fresh checkout that holds none of these files, so no other check
// notices a rule that goes missing. These tests ask git itself, leaving out the user's own global
// ignore file.

const repoRoot = import.meta.dirname;
const run = promisify(execFile);
const gitWithoutUserExcludes = ["-c", "core.excludesFile=/dev/null"];

/** Whether the repository's ignore rules ignore `path`, a path from the repository's root. */
function isIgnored(path: string): boolean {
  const result = spawnSync(
    "git",
    [...gitWithoutUserExcludes, "check-ignore", "--no-index", "--quiet", path],
    { cwd: repoRoot, encoding: "utf8" },
  );
  // Status 0 means ignored and 1 not ignored; anything else is a failure.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.status === 0;
}

/** A file in each place where the tools in use write files of their own. */
const TOOL_OUTPUT = [
  // pnpm install, at the root and in each package.
  "node_modules/.modules.yaml",
  "apps/web/node_modules/.bin/next",
  // next dev, next build and next typegen.
  "apps/web/.next/types/routes.d.ts",
  "apps/web/next-env.d.ts",
  // The build output that the README's checks before a push save, as CI's build step does.
  "build.log",
];

/** Every tsconfig file in the repository. */
const tsconfigs = (
  await run("git", ["ls-files", "-z", "*tsconfig*.json"], { cwd: repoRoot })
).stdout
  .split("\0")
  .filter((file) => file !== "");

const showConfigSchema = z.object({
  compilerOptions: z.looseObject({ outDir: z.string().optional() }),
});

/** The folders that the TypeScript builds write to: each tsconfig's outDir, after every extends. */
const outDirs = (
  await Promise.all(
    tsconfigs.map(async (tsconfig) => {
      const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
      const { stdout } = await run(tsc, ["--showConfig", "--project", tsconfig], {
        cwd: repoRoot,
      });
      const { outDir } = showConfigSchema.parse(JSON.parse(stdout)).compilerOptions;
      return outDir === undefined ? [] : [posix.join(posix.dirname(tsconfig), outDir)];
    }),
  )
).flat();

describe("git's ignore rules", () => {
  it.for(TOOL_OUTPUT)("ignore %s, which a tool writes", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it("know the folders that the TypeScript builds write to", () => {
    expect(outDirs).toEqual(expect.arrayContaining(["apps/api/dist", "packages/shared/dist"]));
  });

  it("ignore what every TypeScript build writes", () => {
    const tracked = outDirs.filter((outDir) => !isIgnored(`${outDir}/index.js`));

    expect(tracked).toEqual([]);
  });

  // A rule that matches files the repository keeps, such as `*.log` matching a committed log,
  // would make `git add` skip new files of that kind without a word.
  it("ignore no file that the repository tracks", async () => {
    const { stdout } = await run(
      "git",
      [...gitWithoutUserExcludes, "ls-files", "-z", "--cached", "--ignored", "--exclude-standard"],
      { cwd: repoRoot },
    );

    expect(stdout.split("\0").filter((file) => file !== "")).toEqual([]);
  });
});
