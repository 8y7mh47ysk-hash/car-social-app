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
