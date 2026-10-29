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
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { DOCKER_PROBLEMS } from "./check-docker.ts";

// Runs root package.json scripts the way pnpm runs them (`sh -c <script>`): the scripts from
// instruction 7 in the repository root, with a PATH that holds only `node` and, when a test wants
// one, a stand-in for `docker` (no real Docker is needed, and an installed one is never used); and
// the test, formatting and build scripts that CI runs as checks, on small folders of their own.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const packageJson = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")));

/**
 * The stand-in for `docker`: appends its arguments to $DOCKER_STUB_LOG, then exits with status 7
 * if they start with $DOCKER_STUB_FAIL_ON, or with status 0. For `compose version` it prints
 * "Docker Compose version $DOCKER_STUB_COMPOSE_VERSION" when that is set, as Compose does. It uses
 * only shell built-ins.
 */
const dockerStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_STUB_LOG"
if [ -n "\${DOCKER_STUB_FAIL_ON-}" ]; then
  case "$*" in
    "$DOCKER_STUB_FAIL_ON"*) echo "docker stub: failing on purpose" >&2; exit 7 ;;
  esac
fi
if [ "$*" = "compose version" ] && [ -n "\${DOCKER_STUB_COMPOSE_VERSION-}" ]; then
  echo "Docker Compose version $DOCKER_STUB_COMPOSE_VERSION"
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
 * `docker` is set. `failOn` makes the stand-in fail for calls whose arguments start with it, and
 * `composeVersion` is the version it reports for Compose (none by default).
 */
function runScript(
  name: string,
  options: { docker: boolean; failOn?: string; composeVersion?: string },
): ScriptRun {
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
      ...(options.composeVersion === undefined
        ? {}
        : { DOCKER_STUB_COMPOSE_VERSION: options.composeVersion }),
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
    // Every profile: a plain `docker compose down` handles only the services outside a profile,
    // so it would leave the "app" placeholders behind and delete the network they are attached
    // to, and the next `docker compose --profile app up` would fail with "network ... not found".
    // The asterisk must reach Compose as it is, not as the file names the shell would expand.
    ["docker:down", "compose --profile * down"],
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

  it("explains a Compose too old for the compose file and runs nothing else", () => {
    const run = runScript("docker:up", { docker: true, composeVersion: "v2.23.0" });

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(`${DOCKER_PROBLEMS.composeTooOld.join("\n")}\n`);
    expect(run.dockerCalls).toEqual(["compose version"]);
  });

  it("runs Compose 2.23.1, the oldest that reads the compose file", () => {
    const run = runScript("docker:up", { docker: true, composeVersion: "v2.23.1" });

    expect(run.status, run.stderr).toBe(0);
    expect(run.dockerCalls).toEqual([...checks, "compose up --detach --wait"]);
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

// CI runs `pnpm test`, `pnpm format:check` and `pnpm build` as they are
// (scripts/ci-workflow.test.ts), so each script must fail when its check fails: a `|| true` would
// turn every failure into a pass. Each runs here with this repository's tools, once on a folder
// whose check fails and once on one whose check passes, so that a script that no longer checks
// anything fails too. eslint-config.test.ts does this for `pnpm lint`, and typecheck.test.ts for
// `pnpm typecheck`.
describe("the check scripts that CI runs", { timeout: 60_000 }, () => {
  /** Writes `files`, by path, to a new temporary folder and returns the folder. */
  function folder(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), "apex-check-script-"));
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  }

  /**
   * Runs the root script `name` in `cwd` with this repository's installed tools, then this
   * Node.js, then the PATH of these tests (which holds pnpm). Nothing else of these tests'
   * environment is passed on, so neither an outer Vitest's nor an outer pnpm's settings count.
   */
  function runCheck(name: string, cwd: string): { status: number | null; output: string } {
    const script = packageJson.scripts[name];
    if (script === undefined) {
      throw new Error(`package.json has no "${name}" script`);
    }
    const path = [join(repoRoot, "node_modules", ".bin"), dirname(process.execPath)];
    const result = spawnSync("/bin/sh", ["-c", script], {
      cwd,
      env: { PATH: [...path, process.env["PATH"] ?? ""].join(delimiter), HOME: homedir() },
      encoding: "utf8",
      timeout: 50_000,
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    return {
      status: result.status,
      output: stripVTControlCharacters(result.stdout + result.stderr),
    };
  }

  /** A Vitest folder with one test that does `assertion`, through Vitest's globals. */
  const vitestFolder = (assertion: string): Record<string, string> => ({
    "vitest.config.mjs": "export default { test: { globals: true } };\n",
    "probe.test.mjs": `test("probe", () => {\n  ${assertion};\n});\n`,
  });

  it("pnpm test fails when a test fails, and passes when every test passes", () => {
    const failing = runCheck("test", folder(vitestFolder("expect(1).toBe(2)")));
    const passing = runCheck("test", folder(vitestFolder("expect(1).toBe(1)")));

    expect(failing.status, failing.output).toBe(1);
    expect(failing.output).toMatch(/Tests\s+1 failed/u);
    expect(passing.status, passing.output).toBe(0);
    expect(passing.output).toMatch(/Tests\s+1 passed/u);
  });

  it("pnpm format:check fails on an unformatted file, and passes on formatted files", () => {
    const failing = runCheck("format:check", folder({ "probe.ts": "export const  answer=42\n" }));
    const passing = runCheck("format:check", folder({ "probe.ts": "export const answer = 42;\n" }));

    expect(failing.status, failing.output).toBe(1);
    expect(failing.output).toContain("probe.ts");
    expect(passing.status, passing.output).toBe(0);
  });

  it("pnpm build fails when a package's build fails, and passes when every build passes", () => {
    /** A pnpm workspace whose packages' builds pass, except the second's when `fails` is set. */
    const workspace = (fails: boolean): Record<string, string> => {
      const manifest = (name: string, build: string): string =>
        `${JSON.stringify({ name, private: true, scripts: { build } })}\n`;
      return {
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "package.json": `${JSON.stringify({ name: "workspace", private: true })}\n`,
        "packages/first/package.json": manifest("first", "echo first built"),
        "packages/second/package.json": manifest("second", fails ? "exit 3" : "echo second built"),
      };
    };

    const failing = runCheck("build", folder(workspace(true)));
    const passing = runCheck("build", folder(workspace(false)));

    expect(failing.status, failing.output).not.toBe(0);
    expect(passing.status, passing.output).toBe(0);
    expect(passing.output).toContain("first built");
    expect(passing.output).toContain("second built");
  });
});
