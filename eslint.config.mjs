import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Files that get the Next.js, React, React Hooks and jsx-a11y rules. When another React
// package is added (e.g. packages/ui), add its files here.
const reactFiles = ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"];

const envModuleRule =
  "Read environment variables through the app's env module (docs/DECISIONS.md).";

/**
 * Rules that ban importing every module whose import source matches one of the bans' regular
 * expressions: no-restricted-imports for `import` and `export ... from`, and no-restricted-syntax
 * for import(), which no-restricted-imports does not check (a string or template literal source;
 * a computed one is not caught). A later config block that sets either rule replaces it for its
 * files, so such a block lists every ban that applies to them.
 */
function banImports(...bans) {
  return {
    "no-restricted-imports": [
      "error",
      { patterns: bans.map(({ regex, message }) => ({ regex, message })) },
    ],
    "no-restricted-syntax": [
      "error",
      ...bans.flatMap(({ regex, message }) => [
        { selector: `ImportExpression[source.value=/${regex}/i]`, message },
        { selector: `ImportExpression[source.quasis.0.value.cooked=/${regex}/i]`, message },
      ]),
    ],
  };
}

/** `process` and `node:process`: `process` is a global, so code never needs to import it. */
const processImports = {
  regex: "^(?:node:)?process$",
  message: `Use the global process. ${envModuleRule}`,
};

/** The web app's server env schema, and validate.ts, which imports it. */
const webServerEnvImports = {
  regex: "(?:^|\\/)env\\/(?:server-schema|validate)(?:\\.[cm]?[jt]sx?)?$",
  message:
    "The server env schema must never reach the browser. Server code reads server variables " +
    "with getServerEnv() from src/env/server.ts (docs/DECISIONS.md).",
};

export default defineConfig(
  globalIgnores([
    "**/.next/",
    "**/dist/",
    "**/out/",
    "**/storybook-static/",
    "**/coverage/",
    "**/playwright-report/",
    "**/test-results/",
    "**/next-env.d.ts",
    "graphify-out/",
  ]),

  // Next.js's recommended rules (core web vitals) plus React and React Hooks. Listed first so
  // the TypeScript parser configured below applies to every file.
  {
    files: reactFiles,
    extends: [nextCoreWebVitals],
    settings: { next: { rootDir: "apps/web/" } },
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // eslint-config-next enables only six jsx-a11y rules, as warnings. Use the plugin's strict
  // set instead (the plugin itself is registered by eslint-config-next above).
  {
    files: reactFiles,
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // Keep Next.js's setting that also checks the next/image <Image> component.
      "jsx-a11y/alt-text": ["error", { elements: ["img"], img: ["Image"] }],
    },
  },

  // Application code reads environment variables only through its app's env module, which
  // validates them with Zod: apps/api/src/server.ts and apps/web/src/env/ (instruction 4). Shared
  // code never reads them, because it also runs in browsers. `process` is a global, so code never
  // needs to import it (with import() either) or reach it through globalThis; banning those closes
  // the routes to `env` that the property rule cannot see, such as `import { env } from
  // "node:process"`. Code that passes `process` around as a value (`const proc = process`,
  // `Reflect.get(process, "env")`, `process[name]`) still gets through: these rules catch
  // mistakes, not intent. env-access.test.ts checks them.
  {
    files: ["apps/*/src/**", "packages/*/src/**"],
    ignores: ["apps/api/src/server.ts", "apps/web/src/env/public.ts", "apps/web/src/env/server.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: envModuleRule },
        { object: "globalThis", property: "process", message: envModuleRule },
        { object: "global", property: "process", message: envModuleRule },
      ],
      ...banImports(processImports),
    },
  },

  // Browser code must never load the web app's server env schema, which would send the server
  // variables' names, rules and defaults to every visitor. So no module imports it, or validate.ts,
  // through an env folder (`../env/server-schema`): server code reads server variables with
  // getServerEnv() from src/env/server.ts, which "server-only" keeps out of browser code, and
  // next.config.ts, outside src, runs validate.ts's check. The env modules' own imports
  // (`./server-schema`) pass; public.test.ts checks that the ones browser code loads never load
  // the schema. A server-only module that has to run the check (an instrumentation.ts, if
  // instruction 102 needs one) goes in `ignores`. These rules replace the block above's for these
  // files, so they repeat its ban on importing process. env-access.test.ts checks them.
  {
    files: ["apps/web/src/**"],
    rules: banImports(processImports, webServerEnvImports),
  },

  // Plain JavaScript config files are not part of any tsconfig, so skip type-aware rules.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // The API logs only through its pino logger, which adds request IDs and redacts secrets
  // (instruction 8); console output would skip both. The entrypoint is exempt because it may have
  // to print before the logger exists, for example when the environment is invalid.
  {
    files: ["apps/api/src/**"],
    ignores: ["apps/api/src/server.ts"],
    rules: { "no-console": "error" },
  },

  // Last: turn off every rule that would fight Prettier's formatting.
  prettier,
);
