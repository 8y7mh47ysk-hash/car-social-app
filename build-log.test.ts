import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

// The "How to verify" steps in docs/BUILD_LOG.md get pasted into terminals, and after a step fails
// people often paste the whole block again. These tests run the steps that set a developer's own
// files aside, and those that try to commit an env file, in scratch folders and over and over, to
// check that nothing of the developer's is lost or left behind. Vitest cannot see that they read
// the build log, so the pre-commit hook runs this file through a task of its own when
// docs/BUILD_LOG.md is staged (lint-staged.config.ts).

const repoRoot = import.meta.dirname;
const buildLog = await readFile(join(repoRoot, "docs", "BUILD_LOG.md"), "utf8");
const apiTemplate = await readFile(join(repoRoot, "apps", "api", ".env.example"), "utf8");

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
 * Shell functions that make mv, cp and rm ask before they overwrite or delete anything, as many
 * people's `alias mv='mv -i'` (and the same for cp and rm) do. The questions read the terminal,
 * where the rest of a pasted block waits, so a step that relies on overwriting must say -f.
 * Here they read an empty input, which answers no.
 */
const CAUTIOUS = [
  'mv() { command mv -i "$@"; }',
  'cp() { command cp -i "$@"; }',
  'rm() { command rm -i "$@"; }',
].join("\n");

/**
 * Runs `script` in `folder` with `shell` and without stopping at a failed command, as lines pasted
 * at a prompt run, and returns what it printed. zsh runs with -f, so the machine's start-up files
 * play no part.
 */
function paste(
  shell: string,
  folder: string,
  script: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const args = shell === "zsh" ? ["-f", "-c", script] : ["-c", script];
  const result = spawnSync(shell, args, { cwd: folder, encoding: "utf8", env, input: "" });
  if (result.error !== undefined) {
    throw result.error;
  }
  return result.stdout + result.stderr;
}

