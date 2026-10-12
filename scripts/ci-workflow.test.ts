import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// Checks for the GitHub Actions workflows (instruction 5). GitHub runs them, not this machine, so
// these tests hold every workflow to the security rules in docs/DECISIONS.md, check that CI calls
// scripts that really exist, and run ci.yml's own shell scripts the way GitHub runs them.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(repoRoot, ".github", "workflows");

/** A `defaults` block, which sets the shell of the `run` steps that do not name one. */
const defaultsSchema = z.object({ run: z.object({ shell: z.string().optional() }).optional() });

/** Environment variables; GitHub also accepts numbers and booleans, which it turns into text. */
const envSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/** The parts of a workflow file these tests read. */
const workflowSchema = z.object({
  on: z.unknown(),
  permissions: z.unknown().optional(),
  defaults: defaultsSchema.optional(),
  jobs: z.record(
    z.string(),
    z.object({
      "timeout-minutes": z.number().optional(),
      permissions: z.unknown().optional(),
      defaults: defaultsSchema.optional(),
      env: envSchema.optional(),
      steps: z.array(
        z.object({
          name: z.string().optional(),
          if: z.string().optional(),
          uses: z.string().optional(),
          with: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          env: envSchema.optional(),
          shell: z.string().optional(),
          run: z.string().optional(),
        }),
      ),
    }),
  ),
});

const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/u.test(file))
  .map((file) => {
    const text = readFileSync(join(workflowsDir, file), "utf8");
    return { file, text, workflow: workflowSchema.parse(parse(text)) };
  });

const rootScripts = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))).scripts;

/** pnpm's own commands that CI runs; any other `pnpm <name>` must be a root package.json script. */
const PNPM_COMMANDS = new Set(["install", "peers"]);

describe.each(workflows)("$file", ({ text, workflow }) => {
  const jobs = Object.values(workflow.jobs);
  const steps = jobs.flatMap((job) => job.steps);

  it("pins every action to a full commit SHA, with its release in a comment", () => {
    // A tag can be moved to other code; a commit SHA cannot. The comment lets people and
    // Dependabot (instruction 106) see and update the release.
    const usesLines = text.split("\n").filter((line) => /^\s*(?:-\s+)?uses:/u.test(line));

    expect(usesLines).toHaveLength(steps.filter((step) => step.uses !== undefined).length);
    for (const line of usesLines) {
      expect(line).toMatch(/^\s*(?:-\s+)?uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u);
    }
  });

  it("states its token permissions instead of taking the repository default", () => {
    expect(workflow.permissions).toBeDefined();
  });

  it("gives every job a time limit of at most an hour", () => {
    for (const job of jobs) {
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
      expect(job["timeout-minutes"]).toBeLessThanOrEqual(60);
    }
  });

  it("does not leave the token in the checked-out repository", () => {
    for (const step of steps.filter((s) => s.uses?.startsWith("actions/checkout@") === true)) {
      expect(step.with?.["persist-credentials"]).toBe(false);
    }
  });

  it("calls only root package.json scripts and repository files that exist", () => {
    for (const run of steps.flatMap((step) => (step.run === undefined ? [] : [step.run]))) {
      // The first word after `pnpm` that is not an option, as in `pnpm --silent lint`.
      for (const [, name = ""] of run.matchAll(/\bpnpm (?:--?[\w-]+ )*([\w:-]+)/gu)) {
        expect(PNPM_COMMANDS.has(name) || name in rootScripts, `pnpm ${name}`).toBe(true);
      }
      for (const [, path = ""] of run.matchAll(/\bnode (scripts\/[\w./-]+)/gu)) {
        expect(existsSync(join(repoRoot, path)), path).toBe(true);
      }
    }
  });
});

function findCi() {
  const found = workflows.find(({ file }) => file === "ci.yml");
  if (found === undefined) {
    throw new Error(".github/workflows/ci.yml is missing");
  }
  return found;
}

const ci = findCi();

