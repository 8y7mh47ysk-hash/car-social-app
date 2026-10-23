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
      // Tests at the repository root, for tooling and rules that span the repository, such as
      // the git hooks (git-hooks.test.ts) and the type check (typecheck.test.ts).
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
      // Vite reads it to compile the web app's stylesheet in apps/web/src/app/globals.test.ts.
      `${root}**/postcss.config.*`,
      // The API's entrypoint: apps/api/src/server.test.ts starts it as a separate process.
      `${root}apps/api/src/server.ts`,
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
      // Env files are not triggers: no test reads them. A staged one runs env-files.test.ts through
      // its own task in lint-staged.config.ts, which also finds env files in dot folders.
    ],
  },
});
