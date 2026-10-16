import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Instruction 4: application code reads environment variables only through its app's env module,
// which validates them, and browser code never loads the web app's server env schema.
// eslint.config.mjs enforces both. These tests ask ESLint which of the rules the repository's
// config gives a file, then run them on each way code can reach the environment or the schema.

const eslint = new ESLint({ cwd: import.meta.dirname });

const ENV_RULES = ["no-restricted-properties", "no-restricted-imports", "no-restricted-syntax"];

/** A rule's setting as ESLint resolves it: the severity, then any options. */
const ruleSettingSchema = z.tuple(
  [z.union([z.literal(0), z.literal(1), z.literal(2)])],
  z.unknown(),
);

/** The part of a file's resolved ESLint config that these tests read. */
const resolvedConfigSchema = z.object({
  rules: z.object({
    "no-restricted-properties": ruleSettingSchema.optional(),
    "no-restricted-imports": ruleSettingSchema.optional(),
    "no-restricted-syntax": ruleSettingSchema.optional(),
  }),
});

/** The env rules, with their settings, that the repository's config applies to `path`. */
async function envRulesFor(path: string): Promise<Linter.RulesRecord> {
  const { rules } = resolvedConfigSchema.parse(await eslint.calculateConfigForFile(path));
  const settings: Linter.RulesRecord = {};
  for (const [name, setting] of Object.entries(rules)) {
    if (setting !== undefined) {
      settings[name] = setting;
    }
  }
  return settings;
}

/** The rules that report problems in `code`, a JavaScript module; null for a syntax error. */
function rulesBrokenBy(code: string, rules: Linter.RulesRecord): (string | null)[] {
  return new Linter().verify(code, [{ rules }], "module.js").map((message) => message.ruleId);
}

const ROUTES_TO_THE_ENVIRONMENT = [
  { route: "process.env", code: "export const port = process.env.API_PORT;" },
  { route: 'process.env["NAME"]', code: 'export const port = process.env["API_PORT"];' },
  { route: "destructuring process", code: "const { env } = process;\nexport { env };" },
  {
    route: "a named import of env",
    code: 'import { env } from "node:process";\nexport const port = env.API_PORT;',
  },
  {
    route: "a namespace import",
    code: 'import * as proc from "node:process";\nexport const port = proc.env.API_PORT;',
  },
  {
    route: "a default import under another name",
    code: 'import proc from "process";\nexport const port = proc.env.API_PORT;',
  },
  {
    route: "import() of node:process",
    code: 'const { env } = await import("node:process");\nexport const port = env.API_PORT;',
  },
  {
    route: "import() of process",
    code: 'const proc = await import("process");\nexport const port = proc.env.API_PORT;',
  },
  {
    route: "import() with a template literal",
    code: "const { env } = await import(`node:process`);\nexport const port = env.API_PORT;",
  },
  { route: "globalThis.process", code: "export const port = globalThis.process.env.API_PORT;" },
  { route: "global.process", code: "export const port = global.process.env.API_PORT;" },
  {
    route: "destructuring globalThis",
    code: "const { process: proc } = globalThis;\nexport const port = proc.env.API_PORT;",
  },
];

describe("the rules that keep process.env in the env modules", () => {
  describe.for([
    "apps/api/src/routes/garage.ts",
    "apps/web/src/app/garage/page.tsx",
    "packages/shared/src/garage.ts",
  ])("in %s", (path) => {
    it.for(ROUTES_TO_THE_ENVIRONMENT)("reject $route", async ({ code }) => {
      const broken = rulesBrokenBy(code, await envRulesFor(path));

      expect(broken).not.toEqual([]);
      for (const rule of broken) {
        expect(ENV_RULES).toContain(rule);
      }
    });

    it("allow the global process for anything else", async () => {
      expect(rulesBrokenBy("process.exitCode = 1;", await envRulesFor(path))).toEqual([]);
    });

    it("allow importing other modules, statically or with import()", async () => {
      const code =
        'import { join } from "node:path";\nconst os = await import("node:os");\n' +
        "const timers = await import(`node:timers`);\nexport { join, os, timers };";

      expect(rulesBrokenBy(code, await envRulesFor(path))).toEqual([]);
    });
  });

  it.for(["apps/api/src/server.ts", "apps/web/src/env/server.ts", "apps/web/src/env/public.ts"])(
    "let the env module %s read process.env",
    async (path) => {
      const code = "export const port = process.env.API_PORT;";

      expect(rulesBrokenBy(code, await envRulesFor(path))).toEqual([]);
    },
  );
});

// The web app's server env schema holds the server variables' names, rules and defaults, so no
// browser code may load it. No module may import it, or validate.ts, which imports it, through an
// env folder; the env modules' own imports pass, and apps/web/src/env/public.test.ts covers the
// ones that browser code loads.
const ROUTES_TO_THE_SERVER_SCHEMA = [
  {
    route: "an import of server-schema",
    code: 'import { serverEnvSchema } from "../../env/server-schema";\nexport { serverEnvSchema };',
  },
  {
    route: "an import of server-schema.ts",
    code: 'import { serverEnvSchema } from "../env/server-schema.ts";\nexport { serverEnvSchema };',
  },
  {
    route: "a re-export of server-schema",
    code: 'export { serverEnvSchema } from "../../env/server-schema";',
  },
  {
    route: "import() of server-schema",
    code: 'const schema = await import("../../env/server-schema");\nexport { schema };',
  },
  {
    route: "an import of validate",
    code: 'import { validateWebEnv } from "../../env/validate";\nexport { validateWebEnv };',
  },
  {
    route: "import() of validate with a template literal",
    code: "const validate = await import(`../env/validate`);\nexport { validate };",
  },
];

describe("the rules that keep the web app's server env schema out of browser code", () => {
  describe.for(["apps/web/src/app/garage/page.tsx", "apps/web/src/app/garage/garage-form.tsx"])(
    "in %s",
    (path) => {
      it.for(ROUTES_TO_THE_SERVER_SCHEMA)("reject $route", async ({ code }) => {
        const broken = rulesBrokenBy(code, await envRulesFor(path));

        expect(broken).not.toEqual([]);
        for (const rule of broken) {
          expect(ENV_RULES).toContain(rule);
        }
      });

      it("allow the env modules meant for other code, and other validate modules", async () => {
        const code =
          'import { publicEnv } from "../../env/public";\n' +
          'import { getServerEnv } from "../../env/server";\n' +
          'import { validateGarage } from "./validate";\n' +
          "export { getServerEnv, publicEnv, validateGarage };";

        expect(rulesBrokenBy(code, await envRulesFor(path))).toEqual([]);
      });
    },
  );

  it.for([
    { path: "apps/web/src/env/server.ts", source: "./server-schema" },
    { path: "apps/web/src/env/validate.ts", source: "./server-schema" },
    { path: "apps/web/src/env/env-example.test.ts", source: "./server-schema" },
    { path: "apps/web/src/env/validate.test.ts", source: "./validate" },
    { path: "apps/web/next.config.ts", source: "./src/env/validate" },
  ])("let $path import $source", async ({ path, source }) => {
    const code = `import * as module from "${source}";\nexport { module };`;

    expect(rulesBrokenBy(code, await envRulesFor(path))).toEqual([]);
  });
});
