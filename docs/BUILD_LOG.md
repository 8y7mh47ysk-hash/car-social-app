# Build log

One entry per playbook instruction, following the Master Context rule "after each task, list what
changed and how I verify it works". Each entry has the heading `## #N - <title>` and five parts:
**What changed**, **How to verify** (exact commands and what you should see), **Dependencies
added**, **Owner actions** and **Notes & limitations**.

## #1 - Monorepo foundation

**What changed**

- A pnpm 12 workspace with `apps/web`, `apps/api`, `packages/shared` and `infra/` (documentation
  only for now). Node.js 24 and pnpm 12.11.2 are pinned (`.nvmrc`, `.node-version`,
  `packageManager`, `engines`).
- `tsconfig.base.json`: strict TypeScript shared by every package, plus a root `tsconfig.json`
  for the root config files.
- `@apex/shared`: `healthResponseSchema` and its `HealthResponse` type (Zod), and `APP_NAME`.
  Apps consume it as TypeScript source; the production API loads its compiled `dist/` output.
- `@apex/api`: Fastify 5 app factory `buildApp(options)` in `src/app.ts`, `GET /health`
  returning `{"status":"ok"}` in `src/routes/health.ts`, and the entrypoint `src/server.ts`. The
  entrypoint listens on `127.0.0.1:4000` by default (`API_HOST` and `API_PORT`, validated with
  Zod) and shuts down cleanly on SIGINT or SIGTERM.
- `@apex/web`: Next.js 16 (App Router, React 19) with Tailwind CSS 4 and a placeholder home page
  that lists the first planned features. It listens on `127.0.0.1:3000` by default (`WEB_HOST`
  and `WEB_PORT`).
- Tooling: one ESLint 9 flat config for the whole repository (type-aware TypeScript rules,
  Next.js, React Hooks and strict jsx-a11y rules for the web app, Prettier compatibility),
  Prettier 3, and Vitest 4 projects with tests in every package (27 tests).
- Root scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `format`, `format:check`.
- Repository conventions: `.gitattributes` (LF line endings, union merges for the shared docs
  logs), `.gitignore`, `.editorconfig`, `.prettierignore` (protects `docs/PLAYBOOK.md`), the
  README, `infra/README.md` and these docs logs.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint           # prints only the eslint command line and exits with code 0
pnpm typecheck      # shared, api and web each report "Done"
pnpm test           # "Test Files  5 passed (5)" and "Tests  27 passed (27)"
pnpm format:check   # "All matched files use Prettier code style!"
pnpm build          # Next.js lists route "/" as "(Static)"; creates packages/shared/dist and apps/api/dist
```

Development servers (two terminals):

```sh
pnpm dev                                         # terminal 1: starts both apps
curl http://127.0.0.1:4000/health                # terminal 2: prints {"status":"ok"}
curl -s http://127.0.0.1:3000 | grep -o '<h1[^>]*>[^<]*</h1>'   # ends in >Apex Garage</h1>
```

Then press Ctrl+C in terminal 1: both apps stop and the API logs `"msg":"shutting down"`. Open
<http://127.0.0.1:3000> in a browser to see the placeholder page. To use other ports, run
`WEB_PORT=3010 API_PORT=4010 pnpm dev`.

Production servers: run `pnpm build`, then `pnpm start`, and repeat the two `curl` commands.

**Dependencies added**

TypeScript 6.0, `@types/node` 24, ESLint 9.39 with `@eslint/js`, typescript-eslint,
eslint-config-next, eslint-plugin-jsx-a11y and eslint-config-prettier, Prettier 3.9, Vitest 4.1,
Zod 4.6, Fastify 5.12, Next.js 16.4, React 19.3, Tailwind CSS 4.3 with `@tailwindcss/postcss`,
jsdom and Testing Library (`react`, `dom`, `jest-dom`). Reasons and alternatives for each are in
`docs/DEPENDENCIES.md`.

**Owner actions**

None for this instruction.

**Notes & limitations**

- Scripts need a POSIX shell (macOS, Linux or WSL).
- `pnpm start` needs `pnpm build` first: the production API loads packages/shared from `dist/`
  through `node --conditions=@apex/dist`. Running `node dist/server.js` without that flag fails
  with `ERR_MODULE_NOT_FOUND`.
- Pressing Ctrl+C on `pnpm start` makes pnpm print `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, because
  `next start` exits with code 130 when interrupted. Both servers do stop.
