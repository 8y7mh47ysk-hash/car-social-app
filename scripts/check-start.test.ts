import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, vi, type TestContext } from "vitest";

import { checkStart } from "./check-start.ts";

// Runs the start check against a stand-in for `pnpm start`: a Node.js script that serves the two
// apps' answers on WEB_PORT and API_PORT, or misbehaves in the ways its first argument names. The
// real apps need a build, which `pnpm test` does not make; CI runs the check on them.

/**
 * The stand-in. It writes its process ID to the file in its second argument, then behaves as its
 * first argument says: one mode, or several joined with "+". "ok" serves {"status":"ok"} on
 * API_PORT's /health and an HTML page on WEB_PORT. The other modes change that: "bad-health"
 * answers /health with another body, "health-503" with status 503; "no-web" serves only the API;
 * "web-500" answers the page with status 500, "web-text" as text/plain, "web-no-end" without
 * </html>, and "web-hang" never; "exit" prints an error and exits with code 3; "stubborn" ignores
 * SIGTERM.
 * Two modes start a helper process and add its process ID to the file: "escaped", one that leaves
 * the process group but keeps the output open for 30 s, and "left-behind", one that stays in the
 * group and ignores SIGTERM but does not hold the output. The stand-in and its helpers end by
 * themselves once the process whose ID is the third argument, the test runner, has ended: a test
 * run that is killed midway cannot leave them running. They do not watch the check, so a check
 * that ends without stopping them is still caught.
 */
const STAND_IN = `
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [mode, pidFile, runner] = process.argv.slice(2);
const modes = new Set(mode.split("+"));
writeFileSync(pidFile, String(process.pid));
setInterval(() => {
  try {
    process.kill(Number(runner), 0);
  } catch {
    process.exit(1);
  }
}, 200).unref();
/** Starts a helper that runs \`code\` and ends once the runner, its argument, has ended. */
function startHelper(code, options) {
  const watch =
    "setInterval(() => { try { process.kill(Number(process.argv[1]), 0); } " +
    "catch { process.exit(1); } }, 200);";
  const helper = spawn(process.execPath, ["-e", watch + code, runner], options);
  appendFileSync(pidFile, "\\n" + String(helper.pid));
  helper.unref();
}

if (modes.has("exit")) {
  console.error("apps/api start: the API failed to start");
  process.exit(3);
}
if (modes.has("stubborn")) {
  process.on("SIGTERM", () => {});
}
if (modes.has("escaped")) {
  startHelper("setTimeout(() => process.exit(0), 30_000)", {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
}
if (modes.has("left-behind")) {
  startHelper('process.on("SIGTERM", () => {})', { stdio: "ignore" });
}

const apiHost = process.env.API_HOST ?? "127.0.0.1";
const webHost = process.env.WEB_HOST ?? "127.0.0.1";
createServer((request, response) => {
  response.writeHead(modes.has("health-503") ? 503 : 200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: modes.has("bad-health") ? "starting" : "ok" }));
}).listen(Number(process.env.API_PORT), apiHost);
if (!modes.has("no-web")) {
  const type = modes.has("web-text") ? "text/plain" : "text/html";
  const page = "<!DOCTYPE html><html><body><h1>Apex Garage</h1></body></html>";
  createServer((request, response) => {
    if (modes.has("web-hang")) {
      return;
    }
    response.writeHead(modes.has("web-500") ? 500 : 200, {
      "content-type": type + "; charset=utf-8",
    });
    response.end(modes.has("web-no-end") ? page.replace("</html>", "") : page);
  }).listen(Number(process.env.WEB_PORT), webHost);
}
console.log(\`stand-in started: the API on \${apiHost}, the web app on \${webHost}\`);
`;

/** The context's onTestFinished, which also works for tests that run concurrently. */
type OnFinished = TestContext["onTestFinished"];

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
 * Whether the process `pid` ends within `ms`. A process whose parent has ended is reaped by
 * another process, so it may still be listed for a moment after it was killed.
 */
async function endsWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (isRunning(pid)) {
    if (Date.now() > deadline) {
      return false;
    }
    await sleep(20);
  }
  return true;
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
function standInDirectory(onFinished: OnFinished): { dir: string; pidFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "apex-check-start-"));
  const pidFile = join(dir, "pid");
  onFinished(() => {
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
 * Writes the stand-in to a new temporary directory (see standInDirectory) and returns the command
 * that runs it in `mode`.
 */
function prepareStandIn(mode: string, onFinished: OnFinished) {
  const { dir, pidFile } = standInDirectory(onFinished);
  const script = join(dir, "stand-in.mjs");
  writeFileSync(script, STAND_IN);
  const command: [string, ...string[]] = [
    process.execPath,
    script,
    mode,
    pidFile,
    String(process.pid),
  ];
  return { dir, pidFile, command };
}

/** Waits until the stand-in has written its process ID, and returns that ID. */
async function standInPid(pidFile: string): Promise<number> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [pid] = readPids(pidFile);
    if (pid !== undefined) {
      return pid;
    }
    if (Date.now() > deadline) {
      throw new Error("the stand-in did not start within 10 s");
    }
    await sleep(20);
  }
}

