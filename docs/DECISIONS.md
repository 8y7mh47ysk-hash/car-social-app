# Decisions

A running log of the project's key technical choices and their trade-offs, following the Master
Context rule "explain trade-offs briefly". Changes of plan against `docs/PLAYBOOK.md` are
recorded here instead of editing the playbook. The log started with instruction 1; instruction 6
set the format and rules below.

## What goes here

Write an entry when you choose between real alternatives, when a choice affects other code or
other engineers, or when someone would otherwise ask "why is it like this?". That includes:

- choices of design, tools, versions and settings, and what was rejected;
- changes of plan against the playbook or against a contract agreed between engineers;
- surprises, such as a tool behaving differently from its documentation, that shaped a decision.

Other records live elsewhere: what changed for each instruction and how to verify it in
[BUILD_LOG.md](BUILD_LOG.md), why each dependency is here in [DEPENDENCIES.md](DEPENDENCIES.md),
how the system fits together in [ARCHITECTURE.md](ARCHITECTURE.md), and issues found in review in
[REVIEW_LOG.md](REVIEW_LOG.md).

## How to write an entry

Every entry has exactly this form:

```markdown
### <title>

- Date: 2026-10-11 · Instruction: #N · Author: <name>
- Context: ...
- Decision: ...
- Trade-offs: ...
```

- **Title:** what was decided, specific enough to be unique ("Pin ESLint to ^9.39, not 10").
  Other documents refer to an entry by its title.
- **Date:** the day of the decision (YYYY-MM-DD). **Instruction:** the playbook instruction it
  belongs to (`#N`, or several, such as `#5, #7`); a decision made in review belongs to the
  instruction whose work it changes. **Author:** who made it.
- **Context:** the problem and its constraints, in a few sentences.
- **Decision:** what was chosen, concretely: names, files, settings.
- **Trade-offs:** what it costs, what was rejected and why, and when to revisit it.

Keep entries brief. Details belong in code comments and the build log.

## Rules

- Append new entries at the end. Entries have no numeric IDs, because engineers add entries on
  parallel branches and numbers would collide. `.gitattributes` merges this file with
  `merge=union`, so whoever merges checks the result for duplicated or interleaved lines.
- Entries are a record. Once merged, an entry's decision is never edited; correcting a fact, a
  typo or a link in it is fine.
- Never silently reverse an earlier decision. Add a new entry whose Context names the title of the
  entry it replaces and explains why, and add one line to the end of the replaced entry:
  `- Superseded by: <title of the new entry>`. That line is the only addition an old entry gets.
- To find the decisions for an instruction, search for its number, for example `#8`.

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
  Dockerfiles must pass it). Without packages/shared built, the start fails with
  `ERR_MODULE_NOT_FOUND`. Without the flag, Node.js falls back to the TypeScript source, strips
  its types and starts anyway, so a forgotten flag goes unnoticed (corrected in the wave w0
  review, which also made the start refuse that: see "The production API start refuses
  TypeScript source"). We avoided adding a bundler (tsup or tsdown) to inline packages/shared
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
  closing takes more than 10 seconds it exits with code 1, and a second Ctrl+C exits immediately
  (since the wave w0 review, only one that comes more than a second after the first: see "A stop
  signal repeated within a second counts as one").
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
  lint-staged keeps its backup in the git stash, which all worktrees share: during a commit the
  top stash entry may be another worktree's backup, and two worktrees committing at the same
  moment occasionally leave a stray backup entry (3 in 30 simultaneous commits in testing, with
  no failures or lost files). The only way to avoid the stash, `--no-stash`, would also give up
  hiding unstaged changes and untracked files and the revert on failure, so we document it
  instead (README, "Git hooks").

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
- Trade-offs: staging a trigger file runs every test (about 13 s today). Vitest follows imports
  only, so a test that runs code in a child process is not selected when that code changes:
  `apps/api/src/server.test.ts` starts `src/server.ts` with `node`, so editing `server.ts` runs
  no tests in the hook (until the wave w0 review: see "The API entrypoint makes the pre-commit
  hook run every test"). CI runs every test.

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

### PostgreSQL 18 with pgvector, from the pgvector/pgvector image

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: instruction 3 needs a PostgreSQL container and instruction 77 needs the pgvector
  extension. PostgreSQL 18.6 is the newest stable release (19 is still a beta, and pgvector
  publishes no image for it), and pgvector 0.8.7 is the newest pgvector release. pgvector's
  author publishes `pgvector/pgvector` images, built on the official `postgres` image.
- Decision: `pgvector/pgvector:0.8.7-pg18-trixie` (Debian 13; bookworm is the older Debian 12),
  pinned to its multi-platform digest (amd64 and arm64). The named volume is mounted at
  `/var/lib/postgresql`: PostgreSQL 18+ images keep data in `/var/lib/postgresql/18/docker` and
  refuse to start with a volume at the old `/var/lib/postgresql/data` (checked in the image's
  entrypoint). `shm_size: 256mb`, the value the image's documentation suggests: Docker's 64 MB
  `/dev/shm` breaks large parallel queries, and pgvector's README asks for at least
  `maintenance_work_mem` for parallel HNSW index builds. The extension is installed but not
  enabled; migrations enable it (instructions 26 and 77).
- Trade-offs: the image is not a Docker official image, but it is the official `postgres` image
  plus one extension, maintained by that extension's author. Building our own image (official
  `postgres` plus the PGDG `postgresql-18-pgvector` package) needs a Dockerfile that cannot be
  built or tested here without Docker. Moving to PostgreSQL 19 later needs `pg_upgrade` or a dump
  and restore. The cluster's default collation (the image's `en_US.utf8`, from glibc) is fixed
  when the volume is first initialised, so instruction 25 or 26 should settle collation before
  real data exists.

### Redis 8 under its AGPLv3 option, with Valkey as the fallback

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: the Master Context names Redis. Redis 7.2 and earlier are BSD-3-Clause; 7.4 moved to
  a choice of RSALv2 or SSPLv1, neither of them open source; Redis 8 added AGPLv3 as a third
  choice (`LICENSE.txt` in the 8.10.2 source). Valkey, the Linux Foundation's fork of Redis
  7.2.4, stays BSD-3-Clause (9.1.2 is current, with an official `valkey/valkey` image).
- Decision: Redis 8.10.2, the newest release, on Alpine 3.23, pinned to its digest, used under
  the AGPLv3 option as an unmodified program in its own container. AGPLv3's extra duty (offering
  the source to users who interact with it over a network) applies to modified versions of Redis
  itself; our code only talks to Redis over its protocol. RSALv2 and SSPLv1 restrict offering
  Redis itself as a service to others, which we do not. This is not legal advice: the owner
  should confirm the choice (owner action in the build log).
