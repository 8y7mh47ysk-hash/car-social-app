import { describe, expect, it } from "vitest";

import { findDockerProblem, type CommandResult } from "./check-docker.ts";

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
});
