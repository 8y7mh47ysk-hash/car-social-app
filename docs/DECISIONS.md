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
  pnpm runs recursive scripts in dependency order. (Next.js needs no `transpilePackages` to read
  the source: corrected in round 2 of the wave w0 review, see "Next.js compiles @apex/shared
  without transpilePackages".)
- Trade-offs: the production API needs packages/shared built and the `--conditions` flag (future
  Dockerfiles must pass it, and since the wave w0 review `--no-strip-types` too, or run the API's
  `start` script). Without packages/shared built, the start fails with
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
  from instruction 10. (The `transpilePackages` entry was removed in round 2 of the wave w0
  review: see "Next.js compiles @apex/shared without transpilePackages".)
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
  (`--no-verify`, `HUSKY=0`), so CI remains the gate that cannot be bypassed. (Corrected in the
  wave w0 review: CI runs on every push and pull request, but it does not check commit messages,
  see "CI does not check commit messages", and on GitHub Free a private repository cannot require
  it to pass before a merge, see the owner actions of instruction 5 in BUILD_LOG.md.)

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
  switching stays small: the image, `valkey-server` as the first word of the command (Valkey's
  entrypoint drops root privileges only for that name) and the tests that pin both, plus a test
  run. (Corrected in the wave w0 round-2 review, which ran Valkey on a real engine: this said "a
  one-line image change", but then the server ran as root.) Redis's default `maxmemory-policy` of
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
- Superseded by: Redis reads its password from a config file that Compose writes

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
- Superseded by: The Redis health check reads the password from Redis's config file

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
- Superseded by: Web env: the server schema stays out of browser code, server values are read on use

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
- Superseded by: Ignore env files named like postgres.env, and direnv's .envrc, too

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
  `ubuntu-26.04` fixes the Ubuntu release, not the software: GitHub updates the image weekly
  (Node.js 24, Docker, Compose), so a Compose release that prints a new warning would fail the
  Compose step until the file or the step is fixed. actionlint 1.7.12,
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
- Trade-offs: CI does not fail on plain text that code logs while Next.js prerenders a page, with
  `console.warn`, `console.log` or `console.error` (only a logged `Error` object prints
  "Error:"), which Next.js prints as the bare message (tested), and the few Next.js warnings
  written the same way (most are for features this app does not use, such as the Pages Router,
  i18n and the edge runtime); console output or Node.js warnings printed while tests, lint or the
  type check pass (no signal that works across tools; tests should assert on the logs they
  expect); pnpm's deprecation notices, which appear only when the lockfile is resolved, never
  during CI's frozen install (the ESLint 9 one is expected, see the ESLint pin); and warnings that
  GitHub shows about the runner or the actions, which a step cannot read. (This list was a field
  of its own, "Not enforced", until the wave w0 round-2 integration moved it here unchanged, to
  match the entry form.) The build-log check matches the formats of Next.js 16.4, Node.js 24 and
  pnpm 12; a warning worded differently would slip through, so re-check after major upgrades by
  provoking one (docs/BUILD_LOG.md, instruction 5, shows how). A line that merely contains
  "Warning:" or "Error:" fails the build, which errs on the safe side; a clean build prints neither.
  A check that fails on anything a package writes to stderr was considered. pnpm's ndjson reporter
  reports each line as JSON with the stream it came from, the environment variable
  `pnpm_config_reporter=ndjson` reaches the `pnpm --recursive build` inside `pnpm build` (tested in
  a scratch workspace), and a clean build of this repository writes nothing to stderr (tested). It
  would also catch the bare `console.warn` above, but the Build step's log would then be JSON unless
  a script reformatted it, and the check would depend on pnpm's internal log format, which pnpm does
  not document. Revisit it if such warnings start to matter.

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
- Superseded by: Render-check the Mermaid diagrams with pnpm dlx, not npx

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

### Request IDs: a validated x-request-id or a new UUID, sent back in the response

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
  needs its own keys). Some responses still go out without the header, all sent before any hook
  can run: the 400, 431 and 408 that Fastify writes straight to the connection for a request
  Node.js could not read (bytes that are not HTTP, headers over 16 KB, headers too slow), the 503
  Fastify sends for a request that arrives on an open connection during shutdown (its log line
  has the ID), and the 400 and 417 that Node.js sends itself, without calling Fastify or logging
  anything, for an HTTP/1.1 request without a Host header and for an Expect header other than
  100-continue. (Corrected in round 2 of the wave w0 review: the title said "on every
  response", and this list said Fastify sent them all.)

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
  logger exists), so code cannot log around this path with it. (Corrected in round 2 of the wave
  w0 review. This said every line takes this path, but writing to `process.stdout` or
  `process.stderr` directly would not, and no rule catches that.)
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

### Docker Engine 28 or later on Linux hosts

- Date: 2026-10-11 · Instruction: #3 · Author: Alpha
- Context: `docker-compose.yml` publishes PostgreSQL and Redis on 127.0.0.1 only, so that other
  machines cannot reach them. Docker's port-publishing documentation warns that before Docker
  Engine 28.0.0, hosts on the same network segment can reach ports published to 127.0.0.1 on a
  Linux host. The build only required Engine 25 (for `start_interval`), which allows Debian 13's
  own `docker.io` package (26.1). Docker Desktop and OrbStack run the engine in a virtual machine
  on the Mac and forward published ports from the Mac's own loopback address.
- Decision: on Linux, Docker Engine 28 or later, from Docker's own packages. `README.md`,
  `infra/README.md` and the compose file say so. In the review's VM (Engine 29.9.0) the VM's own
  network address was refused on both ports; the routing case that the documentation describes
  was not tested.
- Trade-offs: distribution packages can be too old, so the home server (Phase 7) gets Docker
  from Docker's own repository and is updated from there. Firewall rules of our own were
  rejected: a newer engine fixes the cause, and instruction 103 removes the published ports on
  the server anyway. Nothing checks the version yet; `scripts/check-docker.ts` (instruction 7)
  could refuse an older engine on Linux (since the round-1 integration it does: see "The docker
  scripts refuse Docker Engine before 28 on Linux").

### A fixed Compose project name: apex-garage

- Date: 2026-10-11 · Instruction: #3 · Author: Alpha
- Context: Compose names containers, networks and volumes after the project, which defaults to
  the name of the folder. Instruction 3 set `name: apex-garage` in `docker-compose.yml` without
  recording why. In the review, a second checkout on the same machine that changed only the
  ports took over the first checkout's containers and volumes.
- Decision: keep the fixed name, so the data volumes keep their names whatever the folder is
  called (a renamed or re-cloned folder would otherwise start with empty volumes, while the old
  data sat under the old names). A second copy on one machine sets its own `COMPOSE_PROJECT_NAME`
  and ports in its `.env`; `.env.example`, `infra/README.md` and `docs/ARCHITECTURE.md` say so.
- Trade-offs: copies on one machine share one set of containers unless each sets the variable,
  which is easy to miss. The folder-name default would separate them automatically but would
  tie the data to the folder's name, which is the worse surprise on the home server.

### parseEnv never passes on an error thrown inside a check

- Date: 2026-10-11 · Instruction: #4 · Author: Bravo
- Context: found in the wave w0 review of "Typed environment loader: one Zod helper in
  packages/shared, one schema per app". Zod turns failed checks into issues, but an error thrown
  inside a check or a transform passes straight through `safeParse`, and the API's entrypoint
  rethrew it. Such errors can carry the value: `JSON.parse` and `BigInt` quote it in their
  messages, and Node.js prints a URL error's `input` property when the process crashes. An env
  schema that parsed JSON or a URL would have printed a secret after a typo.
- Decision: `parseEnv` catches anything thrown while the schema runs and drops it. It then checks
  the variables one at a time, names each one whose own schema throws ("its check threw an
  error, which is not shown because it may contain the value"), or "(environment)" if only a
  rule about several variables throws, and still reports every other problem in the same error.
- Trade-offs: the thrown error's message and stack are lost, also when the cause is a plain bug
  in a schema; reproduce it in a unit test of that schema. The one-at-a-time pass runs only after
  something has thrown, so a normal start costs nothing extra.

### Web env: the server schema stays out of browser code, server values are read on use

- Date: 2026-10-11 · Instruction: #4 · Author: Bravo
- Context: replaces "Web env: server-only and NEXT_PUBLIC_ variables apart, checked per Next.js
  phase". Builds with temporary variables (Next.js 16.4) showed three faults in the wave w0
  review. `public.ts` imported `schema.ts`, which also built the server schema, so a Client
  Component that used `publicEnv` sent every server variable's name, rules and defaults (an
  internal URL, for example) to the browser. `serverEnv` was parsed when its module loaded, and
  `next build` loads every route's modules while it collects page data, so once any route
  imported it, even one rendered only on request, a build without the server's secrets failed,
  although that entry said such a build succeeds. And `validateWebEnv` merged the two schemas'
  shapes, which drops a rule on a whole schema, so `next start` could start with values that the
  app then rejected.
- Decision: the rest of the design stands: two groups, `server-only` on `server.ts`, public
  variables read by their literal names, and checks per phase in `next.config.ts`.
  `public-schema.ts` (with the shared error wording) is the only env module that browser code
  loads; `server-schema.ts` holds the server schema; `validate.ts` (formerly `schema.ts`) holds
  `validateWebEnv`, which now checks each group with its own schema and reports both groups'
  problems in one error. `server.ts` exports `getServerEnv()`, which validates `process.env` each
  time it is called. Tests fail if `public.ts` brings the server schema into browser code, if
  `server.ts` reads a variable when it loads, if a rule about several variables is skipped, or if
  `next.config.ts` stops running the check.
- Trade-offs: three small modules instead of one. `server-schema.ts` cannot import `server-only`,
  because `next.config.ts` loads it outside React Server Components, so only a comment keeps
  other browser code from importing it; the test covers what `public.ts` loads. `getServerEnv()`
  validates again on every call (microseconds for a few variables) rather than caching, so there
  is no stale copy to reset. A request that reads a missing variable fails, but `next dev` and
  `next start` refuse to start without it in the first place; a page prerendered by `next build`
  that calls it still needs the variable at build time.

### Ignore env files named like postgres.env, and direnv's .envrc, too

- Date: 2026-10-11 · Instruction: #4 · Author: Bravo
- Context: replaces "Every .env file is ignored, and a test asks git to prove it", which kept the
  rules `.env`, `.env.*` and `!.env.example` and said that every env file is ignored. Files for
  `docker run --env-file` and Compose's `env_file:` are usually named like `postgres.env`, and
  direnv reads `.envrc`; both usually hold secrets, and neither was ignored.
- Decision: `.gitignore` also ignores `*.env` and `.envrc`, listed before `.env` so that the
  older rules still decide for their own names. `env-files.test.ts` asks git about 22 env-file
  names (five more) and the three templates, and fails if a file with any of these names other
  than a template is committed. Defaults still live in the Zod schemas, and only the
  `.env.example` templates are committed.
- Trade-offs: no committed file can end in `.env`, and sharing a direnv `.envrc` would need a
  negation rule. The test needs `git`, which every checkout and CI runner has.

### The env lint rule also bans importing process

- Date: 2026-10-11 · Instruction: #4 · Author: Bravo
- Context: "Typed environment loader: one Zod helper in packages/shared, one schema per app"
  enforces "only the env modules read `process.env`" with `no-restricted-properties`, and lists
  `import { env } from "node:process"` as a route it misses. The wave w0 review found that
  `pnpm lint` also accepted a namespace import, a default import under another name,
  `globalThis.process` and `global.process`.
- Decision: in `apps/*/src` and `packages/*/src`, outside the env modules, ESLint also rejects
  importing `process` or `node:process` (`no-restricted-imports`) and reaching `process` through
  `globalThis` or `global`; `process` is a global, so no code needs either. `env-access.test.ts`
  asks ESLint which rules the repository's config gives such files and the env modules, and runs
  them on every route. `eslint.config.mjs` joins the pre-commit hook's rerun triggers, following
  "Files that tests read from disk also make the pre-commit hook run every test".
- Trade-offs: code in those folders cannot import `process` for other uses either; the global
  works the same. Config files, scripts and root-level tests are still not covered, and
  `Reflect.get(process, "env")` still passes: the rule guards against mistakes, not intent.

### docker:down removes the containers of every Compose profile

- Date: 2026-10-11 · Instruction: #7 · Author: Charlie
- Context: `docker:down` ran a plain `docker compose down`, which handles only the services outside
  a profile. Compose 5.1.3's `down` removes the containers of the active services, does not count
  the services of other profiles as orphans, and then removes the project's network; Docker's
  profiles documentation says the same. After `docker compose --profile app up`, it left both
  exited placeholders behind, attached to a network that no longer existed, and the next
  `docker compose --profile app up` failed with "network ... not found" (seen in a Linux VM by the
  wave w0 review of instruction 3).
- Decision: `docker:down` runs `docker compose --profile '*' down`. With every profile active,
  Compose removes every container of the project and then its network; the data volumes stay, as
  before. `docker:up` and `docker:logs` keep no profile, so `docker:up` still starts only
  PostgreSQL and Redis. The asterisk is quoted, so the shell passes it to Compose as it is.
- Trade-offs: a service that a later instruction puts in a profile of its own is also removed by
  `docker:down`, which is what "down" should mean for this project's local services. Compose has
  understood `*` as "every profile" since version 2.0.

### CI does not check commit messages

- Date: 2026-10-11 · Instruction: #5 · Author: Charlie
- Context: commitlint runs only in the commit-msg hook (instruction 2). Hooks can be skipped
  (`--no-verify`, `HUSKY=0`), GitHub's web editor runs none, and a squash merge on GitHub uses
  whatever message its merge dialog holds (by default, for two or more commits, the pull request's
  title). The README still said that CI "runs the full checks either way".
- Decision: CI keeps to the checks that instruction 5 lists and does not run commitlint. The
  README now says that only the commit-msg hook checks commit messages.
- Trade-offs: a message that skipped the hook reaches `main` unchecked. Checking messages in CI
  would need the pull request's commits (the checkout fetches only the commit under test),
  separate rules for pushes to `main` and for squash-merge titles, and a root script for
  commitlint. Every commit the team makes goes through the hook, so this waits until unchecked
  messages start to appear.

### Render-check the Mermaid diagrams with pnpm dlx, not npx

- Date: 2026-10-11 · Instruction: #6 · Author: Delta (wave w0 review)
- Context: "Check Mermaid diagrams with mermaid-cli outside the repository" gave the next editor
  an `npx --yes` command. npx installs the newest version that each range in the tool's tree
  allows, however new, and runs every install script. When the review ran it, it installed 204
  packages, five of them published less than a day before (mermaid 12.2.0 and two `@tanstack`
  packages only hours before, dompurify and zod): exactly what the repository's one-day
  `minimumReleaseAge` keeps out (see "Latest stable versions, held back one day by pnpm").
- Decision: ARCHITECTURE.md and the build log give
  `pnpm dlx --allow-build=puppeteer @mermaid-js/mermaid-cli@12.0.0 -i docs/ARCHITECTURE.md -o ...`.
  pnpm applies its one-day hold to the temporary install (it took mermaid 12.1.0 and the previous
  release of each of the other four) and runs no install script except Puppeteer's, which
  downloads the headless Chrome. The rest of the earlier decision stands: no repository
  dependency and no CI job.
- Trade-offs: the check needs pnpm, which the repository needs anyway. Only mermaid-cli's own
  version is pinned, so a release more than a day old can still change the tree; pinning all of
  it would need a lockfile in the repository for one manual check.

### The API entrypoint logs crashes through the logger, then exits

- Date: 2026-10-11 · Instruction: #8 · Author: Delta (wave w0 review)
- Context: Node.js prints an uncaught exception, or a promise rejection that nothing handles, as
  plain text on stderr and exits with code 1. That report is not JSON, has no request ID and
  skips the redaction of "Redact every log line after serialisation, in pino's streamWrite hook":
  a connection URL's password appears in full.
- Decision: `apps/api/src/server.ts` handles `uncaughtException`, which Node.js also emits for an
  unhandled rejection (its default `--unhandled-rejections=throw`). The handler logs
  `{ err, origin }` at fatal level through `app.log`, then calls `process.exit(1)`. It runs in
  the failing code's async context, so the line carries the ID of the request whose code failed;
  the entrypoint tests check this with a timer, left behind by a route, that throws or leaves a
  rejection unhandled. It is installed once the app is built; earlier failures, such as invalid
  settings, keep their own messages.
- Trade-offs: `uncaughtExceptionMonitor` would log without taking over, but Node.js would still
  print its unredacted report. Exiting at once, without closing the server, follows Node.js's
  advice that the process is in an unknown state; requests in flight are cut off, as they were
  before. With `LOG_LEVEL=silent` a crash writes nothing. Errors inside requests stay with
  Fastify and instruction 27's error handler; this covers what escapes them.

### Redaction also matches the credential headers the plan will receive

- Date: 2026-10-11 · Instruction: #8 · Author: Delta (wave w0 review)
- Context: "Redact every log line after serialisation, in pino's streamWrite hook" decides by key
  name. Header names come from other parties, and several that the plan will receive were not
  matched: Cloudflare Access's `cf-access-jwt-assertion` (#190), Meta's `x-hub-signature-256`
  (#150; `stripe-signature` was matched) and Node.js's `rawHeaders` list, which holds names and
  values side by side, so no value can be matched to its name. Nor were `pass`, `pwd`, the PKCE
  `code_verifier` of OAuth sign-in (#43) or a `_csrf` field.
- Decision: a key is also sensitive when, lowercased and without separators, it contains
  `codeverifier`, ends in `signature` followed by digits, `assertion` or `csrf`, or is exactly
  `pass`, `pwd` or `rawheaders`. Tests cover each pattern and names that must stay visible.
- Trade-offs: a harmless field whose name ends like this is hidden too (`testAssertion`). `pass`
  and `pwd` match only as whole names, so `passenger` (journeys, #135) and `cacheBypass` stay
  visible, but so does a name such as `smtpPass`: call such fields `smtpPassword`.

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
  next/dist/lib/typescript/runTypeCheck.js says so). (Corrected in round 2 of the wave w0 review:
  that filter belongs to Next.js's TypeScript API checker, which 16.4 no longer uses by default,
  so `pnpm build` still failed on the stale copy; see "next build type-checks with
  tsconfig.typecheck.json".)
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

### A commit that finishes a merge checks everything the merge brings in

- Date: 2026-10-11 · Instruction: #2 · Author: Integrator (wave w0, round 1)
- Context: "Merge commits that git makes run the pre-commit checks" leaves a merge whose checks
  fail in progress, to be finished with `git commit`, which also finishes a merge that stopped
  with conflicts. git runs pre-commit for that commit while `MERGE_HEAD` exists, and lint-staged
  17.6 then keeps only the staged files that also differ from `MERGE_HEAD`, in effect the files
  that both sides changed (`lib/getStagedFiles.js`; its README does not mention this). Found while
  integrating round 1: after a failed pre-merge-commit check, `git commit` ran no check at all and
  made the merge commit; after a conflict, only the conflicted files were checked, so the type
  check and the related tests ran only if a conflicted file called for them.
- Decision: while `MERGE_HEAD` exists, `.husky/pre-commit` adds `--diff=--staged --stash` to the
  lint-staged command. With `--diff`, lint-staged skips that filter and takes the files from
  `git diff --staged`, the same list as for any other commit. `--diff` also turns the backup stash
  off, and `--hide-all` needs it to set unstaged changes and untracked files aside and to restore
  everything after a failed check, so `--stash` turns it back on. Two tests in
  `git-hooks.test.ts` finish a merge with `git commit`: after a failed pre-merge-commit check (a
  check that still fails stops it again, with an unrelated edit and a new file set aside and
  restored and the merge still in progress) and after a conflict (the file that only the merged
  branch changed is checked too).
- Trade-offs: this relies on how lint-staged handles `--diff`, which its README documents only as
  replacing `--staged`; the tests fail if a later version changes that. The commit that finishes a
  merge checks everything the merge brings in again, which takes as long as the pre-merge-commit
  run did. During a merge, lint-staged's progress lines say "changed files" instead of "staged
  files". Passing the two flags on every commit would save the `if`, but would move every commit
  onto the `--diff` path, which lint-staged's README offers for comparing branches, for example in
  CI; ordinary commits keep its default path.

### The type check finishes every package's check when one fails

- Date: 2026-10-11 · Instruction: #1, #2 · Author: Integrator (wave w0, round 1)
- Context: the root `typecheck` script ran `pnpm --recursive typecheck`, which stops the other
  packages' checks with SIGKILL as soon as one fails. The pre-commit hook and CI both run
  `pnpm typecheck`, so they showed one package's errors followed by "Command failed with signal
  SIGKILL" for the rest (reported by Echo in the wave w0 review; checked with type errors in the
  API and the web app).
- Decision: `tsc --project tsconfig.json && pnpm --recursive --no-bail typecheck`. Every package's
  check runs to the end, and the script still fails when any of them fails ("failed in 2
  packages"). `typecheck.test.ts` runs the script on a stand-in workspace whose two packages fail.
- Trade-offs: a failing type check takes as long as a passing one. A type error in the root files
  still stops the script before the packages are checked; running both whatever happens would
  need a shell construct that keeps both exit codes, which the root's few files do not justify.

### The docker scripts refuse Docker Engine before 28 on Linux

- Date: 2026-10-11 · Instruction: #3, #7 · Author: Integrator (wave w0, round 1)
- Context: "Docker Engine 28 or later on Linux hosts" asks for Engine 28 on Linux, because before
  28.0.0 hosts on the same network segment can reach ports published on 127.0.0.1 (Docker's
  port-publishing documentation, moby/moby#45610), and noted that nothing checked it. Debian 13's
  own `docker.io` package is 26.1, so a Linux machine set up the obvious way would expose
  PostgreSQL and Redis to its local network.
- Decision: `scripts/check-docker.ts`, which every `docker:*` script runs first, reads the
  engine's version from `docker version --format {{.Server.Version}}`, the call it already made
  to see whether the engine runs. On Linux only, it stops with an explanation and a link to
  Docker's install guide when the major version is below 28. On macOS, Docker Desktop and
  OrbStack run the engine in a virtual machine and publish ports on the Mac's own loopback
  address, so the version is not checked. Tests cover old, new and unreadable versions on both
  systems and the command runner's capture of the output.
- Trade-offs: a version that does not start with a release number (a development build, or a
  client that prints nothing) is let through: the check is meant for old distribution packages,
  not to block unusual set-ups. An engine other than Docker's that reports its own version number,
  below 28, would be refused; the documentation asks for Docker Engine. Plain `docker compose`
  commands are not checked; infra/README.md gives the minimum.

### Redis's memory warning on Linux is fixed on the host, not in the compose file

- Date: 2026-10-11 · Instruction: #3 · Author: Integrator (wave w0, round 1)
- Context: in the wave w0 review's Debian 13 VM (Docker Engine 29.9.0), Redis 8.10.2 logged
  "WARNING Memory overcommit must be enabled!" as it started (reported by Charlie). With the
  kernel's default `vm.overcommit_memory = 0`, the child process that writes a snapshot or
  rewrites the append-only file can fail to start when memory is short, and Redis's default
  `stop-writes-on-bgsave-error yes` then refuses writes until a snapshot succeeds. A container
  cannot change this kernel setting.
- Decision: no change to `docker-compose.yml`. infra/README.md explains the warning and how to
  set `vm.overcommit_memory = 1` on a Linux host (a file in `/etc/sysctl.d/` and `sysctl -w`), as
  Redis's own message advises, and says that the home server must have it (host hardening, #105).
- Trade-offs: the setting is host-wide: the kernel then grants every allocation, and running out
  of memory is handled by its out-of-memory killer instead of a failed allocation. Rejected for
  now: turning snapshots off (`--save ""`), which removes the forks that can stop writes but
  changes how Redis keeps its data, a choice for instruction 3's owner to weigh with the queues
  and sessions that will use Redis (#37, #40); and turning `stop-writes-on-bgsave-error` off,
  which would let Redis keep accepting writes it can no longer save, unnoticed.

### The pre-commit type check may install dependencies first

- Date: 2026-10-11 · Instruction: #2 · Author: Integrator (wave w0, round 1)
- Context: pnpm 12's `verifyDepsBeforeRun` defaults to `install`: `pnpm run` installs first when
  `node_modules` is out of date. The hook's type check runs `pnpm typecheck`, so a commit that
  stages a `package.json` whose dependencies no longer match the lockfile (edited without running
  `pnpm install`) makes pnpm install, run the `prepare` script again and rewrite
  `pnpm-lock.yaml` while the hook runs, and lint-staged then adds the rewritten lockfile to the
  commit like a fixer's change. Checked in a scratch clone: with only `package.json` staged after
  a range change, the commit held both files. Charlie raised the question in the wave w0 review
  without testing it. A merge that brings in new dependencies gets them installed the same way
  before its type check, which would otherwise fail on the missing packages.
- Decision: keep pnpm's default. The README section "Git hooks" says that the type check may
  install first and that the updated lockfile then becomes part of the commit.
- Trade-offs: a commit can download packages and change `node_modules`, and the lockfile change
  joins the commit without being staged (the commit's summary lists it). The install keeps
  pnpm's safeguards (the one-day release-age hold, `allowBuilds`). Rejected: `error` for the
  hook's type check (`pnpm --config.verify-deps-before-run=error typecheck`, tried in scratch
  clones). It stops the commit that stages only `package.json` ("a modified manifest is no longer
  satisfied by the lockfile"), but also every merge that brings in a new dependency ("the
  installed dependencies are not up to date with the lockfile"), and it would stop the first
  commit after a pull that brings one in, until someone runs `pnpm install`. `warn` would let
  the stale lockfile through to CI, whose frozen install then fails.

### CI starts the production build and checks that both apps answer

- Date: 2026-10-11 · Instruction: #5 · Author: Integrator (wave w0, round 1)
- Context: CI built both apps but started neither (Echo's hand-off from the review of instruction
  1). `apps/api/src/production.test.ts` starts a copy of the compiled API, but nothing ran
  `next start`, which is where the web app checks its server-only environment variables (#4), so
  once the web app needs one, a production start without it would fail only in production. Echo
  suggested a smoke step after the build; Playwright tests (#68) and container images (#102)
  come much later.
- Decision: a CI step after the build-warning check, "Start the production build", runs
  `node scripts/check-start.ts`. It starts the apps with the `pnpm start` that developers run, on
  free ports of 127.0.0.1 (`WEB_HOST`, `WEB_PORT`, `API_HOST`, `API_PORT`) and in a process group
  of its own; requires GET /health to answer `{"status":"ok"}` (checked with Zod) and the home
  page to be a 200 HTML page within a minute; then sends SIGTERM to the group and fails if the
  apps have not stopped ten seconds later. The README's pre-push commands include it.
- Trade-offs: a few seconds of CI time. It shows only that the apps start and answer, not what
  they serve; #68's Playwright tests cover pages and flows. Nor does it show that each app shuts
  down cleanly, as this entry first said (corrected in the wave w0 round 2 review): pnpm 12
  passes SIGTERM on to both apps but kills the other one with SIGKILL as soon as one has ended,
  so the step fails only if neither stops, and an API that ignored SIGTERM passed. The API's own
  tests check its shutdown. Once the web app has a required server variable (Phase 2), this step
  needs a throwaway value for it, as the Compose step has for the passwords. The time limits are
  generous, so a slow runner does not fail it.

### The env lint rules also ban import() of process; process passed as a value is left to review

- Date: 2026-10-11 · Instruction: #4 · Author: Alpha (wave w0 review, round 2)
- Context: found in the round-2 review of "The env lint rule also bans importing process".
  `no-restricted-imports` does not check `import()`, so `await import("node:process")` and
  `await import("process")` reached `process.env` in `apps/*/src` and `packages/*/src` without a
  lint error, and so did an alias (`const proc = process`). The config's comment said that
  banning imports closed the routes that the property rule cannot see, and that entry named only
  `Reflect.get(process, "env")` as a route that still passes.
- Decision: a `no-restricted-syntax` rule rejects `import()` of `process` or `node:process`,
  written as a string or a template literal. `banImports()` in `eslint.config.mjs` builds both
  rules from one list of patterns, so the static and the `import()` bans stay in step.
  `env-access.test.ts` checks the three new routes in each folder, and that `import()` of other
  modules still passes. The config's comment now names the routes that remain.
- Trade-offs: code that passes `process` around as a value still gets through: an alias,
  `Reflect.get(process, "env")`, `process[name]`, `createRequire(import.meta.url)("process")`,
  and an `import()` whose source is computed. Each takes intent rather than a slip, and review
  catches it. Selectors see syntax, not scopes: a ban on the bare name `process` would also hit a
  local variable of that name, and listing every allowed use (`process.exitCode`,
  `typeof process`, a property named `process`) makes a long, fragile selector. A rule of our own
  with scope analysis would be exact, but it is code to maintain for routes nobody takes by
  accident.

### Web env: ESLint keeps browser code from importing the server schema

- Date: 2026-10-11 · Instruction: #4 · Author: Alpha (wave w0 review, round 2)
- Context: found in the round-2 review. "Web env: the server schema stays out of browser code,
  server values are read on use" relied on a comment and `public.test.ts` to keep browser code
  from loading `server-schema.ts`, but that test covers only the modules that `public.ts` loads.
  A Client Component that imported `server-schema.ts` directly passed lint and the tests, and
  `next build` put the schema's variable names and rules into `.next/static`.
- Decision: in `apps/web/src`, ESLint rejects importing `server-schema` or `validate` (which
  imports it) through an `env` folder, such as `../../env/server-schema`, with or without an
  extension, as an import, a re-export or an `import()`. The env modules' own imports
  (`./server-schema`) still pass, and `public.test.ts` still checks the modules that browser code
  loads; `next.config.ts`, outside `src`, imports `validate.ts`. A later config block replaces a
  rule that an earlier block sets for the same files, so this block repeats the ban on importing
  `process` (`banImports`). `env-access.test.ts` checks each route and the allowed imports.
- Trade-offs: the rule matches import paths, not modules. A new module inside `src/env` that
  browser code loads needs a check like `public.test.ts`'s; a module elsewhere that re-exports
  the schema has to import it through an env folder, which the rule rejects. A server-only module
  that has to run the check (an `instrumentation.ts`, if instruction 102 needs one) goes in the
  block's `ignores`. `server-schema.ts` still cannot import `server-only`, because
  `next.config.ts` loads it outside React Server Components.

### A staged env file makes the pre-commit hook run every test

- Date: 2026-10-11 · Instruction: #2, #4 · Author: Alpha (wave w0 review, round 2)
- Context: found in the round-2 review. `env-files.test.ts` fails when git tracks an env file,
  but the pre-commit hook's `vitest related` picks tests by their imports, so a commit of
  `apps/api/.env` staged with `git add --force` ran no tests and went through. Only a later
  `pnpm test`, or CI after a push, failed, once the file was in the history.
- Decision: env files (`.env`, `.env.*`, `*.env` and `.envrc`, in any folder) join the root
  `forceRerunTriggers`, as in "Files that tests read from disk also make the pre-commit hook run
  every test": staging one runs every test, and `env-files.test.ts` stops the commit.
  `git-hooks.test.ts` checks four such names.
- Trade-offs: such a commit fails only after the whole suite has run (about 20 seconds). A
  lint-staged task that rejects env files at once would fail faster, but would be another list
  of env-file names to keep in step with `.gitignore` and the test. In watch mode, saving an env
  file reruns every test. `git commit --no-verify` still skips the hook, and CI still runs the
  test.

### The start check stops the apps when it is interrupted

- Date: 2026-10-11 · Instruction: #5 · Author: Bravo (wave w0, round 2)
- Context: `scripts/check-start.ts` starts `pnpm start` in a process group of its own, so that its
  stop signals reach the apps but not the check itself, and it stopped that group only on its
  normal path. Ctrl+C, `kill` and a closed terminal reach only the check, so they ended it at once
  and left pnpm, both apps and pnpm's helpers running: 9 processes each time (w0.V1.Echo.2). Tests
  that failed or timed out left their stand-in apps running the same way.
- Decision: as a program, the check handles SIGINT, SIGTERM and SIGHUP. It stops waiting
  (`checkStart` takes an `AbortSignal`), stops the apps as on its normal path, prints
  "Interrupted by <signal>: stopped the apps." and then ends by the same signal, so that a shell
  or script that runs it sees an interrupted command (status 130 after Ctrl+C) and stops too.
  Each test stand-in writes its process ID, which the test's clean-up kills however the test
  ends, and ends by itself once the test runner has gone. On macOS and in an Ubuntu 26.04 VM, no
  process was left after an interrupt at any moment of the check, after tests that timed out, or
  after the whole test run was killed.
- Trade-offs: SIGKILL, which no program can handle, still leaves the apps running, as does
  Ctrl+\ (SIGQUIT); CI's runner removes leftover processes when a job ends. A command in the
  check's own process group would get a terminal's Ctrl+C directly, but `kill` and `timeout`,
  which signal only the check, would still leave it behind, and the check could no longer stop
  the apps without stopping itself. A second Ctrl+C does not cut the stop short; with the real
  apps it takes well under a second, and never more than twenty seconds (ten after SIGTERM, ten
  after SIGKILL).

### Workspace copies in tests use the checkout's pnpm store

- Date: 2026-10-11 · Instruction: #1, #5 · Author: Bravo (wave w0, round 2)
- Context: `workspace.test.ts` installs copies of the workspace offline from pnpm's store, in
  temporary folders. pnpm keeps one store per file system. On Ubuntu 26.04, the release of CI's
  runner, /tmp is a tmpfs, so for a copy there pnpm used the empty /tmp/.pnpm-store and the
  install failed with `ERR_PNPM_NO_OFFLINE_TARBALL`. A simulation of every CI step in an Ubuntu
  26.04 VM failed its Test step on this test alone; on macOS the temporary folders are on the same
  volume as the store.
- Decision: the test asks `pnpm store path` in the checkout once and passes that store to every
  install of a copy (`--config.store-dir`); `--frozen-store` still keeps them from writing to it.
- Trade-offs: one more pnpm command per run of the file, about 0.05 s. Rejected: copying the
  workspace into the checkout instead, onto its file system, which would put temporary folders
  inside the repository; and `TMPDIR` set to the runner's temporary folder in CI, which would
  keep the failure for anyone whose /tmp is a tmpfs, such as a developer on Ubuntu 26.04.

### Only a pino-pretty that cannot be found counts as not installed

- Date: 2026-10-11 · Instruction: #8 · Author: Charlie (wave w0 review, round 2)
- Context: `LOG_FORMAT=pretty` without pino-pretty, as in a production install, must stop the API
  with one line that says to use JSON (round 1 of the review). That fix turned every failure to
  load pino-pretty into this advice and dropped the cause, so a broken install (one of
  pino-pretty's own dependencies missing, an invalid package.json) printed the wrong advice and
  nothing else.
- Decision: `importPinoPretty` in `apps/api/src/lib/logger.ts` first asks Node.js to resolve
  pino-pretty with `import.meta.resolve`. Only `ERR_MODULE_NOT_FOUND` there means it is not
  installed and becomes `LogFormatUnavailableError`, whose message the entrypoint prints. Any other
  failure, in resolving or in loading it, is thrown unchanged, and Node.js prints it with its
  stack and exits with code 1. Entrypoint tests simulate each case with a module resolve hook.
- Trade-offs: one extra lookup at startup, and only with `LOG_FORMAT=pretty`. Matching the text of
  the import's error ("Cannot find package 'pino-pretty'") was rejected: the wording is Node.js's,
  not an interface, and a missing dependency of pino-pretty fails with a similar message. Vitest
  cannot make `import.meta.resolve` fail, so the not-installed message is tested only through the
  entrypoint (`server.test.ts`), which the pre-commit hook does not run for a change to
  `logger.ts`; CI runs every test.

### The router's rejection lines leave the URL out

- Date: 2026-10-11 · Instruction: #8 · Author: Charlie (wave w0 review, round 2)
- Context: Fastify logs a URL that its router rejects (400 `FST_ERR_BAD_URL`, 414
  `FST_ERR_MAX_PARAM_LENGTH`) with the raw path in the message, in `err.message` and in
  `err.stack`, each cut only at 8192 characters. A malformed 16 KB URL wrote a 24,940-byte line,
  where the same URL as a 404 wrote under 900 bytes in all: a malformed URL got around the
  256-character cap of "Request lines hold method, shortened path and client address, never the
  query string".
- Decision: `ApiLogController` in `apps/api/src/lib/logger.ts`, which already logs a 404 as "route
  not found", overrides `defaultErrorLog` for those two codes: one info line with `res`,
  `err: { type, code }` and the message "malformed URL" or "route parameter too long", under the
  request ID. Every other error is logged by Fastify's own `defaultErrorLog`.
- Trade-offs: the line no longer holds the error's message and stack, but the stack only ever
  shows Fastify's router, and the "incoming request" line with the same ID holds the shortened
  URL. The response body still repeats the path, as Fastify writes it, until #27 gives these
  responses its format in `sendFrameworkError`. Other client errors keep Fastify's lines, whose
  messages do not repeat client input at length (an unknown 15,000-character content type gave a
  1,835-byte line); #27 decides how errors are logged.

### next build type-checks with tsconfig.typecheck.json

- Date: 2026-10-11 · Instruction: #1 · Author: Delta (wave w0 review, round 2)
- Context: "The web type check leaves out next dev's copy of the route types" made
  `pnpm typecheck` skip `.next/dev`, on the belief that `next build` already did. Next.js 16.4
  type-checks a build with the TypeScript CLI by default (`experimental.useTypeScriptCli`), which
  runs `tsc --project <tsconfig> --noEmit` on everything the tsconfig includes; the filter in
  runTypeCheck.js belongs to the older TypeScript API checker. Reported as w0.V1.Bravo.1 and
  reproduced in a fresh clone: after a route served by `next dev` was deleted, `pnpm typecheck`
  passed and `pnpm build` failed (TS2307 and TS2344 in `.next/dev/types/validator.ts`).
- Decision: `typescript: { tsconfigPath: "tsconfig.typecheck.json" }` in apps/web/next.config.ts,
  so that `next build` and `pnpm typecheck` check the same files. `next-config-settings.test.ts`
  checks that the setting names the file that the `typecheck` script uses, and
  `typecheck.test.ts` checks that file on a copy of the app with a stale dev validator.
- Trade-offs: Next.js also reads that file for module resolution, which is unchanged because it
  extends tsconfig.json, and it never rewrites a tsconfig that extends another
  (writeConfigurationDefaults), so neither file changes when Next.js runs. Editors still read
  tsconfig.json. The test pins the setting instead of running `next build`, which takes most of a
  minute on a shared machine; the round-2 note in BUILD_LOG #1 records the real builds.

### The API never listens after a stop signal that arrives while it starts

- Date: 2026-10-11 · Instruction: #1 · Author: Delta (wave w0 review, round 2)
- Context: "API structure: app factory, plugin routes and a small entrypoint" closes the app on
  SIGINT or SIGTERM. A signal that arrived while `app.listen()` was still running the plugins'
  onReady hooks closed the app, but Fastify went on with the start: the server then listened,
  answered with 503 or 200 and never exited (w0.V1.Bravo.3; four such servers from a reproduction
  still answered four hours later). No plugin does work at start-up yet, so the window was about a
  millisecond, but the database, Redis and job queue clients (#26, #35, #37) will add some.
- Decision: apps/api/src/server.ts runs `app.ready()` (the onReady hooks) and then `app.listen()`
  only if no stop signal has arrived meanwhile. The shutdown waits for that start to finish
  before it closes the app, which also covers a signal while the port is opened on a hostname,
  whose address lookup takes time. A signal before the handlers are registered, while the modules
  load and the app is built, still ends the process as Node.js does by default: nothing has
  started. Tests: a signal during an onReady hook (code 0, never listening), one during the lookup
  of `localhost`, a repeated SIGTERM, a close that fails (code 1) and the 10-second limit with a
  request that never finishes (code 1).
- Trade-offs: a stop during start-up waits for the plugins' start-up work to finish, so their
  clean-up runs; Fastify's own `pluginTimeout` (10 s) bounds a start that hangs, which then exits
  with "failed to start" and code 1. Fastify's `listen({ signal })` also skips listening after an
  abort, but it closes the app itself and ignores a close that fails; the entrypoint keeps the
  shutdown, its time limit and its error handling in one place.

### The steps after a stopped hook keep a merge, and the tests run them from the README

- Date: 2026-10-11 · Instruction: #2 · Author: Delta (wave w0 review, round 2)
- Context: "A stopped pre-commit hook is recovered by hand, with tested steps" gave the steps that
  lint-staged takes after a failed check, but not all of them: lint-staged also writes back the
  merge state (`MERGE_HEAD`, `MERGE_MSG` and `MERGE_MODE`) and deletes its working folder
  `.git/lint-staged/<id>` (lib/gitWorkflow.js). Reported as w0.V1.Bravo.2: after a stopped commit
  that was finishing a merge, `git reset --hard` and `git stash apply --index` each delete
  `MERGE_HEAD`, so the next commit had one parent. When `git merge` itself is stopped during
  pre-merge-commit, git never records the merge. The tests ran their own copy of the steps, so the
  README could drift from what was tested.
- Decision: the README section "Git hooks" gives three sets of steps: after a stopped commit (now
  also deleting lint-staged's working folder); the same with the merge state copied aside and
  back, for a commit that was finishing a merge; and `git reset --merge` followed by the merge
  again, for a stopped `git merge` (git refuses to merge with staged changes, so every staged
  change came from the merge). `git-hooks.test.ts` takes the code blocks from README.md, fills in
  `stash@{n}`, `<id>` and `<branch>`, and runs them in scratch repositories.
- Trade-offs: recovery is still manual, now with three variants. The tests depend on the README's
  layout (a `sh` code block in the section "Git hooks" that holds the commands), which is what
  keeps the documented steps tested. `git reset --merge` drops the merge's changes but keeps
  unstaged changes and untracked files, which `git merge` refuses to overwrite.

### Tests check the resolved settings that decide what CI and the hook check

- Date: 2026-10-11 · Instruction: #1, #2 · Author: Delta (wave w0 review, round 2)
- Context: round 2 of the wave w0 review broke the stream's settings and code on purpose, one
  change at a time: 32 of 45 plausible changes passed every check. Among them: a Vitest project
  left out of the root config (`pnpm test` then ran 289 of 558 tests), lint-staged patterns that
  stopped linting `.tsx` files or type-checking JSON changes, strict compiler flags removed, ESLint
  rule sets weakened or narrowed, and the `prepare` script removed.
- Decision: tests read what the tools resolve rather than the configs' text. `vitest list` must
  list every test file that git tracks or would add (test-suite.test.ts). `tsc --showConfig` must
  show the strict flags for every tsconfig in the repository (typecheck.test.ts). ESLint's
  `calculateConfigForFile` must give a file in every package and at the root every rule that
  typescript-eslint's strict and stylistic sets turn on, every package that depends on React the
  React Hooks rules and jsx-a11y's strict settings, the Next.js app every rule of Next.js's set,
  and the API `no-console` (eslint-config.test.ts). The hook tests stage every kind of file and
  install the hooks with the `prepare` script. Expected rules come from the rule sets themselves
  and packages from the workspace folders, so a new package such as packages/ui is checked
  without a change to the tests.
- Trade-offs: the strict flags are listed in the test, so changing them on purpose means changing
  the test too. The check that every test file runs lives in the "tooling" project, so it cannot
  see that project's own removal; scripts/tooling-project.test.ts, in the "scripts" project, checks
  that the tooling project still runs it. Options are compared only for jsx-a11y, whose
  recommended set differs from its strict set in options alone.

### Next.js compiles @apex/shared without transpilePackages

- Date: 2026-10-11 · Instruction: #1 · Author: Delta (wave w0 review, round 2)
- Context: "Next.js app configuration" listed `@apex/shared` in `transpilePackages`, and
  "Workspace packages are consumed as TypeScript source; the production API runs compiled code"
  named it as how Next.js reads the package's source. The documentation that ships with Next.js
  16.4 (node_modules/next/dist/docs, `transpilePackages`) says that Turbopack compiles workspace
  packages by itself under both routers, as webpack does for the App Router; the setting is for
  `node_modules` packages that ship TypeScript or JSX, and for the Pages Router. In round 2 of the
  review, removing it passed every check: the tests, `pnpm build`, CI's build-warning and start
  checks, and a Client Component that imports the package, built and served by `next dev`.
- Decision: apps/web/next.config.ts has no `transpilePackages`; a comment there says why. Its
  settings test now also checks the two root settings, `turbopack.root` and
  `outputFileTracingRoot`, which no check covered either.
- Trade-offs: one setting fewer that looked necessary and did nothing. A `node_modules` package
  that ships TypeScript, or a move to the Pages Router built with webpack, would need an entry.

### The web tests compile the global stylesheet with Tailwind CSS

- Date: 2026-10-11 · Instruction: #1 · Author: Delta (wave w0 review, round 2)
- Context: instruction 1 asks for a minimal Tailwind CSS 4 setup: `@import "tailwindcss"` in
  apps/web/src/app/globals.css, the `@tailwindcss/postcss` plugin in apps/web/postcss.config.mjs,
  and the root layout importing the stylesheet. Round 2 of the review removed each in turn, and
  every check passed, CI's build and production start check included: Vitest turns CSS into empty
  strings, and the start check only asks for the home page.
- Decision: the web Vitest project compiles globals.css (`css.include`), so Vite runs it through
  postcss.config.mjs and Tailwind CSS, as Next.js does. `globals.test.ts` imports it with Vite's
  `?inline` query and checks Tailwind's banner and a plain, a responsive and a dark-mode utility
  that the pages use; `layout.test.tsx` checks that the layout loads it. PostCSS configs are rerun
  triggers for the pre-commit hook, because Vite reads them outside the module graph.
- Trade-offs: no new dependency, and the compile takes about 40 ms. The test checks the stylesheet
  that Vite builds, not Next.js's output; checking the CSS of the page that CI's start check
  fetches would cover both, but only after a build. The `?inline` specifier is held in a variable,
  so that TypeScript, which does not know Vite's queries, does not look it up; Zod checks what the
  import returns.

### Redis reads its password from a config file that Compose writes

- Date: 2026-10-11 · Instruction: #3 · Author: Echo
- Context: replaces "Compose secure defaults: required passwords, loopback ports, pinned images",
  which gave Redis its password as `--requirepass` on the command line. On a Linux host every user
  can read any process's command line, and the Redis image's entrypoint (a shell, its subshells
  and setpriv) runs with the container's full command line before redis-server hides its
  arguments. In the wave w0 round-2 review, a watcher running as `nobody` in a Debian 13 VM
  (Docker Engine 29.9.1) read the password from 36 command lines during 9 starts of the
  container. At steady state no command line held it, which is why earlier checks missed it.
- Decision: Redis reads `requirepass` and `appendonly` from a config file that Compose writes into
  the container: the top-level `configs` entry `redis-config`, whose inline `content` Compose
  fills in from `.env`, mounted at `/usr/local/etc/redis/redis.conf` (mode 0444). The command is
  exactly `redis-server` and that file. redis-cli still reads the password from `REDISCLI_AUTH`.
  The rest of the replaced entry still holds: both passwords use the required form, with no
  default and blank in the template; ports are published on 127.0.0.1 only; every image is
  pinned to a tag and its multi-platform digest; PostgreSQL and Redis use the `local` log driver.
  `infra/compose.test.ts` keeps every secret off command lines and health checks.
- Trade-offs: inline config content needs Compose 2.23.1 or later, which current Docker Desktop,
  OrbStack and Docker's own packages meet (Debian 13's `docker-compose` is 2.26.1). The password
  must be one word in Redis's config syntax; the `openssl rand -hex 32` that the template
  recommends is. `docker inspect` (through `REDISCLI_AUTH`) and `docker compose config` still show
  it, as before; the replaced entry's trade-offs still hold, and Docker secrets come with
  instruction 104. Rejected: a shell that expands the password inside the container (the command
  would no longer start with redis-server, so the image would not drop root privileges) and a
  config file kept on the host (a second file holding the password, beside `.env`).

### The docker scripts refuse Docker Compose before 2.23.1

- Date: 2026-10-11 · Instruction: #3, #7 · Author: Integrator (wave w0, round 2)
- Context: "Redis reads its password from a config file that Compose writes" made
  docker-compose.yml need Compose 2.23.1 or later, for a `configs` entry with inline `content`.
  An older Compose fails every command with a message about the file, not the version: the 2.23.0
  release prints "configs.redis-config Additional property content is not allowed" and exits
  with status 15 (checked with the 2.23.0 and 2.23.1 release binaries, whose SHA-256 digests
  match the releases' checksums). Echo's hand-off from round 2 of the wave w0 review suggested a
  version check next to the engine's.
- Decision: `scripts/check-docker.ts` reads the version from the `docker compose version` call it
  already makes ("Docker Compose version v2.23.1"; a suffix such as `-desktop.1` and a missing
  "v" are allowed) and, on every system, stops the `docker:*` scripts with an explanation and a
  link to Docker's install guide when it is earlier than 2.23.1. Tests cover old, new and
  unreadable versions on both systems, and the scripts with a stand-in `docker`.
- Trade-offs: as for the engine, output without a release number is let through. Plain
  `docker compose` commands are not checked and fail with Compose's own message; infra/README.md
  gives the minimum. Current Docker Desktop, OrbStack and Docker's own Linux packages are far
  newer, so the check is for old distribution packages.

### The Redis health check reads the password from Redis's config file

- Date: 2026-10-11 · Instruction: #3 · Author: Delta (wave w0 review, round 3)
- Context: replaces "Health checks that mean "ready": pg_isready over TCP and redis-cli -e",
  whose Redis check took the password from `REDISCLI_AUTH` in the container's environment. That
  copy is fixed when Compose creates the container, while Compose 5 writes Redis's config file
  again each time it starts the container from the compose file. After `docker compose stop`, a
  new `REDIS_PASSWORD` in `.env` and `docker compose start`, Redis had the new password and the
  check the old one, so the service turned unhealthy (w0.V2.Bravo.3; seen again in round 3 on
  Docker Engine 29.9.2 with Compose 5.6.1, which reads the compose file for `start` unless a
  project name is given with `-p`).
- Decision: the check is
  `REDISCLI_AUTH="$(sed -n 's/^requirepass //p' /usr/local/etc/redis/redis.conf)" redis-cli -e ping`
  (CMD-SHELL): it reads the password from the file that redis-server read, and passes it in the
  environment, never on a command line. `REDISCLI_AUTH` stays in the container's environment, for
  `docker compose exec redis redis-cli` and because it is what makes `docker compose up -d`
  recreate the container when the password changes: Compose compares a service's settings, and a
  change in a config's `content` alone does not count. The rest of the replaced entry holds:
  `pg_isready` over TCP, `-e`, and the timings.
- Trade-offs: after `stop` and `start` with a new password, `docker compose exec redis redis-cli`
  keeps the old one until `docker compose up -d`; infra/README.md says to change the password
  with `up -d`. The check takes the rest of the `requirepass` line as the password, so a password
  that Redis parses differently (with quotes or spaces) fails it; `.env.example` asks for letters
  and digits only, and the tests pin the config file's content. Tried and rejected in round 3:
  dropping `REDISCLI_AUTH` altogether, so that only the config file holds the password; in the VM
  `docker compose up -d` then left Redis on the old password, because nothing in the service's
  settings had changed. Instruction 104 meets the same Compose behaviour if it moves passwords
  into secrets or configs: changing one must still recreate the containers that use it.

### The compose tests accept only the settings they check

- Date: 2026-10-11 · Instruction: #3 · Author: Delta (wave w0 review, round 3)
- Context: `infra/compose.test.ts` validated `docker-compose.yml` with a loose Zod schema that
  read only the settings it checked, so any other setting passed: an `env_file` holding
  `POSTGRES_HOST_AUTH_METHOD=trust` (w0.V2.Bravo.2), extra lines in Redis's config file
  (w0.V2.Bravo.1), `extends`, a top-level `include`, `cap_add`, `pid: host`, volume options, and a
  YAML merge key, which the `yaml` package keeps as a plain `<<` key while Compose merges it. In a
  VM (Docker Engine 29.9.2, Compose 5.6.1) a merge key gave PostgreSQL logins without a password
  from another container, and another published Redis on every interface of the VM. A committed
  `compose.yaml` (which Compose prefers to `docker-compose.yml`) or `docker-compose.override.yml`
  (which it merges on top) also changed what runs without any test noticing.
- Decision: strict Zod schemas (`z.strictObject`) for the whole file: exactly the four services,
  each with exactly its settings, health checks with exactly their keys, named volumes without
  options and the one config. A file outside that shape, or one the YAML parser warns about (an
  unknown tag such as Compose's `!reset`), fails the whole test file with a message that names the
  setting. Redis's config content is compared exactly. A test asks git that no other file with a
  name Compose reads by default is tracked, and the root `vitest.config.ts` makes staging one run
  every test, as it does for `docker-compose.yml`.
- Trade-offs: every new service or setting (networks in #103, secrets in #104, MinIO in #121)
  must be added to the schema together with a test for its value: deliberate friction. Rejected:
  a list of forbidden settings (a merge key, `extends` or a new Compose feature gets round it),
  and running `docker compose config` in the tests (Docker is not installed everywhere the tests
  run; CI's Compose step does run it).

### The pgvector image lags the official postgres image's security rebuilds

- Date: 2026-10-11 · Instruction: #3 · Author: Delta (wave w0 review, round 3)
- Context: "PostgreSQL 18 with pgvector, from the pgvector/pgvector image" describes the image as
  the official `postgres` image plus one extension. pgvector rebuilds its images only now and
  then: the pinned `0.8.7-pg18-trixie` build is from 0.8.7's release day, 2026-10-01, and is still
  the newest, while the official `postgres:18.6-trixie` is also rebuilt for Debian's security
  updates, last on 2026-10-21. In the round-3 review's VM, the pinned image still had packages
  that trixie's security suite has since replaced (`liblzma5` and `xz-utils` 5.8.1-1+deb13u1, not
  +deb13u2; `libpcre2-8-0` 10.46-1~deb13u2, not ~deb13u3), which the official image already had,
  and build tools that the official image does not ship (binutils, cpp, dpkg-dev, python3).
- Decision: keep `pgvector/pgvector`, and move the digest to each newer `0.8.x-pg18-trixie` build
  as soon as pgvector publishes one. Whether instruction 102, which builds the hardened images,
  should build this one too (the official image plus PGDG's `postgresql-18-pgvector` package,
  rebuilt with each official release) is the owner's decision; it is an owner action in
  BUILD_LOG #3.
- Trade-offs: until then the database container can lag Debian's security fixes by weeks; the
  ports are on 127.0.0.1 only, which limits who can reach PostgreSQL. Our own image would remove
  the lag and the build tools but adds a Dockerfile and its builds to maintain, which the original
  entry rejected while no Docker engine was available to build and test one. Instruction 106's
  update checks should compare against the official image's rebuilds, not only pgvector's tags.
