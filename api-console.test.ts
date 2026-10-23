import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Instruction 8: API code logs through its pino logger, which adds request IDs and redacts
// secrets; text printed with console would skip both. eslint.config.mjs makes console an error in
// apps/api/src, except in the entrypoint, which may have to print before the logger exists. These
// tests ask ESLint which no-console setting the repository's config gives a file, then run it.

const eslint = new ESLint({ cwd: import.meta.dirname });

/** The part of a file's resolved ESLint config that these tests read. */
const resolvedConfigSchema = z.object({
  rules: z.object({
    "no-console": z
      .tuple([z.union([z.literal(0), z.literal(1), z.literal(2)])], z.unknown())
      .optional(),
  }),
});

/** The problems that the no-console setting the config gives `path` reports in `code`. */
async function consoleProblems(path: string, code: string) {
  const { rules } = resolvedConfigSchema.parse(await eslint.calculateConfigForFile(path));
  const setting = rules["no-console"];
  if (setting === undefined) {
    return [];
  }
  const config: Linter.Config = { rules: { "no-console": setting } };
  return new Linter()
    .verify(code, [config], "module.js")
    .map(({ ruleId, severity }) => ({ ruleId, severity }));
}

const PRINTS = 'console.log("car saved");\nconsole.error("engine failure");\n';

// The first test loads the whole ESLint config (typescript-eslint, Next.js's and jsx-a11y's
// plugins): under a second on an idle machine, but more than Vitest's 5 s default while the full
// suite and other work load it.
describe("the rule that keeps console out of the API", { timeout: 30_000 }, () => {
  it.for(["apps/api/src/app.ts", "apps/api/src/lib/logger.ts", "apps/api/src/routes/garage.ts"])(
    "rejects console in %s",
    async (path) => {
      expect(await consoleProblems(path, PRINTS)).toEqual([
        { ruleId: "no-console", severity: 2 },
        { ruleId: "no-console", severity: 2 },
      ]);
    },
  );

  it("lets the entrypoint print before the logger exists", async () => {
    expect(await consoleProblems("apps/api/src/server.ts", PRINTS)).toEqual([]);
  });
});
