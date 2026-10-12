import { defineConfig } from "vitest/config";

// Tests for the deployment files (docker-compose.yml, .env.example). infra/ is not a workspace
// package, so these run only as a project of the root vitest.config.ts: `pnpm test`, or
// `pnpm exec vitest run --project infra` for these tests alone.
export default defineConfig({
  test: {
    name: "infra",
    include: ["**/*.test.ts"],
  },
});