- Trade-offs: Valkey would remove the licence question and speaks the same protocol for what is
  planned: queues (BullMQ, instruction 37, documents a Valkey client adapter), rate limits,
  sessions, caching (instruction 35) and sorted-set leaderboards (instruction 147). If the code
  sticks to core commands and avoids Redis-only modules (the Query Engine, JSON, time series),
  switching stays a one-line image change plus a test run. Redis's default `maxmemory-policy` of
  `noeviction` is kept on purpose: BullMQ's production guide says it is the only setting that
  keeps queues correct, so a cache that needs eviction should get its own Redis instance.

### Compose secure defaults: required passwords, loopback ports, pinned images

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: the compose file must be safe to run as it is, on a laptop and later on the home
  server, and must never contain a secret.
- Decision: both passwords use Compose's required form, `${POSTGRES_PASSWORD:?...}`, with no
  default; the root `.env.example` leaves them blank. Every port is published on `127.0.0.1`
  only. Redis gets `--requirepass`, because the official image compiles Redis's protected mode
  off; `redis-cli` reads the password from `REDISCLI_AUTH`, so neither the health check nor
  `docker compose exec redis redis-cli` passes it as an argument. Every image is pinned to a tag
  plus the digest of its multi-platform index. PostgreSQL and Redis use Docker's `local` log
  driver, which keeps at most 100 MB per container, because the default `json-file` driver never
  rotates.
- Trade-offs: every `docker compose` command (`config`, `ps` and `down` too) fails without the
  two passwords, so CI must pass throwaway values to `docker compose config`. The passwords are
  visible to anyone who can run `docker inspect`, which on Linux already means root-equivalent
  access; Docker secrets come with instruction 104. Digest pins stop silent changes but also stop
  base-image security fixes until someone bumps them; instruction 106 adds automated updates.
  The API will connect as the PostgreSQL superuser until the migrations (instruction 26) add a
  least-privilege role. Other containers on the Compose network can still reach both services;
  instruction 103 moves them to an internal network.

### Health checks that mean "ready": pg_isready over TCP and redis-cli -e

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: `depends_on: condition: service_healthy` is only as good as the check. On first start
  the postgres image initialises the database with a temporary server that listens only on a
  Unix socket, then restarts it; and `redis-cli ping` exits 0 even when Redis answers with an
  error.
- Decision: `pg_isready --host=127.0.0.1` with the configured user and database (with wrong
  names, PostgreSQL logs a failed connection attempt on every check). For Redis,
  `redis-cli -e ping`, authenticated through `REDISCLI_AUTH`. Checked against Redis 8.10.2 built
  from source: it exits 0 only on `PONG`, and 1 with a wrong or missing password, while the data
  loads (`LOADING`) and when the server is down; without `-e`, a wrong password still exits 0.
  Timings: every 10 s, 5 s timeout, 5 retries, start period 30 s (PostgreSQL) or 10 s (Redis),
  checking every second during it (`start_interval`).
- Trade-offs: `start_interval` needs Compose 2.20.2 and Docker Engine 25 or later, which any
  current Docker Desktop or OrbStack meets. `pg_isready` only shows that the server accepts
  connections, not that migrations have run; readiness of the app itself is instruction 33.

### App placeholders: Alpine stubs in the "app" profile, no Dockerfiles yet

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: the playbook asks for placeholders for the API and web apps. Without Docker on this
  machine a Dockerfile cannot be built or tested, and a Dockerfile that has never been built would
  not be honest. Hardened app containers are instruction 102.
