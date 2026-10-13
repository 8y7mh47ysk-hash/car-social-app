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
  // needs to import it or reach it through globalThis; banning those closes the routes to `env`
  // that the property rule cannot see, such as `import { env } from "node:process"`.
  // env-access.test.ts checks these rules.
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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:process", message: `Use the global process. ${envModuleRule}` },
            { name: "process", message: `Use the global process. ${envModuleRule}` },
          ],
        },
      ],
    },
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
