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

## #6 - Architecture and decision docs

**What changed**

- `docs/ARCHITECTURE.md` (new): an overview diagram of every component in the playbook, grouped
  by network zone and labelled "built #N" or "planned #N" (built components also have thick
  borders, planned ones dashed); diagrams of the request flow, a Crew Chief chat, the upload and
  print path, and the deployment today and on the home server; tables of the components, network
  zones, trust boundaries and data stores; sections on observability, the code layout, open
  questions for later instructions, and how to keep the document current.
- `docs/DECISIONS.md`: the header now says what belongs in the log, explains each field of the
  entry template and sets the rules: append only, no numeric IDs, check union merges, never edit
  a merged decision, and mark a replaced entry with a `- Superseded by:` line. Every earlier entry
  is unchanged. New entries record the decisions behind instructions 6 and 8.
- `README.md`: the documentation list links the architecture document.

**How to verify**

Render every diagram. This needs network access; the first run downloads mermaid-cli, and
Puppeteer downloads a headless Chrome into `~/.cache/puppeteer`:

```sh
npx --yes @mermaid-js/mermaid-cli@12.0.0 -i docs/ARCHITECTURE.md -o /tmp/architecture.md
ls /tmp/architecture-*.svg
```

The first command prints `Found 6 mermaid charts in Markdown input` and a ✅ line for each
diagram, and exits with code 0; `ls` lists `/tmp/architecture-1.svg` to `/tmp/architecture-6.svg`.
Open one in a browser to look at it. GitHub renders the diagrams too, once the repository is
there.

Check that the decisions log kept every earlier entry (472e750 is the last commit on main before
the Phase 0 work started):

```sh
git diff 472e750 -- docs/DECISIONS.md | grep -v '^---' | grep '^-'
```

It prints only lines of the old header (its introduction, `Rules:` and `Entry template:`), never a
line of an entry.

```sh
pnpm format:check   # "All matched files use Prettier code style!"
```

**Dependencies added**

None. mermaid-cli was run from a scratch directory outside the repository.

**Owner actions**

None. The "Open questions" section of the architecture document lists choices that later
instructions make; nothing needs deciding now.

**Notes & limitations**

- The status labels describe the repository once all of Phase 0 (instructions 1 to 8) is
  merged. Planned parts are the expected design, not commitments: the instructions that build
  them may refine them and must update the document in the same change.
- Nothing in CI renders the diagrams; the check above is manual. In sequence diagrams a bare `#`
  silently cuts a label while rendering still succeeds, so those diagrams write `#35;` instead.

## #8 - Structured logging with request IDs

**What changed**

- The API logs through Fastify's built-in pino logger, set up in `apps/api/src/lib/logger.ts`:
  one JSON object per line with an ISO 8601 time. `LOG_FORMAT=pretty` prints readable lines for a
  terminal instead, through pino-pretty (a development dependency).
- Request IDs (`apps/api/src/lib/request-id.ts`): a well-formed incoming `x-request-id` (8 to 64
  letters, digits, `-` or `_`) is reused and anything else is replaced by a new UUID. Every
  response sends the ID back in `x-request-id`, including the 400 and 414 responses that
  Fastify's router sends for malformed URLs.
- Request context (`apps/api/src/lib/request-context.ts`): an AsyncLocalStorage context entered in
  the app's first `onRequest` hook, so every line logged while a request is handled carries its
  ID as `reqId`, including lines from code that is never handed the request.
- Redaction (`apps/api/src/lib/redact.ts` and the logger): the values of sensitive keys
  (passwords, secrets, API keys, tokens, cookies, authorization headers, session IDs and similar)
  become `[Redacted]` at any depth; URL credentials, query strings and fragments are hidden in
  every string; strings are cut to 8192 characters and request URLs to 256. Request lines hold
  only the method, the shortened URL and the client's address.
- `buildApp` (`apps/api/src/app.ts`) takes `logLevel` (default `silent`, so tests stay quiet),
  `logFormat` (default `json`) and `logDestination` (for tests) instead of Fastify's `logger`
  option. `apps/api/src/config.ts` reads `LOG_FORMAT` (`json` or `pretty`, default `json`). The
  entrypoint logs at `info` until instruction 4's `LOG_LEVEL` is merged.