- Decision: `api` and `web` are in the `app` profile, so a plain `docker compose up` starts only
  PostgreSQL and Redis. Each runs the pinned `alpine:3.24.2` image to print "Placeholder: ...
  Run it on the host: pnpm dev" to stderr and exit 1, with `restart: "no"`. `api` waits for
  healthy PostgreSQL and Redis; `web` waits for `api` to start (it has no health check to wait
  for). Alpine rather than BusyBox: the newest BusyBox release that upstream calls stable (1.36.1,
  Docker Hub's `stable` tag) was built in 2023, while Alpine 3.24.2 is from September 2026.
- Trade-offs: `docker compose --profile app up` deliberately ends with both placeholders exited
  with status 1 until real images replace them. The placeholders document the dependency graph
  but do not run the apps; run them on the host with `pnpm dev`.

### Static compose tests as a root Vitest project, using the yaml package

- Date: 2026-10-11 · Instruction: #3 · Author: Bravo
- Context: the Master Context requires tests for every feature, Docker is not installed on the
  build machine, and `infra/` is not a workspace package (instruction 1).
- Decision: `infra/compose.test.ts` parses `docker-compose.yml` with `yaml` (a YAML 1.2
  parser), checks the parts it relies on with Zod, and asserts the rules above: only
  `postgres` and `redis` start by default, ports stay on 127.0.0.1, secrets use the required
  form, health checks, volumes, restart policies, log rotation, pinned images, and that
  `.env.example` documents every variable with the same defaults. It runs as the `infra` project
  of the root `vitest.config.ts`; the root `tsconfig.json` includes `infra/**/*.ts` so that
  `pnpm typecheck` and ESLint cover it. `yaml` and `zod` became root dev dependencies. Validating
  against the compose-spec JSON Schema and with the real Compose parser was done once, outside
  the repository (see the build log), so the repository gains no validator dependencies.
- Trade-offs: static checks cannot prove that the containers start; that needs Docker (an owner
  action) and CI's `docker compose config`. The tests read the files from disk, which Vitest's
  import graph cannot see, so `vitest related` only runs them for a change to
  `docker-compose.yml` or `.env.example` if those files are listed as force-rerun triggers.

### Typed environment loader: one Zod helper in packages/shared, one schema per app

- Date: 2026-10-11 · Instruction: #4 · Author: Charlie
- Context: instruction 4 asks for a typed environment loader that crashes on startup when a
  variable is missing. Both apps need the same behaviour, and the messages must never put a
  secret into a terminal or a log.
- Decision: `parseEnv(schema, source, options)` in packages/shared reads only the variables a Zod
  object schema declares, collects every problem into one `EnvValidationError` (variable name and
  problem, never the value), and treats an empty value as not set, as `${NAME:-default}` does in
  a shell and in Docker Compose. Each app owns its schema and is the only code that reads
  `process.env`: the API in `src/server.ts` (through `loadConfig` in `src/config.ts`), the web
  app in `src/env/`. ESLint's `no-restricted-properties` rejects `process.env` everywhere else in
  `apps/*/src` and `packages/*/src`. Only variables that something uses today are declared, with
  a default only where it is safe: `API_HOST` defaults to loopback, `API_PORT` to 4000 and
  `LOG_LEVEL` to `info`. `API_HOST` must be an IP address or a hostname, so a URL or `host:port`
  fails at startup instead of in a DNS lookup.
- Trade-offs: an empty value can never mean "deliberately empty"; such a variable would need its
  own optional schema and check. The lint rule catches `process.env`, including destructuring,
  but not every route to the environment (`import { env } from "node:process"`), and it does not
  cover config files, scripts or root-level tests. A library (t3-env, envalid) would add a
  dependency for about 60 lines of code and would still need our value-free messages.

### The API loads apps/api/.env with Node's --env-file-if-exists

- Date: 2026-10-11 · Instruction: #4 · Author: Charlie
- Context: developers need a file for local settings. Next.js reads its own `.env` files; the
  API needs a way to read one.
- Decision: the API's `dev` and `start` scripts run `node --env-file-if-exists=.env`, so
  `apps/api/.env` is optional and variables set in the shell win over it. `server.ts` never reads
  files, so tests that start it directly cannot pick up a developer's `.env`. Each program reads
  its own file: `apps/api/.env`, `apps/web/.env`, and the root `.env` for Docker Compose.
- Trade-offs: no dotenv dependency, and `node --watch` restarts the API when the file changes.
  Node's parser differs from Compose's and Next.js's (Next.js expands `$NAME`, Node does not), so
  the templates stick to plain `NAME=value` lines. Without the file, Node prints ".env not found.
  Continuing without it." at every start. Separate files keep each process to the settings it
  needs (the web server never sees database passwords), but a value that two programs need, such
  as the database password from Phase 2, will have to be written into both files.

### Web env: server-only and NEXT_PUBLIC_ variables apart, checked per Next.js phase

- Date: 2026-10-11 · Instruction: #4 · Author: Charlie
- Context: Next.js copies `NEXT_PUBLIC_` values into browser JavaScript when it compiles the app,
  and only where code names the variable literally; other variables stay on the server, but a
  module that reads them can still be imported by a Client Component by mistake. The web app
  reads no variables yet.
- Decision: `apps/web/src/env/schema.ts` declares two groups, both empty for now; the public
  group's type accepts only `NEXT_PUBLIC_` names. `server.ts` exports `serverEnv` and starts with
  `import "server-only"`, so a Client Component that imports it, even indirectly, fails
  `next dev` and `next build` with an import trace. `public.ts` exports `publicEnv` and reads each
  variable by name in brackets (`process.env["NEXT_PUBLIC_X"]`; TypeScript's
  `noPropertyAccessFromIndexSignature` rejects the dot form), and a type check fails until every
  declared variable is listed. `next.config.ts` exports a function of the phase that calls
  `validateWebEnv`: public variables in `next dev` and `next build`, server variables in
  `next dev` and `next start`. Verified with temporary variables: Next.js 16.4 inlines the
  bracket form into browser JavaScript; a build without the server secret succeeds;
  `next start` without it exits with code 1; a Server Component can import `serverEnv` without
  the secret reaching any browser file; a Client Component that imports it fails the build.
- Trade-offs: the scaffolding exists before the first variable does, so that variable needs no
  new mechanism. A production build (for example a Docker image) can run without server secrets,
  but a page that reads one while it is prerendered still needs it at build time. `next typegen`
  (`pnpm typecheck`) loads the config in the build phase, so required public variables must also
  be set for type checks. The check runs inside the exported function, not when the file loads,
  because only the function receives the phase. A standalone build's `server.js` (if instruction
  102 uses one) does not load `next.config.ts`, so the server check would move to
  `instrumentation.ts`. `server-only` is installed although Next.js handles the import itself, so
  that Vitest and Storybook can resolve it.

### WEB_HOST and WEB_PORT stay shell variables

- Date: 2026-10-11 · Instruction: #4 · Author: Charlie
- Context: the web app's scripts pass `${WEB_HOST:-127.0.0.1}` and `${WEB_PORT:-3000}` to the
  Next.js CLI (instruction 1). Next.js opens the port before it reads `.env` files or its config,
  so neither can set them, and a check in `next.config.ts` would run after the port is open.
- Decision: keep them as shell variables, documented in `apps/web/.env.example` and the README,
  and leave them out of the web env schemas. Next.js's CLI rejects a non-numeric port, and an
  out-of-range port or a bad host fails to bind.
- Trade-offs: unlike `apps/api/.env`, `apps/web/.env` cannot set the port, and a bad value gets
  Next.js's or Node's error rather than ours. A wrapper script that validates them and then
  starts Next.js would fix both, at the cost of another process that must forward signals and
  exit codes, for two development settings.

### Every .env file is ignored, and a test asks git to prove it

- Date: 2026-10-11 · Instruction: #4 · Author: Charlie
- Context: instruction 4 asks to confirm that `.env` is gitignored. Next.js's documentation
  suggests committing default files such as `.env.development` and `.env.production`.
