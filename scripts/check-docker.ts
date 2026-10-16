// Runs before every docker:* script in package.json (instruction 7). It checks that Docker is ready
// to run Docker Compose (installed, with the Compose plugin 2.23.1 or later and a running engine,
// on Linux Docker Engine 28 or later) and, when it is not, explains what to do instead of leaving
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
  /** What the command printed on its standard output. */
  readonly stdout?: string | undefined;
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
    "Docker is installed, but its Compose plugin (the `docker compose` command) is missing or broken.",
    "Install or repair the Compose plugin: https://docs.docker.com/compose/install/",
  ],
  composeTooOld: [
    "Docker Compose is older than version 2.23.1, which docker-compose.yml needs: it gives Redis",
    "its settings in a `configs` entry with inline `content`, which older versions refuse.",
    "Update Docker Desktop or OrbStack (macOS), or the Compose plugin (Linux):",
    "https://docs.docker.com/compose/install/",
  ],
  notRunning: [
    "Docker is installed, but its engine is not running, or this user cannot reach it.",
    "Start Docker Desktop or OrbStack (macOS), or Docker Engine (Linux: sudo systemctl start docker),",
    "then try again. On Linux, if Docker works only with sudo, see",
    "https://docs.docker.com/engine/install/linux-postinstall/",
  ],
  engineTooOld: [
    "Docker Engine is older than version 28. On Linux, older engines let other machines on the same",
    "network reach ports published on 127.0.0.1, so PostgreSQL and Redis would not stay private.",
    "Upgrade Docker Engine from Docker's own packages: https://docs.docker.com/engine/install/",
  ],
} as const satisfies Record<string, readonly string[]>;

export type DockerProblem = keyof typeof DOCKER_PROBLEMS;

/**
 * The oldest Docker Engine major version allowed on Linux. Before 28.0.0, hosts on the same
 * network segment can reach ports published on 127.0.0.1 (Docker's port-publishing documentation,
 * moby/moby#45610). Docker Desktop and OrbStack on macOS run the engine in a virtual machine and
 * publish ports on the Mac's own loopback address, so the version is not checked there.
 */
export const MIN_LINUX_ENGINE_MAJOR = 28;

/**
 * The oldest Docker Compose release that reads docker-compose.yml, as [major, minor, patch]:
 * Redis's settings are a top-level `configs` entry with inline `content`, which Compose accepts
 * from 2.23.1 on (2.23.0 refuses the file: "configs.redis-config Additional property content is
 * not allowed").
 */
export const MIN_COMPOSE_VERSION = [2, 23, 1] as const;

/** Waits at most this long for each Docker command, in case the engine hangs. */
const TIMEOUT_MS = 20_000;

/** Runs a command without showing its output, and returns what it printed. */
export const runQuietly: RunCommand = (command, args) =>
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: TIMEOUT_MS,
  });

/**
 * The major version of the engine, read from the server version that `docker version` prints,
 * such as 29 for "29.9.0"; undefined for anything that does not start with a release number.
 */
function engineMajorVersion(stdout: string | undefined): number | undefined {
  const match = /^(\d+)\.\d+/.exec(stdout?.trim() ?? "");
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * The release that `docker compose version` prints, as [major, minor, patch]: "Docker Compose
 * version v2.23.1", or with a suffix from Docker Desktop or a distribution package, such as
 * "v2.29.7-desktop.1" or "2.26.1-4"; undefined when the output holds no release number.
 */
function composeVersion(stdout: string | undefined): number[] | undefined {
  const match = /\bversion v?(\d+)\.(\d+)\.(\d+)/.exec(stdout ?? "");
  return match === null ? undefined : match.slice(1, 4).map(Number);
}

/** Whether `version` is an earlier release than `minimum`; both are [major, minor, patch]. */
function isEarlier(version: readonly number[], minimum: readonly number[]): boolean {
  for (const [index, part] of minimum.entries()) {
    const own = version[index] ?? 0;
    if (own !== part) {
      return own < part;
    }
  }
  return false;
}

/**
 * Checks, in order, that Docker is installed, has the Compose plugin, at least version 2.23.1,
 * and has a running engine, and on Linux (`platform`, the running system by default) that the
 * engine is new enough.
 */
export function findDockerProblem(
  run: RunCommand = runQuietly,
  platform: NodeJS.Platform = process.platform,
): DockerProblem | undefined {
  // Needs only the client and the Compose plugin, not the engine.
  const compose = run("docker", ["compose", "version"]);
  if (compose.error?.code === "ENOENT") {
    return "missing";
  }
  if (compose.status !== 0) {
    return "composeMissing";
  }
  // Every system: the compose file itself needs this release. As for the engine, output without
  // a release number is let through.
  const version = composeVersion(compose.stdout);
  if (version !== undefined && isEarlier(version, MIN_COMPOSE_VERSION)) {
    return "composeTooOld";
  }
  // Fails unless the client can reach the engine.
  const engine = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (engine.status !== 0) {
    return "notRunning";
  }
  // Docker's own builds print a release number. A version that is not one (a development build,
  // or a client that prints nothing) is let through: the check is for old distribution packages.
  const major = engineMajorVersion(engine.stdout);
  if (platform === "linux" && major !== undefined && major < MIN_LINUX_ENGINE_MAJOR) {
    return "engineTooOld";
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
