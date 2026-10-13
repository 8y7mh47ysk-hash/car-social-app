# Build log

One entry per playbook instruction, following the Master Context rule "after each task, list what
changed and how I verify it works". Each entry has the heading `## #N - <title>` and five parts:
**What changed**, **How to verify** (exact commands and what you should see), **Dependencies
added**, **Owner actions** and **Notes & limitations**.

Test counts in an entry are those the repository had when that instruction was finished. Later
instructions add tests, so commands that run several instructions' tests (`pnpm test`, one
package's tests or a whole Vitest project) report more; a command that names a single test file
keeps its count unless the entry is updated.

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

## #2 - Git hooks and conventional commits

**What changed**

- `pnpm install` now installs two git hooks with husky 9: the root `prepare` script points git's
  `core.hooksPath` at `.husky/_`, a generated and gitignored folder. Run `pnpm install` once in
  every clone and git worktree.
- `.husky/pre-commit` runs lint-staged with `lint-staged.config.ts` on exactly what is being
  committed (unstaged changes and untracked files are set aside meanwhile and restored after, and
  deleted files count as staged). One task at a time: ESLint `--max-warnings=0 --fix`, then
  Prettier, on staged code; Prettier on other staged files; `pnpm typecheck` for the whole
  repository when a staged file is TypeScript, JSON or a pnpm workspace file; then
  `vitest related --run --passWithNoTests` for the tests that import a staged file. ESLint and
  Prettier fixes are added to the commit. A failing task does not stop the others.
- `.husky/commit-msg` runs commitlint with `commitlint.config.mjs`: Conventional Commits
  (`@commitlint/config-conventional`) plus the team rules (lowercase scope and subject, subject at
  most 72 characters, a blank line before the body and before the footer, so the
  `Co-Authored-By:` trailer passes when it has a paragraph of its own).
- Root `vitest.config.ts`: a `tooling` project for tests at the repository root, and
  `forceRerunTriggers` so that staging dependency, tsconfig, Vitest, hook or hook-config files
  runs every test. Since Phase 0 was merged, so does staging a file that other instructions'
  tests read instead of importing: `docker-compose.yml`, an `.env.example` template, a
  `.gitignore` or a CI workflow.
- `git-hooks.test.ts` (54 tests): 28 commit messages through the real commit-msg hook and
  commitlint config; 10 pre-commit scenarios that run the real lint-staged with this
  repository's config in scratch git repositories, with stand-ins for ESLint, Prettier, pnpm and
  Vitest that record their calls (order, files, hiding and restoring, deleted files, fixes being
  staged, a failure in each tool); and 16 runs of the real `vitest related` in this checkout,
  which check that staging a rerun-trigger file runs every test and an unrelated file runs none.
