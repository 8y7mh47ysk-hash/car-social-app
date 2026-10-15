import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Instruction 1: one ESLint config for the whole repository, with typescript-eslint's
// type-checked rules everywhere, Next.js's rules for the Next.js app, and React Hooks and strict
// jsx-a11y rules for React code. These tests ask ESLint which rules the config gives to a file in
// each part of the repository and compare them with the rule sets themselves, so that a narrowed
// file pattern or a weaker rule set fails here instead of quietly linting less.

const repoRoot = import.meta.dirname;
const eslint = new ESLint({ cwd: repoRoot });
const require = createRequire(import.meta.url);

/** Flat configs, as far as these tests read them. */
const flatConfigsSchema = z.array(
  z.looseObject({ rules: z.record(z.string(), z.unknown()).optional() }),
);

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

// Neither package ships type declarations, so their configs are read with require and checked.
const NEXT_RULES = rulesTurnedOn(require("eslint-config-next/core-web-vitals"));
const REACT_HOOKS_RULES = NEXT_RULES.filter((rule) => rule.startsWith("react-hooks/"));

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
  it("knows the rule sets and the packages it is checked against", () => {
    expect(TYPESCRIPT_RULES.length).toBeGreaterThan(50);
    expect(A11Y_STRICT_RULES.length).toBeGreaterThan(20);
    expect(REACT_HOOKS_RULES).toContain("react-hooks/rules-of-hooks");
    expect(NEXT_RULES).toContain("@next/next/no-html-link-for-pages");
    expect(dependingOn("react")).toContain("apps/web");
    expect(dependingOn("next")).toContain("apps/web");
  });

  it.for([
    ...packages.map(({ dir }) => `${dir}/src/example.ts`),
    "example.test.ts",
    "infra/example.test.ts",
    "scripts/example.ts",
  ])("gives %s every rule of typescript-eslint's strict and stylistic sets", async (file) => {
    const rules = await rulesFor(file);

    expect(TYPESCRIPT_RULES.filter((rule) => !isOn(rules[rule]))).toEqual([]);
  });

  // When a React package is added, such as packages/ui (instructions 9 to 16), its files must be
  // added to `reactFiles` in eslint.config.mjs.
  it.for(dependingOn("react"))(
    "gives the components in %s the React Hooks and strict jsx-a11y rules",
    async (dir) => {
      const rules = await rulesFor(`${dir}/src/example.tsx`);

      expect(REACT_HOOKS_RULES.filter((rule) => !isOn(rules[rule]))).toEqual([]);
      for (const [rule, setting] of A11Y_STRICT_RULES) {
        if (rule === ALT_TEXT) {
          expect(isOn(rules[rule]), rule).toBe(true);
        } else {
          expect(resolvedForm(rules[rule]), rule).toEqual(resolvedForm(setting));
        }
      }
    },
  );

  it.for(dependingOn("next"))("gives %s every rule of Next.js's recommended set", async (dir) => {
    const rules = await rulesFor(`${dir}/src/app/example.tsx`);

    expect(NEXT_RULES.filter((rule) => !isOn(rules[rule]))).toEqual([]);
  });

  // The API logs through its logger, which adds request IDs and redacts secrets (instruction 8).
  it("forbids console output in the API's code", async () => {
    expect(isOn((await rulesFor("apps/api/src/routes/example.ts"))["no-console"])).toBe(true);
  });
});