- `eslint.config.mjs`: `console` is an error in `apps/api/src` except `server.ts`, so every line
  goes through the logger.
- Tests: unit tests for each module; `apps/api/src/logging.test.ts` for the whole app (every line
  of a request carries the same ID, including a service's line written without the request;
  concurrent requests; a body that arrives in pieces over a real connection; two requests on one
  keep-alive connection; the header sent back; malformed IDs replaced; router errors, 404s and
  500s; redaction of headers, bodies, query strings, cookies and a malformed request's raw bytes;
  the pretty format); and entrypoint tests that run the real server.

**How to verify**

```sh
pnpm install --frozen-lockfile
pnpm --filter @apex/api test   # all pass: "Tests  185 passed (185)" on this branch alone
pnpm lint                      # exits with code 0
pnpm typecheck                 # shared, api and web each report "Done"
```

Run the API in terminal 1 and watch its log:

```sh
pnpm --filter @apex/api dev
```

In terminal 2:

```sh
curl -si -H 'x-request-id: owner-check-0001' 'http://127.0.0.1:4000/health?token=secret-value'
curl -si -H 'x-request-id: bad id' http://127.0.0.1:4000/health
curl -si http://127.0.0.1:4000/%zz
```

- The first `curl` shows `x-request-id: owner-check-0001`. In terminal 1, the `incoming request`
  and `request completed` lines both have `"reqId":"owner-check-0001"`, the URL is logged as
  `"/health?[Redacted]"`, and `secret-value` appears nowhere in the log.
- The second shows a new UUID in `x-request-id`; the malformed ID is neither used nor logged.
- The third returns `400 Bad Request` with an `x-request-id` header, and terminal 1 shows an
  `incoming request` line and an error line with that ID.

Press Ctrl+C in terminal 1 (the API logs `"msg":"shutting down"`), then start it with readable
logs and repeat a `curl`:

```sh
LOG_FORMAT=pretty pnpm --filter @apex/api dev
```

Each entry is now a line such as `[00:30:13.189] INFO: incoming request {"reqId":"...", ...}`,
with an error's details on the lines below it. An invalid format stops the API at startup:

```sh
LOG_FORMAT=fancy node apps/api/src/server.ts; echo "exit code $?"
```

It prints an error that names `LOG_FORMAT` and the allowed values (`json`, `pretty`), then
`exit code 1`.

**Dependencies added**

`pino-pretty`, a development dependency of `apps/api`, for `LOG_FORMAT=pretty`. Why, and the
alternatives, are in `docs/DEPENDENCIES.md`. pino itself is Fastify's own dependency.

**Owner actions**

None.

**Notes & limitations**

- Pretty output is opt-in: set `LOG_FORMAT=pretty` in the shell or in `apps/api/.env`. It needs
  the development dependencies, so an install without them can only log JSON; asked for `pretty`
  there, the API refuses to start and says to use `json`.
- Until instruction 4's environment loader is merged, the API always logs at `info`; with it,
  `LOG_LEVEL` sets the level.
- Clients choose their request IDs when well formed, so an ID is a label for finding log lines,
  never something to trust.
- Two responses carry no `x-request-id`: the bare 400 that Node.js sends for bytes it cannot parse
  as HTTP (Fastify logs it at trace level), and the 503 that Fastify sends to a request arriving
  on an open connection during shutdown (its log line has the ID).
- Redaction works on key names and URL parts. A secret written into a message's text cannot be
  recognised, so never put one there.
- Request lines record the client's IP address, which is personal data under UK GDPR; the privacy
  policy (#114) must cover logs.
- Redaction parses and re-serialises each line: about 3.3 µs per line instead of 0.5 µs, measured
  on this Mac, which is negligible next to real routes.
- Fastify logs client errors (4xx) at info level with a stack trace. Instruction 27's global error
  handler should decide how errors are logged.
- Only the API is covered: Next.js's own server output is not structured, and the web app does
  not yet pass request IDs on to the API (with the typed API client, #29).