- Decision: keep the rules from instruction 1 (`.env`, `.env.*`, `!.env.example`): every env
  file in every folder is ignored, and only the `.env.example` templates are committed; defaults
  live in the Zod schemas instead. `env-files.test.ts` asks git itself
  (`git check-ignore --no-index --verbose`, with the user's global excludes file left out) about
  17 env-file names and the three templates, and fails if any `.env` file is committed. It runs in
  a root `tooling` Vitest project for tests of repository-wide rules.
- Trade-offs: a template with any other name (such as `.env.sample`) would be ignored. The test
  needs `git`, which every checkout and CI runner has.

### CI is one GitHub Actions job that runs the root scripts

- Date: 2026-10-11 · Instruction: #5 · Author: Delta
- Context: the playbook asks for install, lint, type-check, test and build in CI, with pnpm
  cached. GitHub bills private repositories per job and rounds each job up to a whole minute.
  `ubuntu-latest` still means Ubuntu 24.04 and moves to 26.04 in November 2026; Ubuntu 26.04
  runners are generally available.
- Decision: `.github/workflows/ci.yml` runs one job, "Checks", on `ubuntu-26.04` for every push
  to `main` and every pull request. `pnpm/action-setup` installs the pnpm version in
  `packageManager`; `actions/setup-node` installs the Node.js version in `.nvmrc` and caches
  pnpm's store (`cache: pnpm`, keyed on `pnpm-lock.yaml`; since setup-node 6 only npm is cached
  automatically). pnpm/action-setup's own `cache` input stays off, so the store is cached once.
  Then `pnpm install --frozen-lockfile`, `pnpm peers check`, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test` and `pnpm build`, the build-log warning check and the Compose
  check. Every check runs once the install has worked, even after an earlier check failed
  (`!cancelled()`), so one run reports every problem. Every `run` step uses `shell: bash`, which
  GitHub runs with `-o pipefail`, so `pnpm build | tee` fails when the build fails. A new push to
  a pull request cancels the older run; each commit on `main` gets its own concurrency group, so
  all of them are checked to the end. CI sets `NEXT_TELEMETRY_DISABLED=1`.
  `scripts/ci-workflow.test.ts` runs the Build, warning-check and Compose scripts through that
  same bash command, with stand-ins for pnpm and docker, because their failure behaviour is the
  point of the workflow and could otherwise only be seen on GitHub.
- Trade-offs: the checks run one after another instead of in parallel jobs, which would each
  repeat the setup and each bill at least a minute. Next.js's own build cache (`.next/cache`)
  is not cached: the build takes seconds today, so revisit when it slows down. Pinning
  `ubuntu-26.04` means the runner image changes only when we change the label. actionlint 1.7.12,
  the latest release, does not know that label yet, so `.github/actionlint.yaml` declares it.
  `pnpm/setup`, a newer action that installs pnpm and Node.js in one step, was considered; the
  established pair is used instead.

### What "fail on any warning" means in CI

- Date: 2026-10-11 · Instruction: #5 · Author: Delta
- Context: the playbook says "fail on any warning", but each tool reports warnings differently,
  and several print one and still exit with status 0.
- Decision: CI fails on:
  - ESLint warnings: `pnpm lint` runs with `--max-warnings 0`.
  - TypeScript errors in `pnpm typecheck` and `pnpm build`; `tsc` has no warning level.
  - Unformatted files: `pnpm format:check`.
  - Failing tests, and unhandled errors or rejections, which fail a Vitest run by default.
  - Unmet or missing peer dependencies: `pnpm peers check` exits with status 1.
    `strictPeerDependencies: true` alone would not work in CI: with pnpm 12.11.2, a
    `--frozen-lockfile` install skips resolution and never checks peers (tested).
  - A lockfile that does not match `package.json`, or a dependency install script that is not
    in `allowBuilds`: both fail `pnpm install --frozen-lockfile`.
  - Warnings in the build output, and errors that did not stop the build. Next.js prints both
    and still exits with status 0: an unknown `next.config.ts` option produced three "⚠" lines,
    and a page that logs an error, or leaves a promise rejection unhandled, while it is
    prerendered produced an "Error: ..." line with a code frame, each in a successful build
    (tested). pnpm's default reporter merges every package's stdout and stderr into its own
    stdout (tested), so CI cannot just watch stderr. The Build step saves the output and
    `scripts/check-build-warnings.ts` fails on lines with Next.js's "⚠" (warning) or "⨯"
    (error) prefix, "Warning:" (older Next.js messages, Turbopack's warnings and Node.js process
    warnings), "Error:" (any printed error, "TypeError:" included), Turbopack's "build
    encountered N warnings" header or pnpm's "WARN". It ignores Next.js's "No build cache found"
    notice, which is about the CI machine rather than the code (Next.js prints it to stdout so
    that CI checks on stderr skip it).
  - Docker Compose warnings: `docker compose --profile '*' config --quiet` must print nothing.
    Compose reports an unset variable as a warning and exits with status 0 (tested).
    `--profile '*'` also validates the services in the `app` profile: without it, a broken
    `depends_on` there passes (tested).
- Not enforced: a plain `console.warn` or `console.log` that runs while Next.js prerenders a page,
  which Next.js prints as the bare message (tested), and the few Next.js warnings written the
  same way (most are for features this app does not use, such as the Pages Router, i18n and the
  edge runtime); console output or Node.js warnings printed while tests, lint or the type check
  pass (no signal that works across tools; tests should assert on the logs they expect); pnpm's
  deprecation notices, which appear only when the lockfile is resolved, never during CI's frozen
  install (the ESLint 9 one is expected, see the ESLint pin); and warnings that GitHub shows
  about the runner or the actions, which a step cannot read.
- Trade-offs: the build-log check matches the formats of Next.js 16.4, Node.js 24 and pnpm 12; a
  warning worded differently would slip through, so re-check after major upgrades by provoking
  one (docs/BUILD_LOG.md, instruction 5, shows how). A line that merely contains "Warning:" or
  "Error:" fails the build, which errs on the safe side; a clean build prints neither. A check
  that fails on anything a package writes to stderr was considered. pnpm's ndjson reporter
  reports each line as JSON with the stream it came from, the environment variable
  `pnpm_config_reporter=ndjson` reaches the `pnpm --recursive build` inside `pnpm build` (tested
  in a scratch workspace), and a clean build of this repository writes nothing to stderr (tested).
  It would also catch the bare `console.warn` above, but the Build step's log would then be JSON
  unless a script reformatted it, and the check would depend on pnpm's internal log format,
  which pnpm does not document. Revisit it if such warnings start to matter.

### CI supply-chain and token safety

- Date: 2026-10-11 · Instruction: #5 · Author: Delta
- Context: third-party actions run with the workflow's token, and a release tag can be moved to
  different code after it is reviewed.
- Decision: each action is pinned to the full commit SHA of its latest release, with the release
  in a comment: `actions/checkout` v7.0.1, `pnpm/action-setup` v6.1.0 (an annotated tag,
  dereferenced to its commit) and `actions/setup-node` v7.1.0. Each SHA was read from the GitHub
  API and checked to be on the action repository's default branch, not a commit pushed to a
  fork. The token is read-only (`permissions: contents: read`), the checkout keeps no
  credentials (`persist-credentials: false`), the workflow uses `pull_request` (fork pull
  requests get no secrets) and the job stops after 15 minutes. `scripts/ci-workflow.test.ts`
  holds every workflow to these rules and checks that each `pnpm` script and `scripts/` file a
  workflow calls exists. zizmor 1.30.1 reports no findings (offline audits, pedantic persona).
- Trade-offs: pinned SHAs never update themselves; Dependabot (instruction 106) will propose
  updates. A future workflow that needs more than read access must say why, and the test needs
  a matching exception. actionlint and zizmor are run by hand when a workflow changes, not in
  CI: each would be one more downloaded binary for CI to trust, and the workflow tests already
  hold this repository's own rules. Instruction 106 (scanning in CI) can revisit this.

### Developer commands are package.json scripts; no Makefile

- Date: 2026-10-11 · Instruction: #7 · Author: Delta
- Context: the playbook asks for "a Makefile or npm scripts for dev, test, build, db:migrate,
  db:seed and docker:up". The root `package.json` already holds the other scripts.
- Decision: root `package.json` scripts only: `db:migrate`, `db:seed`, `docker:up`,
  `docker:down` and `docker:logs` join the existing ones. `pnpm run` lists them all and the
  README describes them.
- Trade-offs: no `make` interface. A Makefile would be a second list of commands to keep in step
  with `package.json`, and `make` is missing on Macs without the Xcode command line tools.

### db:migrate and db:seed fail until instruction 26

- Date: 2026-10-11 · Instruction: #7 · Author: Delta
- Context: there is no schema, migration tool or seed data until instruction 26.
- Decision: both scripts print "not available yet" with the instruction number to stderr and
  exit with status 1.
- Trade-offs: anything that calls them fails until instruction 26 replaces them, which is the
  point: a placeholder that exits with status 0 would look like a migrated database.

### docker:* scripts check Docker, then run Compose directly

- Date: 2026-10-11 · Instruction: #7 · Author: Delta
- Context: without Docker, `docker compose` fails with "docker: command not found" and pnpm's
  generic error, and an installed Docker Desktop that is not running is a common case on a Mac.
- Decision: each script is `node scripts/check-docker.ts && docker compose <arguments>`. The
  check runs `docker compose version` (the client and its Compose plugin; the current Compose is
  v5, and the legacy `docker-compose` v1 command is not used) and
  `docker version --format {{.Server.Version}}` (engine reachable), each with a 20-second limit,
  and explains how to fix the first problem it finds. Compose then runs straight from the shell,
  so its output, Ctrl+C and exit status are exactly as if typed by hand. `docker:up` uses
  `up --detach --wait`, which returns once every service is healthy and fails if one never is;
  `docker:down` keeps the data volumes; `docker:logs` follows the logs, and pnpm passes extra
  arguments on (`pnpm docker:logs postgres`). A missing password is left to Compose, whose
  message from `docker-compose.yml` names the variable and the file.
- Trade-offs: each command waits for the check: about 0.05 seconds for Node.js and the check
  itself (measured with a stand-in `docker`), plus its two `docker` commands. The check is
  TypeScript run by Node.js, not a shell wrapper, so it is type-checked, linted and unit-tested
  like the rest of the code.

### The scripts in scripts/ need Node.js 24.2 or later

- Date: 2026-10-11 · Instruction: #5 · Author: Delta
- Context: `scripts/check-build-warnings.ts` and `scripts/check-docker.ts` are programs and also
  modules that their tests import, so each runs its check only when started as a program:
  `if (import.meta.main)`. Node.js added `import.meta.main` in 24.2.0 and still documents it as
  "Stability: 1.0 - Early development"; it prints no warning. In older versions it is undefined,
  so both scripts would do nothing and exit with status 0. Vitest sets it to `false` when a test
  imports them (tested).
- Decision: keep `import.meta.main`, Node.js's own way to tell a program from an import. CI
  installs the latest Node.js 24 (`.nvmrc` says `24`; the runner image has 24.21.0), and so do
  nvm and similar tools on developers' machines. A Node.js on which it does not work fails the
  tests instead of passing quietly: they run both programs and expect their messages and exit
  statuses (with the check disabled on purpose, 17 of them failed).
- Trade-offs: `engines` in the root `package.json` (instruction 1) still accepts Node.js 24.0 and
  24.1, which lack it; raising it to `>=24.2` would state the real minimum. That field belongs to
  instruction 1, so the change is proposed in review instead of made here. Two alternatives were
  rejected. A separate program file per check, as apps/api splits `server.ts` from `app.ts`,
  would leave the program files imported by no test, so the pre-commit hook's `vitest related`
  (instruction 2) would run none of their tests when only a program changed. Comparing
  `process.argv[1]` with the module's own path works on older Node.js but has to resolve symbolic
  links on both sides to be right.
  (The wave w0 review raised `engines` to `>=24.15`, which a dependency needs: see "Node.js 24.15
  or later, enforced by pnpm at install".)

### Architecture document: one zoned overview diagram with built and planned labels

- Date: 2026-10-11 · Instruction: #6 · Author: Echo
- Context: instruction 6 asks for a Mermaid diagram of every component. The playbook names about
  25 components across its phases, almost all of them planned, and the owner needs to see what
  exists, what is coming and where the trust boundaries are.
- Decision: `docs/ARCHITECTURE.md` has one overview flowchart with every component, grouped into
  network zones (internet, Cloudflare, the home server's edge and internal networks, a sandbox
  with no network, third parties), plus smaller diagrams for the request flow, a Crew Chief chat,
  uploads and the print service, and deployment today and on the home server. Every label says
  "built #N" or "planned #N"; built components also have thick borders and planned ones dashed
  borders, and no colour carries meaning. Tables repeat the components, zones, boundaries and data
  stores with the same numbers. The labels describe the repository once all of Phase 0 is merged.
- Trade-offs: the overview is large (about 30 nodes), but one picture shows the trust boundaries
  best and the smaller diagrams carry the detail. Planned parts are the expected design, not
  commitments: instructions such as 70, 73, 102, 103 and 166 settle them and must update the
  document in the same change. Questions the playbook leaves to later instructions are listed in
  the document, not decided here.

### Check Mermaid diagrams with mermaid-cli outside the repository

- Date: 2026-10-11 · Instruction: #6 · Author: Echo
- Context: the diagrams must be shown to parse and render. mermaid-cli renders them in a headless
  Chrome through Puppeteer: about 200 npm packages and a browser, for a check that matters only
  when the document changes.
- Decision: no repository dependency and no CI step. Every diagram was rendered with
  `@mermaid-js/mermaid-cli` 12.0.0, installed with `npm ci` in a scratch directory (so npm checked
  every package against the lockfile's hashes) and pointed at the machine's own Chrome. The
  document gives the next editor the equivalent `npx` command; GitHub also renders the diagrams.
- Trade-offs: a broken diagram is caught only if the editor runs the command or looks at GitHub.
  Surprise: in a sequence diagram a bare `#` starts a comment that silently cuts the label while
  mermaid-cli still succeeds, so those diagrams write `#35;` and only review can catch a slip. If
  the diagrams start changing often, add the render check to CI as a job of its own.

