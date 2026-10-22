import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// Instruction 1: one ESLint config for the whole repository, with typescript-eslint's
// type-checked rules everywhere, Next.js's rules for the Next.js app, and React Hooks and strict
// jsx-a11y rules for React code. These tests ask ESLint which rules the config gives to files of
// every kind that a rule set covers, in each part of the repository, and compare them with the rule
// sets themselves, so that a narrowed file pattern or a weaker rule set fails here instead of
// quietly linting less.

const repoRoot = import.meta.dirname;
const eslint = new ESLint({ cwd: repoRoot });
const require = createRequire(import.meta.url);

/** Flat configs, as far as these tests read them. */
const flatConfigsSchema = z.array(
  z.looseObject({
    name: z.string().optional(),
    files: z.array(z.unknown()).optional(),
    rules: z.record(z.string(), z.unknown()).optional(),
  }),
);

/**
 * The file extensions that the flat config called `name`, in a list of configs, applies to: those
 * its `files` patterns name, such as "**\/*.ts" or "**\/*.{js,jsx}".
 */
function extensionsOf(configs: unknown, name: string): string[] {
  const config = flatConfigsSchema.parse(configs).find((entry) => entry.name === name);
  return (config?.files ?? []).flatMap((pattern) => {
    const match = typeof pattern === "string" ? /^\*\*\/\*\.\{?([\w,]+)\}?$/.exec(pattern) : null;
    return match?.[1]?.split(",") ?? [];
  });
}

/** Whether a rule setting (a severity, or a severity followed by options) turns the rule on. */
function isOn(setting: unknown): boolean {
  const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
  return severity === 1 || severity === 2 || severity === "warn" || severity === "error";
}

/** A rule setting as ESLint resolves it: the severity as a number, then any options. */
function resolvedForm(setting: unknown): unknown[] {
  const parts = z.array(z.unknown()).safeParse(setting);
  const [severity, ...options] = parts.success ? parts.data : [setting];
  const levels = new Map<unknown, number>([
    ["off", 0],
    ["warn", 1],
    ["error", 2],
  ]);
  return [levels.get(severity) ?? severity, ...options];
}

/** The rules that a list of flat configs turns on, as warnings or errors. */
function rulesTurnedOn(configs: unknown): string[] {
  const settings = new Map<string, unknown>();
  for (const { rules = {} } of flatConfigsSchema.parse(configs)) {
    for (const [rule, setting] of Object.entries(rules)) {
      settings.set(rule, setting);
    }
  }
  return [...settings].filter(([, setting]) => isOn(setting)).map(([rule]) => rule);
}

const TYPESCRIPT_RULES = rulesTurnedOn([
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
]);

/** The kinds of file that typescript-eslint lints as TypeScript: ts, tsx, mts and cts. */
const TYPESCRIPT_EXTENSIONS = extensionsOf(
  tseslint.configs.strictTypeChecked,
  "typescript-eslint/eslint-recommended",
);

// Neither package ships type declarations, so their configs are read with require and checked.
const nextConfigs: unknown = require("eslint-config-next/core-web-vitals");
const NEXT_RULES = rulesTurnedOn(nextConfigs);
const REACT_HOOKS_RULES = NEXT_RULES.filter((rule) => rule.startsWith("react-hooks/"));

/**
 * The kinds of file that Next.js's own config lints, which can hold React components and hooks:
 * js, jsx, mjs, ts, tsx, mts and cts.
 */
const NEXT_EXTENSIONS = extensionsOf(nextConfigs, "next");

/**
 * Where code lives in a package: modules and components in src, deeper folders of src (hooks,
 * route handlers) and config files at the package's root, such as next.config.ts.
 */
const PLACES = ["src/example", "src/lib/use-example", "src/app/example/route", "example.config"];

/** A file of every kind in `extensions` in every place of the package in `dir`. */
function filesIn(dir: string, extensions: readonly string[]): string[] {
  return PLACES.flatMap((place) => extensions.map((extension) => `${dir}/${place}.${extension}`));
}

/** jsx-a11y's strict rules with their settings; its recommended set gives some weaker options. */
const A11Y_STRICT_RULES = Object.entries(
  z
    .object({
      flatConfigs: z.object({ strict: z.object({ rules: z.record(z.string(), z.unknown()) }) }),
    })
    .parse(require("eslint-plugin-jsx-a11y")).flatConfigs.strict.rules,
);

/** The one jsx-a11y rule that the config sets itself, to check Next.js's <Image> too. */
const ALT_TEXT = "jsx-a11y/alt-text";

/** The rules, with their settings, that the repository's config gives to `file`. */
async function rulesFor(file: string): Promise<Record<string, unknown>> {
  return z
    .object({ rules: z.record(z.string(), z.unknown()) })
    .parse(await eslint.calculateConfigForFile(file)).rules;
}

const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

/** The workspace packages (pnpm-workspace.yaml: apps/* and packages/*) and what they depend on. */
const packages: { dir: string; dependencies: Set<string> }[] = [];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(join(repoRoot, parent), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dir = `${parent}/${entry.name}`;
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(join(repoRoot, dir, "package.json"), "utf8")),
      );
      const lists = [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies];
      packages.push({
        dir,
        dependencies: new Set(lists.flatMap((list) => Object.keys(list ?? {}))),
      });
    }
  }
}

