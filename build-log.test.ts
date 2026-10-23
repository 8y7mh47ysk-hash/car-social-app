import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

// The "How to verify" steps in docs/BUILD_LOG.md get pasted into terminals, and after a step fails
// people often paste the whole block again. These tests run the steps that set a developer's own
// files aside, in scratch folders and twice over, to check that nothing of the developer's is lost
// or left behind. Vitest cannot see that they read the build log, so a change to the log alone
// runs them in CI but not in the pre-commit hook, as for the README's steps.

const repoRoot = import.meta.dirname;
const buildLog = await readFile(join(repoRoot, "docs", "BUILD_LOG.md"), "utf8");

/** The build log's entry for instruction `n`, from its heading to the next entry's. */
function entry(n: number): string {
  const start = buildLog.indexOf(`\n## #${String(n)} - `);
  const end = buildLog.indexOf("\n## #", start + 1);
  return start === -1 ? "" : buildLog.slice(start, end === -1 ? undefined : end);
}

/** The shell code blocks of a Markdown text, in order. */
function shellBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map(([, block = ""]) => block);
}

/** Shells to paste the steps into: sh, and zsh (macOS's default shell) where it is installed. */
const shells = ["sh", "zsh"].filter((shell) => spawnSync(shell, ["-c", "exit 0"]).status === 0);

/**
 * Runs `script` in `folder` with `shell` and without stopping at a failed command, as lines pasted
 * at a prompt run. zsh runs with -f, so the machine's start-up files play no part.
 */
function paste(shell: string, folder: string, script: string): void {
  const args = shell === "zsh" ? ["-f", "-c", script] : ["-c", script];
  const result = spawnSync(shell, args, { cwd: folder, encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
}

describe("BUILD_LOG #4: the steps that show the API reading apps/api/.env", () => {
  const blocks = shellBlocks(entry(4)).filter((block) => block.includes("apps/api/.env.backup"));
  const [setUp = "", cleanUp = ""] = blocks;
  // The lines that set the developer's file aside and write the copy, without the API's command.
  const fileSteps = setUp
    .split("\n")
    .filter((line) => !line.startsWith("pnpm "))
    .join("\n");

  it("are a block that sets your file aside and a block that cleans up, without comments", () => {
    expect(blocks).toHaveLength(2);
    expect(setUp).toContain("pnpm --filter @apex/api dev");
    expect(cleanUp).not.toContain("pnpm");
    // At its prompt, zsh passes a `#` and the words after it to the command (interactivecomments
    // is off by default).
    expect(blocks.join("\n")).not.toMatch(/(?:^|\s)#/);
  });

  /** A scratch folder laid out like the repository, with the API's template and, if given, `own`. */
  async function checkout(own: string | undefined): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "apex-build-log-"));
    onTestFinished(() => rm(folder, { recursive: true, force: true }));
    await mkdir(join(folder, "apps", "api"), { recursive: true });
    const template = await readFile(join(repoRoot, "apps", "api", ".env.example"), "utf8");
    await writeFile(join(folder, "apps", "api", ".env.example"), template);
    if (own !== undefined) {
      await writeFile(join(folder, "apps", "api", ".env"), own, { mode: 0o600 });
    }
    return folder;
  }

  /** The copy that the steps write: the template plus the port line, readable by its owner only. */
  async function expectCopy(folder: string): Promise<void> {
    const file = join(folder, "apps", "api", ".env");
    expect(await readFile(file, "utf8")).toMatch(
      /^# Template for apps\/api\/\.env[\s\S]*\nAPI_PORT=4010\n$/,
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }

  it.for(shells)("keep your own apps/api/.env when run twice, pasted into %s", async (shell) => {
    const own = "LOG_LEVEL=debug\n";
    const folder = await checkout(own);

    paste(shell, folder, fileSteps);
    paste(shell, folder, fileSteps);

    await expectCopy(folder);
    paste(shell, folder, cleanUp);
    paste(shell, folder, cleanUp);
    expect(await readFile(join(folder, "apps", "api", ".env"), "utf8")).toBe(own);
    expect((await readdir(join(folder, "apps", "api"))).sort()).toEqual([".env", ".env.example"]);
  });

  it.for(shells)(
    "leave no apps/api/.env behind when you had none, pasted into %s",
    async (shell) => {
      const folder = await checkout(undefined);

      paste(shell, folder, fileSteps);
      paste(shell, folder, fileSteps);

      await expectCopy(folder);
      paste(shell, folder, cleanUp);
      paste(shell, folder, cleanUp);
      expect(await readdir(join(folder, "apps", "api"))).toEqual([".env.example"]);
    },
  );
});