### Decisions log: append-only, with replaced entries marked "Superseded by"

- Date: 2026-10-11 · Instruction: #6 · Author: Echo
- Context: the team fixed the entry template, and entries are appended on parallel branches and
  union-merged. Someone reading an old entry needs to know whether it still holds.
- Decision: the log's header explains what belongs in it, each field of the template and the
  rules: append only, no numeric IDs, check union merges, never edit a merged decision (facts,
  typos and links may be corrected), and when a decision is replaced, the new entry names the old
  one and the old entry gets one last line, `- Superseded by: <title>`. Every existing entry is
  unchanged.
- Trade-offs: the "Superseded by" line is the one edit an old entry can get; in return, a reader
  sees at the entry itself that it no longer holds instead of searching the rest of the log.

### API logging: Fastify's own pino logger, JSON lines, pretty output only on request

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: instruction 8 asks for structured logging with pino. Fastify already creates a pino
  logger, with a child logger per request. The owner reads logs in a terminal while developing,
  and through `docker compose logs` and monitoring in production.
- Decision: `buildApp` configures Fastify's pino logger (pino is not a direct dependency): one
  JSON object per line with an ISO 8601 UTC time. The level comes from `buildApp`'s options
  (`LOG_LEVEL` through instruction 4's loader) and defaults to `silent`, so tests stay quiet; tests
  pass an in-memory `logDestination`. `LOG_FORMAT` (`json` by default, or `pretty`) chooses the
  output: `pretty` formats each finished, already redacted line with pino-pretty's synchronous
  `prettyFactory`. pino-pretty is a development dependency imported only for that format; without
  it the API refuses to start and says to use `json`.
- Trade-offs: pretty output is opt-in (`LOG_FORMAT=pretty pnpm dev`, or a line in
  `apps/api/.env`), so `pnpm dev` prints JSON unless asked; choosing the format from something
  implicit such as a TTY could turn pretty logs on in production. Rejected: piping into the
  pino-pretty CLI (the shell then reports pino-pretty's exit status, not the server's), and
  pino-pretty's transport (a worker thread) or stream API (an extra stream pipeline), which work
  but add parts. Production images should install production dependencies only (#102), so pretty
  output cannot be switched on there by mistake.

### Request IDs: a validated x-request-id or a new UUID, sent back on every response

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: every log line of a request needs its ID. Reusing the ID of an upstream hop (later the
  web app's server-side calls, or a proxy) links their logs, but the value comes from the client
  and ends up in logs and in a response header.
- Decision: Fastify's `requestIdHeader` is off, because it trusts any value. `genReqId` reuses
  `x-request-id` only if it matches `^[A-Za-z0-9_-]{8,64}$` (UUIDs, ULIDs, nanoids, hex IDs;
  Node.js joins repeated headers with ", ", so those fail) and otherwise uses `randomUUID()`. The
  app's first `onRequest` hook sends the ID back in `x-request-id`, and a `frameworkErrors` handler
  does the same for the 400 and 414 responses that Fastify's router sends before any hook runs.
  The log key stays Fastify's `reqId`, set through the `logController` option because the
  top-level `requestIdLogLabel` option is deprecated in Fastify 5.12.
- Trade-offs: a client can send any well-formed ID, even one another request used, so an ID is a
  label for finding log lines, never a basis for authorisation, rate limits or idempotency (#36
  needs its own keys). Two responses still go out without the header, both sent before any hook
  can run: Node.js's bare 400 for bytes that are not HTTP, and Fastify's 503 for a request that
  arrives on an open connection during shutdown (its log line has the ID).

### Request context: a small AsyncLocalStorage module, not @fastify/request-context

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: code that never sees the request, such as a service given `app.log` at startup, and
  later jobs and the AI gateway, must still log the request's ID.
- Decision: `apps/api/src/lib/request-context.ts` (about 40 lines) holds an `AsyncLocalStorage` of
  `{ requestId }`. The app's first `onRequest` hook runs the rest of the request inside it with
  `run()`, and the logger adds the ID to any line that lacks one (see the next entry). Fastify 5
  finishes body parsing in an `AsyncResource` created when parsing starts, so the context survives
  a body that arrives in pieces. Tests check this over a real connection, with concurrent
  requests, and with two requests on one keep-alive connection.
- Trade-offs: @fastify/request-context 7 does the same with a dependency, a store typed through
  module augmentation, and a `preValidation` hook that re-enters the context, which Fastify 5's
  parser makes unnecessary; revisit it if the context grows (for example the signed-in user,
  #40). pino's `mixin` option was rejected: it adds its keys to every line, so lines from
  `request.log`, which already bind `reqId`, would hold the key twice (checked with pino 10).

### Redact every log line after serialisation, in pino's streamWrite hook

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: no secret may reach the logs (Master Context; instruction 8 names authorization,
  cookies, passwords and tokens). pino's `redact` option takes fixed paths with one `*` per level,
  so it misses a secret at an unexpected depth (an HTTP client's error config, a whole object
  logged carelessly) and cannot look inside strings. pino's `formatters.log` runs before the
  serializers, so it sees raw errors and requests rather than what is written.
- Decision: pino's `hooks.streamWrite` (`finishLogLine` in `apps/api/src/lib/logger.ts`) parses
  each finished line and replaces the value of every sensitive key at any depth (keys compared in
  lowercase without separators: anything containing password, passphrase, secret, credential, or
  an API, private, encryption, signing or master key, or a recovery code; anything ending in
  token(s), jwt, authorization, cookie(s), session ID, otp or signature; exactly auth or
  rawPacket). It hides URL credentials, query strings and fragments in every string, the message
  included, cuts strings to 8192 characters, and adds the running request's ID to a line that has
  none. A line that does not parse is replaced by an error line, so nothing unredacted is written.
  ESLint forbids `console` in `apps/api/src` (except `server.ts`, which may print before the
  logger exists), so every line takes this path.
- Trade-offs: parsing and re-serialising each line costs about 3.3 µs instead of pino's 0.5 µs
  (measured on this Apple M5), about 5.5 µs per request for Fastify's two request lines: nothing
  next to a real route, but worth revisiting if profiling (#119) says otherwise. Free text cannot
  be checked, so code must never put a secret in a message. Key names decide what is hidden: a list
  of AI token counts must be named like `promptTokenCount`, because "tokens" is sensitive.

### Request lines hold method, shortened path and client address, never the query string

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: query strings carry secrets (password-reset links, OAuth callbacks, signed storage
  URLs). Fastify's default request serializer logs the full URL, the client-supplied Host and
  Accept-Version headers and the client's port, and its 404 line repeats the URL.
- Decision: the `req` serializer logs `{ method, url, remoteAddress }`, with the query string and
  fragment replaced by `?[Redacted]` and the URL cut to 256 characters. The 404 line says "route
  not found" (a `LogController` override), because the request's first line already has the URL.
  Headers and bodies are never logged by default.
- Trade-offs: to debug a list endpoint's filters (#30), its handler must log the validated query on
  purpose, where key-based redaction still applies. The client IP address is personal data under
  UK GDPR, so the privacy policy and its retention periods must cover logs (#114). Behind the
  tunnel `remoteAddress` is cloudflared's until the API trusts the address the tunnel forwards,
  which rate limiting (#44) needs anyway.

### LOG_FORMAT is an API setting, added to instruction 4's config module

- Date: 2026-10-11 · Instruction: #8 · Author: Echo
- Context: the team contract gives the API's environment module to instruction 4 and names only
  `LOG_LEVEL` for logging, but the pretty switch must be a validated setting too: apps read the
  environment only through their env module.
- Decision: this branch adds `LOG_FORMAT` (`json` or `pretty`, default `json`) to
  `apps/api/src/config.ts` and passes it to `buildApp` as `logFormat`, next to the `logLevel` and
  `logDestination` options the contract names. Until instruction 4's loader is merged, the
  entrypoint passes `logLevel: "info"`, the level Fastify used before.
- Trade-offs: a small, expected merge conflict with instruction 4 instead of an unvalidated read
  of `process.env`. The merge adds `LOG_FORMAT` to the loader's schema, `ApiConfig` and
  `apps/api/.env.example`, and the entrypoint calls
  `buildApp({ logLevel: config.logLevel, logFormat: config.logFormat })`.

### Files that tests read from disk also make the pre-commit hook run every test

- Date: 2026-10-11 · Instruction: #2, #3, #4, #5 · Author: Integrator (wave w0)
- Context: the pre-commit hook (instruction 2) runs `vitest related`, which picks tests by their
  imports. The tests for `docker-compose.yml` and the root `.env.example` (instruction 3), for the
  env-file ignore rules and templates (instruction 4) and for the CI workflows (instruction 5)
  read those files from disk or ask git about them, so after the merge a commit that changed only
  one of them ran no tests. The build log entries for instructions 3 and 5 asked for these files
  to become rerun triggers once the branches were merged.
- Decision: the root `vitest.config.ts` adds `docker-compose.yml`, every `.env.example`, every
  `.gitignore` and `.github/workflows/*` to `forceRerunTriggers`, after the triggers chosen in
  "Related unit tests in the pre-commit hook, with absolute rerun triggers". `git-hooks.test.ts`
  checks each one.
- Trade-offs: staging one of these files runs every test instead of only the tests that read it.
  Vitest has no setting that maps a file to particular tests, and a lint-staged task per file
  would be a second list to keep in step with the tests; these files change rarely. Tests that
  start code in a child process are still not picked by that code (`server.test.ts` and
  `src/server.ts`, until the wave w0 review made `src/server.ts` a trigger); CI runs every test.

### The web type check leaves out next dev's copy of the route types

- Date: 2026-10-11 · Instruction: #1 · Author: Echo
- Context: found in the wave w0 review. Since Next.js 16, `next dev` writes its own copy of the
  route types to `.next/dev/types`, and Next.js wants tsconfig.json to include both that and
  `.next/types`. `next typegen`, which `pnpm typecheck` runs before `tsc`, rewrites only
  `.next/types`. Once a route was deleted or renamed after the dev server had stopped, the dev copy
  still imported the old page, so `pnpm typecheck`, and with it the pre-commit hook, failed on
  every commit that staged TypeScript or JSON ("Cannot find module
  '../../../src/app/<route>/page.js'") until someone deleted `.next` or ran `next dev` again.
  `next build` filters `.next/dev/types` out of its own type check for this reason (a comment in
  next/dist/lib/typescript/runTypeCheck.js says so).
- Decision: the web app's `typecheck` script runs `tsc --noEmit --project tsconfig.typecheck.json`.
  That file extends tsconfig.json and excludes `node_modules` and `.next/dev`. tsconfig.json is
  unchanged, so editors still see the route types of a running dev server: after the hook has run
  `next typegen`, `next-env.d.ts` points at `.next/types` until the dev server restarts, and only
  the include of `.next/dev/types` keeps a route added meanwhile visible. `typecheck.test.ts` runs
  the script on a copy of the web app with a stale dev validator.
- Trade-offs: a second tsconfig in apps/web. Removing the dev types from tsconfig.json instead
  would have been one line, but it hides new routes from editors as described; Next.js does not
  rewrite tsconfig.json here either way, because it leaves alone a tsconfig that extends another.

### The production API start refuses TypeScript source

- Date: 2026-10-11 · Instruction: #1 · Author: Echo
- Context: found in the wave w0 review. "Workspace packages are consumed as TypeScript source; the
  production API runs compiled code" said that `node dist/server.js` without
  `--conditions=@apex/dist` fails with `ERR_MODULE_NOT_FOUND`. It does not: Node.js resolves the
  default export of `@apex/shared`, `src/index.ts`, strips its types and the API starts (tested in
  this checkout; inside `node_modules`, as in a `pnpm deploy` bundle, Node.js refuses to strip
  types and fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). A start command that
  forgets the condition, in a future Dockerfile for example, would quietly run uncompiled shared
  code. Nothing tested the production start at all: CI builds the API but never starts it.
- Decision: the API's `start` script adds `--no-strip-types`, which turns type stripping off (the
  name since Node.js 24.12; the older `--no-experimental-strip-types` still works), so a missing or
  broken condition fails at once with `ERR_UNKNOWN_FILE_EXTENSION`.
  `apps/api/src/production.test.ts` copies packages/shared and the API to a temporary folder (the
  files the build reads, with this checkout's installed dependencies), runs their build scripts
  and then the start script: GET /health answers with the shared contract, SIGTERM stops the
  server with code 0, and without the condition the start fails.
- Trade-offs: the copy costs about a second in `pnpm test`. Building in place, as `pnpm build`
  does, would have been simpler, but the test would then delete and rewrite the checkout's
  `dist/` folders while a `pnpm build` or `pnpm start` might be using them. The test is picked by
  `vitest related` only when a rerun trigger or a packages/shared file is staged (it does not
  import the API's source); CI runs it every time. The web app's production start
  (`next start`) is still checked only by hand.

### Node.js 24.15 or later, enforced by pnpm at install

- Date: 2026-10-11 · Instruction: #1 · Author: Echo
- Context: "The scripts in scripts/ need Node.js 24.2 or later" proposed raising `engines` in the
  root package.json from `>=24` to `>=24.2`, because on 24.0 and 24.1 the Docker and build-log
  checks silently do nothing. The wave w0 review found two more problems: pnpm 12 ignores
  `engines` unless `engineStrict` is set (an install with `"node": ">=99"` printed no warning at
  all), and the dependencies already need more than 24.2: jsdom 30 (the web tests' DOM) and three
  of its dependencies declare `^22.22.2 || ^24.15.0 || >=26.0.0`.
- Decision: `"engines": { "node": ">=24.15" }` and `engineStrict: true` in pnpm-workspace.yaml, so
  `pnpm install` on an older Node.js stops with `ERR_PNPM_UNSUPPORTED_ENGINE`. `workspace.test.ts`
  runs pnpm on a copy of the workspace twice: with a range the running Node.js cannot meet, which
  must fail, and as the oldest Node.js that `engines` allows (pnpm's `node-version` setting),
  which must install every locked dependency. A dependency that needs a newer Node.js than
  `engines` says fails that test, so the minimum is raised on purpose, not discovered by someone
  whose install fails.
- Trade-offs: `engineStrict` also refuses any dependency whose `engines` excludes the running
  Node.js; today only `@img/sharp-win32-ia32` does (it names Node.js 20 and is never installed on
  macOS or Linux). When a dependency is refused, decide case by case (another version, another
  package, a higher minimum, or `packageExtensions` to correct a wrong range) and record it here.
  `pnpm run` does not check `engines`, so a Node.js changed after the install is not caught. The
  test's installs use `--offline` and `--frozen-store`, so they download nothing and write nothing
  to pnpm's store (an ordinary install records its folder there). An earlier commit of this review
  set `>=24.2`, which failed on jsdom with `engineStrict`; the second test exists because of it.

### The API entrypoint makes the pre-commit hook run every test

- Date: 2026-10-11 · Instruction: #2 · Author: Echo
- Context: "Related unit tests in the pre-commit hook, with absolute rerun triggers" and "Files
  that tests read from disk also make the pre-commit hook run every test" left one known gap:
  `apps/api/src/server.test.ts` starts `apps/api/src/server.ts` as a separate process instead of
  importing it, so a commit that changed only the entrypoint ran no tests in the hook, although
  the triggers exist for files that tests "run as commands".
- Decision: `apps/api/src/server.ts` is a rerun trigger in the root `vitest.config.ts`;
  `git-hooks.test.ts` checks it.
- Trade-offs: a commit that touches the entrypoint runs every test (about 16 s today). The
  production test, which builds and starts a copy of the API, still runs in the hook only when a
  rerun trigger or a packages/shared file is staged; CI runs it every time.

### A stopped pre-commit hook is recovered by hand, with tested steps

- Date: 2026-10-11 · Instruction: #2 · Author: Echo
- Context: found in the wave w0 review. lint-staged puts unstaged changes and untracked files back
  only when it gets SIGINT (Ctrl+C); its code listens for no other signal. A closed terminal
  (SIGHUP), an editor or tool that cancels the commit (SIGTERM) or SIGKILL stops it at once, and
  the working tree is left with only the staged changes while the rest waits in a "lint-staged
  automatic backup" stash entry. The README advised `git stash pop stash@{n}`, which fails with a
  merge conflict on any partly staged file.
- Decision: the README section "Git hooks" says which interruptions leave files in the backup and
  gives the steps lint-staged takes itself when it restores after a failed check:
  `git reset --hard`, `git stash apply --index stash@{n}`, `git stash drop stash@{n}`.
  `git-hooks.test.ts` starts the real hook in a process group of its own, as a terminal runs
  `git commit`, signals the group while the type check runs, and checks both outcomes: after
  SIGINT every file is back; after SIGTERM, SIGHUP and SIGKILL the documented steps restore the
  index, the edit and the new file exactly.
- Trade-offs: recovery stays manual. A wrapper that turned SIGTERM and SIGHUP into SIGINT for
  lint-staged would need lint-staged in a process group of its own, and after SIGHUP it would
  write to a terminal that no longer exists; `--no-stash` would also give up hiding unstaged
  changes and untracked files. If lint-staged starts handling more signals, the tests fail and
  this advice should be updated.

### A stop signal repeated within a second counts as one

- Date: 2026-10-11 · Instruction: #1 · Author: Echo
- Context: found in the wave w0 review. "API structure: app factory, plugin routes and a small
  entrypoint" registered the SIGINT and SIGTERM handlers with `once`, so that a second Ctrl+C
  falls through to Node.js and stops the process at once. In `pnpm dev`, the terminal's Ctrl+C
  reaches both `node --watch` and the API, and `node --watch` then sends the API the signal it
  received (lib/internal/main/watch_mode.js in Node.js). By then the `once` handler was gone, so
  that second SIGINT ended the API at once: a request still open got no response.
- Decision: `apps/api/src/server.ts` handles every SIGINT and SIGTERM. The first starts the
  graceful shutdown as before; another within a second (`REPEATED_SIGNAL_WINDOW_MS`) is the same
  request and is ignored; a later one logs "second signal; exiting without waiting for open
  requests" and exits with code 1, as a timed-out shutdown does. `server.test.ts` sends the second
  SIGINT right after "shutting down" is logged (the open request still gets its response and the
  exit code is 0) and 1.25 seconds later (exit code 1).
- Trade-offs: a person's second Ctrl+C within a second is ignored; pressing again later, or the
  10-second shutdown limit, ends the process. A forced stop now exits with code 1 instead of
  being killed by the signal. Telling the copy from `node --watch` apart from a second Ctrl+C in
  any other way would depend on how Node.js runs the watch child (its environment or IPC
  channel), which can change between versions.

### Merge commits that git makes run the pre-commit checks

- Date: 2026-10-11 · Instruction: #2 · Author: Echo
- Context: found in the wave w0 review. git runs the pre-commit hook only for `git commit`. When
  `git merge` (or a `git pull` that merges) commits without conflicts, it runs pre-merge-commit
  instead, and there was none, so those merge commits got no lint, type check or tests. Two
  branches that each pass can merge into code that does not compile (tried in a scratch clone: one
  branch renamed a constant, the other started using the old name), and every wave merges five
  parallel branches.
- Decision: `.husky/pre-merge-commit` runs `.husky/pre-commit`, so a merge commit gets the same
  lint-staged run on what the merge brings in. When a check fails, git stops with "Not committing
  merge" and leaves the merge in progress with its changes staged: fix it and `git commit`, or
  `git merge --abort`. Unrelated unstaged changes and untracked files are set aside and restored as
  for any commit (checked by hand). `git-hooks.test.ts` installs the hooks with the real husky in
  a scratch repository and runs `git merge` with a passing and a failing check.
- Trade-offs: merges that git commits itself now take as long as other commits; a merge that
  brings in a lockfile change runs every test (about 16 seconds). Fast-forward merges and rebases
  make no merge commit and run no hook; their commits were checked when they were made, unless
  someone skipped the hooks. `git merge --no-verify` skips the hook, like `git commit --no-verify`.
