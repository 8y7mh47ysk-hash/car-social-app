# Decisions

A running log of key technical choices and their trade-offs, following the Master Context rule
"explain trade-offs briefly". Changes of plan against `docs/PLAYBOOK.md` are recorded here
instead of editing the playbook.

Rules:

- Append new entries at the end. Entries have no numeric IDs, because engineers add entries on
  parallel branches and numbers would collide.
- Never silently reverse an earlier decision: add a new entry that names the one it replaces and
  explains why.
- Instruction 6 formalises this log. Until then, entries use the template below.

Entry template:

```markdown
### <title>

- Date: 2026-10-11 · Instruction: #N · Author: <name>
- Context: ...
- Decision: ...
- Trade-offs: ...
```

## Entries

### Pin TypeScript to ~6.0.3, not 7.x

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha (team version policy)
- Context: TypeScript 7 is the native Go port. typescript-eslint 8.x, which provides our
  type-aware lint rules, supports only `typescript >=4.8.4 <6.1.0`.
- Decision: `typescript: ~6.0.3` in the pnpm catalog, used by every package.
- Trade-offs: we give up TypeScript 7's much faster type checking until typescript-eslint
  supports it. TypeScript 6 also changed defaults (`strict` on, `types: []`, `rootDir` = the
  tsconfig folder, `noUncheckedSideEffectImports` on) and deprecated `baseUrl` and
  `moduleResolution: node`; our configs set what they need explicitly.

### Pin ESLint to ^9.39, not 10

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha (team version policy)
- Context: eslint-plugin-react 7.37 and eslint-plugin-jsx-a11y 6.10, both pulled in by
  eslint-config-next, declare peer support for ESLint 9 or older.
- Decision: `eslint` and `@eslint/js` at `^9.39`. pnpm prints a deprecation notice for ESLint 9;
  that is expected.
- Trade-offs: ESLint 10 features wait until those plugins support it.

### Pin Vitest to ^4.1, not 5.0

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha (team version policy)
- Context: Vitest 5.0 is only weeks old. Vitest 4.1 supports Vite 6, 7 and 8 and Storybook's
  Vitest addon (instruction 22).
- Decision: `vitest: ^4.1.11` in the pnpm catalog.
- Trade-offs: Vitest 5 features wait for a deliberate upgrade.

### Latest stable versions, held back one day by pnpm

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: everything else uses the latest stable release. pnpm 12's `minimumReleaseAge` (default
  one day) refuses versions published less than a day ago, which protects against compromised
  releases that are caught and pulled quickly. zod 4.6.6 was published hours before the first
  install, and instead of failing, pnpm silently added a `minimumReleaseAgeExclude` entry for it
  to `pnpm-workspace.yaml`.
- Decision: keep the default. Write version ranges whose lower bound is already a day old (zod
  is `^4.6.5`, which resolved to 4.6.5) and never commit an automatically added
  `minimumReleaseAgeExclude` entry without recording why here.
- Trade-offs: we can be up to a day behind the newest patch release.

### pnpm workspace settings: catalogs and an explicit install-script list

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: pnpm 12 reads its settings from `pnpm-workspace.yaml` (`.npmrc` is only for registry
  and auth), fails on unknown keys, and fails installs when a dependency has an install script
  that is not listed under `allowBuilds`.
- Decision: a `catalog` holds versions that several packages share (TypeScript, Vitest,
  `@types/node`, zod, Next.js) or that must move together (`next` and `eslint-config-next`),
  referenced as `"catalog:"`. `allowBuilds` lists every dependency with an install script:
  `unrs-resolver: false`, because its script only downloads a native binding that pnpm already
  installs as an optional dependency.
- Trade-offs: each new dependency with an install script needs a deliberate allow or deny entry
  with a comment.

### Workspace packages are consumed as TypeScript source; the production API runs compiled code

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: dev, tests, builds and the production start (`node` on built output) must all work.
  Turbopack, the default bundler in Next.js 16, has no setting for custom package.json export
  conditions, so Next.js always resolves the default export.
