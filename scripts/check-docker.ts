// Runs before every docker:* script in package.json (instruction 7). It checks that Docker can run
// this project's docker-compose.yml and, when it cannot, explains what to do instead of leaving
// the shell to fail with "docker: command not found". Exits with status 1 after printing the
// problem; prints nothing and exits with status 0 when Docker is ready.
//
// Usage, from the repository root: node scripts/check-docker.ts

import { spawnSync } from "node:child_process";

/** How a command ended: its exit status, or the error that stopped it from starting. */
export interface CommandResult {
  /** The exit status, or null if the command did not start or was stopped by a signal. */
  readonly status: number | null;
  /** Set when the command could not be started, for example `{ code: "ENOENT" }`. */
  readonly error?: NodeJS.ErrnoException | undefined;
}

/** Runs a command and reports how it ended. */
export type RunCommand = (command: string, args: readonly string[]) => CommandResult;

/** What stops the docker:* scripts, and what to do about it. */
export const DOCKER_PROBLEMS = {
  missing: [
    "Docker is not installed, or the `docker` command is not on your PATH.",
    "The docker:* scripts run PostgreSQL and Redis with Docker Compose (see infra/README.md).",
    "Install Docker Desktop or OrbStack (macOS), or Docker Engine with the Compose plugin (Linux):",
    "https://docs.docker.com/get-started/get-docker/",
  ],
  composeMissing: [
    "Docker is installed, but Docker Compose v2 (the `docker compose` command) is missing or broken.",
    "Install or repair the Compose plugin: https://docs.docker.com/compose/install/",
  ],
  notRunning: [
    "Docker is installed, but its engine is not running, or this user cannot reach it.",
    "Start Docker Desktop or OrbStack (macOS), or Docker Engine (Linux: sudo systemctl start docker),",
    "then try again.",
  ],
} as const satisfies Record<string, readonly string[]>;

export type DockerProblem = keyof typeof DOCKER_PROBLEMS;

/** Waits at most this long for each Docker command, in case the engine hangs. */
const TIMEOUT_MS = 20_000;

/** Runs a command without showing its output. */
const runQuietly: RunCommand = (command, args) =>
  spawnSync(command, args, { stdio: "ignore", timeout: TIMEOUT_MS });

/** Checks, in order, that Docker is installed, has Compose v2 and has a running engine. */
export function findDockerProblem(run: RunCommand = runQuietly): DockerProblem | undefined {
  // Needs only the client and the Compose plugin, not the engine.
  const compose = run("docker", ["compose", "version"]);
  if (compose.error?.code === "ENOENT") {
    return "missing";
  }
  if (compose.status !== 0) {
    return "composeMissing";
  }
  // Fails unless the client can reach the engine.
  const engine = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (engine.status !== 0) {
    return "notRunning";
  }
  return undefined;
}

if (import.meta.main) {
  const problem = findDockerProblem();
  if (problem !== undefined) {
    console.error(DOCKER_PROBLEMS[problem].join("\n"));
    process.exitCode = 1;
  }
}
