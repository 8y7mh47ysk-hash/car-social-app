import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// Static checks for the GitHub Actions workflows (instruction 5). GitHub runs them, not this
// machine, so these tests hold every workflow to the security rules in docs/DECISIONS.md and check
// that CI calls scripts that really exist.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(repoRoot, ".github", "workflows");

/** The parts of a workflow file these tests read. */
const workflowSchema = z.object({
  on: z.unknown(),
  permissions: z.unknown().optional(),
  jobs: z.record(
    z.string(),
    z.object({
      "timeout-minutes": z.number().optional(),
      permissions: z.unknown().optional(),
      steps: z.array(
        z.object({
          uses: z.string().optional(),
          with: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
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

describe("ci.yml", () => {
  const ci = workflows.find(({ file }) => file === "ci.yml");
  if (ci === undefined) {
    throw new Error(".github/workflows/ci.yml is missing");
  }
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

  it("validates docker-compose.yml with every profile, from the .env template", () => {
    const compose = runs.find((run) => run.includes("docker compose"));

    expect(compose).toContain("cp .env.example .env");
    expect(compose).toContain("docker compose --profile '*' config --quiet");
  });
});