- `GET /health` is only a smoke check; real health and readiness checks are instruction 33.
- API logging is Fastify's default pino output, which logs each request's full URL. Structured
  logging with request IDs, and bounding what gets logged, is instruction 8.
- The API's environment handling covers only `API_HOST` and `API_PORT`. The typed environment
  loader and `.env.example` files are instruction 4.
- There are no git hooks yet (instruction 2) and no CI yet (instruction 5).
- Next.js collects anonymous telemetry by default; the README explains how to opt out.

## #4 - Typed environment loader

**What changed**

- `packages/shared/src/env.ts`: `parseEnv(schema, source, options)`, the reusable Zod helper. It
  reads only the variables the schema declares, treats an empty value as not set, collects every
  problem, and throws an `EnvValidationError` whose message names each missing or invalid
  variable and never prints a value. It also exports `envPortSchema` (digits, 0 to 65535) and
  `envHostSchema` (an IP address or a hostname, so a URL or `host:port` is rejected).
- API: `apps/api/src/config.ts` exports `loadConfig(env)`, which returns a typed `ApiConfig`
  (`host`, `port`, `logLevel`) from `API_HOST` (default `127.0.0.1`), `API_PORT` (default `4000`)
  and the new `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`; default
  `info`). It replaces `loadServerConfig`. `src/server.ts` is the only API file that reads
  `process.env`: it loads the config before anything else, prints the error and exits with code 1
  if a variable is missing or invalid, and passes the log level to the app's logger.
- The API's `dev` and `start` scripts load `apps/api/.env` when it exists (Node's
  `--env-file-if-exists`). Variables set in the shell win, and `pnpm dev` restarts when the file
  changes.
- Web: `apps/web/src/env/` separates server-only variables (`server.ts`, which imports
  `server-only`, so a Client Component that imports it fails the build) from browser-visible
  `NEXT_PUBLIC_` variables (`public.ts`). `schema.ts` declares both groups; both are empty because
  the web app reads no variables yet. `next.config.ts` now exports a function that checks them
  whenever Next.js loads its config: public variables in `next dev` and `next build`, server
  variables in `next dev` and `next start`.
- Templates: `apps/api/.env.example` (the three API variables and their defaults) and
  `apps/web/.env.example` (no variables yet: the rules for adding one, and why `WEB_HOST` and
  `WEB_PORT` work only from the shell). The root `.env.example`, for Docker Compose, belongs to
  instruction 3.
- ESLint: `no-restricted-properties` rejects `process.env` in `apps/*/src` and `packages/*/src`,
  except in the three modules that read it.
- `env-files.test.ts`, in a new root `tooling` Vitest project, asks git
  (`git check-ignore --no-index --verbose`) about 17 env-file names in several folders, which must
  be ignored, and the three templates, which must not be, and fails if any `.env` file is
  committed.
- The API entrypoint test now gives the server process only the API's variables, so the
  developer's shell cannot change the result, and covers invalid variables (it checks the whole
  output, so a printed value or stack trace fails it) and `LOG_LEVEL`.