describe("BUILD_LOG #4: the steps that show the API reading apps/api/.env", () => {
  const blocks = shellBlocks(entry(4)).filter((block) => block.includes(".env.set-aside"));
  const [setUp = "", cleanUp = ""] = blocks;
  // The command that sets the developer's file aside and writes the copy, without the API's.
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

  /** Paths in a scratch folder laid out like the repository. */
  interface Checkout {
    readonly folder: string;
    /** apps/api/.env */
    readonly env: string;
    /** apps/api/.env.set-aside */
    readonly aside: string;
    /** What apps/api holds, sorted. */
    readonly files: () => Promise<string[]>;
  }

  /** A scratch folder laid out like the repository, with the API's template and, if given, `own`. */
  async function checkout(own?: string): Promise<Checkout> {
    const folder = await mkdtemp(join(tmpdir(), "apex-build-log-"));
    onTestFinished(() => rm(folder, { recursive: true, force: true }));
    const api = join(folder, "apps", "api");
    await mkdir(api, { recursive: true });
    await writeFile(join(api, ".env.example"), apiTemplate);
    if (own !== undefined) {
      await writeFile(join(api, ".env"), own, { mode: 0o600 });
    }
    return {
      folder,
      env: join(api, ".env"),
      aside: join(api, ".env.set-aside"),
      files: async () => (await readdir(api)).sort(),
    };
  }

  /**
   * The copy that the steps write: the template plus the port line, readable by its owner only,
   * which sets API_PORT=4010 when Node.js reads it as the API's scripts do.
   */
  async function expectCopy(repo: Checkout): Promise<void> {
    const copy = await readFile(repo.env, "utf8");
    expect(copy).toBe(`${apiTemplate}API_PORT=4010\n`);
    expect(parseEnv(copy)).toEqual({ API_PORT: "4010" });
    expect((await stat(repo.env)).mode & 0o777).toBe(0o600);
  }

  it.for(shells)(
    "keep your own apps/api/.env when each runs twice, pasted into %s",
    async (shell) => {
      const own = "LOG_LEVEL=debug\n";
      const repo = await checkout(own);

      paste(shell, repo.folder, fileSteps);
      paste(shell, repo.folder, fileSteps);

      await expectCopy(repo);
      expect(await readFile(join(repo.aside, ".env"), "utf8")).toBe(own);
      paste(shell, repo.folder, cleanUp);
      // The second time, there is nothing left to do, and nothing to complain about.
      expect(paste(shell, repo.folder, cleanUp)).toBe("");
      expect(await readFile(repo.env, "utf8")).toBe(own);
      expect((await stat(repo.env)).mode & 0o777).toBe(0o600);
      expect(await repo.files()).toEqual([".env", ".env.example"]);
    },
  );

  it.for(shells)(
    "leave no apps/api/.env behind when you had none, pasted into %s",
    async (shell) => {
      const repo = await checkout();

      paste(shell, repo.folder, fileSteps);
      paste(shell, repo.folder, fileSteps);

      await expectCopy(repo);
      expect(await readdir(repo.aside)).toEqual(["none"]);
      paste(shell, repo.folder, cleanUp);
      expect(paste(shell, repo.folder, cleanUp)).toBe("");
      expect(await repo.files()).toEqual([".env.example"]);
    },
  );

  // Finder writes .DS_Store into folders it shows, and vim a swap file next to a file it opens, so
  // the folder can hold more than the steps put there. Its rmdir then fails, and the clean-up is
  // pasted again.
  it.for(shells)(
    "put everything back once when another program writes into the folder, pasted into %s",
    async (shell) => {
      const own = "LOG_LEVEL=debug\n";
      const withFile = await checkout(own);
      const withoutFile = await checkout();
      for (const repo of [withFile, withoutFile]) {
        paste(shell, repo.folder, fileSteps);
        await writeFile(join(repo.aside, ".DS_Store"), "");
        expect(paste(shell, repo.folder, cleanUp)).toMatch(/not empty/i);
        expect(paste(shell, repo.folder, cleanUp)).toMatch(/not empty/i);
        expect(await readdir(repo.aside)).toEqual([".DS_Store"]);
      }

      expect(await readFile(withFile.env, "utf8")).toBe(own);
      expect(await withFile.files()).toEqual([".env", ".env.example", ".env.set-aside"]);
      expect(await withoutFile.files()).toEqual([".env.example", ".env.set-aside"]);
    },
  );

  // For example a backup made by hand. The steps then leave the developer's settings in force,
  // and the build log says why.
  it.for(shells)(
    "change nothing when a file of yours is called apps/api/.env.set-aside, pasted into %s",
    async (shell) => {
      const own = "LOG_LEVEL=debug\n";
      const backup = "LOG_LEVEL=warn\n";
      const withFile = await checkout(own);
      const withoutFile = await checkout();
      for (const repo of [withFile, withoutFile]) {
        await writeFile(repo.aside, backup);
        for (const block of [fileSteps, fileSteps, cleanUp, cleanUp]) {
          paste(shell, repo.folder, block);
        }
        expect(await readFile(repo.aside, "utf8")).toBe(backup);
      }

      expect(await readFile(withFile.env, "utf8")).toBe(own);
      expect(await withFile.files()).toEqual([".env", ".env.example", ".env.set-aside"]);
      // No copy was written, so nothing is left to delete.
      expect(await withoutFile.files()).toEqual([".env.example", ".env.set-aside"]);
    },
  );

  // A clean-up that told the copy from the developer's file by its content would delete this one.
  it.for(shells)(
    "put back a file that holds just what the copy holds, pasted into %s",
    async (shell) => {
      const own = `${apiTemplate}API_PORT=4010\n`;
      const repo = await checkout(own);

      for (const block of [fileSteps, cleanUp, cleanUp]) {
        paste(shell, repo.folder, block);
      }

      expect(await readFile(repo.env, "utf8")).toBe(own);
      expect(await repo.files()).toEqual([".env", ".env.example"]);
    },
  );

  // A link, whether or not its target exists, is moved aside and back as it is: the copy is never
  // written through it, and the clean-up never deletes it.
  it.for(shells)(
    "put back a symbolic link, even one whose target is gone, pasted into %s",
    async (shell) => {
      const repo = await checkout();
      // In a folder that exists, so a copy written through the link would create the target.
      const target = join(repo.folder, "secret.env");
      await symlink(target, repo.env);

      paste(shell, repo.folder, fileSteps);

      await expectCopy(repo);
      expect((await lstat(repo.env)).isFile()).toBe(true);
      paste(shell, repo.folder, cleanUp);
      paste(shell, repo.folder, cleanUp);
      expect((await lstat(repo.env)).isSymbolicLink()).toBe(true);
      expect(await readlink(repo.env)).toBe(target);
      expect(await readdir(repo.folder)).toEqual(["apps"]);
      expect(await repo.files()).toEqual([".env", ".env.example"]);
    },
  );

  it.for(shells)(
    "work where mv, cp and rm ask before they overwrite or delete, pasted into %s",
    async (shell) => {
      const own = "LOG_LEVEL=debug\n";
      const withFile = await checkout(own);
      const withoutFile = await checkout();
      for (const repo of [withFile, withoutFile]) {
        paste(shell, repo.folder, `${CAUTIOUS}\n${fileSteps}`);
        await expectCopy(repo);
        paste(shell, repo.folder, `${CAUTIOUS}\n${cleanUp}`);
      }

      expect(await readFile(withFile.env, "utf8")).toBe(own);
      expect(await withFile.files()).toEqual([".env", ".env.example"]);
      expect(await withoutFile.files()).toEqual([".env.example"]);
    },
  );
});

