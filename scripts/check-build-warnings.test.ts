import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";

import { findBuildWarnings } from "./check-build-warnings.ts";

// The logs below are excerpts of real `pnpm build` output from this repository, captured with
// CI=true as on GitHub Actions. The warnings and errors were provoked on purpose in a scratch copy.

/** A clean build. In CI it includes Next.js's notice that no build cache was restored. */
const cleanBuild = [
  "$ pnpm --recursive build",
  "packages/shared build$ rm -rf dist && tsc --project tsconfig.build.json",
  "packages/shared build: Done",
  "apps/web build$ next build",
  "apps/api build$ rm -rf dist && tsc --project tsconfig.build.json",
  "apps/web build: ▲ Next.js 16.4.0 (Turbopack)",
  "apps/web build: ✓ Running next.config.ts took 12ms",
  "apps/web build: ⚠ No build cache found. Please configure build caching for faster rebuilds. Read more: https://nextjs.org/docs/messages/no-cache",
  "apps/web build: Attention: Next.js now collects completely anonymous telemetry regarding usage.",
  "apps/web build:   Creating an optimized production build ...",
  "apps/api build: Done",
  "apps/web build: ✓ Compiled successfully in 868ms",
  "apps/web build:   Running TypeScript ...",
  "apps/web build:   Finished TypeScript in 578ms ...",
  "apps/web build: ✓ Generating static pages using 4 workers (3/3) in 157ms",
  "apps/web build: Route (app)",
  "apps/web build: ┌ ○ /",
  "apps/web build: └ ○ /_not-found",
  "apps/web build: ○  (Static)  prerendered as static content",
  "apps/web build: Done",
  "",
].join("\n");

/** next.config.ts with an option that does not exist: Next.js warns and builds anyway. */
const unknownConfigOption = [
  "apps/web build: ✓ Running next.config.ts took 12ms",
  "apps/web build: ⚠ Invalid next.config.ts options detected: ",
  "apps/web build: ⚠     Unrecognized key(s) in object: 'notARealOption'",
  "apps/web build: ⚠ See more info here: https://nextjs.org/docs/messages/invalid-next-config",
  "apps/web build:   Creating an optimized production build ...",
].join("\n");

/** Turbopack's compile warnings: a header, then each warning with a code frame. */
const turbopackWarnings = [
  "apps/web build: Turbopack build encountered 2 warnings:",
  "apps/web build: ./apps/web/src/app/probe.ts:5:10",
  "apps/web build: Warning: Dynamic filesystem access causes tracing of the whole project",
  'apps/web build: > 5 |   return readFileSync(path.join(process.cwd(), name), "utf8");',
  "apps/web build: ./apps/web/src/app/probe.ts:5:23",
  "apps/web build: Warning: Dynamic filesystem access causes tracing of the whole project",
].join("\n");

/**
 * Pages that log an error, or leave a promise rejection unhandled, while Next.js prerenders them:
 * Next.js prints each error with a code frame and still finishes the build.
 */
const errorsWhilePrerendering = [
  "apps/web build:   Generating static pages using 7 workers (0/6) ...",
  "apps/web build: Error: probe: an error logged while prerendering",
  "apps/web build:     at <unknown> (src/app/probe-error/page.tsx:2:17)",
  "apps/web build:   1 | export default function Page() {",
  'apps/web build: > 2 |   console.error(new Error("probe: an error logged while prerendering"));',
  "apps/web build:     |                 ^",
  "apps/web build: Error: probe: an unhandled rejection while prerendering",
  "apps/web build:     at <unknown> (src/app/probe-rejection/page.tsx:2:23)",
  'apps/web build: > 2 |   void Promise.reject(new Error("probe: an unhandled rejection while prerendering"));',
  "apps/web build: ✓ Generating static pages using 7 workers (6/6) in 292ms",
].join("\n");

