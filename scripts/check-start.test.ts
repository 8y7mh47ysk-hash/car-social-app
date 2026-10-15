import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { checkStart } from "./check-start.ts";

// Runs the start check against a stand-in for `pnpm start`: a Node.js script that serves the two
// apps' answers on WEB_PORT and API_PORT, or misbehaves in the way its first argument names. The
// real apps need a build, which `pnpm test` does not make; CI runs the check on them.

/**
 * The stand-in. It writes its process ID to the file in its second argument, then, by its first:
 * "ok" serves {"status":"ok"} on API_PORT's /health and an HTML page on WEB_PORT; "bad-health"
 * answers /health with another status; "no-web" serves only the API; "exit" prints an error and
 * exits with code 3; "stubborn" serves both but ignores SIGTERM; "escaped" serves both and starts a
 * helper that leaves the process group but keeps the output open for 30 s, and adds the helper's
 * process ID to the file. It ends by itself once the process whose ID is its third argument, the
 * test runner, has ended: a test run that is killed midway cannot leave it running. It does not
 * watch the check, so a check that ends without stopping it is still caught.
 */
const STAND_IN = `
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [mode, pidFile, runner] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
setInterval(() => {
  try {
    process.kill(Number(runner), 0);
  } catch {
    process.exit(1);
  }
}, 200).unref();
if (mode === "exit") {
  console.error("apps/api start: the API failed to start");
  process.exit(3);
}
if (mode === "stubborn") {
  process.on("SIGTERM", () => {});
}
if (mode === "escaped") {
  const helper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  appendFileSync(pidFile, "\\n" + String(helper.pid));
  helper.unref();
}
const status = mode === "bad-health" ? "starting" : "ok";
const apiHost = process.env.API_HOST ?? "127.0.0.1";
const webHost = process.env.WEB_HOST ?? "127.0.0.1";
createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status }));
}).listen(Number(process.env.API_PORT), apiHost);
if (mode !== "no-web") {
  createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!DOCTYPE html><html><body><h1>Apex Garage</h1></body></html>");
  }).listen(Number(process.env.WEB_PORT), webHost);
}
console.log(\`stand-in started: the API on \${apiHost}, the web app on \${webHost}\`);
`;

/** Whether the process `pid` is running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The process IDs in a stand-in's PID file, the stand-in's own first; none before it starts. Only
 * positive numbers count: signalling 0 would reach this test runner's own process group.
 */
function readPids(pidFile: string): number[] {
  try {
    return readFileSync(pidFile, "utf8")
      .split("\n")
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/**
 * Makes a temporary directory for a stand-in that writes its process ID to `<dir>/pid`. When the
 * current test finishes, however it ends (a failed assertion, a time-out), every process in that
 * file is killed and the directory removed, so no test leaves a process running.
 */
function standInDirectory(): { dir: string; pidFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "apex-check-start-"));
  const pidFile = join(dir, "pid");
  onTestFinished(() => {
    for (const pid of readPids(pidFile)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // It has ended.
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, pidFile };
}

/**
 * Runs the check against the stand-in in `mode`, with short time limits. Returns the result and
 * whether the stand-in's process was still running afterwards.
 */
async function checkStandIn(mode: string) {
  const { dir, pidFile } = standInDirectory();
  const script = join(dir, "stand-in.mjs");
  writeFileSync(script, STAND_IN);

  const result = await checkStart({
    command: [process.execPath, script, mode, pidFile, String(process.pid)],
    timeoutMs: 2_000,
    stopTimeoutMs: 1_000,
  });

  const [pid] = readPids(pidFile);
  if (pid === undefined) {
    throw new Error(`the stand-in wrote no process ID; the check said: ${String(result.problem)}`);
  }
  return { result, running: isRunning(pid) };
}

describe("checkStart", { timeout: 20_000 }, () => {
  it("passes when both apps answer on the ports it gives them, and stops them", async () => {
    const { result, running } = await checkStandIn("ok");

    expect(result.problem, result.output).toBeUndefined();
    expect(result.ports.web).not.toBe(result.ports.api);
    expect(result.output).toContain("stand-in started");
    expect(running).toBe(false);
  });

  it("runs the apps on 127.0.0.1, whatever WEB_HOST and API_HOST say", async () => {
    // A developer's shell or apps/api/.env may widen the address, for example to reach the app
    // from a phone; the check must not expose the apps, nor wait for an address it does not ask.
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.stubEnv("WEB_HOST", "0.0.0.0");
    vi.stubEnv("API_HOST", "0.0.0.0");

    const { result } = await checkStandIn("ok");

    expect(result.problem, result.output).toBeUndefined();
    expect(result.output).toContain(
      "stand-in started: the API on 127.0.0.1, the web app on 127.0.0.1",
    );
  });

  it("fails when the API's GET /health is not {status: ok}", async () => {
    const { result, running } = await checkStandIn("bad-health");

    expect(result.problem).toBe(
      `After 2 s, the API (GET http://127.0.0.1:${String(result.ports.api)}/health) ` +
        "answered with status 200 and an unexpected body.",
    );
    expect(running).toBe(false);
  });

  it("fails when the web app does not answer, and names only it", async () => {
    const { result, running } = await checkStandIn("no-web");

    expect(result.problem).toMatch(
      new RegExp(
        `^After 2 s, the web app \\(GET http://127\\.0\\.0\\.1:${String(result.ports.web)}/\\) ` +
          "did not answer \\(.+\\)\\.$",
        "u",
      ),
    );
    expect(running).toBe(false);
  });

  it("fails at once when the command stops before both apps answer, keeping its output", async () => {
    const started = Date.now();
    const { result } = await checkStandIn("exit");

    expect(result.problem).toMatch(
      /^`.+ exit .+` exited with code 3 before both apps answered\.$/u,
    );
    expect(result.output).toContain("the API failed to start");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("fails, and kills the apps, when they do not stop after SIGTERM", async () => {
    const { result, running } = await checkStandIn("stubborn");

    expect(result.problem).toBe("The apps did not stop within 1 s of SIGTERM.");
    expect(running).toBe(false);
  });

  it("stops waiting, and says why, when a process outside the group keeps the output open", async () => {
    // SIGKILL reaches only the command's process group. A process that left it, but still holds
    // the output, would otherwise keep the check waiting until it ended.
    const started = Date.now();
    const { result, running } = await checkStandIn("escaped");

    expect(result.problem).toBe(
      "The apps' output was still open 1 s after SIGKILL: a process outside the command's " +
        "process group holds it, and may still be running.",
    );
    expect(running).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("fails at once, saying why, when the command cannot be started", async () => {
    const result = await checkStart({
      command: ["apex-no-such-command"],
      timeoutMs: 2_000,
      stopTimeoutMs: 1_000,
    });

    expect(result.problem).toBe(
      "`apex-no-such-command` could not be started (spawn apex-no-such-command ENOENT) " +
        "before both apps answered.",
    );
    expect(result.output).toBe("");
  });
});

describe("check-start command", { timeout: 20_000 }, () => {
  const script = fileURLToPath(new URL("check-start.ts", import.meta.url));

  it("fails with status 1 and says so when pnpm is not on PATH", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "apex-check-start-path-"));
    onTestFinished(() => {
      rmSync(emptyDir, { recursive: true, force: true });
    });

    const result = spawnSync(process.execPath, [script], {
      env: { PATH: emptyDir },
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "`pnpm start` could not be started (spawn pnpm ENOENT) before both apps answered.\n" +
        "The apps printed nothing.\n",
    );
  });
});