- Decision: `@apex/shared` exports `"default": "./src/index.ts"`, which Next.js
  (`transpilePackages`), Vitest, Node.js in dev, TypeScript and ESLint all consume directly, with
  no build step. It also exports an `"@apex/dist"` condition pointing at `dist/`, which `tsc`
  builds. `pnpm --filter @apex/api start` runs `node --conditions=@apex/dist dist/server.js`, so
  production loads only compiled JavaScript. `pnpm build` builds packages/shared first because
  pnpm runs recursive scripts in dependency order.
- Trade-offs: the production API needs packages/shared built and the `--conditions` flag (future
  Dockerfiles must pass it). Without the flag, `node dist/server.js` fails at startup with
  `ERR_MODULE_NOT_FOUND`. We avoided adding a bundler (tsup or tsdown) to inline packages/shared
  into the API, and stack traces point at real files. TypeScript falls back to the source when
  `dist/` is missing, so the API's own `tsc` build never depends on build order; only the
  runtime does.

### Node packages import relative files with a .ts extension

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: `next build` failed with "Module not found: Can't resolve './app-name.js'": Turbopack
  does not map a `./x.js` import to `x.ts` inside a workspace package.
- Decision: apps/api and packages/shared write relative imports with the real file name
  (`./app.ts`). `rewriteRelativeImportExtensions` makes `tsc` emit `./app.js` in `dist/`. The
  Next.js app keeps Next's usual extensionless imports.
- Trade-offs: two import styles in one repository, split by runtime. The `.ts` form is also what
  Node.js's own TypeScript support requires, which made the next decision possible.

### Run the API's TypeScript directly with Node.js 24 in development

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: Node.js 24.21 strips TypeScript types natively, without an experimental warning
  (`process.features.typescript` is `"strip"`). Our code already uses only erasable syntax
  (`erasableSyntaxOnly`) and `.ts` import extensions.
- Decision: the API's `dev` script is `node --watch --watch-preserve-output src/server.ts`,
  and the entrypoint test spawns `node src/server.ts`. No tsx. Verified: the watcher restarts
  when a file in packages/shared changes, and Ctrl+C shuts the server down cleanly.
- Trade-offs: no extra dependency (tsx brought esbuild and its install script). Node ignores
  `tsconfig.json`, so path aliases, enums, namespaces and parameter properties cannot be used in
  Node packages; TypeScript already rejects the last three through `erasableSyntaxOnly`. Type
  errors are caught by `pnpm typecheck`, not at run time (the same as with tsx). Node refuses to
  strip types inside `node_modules`, one more reason production uses compiled output.

