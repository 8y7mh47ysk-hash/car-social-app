import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";

// These tests run the real hook scripts in .husky/ the way husky runs them, `sh -e .husky/<hook>`
// with node_modules/.bin on PATH: pre-commit against this repository's lint-staged config in a
// scratch git repository, with stand-ins for ESLint, Prettier, pnpm and Vitest that record how
// they were called.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const rootBin = join(repoRoot, "node_modules", ".bin");

interface Result {
  readonly code: number | null;
  readonly output: string;
}

/**
 * The environment for a hook run: git variables from an outer git process are dropped (when these
 * tests run inside the pre-commit hook, GIT_INDEX_FILE points at this repository's index), the
 * machine's global and system git config are ignored, colours are off, and `bins` come first on
 * PATH, followed by the directory of the running Node.js.
 */
function hookEnv(
  bins: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && name !== "FORCE_COLOR") {
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

/** Runs a command to completion and returns its exit code and its combined output. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
   * each file it is given if $STUB_FIX names it (as a fixer would), and fails if $STUB_FAIL names
   * it. The vitest stand-in, which runs last, also logs `git status`: what the working tree held
   * while the tasks ran.
   */
  const stub = `#!/bin/sh
name=\${0##*/}
printf '%s\\n' "$name $*" >> "$STUB_LOG"
if [ "$name" = vitest ]; then git status --porcelain --untracked-files=all >> "$STUB_LOG"; fi
if [ "$name" = "\${STUB_FIX-}" ]; then
  for arg; do case $arg in /*) printf 'fixed\\n' >> "$arg" ;; esac; done
fi
if [ "$name" = "\${STUB_FAIL-}" ]; then echo "$name failed"; exit 1; fi
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
    /** The stand-ins' log lines, with paths relative to the repository. */
    readonly calls: () => Promise<string[]>;
    /** `git status --porcelain` as lines. */
    readonly status: () => Promise<string[]>;
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
        run("sh", ["-e", join(repoRoot, ".husky", "pre-commit")], root, {
          ...env,
          STUB_FIX: fix,
          STUB_FAIL: fail,
        }),
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
});