- README: a "Configuration" section. `.gitignore`: the env rules' comment names the test.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck   # both exit with code 0
pnpm test                     # "Test Files  10 passed (10)" and "Tests  144 passed (144)"
pnpm build                    # web build log includes "Running next.config.ts took ..."
```

The gitignore rules, as git applies them (the test checks many more names; the line numbers move
if `.gitignore` changes above the env rules):

```sh
git check-ignore -v --no-index .env apps/api/.env apps/web/.env.local
# .gitignore:20:.env	.env
# .gitignore:20:.env	apps/api/.env
# .gitignore:21:.env.*	apps/web/.env.local
git check-ignore -v --no-index apps/api/.env.example apps/web/.env.example
# .gitignore:22:!.env.example	apps/api/.env.example    (the "!" rule means: not ignored)
# .gitignore:22:!.env.example	apps/web/.env.example
pnpm exec vitest run --project tooling   # "Tests  23 passed (23)"
```

The API refuses invalid settings, names each one and never prints a value (after `pnpm build`):

```sh
API_PORT=99999 LOG_LEVEL=loud pnpm --filter @apex/api start
# .env not found. Continuing without it.        (Node's notice when apps/api/.env is absent)
# Invalid environment variables for the API (values are not shown):
#   - API_PORT: must be a whole number from 0 to 65535
#   - LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent
# Set them in apps/api/.env (see apps/api/.env.example) or in the environment.
# then pnpm reports "Command failed with exit code 1"
```

The API reads `apps/api/.env`, and the shell wins over it:

```sh
cp apps/api/.env.example apps/api/.env && echo "API_PORT=4010" >> apps/api/.env
pnpm --filter @apex/api dev                  # logs "Server listening at http://127.0.0.1:4010"
curl http://127.0.0.1:4010/health            # second terminal: {"status":"ok"}
```

Press Ctrl+C, then run `LOG_LEVEL=warn pnpm --filter @apex/api dev`: the API still answers on
port 4010, but logs nothing for the start or for requests (those lines are at info level). Press
Ctrl+C and delete the file: `rm apps/api/.env`.

The web app's guard and phase checks:
`pnpm exec vitest run --project web --reporter=verbose` lists
`serverEnv > refuses to load outside React Server Components` (importing `src/env/server.ts`
anywhere but on the server throws) and a `validateWebEnv` test for each Next.js phase, and ends
with `Tests  27 passed (27)`.

**Dependencies added**

- `server-only` (web): marks `apps/web/src/env/server.ts` as server-only. Next.js handles the
  import itself; the package lets other tools resolve it (Vitest now, Storybook from instruction
  22), where importing the module throws.
- `zod` (web): already used by packages/shared and the API; the web app declares its env schemas
  with it.

**Owner actions**

None for this instruction.

**Notes & limitations**

- The web app reads no variables yet, so its schemas are empty and its checks pass trivially. The
  mechanism was verified with temporary variables, removed afterwards: `next build` without a
  required public variable stopped and named only it; with it, the build succeeded without the
  server's secret and the value was copied into the browser JavaScript; `next start` without the
  secret exited with code 1 naming only it; a Server Component could import `serverEnv` and the
  secret reached no browser file; a Client Component importing `serverEnv` failed the build with
  an import trace.
- `WEB_HOST` and `WEB_PORT` work only from the shell, for example `WEB_PORT=3010 pnpm dev`:
  Next.js opens the port before it reads `.env` files or its config. Next.js's CLI rejects a
  non-numeric port ("'abc' is not a non-negative number"); an out-of-range one fails with Node's
  `ERR_SOCKET_BAD_PORT` and a stack trace.
- No API variable is required yet, because each has a safe default. The first required ones (such
  as the database URL in Phase 2) will stop the API in the same way when missing; the
  packages/shared tests cover that path.
- `pnpm dev` keeps watching after an environment error ("Failed running 'src/server.ts'. Waiting
  for file changes before restarting..."); saving a fixed `apps/api/.env` restarts it.
  `pnpm start` exits with code 1.
- `next typegen`, which `pnpm typecheck` runs, loads the Next.js config in the build phase, so
  once a required public variable exists, type checks (and CI) need it set too.
- Next.js prints "Failed to load next.config.ts", then the error as
  `Error [EnvValidationError]: ...` with the problems, a short stack trace and the same problems
  as an `issues` list; the API prints only the message. `next dev` and `next start` print "Ready"
  just before that, because Next.js opens the port before it loads its config, then exit with
  code 1.
- `server.ts` passes `LOG_LEVEL` to Fastify's logger through `buildApp`'s existing `logger`
  option. Instruction 8 (structured logging) replaces that option; the level must then go to its
  replacement.
- If instruction 102 switches the web app to Next.js's standalone output, its `server.js` does
  not load `next.config.ts`, so the server-variable check must move to `instrumentation.ts`.
