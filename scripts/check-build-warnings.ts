// The CI step "Fail on build warnings" (instruction 5: "fail on any warning"). It reads the saved
// output of `pnpm build` and fails if the build printed a warning, or an error that did not stop
// it. Next.js is the reason: it prints warnings, and errors that code logs while it prerenders a
// page, and still finishes the build. (tsc, which builds packages/shared and the API, reports only
// errors, and those fail `pnpm build`.) pnpm's default reporter merges every package's stdout and
// stderr into one stream, so problems are recognised by how they are written. docs/DECISIONS.md
// lists what CI enforces, what it cannot see and why. scripts/check-start.ts looks for the same
// markers in what the apps print while they start.
//
// Usage: node scripts/check-build-warnings.ts <file holding the output of pnpm build>
// Exit status: 0 nothing found, 1 warnings or errors found, 2 wrong arguments or unreadable file.

import { readFileSync } from "node:fs";
import { parseArgs, stripVTControlCharacters } from "node:util";

/**
 * How problems are marked: Next.js's log prefixes "⚠" (warning) and "⨯" (error); "Warning:", used
 * by older Next.js messages, by each of Turbopack's compile warnings and, as "(node:123) Warning:"
 * or "DeprecationWarning:", by Node.js; "Error:", which starts every printed Error object, such as
 * one that code logs or leaves unhandled while Next.js prerenders a page ("TypeError:" included);
 * the header above Turbopack's compile warnings; and pnpm's "WARN". Plain text that code logs
 * while a page is prerendered, even with console.error or console.warn, has no marker, so this
 * check cannot see it.
 */
const PROBLEM_MARKERS = [
  /⚠/u,
  /⨯/u,
  /Warning:/u,
  /Error:/u,
  /Turbopack build encountered \d+ warnings?/u,
  /\bWARN\b/u,
];

/**
 * In CI, Next.js prints this whenever apps/web/.next/cache does not exist, that is, on every run
 * that has not restored a build cache. It is about the CI machine, not the code, and Next.js
 * writes it to stdout instead of stderr precisely so that CI checks can tell it from real warnings.
 */
const NOT_WARNINGS = [/No build cache found\./u];

/**
 * Returns the lines of a log that report a warning or an error, without colour codes: in a build
 * log, the warnings and the errors that did not stop the build.
 */
export function findWarnings(log: string): string[] {
  return log
    .split(/\r?\n/u)
    .map((line) => stripVTControlCharacters(line).trim())
    .filter(
      (line) =>
        PROBLEM_MARKERS.some((marker) => marker.test(line)) &&
        !NOT_WARNINGS.some((notice) => notice.test(line)),
    );
}

function main(args: readonly string[]): number {
  let positionals: string[];
  try {
    // Rejects options: this script takes none.
    ({ positionals } = parseArgs({ args: [...args], allowPositionals: true }));
  } catch (error) {
    console.error(`check-build-warnings: ${String(error)}`);
    return 2;
  }
  const [file, ...extra] = positionals;
  if (file === undefined || extra.length > 0) {
    console.error(
      "check-build-warnings: expected one argument, the file holding the output of pnpm build",
    );
    return 2;
  }

  let log: string;
  try {
    log = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`check-build-warnings: cannot read ${file}: ${String(error)}`);
    return 2;
  }

  const warnings = findWarnings(log);
  if (warnings.length === 0) {
    // Not "no warnings": text that code logs while a page is prerendered has no marker.
    console.log("Found no warning or error lines in the build output.");
    return 0;
  }
  console.error(
    [
      `The build printed ${String(warnings.length)} warning or error line(s), and CI fails on any:`,
      ...warnings.map((warning) => `  ${warning}`),
      "The full messages are in the Build step's output.",
    ].join("\n"),
  );
  return 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