describe("findBuildWarnings", () => {
  it("finds no warnings in a clean build, ignoring the CI notice about the build cache", () => {
    expect(findBuildWarnings(cleanBuild)).toEqual([]);
  });

  it("finds the warnings that Next.js logs with ⚠, such as an unknown next.config.ts option", () => {
    expect(findBuildWarnings(unknownConfigOption)).toEqual([
      "apps/web build: ⚠ Invalid next.config.ts options detected:",
      "apps/web build: ⚠     Unrecognized key(s) in object: 'notARealOption'",
      "apps/web build: ⚠ See more info here: https://nextjs.org/docs/messages/invalid-next-config",
    ]);
  });

  it("finds Turbopack's compile warnings", () => {
    expect(findBuildWarnings(turbopackWarnings)).toEqual([
      "apps/web build: Turbopack build encountered 2 warnings:",
      "apps/web build: Warning: Dynamic filesystem access causes tracing of the whole project",
      "apps/web build: Warning: Dynamic filesystem access causes tracing of the whole project",
    ]);
  });

  it("finds errors that pages log or leave unhandled while Next.js prerenders them", () => {
    expect(findBuildWarnings(errorsWhilePrerendering)).toEqual([
      "apps/web build: Error: probe: an error logged while prerendering",
      "apps/web build: Error: probe: an unhandled rejection while prerendering",
    ]);
  });

  it("finds Next.js's error lines and other printed errors", () => {
    // Not captured from a real build, unlike the logs above: the messages are made up. "⨯" is the
    // prefix of Next.js's error log (next/dist/build/output/log.js), as "⚠" is of its warnings,
    // and "TypeError:" is how Node.js prints a TypeError.
    const log = [
      "apps/web build: ⨯ Failed to generate the page",
      "apps/web build: TypeError: Cannot read properties of undefined (reading 'name')",
    ].join("\n");

    expect(findBuildWarnings(log)).toHaveLength(2);
  });

  it("finds Node.js warnings and pnpm warnings", () => {
    const log = [
      "apps/web build: (node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
      "apps/api build: (node:4242) Warning: Closing file descriptor 42 on garbage collection",
      "[WARN] Unsupported engine: wanted node >=24",
    ].join("\n");

    expect(findBuildWarnings(log)).toHaveLength(3);
  });

  it("finds a warning that has colour codes and Windows line endings", () => {
    const log =
      "\u001b[33m\u001b[1m⚠\u001b[22m\u001b[39m Invalid next.config.ts options detected: \r\nok\r\n";

    expect(findBuildWarnings(log)).toEqual(["⚠ Invalid next.config.ts options detected:"]);
  });

  it("does not flag lines that only mention warnings or errors", () => {
    const log = [
      "apps/web build: ├ ○ /settings/warnings",
      "apps/web build: ├ ○ /errors/report",
      "apps/web build: ✓ Compiled successfully with no warnings in 868ms",
      "apps/web build: Warnings and errors are shown above",
    ].join("\n");

    expect(findBuildWarnings(log)).toEqual([]);
  });
});

describe("check-build-warnings command", { timeout: 20_000 }, () => {
  const script = fileURLToPath(new URL("check-build-warnings.ts", import.meta.url));

  /** Writes a build log to a temporary file and returns its path. */
  function logFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "apex-build-log-"));
    onTestFinished(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const file = join(dir, "build.log");
    writeFileSync(file, content);
    return file;
  }

  function check(...args: string[]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    return result;
  }

  it("passes a clean build and says so", () => {
    const result = check(logFile(cleanBuild));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("The build printed no warnings or errors.\n");
  });

  it("fails a build with warnings and lists them", () => {
    const result = check(logFile(`${cleanBuild}${unknownConfigOption}`));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The build printed 3 warning or error line(s)");
    expect(result.stderr).toContain("Unrecognized key(s) in object: 'notARealOption'");
    expect(result.stdout).toBe("");
  });

  it("fails a build that printed errors but finished", () => {
    const result = check(logFile(`${cleanBuild}${errorsWhilePrerendering}`));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The build printed 2 warning or error line(s)");
    expect(result.stderr).toContain("Error: probe: an unhandled rejection while prerendering");
  });

  it.each([
    ["no file", () => []],
    ["two files", () => [logFile(cleanBuild), logFile(cleanBuild)]],
  ])("fails with status 2 when given %s", (_label, args) => {
    const result = check(...args());

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(
      "check-build-warnings: expected one argument, the file holding the output of pnpm build\n",
    );
  });

  it("fails with status 2 when given an option", () => {
    const result = check("--quiet", logFile(cleanBuild));

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^check-build-warnings: .*Unknown option '--quiet'/u);
  });

  it("fails with status 2 when the log cannot be read", () => {
    const missing = join(logFile(cleanBuild), "..", "missing.log");
    const result = check(missing);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });
});