const dependingOn = (name: string): string[] =>
  packages.filter(({ dependencies }) => dependencies.has(name)).map(({ dir }) => dir);

describe("the ESLint config", () => {
  it("knows the rule sets, the kinds of file and the packages it is checked against", () => {
    expect(TYPESCRIPT_RULES.length).toBeGreaterThan(50);
    expect(A11Y_STRICT_RULES.length).toBeGreaterThan(20);
    expect(REACT_HOOKS_RULES).toContain("react-hooks/rules-of-hooks");
    expect(NEXT_RULES).toContain("@next/next/no-html-link-for-pages");
    expect(TYPESCRIPT_EXTENSIONS).toEqual(expect.arrayContaining(["ts", "tsx"]));
    expect(NEXT_EXTENSIONS).toEqual(expect.arrayContaining(["js", "jsx", "ts", "tsx"]));
    expect(dependingOn("react")).toContain("apps/web");
    expect(dependingOn("next")).toContain("apps/web");
  });

  it.for(["example.test.ts", "infra/example.test.ts", "scripts/example.ts"])(
    "gives %s every rule of typescript-eslint's strict and stylistic sets",
    async (file) => {
      const rules = await rulesFor(file);

      expect(TYPESCRIPT_RULES.filter((rule) => !isOn(rules[rule]))).toEqual([]);
    },
  );

  // Each failure names the file and the first rule it lacks.
  it.for(packages.map(({ dir }) => dir))(
    "gives every TypeScript file in %s every rule of typescript-eslint's strict and stylistic sets",
    async (dir) => {
      const lacking: string[] = [];
      for (const file of filesIn(dir, TYPESCRIPT_EXTENSIONS)) {
        const rules = await rulesFor(file);
        const off = TYPESCRIPT_RULES.filter((rule) => !isOn(rules[rule]));
        if (off.length > 0) {
          lacking.push(`${file}: ${String(off.length)} rules off, such as ${String(off[0])}`);
        }
      }

      expect(lacking).toEqual([]);
    },
  );

  // Hooks live in .ts files (use-*.ts) as well as in components, and JSX can be in .js files. When
  // a React package is added, such as packages/ui (instructions 9 to 16), its files must be added
  // to `reactFiles` in eslint.config.mjs.
  it.for(dependingOn("react"))(
    "gives every file in %s that Next.js's config lints the React Hooks and strict jsx-a11y rules",
    async (dir) => {
      const wrong: string[] = [];
      for (const file of filesIn(dir, NEXT_EXTENSIONS)) {
        const rules = await rulesFor(file);
        for (const rule of REACT_HOOKS_RULES.filter((name) => !isOn(rules[name]))) {
          wrong.push(`${file}: ${rule} is off`);
        }
        for (const [rule, setting] of A11Y_STRICT_RULES) {
          const asStrict =
            rule === ALT_TEXT
              ? isOn(rules[rule])
              : isDeepStrictEqual(resolvedForm(rules[rule]), resolvedForm(setting));
          if (!asStrict) {
            wrong.push(`${file}: ${rule} differs from jsx-a11y's strict set`);
          }
        }
      }

      expect(wrong).toEqual([]);
    },
  );

  it.for(dependingOn("next"))(
    "gives every file in %s that Next.js's config lints every rule of its recommended set",
    async (dir) => {
      const lacking: string[] = [];
      for (const file of filesIn(dir, NEXT_EXTENSIONS)) {
        const rules = await rulesFor(file);
        const off = NEXT_RULES.filter((rule) => !isOn(rules[rule]));
        if (off.length > 0) {
          lacking.push(`${file}: ${String(off.length)} rules off, such as ${String(off[0])}`);
        }
      }

      expect(lacking).toEqual([]);
    },
  );

  // The API logs through its logger, which adds request IDs and redacts secrets (instruction 8).
  it("forbids console output in the API's code", async () => {
    expect(isOn((await rulesFor("apps/api/src/routes/example.ts"))["no-console"])).toBe(true);
  });
});

/** The root package.json's `lint` script, which CI runs. */
const lintScript = z
  .object({ scripts: z.object({ lint: z.string() }) })
  .parse(JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))).scripts.lint;

describe("pnpm lint", () => {
  // CI fails on any warning (instruction 5), and some rules only warn, such as Next.js's
  // react-hooks/exhaustive-deps. The script runs here on a folder of its own, whose config turns
  // one rule on as a warning, with this repository's ESLint first on PATH.
  it("fails when ESLint reports only a warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apex-lint-warning-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    await writeFile(
      join(dir, "eslint.config.mjs"),
      'export default [{ rules: { "no-unused-vars": "warn" } }];\n',
    );
    await writeFile(join(dir, "unused.js"), "const unused = 1;\n");
    const bins = [
      join(repoRoot, "node_modules", ".bin"),
      dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ];

    const result = spawnSync("sh", ["-c", lintScript], {
      cwd: dir,
      env: { PATH: bins.join(delimiter) },
      encoding: "utf8",
    });

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("no-unused-vars");
    expect(result.stdout).toContain("(0 errors, 1 warning)");
  });
});
