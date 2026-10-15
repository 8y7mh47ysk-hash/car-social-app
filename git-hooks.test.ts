import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

// These tests run the real hook scripts in .husky/ the way husky runs them, `sh -e .husky/<hook>`
// with node_modules/.bin on PATH: commit-msg against this repository's commitlint config, and
// pre-commit against this repository's lint-staged config in a scratch git repository, with
// stand-ins for ESLint, Prettier, pnpm and Vitest that record how they were called.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const rootBin = join(repoRoot, "node_modules", ".bin");

/** The root package.json's scripts. */
const rootScripts = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))).scripts;

/** The README's section "Git hooks". */
const readmeGitHooks = /^## Git hooks\n([\s\S]*?)^## /m.exec(
  await readFile(join(repoRoot, "README.md"), "utf8"),
)?.[1];
if (readmeGitHooks === undefined) {
  throw new Error('README.md has no section "Git hooks"');
}

/** The shell code blocks of the README's section "Git hooks", in order. */
const gitHooksReadmeBlocks = [...readmeGitHooks.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map(
  ([, block = ""]) => block,
);

interface Result {
  readonly code: number | null;
  readonly output: string;
}

/**
 * The environment for a hook run: git variables from an outer git process are dropped (when these
 * tests run inside the pre-commit hook, GIT_INDEX_FILE points at this repository's index), and so
 * is HUSKY (HUSKY=0 in the shell would skip the hooks that git runs), the machine's global and
 * system git config are ignored, colours are off, and `bins` come first on PATH, followed by the
 * directory of the running Node.js.
 */
function hookEnv(
  bins: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && name !== "HUSKY" && name !== "FORCE_COLOR") {
      env[name] = value;
    }
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NO_COLOR: "1",
    PATH: [...bins, dirname(process.execPath), process.env["PATH"] ?? ""].join(delimiter),
    ...extra,
  };
}

