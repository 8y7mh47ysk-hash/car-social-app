import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { DOCKER_PROBLEMS } from "./check-docker.ts";

// Runs the root package.json scripts from instruction 7 the way pnpm runs them (`sh -c <script>`
// in the repository root), with a PATH that holds only `node` and, when a test wants one, a
// stand-in for `docker`. No real Docker is needed, and an installed one is never used.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const packageJson = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")));

/**
 * The stand-in for `docker`: appends its arguments to $DOCKER_STUB_LOG, then exits with status 7
 * if they start with $DOCKER_STUB_FAIL_ON, or with status 0. It uses only shell built-ins.
 */
const dockerStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_STUB_LOG"
if [ -n "\${DOCKER_STUB_FAIL_ON-}" ]; then
  case "$*" in
    "$DOCKER_STUB_FAIL_ON"*) echo "docker stub: failing on purpose" >&2; exit 7 ;;
  esac
fi
`;

interface ScriptRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The arguments of each call to the docker stand-in, in order. */
  readonly dockerCalls: readonly string[];
}

/**
 * Runs a root package.json script with a PATH of its own: `node`, plus the docker stand-in if
 * `docker` is set. `failOn` makes the stand-in fail for calls whose arguments start with it.
 */
function runScript(name: string, options: { docker: boolean; failOn?: string }): ScriptRun {
  const script = packageJson.scripts[name];
  if (script === undefined) {
    throw new Error(`package.json has no "${name}" script`);
  }

  const dir = mkdtempSync(join(tmpdir(), "apex-scripts-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const bin = join(dir, "bin");
  const log = join(dir, "docker-calls.log");
  writeFileSync(log, "");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  if (options.docker) {
    writeFileSync(join(bin, "docker"), dockerStub);
    chmodSync(join(bin, "docker"), 0o755);
  }

  const result = spawnSync("/bin/sh", ["-c", script], {
    cwd: repoRoot,
    env: {
      PATH: bin,
      DOCKER_STUB_LOG: log,
      ...(options.failOn === undefined ? {} : { DOCKER_STUB_FAIL_ON: options.failOn }),
    },
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    dockerCalls: readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== ""),
  };
}

/** The calls that scripts/check-docker.ts makes before Compose runs. */
const checks = ["compose version", "version --format {{.Server.Version}}"];

describe("docker:* scripts", { timeout: 20_000 }, () => {
  it.each([
    ["docker:up", "compose up --detach --wait"],
    ["docker:down", "compose down"],
    ["docker:logs", "compose logs --follow"],
  ])("%s checks Docker, then runs `docker %s`", (name, compose) => {
    const run = runScript(name, { docker: true });

    expect(run.status, run.stderr).toBe(0);
    expect(run.dockerCalls).toEqual([...checks, compose]);
    expect(run.stderr).toBe("");
  });

  it("fails with Compose's exit status, for example when a service never becomes healthy", () => {
    const run = runScript("docker:up", { docker: true, failOn: "compose up" });

    expect(run.status).toBe(7);
    expect(run.dockerCalls).toEqual([...checks, "compose up --detach --wait"]);
  });

  it.each(["docker:up", "docker:down", "docker:logs"])(
    "%s explains how to install Docker when there is no docker command",
    (name) => {
      const run = runScript(name, { docker: false });

      expect(run.status).toBe(1);
      expect(run.stderr).toBe(`${DOCKER_PROBLEMS.missing.join("\n")}\n`);
      expect(run.stdout).toBe("");
    },
  );

  it("explains a missing Compose plugin and runs nothing else", () => {
    const run = runScript("docker:up", { docker: true, failOn: "compose version" });

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(`${DOCKER_PROBLEMS.composeMissing.join("\n")}\n`);
    expect(run.dockerCalls).toEqual(["compose version"]);
  });

  it("explains an engine that is not running and does not start Compose", () => {
    const run = runScript("docker:up", { docker: true, failOn: "version" });

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(`${DOCKER_PROBLEMS.notRunning.join("\n")}\n`);
    expect(run.dockerCalls).toEqual(checks);
  });
});

describe("db:* scripts", () => {
  // Placeholders until instruction 26 adds migrations and seed data. They must fail, so that
  // nobody (and no script) mistakes them for a database that was migrated or seeded.
  it.each(["db:migrate", "db:seed"])("%s says it is not available yet and fails", (name) => {
    const run = runScript(name, { docker: false });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(new RegExp(`^${name}: not available yet\\..*instruction 26\\.\\n$`));
    expect(run.stdout).toBe("");
  });
});