describe("BUILD_LOG #4: the steps that try to commit an env file", () => {
  const probes = shellBlocks(entry(4)).filter((block) => block.includes("probe.env"));

  it("are two blocks without comments", () => {
    expect(probes).toHaveLength(2);
    expect(probes.join("\n")).not.toMatch(/(?:^|\s)#/);
  });

  /**
   * git's settings and identity for a scratch repository: none of the machine's, and none of the
   * variables, such as GIT_INDEX_FILE, that git sets for a hook that runs these tests.
   */
  const gitEnv: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  /** Runs git in `folder` and returns its output; throws if git fails. */
  function git(folder: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd: folder, encoding: "utf8", env: gitEnv });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
    }
    return result.stdout;
  }

  // A repository with a commit, an infra/ folder and a staged change of the developer's, made once
  // and copied for each test.
  let template = "";
  let head = "";
  beforeAll(async () => {
    template = await mkdtemp(join(tmpdir(), "apex-build-log-git-"));
    git(template, "init", "--quiet", "--initial-branch=main");
    await mkdir(join(template, "infra"));
    await writeFile(join(template, "infra", "README.md"), "# Infra\n");
    await writeFile(join(template, "notes.txt"), "draft\n");
    git(template, "add", "--all");
    git(template, "commit", "--quiet", "--message", "chore: start");
    await writeFile(join(template, "notes.txt"), "draft, staged\n");
    git(template, "add", "notes.txt");
    head = git(template, "rev-parse", "HEAD");
    return () => rm(template, { recursive: true, force: true });
  });

  /**
   * A copy of the template repository, with a pre-commit hook that fails, as the real one does for
   * an env file, if `hook` is true.
   */
  async function repository(hook: boolean): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "apex-build-log-git-"));
    onTestFinished(() => rm(folder, { recursive: true, force: true }));
    await cp(template, folder, { recursive: true });
    if (hook) {
      await writeFile(join(folder, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", {
        mode: 0o755,
      });
    }
    return folder;
  }

  // Without the hooks (a checkout where `pnpm install` has not run), the commit goes through, and
  // the steps take it back.
  describe.for([
    { hook: true, outcome: "the hook refuses the commit" },
    { hook: false, outcome: "nothing stops the commit" },
  ])("when $outcome", ({ hook }) => {
    it.for(shells)("leave the repository as it was, pasted into %s", async (shell) => {
      for (const probe of probes) {
        const folder = await repository(hook);

        paste(shell, folder, probe, gitEnv);

        expect(git(folder, "rev-parse", "HEAD")).toBe(head);
        expect(git(folder, "status", "--porcelain", "--ignored")).toBe("M  notes.txt\n");
        expect((await readdir(folder)).sort()).toEqual([".git", "infra", "notes.txt"]);
        expect(await readdir(join(folder, "infra"))).toEqual(["README.md"]);
      }
    });
  });
});
