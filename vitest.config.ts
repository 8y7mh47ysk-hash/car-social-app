import { defineConfig } from "vitest/config";

// `pnpm test` runs every package's tests in one Vitest process. Each package keeps its own
// vitest.config.ts (environment, include patterns), so `pnpm --filter <package> test` also works.
export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      // Tests for repository-wide rules (such as the .gitignore env rules), next to the files
      // they test.
      { test: { name: "tooling", include: ["*.test.ts"] } },
    ],
  },
});
