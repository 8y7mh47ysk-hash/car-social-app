import type { Configuration } from "lint-staged/config";

// The tasks the pre-commit hook (.husky/pre-commit) runs on the files staged for a commit. The
// hook sets aside unstaged changes and untracked files first, so every task sees exactly what is
// being committed, and runs the entries below one at a time, top to bottom: the fixers finish
// before the checks read the files. lint-staged appends the absolute paths of the matching staged
// files to each command (deleted files included, so that deleting a module still type-checks the
// code that imported it) and stages whatever the fixers change.

/** Files that ESLint lints. A pattern without a slash matches file names in any directory. */
const lintable = "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

/** ESLint and Prettier skip paths that do not exist (deleted files) instead of failing. */
const skipDeleted = "--no-error-on-unmatched-pattern";

/** Files named the way Vitest names test files, as test-suite.test.ts finds them. */
const testFiles = "*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

/** Env files, by the names that .gitignore ignores (the .env.example templates match too). */
const envFiles = "{.env,.env.*,*.env,.envrc}";

export default {
  // 1. Lint, fixing what ESLint can; any warning left fails the commit, as in `pnpm lint`.
  //    --no-warn-ignored skips files that the ESLint config ignores. Then format the result.
  [lintable]: [
    `eslint --max-warnings=0 --no-warn-ignored ${skipDeleted} --fix`,
    `prettier --write ${skipDeleted}`,
  ],

  // 2. Format every other file that Prettier understands. Prettier skips unknown file types and
  //    anything in .prettierignore or .gitignore, so docs/PLAYBOOK.md is never reformatted.
  [`!(${lintable})`]: `prettier --write --ignore-unknown ${skipDeleted}`,

  // 3. Type-check the whole repository, once, if a staged file can change types: TypeScript, JSON
  //    (package.json, tsconfig files, imported JSON) or the pnpm files that pin dependency
  //    versions. A function that ignores its file list runs its command once, without file
  //    arguments. docs/DECISIONS.md explains why this checks the whole repository.
  "{*.{ts,tsx,mts,cts,json},pnpm-lock.yaml,pnpm-workspace.yaml}": () => "pnpm typecheck",

  // 4. Run the unit tests that import a staged file, directly or through other modules, and any
  //    staged test file; finding no related tests is a pass. A staged file that matches
  //    `forceRerunTriggers` in vitest.config.ts runs every test instead.
  "*": "vitest related --run --passWithNoTests",

  // 5. A staged test file that no Vitest project includes would never run, here or in CI, and
  //    step 4 would pass with "No test files found". test-suite.test.ts fails when a test file in
  //    the repository is not run by `pnpm test`, so run it, once, when a test file is staged.
  [testFiles]: () => "vitest run --project tooling test-suite.test.ts",

  // 6. Env files hold settings and secrets, so git ignores them and only `git add --force` stages
  //    one. When one is staged, run env-files.test.ts, once: it fails if git tracks an env file
  //    other than a template, which stops the commit. lint-staged matches a pattern without a slash
  //    against file names in every folder, dot folders such as .devcontainer/ included, where
  //    Vitest's rerun triggers never look.
  [envFiles]: () => "vitest run --project tooling env-files.test.ts",

  // 7. build-log.test.ts pastes the build log's steps that set a developer's files aside or try to
  //    commit an env file into shells. No test imports the log, so step 4 never picks that test
  //    for it: run it, once, when the log is staged. The README's steps, which git-hooks.test.ts
  //    runs, still run only in CI (docs/DECISIONS.md, "README changes do not run every test").
  "docs/BUILD_LOG.md": () => "vitest run --project tooling build-log.test.ts",
} satisfies Configuration;