- README: "Git hooks" and "Commit messages" sections and a `.husky/` line in the layout.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile          # a fresh install prints ". prepare$ husky"
git config --get core.hooksPath         # prints .husky/_
pnpm exec vitest run git-hooks.test.ts  # "Tests  54 passed (54)"
pnpm lint && pnpm typecheck && pnpm test
```

Then try the hooks in a scratch clone (not in your main checkout). Each rejected commit prints
the reason and leaves your files as they were:

```sh
git clone . /tmp/apex-hooks-try && cd /tmp/apex-hooks-try && pnpm install --frozen-lockfile
git commit --allow-empty -m "Add stuff"         # rejected: [subject-empty] [type-empty]
git commit --allow-empty -m "feat: Add stuff"   # rejected: [subject-case]
printf 'export const parse = (text: string): any => JSON.parse(text);\n' > apps/api/src/try.ts
git add apps/api/src/try.ts
git commit -m "feat(api): add a parser"         # rejected: @typescript-eslint/no-explicit-any
printf 'export const port: number = "4000";\n' > apps/api/src/try.ts
git add apps/api/src/try.ts
git commit -m "feat(api): add a port"           # rejected: error TS2322
git rm --quiet --force apps/api/src/try.ts
sed -i.bak 's/z.strictObject(/z.object(/' packages/shared/src/health.ts
rm packages/shared/src/health.ts.bak
git add packages/shared/src/health.ts
git commit -m "fix(shared): relax the schema"   # rejected: × rejects an unexpected extra field
git restore --staged --worktree packages/shared/src/health.ts
printf '\nA note.\n' >> infra/README.md && git add infra/README.md
git commit -m "docs(infra): add a note"         # passes in about a second
cd - && rm -rf /tmp/apex-hooks-try
```

Measured on the Apple M5 in a scratch clone, committing from a non-interactive shell:

| Commit                                                  | Result   | Time   |
| ------------------------------------------------------- | -------- | ------ |
| Nothing staged (`--allow-empty`): the hooks' overhead   | passes   | 0.3 s  |
| A bad message                                           | rejected | 0.3 s  |
| A documentation change                                  | passes   | 0.7 s  |
| A deleted module that is still imported                 | rejected | 1.2 s  |
| A type error                                            | rejected | 2.6 s  |
| A lint error                                            | rejected | 2.7 s  |
| A change that breaks a related test                     | rejected | 3.2 s  |
| A source file and its test (ESLint and Prettier fix it) | passes   | 3.0 s  |
| `git commit -a` with two changed files                  | passes   | 2.9 s  |
| `package.json` staged, so every test runs               | passes   | 12.9 s |

That run also checked that a rejected commit keeps the staged file, its unstaged edit and an
untracked file; that a new git worktree runs the hooks once `pnpm install` has run in it; and
that `HUSKY=0` skips them. Separate checks in a scratch clone showed that Ctrl+C during
the type check restores everything and leaves no stash behind, and that a merge-conflict
resolution commit passes the hooks and is still a merge commit with both parents.

**Dependencies added**

`husky`, `lint-staged`, `@commitlint/cli` and `@commitlint/config-conventional`, as root
development dependencies. They add 57 packages to the lockfile: husky; lint-staged and 2 of its
dependencies that were not there yet; and 53 for commitlint. None has an install script. Reasons
and alternatives are in `docs/DEPENDENCIES.md`.

**Owner actions**

None. If you commit from a GUI git client that cannot find `node` or `pnpm`, add a `PATH` line to
`~/.config/husky/init.sh` (see the README section "Git hooks").

**Notes & limitations**

- Hooks are local and can be skipped (`git commit --no-verify`, `HUSKY=0`); CI (instruction 5) is
  the check that cannot be bypassed. Skip them only in an emergency.
- husky stores `core.hooksPath` in the repository's git config, which every worktree shares; a
  worktree runs the hooks only once `pnpm install` has run in it.
- `vitest related` follows imports only. Tests that run code in a separate process are not
  selected when that code changes: editing `apps/api/src/server.ts` runs no tests in the hook,
  because `server.test.ts` starts it with `node`. CI runs every test.
- Changing `eslint.config.mjs` or the Prettier settings lints and formats only the staged files;
  run `pnpm lint` and `pnpm format:check` to check the whole repository.
- Untracked files are stashed and restored on every commit; keep large scratch files gitignored.
- The hook's backup lives in the git stash, which all worktrees of a repository share. Committing
  in two worktrees at the same moment worked every time (30 commits in 15 simultaneous pairs, no
  failures, nothing lost) but left a stray `lint-staged automatic backup` entry 3 times; such an
  entry is a copy and safe to drop. With several worktrees, pop your own stash entry by name, not
  the top one, which may be another worktree's backup during a commit.
- When the type check fails in one package, `pnpm --recursive` stops the other packages' checks,
  so the output also shows `Command failed with signal SIGKILL` for them.
- The commit message rules are stricter than `config-conventional`: names in a subject must be
  lowercase or in backticks or quotes. A body line such as `Note: ...` directly after other body
  text is read as the start of the footer and rejected; add a blank line before it.

## #3 - Docker Compose services

**What changed**

- `docker-compose.yml` at the repository root, project name `apex-garage`:
  - `postgres`: PostgreSQL 18.6 with pgvector 0.8.7 available (`pgvector/pgvector`, Debian 13),
    data in the named volume `postgres-data`, health check `pg_isready` over TCP.
  - `redis`: Redis 8.10.2 (Alpine) with a required password and the append-only file on, data in
    the named volume `redis-data`, health check `redis-cli -e ping`.
  - `api` and `web`: placeholders in the `app` profile, so a plain `docker compose up -d` starts
    only `postgres` and `redis`. Each prints a reminder to run the app on the host with
    `pnpm dev` and exits with status 1; `api` starts only after both services are healthy.
  - Secure defaults: ports published on `127.0.0.1` only (5432 and 6379, changeable), no default
    passwords (Compose refuses to run without them), every image pinned to a tag and a
    multi-platform digest, restart policy `unless-stopped`, log rotation (Docker's `local`
    driver, at most 100 MB per container).
- `.env.example` at the root: the template for the root `.env` that Compose reads. Both passwords
  are blank and required; the optional settings (user, database, ports, project name) are
  commented out with their defaults.
- `infra/compose.test.ts` (17 tests, Vitest project `infra`): static checks of the compose file
  and the template, which need no Docker. The root `vitest.config.ts` runs them and the root
  `tsconfig.json` type-checks them.
- `infra/README.md` explains the services: first run, everyday commands, connecting, changing a
  password, resetting data, health checks, the placeholders and security notes. The root README
  gained a short "Local services" section, an updated Docker prerequisite and the stack status.

**How to verify**

Without Docker (this is what ran on the build machine):

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --project infra   # "Tests  17 passed (17)"
pnpm test                              # "Test Files  6 passed (6)" and "Tests  44 passed (44)"
pnpm typecheck && pnpm lint            # both exit with code 0
```

