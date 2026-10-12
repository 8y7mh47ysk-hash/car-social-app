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
