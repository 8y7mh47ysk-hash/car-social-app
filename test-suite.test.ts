import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

// `pnpm test`, the pre-commit hook and CI run the projects that the root vitest.config.ts lists.
// A test file that no project includes never runs anywhere, and nothing else would say so: for
// example the tests of a new package whose Vitest config has another name, or a .tsx test in a
// package whose include pattern lists only .ts files. This file runs in the "tooling" project, so
// it cannot notice that project itself being removed from the root config;
// scripts/tooling-project.test.ts checks that from another project.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const vitest = join(repoRoot, "node_modules", ".bin", "vitest");
const run = promisify(execFile);

/** Files named the way Vitest names test files by default. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const listedFilesSchema = z.array(z.object({ file: z.string(), projectName: z.string() }));

/**
 * The test files that git tracks or would add (so not ignored ones, such as those in
 * node_modules) and that exist: a new test file counts before it is staged, and a deleted one no
 * longer counts.
 */
async function testFiles(): Promise<string[]> {
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const files = (await run("git", args, { cwd: repoRoot })).stdout.split("\0");
  return [...new Set(files)].filter(
    (file) => TEST_FILE.test(file) && existsSync(join(repoRoot, file)),
  );
}

/** The test files that `pnpm test` runs, as Vitest lists them for the root config. */
async function runTestFiles(): Promise<string[]> {
  const { stdout } = await run(vitest, ["list", "--filesOnly", "--json"], { cwd: repoRoot });
  return listedFilesSchema.parse(JSON.parse(stdout)).map(({ file }) => relative(repoRoot, file));
}

describe("the test suite", () => {
  it("runs every test file in the repository", async () => {
    const files = await testFiles();

    expect(files.length).toBeGreaterThan(0);
    expect((await runTestFiles()).sort()).toEqual(files.sort());
  });
});
