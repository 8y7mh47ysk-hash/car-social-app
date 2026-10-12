import { defineConfig } from "vitest/config";

// `pnpm test` runs every package's tests in one Vitest process. Each package keeps its own
// vitest.config.ts (environment, include patterns), so `pnpm --filter <package> test` also works.
// scripts/ is not a package; its tests run only from here.
export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "scripts/vitest.config.ts",
    ],
  },
});