/** Resolves with a started command's exit code and combined output once it has exited. */
function finished(child: ChildProcessByStdio<null, Readable, Readable>): Promise<Result> {
  return new Promise((resolve, reject) => {
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

/** Runs a command to completion and returns its exit code and its combined output. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Result> {
  return finished(spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }));
}

describe("commit-msg hook", { timeout: 20_000 }, () => {
  const coAuthoredBy = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
  let messageDir = "";

  beforeAll(async () => {
    messageDir = await mkdtemp(join(tmpdir(), "apex-commit-msg-"));
  });

  afterAll(async () => {
    await rm(messageDir, { recursive: true, force: true });
  });

  /** Runs .husky/commit-msg on a message, as git does for `git commit -m <message>`. */
  async function commitMsgHook(message: string): Promise<Result> {
    const file = join(await mkdtemp(join(messageDir, "commit-")), "COMMIT_EDITMSG");
    await writeFile(file, message);
    return run("sh", ["-e", ".husky/commit-msg", file], repoRoot, hookEnv([rootBin]));
  }

  it.concurrent.for([
    ["a type, a scope and a subject", "feat(api): add the health route\n"],
    [
      "a body and the Co-Authored-By trailer, each after a blank line",
      `docs: explain the git hooks\n\nSay what they check and how to skip them.\n\n${coAuthoredBy}\n`,
    ],
    ["the Co-Authored-By trailer as the only footer", `fix: reject port 0\n\n${coAuthoredBy}\n`],
    [
      "names in backticks or quotes in a lowercase subject",
      'build: upgrade `Next.js` and "TypeScript"\n',
    ],
    [
      "a breaking change marked with ! and a BREAKING CHANGE footer",
      "feat(api)!: remove the v1 routes\n\nThe old routes are gone.\n\nBREAKING CHANGE: use /v2.\n",
    ],
    ["a subject of 72 characters", `test: ${"s".repeat(72)}\n`],
    ["a body line of 100 characters", `chore: tidy up\n\n${"b".repeat(100)}\n`],
    [
      "a longer body line that holds a URL",
      `docs: cite the source\n\nSee https://example.com/${"u".repeat(100)}\n`,
    ],
    ["git's merge message", "Merge branch 'w0/build/alpha'\n"],
    [
      "git's revert message",
      `Revert "feat(api): add the health route"\n\nThis reverts commit ${"0".repeat(40)}.\n`,
    ],
    ["a fixup! commit for git rebase --autosquash", "fixup! feat(api): add the health route\n"],
    [
      "the comment lines and diff that git adds for an editor, however long",
      `feat: add the garage page\n\n# ${"c".repeat(120)}\n` +
        `# ------------------------ >8 ------------------------\n+${"d".repeat(120)}\n`,
    ],
  ] as const)("accepts %s", async ([, message], { expect }) => {
    const result = await commitMsgHook(message);

    expect(result.code, result.output).toBe(0);
  });

  it.concurrent.for([
    ["no type", "add the health route\n", ["type-empty", "subject-empty"]],
    ["an unknown type", "feature: add the health route\n", ["type-enum"]],
    ["a capitalised type", "Feat: add the health route\n", ["type-case"]],
    ["no space after the colon", "feat:add the health route\n", ["type-empty", "subject-empty"]],
    ["an uppercase scope", "feat(API): add the health route\n", ["scope-case"]],
    ["a capitalised subject", "feat: Add the health route\n", ["subject-case"]],
    ["a capital letter later in the subject", "feat: add the Next.js app\n", ["subject-case"]],
    [
      "a subject that ends with a full stop",
      "feat: add the health route.\n",
      ["subject-full-stop"],
    ],
    ["a subject of 73 characters", `test: ${"s".repeat(73)}\n`, ["subject-max-length"]],
    [
      "a first line over 100 characters",
      `feat(${"x".repeat(30)}): ${"s".repeat(70)}\n`,
      ["header-max-length"],
    ],
    [
      "a body line of 101 characters",
      `chore: tidy up\n\n${"b".repeat(101)}\n`,
      ["body-max-line-length"],
    ],
    [
      "a body with no blank line after the subject",
      "feat: add the health route\nIt returns ok.\n",
      ["body-leading-blank"],
    ],
    [
      "a trailer with no blank line after the subject",
      `fix: reject port 0\n${coAuthoredBy}\n`,
      ["footer-leading-blank"],
    ],
    [
      "a trailer with no blank line after the body",
      `fix: reject port 0\n\nPort 0 picks a random port.\n${coAuthoredBy}\n`,
      ["footer-leading-blank"],
    ],
    [
      "a BREAKING CHANGE footer with no blank line before it",
      "feat!: remove the v1 routes\n\nThe old routes are gone.\nBREAKING CHANGE: use /v2.\n",
      ["footer-leading-blank"],
    ],
    [
      "a body line that starts with a word and an issue-style #N, as a footer would",
      "docs: order the build log\n\nThe merge appended the entries in merge order, so\n" +
        "the #6 entry came after #7.\n",
      ["footer-leading-blank"],
    ],
  ] as const)("rejects %s", async ([, message, rules], { expect }) => {
    const result = await commitMsgHook(message);

    expect(result.code, result.output).toBe(1);
    for (const rule of rules) {
      expect(result.output).toContain(`[${rule}]`);
    }
  });
});

describe("pre-commit hook", { timeout: 30_000 }, () => {
  /** The tools that lint-staged.config.ts runs. The tests replace them with stand-ins. */
  const tools = ["eslint", "prettier", "pnpm", "vitest"] as const;

  // The commands lint-staged.config.ts runs; lint-staged appends the matching staged files.
  const eslint = "eslint --max-warnings=0 --no-warn-ignored --no-error-on-unmatched-pattern --fix";
  const prettier = "prettier --write --no-error-on-unmatched-pattern";
  const prettierOther = "prettier --write --ignore-unknown --no-error-on-unmatched-pattern";
  const typecheck = "pnpm typecheck";
  const relatedTests = "vitest related --run --passWithNoTests";

  /**
   * The stand-in for each tool: appends its name and arguments to $STUB_LOG, appends a line to
   * each file it is given if $STUB_FIX names it (as a fixer would), fails if $STUB_FAIL names it,
   * and runs until it is killed if $STUB_BLOCK names it. The vitest stand-in, which runs last,
   * also logs `git status`: what the working tree held while the tasks ran.
   */
  const stub = `#!/bin/sh
name=\${0##*/}
printf '%s\\n' "$name $*" >> "$STUB_LOG"
if [ "$name" = vitest ]; then git status --porcelain --untracked-files=all >> "$STUB_LOG"; fi
if [ "$name" = "\${STUB_FIX-}" ]; then
  for arg; do case $arg in /*) printf 'fixed\\n' >> "$arg" ;; esac; done
fi
if [ "$name" = "\${STUB_FAIL-}" ]; then echo "$name failed"; exit 1; fi
if [ "$name" = "\${STUB_BLOCK-}" ]; then exec sleep 60; fi
`;

  interface Repo {
    /** The repository's top-level directory. */
    readonly root: string;
    /** Runs git in the repository and returns its output; throws if git fails. */
    readonly git: (...args: string[]) => Promise<string>;
    /** Writes a file in the repository, creating its directory. */
    readonly write: (path: string, content: string) => Promise<void>;
    /** Runs .husky/pre-commit. The options name a stand-in that fixes files or fails. */
    readonly preCommit: (options?: { fix?: string; fail?: string }) => Promise<Result>;
    /**
     * Starts .husky/pre-commit in a process group of its own, as a terminal runs `git commit`,
     * with the stand-in for `block` running until it is killed. Returns the ID of that group and
     * the hook's result.
     */
    readonly startPreCommit: (block: string) => Started;
    /**
     * Starts `git merge --no-ff --no-edit <branch>` in a process group of its own, as a terminal
     * runs it, with the stand-in for `block` running until it is killed. Returns the ID of that
     * group and the merge's result.
     */
    readonly startMerge: (branch: string, block: string) => Started;
    /**
     * Commits copies of this repository's pre-commit and pre-merge-commit hooks and installs them
     * with the root package.json's `prepare` script, as `pnpm install` does, so that git itself
     * runs them from then on.
     */
    readonly installHooks: () => Promise<void>;
    /** Runs a shell script in the repository with `sh -e` and returns its result. */
    readonly shell: (script: string) => Promise<Result>;
    /**
     * Runs `git merge --no-ff --no-edit <branch>` and returns its result. The options name a
     * stand-in that fails.
     */
    readonly merge: (branch: string, options?: { fail?: string }) => Promise<Result>;
    /**
     * Runs `git commit --no-edit`, which finishes a merge that stopped, and returns its result.
     * The options name a stand-in that fails.
     */
    readonly finishMerge: (options?: { fail?: string }) => Promise<Result>;
    /** The stand-ins' log lines, with paths relative to the repository. */
    readonly calls: () => Promise<string[]>;
    /** `git status --porcelain` as lines. */
    readonly status: () => Promise<string[]>;
  }

  /** A command started in a process group of its own: the group's ID and the command's result. */
  interface Started {
    readonly group: number;
    readonly result: Promise<Result>;
  }

  /**
   * Creates a git repository in a temporary directory with this repository's
   * lint-staged.config.ts, the stand-ins (ignored, like node_modules) and a first commit.
   */
  async function createRepo(): Promise<Repo> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "apex-pre-commit-")));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const root = join(dir, "repo");
    const log = join(dir, "stub.log");
    const stubBin = join(root, "node_modules", ".bin");
    const env = hookEnv([stubBin, rootBin], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      STUB_LOG: log,
    });

    const git = async (...args: string[]): Promise<string> => {
      const result = await run("git", args, root, env);
      if (result.code !== 0) {
        throw new Error(`git ${args.join(" ")} failed:\n${result.output}`);
      }
      return result.output;
    };
    const write = async (path: string, content: string): Promise<void> => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    };
    const hook = join(repoRoot, ".husky", "pre-commit");
    const startInGroup = (command: string, args: readonly string[], block: string): Started => {
      const child = spawn(command, args, {
        cwd: root,
        env: { ...env, STUB_BLOCK: block },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const group = child.pid;
      if (group === undefined) {
        throw new Error(`could not start ${command}`);
      }
      // If the test fails before it stops the command, the blocked stand-in must not outlive it.
      onTestFinished(() => {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          // The group has already exited.
        }
      });
      return { group, result: finished(child) };
    };

    await mkdir(stubBin, { recursive: true });
    for (const tool of tools) {
      await writeFile(join(stubBin, tool), stub);
      await chmod(join(stubBin, tool), 0o755);
    }
    await copyFile(join(repoRoot, "lint-staged.config.ts"), join(root, "lint-staged.config.ts"));
    await write("package.json", '{ "private": true, "type": "module" }\n');
    await write(".gitignore", "node_modules/\n");
    await write("README.md", "# Test\n");
    await write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    await write("src/app.ts", "export const app = 1;\n");
    await write("src/util.ts", "export const util = 1;\n");
    await git("init", "--quiet", "--initial-branch=main");
    await git("add", "--all");
    await git("commit", "--quiet", "--message", "chore: start");

    return {
      root,
      git,
      write,
      preCommit: ({ fix = "", fail = "" } = {}) =>
        run("sh", ["-e", hook], root, { ...env, STUB_FIX: fix, STUB_FAIL: fail }),
      startPreCommit: (block) => startInGroup("sh", ["-e", hook], block),
      startMerge: (branch, block) =>
        startInGroup("git", ["merge", "--no-ff", "--no-edit", branch], block),
      installHooks: async () => {
        for (const hookName of ["pre-commit", "pre-merge-commit"]) {
          await write(
            `.husky/${hookName}`,
            await readFile(join(repoRoot, ".husky", hookName), "utf8"),
          );
        }
        await git("add", ".husky");
        await git("commit", "--quiet", "--message", "chore: add the git hooks");
        const prepare = rootScripts["prepare"];
        if (prepare === undefined) {
          throw new Error("package.json has no prepare script, so pnpm install installs no hooks");
        }
        const installed = await run("sh", ["-c", prepare], root, env);
        if (installed.code !== 0) {
          throw new Error(`the prepare script failed:\n${installed.output}`);
        }
      },
      shell: (script) => run("sh", ["-e", "-c", script], root, env),
      merge: (branch, { fail = "" } = {}) =>
        run("git", ["merge", "--no-ff", "--no-edit", branch], root, { ...env, STUB_FAIL: fail }),
      finishMerge: ({ fail = "" } = {}) =>
        run("git", ["commit", "--no-edit"], root, { ...env, STUB_FAIL: fail }),
      calls: async () =>
        (await readFile(log, "utf8").catch(() => ""))
          .replaceAll(`${root}/`, "")
          .split("\n")
          .filter((line) => line !== ""),
      status: async () =>
        (await git("status", "--porcelain")).split("\n").filter((line) => line !== ""),
    };
  }

  it("lints, formats, type-checks and tests exactly the staged snapshot, in that order", async () => {
    const repo = await createRepo();
    await repo.write("src/app.ts", "export const app = 2;\n");
    await repo.write("README.md", "# Test\n\nMore.\n");
    await repo.git("add", "src/app.ts", "README.md");
    // Not part of the commit: an unstaged edit to a staged file, an unstaged edit to another
    // file and an untracked file.
    await repo.write("src/app.ts", "export const app = 3;\n");
    await repo.write("src/util.ts", "export const util = 2;\n");
    await repo.write("notes.txt", "draft\n");

    const result = await repo.preCommit();

    expect(result.code, result.output).toBe(0);
    expect(await repo.calls()).toEqual([
      `${eslint} src/app.ts`,
      `${prettier} src/app.ts`,
      `${prettierOther} README.md`,
      typecheck,
      `${relatedTests} README.md src/app.ts`,
      // git status while the tasks ran: only the staged changes were in the working tree.
      "M  README.md",
      "M  src/app.ts",
    ]);
    // Everything that was set aside is back, and lint-staged's backup stash is gone.
    expect(await repo.status()).toEqual([
      "M  README.md",
      "MM src/app.ts",
      " M src/util.ts",
      "?? notes.txt",
    ]);
    expect(await readFile(join(repo.root, "src/app.ts"), "utf8")).toBe("export const app = 3;\n");
    expect(await repo.git("stash", "list")).toBe("");
  });

  it("formats and tests a documentation change without linting or type-checking it", async () => {
    const repo = await createRepo();
    await repo.write("docs/guide.md", "# Guide\n");
    await repo.git("add", "docs/guide.md");

    const result = await repo.preCommit();

    expect(result.code, result.output).toBe(0);
    expect(await repo.calls()).toEqual([
      `${prettierOther} docs/guide.md`,
      `${relatedTests} docs/guide.md`,
      "A  docs/guide.md",
    ]);
  });

  it("type-checks when the lockfile changes", async () => {
    const repo = await createRepo();
    await repo.write("pnpm-lock.yaml", "lockfileVersion: '9.1'\n");
    await repo.git("add", "pnpm-lock.yaml");

    const result = await repo.preCommit();

    expect(result.code, result.output).toBe(0);
    expect(await repo.calls()).toContain(typecheck);
  });

  it("checks a commit that only deletes a file", async () => {
    const repo = await createRepo();
    await repo.git("rm", "--quiet", "src/util.ts");

    const result = await repo.preCommit();

    expect(result.code, result.output).toBe(0);
    expect(await repo.calls()).toEqual([
      `${eslint} src/util.ts`,
      `${prettier} src/util.ts`,
      typecheck,
      `${relatedTests} src/util.ts`,
      "D  src/util.ts",
    ]);
  });

  it("adds the fixers' changes to the commit", async () => {
    const repo = await createRepo();
    await repo.write("src/app.ts", "export const app = 2;\n");
    await repo.git("add", "src/app.ts");

    const result = await repo.preCommit({ fix: "prettier" });

    expect(result.code, result.output).toBe(0);
    expect(await repo.git("show", ":src/app.ts")).toBe("export const app = 2;\nfixed\n");
    expect(await repo.status()).toEqual(["M  src/app.ts"]);
  });

  it("does nothing when nothing is staged", async () => {
    const repo = await createRepo();
    await repo.write("src/app.ts", "export const app = 2;\n");

    const result = await repo.preCommit();

    expect(result.code, result.output).toBe(0);
    expect(await repo.calls()).toEqual([]);
    expect(await repo.status()).toEqual([" M src/app.ts"]);
  });

  it.for(tools)(
    "rejects the commit when %s fails, still runs the other checks and restores everything",
    async (tool) => {
      const repo = await createRepo();
      await repo.write("src/app.ts", "export const app = 2;\n");
      await repo.git("add", "src/app.ts");
      await repo.write("src/util.ts", "export const util = 2;\n");
      await repo.write("notes.txt", "draft\n");

      const result = await repo.preCommit({ fail: tool });

      expect(result.code).toBe(1);
      expect(result.output).toContain(`${tool} failed`);
      expect(await repo.calls()).toEqual([
        `${eslint} src/app.ts`,
        `${prettier} src/app.ts`,
        typecheck,
        `${relatedTests} src/app.ts`,
        "M  src/app.ts",
      ]);
      expect(await repo.status()).toEqual(["M  src/app.ts", " M src/util.ts", "?? notes.txt"]);
      expect(await repo.git("stash", "list")).toBe("");
    },
  );

  /**
   * Prepares a merge of a branch "feature", which changes src/util.ts, into main, which gets
   * another commit that changes README.md. With `conflict`, the branch changes README.md too, so
   * the merge stops there. Then installs the hooks, so git runs them for the merge.
   */
  async function prepareMerge({ conflict = false } = {}): Promise<Repo> {
    const repo = await createRepo();
    await repo.git("switch", "--quiet", "--create", "feature");
    await repo.write("src/util.ts", "export const util = 2;\n");
    if (conflict) {
      await repo.write("README.md", "# Test\n\nFrom the feature.\n");
    }
    await repo.git("commit", "--quiet", "--all", "--message", "feat: change util");
    await repo.git("switch", "--quiet", "main");
    await repo.write("README.md", "# Test\n\nMore.\n");
    await repo.git("commit", "--quiet", "--all", "--message", "docs: say more");
    await repo.installHooks();
    return repo;
  }

  // `git merge` runs pre-merge-commit, not pre-commit, when it commits without conflicts.
  describe("for a merge that git commits itself", () => {
    it("runs the same checks on what the merge brings in", async () => {
      const repo = await prepareMerge();

      const result = await repo.merge("feature");

      expect(result.code, result.output).toBe(0);
      expect(await repo.calls()).toEqual([
        `${eslint} src/util.ts`,
        `${prettier} src/util.ts`,
        typecheck,
        `${relatedTests} src/util.ts`,
        "M  src/util.ts",
      ]);
      // A merge commit, with both branches as parents.
      expect((await repo.git("log", "-1", "--format=%p")).trim().split(" ")).toHaveLength(2);
    });

    it("stops the merge when a check fails, leaving it to be finished or aborted", async () => {
      const repo = await prepareMerge();
      const before = await repo.git("rev-parse", "HEAD");

      const result = await repo.merge("feature", { fail: "pnpm" });

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("pnpm failed");
      expect(result.output).toContain("Not committing merge");
      expect(await repo.git("rev-parse", "HEAD")).toBe(before);
      expect(await repo.status()).toEqual(["M  src/util.ts"]);
      await repo.git("merge", "--abort");
      expect(await repo.status()).toEqual([]);
    });
  });

  // A merge that stopped, for conflicts or because pre-merge-commit failed, is finished with
  // `git commit`, which runs pre-commit while the merge is still in progress (MERGE_HEAD exists).
  // lint-staged on its own would then check only the files that both branches changed.
  describe("for a merge finished with git commit", () => {
    it("checks all that the merge brings in again, so a check that still fails stops it", async () => {
      const repo = await prepareMerge();
      expect((await repo.merge("feature", { fail: "pnpm" })).code).not.toBe(0);
      const before = await repo.git("rev-parse", "HEAD");
      const earlierCalls = (await repo.calls()).length;
      // Not part of the merge: an unstaged edit and an untracked file.
      await repo.write("src/app.ts", "export const app = 2;\n");
      await repo.write("notes.txt", "draft\n");

      const stillFailing = await repo.finishMerge({ fail: "pnpm" });

      expect(stillFailing.code).not.toBe(0);
      expect(stillFailing.output).toContain("pnpm failed");
      expect(await repo.git("rev-parse", "HEAD")).toBe(before);
      expect((await repo.calls()).slice(earlierCalls)).toEqual([
        `${eslint} src/util.ts`,
        `${prettier} src/util.ts`,
        typecheck,
        `${relatedTests} src/util.ts`,
        // git status while the tasks ran: the edit and the new file were set aside.
        "M  src/util.ts",
      ]);
      // Everything is as it was: the merge is still in progress, with its changes staged.
      expect(await repo.status()).toEqual([" M src/app.ts", "M  src/util.ts", "?? notes.txt"]);
      await repo.git("rev-parse", "--quiet", "--verify", "MERGE_HEAD");
      expect(await repo.git("stash", "list")).toBe("");

      const fixed = await repo.finishMerge();

      expect(fixed.code, fixed.output).toBe(0);
      expect((await repo.git("log", "-1", "--format=%p")).trim().split(" ")).toHaveLength(2);
      expect(await repo.git("show", "HEAD:src/util.ts")).toBe("export const util = 2;\n");
      expect(await repo.status()).toEqual([" M src/app.ts", "?? notes.txt"]);
      expect(await repo.git("stash", "list")).toBe("");
    });

    it("checks the files that only one branch changed, not only the conflicts", async () => {
      const repo = await prepareMerge({ conflict: true });
      expect((await repo.merge("feature")).code).not.toBe(0);
      expect(await repo.status()).toEqual(["UU README.md", "M  src/util.ts"]);
      await repo.write("README.md", "# Test\n\nMore, and from the feature.\n");
      await repo.git("add", "README.md");

      const result = await repo.finishMerge();

      expect(result.code, result.output).toBe(0);
      expect(await repo.calls()).toEqual([
        `${eslint} src/util.ts`,
        `${prettier} src/util.ts`,
        `${prettierOther} README.md`,
        typecheck,
        `${relatedTests} README.md src/util.ts`,
        "M  README.md",
        "M  src/util.ts",
      ]);
      expect((await repo.git("log", "-1", "--format=%p")).trim().split(" ")).toHaveLength(2);
    });
  });

  describe("when the commit is stopped while a check runs", () => {
    /** The working tree before each commit: a partly staged file, an edit and a new file. */
    const before = ["MM src/app.ts", " M src/util.ts", "?? notes.txt"];

    /** Picks the README's code block with the steps after a stopped commit. */
    const commitSteps = (block: string): boolean =>
      block.includes("git stash apply --index") && !block.includes("MERGE_HEAD");
    /** Picks the README's code block with the steps after a stopped commit that ends a merge. */
    const mergeCommitSteps = (block: string): boolean => block.includes("MERGE_HEAD");
    /** Picks the README's code block that runs a stopped `git merge` again. */
    const mergeAgainSteps = (block: string): boolean => block.includes("git reset --merge");

    /**
     * Runs the steps in the README's code block that `which` picks, from its section "Git hooks",
     * with the placeholders filled in: `stash@{n}` and `<id>` name the hook's backup, the
     * repository's only stash entry, and `<branch>` the branch that was being merged.
     */
    async function runReadmeSteps(repo: Repo, which: (block: string) => boolean): Promise<void> {
      const blocks = gitHooksReadmeBlocks.filter(which);
      expect(blocks, "the README's code blocks that match").toHaveLength(1);
      let script = blocks[0] ?? "";
      if (script.includes("stash@{n}")) {
        const id = /lint-staged automatic backup \((\w+)\)/.exec(
          await repo.git("stash", "list"),
        )?.[1];
        expect(id, "the hook's backup in the stash").toBeDefined();
        script = script.replaceAll("stash@{n}", "stash@{0}").replaceAll("<id>", id ?? "");
      }
      const result = await repo.shell(script.replaceAll("<branch>", "feature"));
      expect(result.code, result.output).toBe(0);
    }

    /** lint-staged's working folders in the repository's git folder: one per unfinished run. */
    async function workingFolders(repo: Repo): Promise<string[]> {
      const folder = join(repo.root, ".git", "lint-staged");
      return existsSync(folder) ? await readdir(folder) : [];
    }

    /** Sends `signal` to the process group `group` as soon as the type check runs. */
    async function signalDuringTypeCheck(
      repo: Repo,
      group: number,
      signal: NodeJS.Signals,
    ): Promise<void> {
      await vi.waitFor(
        async () => {
          expect(await repo.calls()).toContain(typecheck);
        },
        { timeout: 20_000, interval: 20 },
      );
      process.kill(-group, signal);
    }

    /**
     * Prepares that working tree, starts the hook and sends `signal` to its process group, as
     * Ctrl+C in a terminal does for SIGINT, while the type check runs: lint-staged has set aside
     * the edit and the new file by then.
     */
    async function stopCommit(signal: NodeJS.Signals): Promise<{ repo: Repo; result: Result }> {
      const repo = await createRepo();
      await repo.write("src/app.ts", "export const app = 2;\n");
      await repo.git("add", "src/app.ts");
      await repo.write("src/app.ts", "export const app = 3;\n");
      await repo.write("src/util.ts", "export const util = 2;\n");
      await repo.write("notes.txt", "draft\n");
      expect(await repo.status()).toEqual(before);

      const hook = repo.startPreCommit("pnpm");
      await signalDuringTypeCheck(repo, hook.group, signal);
      return { repo, result: await hook.result };
    }

    /** Checks that the files, the index and the stash are exactly as before the commit. */
    async function expectAsBefore(repo: Repo): Promise<void> {
      expect(await repo.status()).toEqual(before);
      expect(await repo.git("show", ":src/app.ts")).toBe("export const app = 2;\n");
      expect(await readFile(join(repo.root, "src/app.ts"), "utf8")).toBe("export const app = 3;\n");
      expect(await readFile(join(repo.root, "src/util.ts"), "utf8")).toBe(
        "export const util = 2;\n",
      );
      expect(await readFile(join(repo.root, "notes.txt"), "utf8")).toBe("draft\n");
      expect(await repo.git("stash", "list")).toBe("");
    }

    it("puts every file back after Ctrl+C (SIGINT)", async () => {
      const { repo, result } = await stopCommit("SIGINT");

      expect(result.code, result.output).not.toBe(0);
      await expectAsBefore(repo);
      expect(await workingFolders(repo)).toEqual([]);
    });

    // lint-staged handles only SIGINT. A closed terminal (SIGHUP), a tool or editor that cancels
    // the commit (SIGTERM) or SIGKILL stops it at once, and the README section "Git hooks" says
    // how to get everything back.
    it.for(["SIGTERM", "SIGHUP", "SIGKILL"] as const)(
      "leaves the edit and the new file in a stash entry after %s; the README's steps restore them",
      async (signal) => {
        const { repo } = await stopCommit(signal);

        expect(await repo.status()).toEqual(["M  src/app.ts"]);
        expect(await repo.git("stash", "list")).toMatch(
          /^stash@\{0\}: On main: lint-staged automatic backup \(\w+\)\n$/,
        );
        expect(await workingFolders(repo)).toHaveLength(1);

        await runReadmeSteps(repo, commitSteps);

        await expectAsBefore(repo);
        expect(await workingFolders(repo)).toEqual([]);
      },
    );

    // git reset --hard and git stash apply both end a merge in progress: without the README's
    // merge steps, the commit after them has only one parent.
    it("keeps a merge in progress when the README's merge steps restore the commit that ends it", async () => {
      const repo = await prepareMerge({ conflict: true });
      expect((await repo.merge("feature")).code).not.toBe(0);
      await repo.write("README.md", "# Test\n\nMore, and from the feature.\n");
      await repo.git("add", "README.md");
      await repo.write("src/app.ts", "export const app = 2;\n");
      await repo.write("notes.txt", "draft\n");
      const merging = ["M  README.md", " M src/app.ts", "M  src/util.ts", "?? notes.txt"];
      expect(await repo.status()).toEqual(merging);

      // The hook that `git commit` runs to finish the merge, stopped as a closed terminal stops it.
      const hook = repo.startPreCommit("pnpm");
      await signalDuringTypeCheck(repo, hook.group, "SIGHUP");
      await hook.result;
      await runReadmeSteps(repo, mergeCommitSteps);

      expect(await repo.status()).toEqual(merging);
      await repo.git("rev-parse", "--quiet", "--verify", "MERGE_HEAD");
      expect(await repo.git("stash", "list")).toBe("");
      expect(await workingFolders(repo)).toEqual([]);
      const result = await repo.finishMerge();
      expect(result.code, result.output).toBe(0);
      expect((await repo.git("log", "-1", "--format=%p")).trim().split(" ")).toHaveLength(2);
      expect(await repo.status()).toEqual([" M src/app.ts", "?? notes.txt"]);
    });

    // Stopping `git merge` itself, as a closed terminal does, stops it before it records the merge.
    it("merges again after git merge was stopped during its checks, as the README says", async () => {
      const repo = await prepareMerge();
      await repo.write("src/app.ts", "export const app = 2;\n");
      await repo.write("notes.txt", "draft\n");
      const head = await repo.git("rev-parse", "HEAD");

      const merge = repo.startMerge("feature", "pnpm");
      await signalDuringTypeCheck(repo, merge.group, "SIGHUP");
      await merge.result;
      expect(existsSync(join(repo.root, ".git", "MERGE_HEAD"))).toBe(false);
      expect(await repo.git("rev-parse", "HEAD")).toBe(head);
      await runReadmeSteps(repo, commitSteps);
      // No merge is in progress, so its change is staged as if it were the user's own.
      expect(await repo.status()).toEqual([" M src/app.ts", "M  src/util.ts", "?? notes.txt"]);

      await runReadmeSteps(repo, mergeAgainSteps);

      expect((await repo.git("log", "-1", "--format=%p")).trim().split(" ")).toHaveLength(2);
      expect(await repo.git("show", "HEAD:src/util.ts")).toBe("export const util = 2;\n");
      expect(await repo.status()).toEqual([" M src/app.ts", "?? notes.txt"]);
      expect(await readFile(join(repo.root, "src/app.ts"), "utf8")).toBe("export const app = 2;\n");
      expect(await repo.git("stash", "list")).toBe("");
    });
  });
});

