import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { checkStart } from "./check-start.ts";

// Runs the start check against a stand-in for `pnpm start`: a Node.js script that serves the two
// apps' answers on WEB_PORT and API_PORT, or misbehaves in the way its first argument names. The
// real apps need a build, which `pnpm test` does not make; CI runs the check on them.

/**
 * The stand-in. It writes its process ID to the file in its second argument, then, by its first:
 * "ok" serves {"status":"ok"} on API_PORT's /health and an HTML page on WEB_PORT; "bad-health"
 * answers /health with another status; "no-web" serves only the API; "exit" prints an error and
 * exits with code 3; "stubborn" serves both but ignores SIGTERM.
 */
const STAND_IN = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const [mode, pidFile] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
if (mode === "exit") {
  console.error("apps/api start: the API failed to start");
  process.exit(3);
}
if (mode === "stubborn") {
  process.on("SIGTERM", () => {});
}
const status = mode === "bad-health" ? "starting" : "ok";
createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status }));
}).listen(Number(process.env.API_PORT), "127.0.0.1");
if (mode !== "no-web") {
  createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!DOCTYPE html><html><body><h1>Apex Garage</h1></body></html>");
  }).listen(Number(process.env.WEB_PORT), "127.0.0.1");
}
console.log("stand-in started");
`;

/**
 * Runs the check against the stand-in in `mode`, with short time limits. Returns the result and
 * whether the stand-in's process was still running afterwards.
 */
async function checkStandIn(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "apex-check-start-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const script = join(dir, "stand-in.mjs");
  const pidFile = join(dir, "pid");
  writeFileSync(script, STAND_IN);

  const result = await checkStart({
    command: [process.execPath, script, mode, pidFile],
    timeoutMs: 2_000,
    stopTimeoutMs: 1_000,
  });

  const pid = Number(readFileSync(pidFile, "utf8"));
  let running = true;
  try {
    process.kill(pid, 0);
  } catch {
    running = false;
  }
  return { result, running };
}

describe("checkStart", { timeout: 20_000 }, () => {
  it("passes when both apps answer on the ports it gives them, and stops them", async () => {
    const { result, running } = await checkStandIn("ok");

    expect(result.problem, result.output).toBeUndefined();
    expect(result.ports.web).not.toBe(result.ports.api);
    expect(result.output).toContain("stand-in started");
    expect(running).toBe(false);
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
});
