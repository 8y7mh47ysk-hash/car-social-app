// The CI step "Fail on build warnings" (instruction 5: "fail on any warning"). It reads the saved
// output of `pnpm build` and fails if the build printed a warning. Next.js is the reason: it prints
// warnings and still finishes the build. (tsc, which builds packages/shared and the API, reports
// only errors, and errors already fail `pnpm build`.) pnpm merges every package's stdout and
// stderr into one stream, so warnings are recognised by how they are written.
// docs/DECISIONS.md lists what CI enforces and why.
//
// Usage: node scripts/check-build-warnings.ts <file holding the output of pnpm build>
// Exit status: 0 no warnings, 1 warnings found, 2 wrong arguments or unreadable file.

import { readFileSync } from "node:fs";
import { parseArgs, stripVTControlCharacters } from "node:util";

/**
 * How warnings are marked: Next.js's "⚠" log prefix; "Warning:", used by older Next.js messages,
 * by each of Turbopack's compile warnings and, as "(node:123) Warning:" or "DeprecationWarning:",
 * by Node.js; the header above Turbopack's compile warnings; and pnpm's "WARN".
 */
const WARNING_MARKERS = [
  /⚠/u,
  /Warning:/u,
  /Turbopack build encountered \d+ warnings?/u,
  /\bWARN\b/u,
];

/**
 * In CI, Next.js prints this whenever apps/web/.next/cache does not exist, that is, on every run
 * that has not restored a build cache. It is about the CI machine, not the code, and Next.js
 * writes it to stdout instead of stderr precisely so that CI checks can tell it from real warnings.
 */
const NOT_WARNINGS = [/No build cache found\./u];

/** Returns the lines of a build log that are warnings, without colour codes. */
export function findBuildWarnings(log: string): string[] {
  return log
    .split(/\r?\n/u)
    .map((line) => stripVTControlCharacters(line).trim())
    .filter(
      (line) =>
        WARNING_MARKERS.some((marker) => marker.test(line)) &&
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

  const warnings = findBuildWarnings(log);
  if (warnings.length === 0) {
    console.log("The build printed no warnings.");
    return 0;
  }
  console.error(
    [
      `The build printed ${String(warnings.length)} warning line(s), and CI fails on any warning:`,
      ...warnings.map((warning) => `  ${warning}`),
      "The full messages are in the Build step's output.",
    ].join("\n"),
  );
  return 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