describe("the pre-commit hook's test step in this repository", { timeout: 60_000 }, () => {
  /**
   * Runs `vitest related` on one file of this repository as the hook does, but only for the
   * shared package's tests (a single quick test file) and listing each test that ran.
   */
  function relatedTests(file: string): Promise<Result> {
    const args = ["related", "--run", "--passWithNoTests", "--project", "shared"];
    return run(
      join(rootBin, "vitest"),
      [...args, "--reporter", "verbose", join(repoRoot, file)],
      repoRoot,
      hookEnv([rootBin]),
    );
  }

  // Each of these matches a `forceRerunTriggers` glob in vitest.config.ts, wherever this checkout
  // lives (Vitest's own defaults match nothing in a checkout inside a hidden directory).
  it.for([
    "package.json",
    "pnpm-lock.yaml",
    "apps/web/tsconfig.json",
    "apps/web/vitest.config.ts",
    "apps/web/vitest.setup.ts",
    // Started as a separate process by its tests, so no test imports it.
    "apps/api/src/server.ts",
    ".husky/pre-commit",
    "commitlint.config.mjs",
    "lint-staged.config.ts",
    // Files that the infra, env-file, CI workflow and env-access tests read instead of importing.
    "docker-compose.yml",
    ".env.example",
    "apps/web/.env.example",
    ".gitignore",
    ".github/workflows/ci.yml",
    "eslint.config.mjs",
  ])("runs every test when %s is staged", async (file) => {
    const result = await relatedTests(file);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("|shared| src/health.test.ts");
  });

  it("runs the tests that import a staged source file", async () => {
    const result = await relatedTests("packages/shared/src/health.ts");

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("|shared| src/health.test.ts");
  });

  it.for(["README.md", "packages/shared/src/app-name.ts"])(
    "runs no tests, and passes, when no test imports %s",
    async (file) => {
      const result = await relatedTests(file);

      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain("No test files found");
      expect(result.output).not.toContain("src/health.test.ts");
    },
  );
});
