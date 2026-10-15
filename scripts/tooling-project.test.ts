import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

// test-suite.test.ts checks that `pnpm test`, which CI and the pre-commit hook run, runs every
// test file in the repository. It runs in the root config's "tooling" project, with the other
// tests at the repository root (the git hook tests among them), so it cannot notice that project
// being dropped from vitest.config.ts: all of those tests would then stop running and every check
// would still pass. This test, in another project, checks that the tooling project still runs it.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const vitest = join(repoRoot, "node_modules", ".bin", "vitest");
const run = promisify(execFile);

const listedFilesSchema = z.array(z.object({ file: z.string(), projectName: z.string() }));

describe("the tooling project", () => {
  it("runs test-suite.test.ts, which checks that every other test file runs", async () => {
    // Fails with "No projects matched the filter" if the root config has no tooling project.
    const args = ["list", "--filesOnly", "--json", "--project", "tooling"];
    const { stdout } = await run(vitest, args, { cwd: repoRoot });
    const files = listedFilesSchema
      .parse(JSON.parse(stdout))
      .map(({ file }) => relative(repoRoot, file));

    expect(files).toContain("test-suite.test.ts");
  });
});