describe("ci.yml", () => {
  const steps = Object.values(ci.workflow.jobs).flatMap((job) => job.steps);
  const runs = steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));

  it("runs for every push to main and every pull request", () => {
    expect(ci.workflow.on).toEqual({ push: { branches: ["main"] }, pull_request: null });
  });

  it("can only read the repository", () => {
    expect(ci.workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(ci.workflow.jobs)) {
      expect(job.permissions).toBeUndefined();
    }
  });

  it("installs exactly what the lockfile says, then lints, type-checks, tests and builds", () => {
    expect(runs[0]).toBe("pnpm install --frozen-lockfile");
    for (const check of ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"]) {
      expect(runs.some((run) => run === check || run.startsWith(`${check} `))).toBe(true);
    }
  });

  it("also fails on peer dependency problems, formatting and build warnings", () => {
    expect(runs).toContain("pnpm peers check");
    expect(runs).toContain("pnpm format:check");
    expect(runs.some((run) => run.startsWith("node scripts/check-build-warnings.ts "))).toBe(true);
  });

  it("runs each step after the install even when an earlier check failed", () => {
    // Without a status function in `if`, GitHub adds `success()`, which skips every step after the
    // first failure. `always()` would also keep going after the run was cancelled.
    const checks = steps.slice(steps.findIndex((step) => step.run?.startsWith("pnpm install")) + 1);

    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.if, check.name).toMatch(/^\$\{\{ !cancelled\(\) && /u);
    }
  });

  it("validates docker-compose.yml with every profile, from the .env template", () => {
    const compose = runs.find((run) => run.includes("docker compose"));

    expect(compose).toContain("cp .env.example .env");
    expect(compose).toContain("docker compose --profile '*' config --quiet");
  });
});

/**
 * The command GitHub runs a step's script file with on Linux, for the shell the step uses:
 * https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax (jobs.<job_id>.
 * steps[*].shell). Only `bash` adds `-o pipefail`, which makes a pipe fail when any command in it
 * fails, not only the last.
 */
function shellCommand(
  shell: string | undefined,
  scriptFile: string,
): [command: string, ...args: string[]] {
  switch (shell) {
    case undefined:
      return ["/bin/bash", "-e", scriptFile];
    case "bash":
      return ["/bin/bash", "--noprofile", "--norc", "-eo", "pipefail", scriptFile];
    case "sh":
      return ["/bin/sh", "-e", scriptFile];
    default:
      throw new Error(`these tests cannot run a step with shell: ${shell}`);
  }
}

/**
 * Stand-ins for the commands that ci.yml's scripts call: each one appends its command line to
 * $STUB_CALLS, prints $STUB_OUTPUT (docker to stderr, where Compose writes its warnings) and exits
 * with $STUB_STATUS.
 */
const STUBS = {
  pnpm: `#!/bin/sh
printf 'pnpm %s\\n' "$*" >> "$STUB_CALLS"
printf '%s' "$STUB_OUTPUT"
exit "$STUB_STATUS"
`,
  docker: `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$STUB_CALLS"
printf '%s' "$STUB_OUTPUT" >&2
exit "$STUB_STATUS"
`,
};

interface StepOptions {
  /** What the pnpm and docker stand-ins print. */
  readonly output?: string;
  /** The exit status of the pnpm and docker stand-ins. */
  readonly status?: number;
  /** The runner's temporary directory, $RUNNER_TEMP: pass a previous step's to share its files. */
  readonly runnerTemp?: string;
  /** Files to put in the stand-in checkout, by name. */
  readonly files?: Readonly<Record<string, string>>;
}

interface StepRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly runnerTemp: string;
  /** The stand-in checkout that the step ran in. */
  readonly checkout: string;
  /** The command line of each call to the pnpm and docker stand-ins, in order. */
  readonly calls: readonly string[];
}

/** Makes a temporary directory that is removed when the current test finishes. */
function temporaryDirectory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * Runs the script of the ci.yml step called `name` as GitHub would on Linux: from a file, with the
 * shell that the step, its job or the workflow declares, and with the job's and the step's
 * environment variables. PATH holds only the system directories, the stand-ins for pnpm and
 * docker, and this Node.js as `node`. The step runs in a stand-in checkout, a temporary directory
 * that holds `files` and a link to this repository's scripts/, so that a step can never change the
 * real checkout (the Compose step writes .env, for example).
 */
