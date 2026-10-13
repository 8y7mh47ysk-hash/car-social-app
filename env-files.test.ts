import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Instruction 4: .env files hold real settings and secrets, so git must ignore every one of them,
// in any folder, while the .env.example templates must stay committable. These tests ask git
// itself, so they check the rules the way git applies them (order, negation, nesting).

const repoRoot = import.meta.dirname;

/** Real env files, under the names Next.js, Node.js, Docker and direnv read: all are ignored. */
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
  // A local copy named after the template is still a real env file.
  ".env.example.local",
  "apps/api/.env",
  "apps/api/.env.local",
  "apps/web/.env",
  "apps/web/.env.local",
  "apps/web/.env.production",
  "apps/web/.env.production.local",
  "infra/.env",
  "packages/shared/.env",
  // Files for `docker run --env-file` and Compose's `env_file:`, and direnv's file.
  "postgres.env",
  "infra/postgres.env",
  "apps/api/production.env",
  ".envrc",
  "apps/web/.envrc",
];

/** The templates for the env files that Docker Compose, the API and the web app read. */
const TEMPLATES = [".env.example", "apps/api/.env.example", "apps/web/.env.example"];

/** How git's ignore rules treat one path. */
interface Decision {
  readonly ignored: boolean;
  /** The file that holds the deciding rule, such as ".gitignore", or "" if no rule matches. */
  readonly source: string;
  /** The deciding rule as "file:line:pattern", for failure messages. */
  readonly rule: string;
}

/**
 * Asks git how its ignore rules treat each path. --no-index checks the rules even for files that
 * are already committed, which git otherwise never reports as ignored, and the user's global
 * excludes file is left out, so only the repository's own rules count.
 */
function ignoreDecisions(paths: readonly string[]): Map<string, Decision> {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.excludesFile=/dev/null",
      "check-ignore",
      "--no-index",
      "--verbose",
      "--non-matching",
      "-z",
      "--stdin",
    ],
    { cwd: repoRoot, encoding: "utf8", input: paths.join("\0") },
  );
  // Status 0 means some paths are ignored and 1 means none are; anything else is a failure.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.error?.message ?? result.stderr}`);
  }
  // -z prints four fields for each path, each ending in a NUL: source, line, pattern and path.
  // A path that no rule matches has three empty fields; a pattern starting with "!" re-includes.
  const fields = result.stdout.split("\0");
  const decisions = new Map<string, Decision>();
  for (let index = 0; index + 4 <= fields.length; index += 4) {
    const [source = "", line = "", pattern = "", path = ""] = fields.slice(index, index + 4);
    decisions.set(path, {
      ignored: pattern !== "" && !pattern.startsWith("!"),
      source,
      rule: `${source}:${line}:${pattern}`,
    });
  }
  return decisions;
}

/** Every path in the index, that is, every file that is committed or staged. */
function trackedPaths(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.split("\0").filter((path) => path !== "");
}

const decisions = ignoreDecisions([...ENV_FILES, ...TEMPLATES]);

describe(".gitignore", () => {
  it.each(ENV_FILES)("ignores %s", (path) => {
    const decision = decisions.get(path);

    expect(decision?.ignored, `deciding rule: ${String(decision?.rule)}`).toBe(true);
    // The rule is committed in a .gitignore file, so it protects every clone.
    expect(decision?.source).toMatch(/(?:^|\/)\.gitignore$/);
  });

  it.each(TEMPLATES)("does not ignore %s", (path) => {
    const decision = decisions.get(path);

    expect(decision?.ignored, `deciding rule: ${String(decision?.rule)}`).toBe(false);
  });
});

describe("env files in the repository", () => {
  // The root .env.example belongs to the Docker Compose setup (instruction 3).
  it.each(["apps/api/.env.example", "apps/web/.env.example"])("include the template %s", (path) => {
    expect(existsSync(join(repoRoot, path))).toBe(true);
  });

  it("are never committed, apart from the templates", () => {
    const committed = trackedPaths().filter((path) =>
      /(?:^|\/)(?:[^/]*\.env|\.env\.[^/]*|\.envrc)$/.test(path),
    );

    expect(committed.filter((path) => !/(?:^|\/)\.env\.example$/.test(path))).toEqual([]);
  });
});
