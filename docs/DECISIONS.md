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