function runStep(name: string, options: StepOptions = {}): StepRun {
  const { workflow } = ci;
  const found = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.filter((step) => step.name === name).map((step) => ({ job, step })),
  );
  const [match] = found;
  if (match?.step.run === undefined || found.length > 1) {
    throw new Error(`ci.yml must have exactly one run step named "${name}"`);
  }
  const { job, step } = match;
  const script = match.step.run;
  // GitHub replaces ${{ }} expressions before the shell runs; these tests cannot.
  if (script.includes("${{")) {
    throw new Error(`step "${name}" uses a \${{ }} expression in its script`);
  }

  const runnerTemp = options.runnerTemp ?? temporaryDirectory("apex-ci-runner-");
  const checkout = temporaryDirectory("apex-ci-checkout-");
  symlinkSync(join(repoRoot, "scripts"), join(checkout, "scripts"));
  for (const [file, content] of Object.entries(options.files ?? {})) {
    writeFileSync(join(checkout, file), content);
  }
  const bin = temporaryDirectory("apex-ci-bin-");
  for (const [command, stub] of Object.entries(STUBS)) {
    writeFileSync(join(bin, command), stub);
    chmodSync(join(bin, command), 0o755);
  }
  symlinkSync(process.execPath, join(bin, "node"));
  const calls = join(bin, "calls.log");
  writeFileSync(calls, "");
  const scriptFile = join(bin, "step.sh");
  writeFileSync(scriptFile, script);

  const shell = step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell;
  const [command, ...args] = shellCommand(shell, scriptFile);
  const env = Object.fromEntries(
    Object.entries({ ...job.env, ...step.env }).map(([key, value]) => [key, String(value)]),
  );
  const result = spawnSync(command, args, {
    cwd: checkout,
    env: {
      ...env,
      PATH: [bin, "/usr/bin", "/bin"].join(":"),
      RUNNER_TEMP: runnerTemp,
      STUB_CALLS: calls,
      STUB_OUTPUT: options.output ?? "",
      STUB_STATUS: String(options.status ?? 0),
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
    runnerTemp,
    checkout,
    calls: readFileSync(calls, "utf8")
      .split("\n")
      .filter((line) => line !== ""),
  };
}

describe("ci.yml steps, run as GitHub runs them", { timeout: 20_000 }, () => {
  const clean = "apps/web build: ✓ Compiled successfully in 868ms\n";
  const warning = "apps/web build: ⚠ Invalid next.config.ts options detected:\n";

  it("fails the Build step when the build fails, although tee saves its output", () => {
    // Without pipefail, the status of `pnpm build 2>&1 | tee ...` would be tee's: success.
    const build = runStep("Build", { output: "apps/web build: Failed to compile.\n", status: 1 });

    expect(build.status).not.toBe(0);
    expect(build.calls).toEqual(["pnpm build"]);
    expect(build.stdout).toBe("apps/web build: Failed to compile.\n");
    expect(readFileSync(join(build.runnerTemp, "build.log"), "utf8")).toBe(build.stdout);
  });

  it("passes a clean build, and the warning check after it", () => {
    const build = runStep("Build", { output: clean });
    const check = runStep("Fail on build warnings", { runnerTemp: build.runnerTemp });

    expect(build.status, build.stderr).toBe(0);
    expect(check.status, check.stderr).toBe(0);
  });

  it("fails the warning check when the build printed a warning and still succeeded", () => {
    const build = runStep("Build", { output: `${clean}${warning}` });
    const check = runStep("Fail on build warnings", { runnerTemp: build.runnerTemp });

    expect(build.status, build.stderr).toBe(0);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("⚠ Invalid next.config.ts options detected:");
  });

  it("validates docker-compose.yml with a copy of the .env template", () => {
    const template = "POSTGRES_PASSWORD=\nREDIS_PASSWORD=\n";
    const compose = runStep("Validate docker-compose.yml", { files: { ".env.example": template } });

    expect(compose.status, compose.stderr).toBe(0);
    expect(compose.calls).toEqual(["docker compose --profile * config --quiet"]);
    expect(readFileSync(join(compose.checkout, ".env"), "utf8")).toBe(template);
  });

  it("fails when Compose prints a warning, although Compose itself succeeds", () => {
    // Real output of Compose 5.1.3 for a variable that is not set; it exits with status 0.
    const unsetVariable = `time="2026-10-12T19:11:59+01:00" level=warning msg="The \\"SHM_SIZE\\" variable is not set. Defaulting to a blank string."\n`;
    const compose = runStep("Validate docker-compose.yml", {
      files: { ".env.example": "" },
      output: unsetVariable,
    });

    expect(compose.status).toBe(1);
    expect(compose.stdout).toBe(unsetVariable);
    expect(compose.stderr).toContain("CI fails on any warning");
  });

  it("fails when Compose fails, even without printing anything", () => {
    const compose = runStep("Validate docker-compose.yml", {
      files: { ".env.example": "" },
      status: 15,
    });

    expect(compose.status).toBe(15);
  });

  it("fails when there is no .env template to copy", () => {
    const compose = runStep("Validate docker-compose.yml");

    expect(compose.status).not.toBe(0);
    expect(compose.calls).toEqual([]);
  });
});
