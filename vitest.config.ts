import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The repository root as a glob prefix, with the characters that globs treat specially escaped.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[*?!+@()[\]{}|\\]/g, "\\$&");

// `pnpm test` runs every package's tests in one Vitest process. Each package keeps its own
// vitest.config.ts (environment, include patterns), so `pnpm --filter <package> test` also works.
// infra/ and scripts/ are not packages; their tests run only from here.
export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "infra/vitest.config.ts",
      "scripts/vitest.config.ts",
      // Tests for the repository's own tooling and rules (the git hooks, the .gitignore rules
      // for env files, the lint rules for process.env), next to the files they test.
      { test: { name: "tooling", include: ["*.test.ts"] } },
    ],
    // When a changed file matches one of these, `vitest related` (run by the pre-commit hook) and
    // watch mode run every test instead of only the tests that import it: these files can change
    // the result of any test, or tests read them or run them as commands, which Vitest cannot
    // trace. The globs are absolute because Vitest matches them against absolute paths, and "**"
    // never enters a hidden directory, so relative globs (and Vitest's defaults) match nothing in
    // a checkout inside one, such as a git worktree under ~/.claude/.
    forceRerunTriggers: [
      `${root}**/package.json`,
      `${root}pnpm-{lock,workspace}.yaml`,
      `${root}**/tsconfig*.json`,
      `${root}**/{vite,vitest}.config.*`,
      `${root}**/vitest.setup.*`,
      `${root}.husky/*`,
      `${root}{commitlint,lint-staged}.config.*`,
      // Read from disk or through git by infra/compose.test.ts (the compose file and the root
      // template), env-files.test.ts (the ignore rules and the templates),
      // scripts/ci-workflow.test.ts (the workflows) and env-access.test.ts (the ESLint config).
      `${root}docker-compose.yml`,
      `${root}**/.env.example`,
      `${root}**/.gitignore`,
      `${root}.github/workflows/*`,
      `${root}eslint.config.*`,
    ],
  },
});
