import { defineConfig } from "vitest/config";

// Tests for the developer and CI scripts in scripts/ and for the CI workflow that runs them.
// scripts/ is not a workspace package, so these run only as a project of the root
// vitest.config.ts: `pnpm test`, or `pnpm exec vitest run --project scripts` for these alone.
export default defineConfig({
  test: {
    name: "scripts",
    include: ["**/*.test.ts"],
  },
});