With Docker installed (see Owner actions; Docker is not installed on the build machine, so these
were not run here):

```sh
cp .env.example .env && chmod 600 .env   # then set POSTGRES_PASSWORD and REDIS_PASSWORD;
                         # `openssl rand -hex 32` prints a suitable value (run it once for each)
docker compose config --quiet                     # no output, exit code 0
docker compose config --services                  # postgres and redis only
docker compose --profile app config --services    # postgres, redis, api and web
docker compose up -d --wait                       # both containers reported "Healthy"
docker compose ps                                 # "(healthy)" for both; ports 127.0.0.1:5432
                                                  # and 127.0.0.1:6379
docker compose exec postgres psql -U postgres -d apex_garage -tAc "SHOW server_version"
                                                  # 18.6 (Debian 18.6-1.pgdg13+2)
docker compose exec postgres psql -U postgres -d apex_garage -tAc \
  "SELECT default_version FROM pg_available_extensions WHERE name = 'vector'"   # 0.8.7
docker compose exec redis redis-cli ping          # PONG
docker compose exec -e REDISCLI_AUTH=wrong redis redis-cli -e ping; echo "exit $?"
                                                  # AUTH failed: WRONGPASS ..., then exit 1
docker compose exec redis redis-cli SET apex:check kept
docker compose down && docker compose up -d --wait
docker compose exec redis redis-cli GET apex:check   # "kept": the named volume survived
docker compose exec redis redis-cli DEL apex:check
docker compose --profile app up api               # prints "Placeholder: the API has no image
                                                  # yet. Run it on the host: pnpm dev" and the
                                                  # container exits with code 1
docker compose --profile app down                 # removes every container, the placeholder
                                                  # too, and keeps the data (a plain `down`
                                                  # would leave the placeholder behind)
```

To see that the passwords are required, run `POSTGRES_PASSWORD= docker compose config --quiet`
(an empty value in the shell overrides `.env`): it fails with "required variable
POSTGRES_PASSWORD is missing a value: set it in .env (see .env.example)" and exit code 1.

Checks run on the build machine without Docker, outside the repository:

- The real Compose parser: the standalone Docker Compose v5.6.0 binary for macOS (SHA-256
  checked against the release's `checksums.txt`) ran `docker compose config` on the file. With
  both passwords set it is valid, `config --services` lists only `postgres` and `redis`, and
  `--profile app` adds `api` and `web`. Without them, or with empty values, it fails with the
  messages above, also for `ps`, `logs` and `down`. `COMPOSE_PROJECT_NAME` in `.env` renames the
  project and its volumes.
- The compose-spec JSON Schema (draft 2020-12; the compose-spec repository's copy and the copy in
  compose-go v2.16.1, which Compose v5.6.0 uses), checked with Ajv 8.20.0: valid as written and
  after interpolation, and four deliberately invalid documents were rejected.
- Mutation check: 23 deliberate breakages of `docker-compose.yml` and `.env.example` (for
  example a port on all interfaces, a password default, the Redis check without `-e`, a missing
  digest, a drifted default in the template); `infra/compose.test.ts` failed on every one.
- The Redis health check, against Redis 8.10.2 built from the release tarball (SHA-256 checked
  against redis-hashes) over a Unix socket: `redis-cli -e ping` exits 0 only on `PONG`, and 1
  with a wrong or missing password, while the data loads and when the server is down.
- The images, read from the registry: each digest is a multi-platform index with linux/amd64 and
  linux/arm64, and the PostgreSQL image reports `PG_VERSION=18.6-1.pgdg13+2` and
  `PGDATA=/var/lib/postgresql/18/docker`.

**Dependencies added**

- `yaml` (root, dev): parses `docker-compose.yml` in the infra tests.
- `zod` is now also a root dev dependency (the catalog version), to validate the parsed file.
- Container images (not npm packages): `pgvector/pgvector:0.8.7-pg18-trixie`,
  `redis:8.10.2-alpine3.23` and `alpine:3.24.2`, each pinned to its digest.

Reasons and alternatives are in `docs/DEPENDENCIES.md` and `docs/DECISIONS.md`.

**Owner actions**

- Install Docker on the development Mac: Docker Desktop (free for personal use and for
  businesses with fewer than 250 employees and under $10 million revenue) or OrbStack (free for
  personal, non-commercial use; business use needs its paid Pro plan). Then run
  `cp .env.example .env && chmod 600 .env`, set both passwords, run `docker compose up -d --wait`
  (or `pnpm docker:up`, from instruction 7) and check that `docker compose ps` shows both
  services healthy. The commands under "How to verify" check the rest.
- Confirm the Redis licence choice: Redis 8 under its AGPLv3 option, used unmodified, or switch
  to Valkey (BSD-3-Clause), which is a one-line image change. The reasoning is in
  `docs/DECISIONS.md`; it is not legal advice.

**Notes & limitations**

- Docker is not installed on the build machine, so the containers were never started here. The
  file was checked with the real Compose parser, the JSON Schema and the tests above; the health
  check commands were checked against the images' entrypoints, the PostgreSQL documentation and
  a Redis source build.
- The apps do not use PostgreSQL or Redis yet; that starts in Phase 2. Connection URLs are in
  `infra/README.md`.
- Every `docker compose` command for this project needs the two passwords, so CI must pass
  throwaway values: `POSTGRES_PASSWORD=ci REDIS_PASSWORD=ci docker compose config --quiet`.
- The tests read `docker-compose.yml` and `.env.example` from disk, so `vitest related` (used by
  the pre-commit hook from instruction 2) cannot connect a change to those files with
  `infra/compose.test.ts`. Since Phase 0 was merged, both are in the root Vitest config's
  `forceRerunTriggers`, so staging either one runs every test. `pnpm test` and CI always run them.
- `POSTGRES_PASSWORD`, `POSTGRES_USER` and `POSTGRES_DB` apply only when the data volume is
  first created; `infra/README.md` explains how to change the password later.
- The passwords are visible through `docker inspect` (instruction 104 moves them to Docker
  secrets); the API will connect as the PostgreSQL superuser until a least-privilege role arrives
  with the migrations (instruction 26); other containers on the Compose network can reach both
  services (instruction 103 adds an internal network); digest pins need deliberate updates
  (instruction 106 automates them).
- `docker compose --profile app up` ends with both placeholders exited with status 1, on purpose,
  until the apps get real images. Remove them with `docker compose --profile app down`.
- The health checks' one-second polling while a service starts (`start_interval`) needs Docker
  Engine 25 or later and Compose 2.20.2 or later. On Linux, ports published on 127.0.0.1 stay
  out of other machines' reach only from Docker Engine 28.

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
pnpm exec vitest run env-files.test.ts   # "Tests  23 passed (23)"
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
- `server.ts` passed `LOG_LEVEL` to Fastify's logger through `buildApp`'s `logger` option.
  Instruction 8 (structured logging) replaced that option with `logLevel` and `logFormat`; since
  Phase 0 was merged, `server.ts` passes `LOG_LEVEL` and instruction 8's `LOG_FORMAT` through
  them.
- If instruction 102 switches the web app to Next.js's standalone output, its `server.js` does
  not load `next.config.ts`, so the server-variable check must move to `instrumentation.ts`.

## #5 - GitHub Actions CI

**What changed**

- `.github/workflows/ci.yml`: on every push to `main` and every pull request, one job ("Checks")
  on `ubuntu-26.04` sets up pnpm (the `packageManager` version) and Node.js (`.nvmrc`), restores
  pnpm's package store from the cache, runs `pnpm install --frozen-lockfile`, then
  `pnpm peers check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm build`, fails on warnings (and errors that did not stop the build) in the build output
  and validates `docker-compose.yml` (with every profile, failing on any warning). Every check
  runs even when an earlier one failed.
  Read-only token, no stored credentials, every action pinned to a commit SHA, 15-minute limit,
  superseded pull-request runs cancelled.
- `scripts/check-build-warnings.ts`: reads the saved `pnpm build` output and fails if Next.js,
  Node.js or pnpm printed a warning, or an error that did not stop the build, because Next.js
  prints both and still finishes the build.
- `scripts/ci-workflow.test.ts`: holds every workflow to the rules above (pinned actions,
  explicit permissions, time limits, no stored credentials) and checks that every `pnpm` script
  and `scripts/` file CI calls exists. It also runs the Build, build-warning and Compose steps'
  scripts the way GitHub runs them, with stand-ins for `pnpm` and `docker`, so a failed build,
  a warning or Compose output is shown to fail its step. `scripts/check-build-warnings.test.ts`
  uses real build output from this repository.
- `.github/actionlint.yaml`: tells actionlint that `ubuntu-26.04` is a real runner label.
- README section "Continuous integration"; DECISIONS entries on the CI design, on what "fail on
  any warning" covers, on supply-chain safety and on the Node.js version that `scripts/` needs.

**How to verify**

GitHub runs the workflow only once the repository is on GitHub (see Owner actions). Locally,
from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --project scripts            # "Test Files  4 passed (4)", "Tests  53 passed (53)"
pnpm peers check                                  # "No peer dependency issues found"
pnpm build 2>&1 | tee build.log                   # the route table, then "Done"
node scripts/check-build-warnings.ts build.log    # "The build printed no warnings or errors.", status 0
printf 'apps/web build: ⚠ Example warning\n' >> build.log
node scripts/check-build-warnings.ts build.log    # lists the line and exits with status 1
rm build.log
```

With [actionlint](https://github.com/rhysd/actionlint) installed, `actionlint` in the repository
root prints nothing and exits with status 0. With [zizmor](https://docs.zizmor.sh) installed,
`zizmor --offline .github/workflows/ci.yml` ends with "No findings to report. Good job!". Neither
runs in CI (docs/DECISIONS.md explains why). With Docker installed and the root `.env` created
(instruction 3), `docker compose --profile '*' config --quiet` prints nothing.

After the first push to GitHub: the repository's Actions tab shows the "CI" workflow, and its
"Checks" job is green with every step ticked, from "Check out the repository" to "Validate
docker-compose.yml". To see CI fail on a warning, use GitHub's web editor, which runs no local git
hooks (the pre-commit hook from instruction 2 would stop this change on your machine): on a new
branch, add the line `// eslint-disable-next-line no-console` at the top of
`apps/api/src/routes/health.ts` and open a pull request. The Lint step fails with "Unused
eslint-disable directive" and "ESLint found too many warnings (maximum: 0).", the later checks
still run, and the pull request shows "Checks" as failed. Close it and delete the branch.

**Dependencies added**

`yaml` (root devDependency) to parse workflows in the tests; `zod` (root devDependency, added for
instruction 7) also validates them. GitHub Actions, pinned to commit SHAs: `actions/checkout`
v7.0.1, `pnpm/action-setup` v6.1.0 and `actions/setup-node` v7.1.0. Reasons and alternatives are
in `docs/DEPENDENCIES.md`.

**Owner actions**

- Create the GitHub repository (private) and push `main`: for example
  `git remote add origin git@github.com:<you>/apex-garage.git`, then `git push -u origin main`.
  The first push runs CI.
- Protect `main` with a branch ruleset (Settings → Rules → Rulesets) that requires the "Checks"
  status check to pass, so nothing merges with failing checks.
- Under Settings → Actions → General, keep "Workflow permissions" at "Read repository contents
  and packages permissions". If your plan offers it, also turn on the policy that requires
  actions to be pinned to a full-length commit SHA.

**Notes & limitations**

- The workflow has not run on GitHub yet, because there is no repository. It was checked with
  actionlint 1.7.12 (with shellcheck 0.11.0 for the `run:` scripts) and zizmor 1.30.1 (offline
  audits; its online audits need a GitHub token), both without findings. A local simulation then
  ran every `run:` step of `ci.yml` in order, with GitHub's shell command
  `bash --noprofile --norc -eo pipefail`, the workflow's environment variables and `if:`
  conditions, and Docker Compose 5.1.3 (the runner image's version), in fresh clones:
  - of this branch alone: every check passed (9 test files, 80 tests) except the Compose step,
    which stops at `cp .env.example .env` because `docker-compose.yml` and `.env.example` come
    from instruction 3 (Bravo's branch);
  - of this branch merged with the committed branches of instructions 1-4 (Echo's work for
    instructions 6 and 8 was not committed yet): every step passed, with 16 test files and 262
    tests, and the merge commit passed the git hooks of instruction 2;
  - of that merge with five problems added at once (a formatting error, an ESLint warning, a
    failing test, a page that logs an error while it is prerendered and an unset Compose
    variable): each failed its own step, while the peer check, type check and build still ran
    and passed;
  - with a stale lockfile: the install step failed with `ERR_PNPM_OUTDATED_LOCKFILE`.
- A frozen install for the runner's platform,
  `pnpm install --frozen-lockfile --os linux --cpu x64 --libc glibc`, succeeded and fetched the
  Linux builds of Next.js's SWC, Rolldown, Tailwind's Oxide, Lightning CSS, sharp and
  unrs-resolver, with no install script missing from `allowBuilds`. The action steps, the runner
  image and the cache can only be confirmed by the first real run.
- `pnpm/action-setup` must stay before `actions/setup-node`: setup-node asks pnpm where its store
  is (`pnpm store path`). Next.js's own build cache is not cached, so every run prints its "No
  build cache found" notice, which the warning check ignores.
- The build-log check recognises warnings and errors by how they are written (docs/DECISIONS.md
  lists the formats). It cannot see a plain `console.warn` that runs while Next.js prerenders a
  page: Next.js prints the bare message (tested). Console output from passing tests is not checked
  either.
- `vitest related`, which the pre-commit hook (instruction 2) runs, cannot see that
  `scripts/ci-workflow.test.ts` reads the workflows. Since Phase 0 was merged,
  `` `${root}.github/workflows/*` `` is in `forceRerunTriggers` in `vitest.config.ts`, so a commit
  that changes only a workflow runs every test. CI runs them either way.
- `scripts/check-build-warnings.ts` and `scripts/check-docker.ts` need Node.js 24.2 or later
  (`import.meta.main`). CI and `.nvmrc` install the latest Node.js 24; on an older one the tests
  fail, so the checks cannot pass quietly. `engines` still allows 24.0 (see docs/DECISIONS.md).
- The action SHAs do not update themselves; Dependabot arrives with instruction 106.

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

## #7 - Developer scripts

**What changed**

- Root `package.json` scripts, next to `dev`, `build`, `test` and the others:
  - `docker:up` (`docker compose up --detach --wait`: starts PostgreSQL and Redis and returns
    once both are healthy), `docker:down` (removes the containers and keeps the data volumes)
    and `docker:logs` (follows the logs; `pnpm docker:logs postgres` for one service).
  - `db:migrate` and `db:seed`: placeholders that print "not available yet" and exit with status
    1 until instruction 26 adds migrations and seed data.
- `scripts/check-docker.ts` runs before each `docker:*` script. It explains what to do when
  Docker is not installed, has no Compose plugin (`docker compose`) or its engine is not running
  or not reachable, with a link to Docker's documentation for each case.
- Tests: `scripts/check-docker.test.ts`, and `scripts/package-scripts.test.ts`, which runs the
  real `package.json` scripts the way pnpm does against a stand-in `docker` command.
  `scripts/vitest.config.ts` makes them a Vitest project of the root config; the root
  `tsconfig.json` now type-checks `scripts/`.
- No Makefile (see docs/DECISIONS.md). README: the new commands and the repository layout.

**How to verify**

```sh
pnpm run                              # lists db:migrate, db:seed, docker:up, docker:down, docker:logs
pnpm db:migrate; echo "status $?"     # db:migrate: not available yet. ... instruction 26. ... status 1
pnpm db:seed; echo "status $?"        # db:seed: not available yet. ... instruction 26. ... status 1
pnpm exec vitest run --project scripts  # "Tests  53 passed (53)"
```

Without Docker, `pnpm docker:up` prints "Docker is not installed, or the `docker` command is not
on your PATH." with an install link, and exits with status 1. With Docker installed but not
running (Docker Desktop quit), it prints "Docker is installed, but its engine is not running, or
this user cannot reach it." instead.

With Docker running and the root `.env` set up (instruction 3, `cp .env.example .env` and set
both passwords):

```sh
pnpm docker:up          # returns once both services are healthy
docker compose ps       # postgres and redis show "(healthy)"
pnpm docker:logs redis  # follows the Redis log; press Ctrl+C to stop
pnpm docker:down        # removes the containers
docker volume ls        # apex-garage_postgres-data and apex-garage_redis-data are still there
```

**Dependencies added**

`zod` (root devDependency) to validate `package.json` in the tests. See `docs/DEPENDENCIES.md`.

**Owner actions**

To use the `docker:*` scripts, install Docker Desktop or OrbStack (macOS) or Docker Engine with
the Compose plugin (Linux), as instruction 3 describes. Nothing else.

**Notes & limitations**

- The `docker:*` scripts have not been run against a real Docker engine: this machine has no
  Docker. The tests use a stand-in `docker` command, and CI validates the Compose file.
- `db:migrate` and `db:seed` fail on purpose until instruction 26 replaces them.
- The scripts need a POSIX shell, like the existing ones. The tests pass with `/bin/sh` as bash
  (macOS) and as dash (as on Ubuntu, checked with macOS's `/bin/dash`).
- The Docker check costs each `docker:*` command about 0.05 seconds for Node.js and the check
  (measured with a stand-in `docker`), plus whatever its two `docker` commands take, which could
  not be measured here.

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
  option. `apps/api/src/config.ts` reads `LOG_FORMAT` (`json` or `pretty`, default `json`). Since
  Phase 0 was merged, the entrypoint passes instruction 4's `LOG_LEVEL` as `logLevel`.
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
pnpm --filter @apex/api test   # all pass: "Tests  202 passed (202)" with all of Phase 0 merged
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
- `LOG_LEVEL` (instruction 4's environment loader) sets the level; the default is `info`.
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