### Strict TypeScript base configuration

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: the Master Context requires strict TypeScript.
- Decision: `tsconfig.base.json` enables `strict` plus the extra checks from
  `@tsconfig/strictest`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters` and no unreachable
  code or unused labels. It also sets `verbatimModuleSyntax`, `isolatedModules` and
  `erasableSyntaxOnly` so any single-file transpiler (SWC, Oxc, Node.js) can compile each file.
  Each package then picks its module system and globals: `nodenext` with Node types (apps/api),
  `nodenext` with no ambient types (packages/shared, which must run in browsers and Node),
  `bundler` with DOM types (apps/web).
- Trade-offs: more explicit code (indexed access returns `T | undefined`, optional properties
  cannot be assigned `undefined`). `skipLibCheck` stays on, trusting dependencies' `.d.ts` files.

### One root ESLint flat config with type-aware rules

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: one config must cover every package, including Next.js and React rules for the web
  app, with zero warnings allowed.
- Decision: `eslint.config.mjs` (plain JavaScript, so ESLint needs no jiti dependency to load a
  TypeScript config) combines `@eslint/js` recommended, typescript-eslint `strictTypeChecked` and
  `stylisticTypeChecked` with the project service, eslint-config-next `core-web-vitals` (Next.js,
  React, React Hooks including the React Compiler rules) scoped to apps/web, jsx-a11y's `strict`
  rule set, and eslint-config-prettier last. Plain JavaScript config files skip type-aware rules.
  `pnpm lint` runs `eslint . --max-warnings 0`.
- Trade-offs: type-aware linting is slower than syntax-only linting. eslint-config-next turns on
  only six jsx-a11y rules, as warnings, and registers the plugin through a CommonJS wrapper, so
  adding jsx-a11y's own flat config throws "Cannot redefine plugin"; we add its rules on top
  instead. eslint-config-next also loads Next's bundled Babel parser at startup without declaring
  `next` as a dependency, so the root lists `next` as a dev dependency; without it ESLint crashes
  with "Cannot find module 'next/dist/compiled/babel/eslint-parser'" whenever the web app's copy
  is not reachable. A new React package (for example packages/ui) must be added to `reactFiles`
  in the config.

### Prettier with 100-character lines

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: formatting should be automatic and not debated in review.
- Decision: Prettier 3 defaults with `printWidth: 100`. Prettier also skips everything in
  `.gitignore`; `.prettierignore` adds `docs/PLAYBOOK.md` (the owner's document is never
  reformatted) and `pnpm-lock.yaml`.
- Trade-offs: none significant.

### Vitest projects with one config per package

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: tests must run for the whole repository and for one package at a time.
- Decision: the root `vitest.config.ts` lists each package's `vitest.config.ts` as a project, so
  `pnpm test` runs everything in one process and `pnpm --filter <package> test` runs one package.
  The web project uses jsdom, Testing Library and jest-dom matchers. No `@vitejs/plugin-react`:
  Vite's built-in transform compiles TSX using the tsconfig setting `"jsx": "react-jsx"`.
- Trade-offs: jsdom is slower than happy-dom but closer to a real browser. Storybook
  (instruction 22) may still need the React plugin.

### Next.js app configuration

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: builds must behave the same in the main checkout, in git worktrees and in fresh
  clones, and the repository must stay free of generated files.
- Decision: App Router in `src/app`. `next.config.ts` sets `turbopack.root` and
  `outputFileTracingRoot` to the monorepo root explicitly instead of letting Next.js guess from
  lockfiles; lists `@apex/shared` in `transpilePackages`; turns off the `X-Powered-By` header; and
  sets `agentRules: false`, because since 16.4 `next dev` writes an `AGENTS.md` into the app when
  it detects an AI coding agent. (The version-matched Next.js docs that file points to are in
  `node_modules/next/dist/docs/`.) `next-env.d.ts` is generated, so it is gitignored and
  `pnpm typecheck` runs `next typegen` before `tsc`. No `next/font/google`: fonts are self-hosted
  from instruction 10.
- Trade-offs: `typecheck` for the web app takes about a second longer for type generation.

### API structure: app factory, plugin routes and a small entrypoint

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: tests need the app without a network port, and instructions 4 and 8 extend the API's
  configuration and logging in parallel.
- Decision: `src/app.ts` exports `buildApp(options)`, an async factory that registers plugins and
  returns the Fastify instance without listening; tests use `app.inject()`. Routes are Fastify
  plugins in `src/routes/`. `src/server.ts` reads the listen address, builds the app, installs
  SIGINT and SIGTERM handlers, then listens. On a signal it closes the app (Fastify answers new
  requests with 503 while closing) and Node exits with code 0 once nothing is left running. If
  closing takes more than 10 seconds it exits with code 1, and a second Ctrl+C exits immediately.
  A failed `listen` (for example, port in use) logs a fatal error and exits with code 1.
  `src/config.ts` validates only `API_HOST` and `API_PORT` with Zod; instruction 4 replaces it
  with the full environment loader.
- Trade-offs: the shutdown logic is about 20 lines of our own code instead of a dependency such
  as close-with-grace. `server.ts` uses top-level `await`, which is fine for an ES module
  entrypoint.

### Separate host and port variables for each app, loopback by default

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: `pnpm dev` runs both apps from one shell, so a shared `PORT` variable would collide,
  and parallel checkouts need their own ports. Dev servers should not be reachable from the
  network by default.
- Decision: `WEB_HOST`/`WEB_PORT` (passed to the Next.js CLI by the web app's scripts) and
  `API_HOST`/`API_PORT` (read by the API), defaulting to `127.0.0.1:3000` and `127.0.0.1:4000`.
- Trade-offs: Next.js's own `PORT` variable is not used. Containers must set these names and
  bind to `0.0.0.0` explicitly. Instruction 4 may fold them into the typed environment loader.

### Union merges for the shared docs logs

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: several engineers append to BUILD_LOG, DECISIONS, DEPENDENCIES and REVIEW_LOG on
  parallel branches, which would otherwise conflict on every merge.
- Decision: `.gitattributes` sets `merge=union` for those four files.
- Trade-offs: union merges keep both sides' lines without conflict markers, so two branches
  editing the same lines (not just appending) can produce duplicated or interleaved text. Whoever
  merges must read the merged files.

### Package scripts assume a POSIX shell

- Date: 2026-10-11 · Instruction: #1 · Author: Alpha
- Context: build scripts clear `dist/` with `rm -rf`, and the web scripts use `${WEB_PORT:-3000}`
  defaults.
- Decision: support macOS, Linux and WSL.
- Trade-offs: native Windows shells are not supported. The deployment target is a Linux home
  server, so this costs nothing today.

### Git hooks with husky, lint-staged and commitlint

- Date: 2026-10-11 · Instruction: #2 · Author: Alpha
- Context: instruction 2 asks for pre-commit hooks that lint, type-check and unit-test the staged
  files, and a Conventional Commits check. The hooks must work for every engineer, in git
  worktrees and when commits are made from scripts.
- Decision: husky 9 installs the hooks from the root `prepare` script, which `pnpm install` runs.
  `.husky/pre-commit` runs lint-staged and `.husky/commit-msg` runs commitlint, both called
  straight from `node_modules/.bin` (husky puts it on `PATH`) to avoid the start-up time of
  `pnpm exec` or `npx`. Verified: `pnpm install --prod` does not run `prepare`, and husky prints
  ".git can't be found" and exits 0 when there is no `.git`, so production installs and Docker
  builds are unaffected.
- Trade-offs: husky writes `core.hooksPath = .husky/_` to the repository's git config, which all
  worktrees share; a worktree only runs the hooks once `pnpm install` has created its own
  `.husky/_`, and commits made there before that are not checked. Hooks can always be skipped
  (`--no-verify`, `HUSKY=0`), so CI remains the gate that cannot be bypassed.

### The pre-commit hook checks exactly the staged snapshot, one task at a time

- Date: 2026-10-11 · Instruction: #2 · Author: Alpha
- Context: by default lint-staged hides only the unstaged parts of partially staged files, so the
  type check and the tests would also see untracked files and unstaged edits and could pass for
  code that is not in the commit (for example a new module that was never `git add`ed). It also
  ignores deleted files, so a commit that only deletes a module that is still imported would skip
  every check, and it stops the remaining tasks after the first failure.
- Decision: `lint-staged --hide-all --diff-filter=ACMRD --concurrent false --continue-on-error`.
  `--hide-all` stashes unstaged changes and untracked files while the tasks run and restores them
  afterwards (also on failure and on Ctrl+C, both verified). Tasks run one at a time in the
  config's order, so ESLint `--fix` and Prettier finish before the type check and the tests read
  the files. ESLint and Prettier get `--no-error-on-unmatched-pattern`, so deleted paths are
  skipped instead of failing.
- Trade-offs: every commit stashes and restores untracked files: large untracked files make
  commits slower and should be gitignored, and editors or dev servers see them vanish for a few
  seconds. Running tasks one at a time costs about a second per commit compared with running them
  in parallel. A failing commit takes as long as a passing one, because every task still runs.

### Whole-repository type check in the pre-commit hook

- Date: 2026-10-11 · Instruction: #2 · Author: Alpha
- Context: the hook could type-check the whole repository or only the workspaces that a commit
  touches (plus the packages that depend on them).
- Decision: run `pnpm typecheck`, the same command as CI, once per commit when a staged file
  (deleted files included) is TypeScript, JSON, `pnpm-lock.yaml` or `pnpm-workspace.yaml`.
- Trade-offs: measured on the Apple M5 with warm caches: the whole repository takes 1.3 s, while
  single packages take 0.31 s (shared), 0.48 s (api), 0.69 s (web, including `next typegen`) and
  0.31 s (the root files), and pnpm already checks packages in parallel. Checking only affected
  workspaces would save at most about half a second, but it needs the dependents of every changed
  package and special cases for root files such as `tsconfig.base.json` and the lockfile, and a
  mistake there lets type errors through. If `pnpm typecheck` grows beyond about 10 s, switch to
  a filter such as `pnpm --filter "...[HEAD]" typecheck` (changed packages and their dependents)
  plus the root check.

### Related unit tests in the pre-commit hook, with absolute rerun triggers

- Date: 2026-10-11 · Instruction: #2 · Author: Alpha
- Context: `vitest related` runs only the tests whose import graph contains a staged file. Files
  that change test results without being imported (dependencies, tsconfig files, Vitest configs
  and setup files, and the hook files that git-hooks.test.ts runs as commands) need Vitest's
  `forceRerunTriggers`, which run every test. Surprise: Vitest matches these globs against
  absolute paths, and `**` never enters a directory whose name starts with a dot, so its default
  triggers (`**/package.json/**`) match nothing when the checkout sits inside a hidden directory,
  such as the git worktrees under `~/.claude/`. The default `**/{vitest,vite}.config.*/**` does
  not match the config file itself even in an ordinary path.
- Decision: the hook runs `vitest related --run --passWithNoTests` on every staged file, and the
  root `vitest.config.ts` lists absolute triggers built from the repository root (with glob
  characters in the path escaped): package.json files, the pnpm lockfile and workspace file,
  tsconfig files, Vite and Vitest configs and setup files, `.husky/*`, and the commitlint and
  lint-staged configs. Tests for repository tooling live at the root in a `tooling` project.
- Trade-offs: staging a trigger file runs every test (about 11 s today). Vitest follows imports
  only, so a test that runs code in a child process is not selected when that code changes:
  `apps/api/src/server.test.ts` starts `src/server.ts` with `node`, so editing `server.ts` runs
  no tests in the hook. CI runs every test.

### Commit message rules

- Date: 2026-10-11 · Instruction: #2 · Author: Alpha
- Context: the team rule is "type(scope): subject" with a lowercase subject of at most 72
  characters, body lines of at most 100 characters, and a `Co-Authored-By:` trailer after a blank
  line. `@commitlint/config-conventional` rejects only subjects in sentence, start, Pascal or
  upper case, so "add the Next.js app" passes it, and it only warns about missing blank lines.
- Decision: commitlint with config-conventional plus `subject-case` and `scope-case` set to
  lower-case (commitlint ignores text in backticks or quotes, so names can keep their case:
  `` fix(api): validate `API_PORT` ``), `subject-max-length` 72, and `body-leading-blank` and
  `footer-leading-blank` raised from warnings to errors: git treats the whole first paragraph as
  the subject and reads trailers such as `Co-Authored-By` only from a paragraph of their own. The
  config is plain `commitlint.config.mjs`: commitlint's types live in `@commitlint/types`, which
  is not a direct dependency, and every rule is covered by git-hooks.test.ts instead.
- Trade-offs: stricter than most projects, as names must be lowercased or quoted. The commit
  parser treats any line that starts with one word, a colon and a space as the start of the
  footer, so a body line such as "Note: ..." straight after other body text is rejected by
  `footer-leading-blank`; add a blank line or reword it. Messages that start like git's own
  (`Merge ...`, `Revert ...`, `fixup!`, `squash!`, `amend!`) are accepted without any checks,
  including hand-written ones.