/**
 * Runs the check against the stand-in in `mode`, with short time limits. Returns the result,
 * whether the stand-in's process was still running afterwards, and the process IDs of its
 * helpers, if any.
 */
async function checkStandIn(mode: string, onFinished: OnFinished) {
  const { pidFile, command } = prepareStandIn(mode, onFinished);

  const result = await checkStart({ command, timeoutMs: 2_000, stopTimeoutMs: 1_000 });

  const [pid, ...helpers] = readPids(pidFile);
  if (pid === undefined) {
    throw new Error(`the stand-in wrote no process ID; the check said: ${String(result.problem)}`);
  }
  return { result, running: isRunning(pid), helpers };
}

const apiUrl = (port: number): string => `the API (GET http://127.0.0.1:${String(port)}/health)`;
const webUrl = (port: number): string => `the web app (GET http://127.0.0.1:${String(port)}/)`;

/** What the check says when a process outside the command's group holds the output. */
const ESCAPED =
  "The apps' output was still open 1 s after SIGKILL: a process outside the command's " +
  "process group holds it, and may still be running.";

describe("checkStart", { timeout: 20_000 }, () => {
  it("passes when both apps answer on the ports it gives them, and stops them", async ({
    onTestFinished,
  }) => {
    const { result, running } = await checkStandIn("ok", onTestFinished);

    expect(result.problem, result.output).toBeUndefined();
    expect(result.stopProblem).toBeUndefined();
    expect(result.ports.web).not.toBe(result.ports.api);
    expect(result.output).toContain("stand-in started");
    expect(running).toBe(false);
  });

  it("runs the apps on 127.0.0.1, whatever WEB_HOST and API_HOST say", async ({
    onTestFinished,
  }) => {
    // A developer's shell or apps/api/.env may widen the address, for example to reach the app
    // from a phone; the check must not expose the apps, nor wait for an address it does not ask.
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.stubEnv("WEB_HOST", "0.0.0.0");
    vi.stubEnv("API_HOST", "0.0.0.0");

    const { result } = await checkStandIn("ok", onTestFinished);

    expect(result.problem, result.output).toBeUndefined();
    expect(result.output).toContain(
      "stand-in started: the API on 127.0.0.1, the web app on 127.0.0.1",
    );
  });

  it("fails at once when the command stops before both apps answer, keeping its output", async ({
    onTestFinished,
  }) => {
    const started = Date.now();
    const { result } = await checkStandIn("exit", onTestFinished);

    expect(result.problem).toMatch(
      /^`.+ exit .+` exited with code 3 before both apps answered\.$/u,
    );
    expect(result.output).toContain("the API failed to start");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("fails, and kills the apps, when they do not stop after SIGTERM", async ({
    onTestFinished,
  }) => {
    const { result, running } = await checkStandIn("stubborn", onTestFinished);

    expect(result.problem).toBe(
      "The apps did not stop within 1 s of SIGTERM; SIGKILL stopped them.",
    );
    expect(result.stopProblem).toBe(result.problem);
    expect(running).toBe(false);
  });

  it("stops waiting, and says why, when a process outside the group keeps the output open", async ({
    onTestFinished,
  }) => {
    // SIGKILL reaches only the command's process group. A process that left it, but still holds
    // the output, would otherwise keep the check waiting until it ended.
    const started = Date.now();
    const { result, running } = await checkStandIn("escaped", onTestFinished);

    expect(result.problem).toBe(ESCAPED);
    expect(result.stopProblem).toBe(ESCAPED);
    expect(running).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("kills the processes that the command leaves behind in its group", async ({
    onTestFinished,
  }) => {
    // A process that ignores SIGTERM but does not hold the output does not keep the check
    // waiting; the SIGKILL to the group at the end stops it.
    const { result, helpers } = await checkStandIn("left-behind", onTestFinished);
    const [leftBehind] = helpers;
    if (leftBehind === undefined) {
      throw new Error("the stand-in left no helper process behind");
    }

    expect(result.problem, result.output).toBeUndefined();
    expect(await endsWithin(leftBehind, 5_000)).toBe(true);
  });

  it("stops the apps, and fails, once its signal is aborted while it waits", async ({
    onTestFinished,
  }) => {
    const { pidFile, command } = prepareStandIn("no-web", onTestFinished);
    const controller = new AbortController();
    const started = Date.now();

    const checking = checkStart({
      command,
      timeoutMs: 10_000,
      stopTimeoutMs: 1_000,
      signal: controller.signal,
    });
    const pid = await standInPid(pidFile);
    controller.abort();
    const result = await checking;

    expect(result.problem).toBe("The check was interrupted before both apps answered.");
    expect(isRunning(pid)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("starts nothing when its signal is already aborted", async ({ onTestFinished }) => {
    const { command } = prepareStandIn("ok", onTestFinished);

    const result = await checkStart({ command, signal: AbortSignal.abort() });

    expect(result.problem).toBe(
      `The check was interrupted before \`${command.join(" ")}\` started.`,
    );
    expect(result.output).toBe("");
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

// Each of these waits out the check's 2-second limit for the apps, so they run side by side.
describe.concurrent("checkStart, when an app answers wrongly", { timeout: 20_000 }, () => {
  it("fails when the API's GET /health is not {status: ok}", async ({ onTestFinished }) => {
    const { result, running } = await checkStandIn("bad-health", onTestFinished);

    expect(result.problem).toBe(
      `After 2 s, ${apiUrl(result.ports.api)} answered with status 200 and an unexpected body.`,
    );
    expect(running).toBe(false);
  });

  it("fails when the web app does not answer, and names only it", async ({ onTestFinished }) => {
    const { result, running } = await checkStandIn("no-web", onTestFinished);

    expect(result.problem).toMatch(
      new RegExp(
        `^After 2 s, the web app \\(GET http://127\\.0\\.0\\.1:${String(result.ports.web)}/\\) ` +
          "did not answer \\(.+\\)\\.$",
        "u",
      ),
    );
    expect(running).toBe(false);
  });

  it("fails on a status other than 200 from either app, whatever the body", async ({
    onTestFinished,
  }) => {
    const { result } = await checkStandIn("health-503+web-500", onTestFinished);

    expect(result.problem).toBe(
      `After 2 s, ${apiUrl(result.ports.api)} answered with status 503, and ` +
        `${webUrl(result.ports.web)} answered with status 500.`,
    );
  });

  it.for([
    [
      "web-text",
      "answered with status 200 and content type text/plain; charset=utf-8, not text/html",
    ],
    ["web-no-end", "answered with status 200 and an HTML page without </html>"],
  ] as const)(
    "fails when the home page is not a whole HTML page (%s)",
    async ([mode, answer], { onTestFinished }) => {
      const { result } = await checkStandIn(mode, onTestFinished);

      expect(result.problem).toBe(`After 2 s, ${webUrl(result.ports.web)} ${answer}.`);
    },
  );

  it("gives up on a request that gets no answer, and fails within its time limits", async ({
    onTestFinished,
  }) => {
    // Each request may take 2 s, so the check ends at most one request and one pause after its
    // own 2-second limit.
    const started = Date.now();
    const { result } = await checkStandIn("web-hang", onTestFinished);

    expect(result.problem).toMatch(
      /^After 2 s, the web app \(GET http:\/\/127\.0\.0\.1:\d+\/\) did not answer \(.+\)\.$/u,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports every problem, one per line: no answer, then no stop on SIGTERM", async ({
    onTestFinished,
  }) => {
    const { result, running } = await checkStandIn("bad-health+stubborn", onTestFinished);

    expect(result.problem).toBe(
      `After 2 s, ${apiUrl(result.ports.api)} answered with status 200 and an unexpected body.\n` +
        "The apps did not stop within 1 s of SIGTERM; SIGKILL stopped them.",
    );
    expect(result.stopProblem).toBe(
      "The apps did not stop within 1 s of SIGTERM; SIGKILL stopped them.",
    );
    expect(running).toBe(false);
  });

  it("reports every problem, one per line: no answer, then output held open", async ({
    onTestFinished,
  }) => {
    const { result } = await checkStandIn("no-web+escaped", onTestFinished);

    expect(result.problem?.split("\n")).toEqual([
      expect.stringMatching(/^After 2 s, the web app .+ did not answer \(.+\)\.$/u),
      ESCAPED,
    ]);
    expect(result.stopProblem).toBe(ESCAPED);
  });
});

/** A stand-in for `pnpm` that runs the stand-in the environment describes, whatever its arguments. */
const PNPM_STAND_IN = `#!/bin/sh
exec "$STAND_IN_NODE" "$STAND_IN_SCRIPT" "$STAND_IN_MODE" "$STAND_IN_PID_FILE" "$STAND_IN_RUNNER"
`;

describe.concurrent("check-start command", { timeout: 20_000 }, () => {
  const script = fileURLToPath(new URL("check-start.ts", import.meta.url));

  /**
   * Starts the program in a process group of its own, as a terminal starts a command, with a PATH
   * whose `pnpm` runs the stand-in in `mode`. With `limits`, it runs the program's main() with
   * those time limits instead of the default ones. Kills the program's group when the test
   * finishes.
   */
  function startProgram(
    mode: string,
    onFinished: OnFinished,
    limits?: { timeoutMs: number; stopTimeoutMs: number },
  ) {
    const { dir, pidFile, command } = prepareStandIn(mode, onFinished);
    const [node, standIn] = command;
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "pnpm"), PNPM_STAND_IN, { mode: 0o755 });

    const args =
      limits === undefined
        ? [script]
        : [
            "--input-type=module",
            "--eval",
            `import { main } from ${JSON.stringify(pathToFileURL(script).href)};\n` +
              `await main(${JSON.stringify(limits)});`,
          ];
    const started = Date.now();
    const program = spawn(process.execPath, args, {
      detached: true,
      env: {
        PATH: [bin, "/usr/bin", "/bin"].join(":"),
        STAND_IN_NODE: node,
        STAND_IN_SCRIPT: standIn,
        STAND_IN_MODE: mode,
        STAND_IN_PID_FILE: pidFile,
        STAND_IN_RUNNER: String(process.pid),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { pid } = program;
    if (pid === undefined) {
      throw new Error("could not start node scripts/check-start.ts");
    }
    onFinished(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // It has ended.
      }
    });
    let stdout = "";
    let stderr = "";
    program.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    program.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const ended = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      seconds: number;
    }>((resolve) => {
      program.once("close", (code, signal) => {
        resolve({ code, signal, seconds: (Date.now() - started) / 1000 });
      });
    });
    return { pid, pidFile, ended, stdout: () => stdout, stderr: () => stderr };
  }

  it("says so and exits with status 0 when both apps answered and stopped", async ({
    onTestFinished,
  }) => {
    const program = startProgram("ok", onTestFinished);

    expect(await program.ended).toMatchObject({ code: 0, signal: null });
    expect(program.stdout()).toMatch(
      new RegExp(
        "^Both apps started: the API answered GET /health on port \\d+, " +
          "the web app its home page on port \\d+, and both stopped\\.\\n$",
        "u",
      ),
    );
    expect(program.stderr()).toBe("");
  });

  it("exits with status 1, saying what went wrong and what the apps printed", async ({
    onTestFinished,
  }) => {
    const program = startProgram("exit", onTestFinished);

    expect(await program.ended).toMatchObject({ code: 1, signal: null });
    expect(program.stderr()).toBe(
      "`pnpm start` exited with code 3 before both apps answered.\n" +
        "What the apps printed:\napps/api start: the API failed to start\n\n",
    );
    expect(program.stdout()).toBe("");
  });

  it("ends once it gives up on a process outside the group that holds the output", async ({
    onTestFinished,
  }) => {
    // That process holds the output for 30 s. The program closes its ends of the output, or it
    // would wait for that process before it could exit.
    const program = startProgram("escaped", onTestFinished, {
      timeoutMs: 2_000,
      stopTimeoutMs: 1_000,
    });

    const ended = await program.ended;

    expect(ended).toMatchObject({ code: 1, signal: null });
    expect(ended.seconds).toBeLessThan(10);
    expect(program.stderr().split("\n")[0]).toBe(ESCAPED);
  });

  it.for([
    { signal: "SIGINT", how: "Ctrl+C: to the program's process group, as a terminal sends it" },
    { signal: "SIGTERM", how: "to the program alone, as kill and timeout send it" },
    { signal: "SIGHUP", how: "to the program's process group, as a closed terminal does" },
  ] as const)(
    "stops the apps, then ends by $signal ($how)",
    async ({ signal, how }, { onTestFinished }) => {
      const program = startProgram("no-web", onTestFinished);
      const standIn = await standInPid(program.pidFile);

      process.kill(how.includes("group") ? -program.pid : program.pid, signal);

      expect(await program.ended).toMatchObject({ code: null, signal });
      expect(program.stderr()).toBe(`Interrupted by ${signal}: stopped the apps.\n`);
      expect(isRunning(standIn)).toBe(false);
    },
  );

  it("says that a process may still run when it was interrupted and could not stop it", async ({
    onTestFinished,
  }) => {
    const program = startProgram("no-web+escaped", onTestFinished, {
      timeoutMs: 10_000,
      stopTimeoutMs: 1_000,
    });
    await standInPid(program.pidFile);

    process.kill(-program.pid, "SIGINT");
    const ended = await program.ended;

    expect(ended).toMatchObject({ code: null, signal: "SIGINT" });
    expect(ended.seconds).toBeLessThan(10);
    expect(program.stderr()).toBe(`Interrupted by SIGINT. ${ESCAPED}\n`);
  });

  it("fails with status 1 and says so when pnpm is not on PATH", ({ onTestFinished }) => {
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
