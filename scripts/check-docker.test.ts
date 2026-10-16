import { describe, expect, it } from "vitest";

import {
  DOCKER_PROBLEMS,
  findDockerProblem,
  runQuietly,
  type CommandResult,
} from "./check-docker.ts";

const ok: CommandResult = { status: 0 };
const failed: CommandResult = { status: 1 };
const notFound: CommandResult = {
  status: null,
  error: Object.assign(new Error("spawnSync docker ENOENT"), { code: "ENOENT" }),
};
const timedOut: CommandResult = {
  status: null,
  error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" }),
};

/**
 * A stand-in for running commands: answers `docker compose version` and the engine check with the
 * given results and records every command it is asked to run.
 */
function fakeDocker(compose: CommandResult, engine: CommandResult = ok) {
  const calls: string[] = [];
  const run = (command: string, args: readonly string[]): CommandResult => {
    const call = [command, ...args].join(" ");
    calls.push(call);
    return call === "docker compose version" ? compose : engine;
  };
  return { run, calls };
}

describe("findDockerProblem", () => {
  it("finds no problem when Compose works and the engine answers", () => {
    const docker = fakeDocker(ok, ok);

    expect(findDockerProblem(docker.run)).toBeUndefined();
    expect(docker.calls).toEqual([
      "docker compose version",
      "docker version --format {{.Server.Version}}",
    ]);
  });

  it("reports a missing Docker when the docker command does not exist", () => {
    const docker = fakeDocker(notFound);

    expect(findDockerProblem(docker.run)).toBe("missing");
    expect(docker.calls).toEqual(["docker compose version"]);
  });

  it.each([
    ["fails", failed],
    ["times out", timedOut],
  ])("reports missing or broken Compose when `docker compose version` %s", (_label, compose) => {
    const docker = fakeDocker(compose);

    expect(findDockerProblem(docker.run)).toBe("composeMissing");
    expect(docker.calls).toEqual(["docker compose version"]);
  });

  it.each([
    ["fails", failed],
    ["times out", timedOut],
  ])("reports an engine that is not running when the engine check %s", (_label, engine) => {
    const docker = fakeDocker(ok, engine);

    expect(findDockerProblem(docker.run)).toBe("notRunning");
  });

  /** The engine check's result when the engine answers with `version` and a newline. */
  const engineVersion = (version: string): CommandResult => ({ status: 0, stdout: `${version}\n` });

  // Before Docker Engine 28, other hosts on the same network segment can reach ports published
  // on 127.0.0.1 on a Linux host (Debian 13's own docker.io package is 26.1).
  it.each(["26.1.5", "27.5.1", "20.10.24+dfsg1"])(
    "reports an engine that is too old on Linux: %s",
    (version) => {
      const docker = fakeDocker(ok, engineVersion(version));

      expect(findDockerProblem(docker.run, "linux")).toBe("engineTooOld");
    },
  );

  it.each(["28.0.0", "29.9.0", "30.0.0-rc.1"])("accepts Docker Engine %s on Linux", (version) => {
    const docker = fakeDocker(ok, engineVersion(version));

    expect(findDockerProblem(docker.run, "linux")).toBeUndefined();
  });

  it("does not check the engine's version on macOS, where it runs in a virtual machine", () => {
    const docker = fakeDocker(ok, engineVersion("27.5.1"));

    expect(findDockerProblem(docker.run, "darwin")).toBeUndefined();
  });

  it.each([
    ["no version", ""],
    ["a development build's version", "dev"],
  ])("lets an engine through on Linux when it prints %s", (_label, version) => {
    const docker = fakeDocker(ok, engineVersion(version));

    expect(findDockerProblem(docker.run, "linux")).toBeUndefined();
  });

  /** The result of `docker compose version` when it prints `output` and a newline. */
  const composeOutput = (output: string): CommandResult => ({ status: 0, stdout: `${output}\n` });

  // docker-compose.yml gives Redis its settings in a `configs` entry with inline `content`, which
  // Compose refuses before 2.23.1. Distribution packages and Docker Desktop add suffixes, and
  // some packages leave out the "v".
  it.each([
    "Docker Compose version v2.23.0",
    "Docker Compose version v2.0.0",
    "Docker Compose version 2.22.0+ds1-0ubuntu1",
  ])("reports a Compose that is too old, on every system: %s", (output) => {
    for (const platform of ["darwin", "linux"] as const) {
      const docker = fakeDocker(composeOutput(output));

      expect(findDockerProblem(docker.run, platform)).toBe("composeTooOld");
      expect(docker.calls).toEqual(["docker compose version"]);
    }
  });

  it.each([
    "Docker Compose version v2.23.1",
    "Docker Compose version v2.29.7-desktop.1",
    "Docker Compose version 2.26.1-4",
    "Docker Compose version v2.100.0",
    "Docker Compose version v3.0.0",
    "Docker Compose version v5.6.0",
  ])("accepts %s", (output) => {
    const docker = fakeDocker(composeOutput(output), engineVersion("29.9.0"));

    expect(findDockerProblem(docker.run, "linux")).toBeUndefined();
  });

  it.each([
    ["no version", ""],
    ["a development build's version", "Docker Compose version dev"],
  ])("lets Compose through when it prints %s", (_label, output) => {
    const docker = fakeDocker(composeOutput(output));

    expect(findDockerProblem(docker.run, "linux")).toBeUndefined();
  });
});

// The command runner that the script uses when no stand-in is given.
describe("runQuietly", () => {
  it("returns a command's exit status and what it printed, which the version check reads", () => {
    const result = runQuietly(process.execPath, ["-e", 'console.log("29.9.0"); process.exit(3)']);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("29.9.0\n");
  });

  it("reports a command that does not exist as ENOENT", () => {
    const result = runQuietly("apex-no-such-command", []);

    expect(result.error?.code).toBe("ENOENT");
  });
});

describe("DOCKER_PROBLEMS", () => {
  it.each(Object.entries(DOCKER_PROBLEMS))(
    "says how to fix %s, with a link to Docker's documentation",
    (_problem, lines) => {
      expect(lines.join(" ")).toMatch(/https:\/\/docs\.docker\.com\/\S+/u);
    },
  );
});
