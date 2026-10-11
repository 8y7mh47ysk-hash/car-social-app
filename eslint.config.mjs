import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Files that get the Next.js, React, React Hooks and jsx-a11y rules. When another React
// package is added (e.g. packages/ui), add its files here.
const reactFiles = ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"];

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

  // Plain JavaScript config files are not part of any tsconfig, so skip type-aware rules.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Last: turn off every rule that would fight Prettier's formatting.
  prettier,
);
